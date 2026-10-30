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

function rmRetry(path: string): void {
	for (let i = 0; i < 6; i++) {
		try {
			rmSync(path, { recursive: true, force: true });
			return;
		} catch {
			sleepSync(300);
		}
	}
	try {
		rmSync(path, { recursive: true, force: true });
	} catch {
		/* best effort: leftover temp dirs are harmless */
	}
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function capture(): string {
	return tmux(["capture-pane", "-t", SESSION, "-p"]);
}

function captureHistory(lines = 300): string {
	return tmux(["capture-pane", "-t", SESSION, "-p", "-S", `-${lines}`]);
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

async function waitForHistory(
	pattern: RegExp,
	timeoutMs: number,
	what: string,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	for (;;) {
		last = captureHistory();
		if (pattern.test(last)) return last;
		if (Date.now() > deadline)
			assert.fail(`timed out waiting for ${what}; last history:\n${last.split("\n").slice(-40).join("\n")}`);
		await sleep(300);
	}
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

function bootstrapSessionFileNamed(cwd: string): {
	dir: string;
	sessionId: string;
} {
	const real = realpathSync(cwd);
	const slug = `--${real.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const dir = join(homedir(), ".pi", "agent", "sessions", slug);
	mkdirSync(dir, { recursive: true });
	const id = randomUUID();
	const iso = new Date().toISOString();
	const stamp = iso.replaceAll(":", "-").replaceAll(".", "-");
	writeFileSync(
		join(dir, `${stamp}_${id}.jsonl`),
		`${JSON.stringify({ type: "session", version: 3, id, timestamp: iso, cwd: real })}\n`,
		"utf8",
	);
	return { dir, sessionId: id };
}

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
			rmRetry(cwd);
			rmRetry(sessionsDir);
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
			rmRetry(cwd);
			rmRetry(sessionsDir);
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

run(
	"TUI stop: kills the live batch, refuses duplicate run, list shows Running",
	{ timeout: 240_000 },
	async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "loop-e2e-stop-"));
		const sessionsDir = bootstrapSessionFile(cwd);
		t.after(() => {
			try {
				tmux(["kill-session", "-t", SESSION]);
			} catch {}
			rmRetry(cwd);
			rmRetry(sessionsDir);
		});
		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} -c`);
		enter();
		await waitFor(/Scheduled wakeup loaded/, 90_000, "extension load");
		const long = JSON.stringify({
			path: process.execPath,
			params: [
				"-e",
				"process.stdout.write('stopbody'); setInterval(()=>{},1000); setTimeout(()=>process.exit(0),30000)",
			],
		});
		await runCommand(`/loop add --script ${long} --wake never once 1h stop probe`);
		await runCommand("/loop list");
		const listed = await waitFor(/session:/, 30_000, "task id");
		const taskId = listed.match(/session:[0-9a-f-]{36}/)?.[0] ?? "";
		assert.ok(taskId);
		await runCommand(`/loop run ${taskId}`);
		await runCommand(`/loop run ${taskId}`);
		await waitFor(/already running/, 30_000, "duplicate run refused");
		await runCommand("/loop list");
		await waitFor(/Running \(0\/0\/1\)/, 60_000, "running line in list");
		await runCommand(`/loop stop ${taskId}`);
		await waitFor(/Killed 1 running batch/, 60_000, "stop kills batch");
		await sleep(1500);
		assert.doesNotMatch(capture(), /stopbody/, "cancelled run must not deliver");
		const runsRoot = join(cwd, ".pi", "scheduled-wakeup", "v2", "runs", taskId);
		let terminal = false;
		for (let i = 0; i < 100 && !terminal; i++) {
			await sleep(200);
			const latest = existsSync(runsRoot)
				? join(runsRoot, execFileSync("ls", ["-t", runsRoot]).toString().split("\n")[0] ?? "")
				: "";
			terminal =
				latest !== "" &&
				(existsSync(join(latest, "cancelled.json")) ||
					(existsSync(join(latest, "result.json")) &&
						readFileSync(join(latest, "result.json"), "utf8").includes('"cancelled": true')));
		}
		assert.ok(terminal, "run reaches cancelled terminal state");
		key("C-c");
		await settle();
	},
);

run(
	"TUI policy matrix: never card, on-error success silent, timeout wakes, prompt-only direct",
	{ timeout: 300_000 },
	async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "loop-e2e-policy-"));
		const sessionsDir = bootstrapSessionFile(cwd);
		t.after(() => {
			try {
				tmux(["kill-session", "-t", SESSION]);
			} catch {}
			rmRetry(cwd);
			rmRetry(sessionsDir);
		});
		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} -c`);
		enter();
		await waitFor(/Scheduled wakeup loaded/, 90_000, "extension load");
		const script = (code: string) =>
			JSON.stringify({ path: process.execPath, params: ["-e", code] });

		await runCommand(
			`/loop add --script ${script("process.stdout.write('never-marker')")} --wake never once 5s p1`,
		);
		await waitFor(/1\/1 OK/, 90_000, "never card delivered");

		await runCommand(
			`/loop add --script ${script("process.stdout.write('ok1')")} --script ${script(
				"process.stdout.write('ok2')",
			)} --wake on-error --error-mode or once 5s p2`,
		);
		await waitFor(/2\/2 OK/, 90_000, "on-error all-success card");
		await sleep(1000);

		await runCommand(
			`/loop add --script ${script("process.stdout.write('t1')")} --script ${JSON.stringify({
				path: process.execPath,
				params: ["-e", "setInterval(()=>{},1000); setTimeout(()=>process.exit(0),30000)"],
				timeoutSeconds: 2,
			})} --wake on-error --error-mode or once 5s p3`,
		);
		await waitFor(/1\/2 OK/, 120_000, "timeout script run card");

		await runCommand(`/loop add once 5s direct prompt body`);
		await waitFor(/0\/0 OK/, 60_000, "prompt-only card");

		key("C-c");
		await settle();
	},
);

run(
	"TUI ownership: second session never steals; owner delivers after return",
	{ timeout: 300_000 },
	async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "loop-e2e-owner-"));
		const { dir: sessionsDir, sessionId } = bootstrapSessionFileNamed(cwd);
		const SECOND = `${SESSION}-b`;
		t.after(() => {
			for (const s of [SESSION, SECOND]) {
				try {
					tmux(["kill-session", "-t", s]);
				} catch {}
			}
			rmRetry(cwd);
			rmRetry(sessionsDir);
		});
		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} -c`);
		enter();
		await waitFor(/Scheduled wakeup loaded/, 90_000, "owner extension load");
		const owned = JSON.stringify({
			path: process.execPath,
			params: ["-e", "setTimeout(()=>{console.log('ownerbody')},12000)"],
		});
		await runCommand(
			`/loop add --script ${owned} --wake never once 6s own probe`,
		);
		await sleep(2500);
		const runsRoot = join(cwd, ".pi", "scheduled-wakeup", "v2", "runs");
		let wrapperStarted = false;
		for (let i = 0; i < 20 && !wrapperStarted; i++) {
			await sleep(500);
			wrapperStarted =
				existsSync(runsRoot) &&
				execFileSync("find", [runsRoot, "-name", "status.json"]).toString().trim() !== "";
		}
		assert.ok(wrapperStarted, "wrapper started before owner leaves");
		tmux(["kill-session", "-t", SESSION]);

		tmux(["new-session", "-d", "-s", SECOND, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN}`);
		enter();
		await waitFor(
			/Scheduled wakeup loaded|属于其他会话/,
			90_000,
			"second session load (extension banner or fork notice)",
		);
		await sleep(15000);
		const secondPane = capture();
		assert.doesNotMatch(secondPane, /1\/1 OK/, "second session must not receive the card");
		assert.equal(
			existsSync(join(runsRoot, "..", "runs")) &&
				execFileSync("find", [runsRoot, "-name", "delivered.json"]).toString().trim() === "",
			true,
			"nobody may deliver while the owner is away",
		);
		await runCommand("/loop list");
		assert.doesNotMatch(capture(), /own probe/, "foreign task invisible to second session");
		tmux(["kill-session", "-t", SECOND]);

		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} --session ${sessionId}`);
		enter();
		await waitFor(/1\/1 OK/, 60_000, "owner delivers after return");
		const deliveredFiles = execFileSync("find", [runsRoot, "-name", "delivered.json"])
			.toString()
			.trim()
			.split("\n");
		const marker = JSON.parse(readFileSync(deliveredFiles[0] ?? "", "utf8"));
		assert.equal(marker.sessionId, sessionId, "delivered by the owner session only");
		key("C-c");
		await settle();
	},
);

