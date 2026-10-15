import assert from "node:assert/strict";
import { test } from "node:test";
import { createMySettingsClient } from "../client.ts";
import type { SettingsEventBus, SettingsReady, SettingsRequest, SettingsResult } from "../protocol.ts";

function errorCode(result: SettingsResult): string {
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected error result");
	return result.error.code;
}

test("client creation returns an error-capable client for invalid or throwing owners", async () => {
	const bus: SettingsEventBus = {
		on: () => () => {},
		emit() {
			assert.fail("invalid owner must not emit");
		},
	};
	const throwing = {
		get session(): object {
			throw new Error("owner fault");
		},
		sessionId: "id",
	};
	for (const owner of [null, throwing]) {
		const client = createMySettingsClient(bus, owner as unknown as SettingsReady);
		assert.equal(errorCode(await client.query({ defaults: {} })), "INVALID_REQUEST");
	}
});

test("client error responses do not expose cached initialization state", async () => {
	const client = createMySettingsClient({ on: () => () => {}, emit() {} }, null as unknown as SettingsReady);
	const first = await client.query({ defaults: {} });
	assert.equal(first.ok, false);
	if (first.ok) assert.fail("Expected initialization error");
	const original = first.error.message;
	first.error.message = "changed by caller";
	const second = await client.query({ defaults: {} });
	assert.equal(second.ok, false);
	if (second.ok) assert.fail("Expected initialization error");
	assert.equal(second.error.message, original);
	assert.notEqual(first, second);
});

test("late and duplicate accepts observe rejected promises instead of leaking rejections", async (t) => {
	const messages: unknown[][] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		messages.push(args);
	};
	t.after(() => {
		console.error = original;
	});
	let request: SettingsRequest | undefined;
	const bus: SettingsEventBus = {
		on: () => () => {},
		emit(_channel, data) {
			request = data as SettingsRequest;
		},
	};
	const client = createMySettingsClient(bus, { session: {}, sessionId: "id" });
	assert.equal(errorCode(await client.query({ defaults: {} })), "SERVICE_UNAVAILABLE");
	assert.ok(request);
	request.accept(Promise.reject(new Error("late rejection")));
	bus.emit = (_channel, data) => {
		const call = data as SettingsRequest;
		call.accept(Promise.resolve({ ok: true, values: { selected: true } }));
		call.accept(Promise.reject(new Error("duplicate rejection")));
	};
	assert.deepEqual(await client.query({ defaults: {} }), {
		ok: true,
		values: { selected: true },
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(messages.length, 2);
	assert.match(String(messages[0][0]), /late rejection/);
	assert.match(String(messages[1][0]), /duplicate rejection/);
});
