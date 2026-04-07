/**
 * Historian extension — tracks user intents and enforces compliance on tool calls.
 *
 * Install: symlink or copy this directory into ~/.pi/agent/extensions/historian/
 *
 * Lifecycle:
 *   session_start  → load state from .pi/historians/{sessionId}/state.json
 *   input          → extract intents/rules from user message (LLM)
 *   tool_call      → RuleWorker (deterministic) → SemanticWorker (LLM, if needed)
 *                     → block / warn / allow
 *   turn_end       → save state to file
 *   session_before_compact → save state to file (survives compaction)
 *   session_shutdown → final save
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadConfig, getConfig } from "./config.js";
import { ExperienceStore, checkHistorian } from "./experience.js";
import { DecisionPathStore, logHistorian } from "./decision-path.js";
import { guardCheck, clearLastWarned } from "./guard.js";
import { Ledger, type Rule, Severity } from "./ledger.js";
import { initLogger, log } from "./logger.js";
import { buildIntentExtractionPrompt } from "./prompts.js";
import { resolveModel } from "./resolve-model.js";
import { requiresSemanticCheck, ruleCheck, semanticCheck } from "./workers.js";

const MAX_INTENT_INPUT_CHARS = 8000;
const INTENT_FAIL_THRESHOLD = 3;

interface SessionStateData {
	ledger: ReturnType<Ledger["toSnapshot"]>;
	experiences: ReturnType<ExperienceStore["toSnapshot"]>;
	decisionPath: ReturnType<DecisionPathStore["toSnapshot"]>;
	intentFailCount: number;
	intentDegraded: boolean;
}

class SessionState {
	private ledger: Ledger;
	private experienceStore: ExperienceStore;
	private decisionPathStore: DecisionPathStore;
	private intentFailCount: number;
	private intentDegraded: boolean;
	private stateFilePath: string;
	private dirty: boolean;

	constructor(sessionDir: string) {
		this.stateFilePath = join(sessionDir, "state.json");
		this.ledger = new Ledger();
		this.experienceStore = new ExperienceStore();
		this.decisionPathStore = new DecisionPathStore();
		this.intentFailCount = 0;
		this.intentDegraded = false;
		this.dirty = false;
		this.load();
	}

	private load(): void {
		try {
			const raw = readFileSync(this.stateFilePath, "utf-8");
			const data = JSON.parse(raw) as SessionStateData;
			if (data.ledger) this.ledger.restoreFrom(data.ledger);
			if (data.experiences) this.experienceStore.restoreFrom(data.experiences);
			if (data.decisionPath) this.decisionPathStore.restoreFrom(data.decisionPath);
			this.intentFailCount = data.intentFailCount ?? 0;
			this.intentDegraded = data.intentDegraded ?? false;
			log.info(`SessionState loaded from ${this.stateFilePath}`);
		} catch {
			log.info(`SessionState: no existing state, starting fresh`);
		}
	}

	save(): void {
		if (!this.dirty) return;
		try {
			const data: SessionStateData = {
				ledger: this.ledger.toSnapshot(),
				experiences: this.experienceStore.toSnapshot(),
				decisionPath: this.decisionPathStore.toSnapshot(),
				intentFailCount: this.intentFailCount,
				intentDegraded: this.intentDegraded,
			};
			mkdirSync(dirname(this.stateFilePath), { recursive: true });
			writeFileSync(this.stateFilePath, JSON.stringify(data, null, 2), "utf-8");
			this.dirty = false;
			log.info(`SessionState saved to ${this.stateFilePath}`);
		} catch (err) {
			log.error(`SessionState save failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	markDirty(): void {
		this.dirty = true;
	}

	getLedger(): Ledger { return this.ledger; }
	getExperienceStore(): ExperienceStore { return this.experienceStore; }
	getDecisionPathStore(): DecisionPathStore { return this.decisionPathStore; }
	getIntentFailCount(): number { return this.intentFailCount; }
	isIntentDegraded(): boolean { return this.intentDegraded; }
	setIntentFailCount(n: number): void { this.intentFailCount = n; this.markDirty(); }
	setIntentDegraded(v: boolean): void { this.intentDegraded = v; this.markDirty(); }
}

const sessionStates = new WeakMap<object, SessionState>();

function getSessionState(ctx: ExtensionContext): SessionState {
	const key = ctx.sessionManager;
	let state = sessionStates.get(key);
	if (!state) {
		const sessionDir = join(ctx.cwd, ".pi", "historians", ctx.sessionManager.getSessionId());
		state = new SessionState(sessionDir);
		sessionStates.set(key, state);
	}
	return state;
}

export default function historian(pi: ExtensionAPI) {
	// -----------------------------------------------------------------------
	// Restore ledger on session load
	// -----------------------------------------------------------------------
	pi.on("session_start", (_event, ctx) => {
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			initLogger(ctx.cwd, sessionId);
			loadConfig(ctx.cwd);
			clearLastWarned();
			const state = getSessionState(ctx);
			state.getExperienceStore().loadProjectExperience(ctx.cwd);
		} catch (err) {
			log.error(`session_start error: ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	// -----------------------------------------------------------------------
	// Extract intents from user input
	// -----------------------------------------------------------------------
	pi.on("input", (event, ctx) => {
		// Only process user input
		if (!event.text.trim()) return;

		const state = getSessionState(ctx);
		if (state.isIntentDegraded()) return;

		const ledger = state.getLedger();

		const cfg = getConfig();
		const model = (cfg.intentModel ? resolveModel(cfg.intentModel, ctx) : undefined) ?? ctx.model;
		if (!model) return;

		// Fire-and-forget: don't block input processing
		(async () => {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) return;
			const apiKey = auth.apiKey;

			log.info("input: intent extraction starting");
			const inputText = event.text.length > MAX_INTENT_INPUT_CHARS ? event.text.slice(0, MAX_INTENT_INPUT_CHARS) + "..." : event.text;
			const existingIntents = ledger.getIntents();

			// First run: include system prompt to extract initial intents
			const isFirstRun = existingIntents.length === 0;
			const systemPrompt = ctx.getSystemPrompt?.() || "";
			const fullInput = isFirstRun && systemPrompt
				? `System Prompt:\n${systemPrompt}\n\nUser Input:\n${inputText}`
				: inputText;

			const prompt = buildIntentExtractionPrompt(fullInput, existingIntents);

			const controller = new AbortController();

			try {
				log.info(`intent extraction INPUT | systemPrompt: ${prompt.systemPrompt}`);
				log.info(`intent extraction INPUT | userMessage: ${prompt.userMessage}`);

				const response = await complete(
					model,
					{
						systemPrompt: prompt.systemPrompt,
						messages: [{ role: "user", content: [{ type: "text", text: prompt.userMessage }], timestamp: Date.now() }],
					},
					{ apiKey, signal: controller.signal },
				);

				log.info(`intent extraction OUTPUT | response.content: ${JSON.stringify(response.content)}`);
				const text = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("");

				log.info(`intent extraction OUTPUT | extracted text: ${text}`);

				const parsed = parseIntentResponse(text);
				let totalRules = 0;
				for (const item of parsed) {
					if (item.rules.length > 0) {
						state.getLedger().addIntent(item.text, item.rules);
						totalRules += item.rules.length;
					}
				}
				log.info(`INTENT EXTRACTED | ${parsed.length} intent(s), ${totalRules} rule(s)`);
				for (const item of parsed) {
					for (const rule of item.rules) {
						log.info(`  → [P${rule.severity}] ${rule.description} (${rule.type}: ${rule.pattern})`);
					}
				}
				state.setIntentFailCount(0);
				state.markDirty();
			} catch (err) {
				const newCount = state.getIntentFailCount() + 1;
				state.setIntentFailCount(newCount);
				const brief = err instanceof Error ? err.message : String(err);
				log.warn(`input: intent extraction failed (${newCount}/${INTENT_FAIL_THRESHOLD}): ${brief}`);
				if (newCount >= INTENT_FAIL_THRESHOLD) {
					state.setIntentDegraded(true);
					log.error(`INTENT DEGRADED | ${newCount} consecutive failures`);
					try {
						pi.sendMessage(
							{
								customType: "historian-alert",
								content: `⚠ Historian: intent extraction failed ${newCount} times consecutively — degraded, skipping future extractions.`,
								display: true,
							},
							{ deliverAs: "steer" },
						);
					} catch (sendErr) {
						log.error(`sendMessage failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
					}
				}
			}
		})();
	});

	// -----------------------------------------------------------------------
	// Gate: check every tool call against ledger rules
	// -----------------------------------------------------------------------
	pi.on("tool_call", async (event, ctx) => {
		try {
			const state = getSessionState(ctx);
			const ledger = state.getLedger();
			const experienceStore = state.getExperienceStore();
			if (ledger.isEmpty()) return;

			const rules = ledger.getAllRules();

			// Phase 1: deterministic rule check (< 1 ms)
			const ruleResult = ruleCheck(event, rules);

			if (ruleResult?.invalidPattern) {
				console.warn(`[Historian] ${ruleResult.reason}`);
				log.warn(`tool_call: invalid pattern — ${ruleResult.reason}`);
			}

			log.info(`CHECK ${event.toolName} [${event.toolCallId}] | Phase 1: ${ruleResult?.matched ? "HIT P" + ruleResult.severity : "no match"}`);

			// C1: only block+return on P0/P1; P2/P3 record + warn but fall through to Phase 2
			if (ruleResult?.matched) {
				if (ruleResult.severity <= Severity.P1) {
					ledger.recordDecision({
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						input: event.input as Record<string, unknown>,
						action: "blocked",
						reason: ruleResult.reason,
						timestamp: Date.now(),
					});
					state.markDirty();
					log.warn(`BLOCKED ${event.toolName} | ${ruleResult.reason}`);
					return { block: true, reason: `[Historian] ${ruleResult.reason}` };
				}

				if (ruleResult.severity === Severity.P2) {
					// P2: record as warned + send steer message
					ledger.recordDecision({
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						input: event.input as Record<string, unknown>,
						action: "warned",
						reason: ruleResult.reason,
						timestamp: Date.now(),
					});
					state.markDirty();
					pi.sendMessage(
						{ customType: "historian-alert", content: `⚠ Historian: ${ruleResult.reason}`, display: true },
						{ deliverAs: "steer" },
					);
					log.info(`STEER ${event.toolName} | ${ruleResult.reason}`);
				} else {
					// P3: log only — record as allowed, no steer message
					ledger.recordDecision({
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						input: event.input as Record<string, unknown>,
						action: "allowed",
						reason: ruleResult.reason,
						timestamp: Date.now(),
					});
					state.markDirty();
				}
				// P2/P3 both fall through to Phase 2
			}

			// Phase 1.5: guardModel gate check (fast, at most once per unique call)
			const cfg = getConfig();
			const gModel = (cfg.guardModel ? resolveModel(cfg.guardModel, ctx) : undefined) ?? ctx.model;
			if (gModel) {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(gModel);
				if (auth.ok && auth.apiKey) {
					try {
						const guardResult = await guardCheck(event, ctx, ledger, gModel, experienceStore.getSummary());
						log.info(`GUARD ${event.toolName} [${event.toolCallId}] | ${guardResult.action}${guardResult.reason ? ": " + guardResult.reason : ""}`);

						if (guardResult.action === "warn") {
							ledger.recordDecision({
								toolCallId: event.toolCallId,
								toolName: event.toolName,
								input: event.input as Record<string, unknown>,
								action: "blocked",
								reason: `guard: ${guardResult.reason}`,
								timestamp: Date.now(),
							});
							state.markDirty();
							pi.sendMessage(
								{
									customType: "historian-alert",
									content: `⚠ Historian: 这次 ${event.toolName} 调用可能违反「${guardResult.reason}」，请再确认是否调用，确实调用请先解释为什么再执行调用`,
									display: true,
								},
								{ deliverAs: "steer" },
							);
							log.warn(`GUARD WARN ${event.toolName} | ${guardResult.reason}`);
							return { block: true, reason: `[Historian Guard] ${guardResult.reason}` };
						}
					} catch (guardErr) {
						const brief = guardErr instanceof Error ? guardErr.message : String(guardErr);
						log.warn(`guard: error — ${brief}`);
						// Fail-open
					}
				}
			}

			// Phase 2: semantic check (LLM, only if needed)
			const needsPhase2 = requiresSemanticCheck(event, rules);
			log.info(`CHECK ${event.toolName} [${event.toolCallId}] | Phase 2: ${needsPhase2 ? "executing" : "skipped"}`);

			if (needsPhase2) {
				const cfg = getConfig();
				const checkModel = (cfg.checkModel ? resolveModel(cfg.checkModel, ctx) : undefined) ?? ctx.model;
				const result = await semanticCheck(event, ledger, ctx, rules, checkModel);
				log.info(`CHECK ${event.toolName} [${event.toolCallId}] | Phase 2: verdict=${result.verdict}`);

				// C2: record decision for ALL verdicts, including pass
				ledger.recordDecision({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.input as Record<string, unknown>,
					action: result.verdict === "block" ? "blocked" : result.verdict === "warn" ? "warned" : "allowed",
					reason: result.reason,
					timestamp: Date.now(),
				});
				state.markDirty();

				if (result.verdict === "block") {
					log.warn(`BLOCKED ${event.toolName} | ${result.reason}`);
					return { block: true, reason: `[Historian] ${result.reason}` };
				}

				if (result.verdict === "warn") {
					pi.sendMessage(
						{ customType: "historian-alert", content: `⚠ Historian: ${result.reason}`, display: true },
						{ deliverAs: "steer" },
					);
					log.info(`STEER ${event.toolName} | ${result.reason}`);
				}
				return;
			}

			// No violation — record as allowed
			ledger.recordDecision({
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input as Record<string, unknown>,
				action: "allowed",
				timestamp: Date.now(),
			});
			state.markDirty();
			log.debug(`PASS ${event.toolName} [${event.toolCallId}]`);
		} catch (err) {
			// C5: fail-open — log and allow the tool call to proceed
			const brief = err instanceof Error ? err.message : String(err);
			log.error(`tool_call handler error: ${brief}`);
			console.error("[Historian] tool_call handler error:", err);

			// Record fail-open decision for audit trail
			try {
				const state = getSessionState(ctx);
				state.getLedger().recordDecision({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.input as Record<string, unknown>,
					action: "allowed",
					reason: `handler error (fail-open): ${brief}`,
					timestamp: Date.now(),
				});
				state.markDirty();
			} catch {
				// event may lack required fields — best-effort only
				log.warn("tool_call: failed to record fail-open decision");
			}
		}
	});

	// -----------------------------------------------------------------------
	// Persist ledger at turn boundaries
	// -----------------------------------------------------------------------
	pi.on("turn_end", (_event, ctx) => {
		const state = getSessionState(ctx);
		const ledger = state.getLedger();
		const experienceStore = state.getExperienceStore();
		const decisionPathStore = state.getDecisionPathStore();

		// Fire-and-forget: don't block next turn
		(async () => {
			try {
				const cfg = getConfig();
				const cModel = (cfg.checkModel ? resolveModel(cfg.checkModel, ctx) : undefined) ?? ctx.model;
				if (!cModel) {
					log.warn("turn_end: no checkModel available");
					return;
				}
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(cModel);
				if (!auth.ok || !auth.apiKey) {
					log.warn("turn_end: no API key for checkModel");
					return;
				}
				const apiKey = auth.apiKey;

				const turnContent = buildTurnContent(ctx, state);
				if (!turnContent.trim()) {
					log.info("turn_end: empty turn content, skipping historians");
					return;
				}

			const [checkResult, logResult] = await Promise.all([
				checkHistorian(
					turnContent,
					ledger.getIntents(),
					experienceStore.toSnapshot().experiences,
					cModel,
					apiKey,
				).catch((err) => {
					log.error(`checkHistorian error: ${err instanceof Error ? err.message : String(err)}`);
					return null;
				}),
				logHistorian(
					turnContent,
					decisionPathStore.getLastEntrySummary(),
					cModel,
					apiKey,
				).catch((err) => {
					log.error(`logHistorian error: ${err instanceof Error ? err.message : String(err)}`);
					return null;
				}),
			]);

			if (checkResult) {
				for (const msg of checkResult.steerMessages) {
					pi.sendMessage(
						{
							customType: "historian-alert",
							content: `⚠ Historian: ${msg}`,
							display: true,
						},
						{ deliverAs: "steer" },
					);
					log.warn(`STEER | ${msg}`);
				}

				if (checkResult.newExperiences.length > 0) {
					experienceStore.addExperiences(checkResult.newExperiences);
					state.markDirty();
					log.info(`EXPERIENCE | ${checkResult.newExperiences.length} new experience(s)`);
					for (const exp of checkResult.newExperiences) {
						log.info(`  → ${exp.summary}: ${exp.lesson} (${exp.confidence})`);
					}
				}

				if (checkResult.retiredExperiences.length > 0) {
					const ids = checkResult.retiredExperiences.map((r) => r.id);
					experienceStore.retireExperiences(ids);
					state.markDirty();
					log.info(`EXPERIENCE RETIRED | ${ids.length} experience(s)`);
					for (const ret of checkResult.retiredExperiences) {
						log.info(`  → [${ret.id}] ${ret.content}: ${ret.reason}`);
					}
				}

				if (checkResult.intentConfirmation) {
					pi.sendMessage(
						{
							customType: "historian-alert",
							content: `⚠ Historian 需要确认意图: ${checkResult.intentConfirmation}`,
							display: true,
						},
						{ deliverAs: "steer" },
					);
					log.warn(`INTENT CONFIRMATION | ${checkResult.intentConfirmation}`);
				}
			}

				if (logResult) {
					decisionPathStore.addEntry(logResult);
					state.markDirty();
					log.info(`DECISION PATH | turn recorded (${logResult.keyDecisions.length} decisions, ${logResult.unexploredPaths.length} unexplored)`);
				}
			} catch (err) {
				const brief = err instanceof Error ? err.message : String(err);
				log.error(`turn_end historians error: ${brief}`);
			}

			state.save();
		})();
	});

	pi.on("session_before_compact", (_event, ctx) => {
		try {
			const state = getSessionState(ctx);
			state.save();
		} catch (err) {
			log.error(`session_before_compact error: ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		try {
			const state = getSessionState(ctx);
			state.save();
		} catch (err) {
			log.error(`session_shutdown error: ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	// -----------------------------------------------------------------------
	// /historian command — show ledger status
	// -----------------------------------------------------------------------
	pi.registerCommand("historian", {
		description: "Show historian ledger: active intents, rules, and recent decisions",
		handler: async (_args, ctx) => {
			log.info("/historian command invoked");
			const state = getSessionState(ctx);
			const ledger = state.getLedger();
			const experienceStore = state.getExperienceStore();
			const decisionPathStore = state.getDecisionPathStore();
			const intents = ledger.getIntents();
			const decisions = ledger.getRecentDecisions(10);

			const lines: string[] = ["# Historian Ledger\n"];

			if (state.isIntentDegraded()) {
				lines.push("**Status: DEGRADED** — intent extraction disabled after repeated failures.\n");
			} else {
				lines.push(`**Status: Active** (intent extraction failures: ${state.getIntentFailCount()}/${INTENT_FAIL_THRESHOLD})\n`);
			}

			if (intents.length === 0) {
				lines.push("No active intents tracked.\n");
			} else {
				lines.push(`## Intents (${intents.length})\n`);
				for (const intent of intents) {
					lines.push(`### ${intent.id}`);
					lines.push(`> ${intent.text}\n`);
					for (const rule of intent.rules) {
						lines.push(`- **[P${rule.severity}]** ${rule.description} (\`${rule.pattern}\`)`);
					}
					lines.push("");
				}
			}

			if (decisions.length > 0) {
				lines.push(`## Recent Decisions (last ${decisions.length})\n`);
				for (const d of decisions) {
					const icon = d.action === "blocked" ? "🚫" : d.action === "warned" ? "⚠️" : "✅";
					const inputSummary = d.input ? truncate(JSON.stringify(d.input), 100) : "";
					lines.push(`- ${icon} **${d.toolName}** → ${d.action}${d.reason ? `: ${d.reason}` : ""}${inputSummary ? `\n  Input: \`${inputSummary}\`` : ""}`);
				}
			}

			const experiences = experienceStore.toSnapshot().experiences;
			if (experiences.length > 0) {
				lines.push(`## Experience Notes (${experiences.length})\n`);
				for (const exp of experiences.slice(-5)) {
					lines.push(`- **${exp.summary}**: ${exp.lesson} (confidence: ${exp.confidence})`);
				}
				lines.push("");
			}

			const pathEntries = decisionPathStore.toSnapshot().entries;
			if (pathEntries.length > 0) {
				lines.push(`## Decision Path (${pathEntries.length} turns)\n`);
				for (const entry of pathEntries.slice(-3)) {
					lines.push(`**Turn ${entry.turnIndex}**:`);
					lines.push(`- Key Decisions: ${entry.keyDecisions.join("; ") || "none"}`);
					lines.push(`- Unexplored: ${entry.unexploredPaths.join("; ") || "none"}`);
					lines.push(`- Reasoning: ${entry.reasoning}`);
					lines.push("");
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedIntent {
	text: string;
	rules: Rule[];
}

/** Valid rule types — rejects anything the LLM hallucinates outside this set. */
const VALID_RULE_TYPES: Set<string> = new Set(["protect_path", "restrict_command", "require_pattern", "custom"]);

