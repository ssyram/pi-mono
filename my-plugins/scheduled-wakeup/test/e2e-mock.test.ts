import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
	bootstrapMockSession,
	dumpLastCapture,
	MOCK_SERVER,
	startMockServer,
} from "./e2e-mock-server.ts";

// Model-in-the-loop E2E: mock-with-pi scripted models drive loop delivery
// contracts inside a real pi TUI (tmux). Gated like the plain-TUI suite; the
// matrix lives in docs/design/loop/mock-e2e-matrix.md.
const hasTmux = (() => {
	try {
		execFileSync("tmux", ["-V"]);
		return true;
	} catch {
		return false;
	}
})();
const enabled = process.env.PI_LOOP_E2E === "1" && hasTmux && existsSync(MOCK_SERVER);
const run = enabled ? test : test.skip;

const PI_BIN = join(homedir(), ".pi", "agent", "bin", "pi");
const STAMP = Date.now();

function tmuxAt(target: string, args: string[]): string {
	return execFileSync("tmux", [...args.slice(0, 1), "-t", target, ...args.slice(1)], {
		encoding: "utf8",
	});
}

async function waitFor(
	target: string,
	pattern: RegExp,
	timeoutMs: number,
	what: string,
	captureFor?: () => string,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	for (;;) {
		last = tmuxAt(target, ["capture-pane", "-p"]);
		if (pattern.test(last)) return last;
		if (Date.now() > deadline) {
			const extra = captureFor?.() ?? "";
			assert.fail(
				`timed out waiting for ${what}; last pane:\n${last.split("\n").slice(-20).join("\n")}${extra === "" ? "" : `\n--- mock capture ---\n${extra}`}`,
			);
		}
		await sleep(300);
	}
}

