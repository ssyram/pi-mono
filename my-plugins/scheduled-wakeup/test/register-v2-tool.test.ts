import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import type { ActiveTask } from "../src/v2/model.js";
import type { SessionEntryLike, SessionEntryPort } from "../src/v2/session-entry-adapter.js";
import { registerScheduledWakeupV2Tool } from "../src/v2/register-v2-tool.js";

const NOW = 1_700_000_000_000;

describe("registerScheduledWakeupV2Tool", () => {
	it("converts delay, at, and interval into schedules and calls onMutation", async () => {
		const setup = createSetup();
		const delay = await setup.execute({ action: "add", prompt: "one-shot soon", delay: "10m" });
		assert.equal(delay.details.ok, true);
		assert.match(delay.details.message, /Added session task/);

		const at = await setup.execute({ action: "add", prompt: "one-shot later", at: "2099-01-01T00:00:00Z" });
		assert.equal(at.details.ok, true);

		const interval = await setup.execute({ action: "add", prompt: "recurring", interval: "1h" });
		assert.equal(interval.details.ok, true);

		const schedules = setup.core.snapshotSessionState().tasks.map((task) => task.definition.schedule);
		assert.deepEqual(schedules, [
			{ kind: "once", runAt: NOW + 600_000 },
			{ kind: "once", runAt: Date.parse("2099-01-01T00:00:00Z") },
			{ kind: "interval", intervalMs: 3_600_000 },
		]);
		assert.equal(setup.mutations, 3);
	});

	it("rejects unusable add inputs with precise messages", async () => {
		const setup = createSetup();
		const none = await setup.execute({ action: "add", prompt: "no time" });
		assert.match(none.details.message, /exactly one of delay, at, or interval/);
		const two = await setup.execute({ action: "add", prompt: "two times", delay: "5m", interval: "5m" });
		assert.match(two.details.message, /exactly one of delay, at, or interval/);
		const invalid = await setup.execute({ action: "add", prompt: "bad unit", delay: "5x" });
		assert.match(invalid.details.message, /invalid delay/);
		const past = await setup.execute({ action: "add", prompt: "past", at: "2000-01-01T00:00:00Z" });
		assert.match(past.details.message, /invalid or past at/);
		assert.equal(setup.mutations, 4);
		assert.equal(setup.core.snapshotSessionState().tasks.length, 0);
	});

	it("forwards scope and force to the session-only action surface, which rejects them", async () => {
		const setup = createSetup();
		const scoped = await setup.execute({ action: "add", prompt: "escalate", delay: "5m", scope: "global" });
		assert.equal(scoped.details.ok, false);
		assert.match(scoped.details.message, /do not accept scope/);

		const definition = setup.core.createSharedDefinition("workspace", { prompt: "shared", schedule: { kind: "once", runAt: NOW } });
		const registration = setup.core.registerSharedDefinition("workspace", definition.id);
		const forced = await setup.execute({ action: "delete", id: registration.id, force: true });
		assert.equal(forced.details.ok, false);
		assert.match(forced.details.message, /scope or force/);

		const deleted = await setup.execute({ action: "delete", id: registration.id });
		assert.equal(deleted.details.ok, true);
		assert.match(deleted.details.message, /Deleted shared definition/);
	});

	it("cancels by id, lists without mutating, and keeps AiSessionActionResult details", async () => {
		const setup = createSetup();
		const added = await setup.execute({ action: "add", prompt: "cancel me", delay: "5m" });
		const first: ActiveTask | undefined = added.details.active[0];
		const id = first?.kind === "session" ? first.task.definition.id : "";
		assert.match(id, /^session:/);
		const cancelled = await setup.execute({ action: "cancel", id });
		assert.equal(cancelled.details.ok, true);
		assert.match(cancelled.details.message, new RegExp(`Cancelled ${id}`));

		const mutationsBefore = setup.mutations;
		const listed = await setup.execute({ action: "list" });
		assert.equal(listed.details.ok, true);
		assert.equal(setup.mutations, mutationsBefore);
		assert.deepEqual(listed.details, { ok: true, message: "Listed active session work.", active: [] });

		const missing = await setup.execute({ action: "cancel", id: "session:none" });
		assert.equal(missing.details.ok, false);
		assert.match(missing.details.message, /missing/);
	});
});

type ToolResult = {
	content: ReadonlyArray<{ type: string; text: string }>;
	details: { ok: boolean; message: string; active: readonly ActiveTask[] };
};

type CapturedTool = {
	execute(toolCallId: string, params: Record<string, unknown>, signal: undefined, onUpdate: undefined, ctx: ExtensionContext): Promise<ToolResult>;
};

function createSetup(): { core: LoopV2Core; mutations: number; execute(params: Record<string, unknown>): Promise<ToolResult> } {
	const root = mkdtempSync(join(tmpdir(), "scheduled-wakeup-tool-"));
	const entries: SessionEntryLike[] = [];
	const port: SessionEntryPort = {
		getBranch: () => entries,
		appendEntry: (customType, data) => {
			entries.push({ type: "custom", customType, data });
		},
	};
	const core = new LoopV2Core({
		sessionId: "tool-session",
		sessionEntries: port,
		workspaceRoot: join(root, "workspace"),
		globalRoot: join(root, "global"),
		now: () => NOW,
	});
	const actions = new AiSessionActions(core);

	let mutations = 0;
	let captured: CapturedTool | undefined;
	const pi = {
		registerTool: (tool: unknown) => {
			captured = tool as CapturedTool;
		},
	} as unknown as ExtensionAPI;
	registerScheduledWakeupV2Tool(pi, {
		getActions: () => actions,
		onMutation: () => {
			mutations += 1;
		},
		now: () => NOW,
	});
	const tool = captured;
	if (tool === undefined) throw new Error("tool was not registered");

	const ctx = { cwd: join(root, "workspace") } as unknown as ExtensionContext;
	return {
		core,
		get mutations() {
			return mutations;
		},
		execute: (params) => tool.execute("tool-call", params, undefined, undefined, ctx),
	};
}
