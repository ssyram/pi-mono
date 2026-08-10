import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Task } from "./task-types.js";

export const TASK_INFO_ENTRY_TYPE = "omp-task-command-output";

export interface TaskInfoEntryData {
	tone: "info" | "warning";
	text: string;
}

interface TaskEntryRendererApi {
	registerEntryRenderer<T>(
		customType: string,
		renderer: (
			entry: { data?: T },
			options: { expanded: boolean },
			theme: { fg(color: string, text: string): string },
		) => Text | undefined,
	): void;
}

function formatIds(ids: number[]): string {
	return ids.length === 0 ? "none" : ids.map((id) => `#${id}`).join(", ");
}

function formatTask(task: Task): string {
	const lines = [
		`#${task.id} [${task.status}]`,
		`  text: ${task.text}`,
		`  blocks: ${formatIds(task.blocks)}`,
		`  blockedBy: ${formatIds(task.blockedBy)}`,
		`  createdAt: ${new Date(task.createdAt).toISOString()} (${task.createdAt})`,
		`  updatedAt: ${new Date(task.updatedAt).toISOString()} (${task.updatedAt})`,
	];
	if (task.expireReason !== undefined) lines.push(`  expireReason: ${task.expireReason}`);
	return lines.join("\n");
}

export function formatTaskInfo(tasks: Task[]): string {
	if (tasks.length === 0) return "No tasks.";
	return tasks.map(formatTask).join("\n\n");
}

export function registerTaskInfoEntryRenderer(pi: ExtensionAPI): void {
	const rendererApi = pi as ExtensionAPI & TaskEntryRendererApi;
	rendererApi.registerEntryRenderer<TaskInfoEntryData>(TASK_INFO_ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data) return undefined;
		const text = data.tone === "warning" ? theme.fg("warning", data.text) : data.text;
		return new Text(text, 0, 0);
	});
}
