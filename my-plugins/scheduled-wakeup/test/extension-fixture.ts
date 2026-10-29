import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import scheduledWakeup from "../src/extension.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionLoopState } from "../src/v2/model.js";
import type {
	SessionEntryLike,
	SessionEntryPort,
} from "../src/v2/session-entry-adapter.js";
import { SESSION_LOOP_STATE_ENTRY_TYPE } from "../src/v2/session-entry-adapter.js";
import { captureWakeupPrompt } from "./capture-wakeup-prompt.js";

export const PRELOAD_NOW = Date.now() - 5_000;

type SentMessage = { content: string; options?: { deliverAs?: string } };
export type AutocompleteFactory = (current: unknown) => {
	getSuggestions(
		lines: string[],
		row: number,
		col: number,
		opts: { signal: AbortSignal; force?: boolean },
	): Promise<{ items: { value: string }[] } | null>;
};

export function createSetup(options: {
	mode: "print" | "json" | "tui" | "rpc";
}): {
	branch: SessionEntryLike[];
	sent: SentMessage[];
	notifications: string[];
	autocompleteFactories: AutocompleteFactory[];
	appendedSnapshots(): (SessionLoopState | undefined)[];
	start(): Promise<void>;
	shutdown(): Promise<void>;
	runLoop(args: string): Promise<void>;
} {
	const cwd = mkdtempSync(join(tmpdir(), "scheduled-wakeup-ext-"));
	const sessionFile = join(cwd, "session.jsonl");
	writeFileSync(sessionFile, "");
	const branch: SessionEntryLike[] = [];
	const appended: { customType: string; data: unknown }[] = [];
	const sent: SentMessage[] = [];
	const notifications: string[] = [];
	const autocompleteFactories: AutocompleteFactory[] = [];
	const handlers = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => Promise<void>
	>();
	let loopHandler:
		| ((args: string, ctx: ExtensionCommandContext) => Promise<void>)
		| undefined;

	const pi = {
		registerMessageRenderer: () => undefined,
		registerToolRenderer: () => undefined,
		events: createEventBus(),
		on: (
			eventName: string,
			handler: (event: unknown, ctx: ExtensionContext) => Promise<void>,
		) => {
			handlers.set(eventName, handler);
		},
		registerCommand: (
			_name: string,
			command: {
				handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
			},
		) => {
			loopHandler = command.handler;
		},
		registerTool: () => undefined,
		sendUserMessage: () => assert.fail("must use custom messages"),
		sendMessage: (
			message: { customType: string; content: unknown },
			sendOptions?: { deliverAs?: string; triggerTurn?: boolean },
		) => {
			assert.equal(sendOptions?.triggerTurn, true);
			sent.push({
				content: captureWakeupPrompt(message),
				options: sendOptions,
			});
		},
		appendEntry: (customType: string, data?: unknown) => {
			appended.push({ customType, data });
			branch.push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	scheduledWakeup(pi);

	const ctx = {
		cwd,
		mode: options.mode,
		hasUI: options.mode === "tui" || options.mode === "rpc",
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getSessionId: () => "extension-session",
			getSessionFile: () => sessionFile,
			getBranch: () => branch,
		},
		ui: {
			setWidget: () => undefined,
			notify: (message: string) => notifications.push(message),
			addAutocompleteProvider: (factory: AutocompleteFactory) =>
				autocompleteFactories.push(factory),
		},
	} as unknown as ExtensionContext;

	return {
		branch,
		sent,
		notifications,
		autocompleteFactories,
		appendedSnapshots: () =>
			appended.map((entry) => entry.data as SessionLoopState | undefined),
		start: async () => {
			const handler = handlers.get("session_start");
			assert.ok(handler);
			await handler({ type: "session_start", reason: "startup" }, ctx);
		},
		shutdown: async () => {
			const handler = handlers.get("session_shutdown");
			assert.ok(handler);
			await handler({ type: "session_shutdown" }, ctx);
		},
		runLoop: async (args: string) => {
			assert.ok(loopHandler);
			await loopHandler(args, ctx as ExtensionCommandContext);
		},
	};
}

export function pushSessionTask(
	branch: SessionEntryLike[],
	prompt: string,
	schedule: { kind: "once"; runAt: number },
): void {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-preload-"));
	const port: SessionEntryPort = {
		getBranch: () => branch,
		appendEntry: (customType, data) => {
			branch.push({ type: "custom", customType, data });
		},
	};
	new LoopV2Core({
		sessionId: "preload-session",
		sessionEntries: port,
		workspaceRoot: join(root, "workspace"),
		globalRoot: join(root, "global"),
		now: () => PRELOAD_NOW,
	}).createSessionTask({ prompt, schedule });
}

export function pushRegistration(
	branch: SessionEntryLike[],
	registrationId: string,
	definitionId: string,
): void {
	branch.push({
		type: "custom",
		customType: SESSION_LOOP_STATE_ENTRY_TYPE,
		data: {
			version: 1,
			tasks: [],
			registrations: [
				{
					id: registrationId,
					reference: { scope: "workspace", definitionId },
					progress: { status: "active", nextRunAt: PRELOAD_NOW, runCount: 0 },
					registeredAt: PRELOAD_NOW,
				},
			],
		},
	});
}
