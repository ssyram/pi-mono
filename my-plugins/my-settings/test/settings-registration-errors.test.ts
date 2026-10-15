import assert from "node:assert/strict";
import { test } from "node:test";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import { createMySettingsClient } from "../client.ts";
import type { SettingsEventBus, SettingsOutcome, SettingsResult } from "../protocol.ts";
import { registerMySettingsService } from "../settings-service.ts";

function failure(result: SettingsOutcome<unknown> | SettingsResult, code: string) {
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected error result");
	assert.equal(result.error.code, code);
}

test("registration, resolution and disposal failures are explicit results", async () => {
	const broken: SettingsEventBus = {
		emit() {},
		on() {
			throw new Error("registration fault");
		},
	};
	failure(
		registerMySettingsService(broken, () => ({ ok: true, value: undefined }), "/unused", withFileMutationQueue),
		"OPERATION_FAILED",
	);
	const bus: SettingsEventBus = {
		emit() {},
		on() {
			return () => {
				throw new Error("dispose fault");
			};
		},
	};
	const registered = registerMySettingsService(
		bus,
		() => ({ ok: true, value: undefined }),
		"/unused",
		withFileMutationQueue,
	);
	assert.ok(registered.ok);
	failure(registered.value(), "OPERATION_FAILED");
	let handler: ((data: unknown) => void) | undefined;
	const resolving: SettingsEventBus = {
		emit(_channel, data) {
			handler?.(data);
		},
		on(_channel, callback) {
			handler = callback;
			return () => {};
		},
	};
	const service = registerMySettingsService(
		resolving,
		() => {
			throw new Error("resolver fault");
		},
		"/unused",
		withFileMutationQueue,
	);
	assert.ok(service.ok);
	const client = createMySettingsClient(resolving, {
		session: {},
		sessionId: "id",
	});
	failure(await client.query({ defaults: {} }), "OPERATION_FAILED");
});
