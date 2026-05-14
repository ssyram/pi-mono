import type { ExtensionState } from "./resolve-state.js";
import type { Pending } from "./types.js";

export function getState(
	pending: Pending,
	ext: ExtensionState,
): { local: boolean; global: boolean } {
	return pending.get(ext.extension.absolutePath) ?? { local: ext.local, global: ext.global };
}

export function toggleField(
	pending: Pending,
	ext: ExtensionState,
	field: "local" | "global",
): void {
	const current = getState(pending, ext);
	const next = { ...current, [field]: !current[field] };
	if (next.local === ext.local && next.global === ext.global) {
		pending.delete(ext.extension.absolutePath);
	} else {
		pending.set(ext.extension.absolutePath, next);
	}
}
