/**
 * show-sys-prompt — Display system prompt info via notify and show context char breakdown in status.
 *
 * - On first LLM call: notifies a summary of the system prompt (line count + preview).
 * - On system prompt changes: notifies a compact diff (added/removed lines).
 * - Displays per-role char counts in the footer: sys:XXk usr:XXk ast:XXk tool:XXk ...
 * - Purely visual — does NOT affect model behavior or conversation context.
 */
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

const ENTRY_TYPE = "sys-prompt-last";
const STATUS_KEY = "ctx-chars";

function restoreLastPrompt(entries: SessionEntry[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === ENTRY_TYPE && typeof e.data === "string") {
			return e.data;
		}
	}
	return undefined;
}

/** Compute a compact diff between old and new prompt text. */
function computePromptDiff(oldPrompt: string, newPrompt: string): string {
	const oldLines = oldPrompt.split("\n");
	const newLines = newPrompt.split("\n");
	const oldSet = new Set(oldLines);
	const newSet = new Set(newLines);

	const added = newLines.filter((l) => !oldSet.has(l));
	const removed = oldLines.filter((l) => !newSet.has(l));

	const parts: string[] = [];
	if (removed.length > 0) {
		parts.push(`- ${removed.length} lines removed`);
		for (const line of removed.slice(0, 5)) {
			const trimmed = line.trim();
			if (trimmed) parts.push(`  - ${trimmed.slice(0, 80)}`);
		}
		if (removed.length > 5) parts.push(`  ... and ${removed.length - 5} more`);
	}
	if (added.length > 0) {
		parts.push(`+ ${added.length} lines added`);
		for (const line of added.slice(0, 5)) {
			const trimmed = line.trim();
			if (trimmed) parts.push(`  + ${trimmed.slice(0, 80)}`);
		}
		if (added.length > 5) parts.push(`  ... and ${added.length - 5} more`);
	}
	return parts.join("\n");
}

/** Summarize a prompt for first-time display. */
function summarizePrompt(prompt: string): string {
	const lines = prompt.split("\n");
	const preview = lines
		.slice(0, 10)
		.map((l) => l.slice(0, 80))
		.join("\n");
	const suffix = lines.length > 10 ? `\n... (${lines.length} lines total)` : "";
	return `[sys-prompt] ${lines.length} lines, ${prompt.length} chars\n${preview}${suffix}`;
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

/** Compute char count for a single AgentMessage. */
function estimateMessageChars(message: AgentMessage): number {
	if (!message || typeof message !== "object" || !("role" in message)) return 0;
	let chars = 0;
	const msg = message as unknown as Record<string, unknown>;
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
			if (typeof msg.content === "string") chars = msg.content.length;
			else if (typeof msg.summary === "string") chars = (msg.summary as string).length;
			break;
	}
	return chars;
}

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

function fmtChars(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function computeBreakdown(messages: AgentMessage[], systemPrompt: string | undefined): string {
	const counts = new Map<string, number>();
	if (systemPrompt) counts.set("sys", systemPrompt.length);
	for (const msg of messages) {
		if (!msg || typeof msg !== "object" || !("role" in msg)) continue;
		const cat = roleCategory((msg as { role: string }).role);
		const chars = estimateMessageChars(msg);
		counts.set(cat, (counts.get(cat) ?? 0) + chars);
	}
	const parts: string[] = [];
	let total = 0;
	const order = ["sys", "usr", "ast", "tool", "cmp", "br", "bash", "cust"];
	const seen = new Set<string>();
	for (const cat of order) {
		const val = counts.get(cat);
		if (val !== undefined && val > 0) {
			parts.push(`${cat}:${fmtChars(val)}`);
			total += val;
			seen.add(cat);
		}
	}
	for (const [cat, val] of counts) {
		if (!seen.has(cat) && val > 0) {
			parts.push(`${cat}:${fmtChars(val)}`);
			total += val;
		}
	}
	if (parts.length === 0) return "";
	return `ctx ${fmtChars(total)} chars [${parts.join(" + ")}]`;
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

	pi.on("session_start", (_event, ctx) => {
		lastSystemPrompt = restoreLastPrompt(ctx.sessionManager.getEntries());
		lastMessages = [];
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	// context hook: runs after before_agent_start, so systemPrompt is final.
	// Detect changes, notify via UI, update status.
	pi.on("context", (event, ctx) => {
		lastMessages = event.messages;
		updateStatus(ctx, event.messages);

		if (!ctx.hasUI) return;

		const currentPrompt = ctx.getSystemPrompt();
		if (!currentPrompt) return;

		if (lastSystemPrompt === undefined) {
			// First time — show summary
			lastSystemPrompt = currentPrompt;
			pi.appendEntry(ENTRY_TYPE, currentPrompt);
			ctx.ui.notify(summarizePrompt(currentPrompt), "info");
		} else if (lastSystemPrompt !== currentPrompt) {
			// Changed — show diff
			const diff = computePromptDiff(lastSystemPrompt, currentPrompt);
			lastSystemPrompt = currentPrompt;
			pi.appendEntry(ENTRY_TYPE, currentPrompt);
			ctx.ui.notify(`[sys-prompt] Changed:\n${diff}`, "warning");
		}
	});

	pi.on("turn_end", (_event, _ctx) => {});

	pi.on("session_compact", (_event, ctx) => {
		lastMessages = [];
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "ctx ? chars [compacted]");
	});

	pi.on("agent_end", (_event, _ctx) => {});
}
