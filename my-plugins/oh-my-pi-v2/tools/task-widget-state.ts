import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const TASK_WIDGET_STATE_ENTRY_TYPE = "omp-task-widget-state";

export interface TaskWidgetStateData {
	visible: boolean;
	changedAt: string;
}

function isTaskWidgetStateData(value: unknown): value is TaskWidgetStateData {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.visible === "boolean" && typeof record.changedAt === "string";
}

export function isTaskWidgetVisible(sessionManager: ExtensionContext["sessionManager"]): boolean {
	const branch = sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry.type !== "custom" || entry.customType !== TASK_WIDGET_STATE_ENTRY_TYPE) continue;
		if (isTaskWidgetStateData(entry.data)) return entry.data.visible;
	}
	return true;
}

export function createTaskWidgetState(visible: boolean): TaskWidgetStateData {
	return { visible, changedAt: new Date().toISOString() };
}
