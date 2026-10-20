import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ChildRuns, lifecycleForStatus } from "../src/children/child-runs.ts";
import { DelegationBus, type DelegationRequest, type EventSurface } from "../src/children/delegation-bus.ts";
import { RootLaunches } from "../src/children/root-launches.ts";

function fakeSurface() {
	const handlers = new Map<string, Array<(payload: unknown) => void>>();
	const emitted: Array<{ event: string; payload: unknown }> = [];
	const surface: EventSurface = {
		emit(event, payload) { emitted.push({ event, payload }); },
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
		},
	};
	const dispatch = (event: string, payload: unknown) => { for (const handler of [...(handlers.get(event) ?? [])]) handler(payload); };
	return { surface, emitted, dispatch };
}

function harness(capacity = 8, startTimeout = 500) {
	const fake = fakeSurface();
	const bus = new DelegationBus(fake.surface);
	const notifications: Array<{ caller: string; status: string }> = [];
	const runs = new ChildRuns(capacity, (caller, run) =>
		notifications.push({ caller, status: run.terminal?.status ?? "pending" }));
	bus.subscribe({
		started: (tuple) => runs.onStarted(tuple),
		update: (tuple, runId) => runs.onUpdate(tuple, runId),
		response: (response) => runs.onTerminal(response),
	});
	return { fake, bus, runs, notifications, dispatch: fake.dispatch };
}

test("FIFO handshakes do not interleave; failure releases the queue; duplicate is surfaced", async (t) => {
	const scope = await RootLaunches.openScope();
	t.after(() => rm(scope, { recursive: true, force: true }));
	const { bus, fake, runs, dispatch } = harness();
	const launches = new RootLaunches(bus, runs, scope, 4, "root-1", { url: "http://127.0.0.1:9", password: "pw" }, 800);
	const first = launches.launch({ agent: "worker", policy: { allowedAgents: ["worker"], maxDepth: 8, requiredExtensions: [] }, task: "first task", callerSessionId: "caller-a" });
	await delay(30);
	const second = launches.launch({ agent: "worker", policy: { allowedAgents: ["worker"], maxDepth: 8, requiredExtensions: [] }, task: "second task", callerSessionId: "caller-b" });
	await delay(30);
	assert.equal(fake.emitted.filter((entry) => entry.event === "prompt-template:subagent:request").length, 1, "second waits for the first handshake");
	const firstRequest = fake.emitted[0]!.payload as DelegationRequest;
	assert.match(firstRequest.task, /^\[fsm-bootstrap:[0-9a-f-]{36}\]\n\nfirst task$/);
	const firstRef = RootLaunches.splitBootstrapTask(firstRequest.task)!.bootstrapRef;
	launches.onLaunchAck(firstRef, "child-session-1");
	assert.deepEqual(await first, { ok: true, nodeId: firstRequest.nodeId, childSessionId: "child-session-1" });
	await delay(30);
	const secondRequest = fake.emitted[1]!.payload as DelegationRequest;
	assert.ok(secondRequest);
	const secondRef = RootLaunches.splitBootstrapTask(secondRequest.task)!.bootstrapRef;
	dispatch("prompt-template:subagent:response", { requestId: secondRef, ownerRunId: "root-1",
		nodeId: secondRequest.nodeId, status: "duplicate_node" });
	assert.deepEqual(await second, { ok: false, code: "duplicate" });
	const third = launches.launch({ agent: "worker", policy: { allowedAgents: ["worker"], maxDepth: 8, requiredExtensions: [] }, task: "third", callerSessionId: "caller-a" });
	await delay(30);
	const thirdRequest = fake.emitted[2]!.payload as DelegationRequest;
	dispatch("prompt-template:subagent:response", { requestId: RootLaunches.splitBootstrapTask(thirdRequest.task)!.bootstrapRef,
		ownerRunId: "root-1", nodeId: thirdRequest.nodeId, status: "failed", error: "boom" });
	assert.deepEqual(await third, { ok: false, code: "not-ready" });
});

