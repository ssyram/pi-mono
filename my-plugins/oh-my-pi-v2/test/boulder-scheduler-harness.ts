import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BoulderExtensionMode } from "../hooks/boulder-retry-policy.js";
import { registerBoulder, type BoulderTaskState } from "../hooks/boulder-scheduler.js";
import type { BoulderResumeDetails } from "../hooks/boulder-resume-message.js";
import type { BoulderScheduleEntryData } from "../hooks/boulder-schedule-entry.js";

export type BoulderEventHandler = (event: unknown, context: ExtensionContext) => unknown;

export interface SentBoulderMessage {
	customType: string;
	content: string;
	details?: BoulderResumeDetails;
}

export interface ScheduledBoulderEntry {
	customType: string;
	data: BoulderScheduleEntryData;
}

export interface BoulderSchedulerHarness {
	context: ExtensionContext;
	sent: SentBoulderMessage[];
	scheduleEntries: ScheduledBoulderEntry[];
	statuses: Array<string | undefined>;
	notifications: string[];
	taskReadContexts: ExtensionContext[];
	state: BoulderTaskState;
	emit(event: string, payload: unknown): Promise<void>;
	end(text?: string, stopReason?: "stop" | "aborted" | "error"): Promise<void>;
	setBackgroundRunning(running: boolean): void;
	setPendingMessages(pending: boolean): void;
	failNextDispatch(): void;
	terminalInput(data: string): { consume?: boolean } | undefined;
}

function assistantMessage(text: string, stopReason: "stop" | "aborted" | "error" = "stop"): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 0,
	};
}

export function createBoulderSchedulerHarness(
	mode: BoulderExtensionMode,
	hasUI = false,
): BoulderSchedulerHarness {
	const handlers = new Map<string, BoulderEventHandler[]>();
	const sent: SentBoulderMessage[] = [];
	const scheduleEntries: ScheduledBoulderEntry[] = [];
	const statuses: Array<string | undefined> = [];
	const notifications: string[] = [];
	const taskReadContexts: ExtensionContext[] = [];
	let terminalHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
	let backgroundRunning = false;
	let pendingMessages = false;
	let dispatchShouldFail = false;
	const state: BoulderTaskState = {
		tasks: [{ id: 1, text: "active task", status: "in_progress", updatedAt: 1 }],
		actionableCount: 1,
		readyTasks: [],
	};
	const context = {
		mode,
		hasUI,
		isIdle: () => true,
		hasPendingMessages: () => pendingMessages,
		sessionManager: {},
		ui: {
			setStatus: (_key: string, text: string | undefined) => statuses.push(text),
			notify: (message: string) => notifications.push(message),
			onTerminalInput: (handler: (data: string) => { consume?: boolean } | undefined) => {
				terminalHandler = handler;
				return () => {
					if (terminalHandler === handler) terminalHandler = undefined;
				};
			},
		},
	} as unknown as ExtensionContext;
	const pi = {
		on: (event: string, handler: BoulderEventHandler) => {
			const eventHandlers = handlers.get(event) ?? [];
			eventHandlers.push(handler);
			handlers.set(event, eventHandlers);
		},
		registerMessageRenderer: () => undefined,
		registerEntryRenderer: () => undefined,
		appendEntry: (customType: string, data: BoulderScheduleEntryData) => {
			scheduleEntries.push({ customType, data });
		},
		sendMessage: (message: SentBoulderMessage) => {
			sent.push(message);
			if (!dispatchShouldFail) return;
			dispatchShouldFail = false;
			throw new Error("planned dispatch failure");
		},
	} as unknown as ExtensionAPI;
	registerBoulder(pi, (readerContext) => {
		taskReadContexts.push(readerContext);
		return state;
	}, () => backgroundRunning);
	const emit = async (event: string, payload: unknown): Promise<void> => {
		for (const handler of handlers.get(event) ?? []) await handler(payload, context);
	};

	return {
		context,
		sent,
		scheduleEntries,
		statuses,
		notifications,
		taskReadContexts,
		state,
		emit,
		end: (text = "Finished the current step and should continue working.", stopReason = "stop") =>
			emit("agent_end", { messages: [assistantMessage(text, stopReason)] }),
		setBackgroundRunning(running) {
			backgroundRunning = running;
		},
		setPendingMessages(pending) {
			pendingMessages = pending;
		},
		failNextDispatch() {
			dispatchShouldFail = true;
		},
		terminalInput: (data) => terminalHandler?.(data),
	};
}
