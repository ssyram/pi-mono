import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface CompactionReferenceSource {
	readonly ordinal: number;
	readonly document: number;
	readonly text: string;
}

export interface CompactionReferenceState {
	readonly sources: readonly CompactionReferenceSource[];
	readonly summarySourceCount: number;
	readonly fileSuffix: string;
	readonly userOrdinals: readonly (number | undefined)[];
}

function summaryBodyEnd(summary: string): number {
	let end = summary.length;
	for (const tag of ["modified-files", "read-files"]) {
		const close = `\n</${tag}>`;
		if (!summary.endsWith(close, end)) continue;
		const open = `\n\n<${tag}>\n`;
		const start = summary.lastIndexOf(open, end - close.length - open.length);
		if (start >= 0 && start + open.length < end - close.length) end = start;
	}
	return end;
}

function pureUserText(message: AgentMessage): string | undefined {
	if (message.role !== "user") return undefined;
	if (typeof message.content === "string") return message.content || undefined;
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type !== "text") return undefined;
		parts.push(block.text);
	}
	return parts.join("") || undefined;
}

export function buildCompactionReferenceState(
	messages: readonly AgentMessage[],
	previousSummary = "",
): CompactionReferenceState {
	const bodyEnd = summaryBodyEnd(previousSummary);
	const sources: CompactionReferenceSource[] = [];
	let offset = 0;
	let length = 0;
	let lines: string[] = [];
	while (offset < bodyEnd) {
		const start = offset;
		while (
			offset < bodyEnd &&
			previousSummary[offset] !== "\r" &&
			previousSummary[offset] !== "\n"
		)
			offset++;
		if (offset < bodyEnd) {
			if (
				previousSummary[offset] === "\r" &&
				previousSummary[offset + 1] === "\n" &&
				offset + 1 < bodyEnd
			)
				offset++;
			offset++;
		}
		const line = previousSummary.slice(start, offset);
		lines.push(line);
		length += Array.from(line).length;
		const ordinal = sources.length + 1;
		if (length >= 33 * (String(ordinal).length + 3)) {
			sources.push(
				Object.freeze({ ordinal, document: 0, text: lines.join("") }),
			);
			lines = [];
			length = 0;
		}
	}
	if (lines.length > 0) {
		sources.push(
			Object.freeze({
				ordinal: sources.length + 1,
				document: 0,
				text: lines.join(""),
			}),
		);
	}
	const summarySourceCount = sources.length;
	const userOrdinals: (number | undefined)[] = [];
	for (let index = 0; index < messages.length; index++) {
		const text = pureUserText(messages[index]);
		if (text === undefined) {
			userOrdinals.push(undefined);
			continue;
		}
		const ordinal = sources.length + 1;
		sources.push(Object.freeze({ ordinal, document: index + 1, text }));
		userOrdinals.push(ordinal);
	}
	return Object.freeze({
		sources: Object.freeze(sources),
		summarySourceCount,
		fileSuffix: previousSummary.slice(bodyEnd),
		userOrdinals: Object.freeze(userOrdinals),
	});
}
