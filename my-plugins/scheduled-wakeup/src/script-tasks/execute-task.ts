import { runScript } from "./run-script.js";
import type {
	ScriptResult,
	ScriptRunner,
	ScriptTask,
	TaskRun,
} from "./task-spec.js";
import { buildWakeUpContent } from "./wake-up-content.js";
import { shouldWakeUp } from "./wake-up-policy.js";

export async function executeScriptTask(
	task: ScriptTask,
	wakeUpId: string,
	runner: ScriptRunner = runScript,
): Promise<TaskRun> {
	const results: ScriptResult[] = [];
	// Step P2: Each result, including failure, is retained before running the next script.
	for (const script of task.scripts) results.push(await runner(script));
	// Step P3: Aggregate only after all script executions finish.
	const successCount = results.filter(
		(result) => result.status === "success",
	).length;
	const shouldWake = shouldWakeUp(task.wakeUp, results);
	// Step P4: Model input and expanded display share this one content value.
	const content = buildWakeUpContent(task, results, shouldWake);
	return { wakeUpId, results, successCount, shouldWake, completedAt: Date.now(), content };
}
