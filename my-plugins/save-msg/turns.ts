/**
 * Groups flat session entries into conversation turns.
 * A turn is either a user message, or an assistant response
 * (including all subsequent tool results until the next user message).
 */

interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	arguments?: unknown;
}

interface SessionEntry {
	type: string;
	id: string;
	timestamp: string;
	message?: {
		role?: string;
		content?: string | ContentBlock[];
		command?: string;
		output?: string;
	};
}

export interface Turn {
	role: "user" | "assistant";
	timestamp: string;
	entries: SessionEntry[];
	preview: string;
}

export function groupIntoTurns(branch: SessionEntry[]): Turn[] {
	const messages = branch.filter(e => e.type === "message" && e.message);
	const turns: Turn[] = [];
	let current: Turn | null = null;

	for (const entry of messages) {
		const role = entry.message!.role;
		if (role === "user") {
			if (current) turns.push(current);
			current = {
				role: "user",
				timestamp: entry.timestamp,
				entries: [entry],
				preview: extractPreview(entry),
			};
		} else if (role === "assistant") {
			if (current && current.role === "user") {
				turns.push(current);
			}
			if (!current || current.role === "user") {
				current = {
					role: "assistant",
					timestamp: entry.timestamp,
					entries: [entry],
					preview: extractPreview(entry),
				};
			} else {
				current.entries.push(entry);
			}
		} else {
			// toolResult, bashExecution, custom — attach to current turn
			if (current) current.entries.push(entry);
		}
	}
	if (current) turns.push(current);
	return turns;
}

function extractPreview(entry: SessionEntry): string {
	const content = entry.message?.content;
	if (!content) return "(empty)";
	if (typeof content === "string") return content.slice(0, 80).replace(/\n/g, " ");
	const textParts = content.filter(b => b.type === "text" && b.text);
	const joined = textParts.map(b => b.text!).join(" ");
	return joined.slice(0, 80).replace(/\n/g, " ");
}

export function serializeTurns(turns: Turn[], raw: boolean, withTools: boolean, noHeader: boolean): string {
	if (raw) {
		return JSON.stringify(turns.flatMap(t => t.entries), null, 2);
	}
	return turns.map(t => extractTurnText(t, withTools, noHeader)).join("\n\n---\n\n");
}

export function extractTurnText(turn: Turn, withTools: boolean, noHeader: boolean): string {
	const parts: string[] = [];

	if (!noHeader) {
		const time = formatTimestamp(turn.timestamp);
		const label = turn.role === "user" ? "User" : "Assistant";
		parts.push(`## ${label} (${time})\n`);
	}

	for (const entry of turn.entries) {
		const role = entry.message?.role;
		const content = entry.message?.content;

		if (role === "user" || role === "assistant") {
			parts.push(extractFullText(content));
			if (withTools && Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "toolCall" && block.name) {
						const argStr = typeof block.arguments === "string"
							? block.arguments
							: JSON.stringify(block.arguments ?? {});
						parts.push(`\n> Tool: ${block.name}(${truncate(argStr, 100)})\n`);
					}
				}
			}
		} else if (withTools && (role === "toolResult" || role === "bashExecution")) {
			if (role === "bashExecution") {
				const cmd = entry.message?.command || "";
				const out = entry.message?.output || "";
				parts.push(`\n> \`${cmd}\`\n\`\`\`\n${truncate(out, 500)}\n\`\`\`\n`);
			} else {
				parts.push(`\n> Tool result:\n${truncate(extractFullText(content), 500)}\n`);
			}
		}
	}

	return parts.join("\n").trim();
}

function extractFullText(content: string | ContentBlock[] | undefined): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	return content
		.filter(b => b.type === "text" && b.text)
		.map(b => b.text!)
		.join("\n");
}

function formatTimestamp(ts: string): string {
	try {
		const d = new Date(ts);
		return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
	} catch {
		return ts;
	}
}

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + "...";
}
