/**
 * Edit Error Recovery Hook — detects Edit tool failures and injects recovery hints.
 *
 * Intercepts `tool_result` events where `toolName === "edit"` and `isError === true`,
 * matches the error text against known pi Edit error patterns, and appends a
 * targeted hint so the agent can self-correct immediately.
 *
 * Error patterns (from pi's edit-diff.ts):
 * - "Could not find the exact text" / "File not found"   → Read first
 * - "Found {n} occurrences" / "must be unique"            → Add context
 * - "No changes would be made" / "identical content"      → oldText === newText
 *
 * Ported from oh-my-openagent's edit-error-recovery hook, adapted to pi's
 * ToolResultEvent API (content blocks instead of flat string output).
 */

import type {
	ExtensionAPI,
	ToolResultEvent,
} from "@mariozechner/pi-coding-agent";

// ─── Error patterns & hints ──────────────────────────────────────────────────

interface ErrorPattern {
	/** Substring to match (case-insensitive) against the concatenated error text. */
	match: string;
	/** Recovery hint appended to tool result content. */
	hint: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
	{
		match: "could not find the exact text",
		hint: "The old text was not found in the file. Read the file immediately to see its ACTUAL current content, then retry with the correct old text.",
	},
	{
		match: "file not found",
		hint: "The file does not exist at the given path. Verify the path is correct (check spelling, casing, and directory).",
	},
	{
		match: "occurrences",
		hint: "The old text matched multiple locations. Include more surrounding context in oldText to make it unique.",
	},
	{
		match: "must be unique",
		hint: "The old text matched multiple locations. Include more surrounding context in oldText to make it unique.",
	},
	{
		match: "identical content",
		hint: "oldText and newText produce the same content — the edit would be a no-op. Double-check your replacement text.",
	},
	{
		match: "no changes would be made",
		hint: "oldText and newText produce the same content — the edit would be a no-op. Double-check your replacement text.",
	},
];

// ─── Shared recovery reminder (appended after the specific hint) ─────────────

const RECOVERY_REMINDER = [
	"",
	"[EDIT ERROR — IMMEDIATE ACTION REQUIRED]",
	"1. READ the file to see its actual current state.",
	"2. VERIFY your assumption about the content was correct.",
	"3. RETRY the edit with corrected parameters.",
	"Do NOT attempt another edit until you have read and verified the file.",
].join("\n");

// ─── Registration ────────────────────────────────────────────────────────────

export function registerEditErrorRecovery(pi: ExtensionAPI): void {
	pi.on("tool_result", async (event: ToolResultEvent) => {
		try {
			if (event.toolName !== "edit" || !event.isError) return undefined;

			// Concatenate all text blocks into a single string for matching
			const errorText = event.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			const errorLower = errorText.toLowerCase();

			// Find the first matching pattern
			const matched = ERROR_PATTERNS.find((p) =>
				errorLower.includes(p.match),
			);

			if (!matched) {
				// Unknown edit error — still inject generic recovery reminder
				return {
					content: [
						...event.content,
						{ type: "text" as const, text: `\n\nHint: An edit error occurred. Read the file to verify its current state before retrying.\n${RECOVERY_REMINDER}` },
					],
				};
			}

			return {
				content: [
					...event.content,
					{ type: "text" as const, text: `\n\nHint: ${matched.hint}\n${RECOVERY_REMINDER}` },
				],
			};
		} catch {
			// Hooks must never throw
			return undefined;
		}
	});
}
