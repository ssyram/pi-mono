import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import { copySettings } from "../json-settings.ts";
import type { SettingsOutcome, SettingsResult } from "../protocol.ts";
import { reportSettingsError, settingsFailure } from "../settings-error.ts";
import { writeSettingsFile } from "../settings-file-write.ts";
import { readSettingsFile, settingsFilePath } from "../settings-files.ts";
import { parseSettingsOperation } from "../settings-operation.ts";
import { appendSessionSettings, readSessionPatches } from "../settings-session-log.ts";
import { settingsFixture } from "./settings-fixture.ts";

function failure(result: SettingsOutcome<unknown> | SettingsResult, code: string) {
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected error result");
	assert.equal(result.error.code, code);
	return result.error.message;
}

test("production source does not use the throw keyword", async () => {
	const root = join(import.meta.dirname, "..");
	for (const name of await readdir(root)) {
		if (!name.endsWith(".ts")) continue;
		assert.doesNotMatch(await readFile(join(root, name), "utf8"), /\bthrow\b/, `${name} contains throw`);
	}
});

test("JSON and operation helpers return errors for cycles, getters, proxies and serialization faults", () => {
	const cycle: { self?: unknown } = {};
	cycle.self = cycle;
	const getter = Object.defineProperty({}, "bad", {
		enumerable: true,
		get() {
			throw new Error("getter fault");
		},
	});
	const serializer = Object.defineProperty({}, "toJSON", {
		value() {
			throw new Error("serialization fault");
		},
	});
	const revoked = Proxy.revocable({}, {});
	revoked.revoke();
	for (const value of [
		null,
		[],
		{ bad: undefined },
		{ bad: Infinity },
		{ bad: 1n },
		cycle,
		getter,
		serializer,
		revoked.proxy,
	]) {
		failure(copySettings(value), "INVALID_REQUEST");
	}
	failure(
		parseSettingsOperation(
			Object.defineProperty({}, "op", {
				get() {
					throw new Error("op fault");
				},
			}),
		),
		"INVALID_REQUEST",
	);
	failure(parseSettingsOperation(null), "INVALID_REQUEST");
	const deep: Record<string, unknown> = {};
	let cursor = deep;
	for (let index = 0; index < 20000; index++) {
		const next = {};
		cursor.next = next;
		cursor = next;
	}
	const deepResult = copySettings(deep);
	assert.equal(typeof deepResult.ok, "boolean");
	if (!deepResult.ok) assert.equal(deepResult.error.code, "INVALID_REQUEST");
	const shared = { key: true };
	assert.ok(copySettings({ first: shared, second: shared }).ok);
});

test("error messages remain strings and broken diagnostics do not escape", () => {
	const numeric = Object.defineProperty(new Error(), "message", { value: 42 });
	assert.equal(settingsFailure("OPERATION_FAILED", numeric).error.message, "42");
	const hostile = Object.defineProperty(new Error(), "message", {
		get() {
			throw new Error("message fault");
		},
	});
	assert.equal(settingsFailure("OPERATION_FAILED", hostile).error.message, "Unknown settings error");
	const original = console.error;
	console.error = () => {
		throw new Error("diagnostic fault");
	};
	try {
		assert.doesNotThrow(() => reportSettingsError(hostile));
	} finally {
		console.error = original;
	}
});

test("standalone file helpers fulfill with errors for invalid JSON, paths, queues and guards", async (t) => {
	const h = await settingsFixture(t);
	const path = join(h.globalRoot, "settings.json");
	failure(settingsFilePath(h.globalRoot, "bad\0path"), "INVALID_REQUEST");
	failure(settingsFilePath(null as unknown as string), "INVALID_REQUEST");
	await writeFile(path, "{");
	failure(await readSettingsFile(path), "OPERATION_FAILED");
	failure(await writeSettingsFile(path, {}, withFileMutationQueue, h.session.isCurrent), "OPERATION_FAILED");
	assert.equal(await readFile(path, "utf8"), "{");
	failure(
		await writeSettingsFile(
			path,
			{},
			async () => {
				throw new Error("queue fault");
			},
			h.session.isCurrent,
		),
		"OPERATION_FAILED",
	);
	failure(
		await writeSettingsFile(path, {}, withFileMutationQueue, () => {
			throw new Error("guard fault");
		}),
		"OPERATION_FAILED",
	);
});

test("session helpers return errors and service binds guards with their receiver", async (t) => {
	const h = await settingsFixture(t);
	failure(readSessionPatches(null as unknown as []), "OPERATION_FAILED");
	h.session.isCurrent = () => {
		throw new Error("port fault");
	};
	failure(appendSessionSettings(h.session, {}), "OPERATION_FAILED");
	h.session.isCurrent = function () {
		return { ok: true, value: this.cwd === h.cwd };
	};
	assert.equal((await h.client.saveGlobalOnly({ values: { enabled: true } })).ok, true);
});
