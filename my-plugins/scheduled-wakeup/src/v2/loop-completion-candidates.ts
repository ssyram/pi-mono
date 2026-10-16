import type { LoopCommandAutocompleteSource } from "./loop-command-autocomplete.js";
import type { SharedScope } from "./model.js";

export type Candidate = { value: string; description?: string };

export function topLevel(): Candidate[] {
	return [
		"add",
		"define",
		"available",
		"register",
		"unregister",
		"list",
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
	if (previous.includes("--no-boulder")) return [];
	const head = previous[0];
	const allowed = head === undefined || (head === "once" ? previous.length <= 2
		: head === "at" ? !previous.includes("--") : previous.length === 1);
	return allowed ? [{ value: "--no-boulder", description: "inhibit Boulder auto-resume while this schedule is active" }] : [];
}

function isScope(value: string): value is SharedScope {
	return value === "workspace" || value === "global";
}
