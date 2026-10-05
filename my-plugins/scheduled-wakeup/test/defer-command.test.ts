import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleLoopCommand, type LoopV2Runtime } from "../src/loop-command-handler.js";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { DuePoller, type TimerHandle } from "../src/v2/due-poller.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import { parseLoopV2Command } from "../src/v2/parse-v2-command.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";
import { UserLoopV2Commands } from "../src/v2/user-commands.js";

const NOW = 1_700_000_000_000;
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

describe("defer command delivery", () => {
	it("parses, persists, notifies and re-arms before resuming the original interval", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({ prompt: "tick", schedule: { kind: "interval", intervalMs: 1_000 } });
		setup.poller.start();
		assert.equal(setup.timer.delay, 1_000);
		setup.run(`defer ${task.id} 10s`);
		assert.equal(setup.timer.cleared, 1);
		assert.equal(setup.timer.delay, 11_000);
		assert.match(setup.notifications.at(-1)?.message ?? "", /Deferred .*next delivery only; schedule unchanged/);
		assert.equal(setup.notifications.at(-1)?.type, "info");
		assert.equal(setup.core.snapshotSessionState().tasks[0]?.progress.runCount, 0);
		setup.clock.value += 1_000;
		assert.deepEqual(setup.core.runDue(() => assert.fail("old next run must not deliver")), []);
		setup.clock.value = NOW + 11_000;
		setup.fire();
		assert.deepEqual(setup.delivered, ["tick"]);
		assert.equal(setup.timer.delay, 1_000);
		assert.deepEqual(setup.core.snapshotSessionState().tasks[0]?.progress, { status: "active", nextRunAt: NOW + 12_000, runCount: 1, lastRunAt: setup.clock.value });
	});

	it("accepts a later absolute time and leaves timer and progress alone on rejected commands", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({ prompt: "once", schedule: { kind: "once", runAt: NOW + 60_000 } });
		setup.poller.start();
		for (const args of [`defer ${task.id} ${new Date(NOW + 30_000).toISOString()}`, "defer session:missing 10s", `defer ${task.id}`, `defer ${task.id} 9999999999999s`]) {
			const before = setup.core.snapshotSessionState();
			setup.run(args);
			assert.equal(setup.notifications.at(-1)?.type, "warning");
			assert.equal(setup.timer.cleared, 0);
			assert.equal(setup.timer.delay, 60_000);
			assert.deepEqual(setup.core.snapshotSessionState(), before);
		}
		setup.run(`defer ${task.id} ${new Date(NOW + 120_000).toISOString()}`);
		assert.equal(setup.timer.delay, 120_000);
		assert.match(setup.notifications.at(-1)?.message ?? "", new RegExp(new Date(NOW + 120_000).toISOString()));
		setup.clock.value += 120_000;
		setup.fire();
		assert.deepEqual(setup.delivered, ["once"]);
		assert.equal(setup.timer.handler, undefined);
	});
});

function createSetup() {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-defer-command-"));
	const entries: SessionEntryLike[] = [];
	const clock = { value: NOW };
	const core = new LoopV2Core({
		sessionId: "command-session", workspaceRoot: join(root, "workspace"), globalRoot: join(root, "global"), now: () => clock.value,
		sessionEntries: { getBranch: () => entries, appendEntry: (customType, data) => { entries.push({ type: "custom", customType, data }); } },
	});
	const timer: { delay: number | undefined; handler: (() => void) | undefined; cleared: number } = { delay: undefined, handler: undefined, cleared: 0 };
	const handle: TimerHandle = {};
	const delivered: string[] = [];
	const poller = new DuePoller({
		core, now: () => clock.value, deliver: (target) => { delivered.push(target.prompt); },
		timers: {
			set: (handler, timeoutMs) => { timer.handler = handler; timer.delay = timeoutMs; return handle; },
			clear: () => { timer.handler = undefined; timer.cleared += 1; },
		},
	});
	cleanups.push(() => { poller.dispose(); rmSync(root, { recursive: true, force: true }); });
	const notifications: { message: string; type: string }[] = [];
	const ctx = { hasUI: true, ui: { notify: (message: string, type: string) => { notifications.push({ message, type }); } } } as unknown as ExtensionCommandContext;
	const runtime: LoopV2Runtime = { core, user: new UserLoopV2Commands(core), actions: new AiSessionActions(core), poller, cwd: root };
	return {
		core, clock, poller, timer, delivered, notifications,
		run: (args: string) => handleLoopCommand({} as ExtensionAPI, parseLoopV2Command(args, clock.value), runtime, ctx, () => poller.reschedule()),
		fire: () => { const handler = timer.handler; assert.ok(handler); timer.handler = undefined; handler(); },
	};
}
