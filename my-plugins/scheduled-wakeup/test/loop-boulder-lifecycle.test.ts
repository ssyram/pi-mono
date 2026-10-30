import assert from "node:assert/strict";
import { test } from "node:test";
import { loopBoulderFixture } from "./loop-boulder-integration-fixture.js";
import { SESSION_LOOP_STATE_ENTRY_TYPE } from "../src/v2/session-entry-adapter.js";
import type { SessionLoopState } from "../src/v2/model.js";

for (const loopFirst of [true, false]) {
	test(`loop inhibition synchronizes for either startup order (loopFirst=${loopFirst})`, async (t) => {
		const fixture = loopBoulderFixture(t, loopFirst);
		await fixture.start();
		assert.deepEqual(fixture.inhibition().states, [{ type: "loop", value: false }]);
		await fixture.run("add --no-boulder 1h special");
		assert.equal(fixture.inhibition().inhibited, true);
		await fixture.run("add --no-boulder 1h another");
		const snapshot = [...fixture.entries()].reverse().find((entry) => entry.customType === SESSION_LOOP_STATE_ENTRY_TYPE)?.data as SessionLoopState;
		assert.equal(snapshot.tasks.length, 2);
		assert.equal(snapshot.tasks[0]?.definition.inhibitBoulder, true);
		await fixture.run(`stop ${snapshot.tasks[0]?.definition.id}`);
		assert.equal(fixture.inhibition().inhibited, true);
		await fixture.run("stop all");
		assert.equal(fixture.inhibition().inhibited, false);
	});
}

test("tool schema exposes inhibitBoulder and stores the true flag", async (t) => {
	const fixture = loopBoulderFixture(t);
	await fixture.start();
	const schema = fixture.schema() as { properties: { inhibitBoulder: { type: string } } };
	assert.equal(schema.properties.inhibitBoulder.type, "boolean");
	assert.equal((await fixture.execute({ action: "add", interval: "1h", prompt: "tool special", inhibitBoulder: true })).details.ok, true);
	assert.equal(fixture.inhibition().inhibited, true);
	const before = fixture.entries().length;
	assert.equal((await fixture.execute({ action: "add", interval: "1h", prompt: "bad", inhibitBoulder: "true" })).details.ok, false);
	assert.equal(fixture.entries().length, before);
});

test("same cwd session replacement cannot reuse the previous core or client", async (t) => {
	const fixture = loopBoulderFixture(t);
	await fixture.start();
	await fixture.run("add --no-boulder 1h first session");
	const first = fixture.entries();
	const firstLength = first.length;
	await fixture.switch("second");
	assert.equal(fixture.inhibition().inhibited, false);
	assert.equal(first.length, firstLength);
	await fixture.run("add 1h ordinary second session");
	const snapshot = [...fixture.entries()].reverse().find((entry) => entry.customType === SESSION_LOOP_STATE_ENTRY_TYPE)?.data as SessionLoopState;
	assert.equal(snapshot.tasks.length, 1);
	assert.equal(snapshot.tasks[0]?.definition.prompt, "ordinary second session");
	assert.equal(fixture.inhibition().inhibited, false);
});

test("branch refresh recalculates the signal from the new branch state", async (t) => {
	const fixture = loopBoulderFixture(t);
	await fixture.start();
	await fixture.run("add --no-boulder 1h special");
	assert.equal(fixture.inhibition().inhibited, true);
	fixture.entries().length = 0;
	await fixture.tree();
	assert.deepEqual(fixture.inhibition().states, [{ type: "loop", value: false }]);
});

test("one-shot completion closes its inhibition through the poller afterRun callback", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_700_000_000_000 });
	const fixture = loopBoulderFixture(t, false, "tui");
	await fixture.start();
	await fixture.run("add --no-boulder once 1s one-shot");
	assert.equal(fixture.inhibition().inhibited, true);
	t.mock.timers.tick(1_000);
	assert.deepEqual(fixture.sent, ["one-shot"]);
	assert.equal(fixture.inhibition().inhibited, false);
});
