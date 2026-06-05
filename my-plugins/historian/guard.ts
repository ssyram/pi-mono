/**
 * Guard — fast LLM gate check for tool calls using a cheap model.
 *
 * Remembers only the LAST warned call. If the agent retries the exact same
 * call, it auto-passes (and the memory is cleared). Any other let-go also
 * clears the memory, so continued violations keep getting warned.
 */

import { complete } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionContext, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import type { Ledger } from "./ledger.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardResult {
	action: "pass" | "warn";
	reason?: string;
}

// ---------------------------------------------------------------------------
// Last-warned slot (single item, not a set)
// ---------------------------------------------------------------------------

let lastWarned: string | null = null;

/** Reset the last-warned slot (call on session_start). */
export function clearLastWarned(): void {
	lastWarned = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fast gate check using a cheap model (haiku/nano).
 * Returns "warn" at most once per unique tool call — subsequent identical calls auto-pass.
 *
 * @param event - the tool call to check
 * @param ctx - extension context (for getBranch to get last assistant message)
 * @param ledger - for current intents/rules
 * @param guardModel - the cheap model to use
 * @param experienceSummary - formatted experience text (from experience module)
 */
export async function guardCheck(
	event: ToolCallEvent,
	ctx: ExtensionContext,
	ledger: Ledger,
	guardModel: Model<any>,
	experienceSummary: string,
): Promise<GuardResult> {
	const key = hashKey(`${event.toolName}:${JSON.stringify(event.input)}`);

	// Same call as last warned — auto-pass and clear memory
	if (key === lastWarned) {
		lastWarned = null;
		log.info(`GUARD BYPASS | ${event.toolName} [${key}] (retry of last warned)`);
		return { action: "pass" };
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(guardModel);
	if (!auth.ok || !auth.apiKey) {
		log.warn("guard: no API key for guard model — pass");
		return { action: "pass" };
	}
	const apiKey = auth.apiKey;

	const intentsText = formatIntents(ledger);
	const lastAssistant = getLastAssistantText(ctx).slice(0, 2000);
	const inputJson = JSON.stringify(event.input);
	const truncatedInput = inputJson.length > 1500 ? inputJson.slice(0, 1500) + "..." : inputJson;

	const systemPrompt = [
		"You are a simple compliance gate. Check if the tool call clearly violates the user's stated intents.",
		"",
		"## User Intents",
		intentsText,
		"",
		"## Experience Notes",
		experienceSummary || "None yet.",
		"",
		"## Rules",
		"- Default: PASS. Only warn if the tool call CLEARLY and DIRECTLY violates a stated intent.",
		"- When uncertain, PASS.",
		'- Respond with ONLY a JSON object: {"action":"pass"} or {"action":"warn","reason":"brief reason"}',
	].join("\n");

	const userMessage = [
		"## Agent's Reasoning",
		lastAssistant || "(no recent reasoning)",
		"",
		"## Tool Call",
		`Tool: ${event.toolName}`,
		`Arguments: ${truncatedInput}`,
	].join("\n");

	const controller = new AbortController();

	try {
		const response = await complete(
			guardModel,
			{
				systemPrompt,
				messages: [{ role: "user", content: [{ type: "text", text: userMessage }], timestamp: Date.now() }],
			},
			{ apiKey, signal: controller.signal },
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		log.info(`guard: response length=${text.length}`);
		const result = parseGuardResponse(text);
		log.info(`guard: parsed action=${result.action}${result.reason ? `, reason=${result.reason}` : ""}`);

		if (result.action === "warn") {
			// Remember this call — next identical call will auto-pass
			lastWarned = key;
		} else {
			// Pass → clear memory (continued violations keep getting warned)
			lastWarned = null;
		}

		return result;
	} catch (err) {
		const brief = err instanceof Error ? err.message : String(err);
		log.warn(`guard: LLM call failed — ${brief}`);
		// Fail-open
		return { action: "pass" };
	} finally {
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple djb2 hash for dedup keys */
function hashKey(str: string): string {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
	}
	return hash.toString(36);
}

/** Format intents for guard prompt */
function formatIntents(ledger: Ledger): string {
	const intents = ledger.getIntents();
	if (intents.length === 0) return "No active intents.";
	return intents.map((i) => `- "${i.text}"`).join("\n");
}

/** Extract the most recent assistant text from the session branch. */
function getLastAssistantText(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		if (entry.message.role !== "assistant") continue;
		return entry.message.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
	}
	return "";
}

/** Parse guard LLM response — fail-open on parse error. */
function parseGuardResponse(text: string): GuardResult {
	const candidates = [
		// Strategy 1: strip markdown fences and parse entire text as JSON
		() => text.replace(/```json\n?|```\n?/g, "").trim(),
		// Strategy 2: extract first {...} JSON object (non-greedy)
		() => {
			const match = text.match(/\{[\s\S]*?\}/);
			return match ? match[0] : "";
		},
	];

	for (const extract of candidates) {
		try {
			const json = extract();
			if (!json) continue;
			const parsed = JSON.parse(json) as { action?: string; reason?: string };
			const action = typeof parsed.action === "string" ? parsed.action.toLowerCase() : "";
			if (action === "warn") {
				return { action: "warn", reason: parsed.reason ?? "" };
			}
			if (action === "pass") {
				return { action: "pass" };
			}
		} catch {
			// try next strategy
		}
	}

	// Fail-open: default pass
	return { action: "pass" };
}
