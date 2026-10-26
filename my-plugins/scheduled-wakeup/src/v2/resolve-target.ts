import type { LoopV2Core } from "./loop-core.js";
import type { SharedScope } from "./model.js";

export type TargetCandidate = { id: string; name?: string | undefined };

export type TargetResolution =
	| { ok: true; id: string }
	| { ok: false; message: string };

/** Exact id first; a name resolves only when unique within the command's candidate set. */
export function resolveTarget(
	target: string,
	candidates: readonly TargetCandidate[],
): TargetResolution {
	if (candidates.some((candidate) => candidate.id === target))
		return { ok: true, id: target };
	const byName = candidates.filter((candidate) => candidate.name === target);
	const match = byName.length === 1 ? byName[0] : undefined;
	if (match !== undefined) return { ok: true, id: match.id };
	if (byName.length > 1)
		return {
			ok: false,
			message: `ambiguous name "${target}" matches ${byName
				.map(label)
				.join(", ")}; use the id instead`,
		};
	return { ok: false, message: `no match for "${target}"` };
}

export function activeTaskCandidates(core: LoopV2Core): TargetCandidate[] {
	return core.listActive().map((item) => {
		const candidate: TargetCandidate = {
			id:
				item.kind === "session"
					? item.task.definition.id
					: item.registration.id,
		};
		const name =
			item.kind === "session"
				? item.task.definition.name
				: item.definition?.name;
		if (name !== undefined) candidate.name = name;
		return candidate;
	});
}

export function registrationCandidates(core: LoopV2Core): TargetCandidate[] {
	return core
		.listActive()
		.filter((item) => item.kind === "registration")
		.map((item) => {
			const candidate: TargetCandidate = { id: item.registration.id };
			if (item.definition?.name !== undefined)
				candidate.name = item.definition.name;
			return candidate;
		});
}

export function definitionCandidates(
	core: LoopV2Core,
	scopes?: readonly SharedScope[],
): TargetCandidate[] {
	return core.listDefinitions(scopes).map((definition) => {
		const candidate: TargetCandidate = { id: definition.id };
		if (definition.name !== undefined) candidate.name = definition.name;
		return candidate;
	});
}

export function sessionTaskCandidates(core: LoopV2Core): TargetCandidate[] {
	return core.snapshotSessionState().tasks.map((task) => {
		const candidate: TargetCandidate = { id: task.definition.id };
		if (task.definition.name !== undefined)
			candidate.name = task.definition.name;
		return candidate;
	});
}

export function scopeOfDefinitionId(id: string): SharedScope | undefined {
	const prefix = id.split(":", 1)[0];
	return prefix === "workspace" || prefix === "global" ? prefix : undefined;
}

function label(candidate: TargetCandidate): string {
	return candidate.name === undefined
		? candidate.id
		: `${candidate.name} [${candidate.id}]`;
}
