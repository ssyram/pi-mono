import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "../../../../packages/coding-agent/src/core/event-bus.ts";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import { registerBoulderInhibitionService } from "../../boulder-inhibition/service.ts";
import { InMemoryBranch } from "./in-memory-branch.ts";

test("Pi EventBus: synchronous replies preserve set/get and owning session effects", () => {
	const bus = createEventBus();
	const session = {};
	const branch = new InMemoryBranch();
	const reports: string[] = [];
	const dispose = registerBoulderInhibitionService(bus, (target) => target === session ? {
		port: branch,
		effects: {
			cancelWait: () => branch.events.push("cancelWait"),
			reportInfo: (text) => { branch.events.push("reportInfo"); reports.push(text); },
		},
	} : undefined);
	const client = createBoulderInhibitionClient(bus, session);
	const result = client.set({ type: "loop", value: true });
	assert.deepEqual(branch.events, ["appendEntry", "getBranch", "cancelWait", "reportInfo"]);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.deepEqual(result.snapshot.blockers, ["loop"]);
		const get = client.get();
		assert.equal(get.ok, true);
		if (get.ok) assert.deepEqual(get.snapshot, result.snapshot);
	}
	assert.deepEqual(reports, ["Boulder signal loop=true; Boulder inhibited: loop"]);
	dispose();
	assert.deepEqual(client.get(), { ok: false, failure: { message: "Boulder inhibition service unavailable" } });
	bus.clear();
});

test("Pi EventBus: service failures become results despite handler safety wrapper", () => {
	const bus = createEventBus();
	const failure = new Error("session binding failed");
	const dispose = registerBoulderInhibitionService(bus, () => { throw failure; });
	const client = createBoulderInhibitionClient(bus, {});
	const result = client.get();
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("expected failure");
	assert.ok(Object.is(result.failure.cause, failure));
	assert.equal(result.failure.message, "session binding failed");
	dispose();
	bus.clear();
});
