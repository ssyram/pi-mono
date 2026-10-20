import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { executeScriptTask } from "../src/script-tasks/execute-task.js";
import { prepareScriptTask } from "../src/script-tasks/prepare-task.js";
import { runScript } from "../src/script-tasks/run-script.js";
import { createScriptDirectory, nodeScript } from "./script-process-fixture.js";

const options = { skip: process.platform === "win32", timeout: 8000 };

test(
	"timeout directly kills a process that ignores SIGTERM and retains partial output",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const before = Date.now();
		const result = await runScript(
			nodeScript(
				cwd,
				"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)",
				0.4,
			),
		);
		assert.equal(result.status, "timeout");
		assert.equal(result.exitCode, null);
		assert.equal(result.signal, "SIGKILL");
		assert.equal(result.stdout, "ready\n");
		assert.ok(Date.now() - before < 4000);
	},
);

test(
	"timeout kills same-group descendants, preventing their later writes",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const marker = join(cwd, "leaked");
		const childCode = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'leaked'),900)`;
		const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});console.log('spawned');setInterval(()=>{},1000)`;
		const result = await runScript(nodeScript(cwd, code, 0.4));
		assert.equal(result.status, "timeout");
		assert.equal(result.stdout, "spawned\n");
		await new Promise((resolve) => setTimeout(resolve, 1100));
		assert.equal(existsSync(marker), false);
	},
);

test(
	"ordinary completion cleans background members of the owned group",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const marker = join(cwd, "survivor");
		const childCode = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'leaked'),600)`;
		const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}).unref();console.log('done')`;
		const result = await runScript(nodeScript(cwd, code));
		assert.equal(result.status, "success");
		assert.equal(result.stdout, "done\n");
		await new Promise((resolve) => setTimeout(resolve, 800));
		assert.equal(existsSync(marker), false);
	},
);

test(
	"inherited pipes stay bounded by timeout even after the direct child exits",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const code =
			"require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]}).unref();process.exit(0)";
		const result = await runScript(nodeScript(cwd, code, 0.4));
		assert.equal(result.status, "timeout");
		assert.equal(result.exitCode, 0);
	},
);

test(
	"real batch continues after start failure, nonzero exit and timeout, then aggregates once",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const marker = join(cwd, "order");
		const task = prepareScriptTask(
			{
				wakeUp: { kind: "on-error", prompt: "inspect failures" },
				scripts: [
					{ cwd, path: "missing" },
					nodeScript(cwd, "process.exit(3)"),
					nodeScript(
						cwd,
						`require('node:fs').appendFileSync(${JSON.stringify(marker)},'A')`,
					),
					nodeScript(cwd, "setInterval(()=>{},1000)", 0.15),
					nodeScript(
						cwd,
						`require('node:fs').appendFileSync(${JSON.stringify(marker)},'B')`,
					),
				],
			},
			cwd,
		);
		assert.ok(task.ok);
		const run = await executeScriptTask(task.task, "real-batch");
		assert.deepEqual(
			run.results.map((result) => result.status),
			["start-failed", "failed", "success", "timeout", "success"],
		);
		assert.equal(await readFile(marker, "utf8"), "AB");
		assert.equal(run.successCount, 2);
		assert.equal(run.shouldWake, true);
		assert.equal(run.content.split("<script=").length - 1, 5);
	},
);
