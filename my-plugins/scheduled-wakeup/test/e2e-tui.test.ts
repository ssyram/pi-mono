import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	realpathSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

// True end-to-end: drives a real pi TUI inside tmux, through the globally
// installed extension (live source via ~/.pi/agent/extensions), real wrapper
// processes, and real delivery into the transcript.
// Gate: PI_LOOP_E2E=1 and a tmux binary; otherwise skipped in the normal suite.
const enabled = process.env.PI_LOOP_E2E === "1";
const hasTmux = existsSync(join(homedir(), ".pi", "agent", "bin", "pi"));
const run = enabled && hasTmux ? test : test.skip;

const PI_BIN = join(homedir(), ".pi", "agent", "bin", "pi");
const SESSION = `pi-e2e-loop-${Date.now()}`;

function tmux(args: string[]): string {
	return execFileSync("tmux", args, { encoding: "utf8" });
}

function capture(): string {
	return tmux(["capture-pane", "-t", SESSION, "-p"]);
}

function send(text: string): void {
	tmux(["send-keys", "-t", SESSION, "-l", text]);
}

function enter(): void {
	tmux(["send-keys", "-t", SESSION, "Enter"]);
}

function key(name: string): void {
	tmux(["send-keys", "-t", SESSION, name]);
}

async function waitFor(
	pattern: RegExp,
	timeoutMs: number,
	what: string,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	for (;;) {
		last = capture();
		if (pattern.test(last)) return last;
		if (Date.now() > deadline) {
			assert.fail(
				`timed out waiting for ${what}; last pane:\n${last.split("\n").slice(-25).join("\n")}`,
			);
		}
		await sleep(300);
	}
}

async function settle(): Promise<void> {
	await sleep(400);
}

/** Types a command, submits it, and retries Enter until the input dock clears. */
async function runCommand(text: string): Promise<void> {
	send(text);
	await sleep(250);
	enter();
	for (let i = 0; i < 3; i++) {
		await sleep(600);
		const lines = capture().split("\n");
		const dock = lines.slice(-8).join(" ");
		if (!dock.includes(text)) return;
		enter();
	}
	assert.fail(`command not submitted: ${text}`);
}

const MISSING_MODEL = "__loop_e2e_missing__";
void MISSING_MODEL;

