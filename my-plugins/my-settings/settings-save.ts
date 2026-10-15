import { join } from "node:path";
import type {
	Settings,
	SettingsOutcome,
	SettingsResult,
	SettingsSaveOperation,
	SettingsSession,
	SettingsUnsetOperation,
} from "./protocol.ts";
import { reportSettingsError } from "./settings-error.ts";
import { unsetKeysFromFile, writeSettingsFile } from "./settings-file-write.ts";
import { type SettingsMutationQueue, settingsFilePath } from "./settings-files.ts";
import { appendSessionRemoval, appendSessionSettings } from "./settings-session-log.ts";

interface SaveRequest {
	values: Settings;
	globalPath?: string | null;
	localPath?: string | null;
}

function filePathFor(
	op: SettingsSaveOperation,
	save: SaveRequest,
	session: SettingsSession,
	globalRoot: string,
): SettingsOutcome<string> | undefined {
	if (op === "save-session") return undefined;
	if (op === "save-global-only" || op === "save-global-and-session")
		return settingsFilePath(globalRoot, save.globalPath);
	return settingsFilePath(join(session.cwd, ".pi"), save.localPath);
}

async function saveFileOnly(path: string, save: SaveRequest, session: SettingsSession, queue: SettingsMutationQueue) {
	return writeSettingsFile(path, save.values, queue, session.isCurrent.bind(session));
}

export async function executeSettingsUnset(
	op: SettingsUnsetOperation,
	unset: {
		keys: string[];
		globalPath?: string | null;
		localPath?: string | null;
	},
	session: SettingsSession,
	globalRoot: string,
	queue: SettingsMutationQueue,
): Promise<SettingsResult> {
	if (op === "unset-session") {
		const removed = await Promise.resolve(appendSessionRemoval(session, unset.keys));
		return removed.ok ? { ok: true, values: {} } : removed;
	}
	const path =
		op === "unset-global-only"
			? settingsFilePath(globalRoot, unset.globalPath)
			: settingsFilePath(join(session.cwd, ".pi"), unset.localPath);
	if (!path.ok) return path;
	const removed = await unsetKeysFromFile(path.value, unset.keys, queue, session.isCurrent.bind(session));
	return removed.ok ? { ok: true, values: {} } : removed;
}

export async function executeSettingsSave(
	op: SettingsSaveOperation,
	save: SaveRequest,
	session: SettingsSession,
	globalRoot: string,
	queue: SettingsMutationQueue,
): Promise<SettingsResult> {
	const andSession = op === "save-global-and-session" || op === "save-local-and-session";
	const path = filePathFor(op, save, session, globalRoot);
	if (path && !path.ok) {
		if (!andSession) return path;
		reportSettingsError(path.error.message);
	} else if (path) {
		const written = await saveFileOnly(path.value, save, session, queue);
		if (!written.ok) {
			if (!andSession) return written;
			reportSettingsError(written.error.message);
		} else if (!andSession) {
			return { ok: true, values: save.values };
		}
	}
	const logged = appendSessionSettings(session, save.values);
	return logged.ok ? { ok: true, values: save.values } : logged;
}
