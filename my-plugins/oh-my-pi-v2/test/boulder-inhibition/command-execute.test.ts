import assert from "node:assert/strict";
import { test } from "node:test";
import { executeBoulderSetCommand } from "../../boulder-inhibition/command.ts";
import type { BoulderInhibitionEffects } from "../../boulder-inhibition/protocol.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";
import { sessionBoundService } from "./session-bound-service.ts";

test("execute: unhandled and invalid commands have zero client, port or effects calls", () => {
	const cases = [
		{ input: "", kind: "unhandled" }, { input: "list", kind: "unhandled" },
		{ input: "boulderish set loop true", kind: "unhandled" },
		{ input: "boulder", kind: "invalid" }, { input: "boulder set loop maybe", kind: "invalid" },
		{ input: "boulder stop loop true", kind: "invalid" },
		{ input: "boulder set loop true extra", kind: "invalid" },
	];
	for (const { input, kind } of cases) {
		const branch = new InMemoryBranch([signalEntry("loop", true)]);
		const service = sessionBoundService(branch, {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: () => { branch.events.push("reportInfo"); },
		});
		const result = executeBoulderSetCommand(input, service.client);
		assert.deepEqual(service.bus.emissions, []);
		assert.deepEqual(service.resolvedSessions, []);
		assert.deepEqual(result, kind === "unhandled" ? { kind } : {
			kind, message: "Usage: /task boulder set <type> <true|false|t|f>",
		});
		assert.deepEqual(branch.events, [], input);
		assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
	}
});

test("execute: valid commands return the parsed signal and exact write-after snapshot", () => {
	for (const [word, value] of [["T", true], ["TrUe", true], ["F", false], ["FaLsE", false]] as const) {
		const branch = new InMemoryBranch([signalEntry("user", true)]);
		const effects: BoulderInhibitionEffects = {
			cancelWait: () => { branch.events.push("cancelWait"); },
			reportInfo: (text) => { branch.events.push(`reportInfo:${text}`); },
		};
		const service = sessionBoundService(branch, effects);
		const result = executeBoulderSetCommand(`BOULDER SeT Provider/Name ${word}`, service.client);
		assert.equal(service.bus.emissions.length, 1);
		assert.deepEqual(result, {
			kind: "set", signal: { type: "Provider/Name", value },
			snapshot: {
				states: [{ type: "Provider/Name", value }, { type: "user", value: true }],
				blockers: value ? ["Provider/Name", "user"] : ["user"], inhibited: true,
			},
		});
		assert.deepEqual(branch.entries, [signalEntry("user", true), signalEntry("Provider/Name", value)]);
		assert.deepEqual(branch.events, [
			"appendEntry", "getBranch", "cancelWait",
			`reportInfo:Boulder signal Provider/Name=${value}; Boulder inhibited: ${value ? "Provider/Name, user" : "user"}`,
		]);
		assert.equal(result.kind, "set");
		if (result.kind !== "set") assert.fail("expected a set result");
		assert.notStrictEqual(result.signal, branch.entries[1].data);
		result.signal.value = !value;
		result.snapshot.states[0].type = "changed";
		assert.deepEqual(branch.entries[1], signalEntry("Provider/Name", value));
	}
});

test("execute: clearing the last source reports clear but does not cancel or restart anything", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const service = sessionBoundService(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => { branch.events.push(text); },
	});
	assert.deepEqual(executeBoulderSetCommand("boulder set loop f", service.client), {
		kind: "set", signal: { type: "loop", value: false },
		snapshot: { states: [{ type: "loop", value: false }], blockers: [], inhibited: false },
	});
	assert.deepEqual(branch.events, ["appendEntry", "getBranch", "Boulder signal loop=false; Boulder inhibition clear"]);
});

for (const point of ["appendEntry", "getBranch", "cancelWait", "reportInfo"] as const) {
	test(`execute: ${point} failure returns kind failed and later calls do not run`, () => {
		const branch = new InMemoryBranch();
		const failure = new Error(point);
		if (point === "appendEntry") branch.appendEntry = () => { branch.events.push(point); throw failure; };
		if (point === "getBranch") branch.getBranch = () => { branch.events.push(point); throw failure; };
		const service = sessionBoundService(branch, {
			cancelWait: () => {
				branch.events.push("cancelWait");
				if (point === "cancelWait") throw failure;
			},
			reportInfo: () => {
				branch.events.push("reportInfo");
				if (point === "reportInfo") throw failure;
			},
		});
		const result = executeBoulderSetCommand("boulder set loop t", service.client);
		assert.deepEqual(result, {
			kind: "failed", signal: { type: "loop", value: true },
			failure: { message: point, cause: failure },
		});
		assert.equal(service.bus.emissions.length, 1);
		const order = ["appendEntry", "getBranch", "cancelWait", "reportInfo"];
		assert.deepEqual(branch.events, order.slice(0, order.indexOf(point) + 1));
		assert.deepEqual(branch.entries, point === "appendEntry" ? [] : [signalEntry("loop", true)]);
	});
}
