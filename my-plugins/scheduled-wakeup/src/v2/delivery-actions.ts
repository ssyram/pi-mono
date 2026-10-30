import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildWakeUpContent } from "../script-tasks/wake-up-content.js";
import type { TaskRun } from "../script-tasks/task-spec.js";
import type { RunTaskPayload } from "../script-tasks/run-record.js";
import { TASK_RUN_MESSAGE } from "./task-run-message.js";

export type DeliveryItem = {
	key: string;
	taskId: string;
	runDir: string | undefined;
	owner: boolean;
	shouldWake: boolean;
	render(now: number): TaskRun;
};

/** Builds the deliverable TaskRun for a finished run, adding send-time timestamps when asked. */
export function runDelivery(
	taskId: string,
	payload: RunTaskPayload,
	outcome: {
		results: TaskRun["results"];
		successCount: number;
		shouldWake: boolean;
		completedAt: number;
		content: string;
	},
): (now: number) => TaskRun {
	return (now: number) => ({
		wakeUpId: taskId,
		results: outcome.results,
		successCount: outcome.successCount,
		shouldWake: outcome.shouldWake,
		completedAt: outcome.completedAt,
		content:
			payload.scriptTask !== undefined && payload.includeTimestamp === true
				? buildWakeUpContent(
						payload.scriptTask,
						outcome.results,
						outcome.shouldWake,
						{ completedAt: outcome.completedAt, sentAt: now },
					)
				: outcome.content,
	});
}

/** Builds the deliverable TaskRun for a prompt-only target (always-wake). */
export function promptDelivery(
	taskId: string,
	prompt: string,
	includeTimestamp: boolean,
): (now: number) => TaskRun {
	const task = {
		wakeUp: { kind: "always" as const, prompt },
		scripts: [],
	};
	return (now: number) => ({
		wakeUpId: taskId,
		results: [],
		successCount: 0,
		shouldWake: true,
		completedAt: now,
		content: buildWakeUpContent(
			task,
			[],
			true,
			includeTimestamp ? { completedAt: now, sentAt: now } : undefined,
		),
	});
}

export function sendNow(pi: ExtensionAPI, run: TaskRun): void {
	pi.sendMessage(
		{
			customType: TASK_RUN_MESSAGE,
			content: run.content,
			display: true,
			details: run,
		},
		{ triggerTurn: run.shouldWake, deliverAs: "followUp" },
	);
}

export function boundaryEntry(
	run: TaskRun,
): {
	type: "custom_message";
	customType: string;
	content: string;
	display: boolean;
	details: unknown;
} {
	return {
		type: "custom_message",
		customType: TASK_RUN_MESSAGE,
		content: run.content,
		display: true,
		details: run,
	};
}
