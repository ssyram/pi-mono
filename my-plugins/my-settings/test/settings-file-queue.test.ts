import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import { writeSettingsFile } from "../settings-file-write.ts";
import type { SettingsMutationQueue } from "../settings-files.ts";
import { settingsFixture } from "./settings-fixture.ts";

test("new files use one canonical queue path before and after creation", async (t) => {
	const h = await settingsFixture(t);
	const path = join(h.globalRoot, "settings.json");
	const expected = join(await realpath(h.globalRoot), "settings.json");
	const queued: string[] = [];
	const queue: SettingsMutationQueue = (target, action) => {
		queued.push(target);
		return withFileMutationQueue(target, action);
	};
	const values = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`key${index}`, index]));
	const results = await Promise.all(
		Object.entries(values).map(([key, value]) => writeSettingsFile(path, { [key]: value }, queue, h.session.isCurrent)),
	);
	assert.ok(results.every((result) => result.ok));
	assert.equal(queued.length, 16);
	assert.ok(queued.every((target) => target === expected));
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), values);
});
