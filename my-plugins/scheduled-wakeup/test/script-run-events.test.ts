import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { type TestContext, test } from "node:test";
import { runScript } from "../src/script-tasks/run-script.js";
import type { ScriptSpec } from "../src/script-tasks/task-spec.js";

const script: ScriptSpec = {
	cwd: "/tmp",
	path: "/bin/sh",
	params: [],
	timeoutSeconds: 1,
};

function mockChild(t: TestContext): ChildProcess {
	const child = new childProcess.ChildProcess();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	Object.defineProperty(child, "pid", { value: 123 });
	t.mock.method(childProcess, "spawn", () => child);
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	return child;
}

test("close cancels the timer and duplicate terminal events cannot change the result", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const child = mockChild(t);
	const kill = t.mock.method(process, "kill", () => true);
	const promise = runScript(script);
	child.emit("spawn");
	child.emit("close", 0, null);
	child.emit("close", 7, null);
	const result = await promise;
	assert.equal(result.status, "success");
	assert.equal(result.exitCode, 0);
	t.mock.timers.tick(2000);
	assert.equal(kill.mock.callCount(), 1);
	assert.equal(child.stdout?.destroyed, true);
	assert.equal(child.stderr?.destroyed, true);
});

test("timeout remains failure even if the close event carries zero", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const child = mockChild(t);
	const kill = t.mock.method(process, "kill", () => true);
	const promise = runScript(script);
	child.emit("spawn");
	t.mock.timers.tick(1000);
	child.emit("close", 0, null);
	const result = await promise;
	assert.equal(result.status, "timeout");
	assert.equal(result.exitCode, 0);
	assert.equal(kill.mock.callCount(), 1);
});

test("group cleanup failure cannot masquerade as success", async (t) => {
	const child = mockChild(t);
	t.mock.method(process, "kill", () => {
		throw new Error("group denied");
	});
	const promise = runScript({ ...script, timeoutSeconds: null });
	child.emit("spawn");
	child.emit("close", 0, null);
	const result = await promise;
	assert.equal(result.status, "failed");
	assert.equal(result.error, "group denied");
});

test("error after spawn settles once and cancels its timer", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const child = mockChild(t);
	const kill = t.mock.method(process, "kill", () => true);
	const promise = runScript(script);
	child.emit("spawn");
	child.emit("error", new Error("spawn error"));
	child.emit("close", 1, null);
	const result = await promise;
	assert.equal(result.status, "start-failed");
	assert.equal(result.error, "spawn error");
	t.mock.timers.tick(2000);
	assert.equal(kill.mock.callCount(), 1);
});

test("platform boundary reports unsupported Windows without spawning", async (t) => {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
	assert.ok(descriptor);
	Object.defineProperty(process, "platform", { ...descriptor, value: "win32" });
	t.after(() => Object.defineProperty(process, "platform", descriptor));
	const spawn = t.mock.method(childProcess, "spawn", () => {
		throw new Error("must not spawn");
	});
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	const result = await runScript(script);
	assert.equal(result.status, "start-failed");
	assert.ok(result.error);
	assert.match(result.error, /POSIX/);
	assert.equal(spawn.mock.callCount(), 0);
});

test("timeout priority survives an error terminal event", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const child = mockChild(t);
	t.mock.method(process, "kill", () => true);
	const promise = runScript(script);
	child.emit("spawn");
	t.mock.timers.tick(1000);
	child.emit("error", new Error("late error"));
	child.emit("close", 0, null);
	assert.equal((await promise).status, "timeout");
});

test("start failure retains its cause and any group cleanup error", async (t) => {
	const child = mockChild(t);
	t.mock.method(process, "kill", () => {
		throw new Error("denied");
	});
	const promise = runScript({ ...script, timeoutSeconds: null });
	child.emit("error", new Error("start cause"));
	child.emit("close", 1, null);
	assert.equal((await promise).error, "start cause; cleanup: denied");
});
