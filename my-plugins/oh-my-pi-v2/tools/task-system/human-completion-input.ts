export interface CompletionToken {
	start: number;
	end: number;
	value: string;
	literal: boolean;
	complete: boolean;
}

// Same character rules as human-command; unfinished input is retained for editing.
function tokens(input: string, start = 0): CompletionToken[] {
	const result: CompletionToken[] = [];
	let index = start;
	while (index < input.length) {
		if (/\s/.test(input[index])) {
			index++;
			continue;
		}
		const begin = index;
		let value = "";
		let literal = false;
		let quote = "";
		let escapedEnd = false;
		while (index < input.length) {
			const char = input[index];
			if (char === "\\" && quote !== "'") {
				literal = true;
				index++;
				if (index === input.length) {
					escapedEnd = true;
					break;
				}
				value += input[index++];
			} else if (quote) {
				if (char === quote) quote = "";
				else value += char;
				index++;
			} else if (char === "'" || char === '"') {
				quote = char;
				literal = true;
				index++;
			} else if (/\s/.test(char)) break;
			else value += input[index++];
		}
		result.push({
			start: begin,
			end: index,
			value,
			literal,
			complete: !quote && !escapedEnd,
		});
	}
	return result;
}

export interface CompletionInput {
	text: string;
	cursor: number;
	tokens: CompletionToken[];
	index: number;
	token: CompletionToken;
	prefix: string;
	rawPrefix: string;
}

export function taskCompletionInput(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): CompletionInput | undefined {
	if (
		cursorLine < 0 ||
		cursorLine >= lines.length ||
		cursorCol < 0 ||
		cursorCol > lines[cursorLine].length
	)
		return;
	const text = lines.join("\n");
	const cursor = lines
		.slice(0, cursorLine)
		.reduce((size, line) => size + line.length + 1, cursorCol);
	const head = /^\s*\/task(?=\s)/.exec(text);
	if (!head || cursor <= head[0].length) return;
	const all = tokens(text, head[0].length);
	let index = all.findIndex(
		(token) => token.start <= cursor && cursor <= token.end,
	);
	if (index < 0) {
		index = all.findIndex((token) => token.start > cursor);
		if (index < 0) index = all.length;
		all.splice(index, 0, {
			start: cursor,
			end: cursor,
			value: "",
			literal: false,
			complete: true,
		});
	}
	const token = all[index];
	if (all.slice(0, index).some((entry) => !entry.complete)) return;
	const rawPrefix = text.slice(token.start, cursor);
	const prefix = tokens(rawPrefix)[0]?.value ?? "";
	return { text, cursor, tokens: all, index, token, prefix, rawPrefix };
}

export function insertTaskCompletion(input: CompletionInput, value: string) {
	const opening = input.text[input.token.start];
	// Choices contain only canonical command/flag/value/ID characters, never quotes.
	const replacement =
		opening === "'" || opening === '"' ? `${opening}${value}${opening}` : value;
	const suffix = input.text.slice(input.token.end);
	const separator = /^\s/.test(suffix) ? "" : " ";
	const text =
		input.text.slice(0, input.token.start) + replacement + separator + suffix;
	const cursor =
		input.token.start + replacement.length + (separator.length || 1);
	const before = text.slice(0, cursor).split("\n");
	return {
		lines: text.split("\n"),
		cursorLine: before.length - 1,
		cursorCol: before.at(-1)?.length ?? 0,
	};
}
