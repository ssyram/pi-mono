import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { FsmBroker } from "../src/broker/fsm-broker.ts";
import { acquireCanonicalLease } from "../src/coordination/canonical-lease.ts";
import type { DaemonRequester } from "../src/broker/daemon-request.ts";
import { RuntimeError } from "../src/runtime/runtime-error.ts";
import { root } from "./admission-fixtures.ts";
import { fakeDaemon, fakeTransport, protocolDirectory } from "./broker-fixtures.ts";

const host = { pid: process.pid, startId: "1234" };
const source = { rootSessionId: "r", pid: process.pid, cwd: "/work", serverUrl: "http://127.0.0.1:9001" };

test("bounded broker queue rejects overflow before writes; close cancels unstarted callers", async (t) => {
	const scope = join(await protocolDirectory(t), "coord");
	const lease = await acquireCanonicalLease(scope, host, "fsm_get_state", "other", Date.now() + 1000);
	try {
		const daemon = fakeDaemon();
		const { transport, catalog } = await fakeTransport(t);
		const broker = new FsmBroker({ host, source, scope, request: daemon.request, transport, catalog, capacity: 1 });
		const waiting = assert.rejects(broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 3000 }), { code: "cancelled" });
		await assert.rejects(broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 3000 }), { code: "queue-full" });
		assert.equal(await broker.close(Date.now() + 1000), true);
		await waiting;
		assert.equal(daemon.seen.length, 0);
	} finally { await lease.release(); }
});

test("unknown register writes retain isolation and never proceed to identity", async (t) => {
	const scope = join(await protocolDirectory(t), "coord");
	const seen: string[] = [];
	const request: DaemonRequester = async (input) => {
		seen.push(input.path);
		throw new RuntimeError("transport-failed");
	};
	const { transport, catalog } = await fakeTransport(t);
	const broker = new FsmBroker({ host, source, scope, request, transport, catalog });
	await assert.rejects(broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 1000 }), { code: "delivery-unknown" });
	assert.deepEqual(seen, ["/session/register"]);
	assert.equal((await readdir(scope)).length, 1);
});

test("MCP unknown after send waits for confirmed process closure before releasing isolation", async (t) => {
	const scope = join(await protocolDirectory(t), "coord");
	const daemon = fakeDaemon();
	const { transport, catalog } = await fakeTransport(t, "stall");
	const close = transport.close.bind(transport);
	let observedHeld = false;
	let observedClosed = false;
	transport.close = async (deadline) => {
		observedHeld = (await readdir(scope)).length === 1;
		await delay(10);
		observedClosed = await close(deadline);
		return observedClosed;
	};
	try {
		const broker = new FsmBroker({ host, source, scope, request: daemon.request, transport, catalog });
		await assert.rejects(broker.invoke(root(), "fsm_get_state", {}, { deadline: Date.now() + 80 }), { code: "delivery-unknown" });
		assert.equal(observedHeld, true);
		assert.equal(observedClosed, true);
		assert.deepEqual(await readdir(scope), []);
	} finally { transport.close = close; }
});
