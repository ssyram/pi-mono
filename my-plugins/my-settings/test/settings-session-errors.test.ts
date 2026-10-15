import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { createMySettingsClient } from "../client.ts";
import type { SettingsResult } from "../protocol.ts";
import { registerMySettingsService } from "../settings-service.ts";
import { settingsFixture } from "./settings-fixture.ts";

function failed(result: SettingsResult, code: string) {
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected settings failure");
	assert.equal(result.error.code, code);
	return result.error.message;
}

function silenceDiagnostics(t: { after(callback: () => void): void }) {
	const original = console.error;
	console.error = () => {};
	t.after(() => {
		console.error = original;
	});
}

test("session changes during queued saves cannot append settings into the replacement session", async (t) => {
	silenceDiagnostics(t);
	const h = await settingsFixture(t);
	let held: (() => void) | undefined;
	const release = new Promise<void>((resolve) => {
		held = resolve;
	});
	const bus = createEventBus();
	const dispose = registerMySettingsService(
		bus,
		() => ({ ok: true, value: h.session }),
		h.globalRoot,
		async (_path, action) => {
			await release;
			return action();
		},
	);
	assert.ok(dispose.ok);
	t.after(() => {
		assert.ok(dispose.value().ok);
	});
	const client = createMySettingsClient(bus, h.owner);
	const pending = client.saveGlobalAndSession({ values: { key: 1 } });
	h.setActive(false);
	assert.ok(held);
	held();
	failed(await pending, "SESSION_UNAVAILABLE");
	assert.deepEqual(h.branch(), []);
	await assert.rejects(readFile(join(h.globalRoot, "settings.json")), {
		code: "ENOENT",
	});
});

test("Pi port failures become explicit errors, including committed files with a failed log", async (t) => {
	silenceDiagnostics(t);
	const h = await settingsFixture(t);
	h.failAppend();
	failed(await h.client.saveSession({ values: {} }), "OPERATION_FAILED");
	failed(await h.client.saveGlobalAndSession({ values: { enabled: false } }), "OPERATION_FAILED");
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "settings.json"), "utf8")), { enabled: false });
});
