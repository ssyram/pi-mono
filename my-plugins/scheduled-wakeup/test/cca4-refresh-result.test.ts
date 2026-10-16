import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type AiSessionActionResult,
	AiSessionActions,
} from "../src/v2/ai-session-actions.js";
import { DuePoller } from "../src/v2/due-poller.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import { registerScheduledWakeupV2Tool } from "../src/v2/register-v2-tool.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";

type Tool = {
	execute(
		id: string,
		input: unknown,
		signal: undefined,
		update: undefined,
		context: ExtensionContext,
	): Promise<AgentToolResult<AiSessionActionResult>>;
};

test("a committed wakeup reports refresh failure without throwing or pretending rollback", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "cca4-refresh-"));
	const journal: SessionEntryLike[] = [];
	const core = new LoopV2Core({
		sessionId: "refresh",
		workspaceRoot: join(root, "workspace"),
		globalRoot: join(root, "global"),
		now: () => 1_700_000_000_000,
		sessionEntries: {
			getBranch: () => journal,
			appendEntry: (customType, data) => {
				journal.push({ type: "custom", customType, data });
			},
		},
	});
	const poller = new DuePoller({
		core,
		deliver: () => assert.fail("failed timer must not deliver"),
		timers: {
			set() {
				throw new Error("timer unavailable");
			},
			clear() {},
		},
	});
	t.after(() => {
		poller.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	poller.start();
	let registered: Tool | undefined;
	registerScheduledWakeupV2Tool(
		{
			registerTool(tool: Tool) {
				registered = tool;
			},
		} as unknown as ExtensionAPI,
		{
			getActions: () => new AiSessionActions(core),
			now: () => 1_700_000_000_000,
			onMutation: () => {
				const refreshed = poller.reschedule();
				return refreshed.ok ? undefined : refreshed.message;
			},
		},
	);
	assert.ok(registered);
	const result = await registered.execute(
		"call",
		{ action: "add", prompt: "stored", delay: "10s" },
		undefined,
		undefined,
		{} as ExtensionContext,
	);
	assert.equal(result.details?.ok, true);
	assert.match(
		result.details?.message ?? "",
		/Added session task.*Schedule refresh failed: Loop due polling stopped/,
	);
	assert.equal(core.snapshotSessionState().tasks.length, 1);
	assert.equal(poller.isRunning, false);
	assert.equal(journal.length, 1);
});
