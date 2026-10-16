import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBoulderInhibition } from "../../boulder-inhibition/check-inhibition.ts";
import { InMemoryBranch, signalEntry } from "./in-memory-branch.ts";

test("check: every call rereads the branch and reports once without appending", () => {
	const branch = new InMemoryBranch([signalEntry("user", true), signalEntry("loop", true)]);
	const reportInfo = (text: string): void => { branch.events.push(`reportInfo:${text}`); };
	const first = checkBoulderInhibition(branch, reportInfo);
	assert.deepEqual(first, {
		states: [{ type: "loop", value: true }, { type: "user", value: true }],
		blockers: ["loop", "user"], inhibited: true,
	});
	assert.deepEqual(branch.entries, [signalEntry("user", true), signalEntry("loop", true)]);
	branch.entries.push(signalEntry("loop", false));
	assert.deepEqual(checkBoulderInhibition(branch, reportInfo), {
		states: [{ type: "loop", value: false }, { type: "user", value: true }],
		blockers: ["user"], inhibited: true,
	});
	branch.entries.push(signalEntry("user", false));
	const clear = {
		states: [{ type: "user", value: false }, { type: "loop", value: false }],
		blockers: [], inhibited: false,
	};
	assert.deepEqual(checkBoulderInhibition(branch, reportInfo), clear);
	assert.deepEqual(checkBoulderInhibition(branch, reportInfo), clear);
	assert.equal(branch.entries.length, 4);
	assert.deepEqual(branch.events, [
		"getBranch", "reportInfo:Boulder inhibited: loop, user",
		"getBranch", "reportInfo:Boulder inhibited: user",
		"getBranch", "reportInfo:Boulder inhibition clear",
		"getBranch", "reportInfo:Boulder inhibition clear",
	]);
	assert.deepEqual(first.blockers, ["loop", "user"]);
});

test("check: switching the reader's selected branch never reuses cached blockers", () => {
	const branch = new InMemoryBranch([signalEntry("left", true)]);
	const reports: string[] = [];
	assert.deepEqual(checkBoulderInhibition(branch, (text) => { reports.push(text); }).blockers, ["left"]);
	branch.entries = [];
	assert.deepEqual(checkBoulderInhibition(branch, (text) => { reports.push(text); }), {
		states: [], blockers: [], inhibited: false,
	});
	branch.entries = [signalEntry("right", true)];
	assert.deepEqual(checkBoulderInhibition(branch, (text) => { reports.push(text); }).blockers, ["right"]);
	assert.deepEqual(branch.events, ["getBranch", "getBranch", "getBranch"]);
	assert.deepEqual(reports, ["Boulder inhibited: left", "Boulder inhibition clear", "Boulder inhibited: right"]);
});

test("check: getBranch failure is propagated and reporting is not attempted", () => {
	const failure = new Error("branch unavailable");
	const events: string[] = [];
	assert.throws(() => checkBoulderInhibition({
		getBranch: () => { events.push("getBranch"); throw failure; },
	}, () => { events.push("reportInfo"); }), (error: unknown) => error === failure);
	assert.deepEqual(events, ["getBranch"]);
});

test("check: report failure propagates after one read and one report without retry", () => {
	const branch = new InMemoryBranch([signalEntry("loop", true)]);
	const failure = new Error("display failed");
	assert.throws(() => checkBoulderInhibition(branch, (text) => {
		branch.events.push(`reportInfo:${text}`);
		throw failure;
	}), (error: unknown) => error === failure);
	assert.deepEqual(branch.events, ["getBranch", "reportInfo:Boulder inhibited: loop"]);
	assert.deepEqual(branch.entries, [signalEntry("loop", true)]);
});

test("check: a reader supplies a frozen finite branch and receives no write operations", () => {
	const data = Object.freeze({ type: "loop", value: true });
	const entries = Object.freeze([Object.freeze({ type: "custom", customType: "OMPv2InhibitBoulder", data })]);
	const events: string[] = [];
	assert.deepEqual(checkBoulderInhibition({
		getBranch: () => { events.push("getBranch"); return entries; },
	}, (text) => { events.push(text); }), {
		states: [{ type: "loop", value: true }], blockers: ["loop"], inhibited: true,
	});
	assert.deepEqual(events, ["getBranch", "Boulder inhibited: loop"]);
});
