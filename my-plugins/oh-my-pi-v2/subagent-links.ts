/**
 * Ensure bundled oh-my-pi-v2 agent markdown files are visible to pi-subagents.
 *
 * pi-subagents discovers user agents from ~/.pi/agent/agents/*.md, while
 * oh-my-pi-v2 ships its agent definitions inside this extension's private
 * agents/ directory. On extension load, we best-effort create symlinks for any
 * missing bundled agents without overwriting user-managed files.
 */

import { lstat, mkdir, readdir, readlink, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export async function ensureSubagentLinks(agentsDir: string): Promise<void> {
	const targetDir = join(homedir(), ".pi", "agent", "agents");

	try {
		await mkdir(targetDir, { recursive: true });
	} catch (error) {
		console.error("[oh-my-pi-v2] Failed to create subagent directory:", error);
		return;
	}

	let agentFiles: string[] = [];
	try {
		agentFiles = (await readdir(agentsDir)).filter((file) => file.endsWith(".md"));
	} catch (error) {
		console.error("[oh-my-pi-v2] Failed to read bundled agents:", error);
		return;
	}

	for (const file of agentFiles) {
		const sourcePath = join(agentsDir, file);
		const targetPath = join(targetDir, file);

		try {
			const stat = await lstat(targetPath);
			if (stat.isSymbolicLink()) {
				const existingTarget = await readlink(targetPath);
				const resolvedExisting = resolve(dirname(targetPath), existingTarget);
				if (resolvedExisting !== sourcePath) {
					console.warn(
						`[oh-my-pi-v2] Leaving existing custom subagent link untouched: ${targetPath} -> ${existingTarget}`,
					);
				}
			} else {
				console.warn(`[oh-my-pi-v2] Leaving existing custom subagent file untouched: ${targetPath}`);
			}
			continue;
		} catch (error) {
			const code = error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
			if (code !== "ENOENT") {
				console.error(`[oh-my-pi-v2] Failed to inspect subagent target ${targetPath}:`, error);
				continue;
			}
		}

		try {
			await symlink(sourcePath, targetPath);
		} catch (error) {
			console.error(`[oh-my-pi-v2] Failed to link bundled subagent ${file}:`, error);
		}
	}
}
