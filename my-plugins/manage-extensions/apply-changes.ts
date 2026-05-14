/**
 * Apply symlink changes: create or remove symlinks in project/global extensions dirs.
 * Refuses to remove non-symlink files.
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "fs";
import { join, relative, resolve } from "path";
import type { DiscoveredExtension } from "./discover-extensions.js";

export interface ChangeEntry {
	extension: DiscoveredExtension;
	local: { from: boolean; to: boolean };
	global: { from: boolean; to: boolean };
}

export interface ApplyResult {
	applied: string[];
	warnings: string[];
}

export interface PreflightIssue {
	extensionName: string;
	scope: "local" | "global";
	severity: "warning" | "error";
	message: string;
}

export function preflightChanges(
	changes: ChangeEntry[],
	projectExtDir: string,
	globalExtDir: string,
): PreflightIssue[] {
	const issues: PreflightIssue[] = [];
	for (const { extension, local, global } of changes) {
		collectPreflightIssues(extension, local, projectExtDir, "local", issues);
		collectPreflightIssues(extension, global, globalExtDir, "global", issues);
	}
	return issues;
}

export function applyChanges(
	changes: ChangeEntry[],
	projectExtDir: string,
	globalExtDir: string,
): ApplyResult {
	const applied: string[] = [];
	const warnings: string[] = [];

	for (const { extension, local, global } of changes) {
		applyOne(extension, local, projectExtDir, "local", applied, warnings);
		applyOne(extension, global, globalExtDir, "global", applied, warnings);
	}

	return { applied, warnings };
}

function collectPreflightIssues(
	ext: DiscoveredExtension,
	change: { from: boolean; to: boolean },
	dir: string,
	scope: "local" | "global",
	issues: PreflightIssue[],
): void {
	if (change.from === change.to) return;
	const linkPath = join(dir, ext.name);

	if (!change.from && change.to) {
		if (!existsSync(linkPath)) return;
		try {
			const stat = lstatSync(linkPath);
			if (!stat.isSymbolicLink()) {
				issues.push({
					extensionName: ext.name,
					scope,
					severity: "error",
					message: `${scope}: target path already exists and is not a symlink (${linkPath})`,
				});
				return;
			}
			const currentTarget = resolve(dir, readlinkSync(linkPath));
			if (currentTarget !== ext.absolutePath) {
				issues.push({
					extensionName: ext.name,
					scope,
					severity: "error",
					message: `${scope}: target path already points to a different extension (${currentTarget})`,
				});
			}
		} catch (error) {
			issues.push({
				extensionName: ext.name,
				scope,
				severity: "warning",
				message: `${scope}: unable to inspect existing target (${error})`,
			});
		}
		return;
	}

	if (change.from && !change.to && existsSync(linkPath)) {
		try {
			const stat = lstatSync(linkPath);
			if (!stat.isSymbolicLink()) {
				issues.push({
					extensionName: ext.name,
					scope,
					severity: "error",
					message: `${scope}: target path is not a symlink and cannot be removed safely (${linkPath})`,
				});
				return;
			}
			const currentTarget = resolve(dir, readlinkSync(linkPath));
			if (currentTarget !== ext.absolutePath) {
				issues.push({
					extensionName: ext.name,
					scope,
					severity: "error",
					message: `${scope}: existing symlink points elsewhere and will not be removed (${currentTarget})`,
				});
			}
		} catch (error) {
			issues.push({
				extensionName: ext.name,
				scope,
				severity: "warning",
				message: `${scope}: unable to inspect existing target (${error})`,
			});
		}
	}
}

function applyOne(
	ext: DiscoveredExtension,
	change: { from: boolean; to: boolean },
	dir: string,
	scope: string,
	applied: string[],
	warnings: string[],
): void {
	if (change.from === change.to) return;
	const linkPath = join(dir, ext.name);

	if (change.from && !change.to) {
		try {
			if (!existsSync(linkPath)) return;
			const stat = lstatSync(linkPath);
			if (!stat.isSymbolicLink()) {
				warnings.push(`${ext.name}: "${linkPath}" is not a symlink — refusing to remove`);
				return;
			}
			const currentTarget = resolve(dir, readlinkSync(linkPath));
			if (currentTarget !== ext.absolutePath) {
				warnings.push(
					`${ext.name}: "${linkPath}" points to a different extension (${currentTarget}) — refusing to remove`,
				);
				return;
			}
			unlinkSync(linkPath);
			applied.push(`${ext.name}: ${scope} OFF`);
		} catch (err) {
			warnings.push(`${ext.name}: failed to remove — ${err}`);
		}
	} else if (!change.from && change.to) {
		try {
			mkdirSync(dir, { recursive: true });
			if (!existsSync(ext.absolutePath)) {
				warnings.push(`${ext.name}: source path no longer exists — skipping symlink creation`);
				return;
			}
			symlinkSync(relative(dir, ext.absolutePath), linkPath);
			applied.push(`${ext.name}: ${scope} ON`);
		} catch (err) {
			warnings.push(`${ext.name}: failed to create symlink — ${err}`);
		}
	}
}