// Pre-creates a minimal session file where pi's -c will find it, so /loop add
// passes the persistence gate without any model call.
function bootstrapSessionFile(cwd: string): string {
	// pi resolves the real cwd (macOS /var -> /private/var) before slugging.
	const real = realpathSync(cwd);
	const slug = `--${real.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const dir = join(homedir(), ".pi", "agent", "sessions", slug);
	mkdirSync(dir, { recursive: true });
	const id = randomUUID();
	const iso = new Date().toISOString();
	const stamp = iso.replaceAll(":", "-").replaceAll(".", "-");
	const file = join(dir, `${stamp}_${id}.jsonl`);
	writeFileSync(
		file,
		`${JSON.stringify({ type: "session", version: 3, id, timestamp: iso, cwd })}\n`,
		"utf8",
	);
	return dir;
}

run(
	"TUI end-to-end: add → widget waiting → run → running → result card → list → stop",
	{ timeout: 300_000 },
	async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "loop-e2e-tui-"));
		const sessionsDir = bootstrapSessionFile(cwd);
		t.after(() => {
			try {
				tmux(["kill-session", "-t", SESSION]);
			} catch {
				/* already gone */
			}
			rmSync(cwd, { recursive: true, force: true });
			rmSync(sessionsDir, { recursive: true, force: true });
		});
		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} -c`);
		enter();
		await waitFor(/Scheduled wakeup loaded/, 90_000, "extension load notice");

		// 1. a quick never-wake script task
		const quick = JSON.stringify({
			path: process.execPath,
			params: ["-e", "process.stdout.write('e2e-ok')"],
		});
		await runCommand(`/loop add --script ${quick} --wake never once 1h e2e quick`);
		await waitFor(/Loop · 1 scheduled/, 30_000, "widget shows 1 scheduled");

		// 2. run it now: wrapper spawns, widget shows Running, then the result card
		let taskId = "";
		{
			await runCommand("/loop list");
			const listed = await waitFor(/session:/, 30_000, "list output with task id");
			taskId =
				listed.match(/session:[0-9a-f-]{36}/)?.[0] ??
				(() => {
					throw new Error("no session task id in list output");
				})();
		}
		await runCommand(`/loop run ${taskId}`);
		await waitFor(/1\/1 OK/, 90_000, "delivered result card for the quick task");
		await waitFor(/no wake/, 60_000, "result card no-wake label");

		await runCommand("/loop running");

		// 3. list reflects waiting state with the task summary
		await runCommand("/loop list");
		await waitFor(/once at |next in /, 30_000, "list waiting line");

		// 4. a long-running task, then stop kills the live wrapper
		const long = JSON.stringify({
			path: process.execPath,
			params: [
				"-e",
				"process.stdout.write('long-started'); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 30000)",
			],
		});
		await runCommand(`/loop add --script ${long} --wake never once 1h e2e long`);
		await waitFor(/Loop · 2 scheduled/, 30_000, "widget shows 2 scheduled");
		let longId = "";
		{
			await runCommand("/loop list");
			const listed = await waitFor(
				/session:[0-9a-f-]{36}[\s\S]*session:[0-9a-f-]{36}/,
				30_000,
				"list shows both tasks",
			);
			const ids = [...listed.matchAll(/session:[0-9a-f-]{36}/g)].map((m) => m[0]);
			longId = ids.find((id) => id !== taskId) ?? "";
			assert.ok(longId, "long task id must appear in list");
		}
		await runCommand(`/loop run ${longId}`);
		await waitFor(/Running \(0\/0\/1\).*node/, 60_000, "long task running");
		await runCommand(`/loop stop ${longId}`);
		await waitFor(/Stopped .*Killed 1 running batch/, 60_000, "stop kill message");
		await settle();
		const runsRoot = join(
			cwd,
			".pi",
			"scheduled-wakeup",
			"v2",
			"runs",
			longId,
		);
		let cancelledSeen = false;
		for (let i = 0; i < 100 && !cancelledSeen; i++) {
			await sleep(200);
			const runDir = existsSync(runsRoot)
				? join(
						runsRoot,
						(execFileSync("ls", ["-t", runsRoot]).toString().split("\n")[0] ??
							""),
					)
				: "";
			const result = runDir === "" ? undefined : join(runDir, "result.json");
			cancelledSeen =
				result !== undefined &&
				existsSync(result) &&
				(readFileSync(result, "utf8").includes('"cancelled": true') ||
					existsSync(join(runDir, "cancelled.json")));
		}
		assert.ok(cancelledSeen, "stopped run must reach a cancelled terminal state");
		assert.doesNotMatch(capture(), /long-started/, "cancelled run must not deliver");

		key("C-c");
		await settle();
	},
);

run(
	"TUI keyboard: ctrl+o toggles the delivered result card body",
	{ timeout: 240_000 },
	async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "loop-e2e-key-"));
		const sessionsDir = bootstrapSessionFile(cwd);
		t.after(() => {
			try {
				tmux(["kill-session", "-t", SESSION]);
			} catch {
				/* already gone */
			}
			rmSync(cwd, { recursive: true, force: true });
			rmSync(sessionsDir, { recursive: true, force: true });
		});
		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} -c`);
		enter();
		await waitFor(/Scheduled wakeup loaded/, 90_000, "extension load notice");
		const quick = JSON.stringify({
			path: process.execPath,
			params: ["-e", "process.stdout.write('keyboard-body-marker')"],
		});
		await runCommand(`/loop add --script ${quick} --wake never once 1h key probe`);
		await runCommand("/loop list");
		const listed = await waitFor(/session:/, 30_000, "list output with task id");
		const taskId = listed.match(/session:[0-9a-f-]{36}/)?.[0] ?? "";
		assert.ok(taskId, "task id from list");
		await runCommand(`/loop run ${taskId}`);
		await waitFor(/1\/1 OK/, 120_000, "delivered result card");

		key("C-o");
		await waitFor(/keyboard-body-marker|stdout-log:/, 15_000, "card body after ctrl+o");
		key("C-o");
		await sleep(800);
		assert.doesNotMatch(
			capture(),
			/stdout-log:/,
			"card body must collapse on second ctrl+o",
		);
		key("C-c");
		await settle();
	},
);
