import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installNotReadyGate } from "../src/runtime/not-ready-gate.ts";
import { RootHealth } from "../src/runtime/root-health.ts";
import { RuntimeResources } from "../src/runtime/runtime-resources.ts";

test("shutdown revokes admission, aborts waiters and disposes only owned resources in reverse order", async () => {
	const resources = new RuntimeResources();
	const order: number[] = [];
	const deadline = Date.now() + 1000;
	for (const value of [1, 2, 3]) resources.own((limit) => {
		assert.equal(limit, deadline);
		assert.equal(resources.open, false);
		assert.equal(resources.signal.aborted, true);
		order.push(value);
	});
	const first = resources.close(deadline);
	assert.equal(resources.close(deadline), first);
	await first;
	assert.deepEqual(order, [3, 2, 1]);
	assert.throws(() => resources.own(() => {}), { code: "owner-unavailable" });
});

test("a failing disposer is reported without skipping remaining resources", async () => {
	const resources = new RuntimeResources();
	const calls: number[] = [];
	resources.own(() => { calls.push(1); });
	resources.own(() => { calls.push(2); throw new Error("close"); });
	resources.own(() => { calls.push(3); });
	await assert.rejects(resources.close(Date.now() + 1000), AggregateError);
	assert.deepEqual(calls, [3, 2, 1]);
});

test("unprepared roots block input and tools; closing blocks them again", async () => {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const notices: string[] = [];
	const pi = { on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
		handlers.set(event, handler);
		return () => { handlers.delete(event); };
	} } as unknown as ExtensionAPI;
	const ctx = { ui: { notify(message: string) { notices.push(message); } } } as unknown as ExtensionContext;
	const health = new RootHealth([{ id: "self", canonicalPath: "/self" }]);
	const dispose = installNotReadyGate(pi, health, () => "runtime missing");
	assert.deepEqual(handlers.get("input")!({}, ctx), { action: "handled" });
	assert.deepEqual(handlers.get("tool_call")!({}, ctx), { block: true, reason: "runtime missing" });
	health.markInitialized("self", true);
	const epoch = health.begin("r");
	health.markPrepared(epoch, "r");
	assert.equal(health.commit(epoch), true);
	assert.equal(handlers.get("input")!({}, ctx), undefined);
	assert.equal(handlers.get("tool_call")!({}, ctx), undefined);
	health.close();
	assert.deepEqual(handlers.get("input")!({}, ctx), { action: "handled" });
	assert.deepEqual(notices, ["runtime missing", "runtime missing"]);
	dispose();
	assert.equal(handlers.size, 0);
});
