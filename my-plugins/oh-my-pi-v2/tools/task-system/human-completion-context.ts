import { completeTaskArgument } from "../../commands/task-completion.js";
import type { CompletionInput } from "./human-completion-input.js";

export type CompletionSlot =
	| {
			kind: "fixed";
			values: string[];
			loose?: boolean;
			descriptions?: Record<string, string>;
	  }
	| { kind: "ids"; dependencies: boolean; self?: number };

const FLAGS: Readonly<Record<string, readonly string[]>> = {
	add: ["--start", "--blocked-by"],
	modify: ["--text", "--blocked-by", "--status", "--reason"],
	list: ["--type", "--limit"],
	clear: [],
};

function legacySlot(previous: string[], extra: string[] = []): CompletionSlot {
	const candidates = completeTaskArgument(previous) ?? [];
	return {
		kind: "fixed",
		loose: true,
		values: [...candidates.map((item) => item.value), ...extra],
		descriptions: Object.fromEntries(
			candidates.map((item) => [item.value, item.description]),
		),
	};
}

function valueSlot(
	flag: string,
	action: string,
	input: CompletionInput,
): CompletionSlot | undefined {
	if (flag === "--status")
		return { kind: "fixed", values: ["in_progress", "done", "expired"] };
	if (flag === "--type")
		return {
			kind: "fixed",
			values: [
				"open",
				"closed",
				"in_progress",
				"ready",
				"blocked",
				"done",
				"expired",
			],
		};
	if (flag === "--blocked-by")
		return {
			kind: "ids",
			dependencies: true,
			self: action === "modify" ? Number(input.tokens[1]?.value) : undefined,
		};
	return;
}

export function taskCompletionSlot(
	input: CompletionInput,
): CompletionSlot | undefined {
	const { tokens, token, index } = input;
	if (index === 0)
		return token.literal
			? undefined
			: legacySlot([], ["add", "modify", "list", "clear"]);
	const action = tokens[0].value;
	if (action.toLowerCase() === "show" && index === 1 && !token.literal)
		return legacySlot([action]);
	if (!Object.hasOwn(FLAGS, action) || tokens[0].literal) return;
	const flags = FLAGS[action];
	const start = action === "add" || action === "modify" ? 2 : 1;
	if (index < start)
		return action === "modify"
			? { kind: "ids", dependencies: false }
			: undefined;
	for (let position = start; position < index; ) {
		const previous = tokens[position];
		if (previous.literal || !flags.includes(previous.value)) return;
		if (previous.value === "--start") {
			position++;
			continue;
		}
		if (position + 1 === index) return valueSlot(previous.value, action, input);
		const value = tokens[position + 1];
		if (!value || (!value.literal && value.value.startsWith("--"))) return;
		position += 2;
	}
	if (token.literal) return;
	const used = new Set<string>();
	for (let position = start; position < tokens.length; position++) {
		const option = tokens[position];
		if (option.literal || !flags.includes(option.value)) continue;
		if (position !== index) used.add(option.value);
		if (option.value !== "--start") position++;
	}
	return { kind: "fixed", values: flags.filter((flag) => !used.has(flag)) };
}
