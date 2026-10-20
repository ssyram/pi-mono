import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface ProcessExit {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly spawnFailed: boolean;
}
export interface OwnedProcess {
	readonly child: ChildProcessWithoutNullStreams;
	readonly closed: Promise<ProcessExit>;
	close(deadline: number): Promise<boolean>;
}

export function startOwnedProcess(command: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd?: string): OwnedProcess {
	const child = spawn(command, [...args], { env, ...(cwd ? { cwd } : {}), stdio: ["pipe", "pipe", "pipe"], shell: false });
	let ended = false;
	let spawnFailed = false;
	child.on("error", () => { spawnFailed = true; });
	const closed = new Promise<ProcessExit>((resolve) => {
		child.once("close", (code, signal) => {
			ended = true;
			resolve(Object.freeze({ code, signal, spawnFailed }));
		});
	});
	let closing: Promise<boolean> | undefined;
	return {
		child,
		closed,
		close(deadline) {
			if (ended) return Promise.resolve(true);
			if (closing) return closing;
			closing = new Promise<boolean>((resolve) => {
				let complete = false;
				const finish = (value: boolean) => {
					if (complete) return;
					complete = true;
					clearTimeout(killTimer);
					clearTimeout(limitTimer);
					resolve(value);
				};
				child.stdin.end();
				child.kill("SIGTERM");
				const remaining = Math.max(0, deadline - Date.now());
				const killTimer = setTimeout(() => { if (!ended) child.kill("SIGKILL"); }, Math.min(250, remaining));
				const limitTimer = setTimeout(() => finish(false), remaining);
				killTimer.unref();
				limitTimer.unref();
				void closed.then(() => finish(true));
			});
			return closing;
		},
	};
}
