export type ScriptOptions = {
	scripts: unknown[];
	wake: "always" | "never" | "on-error";
	aggregation: "and" | "or";
};
export type ScriptOptionsResult =
	| {
			ok: true;
			rest: string;
			options: ScriptOptions | undefined;
			inhibit: boolean;
	  }
	| { ok: false; error: string };

export function readScriptOptions(input: string): ScriptOptionsResult {
	let rest = input.trimStart();
	const scripts: unknown[] = [];
	let wake: ScriptOptions["wake"] = "always";
	let aggregation: ScriptOptions["aggregation"] = "or";
	let seenWake = false;
	let seenAggregation = false;
	let used = false;
	let inhibit = false;
	try {
		while (rest.startsWith("--")) {
			const match = /^(--[\w-]+)(?:\s+|$)/.exec(rest);
			if (!match) break;
			const flag = match[1];
			if (
				!["--script", "--wake", "--error-mode", "--no-boulder"].includes(
					flag ?? "",
				)
			)
				break;
			rest = rest.slice(match[0].length).trimStart();
			if (flag === "--no-boulder") {
				inhibit = true;
				continue;
			}
			used = true;
			if (flag === "--script") {
				const end = jsonObjectEnd(rest);
				scripts.push(JSON.parse(rest.slice(0, end)));
				rest = rest.slice(end).trimStart();
			} else {
				const value = /^\S+/.exec(rest)?.[0];
				if (value === undefined) throw new Error(`${flag} requires a value`);
				rest = rest.slice(value.length).trimStart();
				if (flag === "--wake") {
					if (
						seenWake ||
						(value !== "always" && value !== "never" && value !== "on-error")
					)
						throw new Error("--wake requires always, never or on-error, once");
					wake = value;
					seenWake = true;
				} else {
					if (seenAggregation || (value !== "and" && value !== "or"))
						throw new Error("--error-mode requires and or or, once");
					aggregation = value;
					seenAggregation = true;
				}
			}
		}
		if (seenAggregation && wake !== "on-error")
			throw new Error("--error-mode requires --wake on-error");
		return {
			ok: true,
			rest,
			options: used ? { scripts, wake, aggregation } : undefined,
			inhibit,
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Invalid script options",
		};
	}
}

function jsonObjectEnd(text: string): number {
	if (!text.startsWith("{")) throw new Error("--script requires a JSON object");
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quoted && char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') quoted = !quoted;
		if (quoted) continue;
		if (char === "{") depth++;
		if (char === "}" && --depth === 0) {
			if (i + 1 < text.length && !/\s/.test(text[i + 1] ?? ""))
				throw new Error("Space required after script JSON");
			return i + 1;
		}
	}
	throw new Error("Unclosed script JSON");
}
