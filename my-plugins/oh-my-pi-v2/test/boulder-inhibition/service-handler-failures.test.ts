import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoulderInhibitionClient } from "../../boulder-inhibition/service-client.ts";
import type { BoulderInhibitionServiceResponse } from "../../boulder-inhibition/service-protocol.ts";
import { registerBoulderInhibitionService } from "../../boulder-inhibition/service.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { SynchronousEventBus } from "./synchronous-event-bus.ts";

const failurePoints = [
	["get", "resolve"], ["get", "getBranch"], ["set", "resolve"], ["set", "append-before"],
	["set", "append-after"], ["set", "getBranch"], ["set", "cancelWait"], ["set", "reportInfo"],
] as const;

for (const [op, point] of failurePoints) {
	test(`handler failure: ${op}/${point} replies with the original failure and retains completed writes`, () => {
		for (const failure of [new Error(point), { code: point }, undefined]) {
			for (const delivery of ["raw", "client"] as const) {
				const bus = new SynchronousEventBus();
				const session = {};
				const branch = new InMemoryBranch([signalEntry("user", true)]);
				const append = branch.appendEntry.bind(branch);
				branch.appendEntry = (customType, data) => {
					if (point === "append-before") { branch.events.push("appendEntry"); throw failure; }
					append(customType, data);
					if (point === "append-after") throw failure;
				};
				if (point === "getBranch") {
					branch.getBranch = () => { branch.events.push("getBranch"); throw failure; };
				}
				registerBoulderInhibitionService(bus, (requested) => {
					branch.events.push("resolve");
					assert.strictEqual(requested, session);
					if (point === "resolve") throw failure;
					return { port: branch, effects: {
						cancelWait: () => { branch.events.push("cancelWait"); if (point === "cancelWait") throw failure; },
						reportInfo: (text) => {
							branch.events.push("reportInfo");
							assert.equal(text, "Boulder signal loop=true; Boulder inhibited: loop, user");
							if (point === "reportInfo") throw failure;
						},
					} };
				});
				if (delivery === "raw") {
					const replies: BoulderInhibitionServiceResponse[] = [];
					const timing: string[] = [];
					bus.emit("omp:boulder:inhibition:v1", {
						session, op, signal: { type: "loop", value: true },
						reply: (result: BoulderInhibitionServiceResponse) => { timing.push("reply"); replies.push(result); },
					});
					timing.push("emit-return");
					assert.deepEqual(timing, ["reply", "emit-return"]);
					assert.equal(replies.length, 1);
					const response = replies[0];
					if (response.ok) assert.fail("operation failure must not succeed");
					assert.equal(response.failure.message, failure instanceof Error ? failure.message : String(failure));
					assert.ok(Object.is(response.failure.cause, failure));
				} else {
					const client = createBoulderInhibitionClient(bus, session);
					const result = op === "get" ? client.get() : client.set({ type: "loop", value: true });
					assert.equal(result.ok, false);
					if (result.ok) assert.fail("expected failure");
					assert.ok(Object.is(result.failure.cause, failure));
				}
				const order = op === "get" ? ["resolve", "getBranch"]
					: ["resolve", "appendEntry", "getBranch", "cancelWait", "reportInfo"];
				const stage = point.startsWith("append-") ? "appendEntry" : point;
				assert.deepEqual(branch.events, order.slice(0, order.indexOf(stage) + 1));
				const persisted = op === "set" && point !== "resolve" && point !== "append-before";
				assert.deepEqual(branch.entries, persisted
					? [signalEntry("user", true), signalEntry("loop", true)] : [signalEntry("user", true)]);
				assert.equal(bus.emissions.length, 1);
				assert.deepEqual(bus.handlerErrors, []);
			}
		}
	});
}

test("handler reply: consumer exceptions are contained by the handler, never rethrown or double-replied", () => {
	for (const scenario of ["invalid", "unknown", "success", "operation-failure"] as const) {
		for (const replyFailure of [new Error("reply failed"), { code: "reply-failure" }]) {
			const bus = new SynchronousEventBus();
			const session = {};
			const branch = new InMemoryBranch([signalEntry("loop", true)]);
			const operationFailure = new Error("branch failed");
			if (scenario === "operation-failure") {
				branch.getBranch = () => { branch.events.push("getBranch"); throw operationFailure; };
			}
			const resolutions: object[] = [];
			registerBoulderInhibitionService(bus, (requested) => {
				resolutions.push(requested);
				return requested === session ? { port: branch, effects: {
					cancelWait: () => { branch.events.push("cancelWait"); },
					reportInfo: () => { branch.events.push("reportInfo"); },
				} } : undefined;
			});
			const originalError = console.error;
			const logged: unknown[] = [];
			console.error = (...values: unknown[]) => { logged.push(values[0]); };
			let repliesCount = 0;
			try {
				bus.emit("omp:boulder:inhibition:v1", {
					session: scenario === "invalid" ? null : scenario === "unknown" ? {} : session, op: "get",
					reply: (result: BoulderInhibitionServiceResponse) => { repliesCount++; throw replyFailure; },
				});
			} finally {
				console.error = originalError;
			}
			assert.equal(repliesCount, 1);
			assert.equal(resolutions.length, scenario === "invalid" ? 0 : 1);
			assert.deepEqual(bus.handlerErrors, []);
			assert.equal(logged.length, 1);
			assert.deepEqual(branch.events, scenario === "success" || scenario === "operation-failure" ? ["getBranch"] : []);
			assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
			assert.ok(true);
		}
	}
});
