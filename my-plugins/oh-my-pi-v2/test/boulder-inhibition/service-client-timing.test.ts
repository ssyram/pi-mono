import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderInhibitionSnapshot } from "../../boulder-inhibition/protocol.ts";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import type {
	BoulderInhibitionFailure,
	BoulderInhibitionServiceRequest,
	BoulderInhibitionServiceResponse,
} from "../../boulder-inhibition/service-protocol.ts";
import { SynchronousEventBus } from "./synchronous-event-bus.ts";

const UNAVAILABLE: BoulderInhibitionFailure = { message: "Boulder inhibition service unavailable" };

test("client timing: only a synchronous reply followed by normal emit return permits success", () => {
	const bus = new SynchronousEventBus();
	const timing: string[] = [];
	const snapshot: BoulderInhibitionSnapshot = { states: [], blockers: [], inhibited: false };
	bus.on("omp:boulder:inhibition:v1", (data) => {
		timing.push("handler");
		(data as BoulderInhibitionServiceRequest).reply({ ok: true, snapshot });
		timing.push("reply-sent");
	});
	const emit = bus.emit.bind(bus);
	bus.emit = (channel, data) => { timing.push("emit-start"); emit(channel, data); timing.push("emit-return"); };
	const client = createBoulderInhibitionClient(bus, {});
	const result = client.get();
	assert.deepEqual(result, { ok: true, snapshot });
	timing.push("caller-return");
	assert.deepEqual(timing, ["emit-start", "handler", "reply-sent", "emit-return", "caller-return"]);
	assert.deepEqual(bus.handlerErrors, []);
});

test("client timing: late replies cannot repair a failed call or become the next call's result", () => {
	const bus = new SynchronousEventBus();
	const pending: BoulderInhibitionServiceRequest["reply"][] = [];
	const late: BoulderInhibitionSnapshot = { states: [{ type: "late", value: true }], blockers: ["late"], inhibited: true };
	const current: BoulderInhibitionSnapshot = { states: [], blockers: [], inhibited: false };
	let synchronous = false;
	bus.on("omp:boulder:inhibition:v1", (data) => {
		const request = data as BoulderInhibitionServiceRequest;
		if (synchronous) request.reply({ ok: true, snapshot: current });
		else pending.push(request.reply);
	});
	const client = createBoulderInhibitionClient(bus, {});
	assert.deepEqual(client.get(), { ok: false, failure: UNAVAILABLE });
	assert.equal(pending.length, 1);
	pending[0]({ ok: true, snapshot: late });
	assert.deepEqual(client.set({ type: "loop", value: false }), { ok: false, failure: UNAVAILABLE });
	assert.equal(pending.length, 2);
	pending[1]({ ok: false, failure: { message: "too late" } });
	synchronous = true;
	const fresh = client.get();
	assert.deepEqual(fresh, { ok: true, snapshot: current });
	assert.equal(bus.emissions.length, 3);
	assert.deepEqual(bus.handlerErrors, []);
});

test("client reply container: only the first synchronous reply matters", () => {
	const first: BoulderInhibitionSnapshot = { states: [{ type: "first", value: true }], blockers: ["first"], inhibited: true };
	const later: BoulderInhibitionSnapshot = { states: [], blockers: [], inhibited: false };
	const failure: BoulderInhibitionFailure = { message: "first failure", cause: { code: "first failure" } };
	const cases: { replies: BoulderInhibitionServiceResponse[]; succeeds: boolean; failure?: BoulderInhibitionFailure }[] = [
		{ replies: [{ ok: true, snapshot: first }, { ok: true, snapshot: later }], succeeds: true },
		{ replies: [{ ok: true, snapshot: first }, { ok: false, failure }], succeeds: true },
		{ replies: [{ ok: false, failure }, { ok: true, snapshot: later }], succeeds: false, failure },
		{ replies: [{ ok: false, failure: { message: "undefined cause" } }, { ok: true, snapshot: later }], succeeds: false, failure: { message: "undefined cause" } },
	];
	for (const entry of cases) {
		for (const op of ["get", "set"] as const) {
			const bus = new SynchronousEventBus();
			bus.on("omp:boulder:inhibition:v1", (data) => {
				const request = data as BoulderInhibitionServiceRequest;
				for (const response of entry.replies) request.reply(response);
			});
			const client = createBoulderInhibitionClient(bus, {});
			const result = op === "get" ? client.get() : client.set({ type: "loop", value: true });
			if (entry.succeeds) {
				assert.deepEqual(result, { ok: true, snapshot: first });
			} else {
				assert.deepEqual(result, { ok: false, failure: entry.failure });
			}
			assert.equal(bus.emissions.length, 1);
			assert.deepEqual(bus.handlerErrors, []);
		}
	}
});
