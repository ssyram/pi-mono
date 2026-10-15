import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { settingsFixture } from "./settings-fixture.ts";

test("query scopes merge only requested keys in default/global/local/session order", async (t) => {
	const h = await settingsFixture(t);
	await writeFile(
		join(h.globalRoot, "settings.json"),
		JSON.stringify({ key: "global", other: 1, flag: true, empty: "global" }),
	);
	await mkdir(join(h.cwd, ".pi"));
	await writeFile(join(h.cwd, ".pi/settings.json"), JSON.stringify({ key: "local", flag: false, empty: null }));
	assert.deepEqual(await h.client.saveSession({ values: { key: "session", zero: 0 } }), {
		ok: true,
		values: { key: "session", zero: 0 },
	});
	const defaults = {
		key: "default",
		missing: "fallback",
		flag: true,
		empty: null,
		zero: 9,
	};
	assert.deepEqual(await h.client.query({ defaults, scope: "global" }), {
		ok: true,
		values: {
			key: "global",
			missing: "fallback",
			flag: true,
			empty: null,
			zero: 9,
		},
	});
	assert.deepEqual(await h.client.query({ defaults, scope: "project" }), {
		ok: true,
		values: {
			key: "local",
			missing: "fallback",
			flag: false,
			empty: null,
			zero: 9,
		},
	});
	assert.deepEqual(await h.client.query({ defaults }), {
		ok: true,
		values: {
			key: "session",
			missing: "fallback",
			flag: false,
			empty: null,
			zero: 0,
		},
	});
	assert.deepEqual(defaults, {
		key: "default",
		missing: "fallback",
		flag: true,
		empty: null,
		zero: 9,
	});
});

test("custom relative paths are rooted under agent and project .pi directories", async (t) => {
	const h = await settingsFixture(t);
	const paths = {
		globalPath: "plugins/global.json",
		localPath: "plugins/project.json",
	};
	await h.client.saveGlobalOnly({ ...paths, values: { key: 1 } });
	await h.client.saveLocalOnly({ ...paths, values: { key: 2 } });
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "plugins/global.json"), "utf8")), { key: 1 });
	assert.deepEqual(JSON.parse(await readFile(join(h.cwd, ".pi/plugins/project.json"), "utf8")), { key: 2 });
	assert.deepEqual(await h.client.query({ ...paths, scope: "project", defaults: { key: 0 } }), {
		ok: true,
		values: { key: 2 },
	});
});

test("session-only saves never write files and restore from the active branch", async (t) => {
	const h = await settingsFixture(t);
	await h.client.saveSession({ values: { "one.enabled": false } });
	const first = structuredClone(h.branch());
	await h.client.saveSession({
		values: { "one.enabled": true, "two.name": "value" },
	});
	h.setBranch(first);
	assert.deepEqual(
		await h.client.query({
			defaults: { "one.enabled": true, "two.name": "default" },
		}),
		{
			ok: true,
			values: { "one.enabled": false, "two.name": "default" },
		},
	);
	h.setBranch([]);
	assert.deepEqual(await h.client.query({ defaults: { "one.enabled": true } }), {
		ok: true,
		values: { "one.enabled": true },
	});
	assert.deepEqual(await readdir(h.globalRoot), []);
	assert.deepEqual(await readdir(h.cwd), []);
});

test("global scope does not consult the local layer", async (t) => {
	const h = await settingsFixture(t);
	await writeFile(join(h.globalRoot, "settings.json"), JSON.stringify({ key: "global" }));
	await mkdir(join(h.cwd, ".pi"));
	await writeFile(join(h.cwd, ".pi/settings.json"), JSON.stringify({ key: "local" }));
	assert.deepEqual(await h.client.query({ defaults: { key: "default" }, scope: "global" }), {
		ok: true,
		values: { key: "global" },
	});
});

test("values are detached and nested values are replaced, not recursively merged", async (t) => {
	const h = await settingsFixture(t);
	const values = { nested: { first: 1, list: [1, null, "text"] } };
	const pending = h.client.saveGlobalAndSession({ values });
	values.nested.first = 99;
	assert.deepEqual(await pending, {
		ok: true,
		values: { nested: { first: 1, list: [1, null, "text"] } },
	});
	await h.client.saveLocalAndSession({ values: { nested: { second: 2 } } });
	assert.deepEqual(await h.client.query({ defaults: { nested: { default: 0 } } }), {
		ok: true,
		values: { nested: { second: 2 } },
	});
	const result = await h.client.query({ defaults: { nested: {} } });
	if (!result.ok) assert.fail(result.error.message);
	(result.values.nested as { second: number }).second = 9;
	assert.deepEqual(await h.client.query({ defaults: { nested: {} } }), {
		ok: true,
		values: { nested: { second: 2 } },
	});
});
