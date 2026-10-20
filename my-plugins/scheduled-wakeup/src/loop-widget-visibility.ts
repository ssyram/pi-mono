import type { SessionEntryLike } from "./v2/session-entry-adapter.js";

export const LOOP_WIDGET_VISIBILITY = "scheduled-wakeup/widget-visibility";

export function readLoopWidgetVisibility(
	branch: readonly SessionEntryLike[],
): boolean {
	let visible = true;
	for (const entry of branch) {
		if (entry.type !== "custom" || entry.customType !== LOOP_WIDGET_VISIBILITY)
			continue;
		const data = entry.data;
		if (
			typeof data === "object" &&
			data !== null &&
			"visible" in data &&
			typeof data.visible === "boolean"
		)
			visible = data.visible;
	}
	return visible;
}
