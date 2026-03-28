/**
 * show-sys-prompt — Display the full system prompt in the chat UI for transparency.
 *
 * - Shows the complete system prompt above the first user message.
 * - If the system prompt changes mid-conversation, shows the new version
 *   above the next user message with a separator.
 * - Purely visual — does NOT affect model behavior or conversation context.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

const ENTRY_TYPE = "sys-prompt-last";

function restoreLastPrompt(entries: SessionEntry[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === ENTRY_TYPE && typeof e.data === "string") {
			return e.data;
		}
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	let lastSystemPrompt: string | undefined;

	pi.registerMessageRenderer("sys-prompt-display", (message, { expanded }, theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		if (!content) return undefined;

		const isChange = message.details && (message.details as { changed: boolean }).changed;
		const header = isChange ? "# System Prompt (Changed)" : "# System Prompt";
		const separator = "─".repeat(60);

		const lines: string[] = [];
		lines.push(theme.fg("dim", separator));
		lines.push(theme.fg("warning", header));
		lines.push("");

		if (expanded) {
			lines.push(content);
		} else {
			const previewLines = content.split("\n").slice(0, 15);
			lines.push(...previewLines);
			const totalLines = content.split("\n").length;
			if (totalLines > 15) {
				lines.push(theme.fg("dim", `... (${totalLines - 15} more lines — expand to see full prompt)`));
			}
		}

		lines.push("");
		lines.push(theme.fg("dim", separator));

		const text = lines.join("\n");
		const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	pi.on("session_start", (_event, ctx) => {
		lastSystemPrompt = restoreLastPrompt(ctx.sessionManager.getEntries());
	});

	pi.on("input", (_event, ctx) => {
		const currentPrompt = ctx.getSystemPrompt();
		if (!currentPrompt) return { action: "continue" as const };

		const changed = lastSystemPrompt !== undefined && lastSystemPrompt !== currentPrompt;
		const isFirst = lastSystemPrompt === undefined;

		if (isFirst || changed) {
			lastSystemPrompt = currentPrompt;
			pi.appendEntry(ENTRY_TYPE, currentPrompt);
			pi.sendMessage({
				customType: "sys-prompt-display",
				content: currentPrompt,
				display: true,
				details: { changed },
			});
		}

		return { action: "continue" as const };
	});
}
