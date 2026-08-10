import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startCountdown, startSilentCountdown } from "./boulder-countdown.js";
import { hasConfirmStop, isAskingQuestion, looksAborted, wasAborted } from "./boulder-message-suppression.js";
import {
	BOULDER_RESUME_MESSAGE_TYPE,
	registerBoulderResumeMessages,
	type BoulderResumeController,
	type BoulderResumeTask,
} from "./boulder-resume-message.js";
import {
	getBoulderAttemptDelayMs,
	getBoulderAttemptLimit,
	getBoulderContextMode,
} from "./boulder-retry-policy.js";
import { appendBoulderScheduleEntry, registerBoulderScheduleEntryRenderer } from "./boulder-schedule-entry.js";
import { createBoulderSessionStateStore, type BoulderSessionState } from "./boulder-session-state.js";

const COMPACTION_GUARD_MS = 10_000;

export interface BoulderTask extends BoulderResumeTask {
	updatedAt: number;
}

export interface BoulderTaskState {
	tasks: BoulderTask[];
	actionableCount: number;
	readyTasks: BoulderTask[];
}

export type BoulderTaskStateReader = (context: ExtensionContext) => BoulderTaskState;

export function getActionableTasks(state: BoulderTaskState): BoulderTask[] {
	return [...state.tasks.filter((task) => task.status === "in_progress"), ...state.readyTasks];
}

export function createBoulderEpisodeKey(tasks: BoulderTask[]): string {
	return [...tasks]
		.sort((left, right) => left.id - right.id)
		.map((task) => `${task.id}:${task.status}:${task.updatedAt}`)
		.join("|");
}

function reportBoulderError(context: ExtensionContext, message: string, error: unknown): void {
	console.error(`[oh-my-pi boulder] ${message}: ${error instanceof Error ? error.message : String(error)}`);
	if (!context.hasUI) return;
	try {
		context.ui.notify(message, "warning");
	} catch (notifyError) {
		console.error(
			`[oh-my-pi boulder] Failed to notify user: ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`,
		);
	}
}

function isNonBoulderCustomMessage(message: AgentMessage): boolean {
	return message.role === "custom" && message.customType !== BOULDER_RESUME_MESSAGE_TYPE;
}

function compactionGuardActive(state: BoulderSessionState): boolean {
	return Date.now() - state.lastCompactionTime < COMPACTION_GUARD_MS;
}

export function registerBoulder(
	pi: ExtensionAPI,
	getTaskState: BoulderTaskStateReader,
	hasRunningTasks?: () => boolean,
): void {
	const states = createBoulderSessionStateStore();
	const resumeMessages = registerBoulderResumeMessages(pi);
	registerBoulderScheduleEntryRenderer(pi);

	pi.on("input", (event, context) => {
		if (event.source !== "interactive" && event.source !== "rpc") return;
		states.markExternalInformation(context);
		resumeMessages.clear(context);
	});
	pi.on("message_start", (event, context) => {
		if (!states.get(context).activeWait || !isNonBoulderCustomMessage(event.message)) return;
		states.markExternalInformation(context);
		resumeMessages.clear(context);
	});
	pi.on("session_compact", (_event, context) => {
		const state = states.get(context);
		state.lastCompactionTime = Date.now();
		states.cancelWait(context);
	});
	pi.on("session_start", (_event, context) => states.reset(context));
	pi.on("session_tree", (_event, context) => states.reset(context));
	pi.on("session_shutdown", (_event, context) => states.remove(context));

	pi.on("agent_end", (event, context) => {
		try {
			scheduleNextAttempt(event.messages, context, states.get(context), resumeMessages);
		} catch (error) {
			reportBoulderError(context, "Boulder hook failed", error);
		}
	});

	function scheduleNextAttempt(
		messages: AgentMessage[],
		context: ExtensionContext,
		state: BoulderSessionState,
		controller: BoulderResumeController,
	): void {
		if (state.activeWait || context.hasPendingMessages()) return;
		const taskState = getTaskState(context);
		if (taskState.actionableCount === 0) {
			state.episode = undefined;
			return;
		}
		if (hasConfirmStop(messages) || wasAborted(messages) || isAskingQuestion(messages)) return;
		if (compactionGuardActive(state) || hasRunningTasks?.()) return;

		if (looksAborted(messages)) state.lastAbortTime = Date.now();
		const abortDelay = Math.max(0, 3_000 - (Date.now() - state.lastAbortTime));
		const actionableTasks = getActionableTasks(taskState);
		const episodeKey = createBoulderEpisodeKey(actionableTasks);
		if (state.episode?.key !== episodeKey) state.episode = { key: episodeKey, attemptsSent: 0 };
		const limit = getBoulderAttemptLimit(getBoulderContextMode(context));
		if (state.episode.attemptsSent >= limit) return;

		const attempt = state.episode.attemptsSent + 1;
		const delayMs = Math.max(getBoulderAttemptDelayMs(attempt), abortDelay);
		const externalInputEpoch = state.externalInputEpoch;
		const finish = (): void => {
			state.activeWait = undefined;
			if (state.externalInputEpoch !== externalInputEpoch) return;
			if (compactionGuardActive(state) || hasRunningTasks?.()) return;
			const freshState = getTaskState(context);
			if (freshState.actionableCount === 0) {
				state.episode = undefined;
				return;
			}
			const freshTasks = getActionableTasks(freshState);
			if (createBoulderEpisodeKey(freshTasks) !== episodeKey) return;
			if (state.episode?.key !== episodeKey || state.episode.attemptsSent + 1 !== attempt) return;
			state.episode.attemptsSent = attempt;
			try {
				controller.send(context, freshTasks, {
					attempt,
					maxAttempts: limit,
					scheduledDelayMs: delayMs,
				});
			} catch (error) {
				reportBoulderError(context, "Failed to dispatch Boulder resume", error);
			}
		};
		const onError = (error: unknown): void => reportBoulderError(context, "Boulder wait failed", error);
		try {
			appendBoulderScheduleEntry(pi, { attempt, maxAttempts: limit, scheduledDelayMs: delayMs });
		} catch (error) {
			reportBoulderError(context, "Failed to record Boulder schedule", error);
		}
		const handle = context.hasUI
			? startCountdown({
					context,
					delayMs,
					attempt,
					limit,
					actionable: taskState.actionableCount,
					onFinish: finish,
					onError,
					onEscape: () => {
						state.activeWait = undefined;
					},
				})
			: startSilentCountdown(delayMs, finish, onError);
		state.activeWait = { episodeKey, externalInputEpoch, attempt, handle };
	}
}