test("terminal correlation notifies the real caller once; a second terminal is rejected", async (t) => {
	const scope = await RootLaunches.openScope();
	t.after(() => rm(scope, { recursive: true, force: true }));
	const { bus, fake, runs, dispatch, notifications } = harness();
	const launches = new RootLaunches(bus, runs, scope, 4, "root-1", { url: "http://127.0.0.1:9", password: "pw" }, 800);
	const pending = launches.launch({ agent: "worker", policy: { allowedAgents: ["worker"], maxDepth: 8, requiredExtensions: [] }, task: "job", callerSessionId: "caller-9" });
	await delay(20);
	const request = fake.emitted[0]!.payload as DelegationRequest;
	const ref = RootLaunches.splitBootstrapTask(request.task)!.bootstrapRef;
	launches.onLaunchAck(ref, "child-session-9");
	await pending;
	dispatch("prompt-template:subagent:update", { requestId: ref, ownerRunId: "root-1", nodeId: request.nodeId, runId: "run-77" });
	assert.equal(runs.find(request.nodeId)?.runId, "run-77");
	dispatch("prompt-template:subagent:response", { requestId: ref, ownerRunId: "root-1", nodeId: request.nodeId, status: "completed" });
	assert.deepEqual(notifications, [{ caller: "caller-9", status: "completed" }]);
	assert.throws(() => dispatch("prompt-template:subagent:response",
		{ requestId: ref, ownerRunId: "root-1", nodeId: request.nodeId, status: "failed" }), { code: "protocol-invalid" });
	assert.equal(lifecycleForStatus("completed"), "idle");
	assert.equal(lifecycleForStatus("invalid_request"), "failed");
	assert.equal(lifecycleForStatus("unavailable_context"), "failed");
	assert.equal(lifecycleForStatus("interrupted"), "aborted");
});

test("cancel waits for the actual terminal; missing terminal becomes unknown", async (t) => {
	const scope = await RootLaunches.openScope();
	t.after(() => rm(scope, { recursive: true, force: true }));
	const { bus, runs, dispatch } = harness();
	const tuple = { requestId: "req-1", ownerRunId: "root-1", nodeId: "node-1" };
	runs.open(tuple, "caller-1", "worker");
	const waiting = runs.cancel(bus, "node-1", Date.now() + 300);
	await delay(10);
	dispatch("prompt-template:subagent:response", { ...tuple, status: "cancelled" });
	assert.equal((await waiting)?.status, "cancelled");
	runs.open({ ...tuple, nodeId: "node-2", requestId: "req-2" }, "caller-1", "worker");
	await assert.rejects(runs.cancel(bus, "node-2", Date.now() + 60), { code: "delivery-unknown" });
	assert.equal(runs.find("node-2")?.unknown, true);
});

test("bootstrap split and file roundtrip reject malformed refs", async (t) => {
	const scope = await RootLaunches.openScope();
	t.after(() => rm(scope, { recursive: true, force: true }));
	assert.equal(RootLaunches.splitBootstrapTask("plain task"), null);
	const parsed = RootLaunches.splitBootstrapTask("[fsm-bootstrap:123e4567-e89b-12d3-a456-426614174000]\n\nreal task");
	assert.deepEqual(parsed, { bootstrapRef: "123e4567-e89b-12d3-a456-426614174000", task: "real task" });
	await assert.rejects(RootLaunches.readBootstrap(scope, "../escape"), { code: "protocol-invalid" });
	await assert.rejects(RootLaunches.readBootstrap(scope, "123e4567-e89b-12d3-a456-426614174000"), { code: "not-ready" });
});


