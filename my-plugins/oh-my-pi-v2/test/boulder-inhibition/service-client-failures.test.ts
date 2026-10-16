import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import type { BoulderInhibitionServiceRequest } from "../../boulder-inhibition/service-protocol.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { sessionBoundService } from "./session-bound-service.ts";
import { SynchronousEventBus } from "./synchronous-event-bus.ts";

test("client unavailable: absent, silent and throwing handlers cannot produce success", () => {
	for (const mode of ["absent", "silent", "throws"] as const) {
		for (const op of ["get", "set"] as const) {
			const bus = new SynchronousEventBus();
			const failure = new Error("handler failure swallowed by the bus");
			if (mode !== "absent") bus.on("omp:boulder:inhibition:v1", () => { if (mode === "throws") throw failure; });
			const client = createBoulderInhibitionClient(bus, {});
			const result = op === "get" ? client.get() : client.set({ type: "loop", value: true });
			assert.deepEqual(result, { ok: false, failure: { message: "Boulder inhibition service unavailable" } });
			assert.equal(bus.emissions.length, 1);
			assert.deepEqual(bus.handlerErrors, mode === "throws" ? [failure] : []);
		}
	}
});

test("client failure replies: the failure object is returned exactly as received, without throwing", () => {
	const failures = [
		{ message: "service operation failed", cause: new Error("inner") },
		{ message: "raw object cause", cause: { code: "failure" } },
		{ message: "string cause", cause: "failure" },
		{ message: "no cause" },
	] as const;
	for (const failure of failures) {
		for (const op of ["get", "set"] as const) {
			const bus = new SynchronousEventBus();
			bus.on("omp:boulder:inhibition:v1", (data) => {
				(data as BoulderInhibitionServiceRequest).reply({ ok: false, failure });
			});
			const client = createBoulderInhibitionClient(bus, {});
			const result = op === "get" ? client.get() : client.set({ type: "loop", value: false });
			assert.equal(result.ok, false);
			if (!result.ok) assert.strictEqual(result.failure, failure);
			assert.equal(bus.emissions.length, 1);
			assert.deepEqual(bus.handlerErrors, []);
		}
	}
});

test("client emit: failures before dispatch become results without retrying or using a reply", () => {
	for (const failure of [new Error("emit failed"), { code: "emit" }, undefined]) {
		for (const op of ["get", "set"] as const) {
			const bus = new SynchronousEventBus();
			const requests: { channel: string; data: unknown }[] = [];
			bus.emit = (channel, data) => { requests.push({ channel, data }); throw failure; };
			const session = {};
			const client = createBoulderInhibitionClient(bus, session);
			const result = op === "get" ? client.get() : client.set({ type: "loop", value: true });
			assert.equal(result.ok, false);
			if (result.ok) assert.fail("expected failure");
			assert.equal(result.failure.message, failure instanceof Error ? failure.message : String(failure));
			assert.ok(Object.is(result.failure.cause, failure));
			assert.equal(requests.length, 1);
			assert.equal(requests[0].channel, "omp:boulder:inhibition:v1");
			const request = requests[0].data as BoulderInhibitionServiceRequest;
			assert.strictEqual(request.session, session);
			assert.equal(request.op, op);
		}
	}
});

test("client emit: an exception after success still fails and does not roll back a persisted set", () => {
	for (const op of ["get", "set"] as const) {
		for (const failure of [new Error("emit failed after dispatch"), { code: "after-reply" }]) {
			const branch = new InMemoryBranch([signalEntry("user", true)]);
			const service = sessionBoundService(branch, {
				cancelWait: () => { branch.events.push("cancelWait"); },
				reportInfo: (text) => { branch.events.push(text); },
			});
			const emit = service.bus.emit.bind(service.bus);
			service.bus.emit = (channel, data) => { emit(channel, data); throw failure; };
			const result = op === "get" ? service.client.get() : service.client.set({ type: "loop", value: true });
			assert.equal(result.ok, false);
			if (result.ok) assert.fail("expected failure");
			assert.equal(result.failure.message, failure instanceof Error ? failure.message : String(failure));
			assert.ok(Object.is(result.failure.cause, failure));
			assert.equal(service.bus.emissions.length, 1);
			assert.deepEqual(branch.events, op === "get" ? ["getBranch"] : [
				"appendEntry", "getBranch", "cancelWait", "Boulder signal loop=true; Boulder inhibited: loop, user",
			]);
			assert.deepEqual(branch.entries, op === "get"
				? [signalEntry("user", true)] : [signalEntry("user", true), signalEntry("loop", true)]);
			assert.deepEqual(service.bus.handlerErrors, []);
		}
	}
});
