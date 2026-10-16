import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderInhibitionServiceResponse } from "../../boulder-inhibition/service-protocol.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { sessionBoundService } from "./session-bound-service.ts";

test("handler validation: non-records and non-callable replies are ignored without resolving", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: () => { branch.events.push("reportInfo"); },
	});
	const replies: BoulderInhibitionServiceResponse[] = [];
	const reply = (result: BoulderInhibitionServiceResponse): void => { replies.push(result); };
	const invalid: unknown[] = [
		undefined, null, true, 1, "request", Symbol("request"), 1n, [],
		Object.assign([], { session: service.session, op: "get", reply }),
		Object.assign(() => undefined, { session: service.session, op: "get", reply }),
		{}, { session: service.session, op: "get" },
		...[null, undefined, true, 1, "reply", [], {}].map((value) => ({ session: service.session, op: "get", reply: value })),
	];
	for (const data of invalid) service.bus.emit("omp:boulder:inhibition:v1", data);
	assert.deepEqual(replies, []);
	assert.deepEqual(service.resolvedSessions, []);
	assert.deepEqual(branch.events, []);
	assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
	assert.deepEqual(service.bus.handlerErrors, []);
});

test("handler validation: invalid session, op or signal replies once with the fixed error before emit returns", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: () => { branch.events.push("reportInfo"); },
	});
	const malformedSignals: unknown[] = [
		undefined, null, true, "loop", [], Object.assign([], { type: "loop", value: true }), {},
		{ type: "", value: true }, { type: "loop\n", value: true }, { type: "lo\u00a0op", value: false },
		{ type: 1, value: true }, { type: "loop", value: "true" }, { type: "loop", value: 1 }, { type: "loop" },
	];
	const invalid: Record<string, unknown>[] = [
		{ op: "get" },
		...[null, undefined, "session-id", 1, false, [], () => undefined].map((session) => ({ session, op: "get" })),
		...[undefined, "GET", "SET", "delete", "", 1, null].map((op) => ({ session: service.session, op })),
		...malformedSignals.map((signal) => ({ session: service.session, op: "set", signal })),
	];
	for (const data of invalid) {
		const replies: BoulderInhibitionServiceResponse[] = [];
		const timing: string[] = [];
		service.bus.emit("omp:boulder:inhibition:v1", { ...data, reply: (result: BoulderInhibitionServiceResponse) => {
			timing.push("reply");
			replies.push(result);
		} });
		timing.push("emit-return");
		assert.deepEqual(timing, ["reply", "emit-return"]);
		assert.equal(replies.length, 1);
		const result = replies[0];
		if (result.ok) assert.fail("invalid request must not succeed");
		assert.equal(result.failure.message, "Invalid Boulder inhibition service request");
	}
	assert.deepEqual(service.resolvedSessions, []);
	assert.deepEqual(branch.events, []);
	assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
	assert.deepEqual(service.bus.handlerErrors, []);
});

test("handler get: ignores a malformed extra signal and replies synchronously without info, cancel or append", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true), signalEntry("user", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: () => { branch.events.push("reportInfo"); },
	});
	const replies: BoulderInhibitionServiceResponse[] = [];
	service.bus.emit("omp:boulder:inhibition:v1", Object.freeze({
		session: service.session, op: "get", signal: { type: "", value: "invalid" },
		reply: (result: BoulderInhibitionServiceResponse) => { branch.events.push("reply"); replies.push(result); },
	}));
	branch.events.push("emit-return");
	assert.deepEqual(replies, [{ ok: true, snapshot: {
		states: [{ type: "user", value: true }, { type: "loop", value: true }], blockers: ["user", "loop"], inhibited: true,
	} }]);
	assert.deepEqual(branch.events, ["getBranch", "reply", "emit-return"]);
	assert.deepEqual(branch.entries, [signalEntry("loop", true), signalEntry("user", true)]);
	assert.equal(service.resolvedSessions.length, 1);
	assert.strictEqual(service.resolvedSessions[0], service.session);
	assert.deepEqual(service.bus.handlerErrors, []);
});
