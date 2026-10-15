export interface ParsedArg {
	value: string;
	quoted: boolean;
	end: number;
}

export type ArgOutcome = { ok: true; arg: ParsedArg } | { ok: false; message: string };

/**
 * Parse one argument at `start`: a bare whitespace-free token, or a quoted
 * JSON string (supports escapes) spanning to its closing quote.
 */
export function parseArg(body: string, start: number): ArgOutcome {
	if (body[start] === '"') {
		let index = start + 1;
		while (index < body.length) {
			const char = body[index];
			if (char === "\\") {
				index += 2;
				continue;
			}
			if (char === '"') {
				const span = body.slice(start, index + 1);
				try {
					const value: unknown = JSON.parse(span);
					if (typeof value !== "string") return { ok: false, message: `KEY 引号内容必须是 JSON 字符串：${span}` };
					return { ok: true, arg: { value, quoted: true, end: index + 1 } };
				} catch {
					return { ok: false, message: `KEY 引号内容不是合法 JSON 字符串：${span}` };
				}
			}
			index++;
		}
		return { ok: false, message: "KEY 引号未闭合" };
	}
	const match = /\S+/.exec(body.slice(start));
	if (!match || match.index !== 0) return { ok: false, message: "缺少 KEY" };
	return { ok: true, arg: { value: match[0], quoted: false, end: start + match[0].length } };
}

export function parseArgs(
	body: string,
	start: number,
): { ok: true; args: ParsedArg[] } | { ok: false; message: string } {
	const args: ParsedArg[] = [];
	let index = start;
	for (;;) {
		while (index < body.length && /\s/.test(body[index])) index++;
		if (index >= body.length) return { ok: true, args };
		const outcome = parseArg(body, index);
		if (!outcome.ok) return outcome;
		const { arg } = outcome;
		if (arg.quoted && arg.end < body.length && !/\s/.test(body[arg.end])) {
			return { ok: false, message: `引号 KEY 后必须跟空白：${body.slice(index, arg.end + 1)}` };
		}
		args.push(arg);
		index = arg.end;
	}
}
