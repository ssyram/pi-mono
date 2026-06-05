/**
 * Ledger — tracks user intents, derived rules, and tool-call decisions.
 *
 * Persisted via `pi.appendEntry("historian-snapshot", snapshot)`.
 * Restored from `session_start` by scanning the branch for custom entries.
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum Severity {
	/** Critical — always block */
	P0 = 0,
	/** High — block unless overridden */
	P1 = 1,
	/** Medium — warn via steer message */
	P2 = 2,
	/** Low — log only */
	P3 = 3,
}

export type RuleType = "protect_path" | "restrict_command" | "require_pattern" | "custom";

export interface Rule {
	type: RuleType;
	/** Regex source string or path glob */
	pattern: string;
	description: string;
	severity: Severity;
}

export interface Intent {
	id: string;
	/** Original user instruction text */
	text: string;
	rules: Rule[];
	timestamp: number;
}

export interface Decision {
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	action: "allowed" | "blocked" | "warned";
	reason?: string;
	timestamp: number;
}

export interface LedgerSnapshot {
	intents: Intent[];
	decisions: Decision[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_RULE_TYPES: readonly RuleType[] = ["protect_path", "restrict_command", "require_pattern", "custom"];

const MAX_INTENTS = 50;
const MAX_DECISIONS = 100;

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export class Ledger {
	private intents: Intent[] = [];
	private decisions: Decision[] = [];
	private nextIntentId = 1;
	private dirty = false;

	addIntent(text: string, rules: Rule[]): Intent {
		const intent: Intent = {
			id: `intent-${this.nextIntentId++}`,
			text,
			rules,
			timestamp: Date.now(),
		};
		this.intents.push(intent);
		if (this.intents.length > MAX_INTENTS) {
			this.intents = this.intents.slice(-MAX_INTENTS);
		}
		this.dirty = true;
		log.info(`addIntent: ${intent.id} with ${rules.length} rule(s)`);
		return intent;
	}

	removeIntent(id: string): void {
		const before = this.intents.length;
		this.intents = this.intents.filter((i) => i.id !== id);
		if (this.intents.length < before) {
			this.dirty = true;
		}
	}

	recordDecision(decision: Decision): void {
		// 截断 input 防止 snapshot 膨胀
		const MAX_INPUT_LENGTH = 2000;
		const serialized = JSON.stringify(decision.input ?? {});
		if (serialized.length > MAX_INPUT_LENGTH) {
			decision = {
				...decision,
				input: { _truncated: serialized.slice(0, MAX_INPUT_LENGTH) + "..." },
			};
		}
		this.decisions.push(decision);
		if (this.decisions.length > MAX_DECISIONS) {
			this.decisions = this.decisions.slice(-MAX_DECISIONS);
		}
		this.dirty = true;
		log.debug(`recordDecision: ${decision.toolName} → ${decision.action}${decision.reason ? ` (${decision.reason})` : ""}`);
	}

	getAllRules(): Rule[] {
		return this.intents.flatMap((i) => i.rules);
	}

	getIntents(): readonly Intent[] {
		return this.intents;
	}

	getRecentDecisions(count = 10): readonly Decision[] {
		return this.decisions.slice(-count);
	}

	isDirty(): boolean {
		return this.dirty;
	}

	markClean(): void {
		this.dirty = false;
	}

	isEmpty(): boolean {
		return this.intents.length === 0;
	}

	toSnapshot(): LedgerSnapshot {
		return {
			intents: [...this.intents],
			decisions: [...this.decisions],
		};
	}

	restoreFrom(snapshot: LedgerSnapshot): void {
		// 字段级校验：过滤不合法条目，而非全部丢弃
		const rawIntents = Array.isArray(snapshot.intents) ? snapshot.intents : [];
		const rawDecisions = Array.isArray(snapshot.decisions) ? snapshot.decisions : [];

		log.info(`restoreFrom: input ${rawIntents.length} intents, ${rawDecisions.length} decisions`);

		const isValidRule = (r: unknown): r is Rule =>
			r != null &&
			typeof (r as Rule).type === "string" &&
			VALID_RULE_TYPES.includes((r as Rule).type) &&
			typeof (r as Rule).pattern === "string" &&
			typeof (r as Rule).description === "string" &&
			typeof (r as Rule).severity === "number" &&
			(r as Rule).severity >= Severity.P0 &&
			(r as Rule).severity <= Severity.P3;

		this.intents = rawIntents
			.filter(
				(i): i is Intent =>
					i != null &&
					typeof i.id === "string" &&
					typeof i.text === "string" &&
					Array.isArray(i.rules),
			)
			.map((i) => ({ ...i, rules: i.rules.filter(isValidRule) }))
			.filter((i) => i.rules.length > 0);

		this.decisions = rawDecisions.filter(
			(d): d is Decision =>
				d != null &&
				typeof d.toolCallId === "string" &&
				typeof d.toolName === "string" &&
				typeof d.action === "string" &&
				typeof d.timestamp === "number",
		);

		// ring buffer 裁剪
		if (this.intents.length > MAX_INTENTS) {
			this.intents = this.intents.slice(-MAX_INTENTS);
		}
		if (this.decisions.length > MAX_DECISIONS) {
			this.decisions = this.decisions.slice(-MAX_DECISIONS);
		}

		const filteredIntents = rawIntents.length - this.intents.length;
		const filteredDecisions = rawDecisions.length - this.decisions.length;

		// 过滤导致数据变化时标记 dirty，确保清理后的数据会写回 snapshot
		if (filteredIntents > 0 || filteredDecisions > 0) {
			this.dirty = true;
			log.warn(`restoreFrom: filtered out ${filteredIntents} intents, ${filteredDecisions} decisions — marked dirty`);
		}

		log.info(`restoreFrom: output ${this.intents.length} intents, ${this.decisions.length} decisions`);

		// 如果输入 snapshot 有非空数据但过滤后全为空，说明 snapshot 已损坏
		const hadIntents = rawIntents.length > 0;
		const hadDecisions = rawDecisions.length > 0;
		if ((hadIntents || hadDecisions) && this.intents.length === 0 && this.decisions.length === 0) {
			log.error("restoreFrom: snapshot corrupt — all entries filtered out");
			throw new Error("snapshot corrupt: all entries filtered out");
		}

		// NaN 防护
		const maxId = this.intents.reduce((max, intent) => {
			const num = Number.parseInt(intent.id.replace("intent-", ""), 10);
			return !Number.isNaN(num) && num > max ? num : max;
		}, 0);
		this.nextIntentId = maxId + 1;
	}

	clear(): void {
		this.intents = [];
		this.decisions = [];
		this.nextIntentId = 1;
	}
}