/** Truncate a string to maxLen, appending "…" if truncated. */
function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen) + "…";
}

/**
 * Build turn content from recent session branch entries.
 * Includes last user message + assistant messages + tool calls.
 */
function buildTurnContent(ctx: ExtensionContext, state: SessionState): string {
	const branch = ctx.sessionManager.getBranch();
	const lines: string[] = [];

	// Get last 5 entries (or fewer if branch is short)
	const recent = branch.slice(-5);

	for (const entry of recent) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user") {
				const content = Array.isArray(msg.content) ? msg.content : [{ type: "text" as const, text: msg.content }];
				const text = content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");
				lines.push(`[User] ${text}`);
			} else if (msg.role === "assistant") {
				const content = Array.isArray(msg.content) ? msg.content : [{ type: "text" as const, text: msg.content }];
				const text = content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");
				lines.push(`[Assistant] ${text}`);
			}
		}
	}

	// Add recent decisions from ledger
	const ledger = state.getLedger();
	const decisions = ledger.getRecentDecisions(10);
	if (decisions.length > 0) {
		lines.push("\n[Tool Calls]");
		for (const d of decisions) {
			lines.push(`- ${d.toolName}: ${d.action} (${d.reason || "no reason"})`);
		}
	}

	return lines.join("\n");
}

