import { type ChildProcess, type ChildProcessByStdio, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { killScriptGroup } from "./kill-script-group.js";
import { OUTPUT_TAIL_BYTES, readTail } from "./read-tail.js";
import { armScriptTimeout } from "./script-timeout.js";
import {
	type RunnerOptions,
	type ScriptResult,
	scriptStartFailure,
	type ScriptSpec,
} from "./task-spec.js";

export type { RunnerOptions };

export function logFileNames(index: number): {
	stdoutLog: string;
	stderrLog: string;
} {
	const prefix = String(index).padStart(2, "0");
	return { stdoutLog: `${prefix}-stdout.log`, stderrLog: `${prefix}-stderr.log` };
}

export function runScriptLogged(
	script: ScriptSpec,
	options: RunnerOptions,
): Promise<ScriptResult> {
	const { stdoutLog, stderrLog } = logFileNames(options.index ?? 0);
	const stdoutPath = join(options.logDir ?? ".", stdoutLog);
	const stderrPath = join(options.logDir ?? ".", stderrLog);
	return new Promise((resolve) => {
		let stdoutFd: number;
		let stderrFd: number;
		try {
			stdoutFd = openSync(stdoutPath, "a");
			stderrFd = openSync(stderrPath, "a");
		} catch (error) {
			resolve(
				scriptStartFailure(
					script,
					error instanceof Error ? error.message : String(error),
				),
			);
			return;
		}
		const closeLogs = (): void => {
			closeSync(stdoutFd);
			closeSync(stderrFd);
		};
		let child: ChildProcess;
		try {
			child = spawn(script.path, [...script.params], {
				cwd: script.cwd,
				shell: false,
				detached: true,
				stdio: ["ignore", stdoutFd, stderrFd] as ["ignore", number, number],
			});
		} catch (error) {
			closeLogs();
			resolve(
				scriptStartFailure(
					script,
					error instanceof Error ? error.message : String(error),
				),
			);
			return;
		}
		options.onSpawn?.(child.pid);
		let settled = false;
		let timedOut = false;
		let aborted = false;
		let terminationError: string | null = null;
		let cancelTimeout: (() => void) | undefined;
		const abort = (): void => {
			if (settled || timedOut) return;
			aborted = true;
			terminationError = killScriptGroup(child.pid);
		};
		options.abortSignal?.addEventListener("abort", abort, { once: true });
		const finish = (
			status: ScriptResult["status"],
			exitCode: number | null,
			signal: string | null,
			error: string | null,
		): void => {
			if (settled) return;
			settled = true;
			cancelTimeout?.();
			options.abortSignal?.removeEventListener("abort", abort);
			closeLogs();
			resolve({
				script,
				status,
				exitCode,
				signal,
				stdout: readTail(stdoutPath, OUTPUT_TAIL_BYTES) ?? "",
				stderr: readTail(stderrPath, OUTPUT_TAIL_BYTES) ?? "",
				stdoutLog: stdoutPath,
				stderrLog: stderrPath,
				error,
			});
		};
		child.once("spawn", () => {
			if (aborted) return;
			cancelTimeout = armScriptTimeout(script.timeoutSeconds, () => {
				timedOut = true;
				terminationError = killScriptGroup(child.pid);
			});
		});
		child.once("error", (error) => {
			const cleanupError = killScriptGroup(child.pid);
			const message =
				cleanupError === null
					? error.message
					: `${error.message}; cleanup: ${cleanupError}`;
			finish(timedOut ? "timeout" : "start-failed", null, null, message);
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			const error = timedOut
				? terminationError
				: aborted
					? (terminationError ?? "Cancelled during script execution.")
					: killScriptGroup(child.pid);
			const status = timedOut
				? "timeout"
				: code === 0 && signal === null && error === null
					? "success"
					: "failed";
			finish(status, code, signal, error);
		});
	});
}
