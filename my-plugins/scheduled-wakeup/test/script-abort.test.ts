import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { runScript } from "../src/script-tasks/run-script.js";

test(
	"session abort kills a real unlimited script and settles once",
	{ timeout: 10_000 },
	async (t) => {
		const root = mkdtempSync(join(tmpdir(), "loop-abort-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const ready = join(root, "ready");
		const controller = new AbortController();
		t.after(() => controller.abort());
		const execution = runScript(
			{
				cwd: root,
				path: process.execPath,
				params: [
					"-e",
					"require('node:fs').writeFileSync(process.argv[1], 'ready'); process.stdout.write('started'); setInterval(() => {}, 1000)",
					ready,
				],
				timeoutSeconds: null,
			},
			{ abortSignal: controller.signal },
		);
		for (let i = 0; i < 300 && !existsSync(ready); i++) await setTimeout(10);
		assert.ok(existsSync(ready), "child must reach its running state");
		controller.abort();
		const result = await execution;
		assert.equal(result.status, "failed");
		assert.equal(result.signal, "SIGKILL");
		assert.match(result.error ?? "", /Session closed/);
		assert.notEqual(result.status, "timeout");
	},
);

test("already-aborted session never starts the script", async () => {
	const controller = new AbortController();
	controller.abort();
	const result = await runScript(
		{
			cwd: "/",
			path: process.execPath,
			params: ["-e", "process.exit(99)"],
			timeoutSeconds: null,
		},
		{ abortSignal: controller.signal },
	);
	assert.equal(result.status, "start-failed");
	assert.equal(result.exitCode, null);
	assert.match(result.error ?? "", /before script start/);
});
