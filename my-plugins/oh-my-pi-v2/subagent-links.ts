import { lstat, mkdir, readFile, readlink, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { dirname, join, relative, resolve } from "node:path";

const FRONTMATTER_SEPARATOR = "---\n";
const OUTPUT_PATH_PREFIX = ".pi/subagent-outputs/";

export async function ensureSubagentIntegration(extensionDir: string, agentsDir: string, cwd: string): Promise<void> {
	const targetAgentsDir = await resolveTargetAgentsDir(extensionDir, cwd);
	const managedEntries = await ensureSubagentLinks(agentsDir, targetAgentsDir);
	await ensureSubagentOutputConfig(targetAgentsDir, managedEntries);
}

async function resolveTargetAgentsDir(extensionDir: string, cwd: string): Promise<string> {
	const extensionRoot = resolve(extensionDir);
	const localExtensionRoot = resolve(cwd, ".pi", "extensions");
	const globalExtensionRoot = resolve(getAgentDir(), "extensions");

	if (await isPathUnder(extensionRoot, localExtensionRoot)) return resolve(cwd, ".pi", "agents");
	if (await isPathUnder(extensionRoot, globalExtensionRoot)) return resolve(getAgentDir(), "agents");
	if (await isSymlinkedExtension(localExtensionRoot, extensionRoot)) return resolve(cwd, ".pi", "agents");
	if (await isSymlinkedExtension(globalExtensionRoot, extensionRoot)) return resolve(getAgentDir(), "agents");

	return resolve(getAgentDir(), "agents");
}

async function isPathUnder(pathValue: string, root: string): Promise<boolean> {
	const relativePath = relative(root, pathValue);
	return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

async function isSymlinkedExtension(extensionsDir: string, extensionRoot: string): Promise<boolean> {
	try {
		const entries = await readdir(extensionsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isSymbolicLink()) continue;
			const linkPath = join(extensionsDir, entry.name);
			const targetPath = resolve(dirname(linkPath), await readlink(linkPath));
			if (targetPath === extensionRoot) return true;
		}
	} catch {
		return false;
	}
	return false;
}

async function ensureSubagentLinks(agentsDir: string, targetDir: string): Promise<string[]> {
	try {
		await replaceSelfSymlinkedDir(targetDir, agentsDir);
		await mkdir(targetDir, { recursive: true });
	} catch (error) {
		console.warn(`[oh-my-pi-v2] Failed to create subagent agents directory: ${String(error)}`);
		return [];
	}

	let entries: string[];
	try {
		entries = (await readdir(agentsDir)).filter((entry) => entry.endsWith(".md"));
	} catch (error) {
		console.warn(`[oh-my-pi-v2] Failed to read bundled agents: ${String(error)}`);
		return [];
	}

	const managedEntries: string[] = [];
	for (const entry of entries) {
		if (await ensureSubagentFile(agentsDir, targetDir, entry)) managedEntries.push(entry);
	}
	return managedEntries;
}

async function replaceSelfSymlinkedDir(targetDir: string, agentsDir: string): Promise<void> {
	const existing = await lstat(targetDir).catch(() => undefined);
	if (!existing?.isSymbolicLink()) return;
	const existingTarget = resolve(dirname(targetDir), await readlink(targetDir));
	if (existingTarget === agentsDir) await rm(targetDir);
}

async function ensureSubagentFile(agentsDir: string, targetDir: string, entry: string): Promise<boolean> {
	const sourcePath = join(agentsDir, entry);
	const targetPath = join(targetDir, entry);
	try {
		const sourceContent = await readFile(sourcePath, "utf8");
		const existing = await lstat(targetPath).catch(() => undefined);
		if (!existing) {
			await writeFile(targetPath, sourceContent, "utf8");
			return true;
		}
		if (existing.isSymbolicLink()) return await replaceSelfSymlinkedFile(targetPath, sourcePath, sourceContent);
		const targetContent = await readFile(targetPath, "utf8").catch(() => undefined);
		return targetContent === sourceContent || hasManagedOutput(targetContent, entry);
	} catch (error) {
		console.warn(`[oh-my-pi-v2] Failed to prepare subagent ${entry}: ${String(error)}`);
		return false;
	}
}

async function replaceSelfSymlinkedFile(targetPath: string, sourcePath: string, sourceContent: string): Promise<boolean> {
	const existingTarget = resolve(dirname(targetPath), await readlink(targetPath));
	if (!(await pathsReferToSameFile(existingTarget, sourcePath))) return false;
	await rm(targetPath);
	await writeFile(targetPath, sourceContent, "utf8");
	return true;
}

async function pathsReferToSameFile(left: string, right: string): Promise<boolean> {
	if (left === right) return true;
	try {
		return (await realpath(left)) === (await realpath(right));
	} catch {
		return false;
	}
}

async function ensureSubagentOutputConfig(targetDir: string, entries: string[]): Promise<void> {
	for (const entry of entries) {
		const agentPath = join(targetDir, entry);
		try {
			const content = await readFile(agentPath, "utf8");
			const updated = withOutputFrontmatter(content, entry);
			if (updated !== content) await writeFile(agentPath, updated, "utf8");
		} catch (error) {
			console.warn(`[oh-my-pi-v2] Failed to configure subagent output for ${entry}: ${String(error)}`);
		}
	}
}

function withOutputFrontmatter(content: string, entry: string): string {
	if (!content.startsWith(FRONTMATTER_SEPARATOR)) return content;
	const end = content.indexOf(`\n${FRONTMATTER_SEPARATOR}`, FRONTMATTER_SEPARATOR.length);
	if (end === -1) return content;
	const frontmatter = content.slice(FRONTMATTER_SEPARATOR.length, end);
	if (/^output\s*:/m.test(frontmatter)) return content;
	const body = content.slice(end);
	return `${FRONTMATTER_SEPARATOR}${frontmatter}${frontmatter.endsWith("\n") ? "" : "\n"}output: ${OUTPUT_PATH_PREFIX}${entry}\n${body}`;
}

function hasManagedOutput(content: string | undefined, entry: string): boolean {
	if (!content) return false;
	const escapedEntry = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^output\\s*:\\s*${OUTPUT_PATH_PREFIX}${escapedEntry}$`, "m").test(content);
}
