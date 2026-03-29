/**
 * show-sys-prompt — Display the full system prompt in the chat UI for transparency,
 * and show a real-time token breakdown of context composition in the footer status line.
 *
 * - Shows the complete system prompt above the first user message.
 * - If the system prompt changes mid-conversation, shows the new version
 *   above the next user message with a separator.
 * - Displays per-role token estimates in the footer: sys:XXk usr:XXk ast:XXk tool:XXk ...
 * - Updates the breakdown before every LLM call and after each turn/compaction.
 * - Purely visual — does NOT affect model behavior or conversation context.
 */
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Box, Text } from "@mariozechner/pi-tui";

const ENTRY_TYPE = "sys-prompt-last";
const STATUS_KEY = "ctx-tokens";

function restoreLastPrompt(entries: SessionEntry[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === ENTRY_TYPE && typeof e.data === "string") {
			return e.data;
		}
	}
	return undefined;
}

/** Estimate token count for a string using chars/4 heuristic. */
function estimateStringTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Estimate chars for user/toolResult content (string or content blocks). */
function estimateContentChars(content: string | readonly { type: string; text?: string }[]): number {
	if (typeof content === "string") return content.length;
	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) chars += block.text.length;
		else if (block.type === "image") chars += 4800;
	}
	return chars;
}

/** Estimate token count for a single AgentMessage (chars/4 heuristic). */
function estimateMessageTokens(message: AgentMessage): number {
	if (!message || typeof message !== "object" || !("role" in message)) return 0;
	let chars = 0;
	const msg = message as Record<string, unknown>;
	switch (message.role) {
		case "user":
		case "toolResult":
		case "custom":
			chars = estimateContentChars(message.content as string | { type: string; text?: string }[]);
			break;
		case "assistant": {
			for (const block of message.content) {
				if (block.type === "text") chars += block.text.length;
				else if (block.type === "thinking") chars += block.thinking.length;
				else if (block.type === "toolCall") {
					chars += block.name.length + JSON.stringify(block.arguments).length;
				}
			}
			break;
		}
		case "bashExecution":
			chars = (msg.command as string).length + (msg.output as string).length;
			break;
		case "compactionSummary":
		case "branchSummary":
			chars = (msg.summary as string).length;
			break;
		default:
			// Unknown custom role — best effort
			if (typeof msg.content === "string") chars = msg.content.length;
			else if (typeof msg.summary === "string") chars = (msg.summary as string).length;
			break;
	}
	return Math.ceil(chars / 4);
}

/** Map a message role to a display category. */
function roleCategory(role: string): string {
	switch (role) {
		case "user":
			return "usr";
		case "assistant":
			return "ast";
		case "toolResult":
			return "tool";
		case "compactionSummary":
			return "cmp";
		case "branchSummary":
			return "br";
		case "bashExecution":
			return "bash";
		case "custom":
			return "cust";
		default:
			return role.slice(0, 4);
	}
}

/** Format token count compactly. */
function fmtTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

/** Compute per-category token breakdown and format as status string. */
function computeBreakdown(messages: AgentMessage[], systemPrompt: string | undefined): string {
	const counts = new Map<string, number>();

	// System prompt tokens
	if (systemPrompt) {
		counts.set("sys", estimateStringTokens(systemPrompt));
	}

	// Message tokens by role category
	for (const msg of messages) {
		if (!msg || typeof msg !== "object" || !("role" in msg)) continue;
		const cat = roleCategory((msg as { role: string }).role);
		const tokens = estimateMessageTokens(msg);
		counts.set(cat, (counts.get(cat) ?? 0) + tokens);
	}

	// Build display string
	const parts: string[] = [];
	let total = 0;
	// Fixed order: sys first, then known categories, then anything else
	const order = ["sys", "usr", "ast", "tool", "cmp", "br", "bash", "cust"];
	const seen = new Set<string>();
	for (const cat of order) {
		const val = counts.get(cat);
		if (val !== undefined && val > 0) {
			parts.push(`${cat}:${fmtTokens(val)}`);
			total += val;
			seen.add(cat);
		}
	}
	for (const [cat, val] of counts) {
		if (!seen.has(cat) && val > 0) {
			parts.push(`${cat}:${fmtTokens(val)}`);
			total += val;
		}
	}

	if (parts.length === 0) return "";
	return `ctx ~${fmtTokens(total)} [${parts.join(" + ")}]`;
}

function updateStatus(ctx: ExtensionContext, messages: AgentMessage[]): void {
	if (!ctx.hasUI) return;
	const systemPrompt = ctx.getSystemPrompt();
	const status = computeBreakdown(messages, systemPrompt);
	ctx.ui.setStatus(STATUS_KEY, status || undefined);
}

export default function (pi: ExtensionAPI) {
	let lastSystemPrompt: string | undefined;
	let lastMessages: AgentMessage[] = [];

	// --- System prompt display (existing functionality) ---

	pi.registerMessageRenderer("sys-prompt-display", (message, { expanded }, theme) => {
		// Read prompt text from details (not content) to avoid polluting LLM context
		const details = message.details as { changed?: boolean; prompt?: string } | undefined;
		const content = details?.prompt ?? "";
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
		// Clear status on new session
		lastMessages = [];
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
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
				content: "",
				display: true,
				details: { changed, prompt: currentPrompt },
			});
		}

		return { action: "continue" as const };
	});

	// --- Token breakdown status (new functionality) ---

	// Before each LLM call: compute breakdown, and strip display-only custom messages from LLM context
	pi.on("context", (event, ctx) => {
		lastMessages = event.messages;
		updateStatus(ctx, event.messages);
		// Filter out our own display-only message so it never reaches the LLM
		const filtered = event.messages.filter(
			(m) => !(m.role === "custom" && (m as { customType?: string }).customType === "sys-prompt-display"),
		);
		if (filtered.length !== event.messages.length) {
			return { messages: filtered };
		}
	});

	// After each turn: update with the turn's new messages included
	pi.on("turn_end", (event, ctx) => {
		// Add the new message and tool results to our tracked messages
		if (event.message) lastMessages = [...lastMessages, event.message];
		if (event.toolResults?.length) lastMessages = [...lastMessages, ...event.toolResults];
		updateStatus(ctx, lastMessages);
	});

	// After compaction: context is unknown until next LLM response
	pi.on("session_compact", (_event, ctx) => {
		lastMessages = [];
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "ctx ~? [compacted]");
	});

	// After agent loop ends: final update
	pi.on("agent_end", (event, ctx) => {
		if (event.messages?.length) {
			lastMessages = event.messages;
			updateStatus(ctx, event.messages);
		}
	});
}
