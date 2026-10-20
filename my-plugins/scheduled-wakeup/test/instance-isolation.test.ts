import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import scheduledWakeup from "../src/extension.js";
import { claimLoopInstance } from "../src/loop-instance-owner.js";
import { createBoundaryFixture } from "./outer-boundary-fixture.js";

function bindSession(
	setup: ReturnType<typeof createBoundaryFixture>,
	cwd: string,
): SessionManager {
	const manager = SessionManager.create(cwd, setup.cwd);
	manager.appendMessage({
		role: "user",
		content: "fixture conversation",
		timestamp: Date.now(),
	});
	setup.ctx.cwd = cwd;
	setup.ctx.sessionManager = manager;
	setup.pi.appendEntry = (customType, data) => {
		manager.appendCustomEntry(customType, data);
	};
	return manager;
}

test("different SDK managers in the same cwd keep independent extension instances", async (t) => {
	const a = createBoundaryFixture(t);
	const managerA = bindSession(a, a.cwd);
	await a.start();
	assert.equal(
		(await a.execute({ action: "add", prompt: "a first", delay: "1h" })).details
			.ok,
		true,
	);
	const b = createBoundaryFixture(t);
	const managerB = bindSession(b, a.cwd);
	assert.notEqual(managerA.getSessionId(), managerB.getSessionId());
	await b.start();
	await a.run("add 1h a after b loads");
	const aTasks = (await a.execute({ action: "list" })).details.active;
	assert.equal(aTasks?.length, 2);
	assert.equal(
		(await b.execute({ action: "add", prompt: "b first", delay: "1h" })).details
			.ok,
		true,
	);
	await a.shutdown();
	assert.equal(
		(
			await b.execute({
				action: "add",
				prompt: "b after a closes",
				delay: "1h",
			})
		).details.ok,
		true,
	);
	assert.equal((await b.execute({ action: "list" })).details.active?.length, 2);
	await b.shutdown();
});

test("replacement on the same manager retires old tools without reviving their runtime", async (t) => {
	const setup = createBoundaryFixture(t);
	const manager = bindSession(setup, setup.cwd);
	await setup.start();
	await setup.run("add 1h before replacement");
	const retired = setup.registeredTool;
	scheduledWakeup(setup.pi);
	await setup.start();
	const before = manager.getEntries().length;
	const result = await retired.execute(
		"retired",
		{ action: "add", prompt: "must not revive", delay: "1h" },
		new AbortController().signal,
		undefined,
		setup.ctx,
	);
	assert.equal(result.details.ok, false);
	assert.match(result.details.message, /inactive/);
	assert.equal(manager.getEntries().length, before);
	assert.equal(
		(await setup.execute({ action: "add", prompt: "replacement", delay: "1h" }))
			.details.ok,
		true,
	);
});

test("same-manager replacement cleans only its previous instance; stale release cannot remove its successor", () => {
	const owner = {};
	const otherOwner = {};
	let firstDisposed = 0;
	let secondDisposed = 0;
	let otherDisposed = 0;
	const firstRelease = claimLoopInstance(owner, () => {
		firstDisposed += 1;
	});
	const otherRelease = claimLoopInstance(otherOwner, () => {
		otherDisposed += 1;
	});
	const secondRelease = claimLoopInstance(owner, () => {
		secondDisposed += 1;
	});
	assert.equal(firstDisposed, 1);
	assert.equal(otherDisposed, 0);
	firstRelease();
	const thirdRelease = claimLoopInstance(owner, () => undefined);
	assert.equal(secondDisposed, 1);
	secondRelease();
	thirdRelease();
	otherRelease();
	assert.equal(otherDisposed, 0);
});
