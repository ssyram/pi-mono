/**
 * Resolve current activation state: check if each extension
 * is symlinked into project (.pi/extensions/) or global (~/.pi/agent/extensions/).
 */

import { existsSync, lstatSync, readlinkSync } from "fs";
import { join, resolve } from "path";
import type { DiscoveredExtension } from "./discover-extensions.js";

export interface ExtensionState {
	extension: DiscoveredExtension;
	local: boolean;
	global: boolean;
}

export function resolveStates(
	extensions: DiscoveredExtension[],
	projectExtDir: string,
	globalExtDir: string,
): ExtensionState[] {
	return extensions.map((ext) => ({
		extension: ext,
		local: isSymlinkedIn(ext, projectExtDir),
		global: isSymlinkedIn(ext, globalExtDir),
	}));
}

function isSymlinkedIn(ext: DiscoveredExtension, targetDir: string): boolean {
	const linkPath = join(targetDir, ext.name);
	if (!existsSync(linkPath)) return false;
	try {
		const stat = lstatSync(linkPath);
		if (!stat.isSymbolicLink()) return false;
		return resolve(targetDir, readlinkSync(linkPath)) === ext.absolutePath;
	} catch {
		return false;
	}
}
