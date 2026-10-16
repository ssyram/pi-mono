import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoulderInhibitionEffects, BoulderInhibitSignal } from "../../boulder-inhibition/protocol.ts";
import { writeBoulderInhibition } from "../../boulder-inhibition/write-inhibition.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";

for (const point of ["append-before", "append-after", "getBranch", "cancelWait", "reportInfo"] as const) {
	test(`write: ${point} failure propagates unchanged without retry, rollback, or later calls`, () => {
		const branch = new InMemoryBranch([signalEntry("user", true)]);
		const failure = new Error(`failure:${point}`);
		const signal: BoulderInhibitSignal = { type: "loop", value: true };
		const append = branch.appendEntry.bind(branch);
		branch.appendEntry = (customType, data) => {
			assert.notStrictEqual(data, signal);
			if (point === "append-before") {
				branch.events.push("appendEntry");
				throw failure;
			}
			append(customType, data);
			if (point === "append-after") throw failure;
		};
		if (point === "getBranch") {
			branch.getBranch = () => {
				branch.events.push("getBranch");
				throw failure;
			};
		}
		const reports: string[] = [];
		const effects: BoulderInhibitionEffects = {
			cancelWait: () => {
				branch.events.push("cancelWait");
				if (point === "cancelWait") throw failure;
			},
			reportInfo: (text) => {
				branch.events.push("reportInfo");
				reports.push(text);
				if (point === "reportInfo") throw failure;
			},
		};
		assert.throws(() => writeBoulderInhibition(branch, effects, signal), (error: unknown) => error === failure);
		const traces: Record<typeof point, string[]> = {
			"append-before": ["appendEntry"],
			"append-after": ["appendEntry"],
			getBranch: ["appendEntry", "getBranch"],
			cancelWait: ["appendEntry", "getBranch", "cancelWait"],
			reportInfo: ["appendEntry", "getBranch", "cancelWait", "reportInfo"],
		};
		assert.deepEqual(branch.events, traces[point]);
		assert.deepEqual(branch.entries, point === "append-before"
			? [signalEntry("user", true)] : [signalEntry("user", true), signalEntry("loop", true)]);
		assert.deepEqual(signal, { type: "loop", value: true });
		assert.deepEqual(reports, point === "reportInfo"
			? ["Boulder signal loop=true; Boulder inhibited: loop, user"] : []);
	});
}

test("write: reporting a clear branch can fail after persistence without cancellation", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const failure = new Error("clear report failed");
	const effects: BoulderInhibitionEffects = {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: (text) => {
			branch.events.push(`reportInfo:${text}`);
			throw failure;
		},
	};
	assert.throws(() => writeBoulderInhibition(branch, effects, { type: "loop", value: false }),
		(error: unknown) => error === failure);
	assert.deepEqual(branch.entries, [signalEntry("loop", true), signalEntry("loop", false)]);
	assert.deepEqual(branch.events, [
		"appendEntry", "getBranch", "reportInfo:Boulder signal loop=false; Boulder inhibition clear",
	]);
});

test("write: non-Error values thrown by a port are not wrapped", () => {
	const branch = new InMemoryBranch();
	const failure = Object.freeze({ code: "append-failure" });
	branch.appendEntry = () => { branch.events.push("appendEntry"); throw failure; };
	assert.throws(() => writeBoulderInhibition(branch, {
		cancelWait: () => { branch.events.push("cancelWait"); },
		reportInfo: () => { branch.events.push("reportInfo"); },
	}, { type: "loop", value: true }), (error: unknown) => error === failure);
	assert.deepEqual(branch.events, ["appendEntry"]);
	assert.deepEqual(branch.entries, []);
});
