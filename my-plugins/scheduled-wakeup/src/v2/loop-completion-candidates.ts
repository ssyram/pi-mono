import type { LoopCommandAutocompleteSource } from "./loop-command-autocomplete.js";
import type { SharedScope } from "./model.js";
import { readScriptOptions } from "./script-task-options.js";

export type Candidate = { value: string; description?: string };

export function topLevel(): Candidate[] {
	return [
		"add",
		"define",
		"available",
		"register",
		"unregister",
		"list",
		"running",
		"show",
		"stop",
		"delete",
		"run",
		"defer",
		"help",
	].map((value) => ({ value }));
}

export function scopes(): Candidate[] {
	return [{ value: "workspace" }, { value: "global" }];
}
export function ids(
	values: readonly string[],
	description: string,
): Candidate[] {
	return values.map((value) => ({ value, description }));
}
export function registrationIds(values: readonly string[]): Candidate[] {
	return values
		.filter((value) => value.startsWith("registration:"))
		.map((value) => ({ value, description: "active registration" }));
}

export function registerCandidates(
	previous: string[],
	source: LoopCommandAutocompleteSource,
): Candidate[] {
	if (previous.length === 1) return scopes();
	const scope = previous[1];
	if (previous.length === 2 && scope !== undefined && isScope(scope))
		return ids(source.sharedDefinitionIds([scope]), "shared definition");
	return [];
}

export function deleteCandidates(
	previous: string[],
	source: LoopCommandAutocompleteSource,
): Candidate[] {
	if (previous.length === 1)
		return [
			{ value: "--force", description: "remove every registration" },
			...ids(source.sharedDefinitionIds(), "shared definition"),
		];
	if (previous.length === 2 && previous[1] === "--force")
		return ids(source.sharedDefinitionIds(), "shared definition");
	return [];
}

export function addFlags(parsed: { previous: string[] }): Candidate[] {
	return scheduleFlags(parsed.previous.slice(1));
}

export function defineFlags(previous: string[]): Candidate[] {
	const scope = previous[1];
	return scope === "ws" || (scope !== undefined && isScope(scope)) ? scheduleFlags(previous.slice(2)) : [];
}

function scheduleFlags(previous: string[]): Candidate[] {
	if (previous.at(-1) === "--wake") return ["always", "on-error", "never"].map((value) => ({ value }));
	if (previous.at(-1) === "--error-mode") return ["or", "and"].map((value) => ({ value }));
	const parsed = readScriptOptions(previous.join(" "));
	if (!parsed.ok) return [];
	const rest = parsed.rest.split(/\s+/).filter(Boolean);
	const head = rest[0];
	const allowed = head === undefined || (head === "once" ? rest.length <= 2 : head === "at" ? !rest.includes("--") : rest.length === 1);
	if (!allowed) return [];
	const flags: Candidate[] = parsed.inhibit || rest.includes("--no-boulder") ? [] : [{ value: "--no-boulder", description: "inhibit Boulder while this schedule is active" }];
	if (rest.length === 0) {
		flags.push({ value: "--script", description: "append one JSON script object" });
		if (!previous.includes("--wake")) flags.push({ value: "--wake", description: "always, on-error or never" });
		if (parsed.options?.wake === "on-error" && !previous.includes("--error-mode")) flags.push({ value: "--error-mode", description: "or (default) or and" });
	}
	return flags;
}

function isScope(value: string): value is SharedScope {
	return value === "workspace" || value === "global";
}
