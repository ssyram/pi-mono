import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import {
	TASK_FILE,
	parseOutcome,
	parseStatus,
	parseTaskRecord,
	readJson,
	writeJsonAtomic,
} from "../src/script-tasks/run-record.js";
import type { ScriptTask } from "../src/script-tasks/task-spec.js";

const pluginRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const loader = join(pluginRoot, "node_modules", "tsx", "dist", "loader.mjs");
const entry = join(pluginRoot, "src", "script-tasks", "runner-main.ts");

async function until(predicate: () => boolean, attempts = 5000): Promise<void> {
	for (let i = 0; i < attempts && !predicate(); i++) await setTimeout(20);
	assert.ok(predicate(), "expected asynchronous result");
}

function makeRunDir(t: TestContext, task: ScriptTask, owner = "wrapper-test") {
	const dir = mkdtempSync(join(tmpdir(), "loop-wrapper-"));
	t.after(() => {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* the wrapper may still hold files open on slow hosts */
		}
	});
	writeJsonAtomic(join(dir, TASK_FILE), {
		version: 1,
		taskId: "session:wrapper",
		scope: "session",
		payload: { scriptTask: task },
		ownerSessionId: owner,
		startedAt: Date.now(),
	});
	return dir;
}

function startWrapper(dir: string) {
	return spawn(process.execPath, ["--import", loader, entry, dir], {
		detached: true,
		stdio: "ignore",
	});
}

function nodeScript(code: string, timeoutSeconds: number | null = 5) {
	return {
		cwd: tmpdir(),
		path: process.execPath,
		params: ["-e", code],
		timeoutSeconds,
	};
}

async function finish(child: ReturnType<typeof startWrapper>) {
	// The wrapper can exit during the result-polling loop before any listener
	// is attached; a late `once("close")` would then wait forever.
	if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
	await new Promise((resolve) => child.once("close", resolve));
	return child.exitCode;
}

test(
	"wrapper runs scripts sequentially, records status, and writes a full result",
	{ timeout: 120_000 },
	async (t) => {
		const dir = makeRunDir(t, {
			wakeUp: { kind: "on-error", aggregation: "or", prompt: "handle it" },
			scripts: [
				nodeScript("process.stdout.write('first out')"),
				nodeScript("process.stderr.write('second err'); process.exit(3)"),
			],
		});
		const child = startWrapper(dir);
		await until(() => existsSync(join(dir, "result.json")));
		assert.equal(await finish(child), 0);
		const outcome = parseOutcome(readJson(join(dir, "result.json")));
		assert.ok(outcome);
		assert.equal(outcome.cancelled, false);
		assert.deepEqual(
			outcome.results.map((result) => result.status),
			["success", "failed"],
		);
		assert.equal(outcome.successCount, 1);
		assert.equal(outcome.shouldWake, true);
		assert.match(outcome.results[0]?.stdout ?? "", /first out/);
		assert.match(outcome.results[1]?.stderr ?? "", /second err/);
		assert.equal(outcome.results[1]?.exitCode, 3);
		assert.match(outcome.content, /stdout-log: /);
		assert.match(outcome.content, /handle it/);
		assert.ok(existsSync(join(dir, "output", "00-stdout.log")));
		assert.ok(existsSync(join(dir, "output", "01-stderr.log")));
		const status = parseStatus(readJson(join(dir, "status.json")));
		assert.ok(status);
		assert.equal(status.total, 2);
		assert.equal(status.completed, 2);
	},
);

test("never policy yields a no-wake result without prompts block", { timeout: 120_000 }, async (t) => {
	const dir = makeRunDir(t, {
		wakeUp: { kind: "never" },
		scripts: [nodeScript("process.stdout.write('quiet')")],
	});
	const child = startWrapper(dir);
	await until(() => existsSync(join(dir, "result.json")));
	assert.equal(await finish(child), 0);
	const outcome = parseOutcome(readJson(join(dir, "result.json")));
	assert.ok(outcome);
	assert.equal(outcome.shouldWake, false);
	assert.doesNotMatch(outcome.content, /<prompts>/);
});

