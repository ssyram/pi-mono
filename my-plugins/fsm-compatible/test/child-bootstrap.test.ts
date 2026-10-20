import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { ChildSideBootstrap, installChildInputGate } from "../src/children/child-bootstrap.ts";
import { RootLaunches } from "../src/children/root-launches.ts";
import { ChildRuns } from "../src/children/child-runs.ts";
import { DelegationBus, type EventSurface } from "../src/children/delegation-bus.ts";
import { createOcHandlers } from "../src/protocol/oc-handlers.ts";
import { OcServer } from "../src/protocol/oc-server.ts";
import { JudgeSessions } from "../src/judge/judge-session.ts";
import { RecordStore } from "../src/records/record-store.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { child, pending, policy, records, root, selfExtension, unwrap } from "./admission-fixtures.ts";
import { readPersistedBinding } from "../src/binding/read-persisted-binding.ts";

function staticSurface(): EventSurface {
	return { emit: () => {}, on: () => () => {} };
}

test("child input transformer strips the bootstrap prefix exactly once and stays model-invisible", () => {
	const bootstrap = new ChildSideBootstrap("/tmp/scope");
	const handlers = new Map<string, (event: unknown) => unknown>();
	const pi = { on: (event: string, handler: (event: unknown) => unknown) => {
		handlers.set(event, handler);
		return () => handlers.delete(event);
	} } as unknown as ExtensionAPI;
	installChildInputGate(pi, bootstrap);
	const input = handlers.get("input")!;
	const prefixed = "[fsm-bootstrap:123e4567-e89b-12d3-a456-426614174000]\n\ndo the task";
	assert.deepEqual(input({ text: prefixed }), { action: "transform", text: "do the task" });
	assert.equal(input({ text: "second message" }), undefined);
	assert.equal(bootstrap.gateBinding(), undefined);
});

test("initialize restores an existing binding entry and binds a fresh child otherwise", async () => {
	const source = policy();
	const tree = records(root(source), child("r", "existing-child", source));
	const manager = SessionManager.inMemory("/work", { id: "existing-child" });
	const saved = child("r", "existing-child", source);
	manager.appendCustomEntry("fsm-compatible:binding", saved as never);
	const entries = manager.getBranch() as SessionEntry[];
	const bootstrap = new ChildSideBootstrap("/tmp/scope");
	const restored = await bootstrap.initialize("existing-child", entries, tree, source, pending(source));
	assert.equal(restored.sessionId, "existing-child");
	assert.equal(bootstrap.gateBinding()?.agentId, "existing-child");
	const reread = readPersistedBinding(entries, "existing-child");
	assert.ok(reread.ok && reread.value);
	assert.equal(reread.value.sessionId, "existing-child");

	const freshManager = SessionManager.inMemory("/work", { id: "fresh-child" });
	const fresh = new ChildSideBootstrap("/tmp/scope");
	const launch = pending(source);
	launch.state = "registered";
	launch.registeredSessionId = "fresh-child";
	const bound = await fresh.initialize("fresh-child", freshManager.getBranch() as SessionEntry[],
		records(root(source)), source, launch);
	assert.ok(bound);
	assert.equal(bound.agentId, "fresh-child");
	assert.equal(bound.parentSessionId, "r");
});

test("launch-ack flows over the bridge HTTP surface and resolves the FIFO handshake", async (t) => {
	const scope = await RootLaunches.openScope();
	t.after(() => rm(scope, { recursive: true, force: true }));
	const bus = new DelegationBus(staticSurface());
	const runs = new ChildRuns(8, () => {});
	void new RootLaunches(bus, runs, scope, 4, "r", { url: "placeholder", password: "bridge-pw" }, 2000);
	const fake = {
		emit: (event: string, payload: unknown) => {
			if (event !== "prompt-template:subagent:request") return;
			const request = payload as { requestId: string };
			void fetch(`${base}/fsm-compatible/launch-ack`, { method: "POST", headers: { authorization },
				body: JSON.stringify({ bootstrapRef: request.requestId, sessionId: "child-http" }) })
				.then(() => undefined, () => undefined);
		},
		on: () => () => {},
	} as EventSurface;
	const httpBus = new DelegationBus(fake);
	const httpRuns = new ChildRuns(8, () => {});
	const store = new RecordStore(root());
	store.publishExecution(root(), { title: "root", lifecycle: "idle", updatedAt: Date.now(),
		header: null, branch: [], sessionFile: null, errorMessage: null });
	const judges = new JudgeSessions(store, "/tmp", { model: {} as never, getApiKey: () => "k", streamFn: () => {} });
	const httpLaunches = new RootLaunches(httpBus, httpRuns, scope, 4, "r", { url: "x", password: "bridge-pw" }, 2000);
	const server = new OcServer(createOcHandlers(store, judges, {
		launchAck: (ref, sid) => httpLaunches.onLaunchAck(ref, sid),
	}));
	server.setPassword("bridge-pw");
	const base = await server.listen();
	t.after(() => server.close());
	const authorization = `Basic ${Buffer.from("opencode:bridge-pw").toString("base64")}`;
	const outcome = await httpLaunches.launch({ agent: "worker", policy: { allowedAgents: ["worker"], maxDepth: 8, requiredExtensions: [] }, task: "over bridge", callerSessionId: "caller" });
	assert.deepEqual(outcome, { ok: true, nodeId: outcome.ok ? outcome.nodeId : "", childSessionId: "child-http" });
	const badAck = await fetch(`${base}/fsm-compatible/launch-ack`, { method: "POST", headers: { authorization },
		body: JSON.stringify({ bootstrapRef: "123e4567-e89b-12d3-a456-426614174000", sessionId: "x" }) });
	assert.equal(badAck.status, 404);
	const unauth = await fetch(`${base}/fsm-compatible/launch-ack`, { method: "POST", body: "{}" });
	// OC-parity auth: loopback requests without credentials reach the handler
	// and fail shape validation there (400) instead of being rejected as 401.
	assert.equal(unauth.status, 400);
});
