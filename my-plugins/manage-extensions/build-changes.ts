import type { ExtensionState } from "./resolve-state.js";
import type { ChangeEntry } from "./apply-changes.js";

export function buildChanges(
	states: ExtensionState[],
	pending: Map<string, { local: boolean; global: boolean }>,
): ChangeEntry[] {
	const changes: ChangeEntry[] = [];
	for (const [path, to] of pending) {
		const st = states.find((s) => s.extension.absolutePath === path);
		if (!st || (to.local === st.local && to.global === st.global)) continue;
		changes.push({
			extension: st.extension,
			local: { from: st.local, to: to.local },
			global: { from: st.global, to: to.global },
		});
	}
	return changes;
}
