import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Child tmux session names are opaque identifiers with a strict charset. */
export function tmuxSessionName(sessionId: string): string {
	if (!/^ses_[0-9a-f]+$/.test(sessionId)) throw new Error(`invalid child session id for tmux: ${sessionId}`);
	return `fsm-${sessionId}`;
}

export async function tmuxHasSession(name: string): Promise<boolean> {
	try { await exec("tmux", ["has-session", "-t", name], { timeout: 5000 }); return true; }
	catch { return false; }
}

export async function tmuxKillSession(name: string): Promise<void> {
	await exec("tmux", ["kill-session", "-t", name], { timeout: 5000 }).catch(() => {});
}

export interface TmuxSpawnInput {
	sessionName: string;
	cwd: string;
	command: string;
	args: readonly string[];
	env: NodeJS.ProcessEnv;
	logFile: string;
}

/**
 * Spawn the child as a detached interactive TUI inside its own tmux session.
 * Env is passed explicitly (tmux new-session does not inherit the client env).
 */
export async function tmuxSpawnChild(input: TmuxSpawnInput): Promise<void> {
	const pairs: string[] = [];
	for (const [key, value] of Object.entries(input.env)) if (value !== undefined) pairs.push(`${key}=${value}`);
	const { appendFile, writeFile } = await import("node:fs/promises");
	const result = await exec("tmux", ["new-session", "-d", "-s", input.sessionName, "-x", "120", "-y", "40",
		"-c", input.cwd, "--", "env", ...pairs, input.command, ...input.args], { timeout: 15_000 });
	try { await writeFile(input.logFile, `tmux spawn ok\n${result.stdout}${result.stderr}`, { mode: 0o600 }); }
	catch { await appendFile(input.logFile, `${result.stdout}${result.stderr}`); }
}
