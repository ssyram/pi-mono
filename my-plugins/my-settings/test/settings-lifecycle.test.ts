import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { createMySettingsClient } from "../client.ts";
import mySettings from "../extension.ts";
import { MY_SETTINGS_READY_CHANNEL, type SettingsEntry, type SettingsReady, type SettingsResult } from "../protocol.ts";

function fixture() {
	const bus = createEventBus();
	const handlers = new Map<string, (event: unknown, context: ExtensionContext) => void>();
	const ready: SettingsReady[] = [];
	bus.on(MY_SETTINGS_READY_CHANNEL, (value) => ready.push(value as SettingsReady));
	let sessionId = "first";
	let branch: SettingsEntry[] = [];
	const context = {
		cwd: "/unused",
		sessionManager: { getSessionId: () => sessionId, getBranch: () => branch },
	} as unknown as ExtensionContext;
	const pi = {
		events: bus,
		on(name: string, handler: (event: unknown, context: ExtensionContext) => void) {
			handlers.set(name, handler);
		},
		appendEntry(customType: string, data: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		registerCommand() {},
	} as unknown as ExtensionAPI;
	return {
		bus,
		pi,
		context,
		ready,
		fire(name: string) {
			handlers.get(name)?.({}, context);
		},
		branch: () => branch,
		switchSession() {
			sessionId = "second";
			branch = [];
		},
	};
}

function code(result: SettingsResult) {
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected failure");
	return result.error.code;
}

test("public ready event lets consumers initialize even when registered before the service", async () => {
	const h = fixture();
	let result: Promise<SettingsResult> | undefined;
	h.bus.on(MY_SETTINGS_READY_CHANNEL, (data) => {
		result = createMySettingsClient(h.bus, data as SettingsReady).saveSession({
			values: { "example.enabled": false },
		});
	});
	mySettings(h.pi);
	h.fire("session_start");
	assert.ok(result);
	assert.deepEqual(await result, {
		ok: true,
		values: { "example.enabled": false },
	});
	assert.equal(h.ready.length, 1);
	assert.equal(h.ready[0].session, h.context.sessionManager);
	assert.equal(h.branch().length, 1);
});

test("old client cannot access a replacement session sharing the same session manager", async () => {
	const h = fixture();
	mySettings(h.pi);
	h.fire("session_start");
	const first = createMySettingsClient(h.bus, h.ready[0]);
	assert.equal((await first.saveSession({ values: { key: "first" } })).ok, true);
	h.switchSession();
	assert.equal(code(await first.saveSession({ values: { key: "stale" } })), "SESSION_UNAVAILABLE");
	h.fire("session_start");
	assert.equal(code(await first.saveSession({ values: { key: "stale" } })), "SERVICE_UNAVAILABLE");
	const second = createMySettingsClient(h.bus, h.ready[1]);
	assert.equal((await second.saveSession({ values: { key: "second" } })).ok, true);
	assert.equal(h.branch().length, 1);
	h.fire("session_shutdown");
	assert.equal(code(await second.saveSession({ values: {} })), "SERVICE_UNAVAILABLE");
	h.fire("session_start");
	assert.equal(
		(
			await createMySettingsClient(h.bus, h.ready[2]).saveSession({
				values: {},
			})
		).ok,
		true,
	);
});

test("tree changes publish readiness and startup faults do not escape into Pi", () => {
	const h = fixture();
	mySettings(h.pi);
	h.fire("session_start");
	h.fire("session_tree");
	assert.equal(h.ready.length, 2);
	const original = console.error;
	console.error = () => {
		throw new Error("diagnostic failed");
	};
	try {
		const broken = {
			events: {
				on() {
					throw new Error("registration failed");
				},
			},
			registerCommand() {},
		} as unknown as ExtensionAPI;
		assert.doesNotThrow(() => mySettings(broken));
	} finally {
		console.error = original;
	}
});
