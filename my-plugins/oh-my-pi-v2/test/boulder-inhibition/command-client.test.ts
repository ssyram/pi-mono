import assert from "node:assert/strict";
import { test } from "node:test";
import { executeBoulderSetCommand } from "../../boulder-inhibition/command.ts";
import type { BoulderInhibitionSnapshot } from "../../boulder-inhibition/protocol.ts";
import type { BoulderInhibitionClient, BoulderInhibitionFailure } from "../../boulder-inhibition/service-protocol.ts";

test("execute client: unhandled and invalid inputs do not call get or set", () => {
	for (const input of ["", "list", "boulder", "boulder set loop maybe", "boulder set loop true extra"]) {
		const calls: string[] = [];
		const client: BoulderInhibitionClient = {
			get: () => { calls.push("get"); assert.fail("unexpected get"); },
			set: () => { calls.push("set"); assert.fail("unexpected set"); },
		};
		const result = executeBoulderSetCommand(input, client);
		assert.equal(result.kind, input.startsWith("boulder") ? "invalid" : "unhandled");
		assert.deepEqual(calls, []);
	}
});

test("execute client: exactly one set, no get, and the returned snapshot is the client's snapshot", () => {
	const snapshot: BoulderInhibitionSnapshot = {
		states: [{ type: "Provider/Name", value: false }, { type: "user", value: true }],
		blockers: ["user"], inhibited: true,
	};
	const before = structuredClone(snapshot);
	const calls: string[] = [];
	const result = executeBoulderSetCommand("BOULDER SeT Provider/Name F", {
		get: () => { calls.push("get"); assert.fail("execute must not get"); },
		set: (signal) => {
			calls.push("set");
			assert.deepEqual(signal, { type: "Provider/Name", value: false });
			return { ok: true, snapshot };
		},
	});
	assert.deepEqual(calls, ["set"]);
	assert.deepEqual(result, { kind: "set", signal: { type: "Provider/Name", value: false }, snapshot });
	if (result.kind !== "set") assert.fail("expected set");
	assert.strictEqual(result.snapshot, snapshot);
	assert.deepEqual(snapshot, before);
});

test("execute client: set failures return kind failed with the exact failure, never throwing", () => {
	const failures: BoulderInhibitionFailure[] = [
		{ message: "Boulder inhibition service unavailable" },
		{ message: "Boulder inhibition session unavailable" },
		{ message: "write failed", cause: new Error("inner") },
		{ message: "raw cause", cause: { code: "failure" } },
		{ message: "non-Error cause", cause: Symbol("failure") },
	];
	for (const failure of failures) {
		const calls: string[] = [];
		const result = executeBoulderSetCommand("boulder set loop t", {
			get: () => { calls.push("get"); assert.fail("execute must not get"); },
			set: (signal) => {
				calls.push("set");
				assert.deepEqual(signal, { type: "loop", value: true });
				return { ok: false, failure };
			},
		});
		assert.deepEqual(result, { kind: "failed", signal: { type: "loop", value: true }, failure });
		if (result.kind !== "failed") assert.fail("expected failed");
		assert.strictEqual(result.failure, failure);
		assert.deepEqual(calls, ["set"]);
	}
});
