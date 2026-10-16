import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import type { BoulderInhibitionServiceBinding } from "../../boulder-inhibition/service-protocol.ts";
import { registerBoulderInhibitionService } from "../../boulder-inhibition/service.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { SynchronousEventBus } from "./synchronous-event-bus.ts";

test("service routing: equal-looking session objects address different branches by identity", () => {
	const bus = new SynchronousEventBus();
	const leftSession = { id: "same-session-id" };
	const rightSession = { id: "same-session-id" };
	const left = new InMemoryBranch([signalEntry("left", true)]);
	const right = new InMemoryBranch([signalEntry("right", true)]);
	const bindings = new Map<object, BoulderInhibitionServiceBinding>();
	for (const [session, branch] of [[leftSession, left], [rightSession, right]] as const) {
		bindings.set(session, { port: branch, effects: {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: (text) => { branch.events.push(text); },
		} });
	}
	const resolutions: object[] = [];
	registerBoulderInhibitionService(bus, (session) => { resolutions.push(session); return bindings.get(session); });
	const leftClient = createBoulderInhibitionClient(bus, leftSession);
	const rightClient = createBoulderInhibitionClient(bus, rightSession);
	assert.deepEqual(leftClient.get(), { ok: true, snapshot: { states: [{ type: "left", value: true }], blockers: ["left"], inhibited: true } });
	assert.deepEqual(rightClient.get(), { ok: true, snapshot: { states: [{ type: "right", value: true }], blockers: ["right"], inhibited: true } });
	assert.deepEqual(leftClient.set({ type: "loop", value: true }), { ok: true, snapshot: {
		states: [{ type: "loop", value: true }, { type: "left", value: true }], blockers: ["loop", "left"], inhibited: true,
	} });
	assert.deepEqual(rightClient.set({ type: "loop", value: false }), { ok: true, snapshot: {
		states: [{ type: "loop", value: false }, { type: "right", value: true }], blockers: ["right"], inhibited: true,
	} });
	assert.deepEqual(resolutions, [leftSession, rightSession, leftSession, rightSession]);
	assert.strictEqual(resolutions[0], leftSession);
	assert.strictEqual(resolutions[1], rightSession);
	assert.deepEqual(left.events, [
		"getBranch", "appendEntry", "getBranch", "cancelWait", "Boulder signal loop=true; Boulder inhibited: loop, left",
	]);
	assert.deepEqual(right.events, [
		"getBranch", "appendEntry", "getBranch", "cancelWait", "Boulder signal loop=false; Boulder inhibited: right",
	]);
	assert.deepEqual(left.entries, [signalEntry("left", true), signalEntry("loop", true)]);
	assert.deepEqual(right.entries, [signalEntry("right", true), signalEntry("loop", false)]);
	assert.deepEqual(bus.handlerErrors, []);
});

test("service routing: unknown object identity cannot fall back to a matching textual session id", () => {
	const bus = new SynchronousEventBus();
	const known = { id: "same" };
	const unknown = { id: "same" };
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const resolutions: object[] = [];
	registerBoulderInhibitionService(bus, (session) => {
		resolutions.push(session);
		return session === known ? { port: branch, effects: {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: () => { branch.events.push("reportInfo"); },
		} } : undefined;
	});
	const client = createBoulderInhibitionClient(bus, unknown);
	for (const invoke of [() => client.get(), () => client.set({ type: "loop", value: false })]) {
		assert.deepEqual(invoke(), { ok: false, failure: { message: "Boulder inhibition session unavailable" } });
	}
	assert.equal(resolutions.length, 2);
	for (const session of resolutions) assert.strictEqual(session, unknown);
	assert.deepEqual(branch.events, []);
	assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
	assert.deepEqual(bus.handlerErrors, []);
});

test("service get: branch switching and binding availability are resolved afresh without write effects", () => {
	const bus = new SynchronousEventBus();
	const session = {};
	const branch = new InMemoryBranch([signalEntry("left", true)]);
	const replacement = new InMemoryBranch([signalEntry("replacement", true)]);
	let current: InMemoryBranch | undefined = branch;
	const resolutions: object[] = [];
	registerBoulderInhibitionService(bus, (requested) => {
		resolutions.push(requested);
		if (requested !== session || !current) return undefined;
		return { port: current, effects: {
			cancelWait: () => { assert.fail("get must not cancel"); },
			reportInfo: () => { assert.fail("get must not report"); },
		} };
	});
	const client = createBoulderInhibitionClient(bus, session);
	const first = client.get();
	const left = branch.entries;
	branch.entries = [signalEntry("right", false)];
	assert.deepEqual(client.get(), { ok: true, snapshot: { states: [{ type: "right", value: false }], blockers: [], inhibited: false } });
	assert.deepEqual(first, { ok: true, snapshot: { states: [{ type: "left", value: true }], blockers: ["left"], inhibited: true } });
	current = replacement;
	assert.deepEqual(client.get(), { ok: true, snapshot: {
		states: [{ type: "replacement", value: true }], blockers: ["replacement"], inhibited: true,
	} });
	current = undefined;
	for (const invoke of [() => client.get(), () => client.set({ type: "loop", value: true })]) {
		assert.deepEqual(invoke(), { ok: false, failure: { message: "Boulder inhibition session unavailable" } });
	}
	assert.equal(resolutions.length, 5);
	for (const requested of resolutions) assert.strictEqual(requested, session);
	assert.deepEqual(branch.events, ["getBranch", "getBranch"]);
	assert.deepEqual(replacement.events, ["getBranch"]);
	assert.deepEqual(left, [signalEntry("left", true)]);
	assert.deepEqual(branch.entries, [signalEntry("right", false)]);
	assert.deepEqual(replacement.entries, [signalEntry("replacement", true)]);
	assert.deepEqual(bus.handlerErrors, []);
});
