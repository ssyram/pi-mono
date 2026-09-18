import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import scheduledWakeup from "../src/extension.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { SessionLoopState } from "../src/v2/model.js";
import { SESSION_LOOP_STATE_ENTRY_TYPE } from "../src/v2/session-entry-adapter.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";

const RUNNER_ENV = "PI_SCHEDULED_WAKEUP_RUNNER";
const PRELOAD_NOW = Date.now() - 5_000;

describe("scheduledWakeup v2 extension lifecycle", () => {
	afterEach(() => {
		delete process.env[RUNNER_ENV];
	});

	it("does not start the poller in print mode but keeps commands working", async () => {
		const setup = createSetup({ mode: "print" });
		pushSessionTask(setup.branch, "first", { kind: "once", runAt: PRELOAD_NOW });
		await setup.start();

		await wait(80);
		assert.deepEqual(setup.sent, []);

		await setup.runLoop("add 1h hello from print");
		const snapshots = setup.appendedSnapshots();
		assert.equal(snapshots.length, 1);
		assert.equal(snapshots[0]?.tasks.length, 2);
		assert.equal(snapshots[0]?.tasks[1]?.definition.prompt, "hello from print");
		assert.deepEqual(snapshots[0]?.tasks[1]?.definition.schedule, { kind: "interval", intervalMs: 3_600_000 });
		assert.ok(snapshots[0]?.tasks[1]?.definition.id.startsWith("session:"));
	});

	it("starts the poller in runner mode and delivers overdue work", async () => {
		process.env[RUNNER_ENV] = "1";
		const setup = createSetup({ mode: "json" });
		pushSessionTask(setup.branch, "overdue", { kind: "once", runAt: PRELOAD_NOW });
		await setup.start();

		await wait(80);
		assert.deepEqual(setup.sent.map((message) => message.content), ["overdue"]);
		assert.equal(setup.sent[0]?.options, undefined);
	});

	it("delivers in tui mode and clears pending timers on session_shutdown", async () => {
		const setup = createSetup({ mode: "tui" });
		pushSessionTask(setup.branch, "first", { kind: "once", runAt: PRELOAD_NOW });
		pushSessionTask(setup.branch, "future", { kind: "once", runAt: Date.now() + 500 });
		await setup.start();

		await wait(100);
		assert.deepEqual(setup.sent.map((message) => message.content), ["first"]);
		assert.equal(setup.notifications.at(-1), "Scheduled wakeup loaded");

		pushSessionTask(setup.branch, "third", { kind: "once", runAt: PRELOAD_NOW });
		await setup.shutdown();
		await wait(700);
		assert.deepEqual(setup.sent.map((message) => message.content), ["first"]);
	});

	it("reconciles stale registrations and wires autocomplete to live core ids", async () => {
		const setup = createSetup({ mode: "tui" });
		pushRegistration(setup.branch, "registration:workspace:missing", "workspace:missing");
		await setup.start();

		const snapshots = setup.appendedSnapshots();
		assert.equal(snapshots.length, 1);
		assert.deepEqual(snapshots[0]?.registrations, []);
		assert.equal(setup.autocompleteFactories.length, 1);

		await setup.runLoop("add 1h autocomplete probe");
		const factory = setup.autocompleteFactories[0];
		assert.ok(factory);
		const values = await suggest(factory, "/loop stop ");
		assert.equal(values.some((value) => value.startsWith("session:")), true);
	});
});

type SentMessage = { content: string; options?: { deliverAs?: string } };
type AutocompleteFactory = (current: unknown) => {
	getSuggestions(lines: string[], row: number, col: number, opts: { signal: AbortSignal; force?: boolean }): Promise<{ items: { value: string }[] } | null>;
};

function createSetup(options: { mode: "print" | "json" | "tui" | "rpc" }): {
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
	const branch: SessionEntryLike[] = [];
	const appended: { customType: string; data: unknown }[] = [];
	const sent: SentMessage[] = [];
	const notifications: string[] = [];
	const autocompleteFactories: AutocompleteFactory[] = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
	let loopHandler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;

	const pi = {
		on: (eventName: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => {
			handlers.set(eventName, handler);
		},
		registerCommand: (_name: string, command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
			loopHandler = command.handler;
		},
		registerTool: () => undefined,
		sendUserMessage: (content: string, sendOptions?: { deliverAs?: string }) => {
			sent.push(sendOptions === undefined ? { content } : { content, options: sendOptions });
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
			getBranch: () => branch,
		},
		ui: {
			notify: (message: string) => notifications.push(message),
			addAutocompleteProvider: (factory: AutocompleteFactory) => autocompleteFactories.push(factory),
		},
	} as unknown as ExtensionContext;

	return {
		branch,
		sent,
		notifications,
		autocompleteFactories,
		appendedSnapshots: () => appended.map((entry) => entry.data as SessionLoopState | undefined),
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

function pushSessionTask(branch: SessionEntryLike[], prompt: string, schedule: { kind: "once"; runAt: number }): void {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-preload-"));
	const port: SessionEntryPort = {
		getBranch: () => branch,
		appendEntry: (customType, data) => {
			branch.push({ type: "custom", customType, data });
		},
	};
	new LoopV2Core({ sessionId: "preload-session", sessionEntries: port, workspaceRoot: join(root, "workspace"), globalRoot: join(root, "global"), now: () => PRELOAD_NOW }).createSessionTask({ prompt, schedule });
}

function pushRegistration(branch: SessionEntryLike[], registrationId: string, definitionId: string): void {
	branch.push({
		type: "custom",
		customType: SESSION_LOOP_STATE_ENTRY_TYPE,
		data: {
			version: 1,
			tasks: [],
			registrations: [{ id: registrationId, reference: { scope: "workspace", definitionId }, progress: { status: "active", nextRunAt: PRELOAD_NOW, runCount: 0 }, registeredAt: PRELOAD_NOW }],
		},
	});
}

async function suggest(factory: AutocompleteFactory, line: string): Promise<string[]> {
	const provider = factory({ getSuggestions: async () => null, applyCompletion: () => ({ lines: [] as string[], cursorLine: 0, cursorCol: 0 }) });
	const result = await provider.getSuggestions([line], 0, line.length, { signal: new AbortController().signal, force: true });
	return result?.items.map((item) => item.value) ?? [];
}

async function wait(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}
