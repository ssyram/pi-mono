import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import { BOULDER_INHIBITION_SERVICE_CHANNEL } from "../../boulder-inhibition/service-protocol.ts";
import { registerBoulderInhibitionService } from "../../boulder-inhibition/service.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { SynchronousEventBus } from "./synchronous-event-bus.ts";

test("service registration: fixed channel, only subscription, and original disposer identity", () => {
	assert.equal(BOULDER_INHIBITION_SERVICE_CHANNEL, "omp:boulder:inhibition:v1");
	const bus = new SynchronousEventBus();
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const resolutions: object[] = [];
	const dispose = registerBoulderInhibitionService(bus, (session) => {
		resolutions.push(session);
		return { port: branch, effects: {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: () => { branch.events.push("reportInfo"); },
		} };
	});
	assert.equal(bus.subscriptions.length, 1);
	assert.equal(bus.subscriptions[0].channel, "omp:boulder:inhibition:v1");
	assert.strictEqual(dispose, bus.subscriptions[0].dispose);
	assert.deepEqual(bus.events, ["on:omp:boulder:inhibition:v1"]);
	assert.deepEqual(bus.emissions, []);
	assert.deepEqual(resolutions, []);
	assert.deepEqual(branch.events, []);
	let observerCalls = 0;
	bus.on("test:observer", () => { observerCalls++; });
	dispose();
	bus.emit("test:observer", {});
	assert.equal(observerCalls, 1);
	assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
	assert.deepEqual(branch.events, []);
	assert.deepEqual(resolutions, []);
});

test("service registration: on errors propagate unchanged without resolving or retrying", () => {
	for (const failure of [new Error("registration failed"), { code: "on-failure" }, undefined]) {
		const bus = new SynchronousEventBus();
		const calls: string[] = [];
		bus.on = (channel) => { calls.push(channel); throw failure; };
		assert.throws(() => registerBoulderInhibitionService(bus, () => {
			calls.push("resolve");
			assert.fail("registration must not resolve sessions");
		}), (error: unknown) => Object.is(error, failure));
		assert.deepEqual(calls, ["omp:boulder:inhibition:v1"]);
		assert.deepEqual(bus.emissions, []);
	}
});

test("service lifecycle: disposal makes the same client unavailable; re-registration uses the new binding", () => {
	const bus = new SynchronousEventBus();
	const session = {};
	const oldBranch = new InMemoryBranch([signalEntry("old", true)]);
	const newBranch = new InMemoryBranch([signalEntry("new", true)]);
	const oldResolutions: object[] = [];
	const newResolutions: object[] = [];
	const oldDispose = registerBoulderInhibitionService(bus, (requested) => {
		oldResolutions.push(requested);
		return requested === session ? { port: oldBranch, effects: {
			cancelWait: () => { oldBranch.events.push("cancelWait"); },
			reportInfo: () => { oldBranch.events.push("reportInfo"); },
		} } : undefined;
	});
	const client = createBoulderInhibitionClient(bus, session);
	const firstGet = client.get();
	assert.equal(firstGet.ok, true);
	if (firstGet.ok) assert.deepEqual(firstGet.snapshot.blockers, ["old"]);
	oldDispose();
	for (const invoke of [() => client.get(), () => client.set({ type: "loop", value: false })]) {
		assert.deepEqual(invoke(), { ok: false, failure: { message: "Boulder inhibition service unavailable" } });
	}
	assert.deepEqual(oldResolutions, [session]);
	assert.deepEqual(oldBranch.events, ["getBranch"]);
	assert.deepEqual(oldBranch.entries, [signalEntry("old", true)]);
	const newDispose = registerBoulderInhibitionService(bus, (requested) => {
		newResolutions.push(requested);
		return requested === session ? { port: newBranch, effects: {
			cancelWait: () => { newBranch.events.push("cancelWait"); },
			reportInfo: () => { newBranch.events.push("reportInfo"); },
		} } : undefined;
	});
	const secondGet = client.get();
	assert.equal(secondGet.ok, true);
	if (secondGet.ok) assert.deepEqual(secondGet.snapshot, {
		states: [{ type: "new", value: true }], blockers: ["new"], inhibited: true,
	});
	assert.deepEqual(newResolutions, [session]);
	assert.deepEqual(oldResolutions, [session]);
	newDispose();
	assert.deepEqual(newBranch.events, ["getBranch"]);
	assert.deepEqual(newBranch.entries, [signalEntry("new", true)]);
	assert.deepEqual(bus.handlerErrors, []);
});
