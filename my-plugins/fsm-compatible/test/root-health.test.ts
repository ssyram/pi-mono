import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installManagedFactories, type ManagedFactory } from "../src/runtime/managed-bootstrap.ts";
import { RootHealth } from "../src/runtime/root-health.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
function fakePi() {
	const handlers = new Map<string, Handler[]>();
	const messages: unknown[] = [];
	const pi = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
		},
		sendMessage: (message: unknown) => messages.push(message),
		sendUserMessage: (message: unknown) => messages.push(message),
	} as unknown as ExtensionAPI;
	return {
		pi, messages,
		async startup(sessionId: string) {
			const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;
			const snapshot = [...(handlers.get("session_start") ?? [])];
			const errors: unknown[] = [];
			for (const handler of snapshot) { try { await handler({}, ctx); } catch (error) { errors.push(error); } }
			return errors;
		},
	};
}
function preparedFactory(health: RootHealth, callback?: () => void): ManagedFactory {
	return { id: "self", canonicalPath: "/self.ts", factory(api) {
		api.on("session_start", (_event, ctx) => {
			const epoch = health.epoch;
			assert.ok(epoch);
			callback?.();
			health.markPrepared(epoch, ctx.sessionManager.getSessionId());
		});
	} };
}

test("root ready requires actual initialization and every current startup callback", async () => {
	const health = new RootHealth([{ id: "self", canonicalPath: "/self.ts" }, { id: "extra", canonicalPath: "/extra.ts" }]);
	const sdk = fakePi();
	let sawNotReady = false;
	await installManagedFactories(sdk.pi, [preparedFactory(health), { id: "extra", canonicalPath: "/extra.ts", factory(api) {
		api.on("session_start", () => { sawNotReady = !health.ready; });
	} }], health);
	assert.equal(health.ready, false);
	assert.deepEqual(await sdk.startup("r"), []);
	assert.equal(sawNotReady, true);
	assert.equal(health.ready, true);
	assert.equal(health.commit(health.epoch!), false);
});

test("initialization and startup failures never become ready", async () => {
	for (const duringStartup of [false, true]) {
		const health = new RootHealth([{ id: "self", canonicalPath: "/self.ts" }, { id: "extra", canonicalPath: "/extra.ts" }]);
		const sdk = fakePi();
		await installManagedFactories(sdk.pi, [preparedFactory(health), { id: "extra", canonicalPath: "/extra.ts", factory(api) {
			if (!duringStartup) throw new Error("initialize");
			api.on("session_start", () => { throw new Error("startup"); });
		} }], health);
		await sdk.startup("r");
		assert.equal(health.ready, false);
		await sdk.startup("new-root");
		assert.equal(health.ready, false);
	}
});

test("D2-2: off before dispatch removes both the real handler and its future obligation", async () => {
	const health = new RootHealth([{ id: "self", canonicalPath: "/self.ts" }, { id: "extra", canonicalPath: "/extra.ts" }]);
	const sdk = fakePi();
	let called = false;
	await installManagedFactories(sdk.pi, [preparedFactory(health), { id: "extra", canonicalPath: "/extra.ts", factory(api) {
		const off = api.on("session_start", () => { called = true; });
		off(); off();
	} }], health);
	await sdk.startup("r");
	assert.equal(called, false);
	assert.equal(health.ready, true);
});

test("D2-2: off during the event does not erase its already captured callback", async () => {
	const health = new RootHealth([{ id: "self", canonicalPath: "/self.ts" }, { id: "extra", canonicalPath: "/extra.ts" }]);
	const sdk = fakePi();
	let off = () => {};
	let calls = 0;
	await installManagedFactories(sdk.pi, [preparedFactory(health, () => { off(); assert.equal(health.ready, false); }),
		{ id: "extra", canonicalPath: "/extra.ts", factory(api) { off = api.on("session_start", () => { calls++; }); } }], health);
	await sdk.startup("r");
	assert.equal(calls, 1);
	assert.equal(health.ready, true);
	await sdk.startup("r2");
	assert.equal(calls, 1);
	assert.equal(health.ready, true);
});

test("D2-2: on during startup belongs only to the next snapshot", async () => {
	const health = new RootHealth([{ id: "self", canonicalPath: "/self.ts" }, { id: "extra", canonicalPath: "/extra.ts" }]);
	const sdk = fakePi();
	let extraApi: ExtensionAPI | undefined;
	let registered = false;
	let calls = 0;
	await installManagedFactories(sdk.pi, [preparedFactory(health, () => {
		if (registered) return;
		registered = true;
		assert.ok(extraApi);
		extraApi.on("session_start", () => { calls++; });
	}), { id: "extra", canonicalPath: "/extra.ts", factory(api) { extraApi = api; } }], health);
	await sdk.startup("r");
	assert.equal(calls, 0);
	assert.equal(health.ready, true);
	await sdk.startup("r2");
	assert.equal(calls, 1);
	assert.equal(health.ready, true);
});

test("old epoch acknowledgments and incomplete resources cannot commit", () => {
	const health = new RootHealth([{ id: "self", canonicalPath: "/self.ts" }]);
	health.markInitialized("self", true);
	const { token } = health.registerStartup("self");
	const old = health.begin("r");
	const current = health.begin("r2");
	health.observe(old, "r", token, true);
	health.markPrepared(old, "r");
	assert.equal(health.commit(current), false);
	health.observe(current, "r2", token, true);
	assert.equal(health.commit(current), false);
	health.markPrepared(current, "r2");
	assert.equal(health.commit(current), true);
	health.close();
	assert.equal(health.ready, false);
});

test("managed factories cannot start model turns before ready; diagnostics remain explicit", async () => {
	const health = new RootHealth([{ id: "self", canonicalPath: "/self.ts" }]);
	const sdk = fakePi();
	await installManagedFactories(sdk.pi, [{ id: "self", canonicalPath: "/self.ts", factory(api) {
		assert.throws(() => api.sendUserMessage("not ready"));
		assert.throws(() => api.sendMessage({ customType: "x", content: "x", display: true }, { triggerTurn: true }));
		api.sendMessage({ customType: "x", content: "diagnostic", display: true }, { triggerTurn: false });
	} }], health);
	assert.equal(sdk.messages.length, 1);
	await sdk.startup("r");
	assert.equal(health.ready, false);
});
