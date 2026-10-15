import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { createMySettingsClient } from "../client.ts";
import { MY_SETTINGS_CHANNEL, type SettingsResult } from "../protocol.ts";
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

test("missing service returns an internal error asking to install my-settings, without defaults", async () => {
	const client = createMySettingsClient(createEventBus(), {
		session: {},
		sessionId: "missing",
	});
	assert.match(
		failed(await client.query({ defaults: { enabled: true } }), "SERVICE_UNAVAILABLE"),
		/install.*my-settings/,
	);
	failed(await client.saveSession({ values: { enabled: false } }), "SERVICE_UNAVAILABLE");
});

test("invalid operation payloads and callback faults do not escape the service", async (t) => {
	silenceDiagnostics(t);
	const h = await settingsFixture(t);
	for (const operation of [
		{ op: "unknown" },
		{ op: "query", query: { defaults: [] } },
		{ op: "query", query: { defaults: {}, scope: "unknown" } },
		{ op: "save-global-only", save: { values: { bad: undefined } } },
		{ op: "save-local-only", save: { values: {}, localPath: 1 } },
		{ op: "save-session", save: { values: { bad: Number.NaN } } },
	]) {
		let response: Promise<SettingsResult> | undefined;
		h.bus.emit(MY_SETTINGS_CHANNEL, {
			...h.owner,
			operation,
			accept(value: Promise<SettingsResult>) {
				response = value;
			},
		});
		assert.ok(response);
		failed(await response, "INVALID_REQUEST");
	}
	const cycle: { self?: unknown } = {};
	cycle.self = cycle;
	failed(
		await h.client.saveSession({ values: cycle } as unknown as Parameters<typeof h.client.saveSession>[0]),
		"INVALID_REQUEST",
	);
	assert.doesNotThrow(() => h.bus.emit(MY_SETTINGS_CHANNEL, null));
	assert.doesNotThrow(() =>
		h.bus.emit(MY_SETTINGS_CHANNEL, {
			...h.owner,
			operation: { op: "query" },
			accept() {
				throw new Error("reply failed");
			},
		}),
	);
	assert.deepEqual(h.branch(), []);
});

test("absolute and parent-escaping paths are rejected without writes", async (t) => {
	silenceDiagnostics(t);
	const h = await settingsFixture(t);
	for (const path of ["", ".", "..", "../outside.json", join(h.globalRoot, "absolute.json")]) {
		failed(await h.client.saveGlobalOnly({ globalPath: path, values: { key: 1 } }), "INVALID_REQUEST");
		failed(await h.client.saveLocalOnly({ localPath: path, values: { key: 1 } }), "INVALID_REQUEST");
	}
	assert.deepEqual(h.branch(), []);
});

test("invalid existing files are skipped for queries but never overwritten by saves", async (t) => {
	silenceDiagnostics(t);
	const h = await settingsFixture(t);
	const path = join(h.globalRoot, "settings.json");
	for (const text of ["{", "[]", "null", '"text"']) {
		await writeFile(path, text);
		assert.deepEqual(await h.client.query({ defaults: { enabled: true } }), {
			ok: true,
			values: { enabled: true },
		});
		failed(await h.client.saveGlobalOnly({ values: { enabled: false } }), "OPERATION_FAILED");
		assert.equal(await readFile(path, "utf8"), text);
	}
	assert.deepEqual(h.branch(), []);
});

test("inactive sessions fail explicitly rather than falling back", async (t) => {
	silenceDiagnostics(t);
	const h = await settingsFixture(t);
	h.setActive(false);
	failed(await h.client.query({ defaults: {} }), "SESSION_UNAVAILABLE");
	failed(await h.client.saveGlobalOnly({ values: {} }), "SESSION_UNAVAILABLE");
	failed(await h.client.saveSession({ values: {} }), "SESSION_UNAVAILABLE");
});

test("client contains broken event bus emissions and rejected service replies", async () => {
	const owner = { session: {}, sessionId: "session" };
	const client = createMySettingsClient(
		{
			on: () => () => {},
			emit() {
				throw {
					toString() {
						throw new Error("description failed");
					},
				};
			},
		},
		owner,
	);
	failed(await client.query({ defaults: {} }), "OPERATION_FAILED");
	const reject = createMySettingsClient(
		{
			on: () => () => {},
			emit(_channel, data) {
				(data as { accept(response: Promise<SettingsResult>): void }).accept(
					Promise.reject(new Error("service failed")),
				);
			},
		},
		owner,
	);
	failed(await reject.query({ defaults: {} }), "OPERATION_FAILED");
});

test("requests for a different session get SESSION_UNAVAILABLE, not silence", async (t) => {
	const h = await settingsFixture(t);
	for (const owner of [
		{ session: {}, sessionId: h.owner.sessionId },
		{ session: h.owner.session, sessionId: "different" },
	]) {
		const client = createMySettingsClient(h.bus, owner);
		failed(await client.saveSession({ values: { key: 1 } }), "SESSION_UNAVAILABLE");
	}
	assert.deepEqual(h.branch(), []);
});