/**
 * Parse the LLM intent-extraction response into structured intents.
 * Throws on JSON parse failure so callers can distinguish "no rules" from "bad response".
 */
function parseIntentResponse(text: string): ParsedIntent[] {
	// 尝试 JSON 解析（新格式）
	try {
		const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
		const data = JSON.parse(cleaned) as { new_intents?: Array<{ type: string; content: string }>; deprecate_intents?: Array<{ id: string; reason: string }> };

		const results: ParsedIntent[] = [];
		if (data.new_intents) {
			for (const intent of data.new_intents) {
				if (intent.content) {
					results.push({ text: intent.content, rules: [] });
				}
			}
		}
		return results;
	} catch {
		// Fallback: 按行解析（旧格式）
		const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && l !== "None");
		const results: ParsedIntent[] = [];

		for (const line of lines) {
			const parts = line.split("|").map((p) => p.trim());
			if (parts.length < 5) continue;

			const [intentText, ruleType, pattern, description, severityStr] = parts;
			if (!intentText || !ruleType || !pattern || !description) continue;
			if (!VALID_RULE_TYPES.has(ruleType)) continue;

			const severity = parseInt(severityStr, 10);
			if (isNaN(severity) || severity < 0 || severity > 3) continue;

			results.push({
				text: intentText,
				rules: [
					{
						type: ruleType as Rule["type"],
						pattern,
						description,
						severity,
					},
				],
			});
		}

		return results;
	}
}
