import assert from "node:assert/strict";
import { test } from "node:test";
import { killScriptGroup } from "../src/script-tasks/kill-script-group.js";
import { armScriptTimeout } from "../src/script-tasks/script-timeout.js";

const max = 2_147_483_647;

test("finite timeout fires exactly once and can be cancelled", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let fired = 0;
	const cancel = armScriptTimeout(2, () => {
		fired++;
	});
	t.mock.timers.tick(1999);
	assert.equal(fired, 0);
	t.mock.timers.tick(1);
	assert.equal(fired, 1);
	t.mock.timers.tick(5000);
	assert.equal(fired, 1);
	cancel();
	const cancelNext = armScriptTimeout(1, () => {
		fired++;
	});
	cancelNext();
	cancelNext();
	t.mock.timers.tick(1000);
	assert.equal(fired, 1);
});

test("null timeout creates no timer", (t) => {
	const set = t.mock.method(globalThis, "setTimeout", () => {
		throw new Error("unexpected timer");
	});
	armScriptTimeout(null, () => {
		throw new Error("unexpected timeout");
	})();
	assert.equal(set.mock.callCount(), 0);
});

test("timeouts beyond Node timer limit are chunked rather than wrapping", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let fired = 0;
	const cancel = armScriptTimeout((max + 1000) / 1000, () => {
		fired++;
	});
	t.mock.timers.tick(max);
	assert.equal(fired, 0);
	t.mock.timers.tick(999);
	assert.equal(fired, 0);
	t.mock.timers.tick(1);
	assert.equal(fired, 1);
	cancel();
});

test("cancelling after the first chunk cancels the rearmed timer", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let fired = false;
	const cancel = armScriptTimeout((max + 10) / 1000, () => {
		fired = true;
	});
	t.mock.timers.tick(max);
	cancel();
	t.mock.timers.tick(10);
	assert.equal(fired, false);
});

test("group kill addresses only the owned negative PID and reports OS errors", (t) => {
	const calls: unknown[][] = [];
	const kill = t.mock.method(process, "kill", (...args: unknown[]) => {
		calls.push(args);
		return true;
	});
	assert.equal(killScriptGroup(undefined), null);
	assert.equal(kill.mock.callCount(), 0);
	assert.equal(killScriptGroup(123), null);
	assert.deepEqual(calls, [[-123, "SIGKILL"]]);
	kill.mock.mockImplementation(() => {
		throw Object.assign(new Error("gone"), { code: "ESRCH" });
	});
	assert.equal(killScriptGroup(123), null);
	kill.mock.mockImplementation(() => {
		throw new Error("denied");
	});
	assert.equal(killScriptGroup(123), "denied");
	kill.mock.mockImplementation(() => {
		throw "denied string";
	});
	assert.equal(killScriptGroup(123), "denied string");
});
