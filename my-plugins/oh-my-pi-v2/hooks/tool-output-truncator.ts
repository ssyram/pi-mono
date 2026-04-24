/**
 * Tool Output Truncator Hook — prevents oversized tool results from
 * blowing up the context window.
 */

import type {
	ExtensionAPI,
	ToolResultEvent,
} from "@mariozechner/pi-coding-agent";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Maximum total characters across all text blocks before truncation kicks in. ~12.5K tokens. */
const MAX_OUTPUT_CHARS = 50_000;

// ─── Registration ────────────────────────────────────────────────────────────

export function registerToolOutputTruncator(pi: ExtensionAPI): void {
	pi.on("tool_result", async (event: ToolResultEvent) => {
		try {
			// Quick check: sum up all text content
			let totalChars = 0;
			for (const block of event.content) {
				if (block.type === "text") {
					totalChars += block.text.length;
				}
			}

			if (totalChars <= MAX_OUTPUT_CHARS) return undefined;

			// Truncate text blocks proportionally, preserving non-text blocks
			let remaining = MAX_OUTPUT_CHARS;
			const truncated = event.content.map((block) => {
				if (block.type !== "text") return block;

				if (remaining <= 0) {
					return { type: "text" as const, text: "[truncated]" };
				}

				const slice = block.text.slice(0, remaining);
				remaining -= slice.length;

				if (slice.length < block.text.length) {
					return {
						type: "text" as const,
						text: `${slice}\n\n[Output truncated: ${block.text.length.toLocaleString()} chars -> ${slice.length.toLocaleString()} chars. Total output was ${totalChars.toLocaleString()} chars, limit is ${MAX_OUTPUT_CHARS.toLocaleString()}.]`,
					};
				}

				return block;
			});

			return { content: truncated };
		} catch (err) {
			console.error(`[oh-my-pi truncator] Failed to truncate tool output: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	});
}
