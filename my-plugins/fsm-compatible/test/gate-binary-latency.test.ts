import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDaemonRequester, type DaemonRequest } from "../src/broker/daemon-request.ts";
import { installPermissionGate } from "../src/gates/permission-gate.ts";
import { runStopCheck } from "../src/gates/stop-gate.ts";
import { startOwnedProcess } from "../src/process/owned-process.ts";
import { protocolDirectory } from "./broker-fixtures.ts";

test("real daemon repeated permission/Stop checks do not wait for identity TTL", {
	skip: !process.env.FSM_COMPATIBLE_TEST_SERVER,
	timeout: 30000,
}, async (t) => {
	const dataDir = await protocolDirectory(t);
	const server = process.env.FSM_COMPATIBLE_TEST_SERVER;
	assert.ok(server);
	const daemon = startOwnedProcess(server, ["serve", "--data-dir", dataDir], { ...process.env, FSM_DATA_DIR: dataDir });
	daemon.child.stdout.resume();
	daemon.child.stderr.resume();
	t.after(async () => { assert.equal(await daemon.close(Date.now() + 5000), true); });
	const request = createDaemonRequester(dataDir);
	const startupDeadline = Date.now() + 10000;
	for (;;) {
		try {
			assert.equal((await request({ method: "GET", path: "/capabilities", deadline: startupDeadline })).status, 200);
			break;
		} catch (error) {
			if (Date.now() >= startupDeadline) throw error;
			await delay(20);
		}
	}
	let gate: ((event: unknown, ctx: ExtensionContext) => unknown) | undefined;
	const pi = { on(_event: string, handler: typeof gate) { gate = handler; return () => {}; } } as unknown as ExtensionAPI;
	const context = { signal: undefined } as unknown as ExtensionContext;
	let agentId = "main";
	const seen: DaemonRequest[] = [];
	installPermissionGate(pi, async (input) => {
		seen.push(input);
		return request(input);
	}, () => ({ sessionId: "latency-regression", agentId }), 3000);
	assert.ok(gate);
	for (const actor of ["main", "child-1"]) {
		agentId = actor;
		const permissionStart = performance.now();
		for (let index = 0; index < 3; index++) {
			assert.equal(await gate({ toolName: "write", input: { path: "/probe", content: "x" } }, context), undefined);
		}
		const permissionMs = performance.now() - permissionStart;
		assert.ok(permissionMs < 5000, `three permission checks took ${permissionMs}ms`);
		const stopStart = performance.now();
		for (let index = 0; index < 3; index++) {
			assert.equal((await runStopCheck(request, { sessionId: "latency-regression", agentId }, [], Date.now() + 3000)).isTerminal, true);
		}
		const stopMs = performance.now() - stopStart;
		assert.ok(stopMs < 5000, `three stop checks took ${stopMs}ms`);
		t.diagnostic(JSON.stringify({ agentId, permissionMs, stopMs }));
	}
	const checks = seen.filter((input) => input.path === "/check-permission");
	assert.equal(checks.length, 6);
	assert.ok(checks.every((input) => input.identity === undefined));
});
