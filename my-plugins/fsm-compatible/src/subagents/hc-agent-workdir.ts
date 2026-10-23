import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { HcAgentDomainError } from "./hc-agent-errors.ts";
import type { HcAgentWorkdir } from "./hc-agent-types.ts";

const WORKTREE_ROOT = ".opencode/worktrees";
const UNBORN_NOTE =
	"has no commits yet and this git could not create a worktree without one, so the workspace starts empty. Commit something for later subagents to get a real worktree, or pass cwd to place one somewhere specific.";

function runGit(args: string[], cwd: string): Promise<{ code: number; text: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let text = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (text += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", () => resolve({ code: 1, text: "", stderr: "git invocation failed" }));
		child.on("close", (code) => resolve({ code: code ?? 1, text, stderr }));
	});
}

function escapeIgnorePattern(value: string): string {
	const normalized = value.replaceAll("\\", "/");
	const escaped = normalized.replace(/([\\*?[\]])/g, "\\$1");
	const leading = /^[#!]/.test(escaped) ? `\\${escaped}` : escaped;
	return leading.endsWith(" ") ? `${leading.slice(0, -1)}\\ ` : leading;
}

async function registerIgnore(worktreeDir: string, destinationRoot: string): Promise<void> {
	const located = await runGit(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], worktreeDir);
	if (located.code !== 0) return;
	const file = located.text.trim();
	if (!file) return;
	const rel = relative(worktreeDir, destinationRoot);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return;
	const entry = `/${escapeIgnorePattern(rel)}`;
	let existing = "";
	try {
		existing = readFileSync(file, "utf8");
	} catch {
		existing = "";
	}
	if (existing.split("\n").some((line) => line.trim() === entry)) return;
	const next = existing.trimEnd();
	try {
		writeFileSync(file, next ? `${next}\n${entry}\n` : `${entry}\n`);
	} catch {
		/* ignore-registration is best effort, as upstream */
	}
}

function ascendingDirectory(destinationRoot: string): string {
	let index = 1;
	while (existsSync(join(destinationRoot, `agent_${index}`))) index++;
	return join(destinationRoot, `agent_${index}`);
}

async function emptyWorkspace(destinationRoot: string, baseDirectory: string, note?: string): Promise<HcAgentWorkdir> {
	const directory = ascendingDirectory(destinationRoot);
	try {
		mkdirSync(directory, { recursive: true });
	} catch (error) {
		throw HcAgentDomainError.worktreeUnavailable(
			`could not create a workspace directory: ${error instanceof Error ? error.message : String(error)}`,
			[directory],
		);
	}
	void baseDirectory;
	return { path: directory, source: "generated_empty_workspace", enforced: false, ...(note ? { note } : {}) };
}

/** HC AgentWorkdir.prepare: provided cwd is only resolved; omitted cwd prepares .opencode/worktrees. */
export async function prepareAgentWorkdir(input: {
	instanceDirectory: string;
	cwd?: string;
	parentWorkdir?: HcAgentWorkdir;
}): Promise<HcAgentWorkdir> {
	if (input.cwd) {
		// HC resolve semantics: an absolute cwd stays absolute; only relative
		// paths resolve against the instance directory.
		return { path: resolve(input.instanceDirectory, input.cwd), source: "provided_cwd", enforced: false };
	}
	const destinationRoot = join(input.instanceDirectory, WORKTREE_ROOT);
	const baseDirectory = input.parentWorkdir?.path ?? input.instanceDirectory;
	const repo = await runGit(["rev-parse", "--is-inside-work-tree"], baseDirectory);
	if (repo.code !== 0 || repo.text.trim() !== "true") {
		return emptyWorkspace(destinationRoot, baseDirectory);
	}
	await registerIgnore(baseDirectory, destinationRoot);
	const head = await runGit(["rev-parse", "--verify", "-q", "HEAD"], baseDirectory);
	if (head.code !== 0 && head.code !== 1) {
		throw HcAgentDomainError.worktreeUnavailable(`could not read HEAD of ${baseDirectory}: ${head.stderr.trim()}`, []);
	}
	if (head.code === 1) {
		const directory = ascendingDirectory(destinationRoot);
		const orphan = await runGit(["worktree", "add", "--orphan", directory], baseDirectory);
		if (orphan.code !== 0) {
			return emptyWorkspace(destinationRoot, baseDirectory, `${baseDirectory} ${UNBORN_NOTE}`);
		}
		return { path: directory, source: "generated_git_worktree", enforced: false };
	}
	const directory = ascendingDirectory(destinationRoot);
	const created = await runGit(["worktree", "add", "--detach", directory, head.text.trim()], baseDirectory);
	if (created.code !== 0) {
		throw HcAgentDomainError.worktreeUnavailable(created.stderr.trim() || "git worktree add failed", [destinationRoot]);
	}
	return { path: directory, source: "generated_git_worktree", enforced: false };
}
