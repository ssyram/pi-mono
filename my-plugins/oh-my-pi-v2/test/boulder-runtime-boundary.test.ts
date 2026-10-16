import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { registerBoulderInhibitionAdapter } from "../hooks/boulder-inhibition-adapter.js";
import { createBoulderInhibitionClient } from "../boulder-inhibition/service-client.ts";
import { startSilentCountdown } from "../hooks/boulder-countdown.js";

test("adapter never writes an inactive session through current pi.appendEntry", (t) => {
	const hooks = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
	const left: unknown[] = [], right: unknown[] = [];
	const leftManager = { getBranch: () => left }, rightManager = { getBranch: () => right };
	let active = left;
	const pi = {
		events: createEventBus(),
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => void) { hooks.set(name, handler); },
		appendEntry(customType: string, data: unknown) { active.push({ type: "custom", customType, data }); },
	} as unknown as ExtensionAPI;
	const dispose = registerBoulderInhibitionAdapter(pi, () => undefined);
	t.after(dispose);
	hooks.get("session_start")?.({}, { sessionManager: leftManager } as unknown as ExtensionContext);
	const old = createBoulderInhibitionClient(pi.events, leftManager);
	assert.equal(old.set({ type: "user", value: true }).ok, true);
	active = right;
	hooks.get("session_start")?.({}, { sessionManager: rightManager } as unknown as ExtensionContext);
	const before = right.length;
	assert.deepEqual(old.set({ type: "user", value: false }), { ok: false, failure: { message: "Boulder inhibition session unavailable" } });
	assert.equal(right.length, before);
	hooks.get("session_shutdown")?.({}, { sessionManager: rightManager } as unknown as ExtensionContext);
	assert.equal(createBoulderInhibitionClient(pi.events, rightManager).get().ok, false);
});

test("silent timer contains both finish and reporter exceptions", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const hostile = { toString() { throw new Error("cannot describe"); } };
	const original = console.error;
	console.error = () => { throw hostile; };
	t.after(() => { console.error = original; });
	startSilentCountdown(1, () => { throw hostile; }, () => { throw hostile; });
	assert.doesNotThrow(() => t.mock.timers.tick(1));
});
