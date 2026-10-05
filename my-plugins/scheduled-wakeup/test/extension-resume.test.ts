import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import scheduledWakeup from "../src/extension.js";
import type { SessionLoopState } from "../src/v2/model.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";

const NOW = 1_700_000_000_000;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("extension close and resume wiring", () => {
	it("resumes the remaining three minutes before arming a real poller", async (t) => {
		t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
		const setup = createSetup();
		await setup.start();
		await setup.run("add 10m tick");
		t.mock.timers.tick(420_000);
		await setup.shutdown();
		assert.deepEqual(setup.snapshot().tasks[0]?.progress, { status: "active", nextRunAt: NOW + 600_000, runCount: 0, suspendedAt: NOW + 420_000 });
		t.mock.timers.tick(86_400_000);
		setup.load();
		await setup.start("resume");
		assert.deepEqual(setup.snapshot().tasks[0]?.progress, { status: "active", nextRunAt: Date.now() + 180_000, runCount: 0 });
		t.mock.timers.tick(179_999);
		assert.deepEqual(setup.sent, []);
		t.mock.timers.tick(1);
		assert.deepEqual(setup.sent, ["tick"]);
		assert.equal(setup.snapshot().tasks[0]?.progress.runCount, 1);
	});

	it("expires a one-shot before startup timers can deliver it", async (t) => {
		t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
		const setup = createSetup();
		await setup.start();
		await setup.run("add once 1m expired prompt");
		t.mock.timers.tick(10_000);
		await setup.shutdown();
		t.mock.timers.tick(120_000);
		setup.load();
		await setup.start("resume");
		t.mock.timers.tick(0);
		assert.deepEqual(setup.sent, []);
		assert.deepEqual(setup.snapshot().tasks[0]?.progress, { status: "expired", expiredAt: NOW + 130_000, runCount: 0 });
		await setup.run("list");
		assert.deepEqual(setup.sent, []);
	});

	it("keeps a deferred one-shot's absolute deadline across reload", async (t) => {
		t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
		const setup = createSetup();
		await setup.start();
		await setup.run("add once 1m deferred prompt");
		const id = setup.snapshot().tasks[0]?.definition.id;
		assert.ok(id);
		await setup.run(`defer ${id} 2m`);
		t.mock.timers.tick(30_000);
		await setup.shutdown("reload");
		t.mock.timers.tick(90_000);
		setup.load();
		await setup.start("reload");
		assert.deepEqual(setup.snapshot().tasks[0]?.progress, { status: "active", nextRunAt: NOW + 180_000, runCount: 0 });
		t.mock.timers.tick(59_999);
		assert.deepEqual(setup.sent, []);
		t.mock.timers.tick(1);
		assert.deepEqual(setup.sent, ["deferred prompt"]);
	});
});

function createSetup() {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-resume-extension-"));
	const branch: SessionEntryLike[] = [];
	const sent: string[] = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
	let command: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
	const pi = {
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => { handlers.set(event, handler); },
		registerCommand: (_name: string, definition: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => { command = definition.handler; },
		registerTool: () => undefined,
		appendEntry: (customType: string, data: unknown) => { branch.push({ type: "custom", customType, data }); },
		sendUserMessage: (prompt: string) => { sent.push(prompt); },
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: root, mode: "tui", hasUI: false, isIdle: () => true,
		sessionManager: { getSessionId: () => "restart-session", getBranch: () => branch }, ui: {},
	} as unknown as ExtensionContext;
	const emit = async (type: string, reason: string) => { const handler = handlers.get(type); assert.ok(handler); await handler({ type, reason }, ctx); };
	const shutdown = (reason = "quit") => emit("session_shutdown", reason);
	cleanups.push(async () => { await shutdown(); rmSync(root, { recursive: true, force: true }); });
	scheduledWakeup(pi);
	return {
		sent, shutdown, load: () => scheduledWakeup(pi), start: (reason = "startup") => emit("session_start", reason),
		run: async (args: string) => { assert.ok(command); await command(args, ctx as ExtensionCommandContext); },
		snapshot: () => { const entry = branch.at(-1); assert.ok(entry); return entry.data as SessionLoopState; },
	};
}
