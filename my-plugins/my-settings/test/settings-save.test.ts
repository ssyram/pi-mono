import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
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

test("only saves write their file and never the session log", async (t) => {
	const h = await settingsFixture(t);
	assert.deepEqual(await h.client.saveGlobalOnly({ values: { key: "global" } }), {
		ok: true,
		values: { key: "global" },
	});
	assert.deepEqual(await h.client.saveLocalOnly({ values: { key: "local" } }), {
		ok: true,
		values: { key: "local" },
	});
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "settings.json"), "utf8")), { key: "global" });
	assert.deepEqual(JSON.parse(await readFile(join(h.cwd, ".pi/settings.json"), "utf8")), { key: "local" });
	assert.deepEqual(h.branch(), []);
});

test("and-session saves write the file and append one log entry", async (t) => {
	const h = await settingsFixture(t);
	const globalPath = join(h.globalRoot, "settings.json");
	await writeFile(globalPath, '{"retained":1}');
	assert.deepEqual(await h.client.saveGlobalAndSession({ values: { key: "global" } }), {
		ok: true,
		values: { key: "global" },
	});
	assert.deepEqual(JSON.parse(await readFile(globalPath, "utf8")), {
		retained: 1,
		key: "global",
	});
	await assert.rejects(readFile(join(h.cwd, ".pi/settings.json")), {
		code: "ENOENT",
	});
	await h.client.saveLocalAndSession({ values: { key: "local" } });
	assert.deepEqual(JSON.parse(await readFile(join(h.cwd, ".pi/settings.json"), "utf8")), { key: "local" });
	assert.deepEqual(
		h.branch().map((entry) => entry.data),
		[{ values: { key: "global" } }, { values: { key: "local" } }],
	);
	assert.deepEqual(await readdir(h.globalRoot), ["settings.json"]);
});

test("and-session elevates the patch above the other file layer for this session only", async (t) => {
	const h = await settingsFixture(t);
	await h.client.saveLocalOnly({ values: { key: "local" } });
	await h.client.saveGlobalAndSession({ values: { key: "global" } });
	assert.deepEqual(await h.client.query({ defaults: { key: "default" } }), {
		ok: true,
		values: { key: "global" },
	});
	h.setBranch([]);
	assert.deepEqual(await h.client.query({ defaults: { key: "default" } }), {
		ok: true,
		values: { key: "local" },
	});
});

test("saveSession only appends the log", async (t) => {
	const h = await settingsFixture(t);
	assert.deepEqual(await h.client.saveSession({ values: { enabled: false } }), {
		ok: true,
		values: { enabled: false },
	});
	assert.deepEqual(
		h.branch().map((entry) => entry.data),
		[{ values: { enabled: false } }],
	);
	assert.deepEqual(await readdir(h.globalRoot), []);
	assert.deepEqual(await readdir(h.cwd), []);
});

test("file failure in an and-session save is diagnosed and the log still wins", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	await mkdir(join(h.globalRoot, "settings.json"));
	const result = await h.client.saveGlobalAndSession({
		values: { enabled: false },
	});
	assert.deepEqual(result, { ok: true, values: { enabled: false } });
	assert.equal(messages.length, 1);
	assert.deepEqual(
		h.branch().map((entry) => entry.data),
		[{ values: { enabled: false } }],
	);
	assert.deepEqual(await h.client.query({ defaults: { enabled: true } }), {
		ok: true,
		values: { enabled: false },
	});
});

test("only saves fail on file errors and keep the session log empty", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	await mkdir(join(h.globalRoot, "settings.json"));
	const result = await h.client.saveGlobalOnly({ values: { enabled: true } });
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected failure");
	assert.equal(result.error.code, "OPERATION_FAILED");
	assert.deepEqual(messages, []);
	assert.deepEqual(h.branch(), []);
});

test("a log failure after a committed file surfaces as the overall error", async (t) => {
	const h = await settingsFixture(t);
	h.failAppend();
	const result = await h.client.saveGlobalAndSession({
		values: { enabled: false },
	});
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected failure");
	assert.equal(result.error.code, "OPERATION_FAILED");
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "settings.json"), "utf8")), { enabled: false });
});

test("invalid paths stop only saves but not and-session saves", async (t) => {
	const messages = silenceDiagnostics(t);
	const h = await settingsFixture(t);
	for (const path of ["", "..", "/absolute.json"]) {
		const only = await h.client.saveGlobalOnly({
			globalPath: path,
			values: { key: 1 },
		});
		assert.equal(only.ok, false);
		if (only.ok) assert.fail("Expected failure");
		assert.equal(only.error.code, "INVALID_REQUEST");
	}
	assert.deepEqual(
		await h.client.saveGlobalAndSession({
			globalPath: "..",
			values: { key: 1 },
		}),
		{
			ok: true,
			values: { key: 1 },
		},
	);
	assert.equal(messages.length, 1);
	assert.deepEqual(
		h.branch().map((entry) => entry.data),
		[{ values: { key: 1 } }],
	);
	await assert.rejects(readFile(join(h.globalRoot, "settings.json")), {
		code: "ENOENT",
	});
});

test("concurrent patches preserve all keys using Pi's file mutation queue", async (t) => {
	const h = await settingsFixture(t);
	const results = await Promise.all(
		Array.from({ length: 8 }, (_, key) => h.client.saveGlobalAndSession({ values: { [`key${key}`]: key } })),
	);
	assert.ok(results.every((result) => result.ok));
	const disk = JSON.parse(await readFile(join(h.globalRoot, "settings.json"), "utf8"));
	assert.deepEqual(disk, Object.fromEntries(Array.from({ length: 8 }, (_, key) => [`key${key}`, key])));
	assert.equal(h.branch().length, 8);
});