test("waiters are keyed per row: a terminal resolves only its own launch", async () => {
	const { runs, dispatch } = harness();
	const tupleA = { requestId: "ra", ownerRunId: "root-1", nodeId: "node-a" };
	const tupleB = { requestId: "rb", ownerRunId: "root-1", nodeId: "node-b" };
	runs.open(tupleA, "caller-a", "worker");
	runs.open(tupleB, "caller-b", "worker");
	const waitingA = runs.awaitTerminal("node-a", Date.now() + 500);
	const waitingB = runs.awaitTerminal("node-b", Date.now() + 500);
	dispatch("prompt-template:subagent:response", { ...tupleA, status: "completed" });
	assert.equal((await waitingA)?.status, "completed");
	await delay(20);
	let bSettled = false;
	void waitingB.then(() => { bSettled = true; }, () => { bSettled = true; });
	await delay(20);
	assert.equal(bSettled, false, "row B must not be resolved by row A's terminal");
	dispatch("prompt-template:subagent:response", { ...tupleB, status: "failed" });
	assert.equal((await waitingB)?.status, "failed");
});

test("active rows are released by terminals so capacity reflects live work only", () => {
	const { runs, dispatch } = harness(2);
	const first = { requestId: "r1", ownerRunId: "root-1", nodeId: "n1" };
	const second = { requestId: "r2", ownerRunId: "root-1", nodeId: "n2" };
	runs.open(first, "c1", "worker");
	runs.open(second, "c2", "worker");
	assert.throws(() => runs.open({ requestId: "r3", ownerRunId: "root-1", nodeId: "n3" }, "c3", "worker"), { code: "queue-full" });
	dispatch("prompt-template:subagent:response", { ...first, status: "completed" });
	assert.equal(runs.activeSize, 1);
	runs.open({ requestId: "r3", ownerRunId: "root-1", nodeId: "n3" }, "c3", "worker");
	assert.equal(runs.find("n1")?.terminal?.status, "completed");
});

test("lifecycle mapping covers every SA status exactly once", () => {
	const expected: Record<string, string> = {
		completed: "idle", failed: "failed", timed_out: "failed", cancelled: "aborted", interrupted: "aborted",
		tool_budget_exhausted: "failed", structured_output_failed: "failed", acceptance_failed: "failed",
		invalid_request: "failed", unavailable_context: "failed", duplicate_node: "unavailable",
	};
	assert.equal(Object.keys(expected).length, 11);
	for (const [status, lifecycle] of Object.entries(expected)) {
		assert.equal(lifecycleForStatus(status), lifecycle, status);
	}
});

test("launch-level bounds: capacity, deadline and caller cancellation are enforced without side effects", async (t) => {
	const scope = await RootLaunches.openScope();
	t.after(() => rm(scope, { recursive: true, force: true }));
	const surface: EventSurface = { emit: () => {}, on: () => () => {} };
	const bus = new DelegationBus(surface);
	const runs = new ChildRuns(4, () => {});
	const launches = new RootLaunches(bus, runs, scope, 1, "r", { url: "http://127.0.0.1:9", password: "pw" }, 80);
	const policy = { allowedAgents: ["worker"], maxDepth: 8, requiredExtensions: [] };
	const blocked = launches.launch({ agent: "worker", policy, task: "hold", callerSessionId: "caller" });
	await delay(10);
	const overflow = await launches.launch({ agent: "worker", policy, task: "second", callerSessionId: "caller" });
	assert.deepEqual(overflow, { ok: false, code: "queue-full" });
	const held = await blocked;
	assert.deepEqual(held, { ok: false, code: "delivery-unknown" });
	assert.deepEqual(await launches.launch({ agent: "worker", policy, task: "late", callerSessionId: "caller",
		deadline: Date.now() - 1 }), { ok: false, code: "deadline-exceeded" });
	const controller = new AbortController();
	controller.abort();
	assert.deepEqual(await launches.launch({ agent: "worker", policy, task: "gone", callerSessionId: "caller",
		signal: controller.signal }), { ok: false, code: "cancelled" });
});
