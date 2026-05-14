/**
 * Impression System — pi extension that distills long tool results into
 * compact notes, storing the originals for on-demand recall.
 *
 * See README.md for full documentation.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildSessionContext, convertToLlm } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { loadConfig, resolveConfig, saveLocalConfig, shouldSkipDistillation } from "./src/config.js";
import { distillWithSameModel } from "./src/distill.js";
import { formatOriginalCall } from "./src/format-call.js";
import { getImpressionSystemAppendTemplate } from "./src/prompt-loader.js";
import { buildImpressionText, createPassthroughToolResult, createRecallToolResult, notifyImpressionSkip } from "./src/result-builders.js";
import { serializeContent } from "./src/serialize.js";
import { CONFIG_FILE_NAME, IMPRESSION_CONFIG_ENTRY_TYPE, IMPRESSION_ENTRY_TYPE, PASSTHROUGH_MODE_ENTRY_TYPE, SESSION_STATS_ENTRY_TYPE, getEntryData, getImpressionConfigData, getPassthroughModeData, getSessionStatsData, isImpressionConfigPatch, isImpressionEntry, isPassthroughModeEntry, isSessionStatsEntry } from "./src/types.js";
import type { ImpressionConfig, ImpressionDetails, ImpressionEntry, ResolvedConfig } from "./src/types.js";

const RecallImpressionParams = Type.Object({
	id: Type.String({ description: "Impression ID" }),
});

function serializeVisibleHistory(messages: ReturnType<typeof buildSessionContext>["messages"]): string {
	// convertToLlm projects AgentMessage[] into the provider-bound Message[] shape
	// (drops timestamp/provider/model/usage/stopReason metadata that the LLM never sees).
	// KNOWN GAP: this still does NOT apply the "context" event mutator chain
	// (transformContext → runner.emitContext in pi-coding-agent's agent-loop). Today
	// no known sibling plugin mutates messages via that hook, so the divergence is
	// theoretical. Tracked upstream at https://github.com/badlogic/pi-mono/issues/3953
	// — when the upstream exposes `ctx.getLlmContext()` (or `emitContext`), switch to
	// that for full fidelity.
	return convertToLlm(messages).map((m) => JSON.stringify(m)).join("\n");
}

const SkipImpressionParams = Type.Object({
	count: Type.Optional(Type.Number({ description: "Number of tool results to pass through unchanged (default 1). Capped by config. Set to 0 to cancel passthrough." })),
	justification: Type.Optional(Type.String({ description: "Why you need exact content including whitespace, indentation, and naming. Required when count > 0." })),
	estimatedChars: Type.Optional(Type.Number({ description: "Estimated characters to read. Hard limit enforced at runtime. Required when count > 0." })),
});

function formatCompactChars(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
	if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
	if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`;
	return value.toFixed(2);
}

function formatImpressionData(impressionChars: number, originalChars: number): string {
	const ratio = originalChars > 0 ? (impressionChars / originalChars) * 100 : 0;
	return `[impression:data] ${formatCompactChars(impressionChars)} / ${formatCompactChars(originalChars)} = ${ratio.toFixed(2)}%`;
}

const STATUS_KEY = "impression-data";
const DOCKER_UPDATE = "docker:update";
const DOCKER_REMOVE = "docker:remove";
const DOCKER_AVAILABLE_FLAG = "$__docker_available__";
const DOCKER_SECTION_TITLE = "Impression";
const DOCKER_SECTION_ORDER = 30;

interface DockerSection {
	id: string;
	title: string;
	order: number;
	lines: string[];
}

interface DockerRemove {
	id: string;
}

function hasDocker(): boolean {
	return (globalThis as Record<string, unknown>)[DOCKER_AVAILABLE_FLAG] === true;
}

function publishDataStatus(pi: ExtensionAPI, ctx: ExtensionContext, text: string | undefined): void {
	if (hasDocker()) {
		if (text) {
			const section: DockerSection = {
				id: STATUS_KEY,
				title: DOCKER_SECTION_TITLE,
				order: DOCKER_SECTION_ORDER,
				lines: text.split("\n"),
			};
			pi.events.emit(DOCKER_UPDATE, section);
		} else {
			const removal: DockerRemove = { id: STATUS_KEY };
			pi.events.emit(DOCKER_REMOVE, removal);
		}
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, text);
}

function parseToolNameList(input: string): string[] {
	const names: string[] = [];
	let i = 0;
	while (i < input.length) {
		while (i < input.length && (input[i] === " " || input[i] === ",")) i++;
		if (i >= input.length) break;
		const ch = input[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			const close = input.indexOf(ch, i + 1);
			if (close === -1) {
				names.push(input.slice(i + 1).trim());
				break;
			}
			const name = input.slice(i + 1, close).trim();
			if (name) names.push(name);
			i = close + 1;
		} else {
			let end = i;
			while (end < input.length && input[end] !== ",") end++;
			const name = input.slice(i, end).trim();
			if (name) names.push(name);
			i = end + 1;
		}
	}
	return names;
}

type ConfigValueKind = "boolean" | "number" | "string-array" | "distill-mode";

interface ConfigKeyDef {
	key: keyof ImpressionConfig;
	display: string;
	type: ConfigValueKind;
	/** Lower bound for numeric fields. Values below are clamped to this with a warning. Omitted fields have no lower bound. */
	min?: number;
}

