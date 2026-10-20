import assert from "node:assert/strict";
import { chmod, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runScript } from "../src/script-tasks/run-script.js";
import { createScriptDirectory, nodeScript } from "./script-process-fixture.js";

const options = { skip: process.platform === "win32", timeout: 8000 };

test(
	"real process captures cwd, argv boundaries and stdout/stderr without shell expansion",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const script = nodeScript(
			cwd,
			"console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}));console.error('stderr');",
		);
		script.params = [
			...script.params,
			"a b",
			"",
			"$HOME",
			"*.md",
			"; touch sentinel",
			"中",
		];
		const result = await runScript(script);
		assert.equal(result.status, "success");
		assert.equal(result.exitCode, 0);
		assert.equal(result.signal, null);
		assert.equal(result.error, null);
		assert.deepEqual(JSON.parse(result.stdout), {
			cwd: await realpath(cwd),
			args: ["a b", "", "$HOME", "*.md", "; touch sentinel", "中"],
		});
		assert.equal(result.stderr, "stderr\n");
	},
);

test(
	"real executable path supports spaces and Unicode, no extension inference",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const path = join(cwd, "脚本 with spaces");
		await writeFile(path, "#!/bin/sh\nprintf '%s' \"$1\"\n");
		await chmod(path, 0o700);
		const result = await runScript({
			cwd,
			path,
			params: ["argument with spaces"],
			timeoutSeconds: 2,
		});
		assert.equal(result.status, "success");
		assert.equal(result.stdout, "argument with spaces");
	},
);

test(
	"nonzero and signal exits remain failures with genuine exit metadata",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const nonzero = await runScript(
			nodeScript(
				cwd,
				"console.log('partial');console.error('why');process.exit(7)",
			),
		);
		assert.equal(nonzero.status, "failed");
		assert.equal(nonzero.exitCode, 7);
		assert.equal(nonzero.stdout, "partial\n");
		assert.equal(nonzero.stderr, "why\n");
		const signal = await runScript(
			nodeScript(cwd, "process.kill(process.pid,'SIGTERM')"),
		);
		assert.equal(signal.status, "failed");
		assert.equal(signal.exitCode, null);
		assert.equal(signal.signal, "SIGTERM");
	},
);

test(
	"spawn errors and synchronous invalid arguments are terminal start failures",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const base = nodeScript(cwd, "process.exit(0)");
		const notExecutable = join(cwd, "no-permission");
		await writeFile(notExecutable, "#!/bin/sh\nexit 0\n");
		await chmod(notExecutable, 0o600);
		for (const script of [
			{ ...base, path: join(cwd, "missing") },
			{ ...base, cwd: join(cwd, "missing-cwd") },
			{ ...base, path: notExecutable },
			{ ...base, params: ["\0"] },
			{ ...base, path: "\0" },
		]) {
			const result = await runScript(script);
			assert.equal(result.status, "start-failed");
			assert.equal(result.exitCode, null);
			assert.ok(result.error);
		}
	},
);

test(
	"UTF-8 decoding retains characters split across pipe writes",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const result = await runScript(
			nodeScript(
				cwd,
				"const b=Buffer.from('中文🙂');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),30)",
			),
		);
		assert.equal(result.status, "success");
		assert.equal(result.stdout, "中文🙂");
	},
);

test(
	"null timeout allows natural completion and concurrent runs stay isolated",
	options,
	async (t) => {
		const cwd = await createScriptDirectory(t);
		const [first, second] = await Promise.all([
			runScript(
				nodeScript(cwd, "setTimeout(()=>console.log('one'),100)", null),
			),
			runScript(nodeScript(cwd, "console.log('two')", null)),
		]);
		assert.equal(first.status, "success");
		assert.equal(second.status, "success");
		assert.equal(first.stdout, "one\n");
		assert.equal(second.stdout, "two\n");
	},
);
