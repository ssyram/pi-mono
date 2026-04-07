/**
 * Workers — deterministic (RuleWorker) and LLM-based (SemanticWorker) compliance checkers.
 */

import { complete } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionContext, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { Ledger, Rule, Severity } from "./ledger.js";
import { Severity as SeverityEnum } from "./ledger.js";
import { log } from "./logger.js";
import { buildComplianceCheckPrompt } from "./prompts.js";

// ---------------------------------------------------------------------------
// RuleWorker — deterministic, < 1 ms
// ---------------------------------------------------------------------------

export interface RuleCheckResult {
	matched: boolean;
	severity: Severity;
	reason: string;
	/** Set when the rule's regex pattern is invalid. Callers should log a warning. */
	invalidPattern?: boolean;
}

/**
 * Deterministic check against all active rules.
 * Returns the highest-severity match, or `undefined` if nothing matched.
 * Invalid-pattern results are only returned if no real match was found.
 */
export function ruleCheck(event: ToolCallEvent, rules: Rule[]): RuleCheckResult | undefined {
	let worst: RuleCheckResult | undefined;
	let invalidPatternResult: RuleCheckResult | undefined;

	for (const rule of rules) {
		const hit = matchRule(rule, event);
		if (!hit) continue;
		if (hit.invalidPattern) {
			// Track first invalid pattern for caller warning, but don't treat as a match
			invalidPatternResult ??= hit;
			continue;
		}
		if (worst === undefined || hit.severity < worst.severity) {
			worst = hit;
		}
	}

	const result = worst ?? invalidPatternResult;
	log.info(`ruleCheck: checked ${rules.length} rule(s), highest match=${result?.matched ? `P${result.severity}` : "none"}`);
	return result;
}

function matchRule(rule: Rule, event: ToolCallEvent): RuleCheckResult | undefined {
	switch (rule.type) {
		case "protect_path":
			return matchProtectPath(rule, event);
		case "restrict_command":
			return matchRestrictCommand(rule, event);
		default:
			return undefined; // custom / require_pattern handled by SemanticWorker
	}
}

/** Maximum allowed length for a regex pattern to mitigate ReDoS. */
const MAX_PATTERN_LENGTH = 500;

