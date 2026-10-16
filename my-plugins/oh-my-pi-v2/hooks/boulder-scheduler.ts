import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { checkBoulderInhibition } from "../boulder-inhibition/check-inhibition.js";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";
import {
	type BoulderBackgroundWork,
	createBoulderBackgroundWork,
} from "./boulder-background-work.js";
import { startCountdown, startSilentCountdown } from "./boulder-countdown.js";
import { appendBoulderInfoEntry } from "./boulder-info-entry.js";
import { hasConfirmStop, wasAborted } from "./boulder-message-suppression.js";
import {
	BOULDER_RESUME_MESSAGE_TYPE,
	type BoulderResumeController,
	type BoulderResumeTask,
	registerBoulderResumeMessages,
} from "./boulder-resume-message.js";
import {
	getBoulderAttemptDelayMs,
	getBoulderAttemptLimit,
	getBoulderContextMode,
} from "./boulder-retry-policy.js";
import {
	appendBoulderScheduleEntry,
	registerBoulderScheduleEntryRenderer,
} from "./boulder-schedule-entry.js";
import {
	type BoulderSessionState,
	createBoulderSessionStateStore,
} from "./boulder-session-state.js";

const COMPACTION_GUARD_MS = 10_000;

export interface BoulderTask extends BoulderResumeTask {
	updatedAt: number;
}

export interface BoulderTaskState {
	tasks: BoulderTask[];
	actionableCount: number;
	readyTasks: BoulderTask[];
}

export type BoulderTaskStateReader = (
	context: ExtensionContext,
) => BoulderTaskState;

export function getActionableTasks(state: BoulderTaskState): BoulderTask[] {
	return [
		...state.tasks.filter((task) => task.status === "in_progress"),
		...state.readyTasks,
	];
}

export function createBoulderEpisodeKey(tasks: BoulderTask[]): string {
	return [...tasks]
		.sort((left, right) => left.id - right.id)
		.map((task) => `${task.id}:${task.status}:${task.updatedAt}`)
		.join("|");
}

export interface BoulderHandle {
	cancelWait(context: ExtensionContext): void;
}

export function registerBoulder(
	pi: ExtensionAPI,
	getTaskState: BoulderTaskStateReader,
	backgroundWork: BoulderBackgroundWork = createBoulderBackgroundWork(),
): BoulderHandle {
	const states = createBoulderSessionStateStore();
	const resumeMessages = registerBoulderResumeMessages(pi);
	registerBoulderScheduleEntryRenderer(pi);

	pi.on("input", (event, context) => {
		if (event.source !== "interactive" && event.source !== "rpc") return;
		states.markExternalInformation(context);
		resumeMessages.clear(context);
	});
	pi.on("message_start", (event, context) => {
		if (
			!states.get(context).activeWait ||
			!isExternalCustomMessage(event.message)
		)
			return;
		states.markExternalInformation(context);
		resumeMessages.clear(context);
	});
	pi.on("session_compact", (_event, context) => {
		states.get(context).lastCompactionTime = Date.now();
	});
	pi.on("session_start", (_event, context) => states.reset(context));
	pi.on("session_tree", (_event, context) => states.reset(context));
	pi.on("session_shutdown", (_event, context) => states.remove(context));

	pi.on("agent_start", (_event, context) => states.cancelWait(context));
	pi.on("agent_end", (event, context) => {
		states.get(context).lastAgentEndMessages = event.messages;
	});
	pi.on("agent_settled", (_event, context) => {
		const state = states.get(context);
		if (!state.lastAgentEndMessages) return;
		try {
			scheduleNextAttempt(
				state.lastAgentEndMessages,
				context,
				state,
				resumeMessages,
			);
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
		if (hasConfirmStop(messages) || wasAborted(messages)) return;
		if (compactionGuardActive(state) || backgroundWork.isActive(context))
			return;
		if (boulderInhibited(context)) return;

		const actionableTasks = getActionableTasks(taskState);
		const episodeKey = createBoulderEpisodeKey(actionableTasks);
		if (state.episode?.key !== episodeKey)
			state.episode = { key: episodeKey, attemptsSent: 0 };
		const limit = getBoulderAttemptLimit(getBoulderContextMode(context));
		if (state.episode.attemptsSent >= limit) return;

		const attempt = state.episode.attemptsSent + 1;
		const delayMs = getBoulderAttemptDelayMs(attempt);
		const externalInputEpoch = state.externalInputEpoch;
		const finish = (): void => {
			state.activeWait = undefined;
			if (
				!context.isIdle() ||
				state.externalInputEpoch !== externalInputEpoch ||
				context.hasPendingMessages()
			)
				return;
			if (compactionGuardActive(state) || backgroundWork.isActive(context))
				return;
			if (boulderInhibited(context)) return;
			const freshState = getTaskState(context);
			if (freshState.actionableCount === 0) {
				state.episode = undefined;
				return;
			}
			state.episode = {
				key: createBoulderEpisodeKey(getActionableTasks(freshState)),
				attemptsSent: attempt,
			};
			try {
				controller.send(context, getActionableTasks(freshState), {
					attempt,
					maxAttempts: limit,
					scheduledDelayMs: delayMs,
				});
			} catch (error) {
				reportBoulderError(context, "Failed to dispatch Boulder resume", error);
			}
		};
		const onError = (error: unknown): void =>
			reportBoulderError(context, "Boulder wait failed", error);
		appendSchedule(context, attempt, limit, delayMs);
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

	function appendSchedule(
		context: ExtensionContext,
		attempt: number,
		maxAttempts: number,
		scheduledDelayMs: number,
	): void {
		try {
			appendBoulderScheduleEntry(pi, {
				attempt,
				maxAttempts,
				scheduledDelayMs,
			});
		} catch (error) {
			reportBoulderError(context, "Failed to record Boulder schedule", error);
		}
	}

	function boulderInhibited(context: ExtensionContext): boolean {
		const snapshot = checkBoulderInhibition(
			{ getBranch: () => context.sessionManager.getBranch() },
			(text) => {
				appendBoulderInfoEntry(pi, { tone: "info", text });
			},
		);
		return snapshot.inhibited;
	}

	return {
		cancelWait: (context) => states.cancelWait(context),
	};
}

function isExternalCustomMessage(message: AgentMessage): boolean {
	return (
		message.role === "custom" &&
		message.customType !== BOULDER_RESUME_MESSAGE_TYPE
	);
}

function compactionGuardActive(state: BoulderSessionState): boolean {
	return Date.now() - state.lastCompactionTime < COMPACTION_GUARD_MS;
}

function reportBoulderError(
	context: ExtensionContext,
	message: string,
	error: unknown,
): void {
	reportBoulderDiagnostic(
		`[oh-my-pi boulder] ${message}: ${describeThrown(error)}`,
	);
	try {
		if (!context.hasUI) return;
		context.ui.notify(message, "warning");
	} catch (notifyError) {
		reportBoulderDiagnostic(
			`[oh-my-pi boulder] Failed to notify user: ${describeThrown(notifyError)}`,
		);
	}
}
