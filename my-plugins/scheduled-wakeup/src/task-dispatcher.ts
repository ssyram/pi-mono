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
import { shouldWakeUp } from "./script-tasks/wake-up-policy.js";
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
export type DeliveryStatus = { wakeUps: number; noWakes: number };
export type TaskDispatcher = {
	dispatch(target: ExecutionTarget): void;
	list(): readonly RunningTask[];
	deliveryStatus(): ReadonlyMap<string, DeliveryStatus>;
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
	const deliveryQueue: {
		taskId: string;
		run: TaskRun;
		task: ScriptTask;
		includeTimestamp: boolean;
	}[] = [];
	const wakeInFlight = new Map<string, number>();
	let closed = false;
	let agentBusy = false;
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
	const sendMessageNow = (
		taskId: string,
		run: TaskRun,
		task: ScriptTask,
		includeTimestamp: boolean,
	): void => {
		if (run.shouldWake)
			wakeInFlight.set(taskId, (wakeInFlight.get(taskId) ?? 0) + 1);
		pi.sendMessage(
			{
				customType: TASK_RUN_MESSAGE,
				content: includeTimestamp
					? buildWakeUpContent(task, run.results, run.shouldWake, {
							completedAt: run.completedAt,
							sentAt: Date.now(),
						})
					: run.content,
				display: true,
				details: run,
			},
			{ triggerTurn: run.shouldWake, deliverAs: "followUp" },
		);
	};
	// pi flushes pending no-trigger custom messages at every turn_end boundary,
	// which injects them into the live run. Hold no-wake reports until agent_settled
	// so they only append to history once the session is idle.
	const flushDeliveries = (): void => {
		if (deliveryQueue.length === 0) return;
		const pending = deliveryQueue.splice(0, deliveryQueue.length);
		for (const entry of pending) {
			if (closed) break;
			sendMessageNow(entry.taskId, entry.run, entry.task, entry.includeTimestamp);
		}
		changed();
	};
	const publish = (
		taskId: string,
		run: TaskRun,
		task: ScriptTask,
		includeTimestamp: boolean,
	): void => {
		if (run.shouldWake || !agentBusy) {
			sendMessageNow(taskId, run, task, includeTimestamp);
			return;
		}
		deliveryQueue.push({ taskId, run, task, includeTimestamp });
		changed();
	};
	const unsubscribeAgentStart = pi.on("agent_start", () => {
		agentBusy = true;
	});
	const unsubscribeAgentSettled = pi.on("agent_settled", () => {
		agentBusy = false;
		// pi's followUp queue is guaranteed empty once settled: the post-run
		// continuation loop has drained every queued message by then.
		if (wakeInFlight.size > 0) {
			wakeInFlight.clear();
			changed();
		}
		flushDeliveries();
	});
	const execute = async (
		task: ScriptTask,
		job: { progress: RunningTask; abort: AbortController },
		includeTimestamp: boolean,
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
			if (!closed) publish(job.progress.id, run, task, includeTimestamp);
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
				publish(
					target.id,
					{
						wakeUpId: `${target.id}/${randomUUID()}`,
						results: [],
						successCount: 0,
						shouldWake: true,
						completedAt: Date.now(),
						content: buildWakeUpContent(task, [], shouldWakeUp(task.wakeUp, [])),
					},
					task,
					content.includeTimestamp === true,
				);
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
			void execute(task, job, content.includeTimestamp === true);
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
		deliveryStatus: () => {
			const status = new Map<string, DeliveryStatus>();
			for (const [taskId, count] of wakeInFlight)
				status.set(taskId, { wakeUps: count, noWakes: 0 });
		for (const entry of deliveryQueue) {
				const current = status.get(entry.taskId) ?? {
					wakeUps: 0,
					noWakes: 0,
				};
				current.noWakes++;
				status.set(entry.taskId, current);
			}
			return status;
		},
		dispose() {
			if (closed) return;
			closed = true;
			unsubscribeAgentStart();
			unsubscribeAgentSettled();
			deliveryQueue.length = 0;
			wakeInFlight.clear();
			for (const job of running.values()) job.abort.abort();
			running.clear();
		},
	};
}
