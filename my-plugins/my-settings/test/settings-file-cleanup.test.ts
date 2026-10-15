import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import { writeSettingsFile } from "../settings-file-write.ts";
import { settingsFixture } from "./settings-fixture.ts";

test("session loss after temporary write removes the uncommitted file", async (t) => {
	const h = await settingsFixture(t);
	let checks = 0;
	const path = join(h.globalRoot, "settings.json");
	const result = await writeSettingsFile(path, { key: 1 }, withFileMutationQueue, () => ({
		ok: true,
		value: ++checks === 1,
	}));
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected session error");
	assert.equal(result.error.code, "SESSION_UNAVAILABLE");
	await assert.rejects(readFile(path), { code: "ENOENT" });
	assert.deepEqual(await readdir(h.globalRoot), []);
});

test("temporary cleanup failure is diagnosed without rejecting the operation", async (t) => {
	const h = await settingsFixture(t);
	const messages: unknown[][] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		messages.push(args);
	};
	t.after(() => {
		console.error = original;
	});
	let checks = 0;
	const result = await writeSettingsFile(join(h.globalRoot, "settings.json"), {}, withFileMutationQueue, () => {
		if (++checks === 1) return { ok: true, value: true };
		const temporary = readdirSync(h.globalRoot).find((name) => name.endsWith(".tmp"));
		assert.ok(temporary);
		const path = join(h.globalRoot, temporary);
		readFileSync(path);
		rmSync(path);
		mkdirSync(path);
		return { ok: true, value: false };
	});
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected session error");
	assert.equal(result.error.code, "SESSION_UNAVAILABLE");
	assert.equal(messages.length, 1);
	assert.match(String(messages[0][0]), /\[my-settings\]/);
});