run(
	"TUI scheduling: manual run leaves schedule, defer moves next run, interval advances",
	{ timeout: 240_000 },
	async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "loop-e2e-sched-"));
		const sessionsDir = bootstrapSessionFile(cwd);
		t.after(() => {
			try {
				tmux(["kill-session", "-t", SESSION]);
			} catch {}
			rmRetry(cwd);
			rmRetry(sessionsDir);
		});
		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} -c`);
		enter();
		await waitFor(/Scheduled wakeup loaded/, 90_000, "extension load");
		const quick = JSON.stringify({
			path: process.execPath,
			params: ["-e", "process.stdout.write('tick')"],
		});
		await runCommand(
			`/loop add --script ${quick} --wake never once 1h manual probe`,
		);
		await runCommand("/loop list");
		const listed = await waitFor(/session:/, 30_000, "list shows task");
		const taskId = listed.match(/session:[0-9a-f-]{36}/)?.[0] ?? "";
		assert.ok(taskId);
		await runCommand(`/loop run ${taskId}`);
		await waitFor(/1\/1 OK/, 90_000, "manual run card");
		await runCommand("/loop list");
		const afterManual = await waitFor(new RegExp(`${taskId.slice(0, 24)}[\\s\\S]*runs 0`), 30_000, "runCount stays 0 after manual run");
		void afterManual;

		await runCommand(`/loop defer ${taskId} 5m`);
		await waitFor(/Deferred/, 30_000, "defer notice");
		await runCommand("/loop list");
		await waitFor(/next in 1h[45]m/, 30_000, "deferred next-in time (1h + 5m)");

		await runCommand(
			`/loop add --script ${quick} --wake never 6s interval probe`,
		);
		await sleep(15000);
		await runCommand("/loop list");
		await waitForHistory(/runs [12]/, 30_000, "interval advanced runCount");
		key("C-c");
		await settle();
	},
);

run(
	"TUI GC: expired terminal runs pruned to newest five",
	{ timeout: 240_000 },
	async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "loop-e2e-gc-"));
		const { dir: sessionsDir, sessionId } = bootstrapSessionFileNamed(cwd);
		t.after(() => {
			try {
				tmux(["kill-session", "-t", SESSION]);
			} catch {}
			rmRetry(cwd);
			rmRetry(sessionsDir);
		});
		tmux(["new-session", "-d", "-s", SESSION, "-x", "120", "-y", "34"]);
		send(`cd ${cwd} && ${PI_BIN} -c`);
		enter();
		await waitFor(/Scheduled wakeup loaded/, 90_000, "extension load");
		const quick = JSON.stringify({
			path: process.execPath,
			params: ["-e", "process.stdout.write('gcrun')"],
		});
		await runCommand(`/loop add --script ${quick} --wake never once 1h gc probe`);
		await runCommand("/loop list");
		const listed = await waitFor(/session:/, 30_000, "task id");
		const taskId = listed.match(/session:[0-9a-f-]{36}/)?.[0] ?? "";
		assert.ok(taskId);
		await runCommand(`/loop run ${taskId}`);
		await waitFor(/1\/1 OK/, 90_000, "real run delivered");

		const runsRoot = join(cwd, ".pi", "scheduled-wakeup", "v2", "runs", taskId);
		const weekAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
		for (let i = 0; i < 7; i += 1) {
			const dir = join(runsRoot, `old-${i}`);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "task.json"),
				JSON.stringify({
					version: 1,
					taskId,
					scope: "session",
					payload: { scriptTask: { wakeUp: { kind: "never" }, scripts: [] } },
					ownerSessionId: sessionId,
					startedAt: weekAgo + i * 1000,
				}),
			);
			writeFileSync(
				join(dir, "result.json"),
				JSON.stringify({
					cancelled: true,
					results: [],
					successCount: 0,
					shouldWake: false,
					completedAt: weekAgo + i * 1000,
					content: "c",
				}),
			);
		}
		let pruned = false;
		for (let i = 0; i < 60 && !pruned; i++) {
			await sleep(500);
			pruned =
				!existsSync(join(runsRoot, "old-0")) &&
				!existsSync(join(runsRoot, "old-1")) &&
				!existsSync(join(runsRoot, "old-2"));
		}
		assert.ok(pruned, "three oldest expired runs pruned (8 terminals, keep 5)");
		for (let i = 3; i < 7; i += 1)
			assert.equal(existsSync(join(runsRoot, `old-${i}`)), true, `old-${i} kept`);
		key("C-c");
		await settle();
	},
);
