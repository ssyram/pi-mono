/**
 * Experience — check historian module for compliance system.
 *
 * At `turn_end`, checkHistorian() reviews turn content against intents and experiences.
 * Outputs: steer messages, new experiences, experience retirements, intent confirmation.
 * Session-level storage via `pi.appendEntry(CUSTOM_TYPE, snapshot)`.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { complete } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import type { Intent } from "./ledger.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Experience {
	id: string;
	summary: string;
	lesson: string;
	confidence: number;
	timestamp: number;
}

export interface ExperienceRetirement {
	id: string;
	content: string;
	reason: string;
}

export interface CheckResult {
	steerMessages: string[];
	newExperiences: Omit<Experience, "id">[];
	retiredExperiences: ExperienceRetirement[];
	intentConfirmation?: string;
}

export interface ExperienceSnapshot {
	experiences: Experience[];
	nextExpId: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EXPERIENCES = 50;
const CHECK_TIMEOUT_MS = 8000;
const RESCUE_TIMEOUT_MS = 5000;
const MAX_TURN_CONTENT_CHARS = 5000;

/** appendEntry type key — exported for index.ts to use in appendEntry and session_start restore. */
export const CUSTOM_TYPE = "historian-experience";

// ---------------------------------------------------------------------------
// ExperienceStore
// ---------------------------------------------------------------------------

export class ExperienceStore {
	private experiences: Experience[] = [];
	private nextExpId = 1;
	private dirty = false;

	/** 加载项目级经验文件 */
	loadProjectExperience(cwd: string): void {
		const filePath = join(cwd, ".pi", "historians", "experience.json");
		try {
			const raw = readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(raw) as { experiences?: unknown[]; nextExpId?: number };
			if (Array.isArray(parsed.experiences)) {
				const valid = parsed.experiences.filter(isValidExperience);
				this.experiences = valid;
				this.nextExpId = typeof parsed.nextExpId === "number" ? parsed.nextExpId : this.extractNextId(valid);
				log.info(`loadProjectExperience: loaded ${valid.length} experience(s) from ${filePath}`);
			}
		} catch {
			log.warn(`loadProjectExperience: could not load from ${filePath} — starting fresh`);
		}
	}

	/** 从 session snapshot 恢复 */
	restoreFrom(snapshot: ExperienceSnapshot): void {
		const raw = Array.isArray(snapshot.experiences) ? snapshot.experiences : [];
		log.info(`restoreFrom: input ${raw.length} experience(s)`);

		this.experiences = raw.filter(isValidExperience);
		this.nextExpId = typeof snapshot.nextExpId === "number" ? snapshot.nextExpId : this.extractNextId(this.experiences);

		if (this.experiences.length > MAX_EXPERIENCES) {
			this.experiences = this.experiences.slice(-MAX_EXPERIENCES);
		}

		const filtered = raw.length - this.experiences.length;
		if (filtered > 0) {
			this.dirty = true;
			log.warn(`restoreFrom: filtered out ${filtered} invalid experience(s) — marked dirty`);
		}

		log.info(`restoreFrom: output ${this.experiences.length} experience(s), nextExpId=${this.nextExpId}`);
	}

	/** 添加新经验（自动分配 ID）*/
	addExperiences(exps: Omit<Experience, "id">[]): void {
		const withIds = exps.map((e) => ({
			...e,
			id: `exp-${this.nextExpId++}`,
		}));
		this.experiences.push(...withIds);
		if (this.experiences.length > MAX_EXPERIENCES) {
			this.experiences = this.experiences.slice(-MAX_EXPERIENCES);
		}
		this.dirty = true;
	}

	/** 退潮指定 ID 的经验 */
	retireExperiences(ids: string[]): void {
		const before = this.experiences.length;
		this.experiences = this.experiences.filter((e) => !ids.includes(e.id));
		if (this.experiences.length < before) {
			this.dirty = true;
			log.info(`retireExperiences: removed ${before - this.experiences.length} experience(s)`);
		}
	}

