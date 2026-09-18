import type {
	AutocompleteItem,
	AutocompleteProvider,
} from "@earendil-works/pi-tui";
import type { TaskAutocompleteProvider } from "../../commands/task-completion.js";
import {
	type CompletionSlot,
	taskCompletionSlot,
} from "./human-completion-context.js";
import {
	type CompletionInput,
	insertTaskCompletion,
	taskCompletionInput,
} from "./human-completion-input.js";
import type { TaskRecord } from "./model.js";

function looseMatch(query: string, value: string): boolean {
	let position = 0;
	for (const char of query.toLowerCase()) {
		position = value.indexOf(char, position);
		if (position < 0) return false;
		position++;
	}
	return true;
}

function choices(
	input: CompletionInput,
	slot: CompletionSlot,
	readTasks: () => readonly TaskRecord[],
): AutocompleteItem[] {
	if (slot.kind === "fixed") {
		const query = input.prefix.toLowerCase();
		return slot.values
			.filter((value) =>
				slot.loose ? looseMatch(query, value) : value.startsWith(query),
			)
			.sort((a, b) => Number(b.startsWith(query)) - Number(a.startsWith(query)))
			.map((value) => ({
				value,
				label: value,
				description: slot.descriptions?.[value],
			}));
	}
	const tasks = readTasks();
	let head = "";
	let tail = "";
	let query = input.prefix;
	if (slot.dependencies) {
		const lastComma = input.prefix.lastIndexOf(",");
		head = input.prefix.slice(0, lastComma + 1);
		query = input.prefix.slice(lastComma + 1);
		const nextComma = input.token.value.indexOf(",", input.prefix.length);
		tail = nextComma < 0 ? "" : input.token.value.slice(nextComma);
	}
	const selected = new Set((head + tail).split(",").filter(Boolean));
	const lowered = query.toLowerCase();
	return tasks
		.filter(
			(task) =>
				task.id !== slot.self &&
				!selected.has(String(task.id)) &&
				(String(task.id).startsWith(query) ||
					task.text.toLowerCase().includes(lowered)),
		)
		.map((task) => ({
			value: head + task.id + tail,
			label: String(task.id),
			description: `[${task.status}] ${task.text}`,
		}));
}

export function createHumanTaskCompletionProvider(
	current: AutocompleteProvider,
	readTasks: () => readonly TaskRecord[],
): TaskAutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			try {
				const input = taskCompletionInput(lines, cursorLine, cursorCol);
				const slot = input && taskCompletionSlot(input);
				if (!input || !slot)
					return await current.getSuggestions(
						[...lines],
						cursorLine,
						cursorCol,
						options,
					);
				if (options.signal.aborted) return null;
				const items = choices(input, slot, readTasks);
				return items.length ? { items, prefix: input.rawPrefix } : null;
			} catch {
				return null;
			}
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const unchanged = { lines: [...lines], cursorLine, cursorCol };
			try {
				const input = taskCompletionInput(lines, cursorLine, cursorCol);
				const slot = input && taskCompletionSlot(input);
				if (!input || !slot)
					return current.applyCompletion(
						[...lines],
						cursorLine,
						cursorCol,
						item,
						prefix,
					);
				const candidates = choices(input, slot, readTasks);
				if (
					prefix !== input.rawPrefix ||
					!candidates.some((candidate) => candidate.value === item.value)
				)
					return unchanged;
				return insertTaskCompletion(input, item.value);
			} catch {
				return unchanged;
			}
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			try {
				const input = taskCompletionInput(lines, cursorLine, cursorCol);
				if (input && taskCompletionSlot(input)) return true;
				const fallback = current as AutocompleteProvider &
					Partial<TaskAutocompleteProvider>;
				return (
					fallback.shouldTriggerFileCompletion?.(
						[...lines],
						cursorLine,
						cursorCol,
					) ?? true
				);
			} catch {
				return false;
			}
		},
	};
}
