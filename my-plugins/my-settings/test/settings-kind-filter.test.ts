import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { MY_SETTINGS_ENTRY_TYPE } from "../protocol.ts";
import { settingsFixture } from "./settings-fixture.ts";

function silenceDiagnostics(t: { after(callback: () => void): void }) {
	const original = console.error;
	const messages: string[] = [];
	console.error = (...args: unknown[]) => {
		messages.push(args.map(String).join(" "));
	};
	t.after(() => {
		console.error = original;
	});
	return messages;
}

test("kind mismatches drop only that source's key and keep lower-priority valid values", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	await writeFile(join(h.globalRoot, "settings.json"), JSON.stringify({ enabled: false, limit: 20, name: "g" }));
	await mkdir(join(h.cwd, ".pi"));
	await writeFile(
		join(h.cwd, ".pi/settings.json"),
		JSON.stringify({ enabled: "off", limit: "30", name: "l", tags: ["a"] }),
	);
	const result = await h.client.query({
		defaults: { enabled: true, limit: 10, name: "default", tags: [] },
	});
	assert.deepEqual(result, {
		ok: true,
		values: { enabled: false, limit: 20, name: "l", tags: ["a"] },
	});
	assert.equal(messages.length, 2);
	assert.match(messages[0], /enabled 期望 boolean，实际 string/);
	assert.match(messages[1], /limit 期望 number，实际 string/);
});

test("null kind matches only null and object/array kinds are not interchangeable", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	await writeFile(join(h.globalRoot, "settings.json"), JSON.stringify({ optional: null, list: [1], table: { a: 1 } }));
	const result = await h.client.query({
		defaults: { optional: null, list: [], table: {} },
		scope: "global",
	});
	assert.deepEqual(result, {
		ok: true,
		values: { optional: null, list: [1], table: { a: 1 } },
	});
	await writeFile(join(h.globalRoot, "settings.json"), JSON.stringify({ optional: "set", list: { a: 1 }, table: [1] }));
	const mismatch = await h.client.query({
		defaults: { optional: null, list: [], table: {} },
		scope: "global",
	});
	assert.deepEqual(mismatch, {
		ok: true,
		values: { optional: null, list: [], table: {} },
	});
	assert.equal(messages.length, 3);
});

test("a failed source read is diagnosed and skipped, other layers still merge", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	await writeFile(join(h.globalRoot, "settings.json"), "{");
	await mkdir(join(h.cwd, ".pi"));
	await writeFile(join(h.cwd, ".pi/settings.json"), JSON.stringify({ enabled: false }));
	const result = await h.client.query({
		defaults: { enabled: true, missing: "fallback" },
	});
	assert.deepEqual(result, {
		ok: true,
		values: { enabled: false, missing: "fallback" },
	});
	assert.equal(messages.length, 1);
	assert.match(messages[0], /settings\.json/);
});

test("invalid session-log entries are skipped and later type errors do not shadow earlier patches", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	await h.client.saveSession({ values: { enabled: false } });
	h.setBranch([
		...h.branch(),
		{
			type: "custom",
			customType: MY_SETTINGS_ENTRY_TYPE,
			data: { unexpected: true },
		},
		{
			type: "custom",
			customType: MY_SETTINGS_ENTRY_TYPE,
			data: { values: { enabled: "broken" } },
		},
	]);
	const result = await h.client.query({ defaults: { enabled: true } });
	assert.deepEqual(result, { ok: true, values: { enabled: false } });
	assert.equal(messages.length, 2);
});

test("a failed branch read is diagnosed and the session layer is skipped", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	await writeFile(join(h.globalRoot, "settings.json"), JSON.stringify({ enabled: true }));
	const original = h.session.getBranch;
	h.session.getBranch = () => ({
		ok: false,
		error: { code: "OPERATION_FAILED", message: "branch unavailable" },
	});
	t.after(() => {
		h.session.getBranch = original;
	});
	const result = await h.client.query({ defaults: { enabled: false } });
	assert.deepEqual(result, { ok: true, values: { enabled: true } });
	assert.equal(messages.length, 1);
	assert.match(messages[0], /branch unavailable/);
});
