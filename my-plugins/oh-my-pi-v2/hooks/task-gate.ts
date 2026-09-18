import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	taskAdmission,
	taskAvailabilityProblem,
} from "../tools/task-system/admission.js";
import type { Task } from "../tools/task-types.js";

export function registerTaskGate(
	pi: ExtensionAPI,
	getTaskState: (context: ExtensionContext) => { tasks: Task[] },
): void {
	pi.on("tool_call", (event, context) =>
		taskAdmission(event.toolName, () => getTaskState(context).tasks),
	);
	pi.on("session_start", async () => {
		try {
			const names = [
				...pi.getActiveTools(),
				...pi.getAllTools().map((tool) => tool.name),
			];
			const problem = taskAvailabilityProblem(names);
			if (problem) console.warn(`[oh-my-pi task] ${problem}`);
		} catch (error) {
			console.error(
				`[oh-my-pi task] Task gate availability check failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}
