import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { MY_SETTINGS_ENTRY_TYPE } from "../protocol.ts";
import { settingsFixture } from "./settings-fixture.ts";

function failed(result: { ok: boolean; error?: { code: string; message?: string } }, code: string) {
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected failure");
	assert.equal(result.error?.code, code);
}

test("unset-global/local removes keys from their file only, preserving others", async (t) => {
	const h = await settingsFixture(t);
	await h.client.saveGlobalOnly({ values: { keep: 1, drop: 2 } });
	await h.client.saveLocalOnly({ values: { keep: 3, drop: 4 } });
	assert.equal((await h.client.unsetGlobalOnly({ keys: ["drop"] })).ok, true);
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "settings.json"), "utf8")), { keep: 1 });
	assert.deepEqual(JSON.parse(await readFile(join(h.cwd, ".pi/settings.json"), "utf8")), { keep: 3, drop: 4 });
	assert.equal((await h.client.unsetLocalOnly({ keys: ["drop", "absent"] })).ok, true);
	assert.deepEqual(JSON.parse(await readFile(join(h.cwd, ".pi/settings.json"), "utf8")), { keep: 3 });
});

test("unset on a missing file is a no-op and does not create the file", async (t) => {
	const h = await settingsFixture(t);
	assert.equal((await h.client.unsetGlobalOnly({ keys: ["k"] })).ok, true);
	assert.deepEqual(await readdir(h.globalRoot), []);
});

test("unset does not overwrite a corrupt original file", async (t) => {
	const h = await settingsFixture(t);
	const path = join(h.globalRoot, "settings.json");
	await writeFile(path, "{");
	const result = await h.client.unsetGlobalOnly({ keys: ["k"] });
	failed(result, "OPERATION_FAILED");
	assert.equal(await readFile(path, "utf8"), "{");
});

test("unset-session appends a tombstone and cancels the session overlay", async (t) => {
	const h = await settingsFixture(t);
	await h.client.saveGlobalOnly({ values: { flag: "from-global" } });
	await h.client.saveSession({ values: { flag: "from-session" } });
	assert.deepEqual(await h.client.query({ defaults: { flag: "default" } }), {
		ok: true,
		values: { flag: "from-session" },
	});
	assert.equal((await h.client.unsetSession({ keys: ["flag"] })).ok, true);
	assert.deepEqual(h.branch().at(-1)?.data, { removed: ["flag"] });
	assert.deepEqual(await h.client.query({ defaults: { flag: "default" } }), {
		ok: true,
		values: { flag: "from-global" },
	});
});

test("tombstone then re-set wins again; fold order is well-defined", async (t) => {
	const h = await settingsFixture(t);
	await h.client.saveSession({ values: { flag: 1 } });
	await h.client.unsetSession({ keys: ["flag"] });
	await h.client.saveSession({ values: { flag: 2 } });
	assert.deepEqual(await h.client.query({ defaults: { flag: 0 } }), {
		ok: true,
		values: { flag: 2 },
	});
	await h.client.unsetSession({ keys: ["flag"] });
	assert.deepEqual(await h.client.query({ defaults: { flag: 0 } }), {
		ok: true,
		values: { flag: 0 },
	});
});

test("corrupt removed fields are skipped per entry", async (t) => {
	const h = await settingsFixture(t);
	await h.client.saveSession({ values: { flag: 1 } });
	h.setBranch([
		...h.branch(),
		{
			type: "custom",
			customType: MY_SETTINGS_ENTRY_TYPE,
			data: { removed: "flag" },
		},
		{ type: "custom", customType: MY_SETTINGS_ENTRY_TYPE, data: {} },
	]);
	assert.deepEqual(await h.client.query({ defaults: { flag: 0 } }), {
		ok: true,
		values: { flag: 1 },
	});
});

test("invalid unset payloads are rejected", async (t) => {
	const h = await settingsFixture(t);
	for (const keys of [undefined, "k", [1], [null], [true]] as unknown[]) {
		let response: unknown;
		h.bus.emit("my-settings:service:v1", {
			...h.owner,
			operation: { op: "unset-session", unset: { keys } },
			accept(value: unknown) {
				response = value;
			},
		});
		const settled = await Promise.resolve(response);
		failed(settled as { ok: boolean; error?: { code: string } }, "INVALID_REQUEST");
	}
	assert.deepEqual(h.branch(), []);
});

test("empty key arrays are no-ops and empty-string keys are literal", async (t) => {
	const h = await settingsFixture(t);
	assert.equal((await h.client.unsetGlobalOnly({ keys: [] })).ok, true);
	assert.equal((await h.client.unsetSession({ keys: [] })).ok, true);
	assert.deepEqual(await readdir(h.globalRoot), []);
	assert.deepEqual(h.branch(), []);
	await h.client.saveGlobalOnly({ values: { "": 1, other: 2 } });
	assert.equal((await h.client.unsetGlobalOnly({ keys: [""] })).ok, true);
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "settings.json"), "utf8")), { other: 2 });
	assert.equal((await h.client.unsetSession({ keys: [""] })).ok, true);
	assert.deepEqual(h.branch().at(-1)?.data, { removed: [""] });
});