/** Heuristic check for patterns with catastrophic backtracking potential (e.g. nested quantifiers). */
const DANGEROUS_PATTERN = /(\+|\*|\{)\)?(\+|\*|\{)/;

function isSafePattern(pattern: string): boolean {
	if (pattern.length > MAX_PATTERN_LENGTH) return false;
	if (DANGEROUS_PATTERN.test(pattern)) return false;
	return true;
}

function matchProtectPath(rule: Rule, event: ToolCallEvent): RuleCheckResult | undefined {
	const paths = extractPaths(event);
	if (!isSafePattern(rule.pattern)) {
		log.debug(`matchProtectPath: rejected unsafe pattern "${rule.pattern}"`);
		return {
			matched: false,
			severity: rule.severity,
			reason: `Unsafe or overly long regex pattern in protect_path rule: ${rule.pattern}`,
			invalidPattern: true,
		};
	}
	let regex: RegExp;
	try {
		regex = new RegExp(rule.pattern, "i");
	} catch {
		log.debug(`matchProtectPath: invalid regex "${rule.pattern}"`);
		return {
			matched: false,
			severity: rule.severity,
			reason: `Invalid regex pattern in protect_path rule: ${rule.pattern}`,
			invalidPattern: true,
		};
	}
	for (const p of paths) {
		log.debug(`matchProtectPath: testing "${p}" against /${rule.pattern}/i`);
		if (regex.test(p)) {
			return {
				matched: true,
				severity: rule.severity,
				reason: `Path "${p}" matches protected pattern: ${rule.description}`,
			};
		}
	}
	return undefined;
}

function matchRestrictCommand(rule: Rule, event: ToolCallEvent): RuleCheckResult | undefined {
	if (!isToolCallEventType("bash", event)) return undefined;
	if (!isSafePattern(rule.pattern)) {
		log.debug(`matchRestrictCommand: rejected unsafe pattern "${rule.pattern}"`);
		return {
			matched: false,
			severity: rule.severity,
			reason: `Unsafe or overly long regex pattern in restrict_command rule: ${rule.pattern}`,
			invalidPattern: true,
		};
	}
	let regex: RegExp;
	try {
		regex = new RegExp(rule.pattern, "i");
	} catch {
		log.debug(`matchRestrictCommand: invalid regex "${rule.pattern}"`);
		return {
			matched: false,
			severity: rule.severity,
			reason: `Invalid regex pattern in restrict_command rule: ${rule.pattern}`,
			invalidPattern: true,
		};
	}
	log.debug(`matchRestrictCommand: testing command against /${rule.pattern}/i`);
	if (regex.test(event.input.command)) {
		return {
			matched: true,
			severity: rule.severity,
			reason: `Command matches restricted pattern: ${rule.description}`,
		};
	}
	return undefined;
}

/** Extract file paths from known tool inputs. */
function extractPaths(event: ToolCallEvent): string[] {
	if (isToolCallEventType("edit", event)) return [event.input.path];
	if (isToolCallEventType("write", event)) return [event.input.path];
	if (isToolCallEventType("read", event)) return [event.input.path];
	if (isToolCallEventType("grep", event)) return event.input.path ? [event.input.path] : [];
	if (isToolCallEventType("find", event)) return event.input.path ? [event.input.path] : [];
	if (isToolCallEventType("ls", event)) return event.input.path ? [event.input.path] : [];
	return [];
}

// ---------------------------------------------------------------------------
// SemanticWorker — LLM-based, ~200-800 ms
// ---------------------------------------------------------------------------

export interface SemanticCheckResult {
	verdict: "block" | "warn" | "pass";
	reason: string;
}

const SEMANTIC_TIMEOUT_MS = 3000;
const MAX_INPUT_CHARS = 2000;

/** Truncate tool input to avoid blowing up the compliance prompt token budget. */
function truncateToolInput(input: Record<string, unknown>): Record<string, unknown> {
	const serialized = JSON.stringify(input);
	if (serialized.length <= MAX_INPUT_CHARS) return input;
	return { _truncated: serialized.slice(0, MAX_INPUT_CHARS) + "..." };
}

/**
 * Run an LLM-based compliance check.
 * Fail-open by default; fail-close (warn) when any rule has P0 severity.
 */
export async function semanticCheck(
	event: ToolCallEvent,
	ledger: Ledger,
	ctx: ExtensionContext,
	rules: Rule[],
	overrideModel?: Model<any>,
): Promise<SemanticCheckResult> {
	const hasP0 = rules.some((r) => r.severity === SeverityEnum.P0 && (r.type === "custom" || r.type === "require_pattern"));
	const failResult: SemanticCheckResult = hasP0
		? { verdict: "warn", reason: "semantic check failed/timed out with P0 rules active" }
		: { verdict: "pass", reason: "semantic check timed out or failed" };

	log.info(`semanticCheck: starting LLM call (hasP0=${hasP0}, fail-close=${hasP0 ? "warn" : "pass"})`);

	const model = overrideModel ?? ctx.model;
	if (!model) return failResult;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return failResult;
	const apiKey = auth.apiKey;

	// Truncate input before building prompt to limit token usage
	const truncatedEvent = { ...event, input: truncateToolInput(event.input) } as ToolCallEvent;
	const prompt = buildComplianceCheckPrompt(truncatedEvent, rules, ledger.getRecentDecisions(5));
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SEMANTIC_TIMEOUT_MS);

	try {
		const response = await complete(
			model,
			{
				systemPrompt: prompt.systemPrompt,
				messages: [{ role: "user", content: [{ type: "text", text: prompt.userMessage }], timestamp: Date.now() }],
			},
			{ apiKey, signal: controller.signal },
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		log.info(`semanticCheck: response length=${text.length}`);
		const result = parseSemanticResponse(text, failResult);
		log.info(`semanticCheck: parsed verdict=${result.verdict}, reason=${result.reason}`);
		return result;
	} catch (err) {
		const brief = err instanceof Error ? err.message : String(err);
		log.warn(`semanticCheck: LLM call failed — ${brief}`);
		return failResult;
	} finally {
		clearTimeout(timer);
	}
}

function parseSemanticResponse(
	text: string,
	failVerdictOnParse: SemanticCheckResult = { verdict: "pass", reason: "could not parse LLM response" },
): SemanticCheckResult {
	const candidates = [
		// Strategy 1: strip markdown fences and parse entire text as JSON
		() => text.replace(/```json\n?|```\n?/g, "").trim(),
		// Strategy 2: extract first {...} JSON object from surrounding text
		() => {
			const match = text.match(/\{[^}]*\}/);
			return match ? match[0] : "";
		},
	];

	for (const extract of candidates) {
		try {
			const json = extract();
			if (!json) continue;
			const parsed = JSON.parse(json) as { verdict?: string; reason?: string };
			const verdict = typeof parsed.verdict === "string" ? parsed.verdict.toLowerCase() : "";
			if (verdict === "block" || verdict === "warn" || verdict === "pass") {
				return { verdict, reason: parsed.reason ?? "" };
			}
		} catch {
			// try next strategy
		}
	}

	return { ...failVerdictOnParse, reason: failVerdictOnParse.reason || "could not parse LLM response" };
}

/**
 * Heuristic: does this tool call warrant an expensive semantic check?
 * True when there are rules that the RuleWorker can't evaluate deterministically.
 */
export function requiresSemanticCheck(_event: ToolCallEvent, rules: Rule[]): boolean {
	return rules.some((r) => r.type === "custom" || r.type === "require_pattern");
}
