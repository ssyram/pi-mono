import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createTaskSettings, TASK_SETTING_DEFAULTS } from "../task-settings.js";
import { taskSettingsFixture } from "./task-settings-fixture.js";

const gate = "omp-task:no-task-no-tool";
const show = "omp-task:show";

test("settings use my-settings defaults, file layers and latest valid session values", async (t) => {
	const h = await taskSettingsFixture(t);
	assert.equal(await h.settings.isEnabled(h.context), true);
	assert.deepEqual(await h.settings.read(h.context, show), {
		ok: true,
		value: true,
	});
	await writeFile(
		join(h.globalRoot, "settings.json"),
		JSON.stringify({ [gate]: false, [show]: false }),
	);
	assert.equal(await h.settings.isEnabled(h.context), false);
	await writeFile(
		join(h.cwd, ".pi/settings.json"),
		JSON.stringify({ [gate]: true, [show]: "bad" }),
	);
	assert.equal(await h.settings.isEnabled(h.context), true);
	assert.deepEqual(await h.settings.read(h.context, show), {
		ok: true,
		value: false,
	});
	await h.settings.set(h.context, gate, false);
	h.branch().push({
		type: "custom",
		customType: "my-settings-v1",
		data: { values: { [gate]: "bad" } },
	});
	assert.equal(await h.settings.isEnabled(h.context), false);
});

for (const key of Object.keys(
	TASK_SETTING_DEFAULTS,
) as (keyof typeof TASK_SETTING_DEFAULTS)[]) {
	test(`${key} defaults to session only and uses the shared log`, async (t) => {
		const h = await taskSettingsFixture(t);
		assert.deepEqual(await h.settings.set(h.context, key, false), {
			ok: true,
			applied: true,
			message: `${key}=off applied to session.`,
		});
		assert.deepEqual(h.branch(), [
			{
				type: "custom",
				customType: "my-settings-v1",
				data: { values: { [key]: false } },
			},
		]);
		await assert.rejects(access(join(h.cwd, ".pi/settings.json")));
		await assert.rejects(access(join(h.globalRoot, "settings.json")));
		assert.deepEqual(await createTaskSettings(h.pi).read(h.context, key), {
			ok: true,
			value: false,
		});
	});
}

for (const targets of [
	{ persistent: true },
	{ global: true },
	{ persistent: true, global: true },
]) {
	test(`only requested files are saved: ${JSON.stringify(targets)}`, async (t) => {
		const h = await taskSettingsFixture(t);
		const local = join(h.cwd, ".pi/settings.json"),
			global = join(h.globalRoot, "settings.json");
		await writeFile(local, '{"other":1}');
		await writeFile(global, '{"another":2}');
		assert.equal(
			(await h.settings.set(h.context, show, false, targets)).ok,
			true,
		);
		assert.deepEqual(
			JSON.parse(await readFile(local, "utf8")),
			"persistent" in targets ? { other: 1, [show]: false } : { other: 1 },
		);
		assert.deepEqual(
			JSON.parse(await readFile(global, "utf8")),
			"global" in targets ? { another: 2, [show]: false } : { another: 2 },
		);
		assert.equal(h.branch().length, 1);
	});
}

test("bad file is preserved while session off still applies and file failure is explicit", async (t) => {
	t.mock.method(console, "error", () => {
		throw new Error("logger failed");
	});
	const h = await taskSettingsFixture(t);
	const local = join(h.cwd, ".pi/settings.json");
	await writeFile(local, "{");
	const result = await h.settings.set(h.context, gate, false, {
		persistent: true,
	});
	assert.equal(result.ok, false);
	assert.equal(result.applied, true);
	assert.match(result.message, /applied to session.*Not saved to local/);
	assert.equal(await h.settings.isEnabled(h.context), false);
	assert.equal(await readFile(local, "utf8"), "{");
});

test("append failure is a result, not a throw or rollback claim; task setting can retry", async (t) => {
	const h = await taskSettingsFixture(t);
	h.failAppend(true);
	const failed = await h.settings.set(h.context, gate, false, { global: true });
	assert.equal(failed.ok, false);
	assert.equal(failed.applied, false);
	assert.match(
		failed.message,
		/append unavailable.*may already have taken effect/,
	);
	assert.equal(h.branch().length, 0);
	h.failAppend(false);
	assert.equal((await h.settings.set(h.context, gate, false)).ok, true);
});

test("branch changes, session replacement and absent service never reuse a cached setting", async (t) => {
	const h = await taskSettingsFixture(t);
	await h.settings.set(h.context, gate, false);
	const branch = [...h.branch()];
	h.setBranch([]);
	assert.equal(await h.settings.isEnabled(h.context), true);
	h.setBranch(branch);
	assert.equal(await h.settings.isEnabled(h.context), false);
	h.replaceSession();
	assert.equal(await h.settings.isEnabled(h.context), true);
	h.dispose();
	const missing = await h.settings.read(h.context, show);
	assert.equal(missing.ok, false);
	assert.ok(!missing.ok);
	assert.match(missing.error.message, /install and enable/);
});
