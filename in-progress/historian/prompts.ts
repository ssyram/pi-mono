/**
 * LLM prompt builders for the historian extension.
 * Test modification to trigger historian guard.
 */

import type { ToolCallEvent } from "@mariozechner/pi-coding-agent";
import type { Rule, Decision } from "./ledger.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface PromptMessages {
	systemPrompt: string;
	userMessage: string;
}

// ---------------------------------------------------------------------------
// Intent extraction
// ---------------------------------------------------------------------------

const INTENT_EXTRACTION_SYSTEM = `You are an intent tracking system for a coding agent. Analyze the user's new input in the context of existing session intents.

Your job: decide if new intents should be added, existing intents should be deprecated, or supplemented.

Output a JSON object:
{
  "new_intents": [
    {"type": "new" | "supplement", "content": "the intent text"}
  ],
  "deprecate_intents": [
    {"id": "intent-X", "reason": "why this intent is no longer relevant"}
  ]
}

Rules:
- "new": a completely new intent not covered by existing ones
- "supplement": additional detail/clarification for existing intents
- Only deprecate if user explicitly contradicts or cancels a previous intent
- If no changes needed, return empty arrays
- **IMPORTANT**: When analyzing system prompts or initial context, extract any constraints, restrictions, or rules as intents (e.g., "don't modify X", "only use Y", "must include Z")

Be conservative: don't invent intents the user didn't express, but DO extract explicit constraints from system prompts.`;

/**
 * Build messages that ask the LLM to extract actionable intents / rules
 * from a user message.
 */
export function buildIntentExtractionPrompt(
	userInput: string,
	existingIntents: readonly { id: string; text: string }[],
): PromptMessages {
	const intentList = existingIntents.length > 0
		? existingIntents.map((i) => `[${i.id}] ${i.text}`).join("\n")
		: "(no existing intents)";

	return {
		systemPrompt: INTENT_EXTRACTION_SYSTEM,
		userMessage: `## Existing Session Intents
${intentList}

## New User Input
${userInput.slice(0, 2000)}

Analyze and output JSON.`,
	};
}

// ---------------------------------------------------------------------------
// Compliance check
// ---------------------------------------------------------------------------

const COMPLIANCE_CHECK_SYSTEM = `You are a compliance checker for a coding agent. Your job is to determine whether a tool call violates any of the user's stated rules.

## Severity → Verdict Mapping
- P0 (severity 0) → "block": Critical violation, must be blocked.
- P1 (severity 1) → "block": High-severity violation, should be blocked.
- P2 (severity 2) → "warn": Medium-severity, warn the user but allow.
- P3 (severity 3) → "pass": Low-severity, log only — do not block or warn.

## Output Format
Respond with ONLY a JSON object (no markdown fences, no explanation):
{"verdict": "block" | "warn" | "pass", "reason": "short explanation"}

## Notes
- Tool call arguments may be truncated (shown as \`_truncated: "..."\`) for token efficiency. Base your judgment on the available information; if truncation prevents assessment, default to "pass".

## Examples

Rules: [{"type":"protect_path","pattern":"\\.env$","description":"Do not modify .env files","severity":0}]
Tool call: edit tool, path ".env"
Response: {"verdict":"block","reason":"Editing .env violates P0 rule: Do not modify .env files"}

Rules: [{"type":"require_pattern","pattern":"describe\\(","description":"New test files must use describe blocks","severity":2}]
Tool call: write tool, path "src/utils.ts" (not a test file)
Response: {"verdict":"pass","reason":"Rule about test describe blocks does not apply to non-test file src/utils.ts"}

Rules: [{"type":"restrict_command","pattern":"git push --force","description":"Do not force push","severity":1}]
Tool call: bash tool, command "git push --force origin main"
Response: {"verdict":"block","reason":"Force push violates P1 rule: Do not force push"}

Rules: [{"type":"custom","pattern":"requestId","description":"All API responses must include requestId field","severity":2}]
Tool call: write tool, path "src/api/handler.ts", content with API response object
Response: {"verdict":"warn","reason":"API response handler should include requestId field per P2 rule"}`;

/**
 * Build messages for semantic compliance checking of a single tool call.
 */
export function buildComplianceCheckPrompt(
	toolEvent: ToolCallEvent,
	rules: Rule[],
	recentDecisions: readonly Decision[],
): PromptMessages {
	// Build structured rules section
	const rulesJson = rules.map((r) => ({
		type: r.type,
		pattern: r.pattern,
		description: r.description,
		severity: r.severity,
	}));

	const parts: string[] = [];

	parts.push("## Active Rules");
	parts.push("```json");
	parts.push(JSON.stringify(rulesJson, null, 2));
	parts.push("```");

	if (recentDecisions.length > 0) {
		parts.push("");
		parts.push("## Recent Decisions (for consistency)");
		parts.push("Use these to maintain consistent verdicts — avoid contradicting previous judgments on similar operations.");
		for (const d of recentDecisions) {
			parts.push(`- ${d.toolName}: ${d.action}${d.reason ? ` (${d.reason})` : ""}`);
		}
	}

	parts.push("");
	parts.push("## Tool Call Under Review");
	parts.push(`- Tool: ${toolEvent.toolName}`);
	parts.push(`- Arguments: ${JSON.stringify(toolEvent.input, null, 2)}`);

	return {
		systemPrompt: COMPLIANCE_CHECK_SYSTEM,
		userMessage: parts.join("\n"),
	};
}
