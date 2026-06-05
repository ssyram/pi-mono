/**
 * Logger — per-session file-based logging for historian diagnostics.
 *
 * Call `initLogger(cwd, sessionId)` during session_start to activate.
 * Before initialization, all log calls are silently ignored.
 * Writes to `{cwd}/.pi/historians/{sessionId}.log`.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const MIN_LEVEL: number = LEVELS.info;

let logPath: string | undefined;

/**
 * Initialize the logger for the current session.
 * Creates the directory structure if needed.
 * Must be called before log output will be written.
 */
export function initLogger(cwd: string, sessionId: string): void {
	logPath = join(cwd, ".pi", "historians", `${sessionId}.log`);
	try {
		mkdirSync(dirname(logPath), { recursive: true });
	} catch {
		// Best-effort — if dir creation fails, writes will fail silently too
	}
}

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function write(level: Level, message: string): void {
	if (!logPath) return; // Not initialized yet — silently ignore
	if (LEVELS[level] < MIN_LEVEL) return;
	try {
		const now = new Date();
		const ts = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
		const line = `[${ts}] ${level.toUpperCase()} | ${message}\n`;
		appendFileSync(logPath, line);
	} catch {
		// Silent — never let logging break historian
	}
}

/** Historian file logger. */
export const log = {
	debug: (msg: string) => write("debug", msg),
	info: (msg: string) => write("info", msg),
	warn: (msg: string) => write("warn", msg),
	error: (msg: string) => write("error", msg),
};
