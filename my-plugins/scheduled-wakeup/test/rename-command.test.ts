import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	handleLoopCommand,
	type LoopV2Runtime,
} from "../src/loop-command-handler.js";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import { parseLoopV2Command } from "../src/v2/parse-v2-command.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";
import { UserLoopV2Commands } from "../src/v2/user-commands.js";

const NOW = 1_700_000_000_000;
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("rename command dispatch", () => {
	it("renames by id or unique name and clears with --clear", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({
			prompt: "tick",
			schedule: { kind: "interval", intervalMs: 60_000 },
		});
		setup.run(`rename ${task.id} patrol`);
		assert.match(
			setup.notifications.at(-1)?.message ?? "",
			new RegExp(`Named ${task.id} "patrol"`),
		);
		assert.equal(
			setup.core.snapshotSessionState().tasks[0]?.definition.name,
			"patrol",
		);
		setup.run("rename patrol patrol two");
		assert.equal(
			setup.core.snapshotSessionState().tasks[0]?.definition.name,
			"patrol two",
		);
		setup.run(`rename ${task.id} --clear`);
		assert.equal(
			setup.core.snapshotSessionState().tasks[0]?.definition.name,
			undefined,
		);
	});

	it("rejects a name shared by a session task and a shared definition", () => {
		const setup = createSetup();
		const task = setup.core.createSessionTask({
			prompt: "session side",
			schedule: { kind: "interval", intervalMs: 60_000 },
			name: "dup",
		});
		const definition = setup.user.defineSharedTask("workspace", {
			prompt: "shared side",
			schedule: { kind: "interval", intervalMs: 60_000 },
			name: "dup",
		});
		setup.run("rename dup renamed");
		const notification = setup.notifications.at(-1);
		assert.equal(notification?.type, "warning");
		assert.match(notification?.message ?? "", /ambiguous name "dup" matches/);
		assert.match(notification?.message ?? "", new RegExp(task.id));
		assert.match(notification?.message ?? "", new RegExp(definition.id));
		assert.equal(
			setup.core.snapshotSessionState().tasks[0]?.definition.name,
			"dup",
		);
		assert.equal(setup.core.listDefinitions(["workspace"])[0]?.name, "dup");
	});
});

function createSetup() {
	const root = mkdtempSync(join(tmpdir(), "loop-rename-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	const entries: SessionEntryLike[] = [];
	const core = new LoopV2Core({
		sessionId: "rename-session",
		sessionEntries: {
			getBranch: () => entries,
			appendEntry: (customType, data) => {
				entries.push({ type: "custom", customType, data });
			},
		},
		workspaceRoot: join(root, "workspace"),
		globalRoot: join(root, "global"),
		now: () => NOW,
	});
	const notifications: { message: string; type: string }[] = [];
	const ctx = {
		hasUI: true,
		ui: {
			notify: (message: string, type: string) => notifications.push({ message, type }),
		},
	} as unknown as ExtensionCommandContext;
	const runtime: LoopV2Runtime = {
		core,
		dispatcher: { dispatch: () => assert.fail("rename must not dispatch"), list: () => [], dispose() {} },
		widget: { refresh() {}, show: async () => {}, setVisible() {}, dispose() {} },
		dispose() {},
		user: new UserLoopV2Commands(core),
		actions: new AiSessionActions(core),
		poller: undefined,
		boulderSync: undefined,
		cwd: root,
		sessionManager: {} as ExtensionCommandContext["sessionManager"],
		sessionId: "rename-session",
	};
	return {
		core,
		user: runtime.user,
		notifications,
		run: (args: string) =>
			handleLoopCommand(
				{} as ExtensionAPI,
				parseLoopV2Command(args, NOW),
				runtime,
				ctx,
				() => undefined,
			),
	};
}
