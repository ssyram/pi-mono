import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loopErrorMessage } from "./loop-error-message.js";
import { notifyLoop } from "./loop-notification.js";
import { executeScriptTask } from "./script-tasks/execute-task.js";
import { runScript } from "./script-tasks/run-script.js";
import type {
	ScriptSpec,
	ScriptTask,
	TaskRun,
} from "./script-tasks/task-spec.js";
import { buildWakeUpContent } from "./script-tasks/wake-up-content.js";
import type { ExecutionTarget } from "./v2/model.js";
import { cloneTaskContent } from "./v2/task-content.js";

export type RunningTask = {
	id: string;
	wakeUpId: string;
	success: number;
	completed: number;
	total: number;
	current?: ScriptSpec;
};
export type TaskDispatcher = {
	dispatch(target: ExecutionTarget): void;
	list(): readonly RunningTask[];
	dispose(): void;
};
export type DispatcherOptions = {
	runner?: typeof runScript;
	onChange?: () => void;
	onSettled?: () => void;
};
export const TASK_RUN_MESSAGE = "loop-task-run";

export function createTaskDispatcher(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: DispatcherOptions = {},
): TaskDispatcher {
	const running = new Map<
		string,
		{ progress: RunningTask; abort: AbortController }
	>();
	let closed = false;
	const report = (error: unknown): void => {
		if (!closed)
			notifyLoop(
				ctx,
				`Loop execution failed: ${loopErrorMessage(error)}`,
				"error",
			);
	};
	const changed = (): void => {
		try {
			options.onChange?.();
		} catch (error) {
			report(error);
		}
	};
	const publish = (run: TaskRun): void =>
		pi.sendMessage(
			{
				customType: TASK_RUN_MESSAGE,
				content: run.content,
				display: true,
				details: run,
			},
			{ triggerTurn: run.shouldWake, deliverAs: "followUp" },
		);
	const execute = async (
		task: ScriptTask,
		job: { progress: RunningTask; abort: AbortController },
	): Promise<void> => {
		try {
			const run = await executeScriptTask(
				task,
				job.progress.wakeUpId,
				async (script) => {
					if (!job.abort.signal.aborted) {
						job.progress.current = script;
						changed();
					}
					const result = await (options.runner ?? runScript)(
						script,
						job.abort.signal,
					);
					job.progress.completed++;
					if (result.status === "success") job.progress.success++;
					delete job.progress.current;
					changed();
					return result;
				},
			);
			if (!closed) publish(run);
		} catch (error) {
			report(error);
		} finally {
			running.delete(job.progress.id);
			if (!closed) {
				changed();
				try {
					options.onSettled?.();
				} catch (error) {
					report(error);
				}
			}
		}
	};
	return {
		dispatch(target) {
			if (closed) throw new Error("Loop dispatcher is inactive");
			if (running.has(target.id))
				throw new Error(`Loop task ${target.id} is already running`);
			const content = cloneTaskContent(target);
			if (content.scriptTask === undefined) {
				const task: ScriptTask = {
					wakeUp: { kind: "always", prompt: content.prompt },
					scripts: [],
				};
				publish({
					wakeUpId: `${target.id}/${randomUUID()}`,
					results: [],
					successCount: 0,
					shouldWake: true,
					content: buildWakeUpContent(task, []),
				});
				return;
			}
			const task = content.scriptTask;
			const job = {
				progress: {
					id: target.id,
					wakeUpId: `${target.id}/${randomUUID()}`,
					success: 0,
					completed: 0,
					total: task.scripts.length,
				},
				abort: new AbortController(),
			};
			running.set(target.id, job);
			changed();
			void execute(task, job);
		},
		list: () =>
			[...running.values()]
				.filter((job) => job.progress.total > 0)
				.map(({ progress }) => ({
					...progress,
					...(progress.current
						? {
								current: {
									...progress.current,
									params: [...progress.current.params],
								},
							}
						: {}),
				})),
		dispose() {
			if (closed) return;
			closed = true;
			for (const job of running.values()) job.abort.abort();
			running.clear();
		},
	};
}