test("per-script timeout marks the script and continues to the result", { timeout: 120_000 }, async (t) => {
	const dir = makeRunDir(t, {
		wakeUp: { kind: "always", prompt: "x" },
		scripts: [nodeScript("setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 30000)", 1)],
	});
	const child = startWrapper(dir);
	await until(() => existsSync(join(dir, "result.json")));
	assert.equal(await finish(child), 0);
	const outcome = parseOutcome(readJson(join(dir, "result.json")));
	assert.ok(outcome);
	assert.equal(outcome.results[0]?.status, "timeout");
});

test("SIGTERM cancels the current script and skips the remaining ones", { timeout: 120_000 }, async (t) => {
	const marker = join(tmpdir(), `loop-wrapper-marker-${Date.now()}`);
	const dir = makeRunDir(t, {
		wakeUp: { kind: "always", prompt: "x" },
		scripts: [
			nodeScript("setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 30000)"),
			nodeScript(
				`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
			),
		],
	});
	const child = startWrapper(dir);
	await until(() => existsSync(join(dir, "status.json")));
	child.kill("SIGTERM");
	await until(() => existsSync(join(dir, "result.json")));
	assert.equal(await finish(child), 0);
	const outcome = parseOutcome(readJson(join(dir, "result.json")));
	assert.ok(outcome);
	assert.equal(outcome.cancelled, true);
	assert.equal(outcome.results[0]?.status, "cancelled");
	assert.equal(outcome.results[1]?.status, "cancelled");
	assert.equal(existsSync(marker), false);
});

test("large output is tailed in the result but fully persisted to the log", { timeout: 120_000 }, async (t) => {
	const dir = makeRunDir(t, {
		wakeUp: { kind: "never" },
		scripts: [nodeScript("process.stdout.write('x'.repeat(64 * 1024))")],
	});
	const child = startWrapper(dir);
	await until(() => existsSync(join(dir, "result.json")));
	assert.equal(await finish(child), 0);
	const outcome = parseOutcome(readJson(join(dir, "result.json")));
	assert.ok(outcome);
	const tail = outcome.results[0]?.stdout ?? "";
	assert.ok(
		Buffer.byteLength(tail, "utf8") <= 8192 + 16,
		`tail too large: ${tail.length}`,
	);
	const log = join(dir, "output", "00-stdout.log");
	assert.equal(statSync(log).size, 64 * 1024);
	assert.ok(tail.length > 0);
});

test("task record round-trips through disk", async () => {
	const root = mkdtempSync(join(tmpdir(), "loop-record-"));
	const record = {
		version: 1 as const,
		taskId: "session:x",
		scope: "session" as const,
		payload: {
			scriptTask: {
				wakeUp: { kind: "on-error", aggregation: "and", prompt: "p" },
				scripts: [
					{ cwd: "/w", path: "/w/s", params: ["a"], timeoutSeconds: null },
				],
			},
		},
		ownerSessionId: "s1",
		startedAt: 5,
	};
	const path = join(root, "task.json");
	writeJsonAtomic(path, record);
	assert.deepEqual(parseTaskRecord(readJson(path)), record);
	assert.equal(parseTaskRecord(readJson(join(root, "missing.json"))), undefined);
	assert.equal(parseTaskRecord({ version: 2 }), undefined);
	assert.equal(parseOutcome({ cancelled: false, results: "no" }), undefined);
	rmSync(root, { recursive: true, force: true });
});

test("atomic writes store the value as JSON", async () => {
	const root = mkdtempSync(join(tmpdir(), "loop-atomic-"));
	const path = join(root, "result.json");
	writeJsonAtomic(path, { ok: true });
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { ok: true });
	rmSync(root, { recursive: true, force: true });
});

test("runner exits without side effects when the payload is not a script task", { timeout: 15_000 }, async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "loop-wrapper-prompt-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, "output"), { recursive: true });
	writeJsonAtomic(join(dir, TASK_FILE), {
		version: 1,
		taskId: "session:prompt",
		scope: "session",
		payload: { prompt: "only prompts" },
		ownerSessionId: "s",
		startedAt: Date.now(),
	});
	const child = startWrapper(dir);
	assert.equal(await finish(child), 2);
	assert.equal(existsSync(join(dir, "result.json")), false);
});
