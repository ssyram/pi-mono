import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionPersistenceError } from "../src/session-persistence-error.js";
import { createBoundaryFixture } from "./outer-boundary-fixture.js";

test("a real custom-only SDK session rejects creation without changing its entries", async (t) => {
	const setup = createBoundaryFixture(t);
	const manager = SessionManager.create(setup.cwd, join(setup.cwd, "sessions"));
	setup.ctx.sessionManager = manager;
	setup.pi.appendEntry = (customType, data) => {
		manager.appendCustomEntry(customType, data);
	};
	await setup.start();
	const before = manager.getEntries();
	const file = manager.getSessionFile();
	assert.ok(file);
	assert.equal(existsSync(file), false);
	for (const command of [
		"add 1h pending",
		"define workspace 1h pending",
		"register workspace workspace:missing",
	]) {
		await assert.doesNotReject(setup.run(command));
		assert.match(
			setup.notifications.at(-1) ?? "",
			/session has not been saved/,
		);
	}
	const result = await setup.execute({
		action: "add",
		prompt: "pending",
		delay: "1m",
	});
	assert.equal(result.details.ok, false);
	assert.match(result.details.message, /Send a real message/);
	assert.deepEqual(manager.getEntries(), before);
	assert.equal(existsSync(file), false);
	assert.deepEqual(setup.sent, []);
	assert.equal((await setup.execute({ action: "list" })).details.ok, true);

	manager.appendMessage({
		role: "user",
		content: "fixture user conversation",
		timestamp: Date.now(),
	});
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "fixture assistant conversation" }],
		api: "openai-responses",
		provider: "openai",
		model: "fixture",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	});
	assert.equal(existsSync(file), true);
	const accepted = await setup.execute({
		action: "add",
		prompt: "persisted",
		delay: "1m",
	});
	assert.equal(accepted.details.ok, true);
	await setup.shutdown();
	const reopened = SessionManager.open(file);
	assert.ok(
		reopened
			.getBranch()
			.some(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === "scheduled-wakeup/v2/session-state",
			),
	);
});

test("missing or non-file session paths reject creation, not queries; notification failure stays contained", async (t) => {
	const setup = createBoundaryFixture(t);
	await setup.start();
	rmSync(setup.sessionFile);
	await setup.run("add 1h rejected");
	assert.match(setup.notifications.at(-1) ?? "", /session has not been saved/);
	assert.equal(setup.entries.length, 0);
	setup.failures.notify = true;
	await assert.doesNotReject(setup.run("add 1h rejected"));
	const rejected = await setup.execute({
		action: "add",
		prompt: "rejected",
		delay: "1m",
	});
	assert.equal(rejected.details.ok, false);
	assert.equal(setup.entries.length, 0);
	assert.equal((await setup.execute({ action: "list" })).details.ok, true);
	setup.ctx.sessionManager.getSessionFile = () => undefined;
	assert.match(
		sessionPersistenceError(setup.ctx) ?? "",
		/session has not been saved/,
	);
	setup.ctx.sessionManager.getSessionFile = () => setup.cwd;
	assert.match(
		sessionPersistenceError(setup.ctx) ?? "",
		/session has not been saved/,
	);
	setup.ctx.sessionManager.getSessionFile = () => setup.sessionFile;
	writeFileSync(setup.sessionFile, "fixture saved file");
	assert.equal(
		(await setup.execute({ action: "add", prompt: "accepted", delay: "1m" }))
			.details.ok,
		true,
	);
});