	/** 获取格式化的经验摘要（给 check prompt 用）*/
	getSummary(): string {
		if (this.experiences.length === 0) {
			return "No experience notes yet.";
		}
		return this.experiences
			.map((e) => `[${e.id}] ${e.summary}: ${e.lesson} (confidence: ${e.confidence})`)
			.join("\n");
	}

	/** Snapshot for appendEntry */
	toSnapshot(): ExperienceSnapshot {
		return {
			experiences: [...this.experiences],
			nextExpId: this.nextExpId,
		};
	}

	isDirty(): boolean {
		return this.dirty;
	}

	markClean(): void {
		this.dirty = false;
	}

	isEmpty(): boolean {
		return this.experiences.length === 0;
	}

	/** 提取下一个 ID（从现有经验中解析最大 ID）*/
	private extractNextId(exps: Experience[]): number {
		let maxId = 0;
		for (const e of exps) {
			const match = /^exp-(\d+)$/.exec(e.id);
			if (match) {
				const num = parseInt(match[1], 10);
				if (num > maxId) maxId = num;
			}
		}
		return maxId + 1;
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidExperience(e: unknown): e is Experience {
	if (e == null || typeof e !== "object") return false;
	const exp = e as Record<string, unknown>;
	return (
		typeof exp.id === "string" &&
		typeof exp.summary === "string" &&
		typeof exp.lesson === "string" &&
		typeof exp.confidence === "number" &&
		exp.confidence >= 0 &&
		exp.confidence <= 1 &&
		typeof exp.timestamp === "number"
	);
}

// ---------------------------------------------------------------------------
// checkHistorian
// ---------------------------------------------------------------------------

let jsonFailCount = 0;

const CHECK_SYSTEM_PROMPT = `You are the Check Historian for a coding agent compliance system.

Review the turn content against session intents and experiences.

Output a JSON object with these fields:
{
  "steerMessages": ["..."],
  "newExperiences": [{"summary": "...", "lesson": "...", "confidence": 0.0-1.0}],
  "retiredExperiences": [{"id": "exp-X", "content": "...", "reason": "..."}],
  "intentConfirmation": "..."
}

Rules:
- steerMessages: only for clear conflicts or ambiguities
- newExperiences: short and powerful, confidence 0.8+ for established patterns
- retiredExperiences: VERY CAUTIOUS, only retire if clearly outdated
- intentConfirmation: only if critical ambiguity detected`;

const EMPTY_CHECK_RESULT: CheckResult = {
	steerMessages: [],
	newExperiences: [],
	retiredExperiences: [],
};

/**
 * Check historian — reviews turn content against session intents and experiences.
 * Outputs: steer messages, new experiences, experience retirements, intent confirmation.
 *
 * Uses rescue mode if JSON parsing fails 3 times.
 */
export async function checkHistorian(
	turnContent: string,
	intents: readonly Intent[],
	experiences: readonly Experience[],
	checkModel: Model<any>,
	apiKey: string,
): Promise<CheckResult> {
	const formattedIntents =
		intents.length > 0 ? intents.map((i) => `[${i.id}] ${i.text}`).join("\n") : "(none)";

	const formattedExperiences =
		experiences.length > 0
			? experiences.map((e) => `[${e.id}] ${e.summary}: ${e.lesson} (confidence: ${e.confidence})`).join("\n")
			: "(none)";

	const truncatedContent =
		turnContent.length > MAX_TURN_CONTENT_CHARS
			? turnContent.slice(0, MAX_TURN_CONTENT_CHARS) + "\n... (truncated)"
			: turnContent;

	const userMessage = `## Session Intents\n${formattedIntents}\n\n## Session Experiences\n${formattedExperiences}\n\n## Turn Content\n${truncatedContent}`;

	if (jsonFailCount >= 3) {
		log.warn("checkHistorian: using rescue mode");
		return rescueMode(turnContent, intents, experiences, checkModel, apiKey);
	}

	const controller = new AbortController();

	try {
		const response = await complete(
			checkModel,
			{
				systemPrompt: CHECK_SYSTEM_PROMPT,
				messages: [{ role: "user", content: [{ type: "text", text: userMessage }], timestamp: Date.now() }],
			},
			{ apiKey, signal: controller.signal },
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		log.info(`checkHistorian: response length=${text.length}`);
		const result = parseCheckResponse(text);
		jsonFailCount = 0;
		return result;
	} catch (err) {
		const brief = err instanceof Error ? err.message : String(err);
		log.warn(`checkHistorian: LLM call failed — ${brief}`);
		return EMPTY_CHECK_RESULT;
	} finally {
	}
}

function parseCheckResponse(text: string): CheckResult {
	const candidates = [
		() => text.replace(/```json\n?|```\n?/g, "").trim(),
		() => {
			const start = text.indexOf("{");
			if (start === -1) return "";
			let depth = 0;
			for (let i = start; i < text.length; i++) {
				if (text[i] === "{") depth++;
				else if (text[i] === "}") depth--;
				if (depth === 0) return text.slice(start, i + 1);
			}
			return "";
		},
	];

	for (const extract of candidates) {
		try {
			const json = extract();
			if (!json) continue;
			const parsed = JSON.parse(json) as Record<string, unknown>;
			jsonFailCount = 0;
			return validateCheckResult(parsed);
		} catch {
			// try next strategy
		}
	}

	jsonFailCount++;
	log.warn(`parseCheckResponse: JSON parse failed (count=${jsonFailCount})`);
	return EMPTY_CHECK_RESULT;
}

function validateCheckResult(parsed: Record<string, unknown>): CheckResult {
	const rawSteer = Array.isArray(parsed.steerMessages) ? parsed.steerMessages : [];
	const rawExps = Array.isArray(parsed.newExperiences) ? parsed.newExperiences : [];
	const rawRetired = Array.isArray(parsed.retiredExperiences) ? parsed.retiredExperiences : [];

	const now = Date.now();

	const steerMessages = rawSteer
		.filter((s): s is string => typeof s === "string")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	const newExperiences = rawExps
		.filter(
			(e): e is { summary: string; lesson: string; confidence: number } =>
				e != null &&
				typeof (e as Record<string, unknown>).summary === "string" &&
				typeof (e as Record<string, unknown>).lesson === "string" &&
				typeof (e as Record<string, unknown>).confidence === "number" &&
				((e as Record<string, unknown>).confidence as number) >= 0 &&
				((e as Record<string, unknown>).confidence as number) <= 1,
		)
		.map((e) => ({
			summary: e.summary,
			lesson: e.lesson,
			confidence: e.confidence,
			timestamp: now,
		}));

	const retiredExperiences = rawRetired
		.filter(
			(r): r is { id: string; content: string; reason: string } =>
				r != null &&
				typeof (r as Record<string, unknown>).id === "string" &&
				typeof (r as Record<string, unknown>).content === "string" &&
				typeof (r as Record<string, unknown>).reason === "string",
		)
		.map((r) => ({
			id: r.id,
			content: r.content,
			reason: r.reason,
		}));

	const intentConfirmation =
		typeof parsed.intentConfirmation === "string" && parsed.intentConfirmation.trim().length > 0
			? parsed.intentConfirmation.trim()
			: undefined;

	return { steerMessages, newExperiences, retiredExperiences, intentConfirmation };
}

async function rescueMode(
	turnContent: string,
	intents: readonly Intent[],
	experiences: readonly Experience[],
	checkModel: Model<any>,
	apiKey: string,
): Promise<CheckResult> {
	// Truncate context to prevent prompt overflow
	const recentIntents = intents.slice(-10);
	const recentExperiences = experiences.slice(-20);
	const context = `Intents:\n${recentIntents.map((i) => `[${i.id}] ${i.text}`).join("\n")}\n\nExperiences:\n${recentExperiences.map((e) => `[${e.id}] ${e.summary}: ${e.lesson}`).join("\n")}\n\nTurn:\n${turnContent.slice(0, MAX_TURN_CONTENT_CHARS)}`;

	const result: CheckResult = {
		steerMessages: [],
		newExperiences: [],
		retiredExperiences: [],
	};

	// 1. Steer messages
	try {
		const controller = new AbortController();
		try {
			const response = await complete(
				checkModel,
				{
					systemPrompt: "List any conflicts or clarifications needed. One per line. Empty if none.",
					messages: [{ role: "user", content: [{ type: "text", text: context }], timestamp: Date.now() }],
				},
				{ apiKey, signal: controller.signal },
			);
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
			result.steerMessages = text
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
		} finally {
		}
	} catch (err) {
		log.warn(`rescueMode: steer messages failed — ${err instanceof Error ? err.message : String(err)}`);
	}

	// 2. New experiences
	try {
		const controller = new AbortController();
		try {
			const response = await complete(
				checkModel,
				{
					systemPrompt: 'List new experiences. Format: "summary | lesson | confidence". One per line. Empty if none.',
					messages: [{ role: "user", content: [{ type: "text", text: context }], timestamp: Date.now() }],
				},
				{ apiKey, signal: controller.signal },
			);
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
			const now = Date.now();
			result.newExperiences = text
				.split("\n")
				.map((line) => {
					const parts = line.split("|").map((p) => p.trim());
					if (parts.length !== 3) return null;
					const conf = parseFloat(parts[2]);
					if (isNaN(conf) || conf < 0 || conf > 1) return null;
					return {
						summary: parts[0],
						lesson: parts[1],
						confidence: conf,
						timestamp: now,
					};
				})
				.filter((e): e is Omit<Experience, "id"> => e !== null);
		} finally {
		}
	} catch (err) {
		log.warn(`rescueMode: new experiences failed — ${err instanceof Error ? err.message : String(err)}`);
	}

	// 3. Intent confirmation
	try {
		const controller = new AbortController();
		try {
			const response = await complete(
				checkModel,
				{
					systemPrompt: 'If user intent needs confirmation, state it. Otherwise output "None" or empty.',
					messages: [{ role: "user", content: [{ type: "text", text: context }], timestamp: Date.now() }],
				},
				{ apiKey, signal: controller.signal },
			);
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("")
				.trim();
			if (text.length > 0 && text.toLowerCase() !== "none") {
				result.intentConfirmation = text;
			}
		} finally {
		}
	} catch (err) {
		log.warn(`rescueMode: intent confirmation failed — ${err instanceof Error ? err.message : String(err)}`);
	}

	// 4. Retired experiences
	try {
		const expList = experiences.map((e) => `${e.id} | ${e.summary}: ${e.lesson}`).join("\n");
		const controller = new AbortController();
		try {
			const response = await complete(
				checkModel,
				{
					systemPrompt: `Here are current experiences:\n${expList}\n\nAre any clearly outdated? If yes, output "exp-X | reason". One per line. If no, output "None" or empty.`,
					messages: [{ role: "user", content: [{ type: "text", text: context }], timestamp: Date.now() }],
				},
				{ apiKey, signal: controller.signal },
			);
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
			result.retiredExperiences = text
				.split("\n")
				.map((line) => {
					const parts = line.split("|").map((p) => p.trim());
					if (parts.length !== 2) return null;
					const exp = experiences.find((e) => e.id === parts[0]);
					if (!exp) return null;
					return {
						id: parts[0],
						content: `${exp.summary}: ${exp.lesson}`,
						reason: parts[1],
					};
				})
				.filter((r): r is ExperienceRetirement => r !== null);
		} finally {
		}
	} catch (err) {
		log.warn(`rescueMode: retired experiences failed — ${err instanceof Error ? err.message : String(err)}`);
	}

	return result;
}