function rmRetry(path: string): void {
	for (let i = 0; i < 6; i++) {
		try {
			rmSync(path, { recursive: true, force: true });
			return;
		} catch {
			sleep(200);
		}
	}
	try {
		rmSync(path, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
}

const scriptJson = (code: string, timeoutSeconds?: number) =>
	JSON.stringify({
		path: process.execPath,
		params: ["-e", code],
		...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
	});

async function bootSession(name: string, home: string, cwd: string): Promise<void> {
	execFileSync("tmux", ["new-session", "-d", "-s", name, "-x", "140", "-y", "36"]);
	tmuxAt(name, ["send-keys", "-l", `cd ${cwd} && env HOME=${home} ${PI_BIN} -c --model loopmock/mock-loop`]);
	tmuxAt(name, ["send-keys", "Enter"]);
	await waitFor(name, /Scheduled wakeup loaded/, 90_000, "extension load");
}

run("M1: busy wake holds until the settle boundary, then joins the turn", { timeout: 180_000 }, async (t) => {
	const mock = await startMockServer(
		join(import.meta.dirname, "e2e/mock-scripts/mock-busy-followup.mjs"),
		"busypollow",
		18101,
	);
	const cwd = mkdtempSync(join(tmpdir(), "loop-m1-"));
	bootstrapMockSession(mock, cwd);
	const SESSION = `pi-m1-${STAMP}`;
	t.after(() => {
		try { execFileSync("tmux", ["kill-session", "-t", SESSION]); } catch {}
		void mock.dispose();
		rmRetry(cwd);
		rmRetry(mock.home);
	});
	await bootSession(SESSION, mock.home, cwd);
	tmuxAt(SESSION, ["send-keys", "-l", "开始"]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	await waitFor(SESSION, /边界投递收到/, 120_000, "boundary delivery confirmation", () => dumpLastCapture(mock));
});

run("M2: no-wake results append quietly; no turn until the user asks", { timeout: 180_000 }, async (t) => {
	const mock = await startMockServer(
		join(import.meta.dirname, "e2e/mock-scripts/mock-quiet-append.mjs"),
		"quietppend",
		18102,
	);
	const cwd = mkdtempSync(join(tmpdir(), "loop-m2-"));
	bootstrapMockSession(mock, cwd);
	const SESSION = `pi-m2-${STAMP}`;
	t.after(() => {
		try { execFileSync("tmux", ["kill-session", "-t", SESSION]); } catch {}
		void mock.dispose();
		rmRetry(cwd);
		rmRetry(mock.home);
	});
	await bootSession(SESSION, mock.home, cwd);
	tmuxAt(SESSION, ["send-keys", "-l", "开始"]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	// script finishes at ~3s while bash holds 12s; boundary appends silently
	await sleep(16_000);
	const before = tmuxAt(SESSION, ["capture-pane", "-p", "-S", "-200"]);
	assert.doesNotMatch(before, /看到 QUIET-HIT/, "no model turn before the user asks");
	tmuxAt(SESSION, ["send-keys", "-l", "check"]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	await waitFor(SESSION, /看到 QUIET-HIT/, 60_000, "quiet append confirmation", () => dumpLastCapture(mock));
});

run("M4: wrapper survives pi exit; same session returns and delivers", { timeout: 240_000 }, async (t) => {
	const mock = await startMockServer(
		join(import.meta.dirname, "e2e/mock-scripts/mock-detached-tool.mjs"),
		"detachedol",
		18103,
	);
	const cwd = mkdtempSync(join(tmpdir(), "loop-m4-"));
	bootstrapMockSession(mock, cwd);
	const SESSION = `pi-m4-${STAMP}`;
	t.after(() => {
		try { execFileSync("tmux", ["kill-session", "-t", SESSION]); } catch {}
		void mock.dispose();
		rmRetry(cwd);
		rmRetry(mock.home);
	});
	await bootSession(SESSION, mock.home, cwd);
	tmuxAt(SESSION, ["send-keys", "-l", `/loop add --script ${scriptJson("setTimeout(()=>process.stdout.write('detached-ok'),8000)")} --wake always once 5s DETACHED-HIT 跨重启投递`]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	await waitFor(SESSION, /1 running \(/, 60_000, "wrapper starts running");
	await sleep(2000);
	execFileSync("tmux", ["kill-session", "-t", SESSION]);
	// wrapper finishes on disk while pi is gone
	await sleep(11_000);
	await bootSession(SESSION, mock.home, cwd);
	await waitFor(SESSION, /跨重启投递成功/, 120_000, "post-restart delivery confirmation");
	const runsRoot = join(cwd, ".pi", "scheduled-wakeup", "v2", "runs");
	const taskDir = readdirSync(runsRoot)[0];
	const runDir = readdirSync(join(runsRoot, taskDir!))[0]!;
	assert.equal(existsSync(join(runsRoot, taskDir!, runDir, "delivered.json")), true, "delivered marker on disk");
});

run("M5: SIGKILLed wrapper is synthesized as failed and wakes on-error", { timeout: 180_000 }, async (t) => {
	const mock = await startMockServer(
		join(import.meta.dirname, "e2e/mock-scripts/mock-failure-wake.mjs"),
		"lostwake",
		18104,
	);
	const cwd = mkdtempSync(join(tmpdir(), "loop-m5-"));
	bootstrapMockSession(mock, cwd);
	const SESSION = `pi-m5-${STAMP}`;
	t.after(() => {
		try { execFileSync("tmux", ["kill-session", "-t", SESSION]); } catch {}
		void mock.dispose();
		rmRetry(cwd);
		rmRetry(mock.home);
	});
	await bootSession(SESSION, mock.home, cwd);
	tmuxAt(SESSION, ["send-keys", "-l", `/loop add --script ${scriptJson("setInterval(()=>{},1000); setTimeout(()=>process.exit(0),60000)")} --wake on-error once 1s LOST-HIT 修复投递`]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	await waitFor(SESSION, /1 running \(/, 60_000, "wrapper starts running");
	const runsRoot = join(cwd, ".pi", "scheduled-wakeup", "v2", "runs");
	let pid: number | undefined;
	for (let i = 0; i < 40 && pid === undefined; i++) {
		await sleep(250);
		for (const task of readdirSync(runsRoot)) {
			for (const run of readdirSync(join(runsRoot, task))) {
				const pidFile = join(runsRoot, task, run, "wrapper.pid");
				if (existsSync(pidFile)) pid = Number(readFileSync(pidFile, "utf8").trim());
			}
		}
	}
	assert.ok(pid, "wrapper.pid found");
	process.kill(pid, "SIGKILL");
	await waitFor(SESSION, /lost 合成被唤醒/, 60_000, "synthesized failure wake");
});

run("M6: timeoutSeconds kills the batch and wakes on-error", { timeout: 180_000 }, async (t) => {
	const mock = await startMockServer(
		join(import.meta.dirname, "e2e/mock-scripts/mock-failure-wake.mjs"),
		"timeoutake",
		18105,
	);
	const cwd = mkdtempSync(join(tmpdir(), "loop-m6-"));
	bootstrapMockSession(mock, cwd);
	const SESSION = `pi-m6-${STAMP}`;
	t.after(() => {
		try { execFileSync("tmux", ["kill-session", "-t", SESSION]); } catch {}
		void mock.dispose();
		rmRetry(cwd);
		rmRetry(mock.home);
	});
	await bootSession(SESSION, mock.home, cwd);
	tmuxAt(SESSION, ["send-keys", "-l", `/loop add --script ${scriptJson("setTimeout(()=>{},30000)", 3)} --wake on-error once 1s TIMEOUT-HIT 超时投递`]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	await waitFor(SESSION, /timeout 处理正确/, 90_000, "timeout wake confirmation");
});

run("M7: model drives add(onceReady warning)/list/cancel through the tool", { timeout: 180_000 }, async (t) => {
	const mock = await startMockServer(
		join(import.meta.dirname, "e2e/mock-scripts/mock-detached-tool.mjs"),
		"tooltrip",
		18106,
	);
	const cwd = mkdtempSync(join(tmpdir(), "loop-m7-"));
	bootstrapMockSession(mock, cwd);
	const SESSION = `pi-m7-${STAMP}`;
	t.after(() => {
		try { execFileSync("tmux", ["kill-session", "-t", SESSION]); } catch {}
		void mock.dispose();
		rmRetry(cwd);
		rmRetry(mock.home);
	});
	await bootSession(SESSION, mock.home, cwd);
	tmuxAt(SESSION, ["send-keys", "-l", "开始"]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	// The warning line reaches the model's toolResult (custom-rendered in the
	// TUI, so the pane may not show it); the mock reaching list/cancel proves
	// it read the ⚠️, and 工具往返成功 closes the round trip.
	await waitFor(SESSION, /工具往返成功/, 120_000, "tool round-trip confirmation");
	tmuxAt(SESSION, ["send-keys", "-l", "/loop list"]);
	tmuxAt(SESSION, ["send-keys", "Enter"]);
	await sleep(1500);
	// The scrollback keeps the echoed cancel command and its session id; the
	// list ROW format ("name | session | ...") only exists for live tasks.
	assert.doesNotMatch(
		tmuxAt(SESSION, ["capture-pane", "-p", "-S", "-60"]),
		/\| session \|/,
		"no scheduled tasks remain",
	);
});
