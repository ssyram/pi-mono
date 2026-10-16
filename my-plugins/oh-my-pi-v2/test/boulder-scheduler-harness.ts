import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BoulderExtensionMode } from "../hooks/boulder-retry-policy.js";
import { registerBoulder, type BoulderTaskState } from "../hooks/boulder-scheduler.js";
import { BOULDER_INFO_ENTRY_TYPE } from "../hooks/boulder-info-entry.js";
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
	infoEntries: string[];
	taskReadContexts: ExtensionContext[];
	state: BoulderTaskState;
	emit(event: string, payload: unknown): Promise<void>;
	setBranchEntries(entries: Array<{ type: string; customType?: string; data?: unknown }>): void;
	end(text?: string, stopReason?: "stop" | "aborted" | "error"): Promise<void>;
	settle(): Promise<void>;
	setIdle(idle: boolean): void;
	setLiveBackgroundWork(active: boolean): void;
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
	const infoEntries: string[] = [];
	const taskReadContexts: ExtensionContext[] = [];
	let terminalHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
	let idle = true;
	let liveBackgroundWork = false;
	let pendingMessages = false;
	let dispatchShouldFail = false;
	let branchEntries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const state: BoulderTaskState = {
		tasks: [{ id: 1, text: "active task", status: "in_progress", updatedAt: 1 }],
		actionableCount: 1,
		readyTasks: [],
	};
	const context = {
		mode,
		hasUI,
		isIdle: () => idle,
		hasPendingMessages: () => pendingMessages,
		sessionManager: {
			getSessionFile: () => "test-session",
			getSessionId: () => "test-session",
			getBranch: () => [...branchEntries],
		},
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
		appendEntry: (customType: string, data: unknown) => {
			if (customType === BOULDER_INFO_ENTRY_TYPE) {
				infoEntries.push(String((data as { text?: unknown }).text ?? ""));
				return;
			}
			scheduleEntries.push({ customType, data: data as BoulderScheduleEntryData });
		},
		sendMessage: (message: SentBoulderMessage) => {
			sent.push(message);
			if (!dispatchShouldFail) return;
			dispatchShouldFail = false;
			throw new Error("planned dispatch failure");
		},
	} as unknown as ExtensionAPI;
	registerBoulder(
		pi,
		(readerContext) => {
			taskReadContexts.push(readerContext);
			return state;
		},
		{ isActive: () => liveBackgroundWork },
	);
	const emit = async (event: string, payload: unknown): Promise<void> => {
		for (const handler of handlers.get(event) ?? []) await handler(payload, context);
	};

	return {
		context,
		sent,
		scheduleEntries,
		statuses,
		notifications,
		infoEntries,
		taskReadContexts,
		state,
		emit,
		setBranchEntries(entries) {
			branchEntries = entries;
		},
		end: async (text = "Finished the current step and should continue working.", stopReason = "stop") => {
			await emit("agent_start", {});
			await emit("agent_end", { messages: [assistantMessage(text, stopReason)] });
			await emit("agent_settled", {});
		},
		settle: () => emit("agent_settled", {}),
		setIdle(nextIdle) {
			idle = nextIdle;
		},
		setLiveBackgroundWork(active) {
			liveBackgroundWork = active;
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
