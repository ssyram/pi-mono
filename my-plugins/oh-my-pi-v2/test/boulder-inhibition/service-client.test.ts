import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderInhibitionSnapshot } from "../../boulder-inhibition/protocol.ts";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import type { BoulderInhibitionServiceRequest } from "../../boulder-inhibition/service-protocol.ts";
import { SynchronousEventBus } from "./synchronous-event-bus.ts";

test("client construction: captures a session without emitting or subscribing", () => {
	const bus = new SynchronousEventBus();
	const client = createBoulderInhibitionClient(bus, Object.freeze({ id: "session" }));
	assert.equal(typeof client.get, "function");
	assert.equal(typeof client.set, "function");
	assert.deepEqual(bus.events, []);
	assert.deepEqual(bus.emissions, []);
	assert.deepEqual(bus.subscriptions, []);
});

test("client requests: detached methods emit once with the exact channel, operation and session identity", () => {
	const bus = new SynchronousEventBus();
	const session = Object.freeze({ id: "session" });
	const signal = Object.freeze({ type: "Provider/Name", value: true });
	const snapshots: BoulderInhibitionSnapshot[] = [
		{ states: [], blockers: [], inhibited: false },
		{ states: [{ type: signal.type, value: true }], blockers: [signal.type], inhibited: true },
	];
	const requests: BoulderInhibitionServiceRequest[] = [];
	bus.on("omp:boulder:inhibition:v1", (data) => {
		assert.ok(typeof data === "object" && data !== null && !Array.isArray(data));
		const request = data as BoulderInhibitionServiceRequest;
		assert.equal(typeof request.reply, "function");
		requests.push(request);
		request.reply({ ok: true, snapshot: snapshots[requests.length - 1] });
	});
	const client = createBoulderInhibitionClient(bus, session);
	const get = client.get;
	const set = client.set;
	const getResult = get();
	const setResult = set(signal);
	assert.equal(getResult.ok, true);
	assert.equal(setResult.ok, true);
	if (!getResult.ok || !setResult.ok) assert.fail("expected success");
	assert.strictEqual(getResult.snapshot, snapshots[0]);
	assert.strictEqual(setResult.snapshot, snapshots[1]);
	assert.equal(requests.length, 2);
	for (const request of requests) assert.strictEqual(request.session, session);
	const { reply: getReply, ...getPayload } = requests[0];
	const { reply: setReply, ...setPayload } = requests[1];
	assert.equal(typeof getReply, "function");
	assert.equal(typeof setReply, "function");
	assert.deepEqual(getPayload, { session, op: "get" });
	assert.deepEqual(setPayload, { session, op: "set", signal });
	assert.deepEqual(bus.emissions.map((entry) => entry.channel), ["omp:boulder:inhibition:v1", "omp:boulder:inhibition:v1"]);
	assert.deepEqual(signal, { type: "Provider/Name", value: true });
	assert.deepEqual(bus.handlerErrors, []);
});

test("client replies: successive calls return each new snapshot without caching", () => {
	const bus = new SynchronousEventBus();
	const snapshots: BoulderInhibitionSnapshot[] = [
		{ states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true },
		{ states: [{ type: "loop", value: false }], blockers: [], inhibited: false },
		{ states: [], blockers: [], inhibited: false },
	];
	let calls = 0;
	bus.on("omp:boulder:inhibition:v1", (data) => {
		const request = data as BoulderInhibitionServiceRequest;
		request.reply({ ok: true, snapshot: snapshots[calls++] });
	});
	const client = createBoulderInhibitionClient(bus, {});
	for (const snapshot of snapshots) {
		const result = client.get();
		assert.equal(result.ok, true);
		if (result.ok) assert.strictEqual(result.snapshot, snapshot);
	}
	assert.equal(calls, 3);
	assert.equal(bus.emissions.length, 3);
	assert.deepEqual(bus.handlerErrors, []);
});
