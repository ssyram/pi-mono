/**
 * Discover extensions from repos configured in extension-repos.json.
 *
 * Reads extension-repos.json from both ~/.pi/agent/ and ./.pi/.
 * Each repo entry has { name, path }. Scans each path (one level) for valid extensions.
 */

import type { Dirent } from "fs";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

export interface RepoConfig {
	name: string;
	path: string;
}

export interface DiscoveredExtension {
	repoName: string;
	repoPath: string;
	name: string;
	absolutePath: string;
}

export interface ScanProgress {
	phase: "loading-repos" | "scanning-repo" | "checking-entry" | "done";
	repoName: string | null;
	repoIndex: number;
	repoCount: number;
	entryName: string | null;
	entryIndex: number;
	entryCount: number;
}

const REPOS_FILE = "extension-repos.json";

export function discoverExtensions(
	cwd: string,
	globalDir: string,
	onProgress?: (progress: ScanProgress) => void,
): DiscoveredExtension[] {
	onProgress?.({
		phase: "loading-repos",
		repoName: null,
		repoIndex: 0,
		repoCount: 0,
		entryName: null,
		entryIndex: 0,
		entryCount: 0,
	});

	const repos = loadRepos(join(cwd, ".pi", REPOS_FILE), join(globalDir, REPOS_FILE));
	const results: DiscoveredExtension[] = [];

	for (const [repoOffset, repo] of repos.entries()) {
		const repoIndex = repoOffset + 1;
		const repoPath = resolve(repo.path);
		onProgress?.({
			phase: "scanning-repo",
			repoName: repo.name,
			repoIndex,
			repoCount: repos.length,
			entryName: null,
			entryIndex: 0,
			entryCount: 0,
		});
		if (!existsSync(repoPath)) continue;

		let entries: Dirent[];
		try {
			entries = readdirSync(repoPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const [entryOffset, entry] of entries.entries()) {
			const entryIndex = entryOffset + 1;
			onProgress?.({
				phase: "checking-entry",
				repoName: repo.name,
				repoIndex,
				repoCount: repos.length,
				entryName: entry.name,
				entryIndex,
				entryCount: entries.length,
			});
			if (entry.name.startsWith(".")) continue;
			const fullPath = join(repoPath, entry.name);

			// Resolve symlinks before type checks so symlinked extensions are not silently ignored
			let isFile = entry.isFile();
			let isDirectory = entry.isDirectory();
			if (entry.isSymbolicLink()) {
				try {
					const stat = statSync(fullPath);
					isFile = stat.isFile();
					isDirectory = stat.isDirectory();
				} catch {
					// dangling symlink — skip
					continue;
				}
			}

			if (isFile && /\.[tj]s$/.test(entry.name)) {
				results.push({ repoName: repo.name, repoPath: repoPath, name: entry.name, absolutePath: fullPath });
			} else if (isDirectory && isExtensionDir(fullPath)) {
				results.push({ repoName: repo.name, repoPath: repoPath, name: entry.name, absolutePath: fullPath });
			}
		}
	}

	onProgress?.({
		phase: "done",
		repoName: null,
		repoIndex: repos.length,
		repoCount: repos.length,
		entryName: null,
		entryIndex: 0,
		entryCount: 0,
	});

	return results.sort((a, b) => a.repoName.localeCompare(b.repoName) || a.name.localeCompare(b.name));
}

export function findNameConflicts(extensions: DiscoveredExtension[]): Map<string, DiscoveredExtension[]> {
	const byName = new Map<string, DiscoveredExtension[]>();
	for (const extension of extensions) {
		const existing = byName.get(extension.name);
		if (existing) existing.push(extension);
		else byName.set(extension.name, [extension]);
	}

	for (const [name, items] of byName) {
		if (items.length < 2) byName.delete(name);
	}

	return byName;
}

function loadRepos(...paths: string[]): RepoConfig[] {
	const seen = new Set<string>();
	const repos: RepoConfig[] = [];

	for (const p of paths) {
		if (!existsSync(p)) continue;
		try {
			const raw = JSON.parse(readFileSync(p, "utf-8"));
			if (!Array.isArray(raw)) continue;
			for (const entry of raw) {
				if (typeof entry?.name !== "string" || typeof entry?.path !== "string") continue;
				const key = resolve(entry.path);
				if (seen.has(key)) continue;
				seen.add(key);
				repos.push({ name: entry.name, path: key });
			}
		} catch {
			// Malformed config — skip
		}
	}

	return repos;
}

function isExtensionDir(dirPath: string): boolean {
	if (existsSync(join(dirPath, "index.ts")) || existsSync(join(dirPath, "index.js"))) return true;

	const pkgPath = join(dirPath, "package.json");
	if (!existsSync(pkgPath)) return false;
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		return !!pkg.pi?.extensions;
	} catch {
		return false;
	}
}