const CONFIG_KEY_DEFS: ConfigKeyDef[] = [
	{ key: "enabled", display: "Enabled", type: "boolean" },
	{ key: "debug", display: "Debug", type: "boolean" },
	{ key: "showData", display: "ShowData", type: "boolean" },
	{ key: "minLength", display: "MinLength", type: "number", min: 1 },
	{ key: "maxRecallBeforePassthrough", display: "MaxRecall", type: "number", min: 0 },
	{ key: "maxPassthroughCount", display: "MaxPassthroughCount", type: "number", min: 0 },
	{ key: "distillRateFloor", display: "DistillRateFloor", type: "number", min: 0 },
	{ key: "skipDistillation", display: "SkipDistillation", type: "string-array" },
	{ key: "debug:distill-mode", display: "DebugDistillMode", type: "distill-mode" },
];

function normalizeName(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const PASSTHROUGH_OVERAGE_FACTOR = 1.5;

function getPassthroughHardLimit(cfg: ResolvedConfig): number {
	return Math.max(cfg.minLength * 10, 10240);
}

const NORMALIZED_KEY_LOOKUP = new Map<string, ConfigKeyDef>();
for (const def of CONFIG_KEY_DEFS) {
	NORMALIZED_KEY_LOOKUP.set(normalizeName(def.key), def);
	NORMALIZED_KEY_LOOKUP.set(normalizeName(def.display), def);
}

function lookupConfigKey(name: string): ConfigKeyDef | undefined {
	return NORMALIZED_KEY_LOOKUP.get(normalizeName(name));
}

function validateConfigValue(def: ConfigKeyDef, value: unknown): string | null {
	switch (def.type) {
		case "boolean":
			return typeof value === "boolean" ? null : `${def.display} must be a boolean (true / false)`;
		case "number":
			return typeof value === "number" && Number.isFinite(value) ? null : `${def.display} must be a finite number`;
		case "string-array":
			return Array.isArray(value) && value.every((x) => typeof x === "string")
				? null
				: `${def.display} must be a JSON array of strings, e.g. ["read","write"]`;
		case "distill-mode":
			return value === "first-person" || value === "third-person"
				? null
				: `${def.display} must be "first-person" or "third-person"`;
	}
}

/**
 * Fallback used when the active model's `maxTokens` is missing / 0 / NaN
 * (custom-provider misconfig). 8192 covers all current mainstream LLMs.
 */
const DISTILL_MAX_TOKENS_FALLBACK = 8192;

/** Always-on lower bound on the distill output budget (in tokens), so the model has room even on very short inputs. */
const DISTILL_MIN_TOKENS_FLOOR = 1024;

function modelOutputCap(model: { maxTokens?: number }): number {
	const v = model.maxTokens;
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DISTILL_MAX_TOKENS_FALLBACK;
}

/**
 * Compute the `max_tokens` budget for a distill call.
 *
 *   clamp( originalLength * distillRateFloor,  DISTILL_MIN_TOKENS_FLOOR,  modelOutputCap(model) )
 *
 *   - LOWER bound: at least DISTILL_MIN_TOKENS_FLOOR — model needs room even on tiny inputs.
 *   - INPUT-SCALED: distillRateFloor (default 0.02) is the per-char allowance — bigger
 *     inputs raise the budget proportionally so the digest can be substantial.
 *   - UPPER bound: never exceed model.maxTokens (or 8192 fallback) — single API
 *     calls cannot return more, and we don't want to "let the digest grow forever".
 *
 * Note: the per-char ratio is applied directly (one char ≈ one token equivalent
 * for budget purposes); the model's prompt-driven length instructions, not this
 * cap, are what actually keep the digest concise — this is just a safety ceiling.
 */
function computeDistillMaxTokens(originalLength: number, model: { maxTokens?: number }, cfg: ResolvedConfig): number {
	const cap = modelOutputCap(model);
	const scaled = Math.floor(originalLength * cfg.distillRateFloor);
	const desired = Math.max(DISTILL_MIN_TOKENS_FLOOR, scaled);
	return Math.min(desired, cap);
}

/** For numeric fields, clamp to the field's `min` if specified. Returns the (possibly clamped) value plus an optional warning string. Non-numeric fields pass through. */
function clampNumeric(def: ConfigKeyDef, value: unknown): { value: unknown; warning?: string } {
	if (def.type !== "number" || def.min === undefined) return { value };
	if (typeof value !== "number" || !Number.isFinite(value)) return { value };
	if (value < def.min) {
		return { value: def.min, warning: `${def.display}=${value} is below the minimum ${def.min}; clamped to ${def.min}.` };
	}
	return { value };
}

const IMPRESSION_HELP = [
	"/impression — view or change session config.",
	"  /impression                       Print current session config.",
	"  /impression config|print|read    Same as above.",
	"  /impression help|-h|--help|?     Show this help.",
	"  /impression on                    Shorthand for `set Enabled true`.",
	"  /impression off                   Shorthand for `set Enabled false`.",
	"  /impression load                  Re-read .pi/impression.json into the session as a patch.",
	"  /impression set [--persistent] NAME VALUE",
	"                                    Set one config field. NAME is case- and separator-insensitive",
	"                                    (Enabled, enabled, max-recall, max_recall, \"max recall\" all work).",
	"                                    VALUE is JSON; type-checked against the field.",
	"                                    --persistent also writes back to .pi/impression.json.",
	"  /impression tool1,tool2,...       Append tools to SkipDistillation for this session.",
	"Known fields: " + CONFIG_KEY_DEFS.map((d) => d.display).join(", "),
].join("\n");

function parseSetBody(body: string): { name: string; value: string } | null {
	const match = body.match(/^(?:"([^"]*)"|'([^']*)'|(\S+))\s+(.+)$/);
	if (!match) return null;
	const name = (match[1] ?? match[2] ?? match[3] ?? "").trim();
	const value = match[4].trim();
	if (!name || !value) return null;
	return { name, value };
}

export default function (pi: ExtensionAPI) {
	const impressions = new Map<string, ImpressionEntry>();
	let currentRaw: ImpressionConfig = {};
	let cfg: ResolvedConfig = resolveConfig(currentRaw);
	let cumulativeOriginalChars = 0;
	let cumulativeImpressionChars = 0;
	let passthroughRemaining = 0;
	let lastEstimatedChars = 0;

	function persistPassthroughRemaining() {
		pi.appendEntry(PASSTHROUGH_MODE_ENTRY_TYPE, { remaining: passthroughRemaining, lastEstimatedChars });
	}

	function persistSessionStats() {
		pi.appendEntry(SESSION_STATS_ENTRY_TYPE, {
			originalChars: cumulativeOriginalChars,
			impressionChars: cumulativeImpressionChars,
		});
	}

	function recordImpressionData(originalChars: number, impressionChars: number) {
		cumulativeOriginalChars += originalChars;
		cumulativeImpressionChars += impressionChars;
		persistSessionStats();
	}


	function updateShowDataStatus(ctx: ExtensionContext) {
		const text = cfg.showData ? formatImpressionData(cumulativeImpressionChars, cumulativeOriginalChars) : undefined;
		publishDataStatus(pi, ctx, text);
	}

	function updateRecallShowData(
		ctx: ExtensionContext,
		impression: ImpressionEntry,
		mode: "passthrough" | "distill",
		noteChars: number,
	) {
		const ori = impression.originalChars ?? 0;
		const shownImpressionChars = mode === "passthrough" ? ori : noteChars;
		recordImpressionData(ori, shownImpressionChars);
		if (cfg.showData) {
			ctx.ui.notify(formatImpressionData(shownImpressionChars, ori), "info");
		}
		updateShowDataStatus(ctx);
	}

	function deliverFullContent(impression: ImpressionEntry) {
		// Capture the result BEFORE mutating: createPassthroughToolResult's `content`
		// holds a reference to impression.fullContent. Reassigning impression.fullContent
		// to [] swaps the property — the captured array reference is unaffected.
		const result = createPassthroughToolResult(impression.fullContent);
		impression.fullContent = [];
		impression.fullText = "";
		impression.delivered = true;
		pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
		return result;
	}

	function newImpression(event: { toolName: string; toolCallId: string; input?: Record<string, unknown>; content: ImpressionEntry["fullContent"] }, fullText: string): ImpressionEntry {
		return {
			id: randomUUID(),
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			toolInput: event.input,
			fullContent: event.content,
			fullText,
			originalChars: fullText.length,
			recallCount: 0,
			createdAt: Date.now(),
		};
	}

	function getVisibleHistory(ctx: ExtensionContext): string {
		return serializeVisibleHistory(buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages);
	}

	function applyConfigPatch(patch: Partial<ImpressionConfig>): void {
		const safe = Array.isArray(patch.skipDistillation)
			? { ...patch, skipDistillation: [...patch.skipDistillation] }
			: patch;
		// disk-first: if appendEntry throws, in-memory cfg/currentRaw remain consistent
		// with the JSONL log, and the next session_start will replay the same state.
		pi.appendEntry(IMPRESSION_CONFIG_ENTRY_TYPE, safe);
		currentRaw = { ...currentRaw, ...safe };
		cfg = resolveConfig(currentRaw);
		registerSkipImpressionTool();
	}

	pi.on("session_start", async (_event, ctx) => {
		const loaded = loadConfig();
		currentRaw = loaded.config;
		// Surface parse errors from .pi/impression.json or the global config — file
		// load is deferred to session_start precisely so we have ctx.ui to notify here
		// (loading at module init would silently swallow errors).
		for (const w of loaded.warnings) {
			ctx.ui.notify(`[impression] ${w}`, "warning");
		}
		cumulativeOriginalChars = 0;
		cumulativeImpressionChars = 0;
		passthroughRemaining = 0;
		lastEstimatedChars = 0;
		impressions.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			const ptData = getPassthroughModeData(entry);
			if (isPassthroughModeEntry(ptData)) {
				passthroughRemaining = ptData.remaining;
				lastEstimatedChars = ptData.lastEstimatedChars ?? 0;
				continue;
			}
			const statsData = getSessionStatsData(entry);
			if (isSessionStatsEntry(statsData)) {
				cumulativeOriginalChars = statsData.originalChars;
				cumulativeImpressionChars = statsData.impressionChars;
				continue;
			}
			const cfgData = getImpressionConfigData(entry);
			if (isImpressionConfigPatch(cfgData)) {
				currentRaw = { ...currentRaw, ...cfgData };
				continue;
			}
			const data = getEntryData(entry);
			if (!isImpressionEntry(data)) continue;
			impressions.set(data.id, data);
		}
		// Validate type compatibility AND clamp out-of-range numerics on the merged
		// raw before resolving cfg. Hand-edits to .pi/impression.json (e.g. writing
		// "minLength": "abc") would otherwise propagate a string into ResolvedConfig
		// and silently break comparisons; here we delete the field and fall back to
		// the default while surfacing a warning.
		for (const def of CONFIG_KEY_DEFS) {
			const v = (currentRaw as Record<string, unknown>)[def.key];
			if (v === undefined) continue;
			const typeError = validateConfigValue(def, v);
			if (typeError) {
				ctx.ui.notify(
					`[impression] Config ${def.display}: ${typeError} (got ${JSON.stringify(v)}); ignoring this field — falling back to default.`,
					"warning",
				);
				delete (currentRaw as Record<string, unknown>)[def.key];
				continue;
			}
			if (def.type === "number") {
				const clamp = clampNumeric(def, v);
				if (clamp.warning) {
					ctx.ui.notify(`[impression] ${clamp.warning}`, "warning");
					(currentRaw as Record<string, unknown>)[def.key] = clamp.value;
				}
			}
		}
		cfg = resolveConfig(currentRaw);
		if (cfg.debugDistillMode && !cfg.debug) {
			// Each session_start re-evaluates the file as source of truth, so if the
			// file itself has `debug:distill-mode` set without `debug: true`, this
			// warning will fire once per session — by design.
			ctx.ui.notify('[impression] Ignoring "debug:distill-mode" because "debug" is not enabled.', "warning");
			delete currentRaw["debug:distill-mode"];
			cfg.debugDistillMode = undefined;
		}
		registerSkipImpressionTool();
		updateShowDataStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n\n${getImpressionSystemAppendTemplate()}`,
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "recall_impression" || event.toolName === "skip_impression") return;
		if (!cfg.enabled) return;
		if (passthroughRemaining > 0) {
			const fullText = serializeContent(event.content);
			const maxChars = getPassthroughHardLimit(cfg);
			const overEstimate = lastEstimatedChars > 0 && fullText.length > lastEstimatedChars * PASSTHROUGH_OVERAGE_FACTOR;
			const overMax = fullText.length > maxChars;
			if (overEstimate || overMax) {
				const reason = overMax
					? `actual content ${fullText.length} chars exceeds hard limit of ${maxChars}`
					: `actual content ${fullText.length} chars exceeds ${PASSTHROUGH_OVERAGE_FACTOR}x estimated ${lastEstimatedChars}`;
				const impression = newImpression(event, fullText);
				// disk-first: append impression before consuming a passthrough slot.
				// If appendEntry throws, the rejection notice would reference an id
				// with no JSONL backing (and no recovery on resume); decrementing first
				// would also burn the slot for nothing.
				impressions.set(impression.id, impression);
				pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
				passthroughRemaining--;
				persistPassthroughRemaining();
				ctx.ui.notify(`[impression] Passthrough rejected: ${reason}.`, "warning");
				return {
					content: [{ type: "text", text: `Passthrough stored but content too large (${reason}). Impression ID: ${impression.id}. Options: (1) skip_impression again with a smaller range, (2) skip_impression count=0 to cancel and let distillation handle it, (3) save_impression to a file and use read/bash to inspect.` }],
				};
			} else {
				passthroughRemaining--;
				persistPassthroughRemaining();
				const chars = fullText.length;
				recordImpressionData(chars, chars);
				if (cfg.showData) {
					ctx.ui.notify(formatImpressionData(chars, chars), "info");
				}
				updateShowDataStatus(ctx);
				ctx.ui.notify(`[impression] Passthrough mode (${passthroughRemaining} remaining)`, "info");
				return;
			}
		}
		if (shouldSkipDistillation(event.toolName, cfg)) {
			ctx.ui.notify(`[impression] Skipped distillation for "${event.toolName}" (configured in ${CONFIG_FILE_NAME})`, "info");
			return;
		}
		if (event.isError) {
			notifyImpressionSkip(ctx, "tool result is an error");
			return;
		}

		const fullText = serializeContent(event.content);
		if (fullText.length < cfg.minLength) {
			ctx.ui.notify(`[impression] Skipped: content length ${fullText.length} is below threshold of ${cfg.minLength}`, "info");
			return;
		}

		const model = ctx.model;
		if (!model) {
			notifyImpressionSkip(ctx, "no active model selected");
			return { content: event.content };
		}
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			notifyImpressionSkip(ctx, `missing auth for ${model.provider}/${model.id}: ${auth.error}`);
			return { content: event.content };
		}
		const visibleHistory = getVisibleHistory(ctx);
		const originalSystemPrompt = ctx.getSystemPrompt();
		ctx.ui.setStatus("impression-distill", `[impression] Distilling ${fullText.length} chars with ${model.provider}/${model.id}...`);
		let distillation: { passthrough: boolean; note: string; thinking?: string };
		try {
			distillation = await distillWithSameModel(
				model,
				cfg.debugDistillMode,
				{ apiKey: auth.apiKey, headers: auth.headers },
				event.toolName,
				event.content,
				visibleHistory,
				originalSystemPrompt,
				computeDistillMaxTokens(fullText.length, model, cfg),
				ctx.signal,
				cfg.debug ? (version) => ctx.ui.notify(`[impression:debug] Using prompt version: ${version}`, "info") : undefined,
			);
		} finally {
			ctx.ui.setStatus("impression-distill", undefined);
		}

		const ptLevel = cfg.debug ? "warning" : "info";
		if (distillation.passthrough) {
			if (cfg.debug && distillation.thinking) {
				ctx.ui.notify(`[impression] Passthrough thinking: ${distillation.thinking}`, "warning");
			}
			recordImpressionData(fullText.length, fullText.length);
			if (cfg.showData) {
				ctx.ui.notify(formatImpressionData(fullText.length, fullText.length), "info");
			}
			updateShowDataStatus(ctx);
			ctx.ui.notify(`[impression] Passthrough for ${event.toolName}`, ptLevel);
			return { content: event.content };
		}

		if (cfg.debug && distillation.thinking) {
			ctx.ui.notify(`[impression] Thinking detected (${distillation.thinking.length} chars): ${distillation.thinking.slice(0, 300)}`, "warning");
		}

		const impressionChars = distillation.note.length;
		recordImpressionData(fullText.length, impressionChars);
		if (cfg.showData) {
			ctx.ui.notify(formatImpressionData(impressionChars, fullText.length), "info");
		}
		updateShowDataStatus(ctx);

		const impression = newImpression(event, fullText);
		impressions.set(impression.id, impression);
		pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);

		return {
			content: [{ type: "text", text: buildImpressionText(impression.id, distillation.note) }],
			details: { thinking: distillation.thinking } satisfies ImpressionDetails,
		};
	});

	pi.registerTool({
		name: "recall_impression",
		label: "Recall Impression",
		description:
			"Recall a stored impression by ID. Returns distilled notes with updated context.",
		parameters: RecallImpressionParams,
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const entry = impressions.get(args.id);
			const title = theme.fg("toolTitle", theme.bold("Recall Impression"));
			const idDisplay = theme.fg("muted", args.id);
			const line1 = `${title} ${idDisplay}`;
			if (entry) {
				const originalCall = formatOriginalCall(entry, theme);
				text.setText(`${line1}\n${theme.fg("muted", "> ")}${originalCall}`);
			} else {
				text.setText(line1);
			}
			return text;
		},
		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const contentText = result.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			const rawDetails = result.details;
			const thinking = rawDetails && typeof rawDetails === "object" && typeof (rawDetails as Record<string, unknown>).thinking === "string"
				? ((rawDetails as Record<string, unknown>).thinking as string)
				: undefined;
			if (thinking) {
				const thinkingLabel = theme.fg("muted", "[thinking] ");
				const thinkingText = theme.fg("muted", thinking.replaceAll("\n", " ").slice(0, 200));
				text.setText(`${contentText}\n${thinkingLabel}${thinkingText}`);
			} else {
				text.setText(contentText);
			}
			return text;
		},
		async execute(_toolCallId, args, signal, _onUpdate, ctx) {
			const impression = impressions.get(args.id);
			if (!impression) {
				throw new Error(`Impression not found: ${args.id}`);
			}
			if (impression.delivered) {
				throw new Error(`Impression ${args.id} has already been fully delivered to your context. The full content is already in your message history; re-recall it from there, or use the standard write tool to persist it.`);
			}

			if (passthroughRemaining > 0) {
				const maxChars = getPassthroughHardLimit(cfg);
				const contentChars = impression.fullText.length;
				const overEstimate = lastEstimatedChars > 0 && contentChars > lastEstimatedChars * PASSTHROUGH_OVERAGE_FACTOR;
				const overMax = contentChars > maxChars;
				if (overEstimate || overMax) {
					passthroughRemaining--;
					persistPassthroughRemaining();
					const reason = overMax
						? `content ${contentChars} chars exceeds hard limit of ${maxChars}`
						: `content ${contentChars} chars exceeds ${PASSTHROUGH_OVERAGE_FACTOR}x estimated ${lastEstimatedChars}`;
					ctx.ui.notify(`[impression] Recall passthrough rejected: ${reason}.`, "warning");
					return {
						content: [{ type: "text", text: `Recall passthrough rejected: content too large (${reason}). Options: (1) skip_impression count=0 to cancel and recall for distilled notes, (2) save_impression to a file and use read/bash to inspect.` }],
						details: undefined,
					};
				} else {
					passthroughRemaining--;
					persistPassthroughRemaining();
					ctx.ui.notify(`[impression] Passthrough mode (${passthroughRemaining} remaining)`, "info");
					updateRecallShowData(ctx, impression, "passthrough", 0);
					return deliverFullContent(impression);
				}
			}

			if (impression.recallCount >= cfg.maxRecall) {
				updateRecallShowData(ctx, impression, "passthrough", 0);
				return deliverFullContent(impression);
			}

			const model = ctx.model;
			if (!model) {
				notifyImpressionSkip(ctx, "no active model selected");
				updateRecallShowData(ctx, impression, "passthrough", 0);
				return deliverFullContent(impression);
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				notifyImpressionSkip(ctx, `missing auth for ${model.provider}/${model.id}: ${auth.error}`);
				impression.recallCount = cfg.maxRecall;
				updateRecallShowData(ctx, impression, "passthrough", 0);
				return deliverFullContent(impression);
			}
			const visibleHistory = getVisibleHistory(ctx);
			const originalSystemPrompt = ctx.getSystemPrompt();
			ctx.ui.setStatus("impression-distill", `[impression] Re-distilling ${impression.fullText.length} chars with ${model.provider}/${model.id}...`);
			let distillation: { passthrough: boolean; note: string; thinking?: string };
			try {
				distillation = await distillWithSameModel(
					model,
					cfg.debugDistillMode,
					{ apiKey: auth.apiKey, headers: auth.headers },
					impression.toolName,
					impression.fullContent,
					visibleHistory,
					originalSystemPrompt,
					computeDistillMaxTokens(impression.fullText.length, model, cfg),
					signal,
					cfg.debug ? (version) => ctx.ui.notify(`[impression:debug] Using prompt version: ${version}`, "info") : undefined,
				);
			} finally {
				ctx.ui.setStatus("impression-distill", undefined);
			}

			const ptLevel = cfg.debug ? "warning" : "info";
			if (distillation.passthrough) {
				if (distillation.thinking) {
					ctx.ui.notify(`[impression] Recall passthrough thinking: ${distillation.thinking}`, ptLevel);
				}
				impression.recallCount = cfg.maxRecall;
				updateRecallShowData(ctx, impression, "passthrough", distillation.note.length);
				return deliverFullContent(impression);
			}

			impression.recallCount += 1;
			if (impression.recallCount >= cfg.maxRecall) {
				updateRecallShowData(ctx, impression, "passthrough", distillation.note.length);
				return deliverFullContent(impression);
			}

			pi.appendEntry(IMPRESSION_ENTRY_TYPE, impression);
			updateRecallShowData(ctx, impression, "distill", distillation.note.length);
			return createRecallToolResult(impression.id, distillation.note, { thinking: distillation.thinking });
		},
	});

	// Re-registering by name overwrites the prior entry in extension.tools (loader.ts:204)
	// and triggers refreshTools(). We rely on this to keep the LLM-visible description
	// (which embeds cfg.maxPassthroughCount and cfg.minLength*10) in sync with cfg.
	function registerSkipImpressionTool() {
		pi.registerTool({
		name: "skip_impression",
		label: "Skip Impression",
		description:
			"Skip distillation for the next N tool results (max " + cfg.maxPassthroughCount + "). Each call overwrites previous skip state. count=0 cancels passthrough. When count > 0: requires `justification` and `estimatedChars` (hard limit: " + getPassthroughHardLimit(cfg) + "). Actual content exceeding limit or " + PASSTHROUGH_OVERAGE_FACTOR + "x estimate is rejected.",
		promptSnippet: "skip_impression: Skip distillation for next N results (max " + cfg.maxPassthroughCount + "). Each call overwrites previous state. count=0 cancels. When count > 0: { count, justification, estimatedChars } all required. justification: why exact whitespace matters. estimatedChars hard limit: " + getPassthroughHardLimit(cfg) + ". Actual content over limit or " + PASSTHROUGH_OVERAGE_FACTOR + "x estimate is rejected and stored — use save_impression to inspect. NEVER to \"understand\" or \"analyze\" code.",
		parameters: SkipImpressionParams,
		renderCall(args, theme) {
			const title = theme.fg("toolTitle", theme.bold("Skip Impression"));
			const count = args.count ?? 1;
			if (count === 0) return new Text(`${title} ${theme.fg("warning", "cancel")}`, 0, 0);
			const justification = args.justification
				? theme.fg("muted", ` "${args.justification.length > 80 ? args.justification.slice(0, 77) + "..." : args.justification}"`)
				: "";
			const estimate = args.estimatedChars != null ? theme.fg("accent", ` ~${args.estimatedChars} chars`) : "";
			return new Text(`${title} count=${count}${estimate}${justification}`, 0, 0);
		},
		async execute(_toolCallId, args, _signal, _onUpdate, _ctx) {
			const requested = args.count ?? 1;
			if (requested === 0) {
				passthroughRemaining = 0;
				lastEstimatedChars = 0;
				persistPassthroughRemaining();
				return {
					content: [{ type: "text", text: "Passthrough cancelled." }],
					details: undefined,
				};
			}
			if (!args.justification) {
				return {
					content: [{ type: "text", text: "Rejected: justification is required when count > 0." }],
					details: undefined,
				};
			}
			if (args.estimatedChars == null) {
				return {
					content: [{ type: "text", text: "Rejected: estimatedChars is required when count > 0." }],
					details: undefined,
				};
			}
			if (!Number.isFinite(args.estimatedChars) || args.estimatedChars <= 0) {
				return {
					content: [{ type: "text", text: `Rejected: estimatedChars must be a positive finite number. Got ${args.estimatedChars}.` }],
					details: undefined,
				};
			}
			const maxChars = getPassthroughHardLimit(cfg);
			if (args.estimatedChars > maxChars) {
				return {
					content: [{ type: "text", text: `Rejected: estimatedChars ${args.estimatedChars} exceeds hard limit of ${maxChars}. Options: (1) skip_impression again with a smaller range and estimatedChars, (2) do not skip and rely on distilled notes.` }],
					details: undefined,
				};
			}
			passthroughRemaining = Math.min(requested, cfg.maxPassthroughCount);
			lastEstimatedChars = args.estimatedChars;
			persistPassthroughRemaining();
			return {
				content: [{ type: "text", text: `Skipping distillation for next ${passthroughRemaining} tool result(s).` }],
				details: undefined,
			};
		},
		});
	}
	registerSkipImpressionTool();

	const SaveImpressionParams = Type.Object({
		id: Type.String({ description: "Impression ID to save." }),
	});

	pi.registerTool({
		name: "save_impression",
		label: "Save Impression",
		description: "Save the original content of an impression to .pi/impression-cache/<id>.txt for inspection with read/bash/python. Useful for long non-file content (e.g., command output) or file content that may have changed or been deleted since.",
		parameters: SaveImpressionParams,
		async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
			const impression = impressions.get(args.id);
			if (!impression) {
				throw new Error(`Impression not found: ${args.id}`);
			}
			if (impression.delivered) {
				throw new Error(`Impression ${args.id}'s full content was already delivered to the LLM and discarded from internal state. Save unavailable; the content is in your context — write it via the standard write tool instead.`);
			}
			if (impression.toolName === "read" && impression.toolInput) {
				const candidate = impression.toolInput.file_path ?? impression.toolInput.path;
				const originalPath = typeof candidate === "string" ? candidate : undefined;
				if (originalPath && existsSync(originalPath)) {
					try {
						const currentContent = readFileSync(originalPath, "utf-8");
						if (currentContent === impression.fullText || impression.fullText.startsWith(currentContent) || currentContent.includes(impression.fullText)) {
							ctx.ui.notify(`[impression] Warning: file ${originalPath} still exists and appears unmodified. Consider reading it directly instead.`, "warning");
						}
					} catch {
						// file unreadable, proceed with save
					}
				}
			}
			const cacheDir = join(process.cwd(), ".pi", "impression-cache");
			const outPath = join(cacheDir, `${impression.id}.txt`);
			mkdirSync(cacheDir, { recursive: true });
			writeFileSync(outPath, impression.fullText, "utf-8");
			return {
				content: [{ type: "text", text: `Saved ${impression.fullText.length} chars to ${outPath}. Use read/bash to inspect.` }],
				details: undefined,
			};
		},
	});

	pi.registerCommand("impression", {
		description: "View or change session config. Try /impression help for full usage.",
		async handler(args, ctx) {
			const trimmed = args.trim();
			const lower = trimmed.toLowerCase();
			if (!lower || lower === "config" || lower === "print" || lower === "read") {
				ctx.ui.notify(`[impression] Session config:\n${JSON.stringify(cfg, null, 2)}`, "info");
				return;
			}
			if (lower === "help" || lower === "-h" || lower === "--help" || lower === "?") {
				ctx.ui.notify(IMPRESSION_HELP, "info");
				return;
			}
			if (lower === "on") {
				applyConfigPatch({ enabled: true });
				ctx.ui.notify("[impression] Enabled.", "info");
				return;
			}
			if (lower === "off") {
				applyConfigPatch({ enabled: false });
				ctx.ui.notify("[impression] Disabled — all tool results pass through without distillation.", "info");
				return;
			}
			if (lower === "load") {
				const loaded = loadConfig();
				for (const w of loaded.warnings) {
					ctx.ui.notify(`[impression] ${w}`, "warning");
				}
				if (Object.keys(loaded.config).length === 0) {
					ctx.ui.notify(`[impression] ${CONFIG_FILE_NAME} is empty or missing — nothing to load.`, "warning");
					return;
				}
				// Validate type compatibility AND clamp out-of-range numerics on the
				// file payload before patching. Type-incompatible fields are dropped
				// from the local clone so applyConfigPatch (and resolveConfig) never
				// see them.
				const clamped: Partial<ImpressionConfig> = { ...loaded.config };
				for (const def of CONFIG_KEY_DEFS) {
					const v = (clamped as Record<string, unknown>)[def.key];
					if (v === undefined) continue;
					const typeError = validateConfigValue(def, v);
					if (typeError) {
						ctx.ui.notify(
							`[impression] Config ${def.display}: ${typeError} (got ${JSON.stringify(v)}); ignoring this field — falling back to default.`,
							"warning",
						);
						delete (clamped as Record<string, unknown>)[def.key];
						continue;
					}
					if (def.type === "number") {
						const c = clampNumeric(def, v);
						if (c.warning) {
							ctx.ui.notify(`[impression] ${c.warning}`, "warning");
							(clamped as Record<string, unknown>)[def.key] = c.value;
						}
					}
				}
				applyConfigPatch(clamped);
				ctx.ui.notify(`[impression] Loaded ${CONFIG_FILE_NAME} into session.`, "info");
				return;
			}
			if (lower === "set" || lower.startsWith("set ")) {
				let body = trimmed.slice(3).trim();
				let persistent = false;
				if (body.toLowerCase() === "--persistent" || body.toLowerCase().startsWith("--persistent ")) {
					persistent = true;
					body = body.slice("--persistent".length).trim();
				}
				const parsed = parseSetBody(body);
				if (!parsed) {
					ctx.ui.notify('[impression] Usage: /impression set [--persistent] NAME VALUE  (VALUE is JSON; e.g. true / 5000 / ["a","b"])', "error");
					return;
				}
				const def = lookupConfigKey(parsed.name);
				if (!def) {
					ctx.ui.notify(
						`[impression] Unknown config field: ${parsed.name}. Known: ${CONFIG_KEY_DEFS.map((d) => d.display).join(", ")}.`,
						"error",
					);
					return;
				}
				let value: unknown;
				try {
					value = JSON.parse(parsed.value);
				} catch {
					value = parsed.value;
				}
				const typeError = validateConfigValue(def, value);
				if (typeError) {
					ctx.ui.notify(`[impression] ${typeError}. Got ${JSON.stringify(parsed.value)}.`, "error");
					return;
				}
				const clamp = clampNumeric(def, value);
				if (clamp.warning) {
					ctx.ui.notify(`[impression] ${clamp.warning}`, "warning");
				}
				const patch = { [def.key]: clamp.value } as Partial<ImpressionConfig>;
				applyConfigPatch(patch);
				if (persistent) {
					saveLocalConfig(patch).catch((err) => {
						if (!ctx.hasUI) return;
						const msg = err instanceof Error ? err.message : String(err);
						ctx.ui.notify(`[impression] Failed to persist to .pi/${CONFIG_FILE_NAME}: ${msg}`, "warning");
					});
				}
				ctx.ui.notify(
					`[impression] Set ${def.display} = ${JSON.stringify(clamp.value)}${persistent ? ` (persisting to .pi/${CONFIG_FILE_NAME} in background)` : ""}.`,
					"info",
				);
				return;
			}
			if (trimmed.includes(",") || trimmed.includes('"') || trimmed.includes("'")) {
				const names = parseToolNameList(trimmed);
				if (names.length === 0) {
					ctx.ui.notify(`[impression] Could not parse tool names from: ${trimmed}\n${IMPRESSION_HELP}`, "warning");
					return;
				}
				const existing = new Set(cfg.skipDistillation);
				for (const name of names) existing.add(name);
				const merged = [...existing];
				applyConfigPatch({ skipDistillation: merged });
				ctx.ui.notify(`[impression] SkipDistillation updated: ${merged.join(", ")}`, "info");
				return;
			}
			ctx.ui.notify(`[impression] Unknown subcommand: ${trimmed}\n${IMPRESSION_HELP}`, "warning");
		},
	});
}
