import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { killScriptGroup } from "./kill-script-group.js";
import { armScriptTimeout } from "./script-timeout.js";
import type { ScriptResult, ScriptSpec } from "./task-spec.js";

export function runScript(
	script: ScriptSpec,
	abortSignal?: AbortSignal,
): Promise<ScriptResult> {
	if (abortSignal?.aborted)
		return Promise.resolve(
			startFailure(script, "Session closed before script start."),
		);
	if (process.platform === "win32")
		return Promise.resolve(
			startFailure(script, "POSIX process groups are required."),
		);
	return new Promise((resolve) => {
		let child: ChildProcessByStdio<null, Readable, Readable>;
		try {
			child = spawn(script.path, [...script.params], {
				cwd: script.cwd,
				shell: false,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			resolve(
				startFailure(
					script,
					error instanceof Error ? error.message : String(error),
				),
			);
			return;
		}
		let stdout = "";
		let stderr = "";
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
		abortSignal?.addEventListener("abort", abort, { once: true });
		const finish = (
			status: ScriptResult["status"],
			exitCode: number | null,
			signal: string | null,
			error: string | null,
		): void => {
			if (settled) return;
			settled = true;
			cancelTimeout?.();
			abortSignal?.removeEventListener("abort", abort);
			child.stdout.destroy();
			child.stderr.destroy();
			resolve({ script, status, exitCode, signal, stdout, stderr, error });
		};
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
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
					? (terminationError ?? "Session closed during script execution.")
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

function startFailure(script: ScriptSpec, error: string): ScriptResult {
	return {
		script,
		status: "start-failed",
		exitCode: null,
		signal: null,
		stdout: "",
		stderr: "",
		error,
	};
}
