import type { TaskRequest } from "./model.js";
import { parseTaskRequest } from "./schema.js";

export type HumanTaskCommand =
	| Extract<TaskRequest, { action: "add" | "list" }>
	| { action: "clear" }
	| {
			action: "modify";
			id: number;
			text?: string;
			blockedBy?: number[];
			status?: "in_progress" | "done" | "expired";
			reason?: string;
	  };
interface Token {
	value: string;
	literal: boolean;
}
function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let value = "";
	let active = false;
	let literal = false;
	let quote = "";
	for (let index = 0; index < input.length; index++) {
		const char = input[index];
		if (char === "\\" && quote !== "'") {
			if (++index === input.length) throw new Error("Trailing escape");
			value += input[index];
			active = literal = true;
		} else if (quote) {
			if (char === quote) quote = "";
			else value += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			active = literal = true;
		} else if (/\s/.test(char)) {
			if (active) tokens.push({ value, literal });
			value = "";
			active = literal = false;
		} else {
			value += char;
			active = true;
		}
	}
	if (quote) throw new Error("Unterminated quote");
	if (active) tokens.push({ value, literal });
	return tokens;
}
function number(value: string, zero = false): number {
	if (!(zero ? /^(0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(value))
		throw new Error("Expected a canonical decimal integer");
	const result = Number(value);
	if (!Number.isSafeInteger(result)) throw new Error("Integer is not safe");
	return result;
}
function text(value: string): string {
	if (!value.trim()) throw new Error("Text must not be blank");
	return value;
}
export function parseHumanTaskCommand(args: string): HumanTaskCommand {
	const tokens = tokenize(args);
	const action = tokens.shift()?.value;
	if (!action || !["add", "modify", "list", "clear"].includes(action))
		throw new Error("Expected add, modify, list or clear");
	let positional: string | undefined;
	if (action === "add" || action === "modify") {
		const token = tokens.shift();
		if (!token || (!token.literal && token.value.startsWith("--")))
			throw new Error("Missing text or task ID");
		positional = token.value;
	}
	const allowed =
		action === "add"
			? ["start", "blocked-by"]
			: action === "modify"
				? ["text", "blocked-by", "status", "reason"]
				: action === "list"
					? ["type", "limit"]
					: ["CONFIRMED"];
	const options = new Map<string, string>();
	for (let index = 0; index < tokens.length; index++) {
		const flag = tokens[index].value;
		const name = flag.slice(2);
		if (!flag.startsWith("--") || !allowed.includes(name) || options.has(name))
			throw new Error(`Unknown, misplaced or duplicate flag: ${flag}`);
		if (name === "start" || name === "CONFIRMED") {
			options.set(name, "true");
			continue;
		}
		const token = tokens[++index];
		if (!token || (!token.literal && token.value.startsWith("--")))
			throw new Error(`Missing value for ${flag}`);
		options.set(name, token.value);
	}
	const rawDependencies = options.get("blocked-by");
	const blockedBy =
		rawDependencies === undefined
			? undefined
			: rawDependencies === ""
				? []
				: rawDependencies.split(",").map((id) => number(id));
	if (action === "clear") {
		if (!options.has("CONFIRMED"))
			throw new Error(
				"clear removes EVERY task; rerun with --CONFIRMED to proceed",
			);
		return { action };
	}
	if (action === "list") {
		const request = parseTaskRequest({
			action,
			...(options.has("type") ? { type: options.get("type") } : {}),
			...(options.has("limit")
				? { limit: number(options.get("limit") ?? "", true) }
				: {}),
		});
		if (request.action !== "list") throw new Error("Expected list request");
		return request;
	}
	if (action === "add")
		return {
			action,
			text: text(positional ?? ""),
			...(options.has("start") ? { start: true } : {}),
			...(blockedBy !== undefined ? { blockedBy } : {}),
		};
	if (!options.size) throw new Error("Modify requires at least one option");
	const status = options.get("status");
	if (
		status !== undefined &&
		status !== "in_progress" &&
		status !== "done" &&
		status !== "expired"
	)
		throw new Error("Status must be in_progress, done or expired");
	const reason = options.get("reason");
	if (status === "expired" ? !reason?.trim() : reason !== undefined)
		throw new Error("Only expired requires and accepts --reason");
	return {
		action: "modify",
		id: number(positional ?? ""),
		...(options.has("text") ? { text: text(options.get("text") ?? "") } : {}),
		...(blockedBy !== undefined ? { blockedBy } : {}),
		...(status !== undefined ? { status } : {}),
		...(reason !== undefined ? { reason } : {}),
	};
}
