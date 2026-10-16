import assert from "node:assert/strict";
import { test } from "node:test";
import { AiSessionActions } from "../src/v2/ai-session-actions.js";
import { LoopV2Core } from "../src/v2/loop-core.js";
import { registerScheduledWakeupV2Tool } from "../src/v2/register-v2-tool.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";
import {
	type BoundaryTool,
	createBoundaryFixture,
} from "./outer-boundary-fixture.js";

const tooFar = "8700000000000s";

test("commands return normally for invalid time and missing registration", async (t) => {
	const setup = createBoundaryFixture(t);
	await setup.start();
	await assert.doesNotReject(setup.run("add once 2501999792h overflow"));
	await assert.doesNotReject(setup.run(`add once ${tooFar} outside date`));
	await assert.doesNotReject(setup.run("register workspace missing-id"));
	assert.equal(setup.entries.length, 0);
	assert.ok(
		setup.notifications.some((text) => text.includes("Loop command failed")),
	);
});

test("tool rejects out-of-Date once before saving", async (t) => {
	const setup = createBoundaryFixture(t);
	await setup.start();
	const result = await setup.execute({
		action: "add",
		prompt: "invalid date",
		delay: tooFar,
	});
	assert.equal(result.details.ok, false);
	assert.equal(setup.entries.length, 0);
});

test("startup and shutdown failures do not reject; inactive tool cannot recreate runtime", async (t) => {
	const setup = createBoundaryFixture(t);
	setup.failures.branch = true;
	await assert.doesNotReject(setup.start());
	setup.failures.branch = false;
	await setup.start();
	await setup.run("add 1h pending");
	setup.failures.append = true;
	await assert.doesNotReject(setup.shutdown());
	const before = setup.entries.length;
	const result = await setup.execute({
		action: "add",
		prompt: "inactive",
		delay: "1m",
	});
	assert.equal(result.details.ok, false);
	assert.match(result.details.message, /inactive/);
	assert.equal(setup.entries.length, before);
});

test("a failed query is null, not a fake empty active set; error construction stays nothrow", async (t) => {
	const setup = createBoundaryFixture(t);
	await setup.start();
	setup.failures.branch = true;
	const listed = await setup.execute({ action: "list" });
	assert.equal(listed.details.ok, false);
	assert.equal(listed.details.active, null);
	assert.match(listed.details.message, /unavailable/);
	const added = await setup.execute({
		action: "add",
		prompt: "x",
		delay: "1m",
	});
	assert.equal(added.details.ok, false);
	assert.equal(added.details.active, null);
});

test("post-mutation refresh failure preserves successful result and does not reject", async (t) => {
	const setup = createBoundaryFixture(t);
	const entries: SessionEntryLike[] = [];
	const core = new LoopV2Core({
		sessionId: "refresh",
		workspaceRoot: setup.cwd,
		globalRoot: setup.cwd,
		sessionEntries: {
			getBranch: () => entries,
			appendEntry: (customType, data) =>
				entries.push({ type: "custom", customType, data }),
		},
	});
	let tool: BoundaryTool | undefined;
	registerScheduledWakeupV2Tool(
		{
			...setup.pi,
			registerTool: (spec) => {
				tool = spec as unknown as BoundaryTool;
			},
		},
		{
			getActions: () => new AiSessionActions(core),
			onMutation: () => {
				throw new Error("refresh unavailable");
			},
		},
	);
	assert.ok(tool);
	const result = await tool.execute(
		"refresh",
		{ action: "add", prompt: "created", delay: "1m" },
		new AbortController().signal,
		undefined,
		setup.ctx,
	);
	assert.equal(result.details.ok, true);
	assert.match(result.details.message, /Schedule refresh failed/);
	assert.equal(core.snapshotSessionState().tasks.length, 1);
});

test("notify failure cannot turn successful manual delivery into a failure", async (t) => {
	const setup = createBoundaryFixture(t);
	await setup.start();
	const added = await setup.execute({
		action: "add",
		prompt: "manual",
		delay: "1m",
	});
	const first = added.details.active?.[0];
	assert.ok(first?.kind === "session");
	setup.failures.notify = true;
	await assert.doesNotReject(setup.run(`run ${first.task.definition.id}`));
	assert.deepEqual(setup.sent, ["manual"]);
});

test("command ordinary append failure is reported even when UI is unavailable", async (t) => {
	const setup = createBoundaryFixture(t);
	await setup.start();
	setup.failures.append = true;
	setup.failures.notify = true;
	await assert.doesNotReject(setup.run("add 1h x"));
});
