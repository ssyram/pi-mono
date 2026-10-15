import { join } from "node:path";
import { copySettings } from "./json-settings.ts";
import type { Settings, SettingsQuery, SettingsResult, SettingsSession } from "./protocol.ts";
import { reportSettingsError, settingsFailure } from "./settings-error.ts";
import { readSettingsFile, settingsFilePath } from "./settings-files.ts";
import { pickValidFields } from "./settings-kind.ts";
import { readSessionPatches } from "./settings-session-log.ts";

async function loadFile(path: string, defaults: Settings): Promise<Settings> {
	const raw = await readSettingsFile(path);
	if (!raw.ok) {
		reportSettingsError(`${path}: ${raw.error.message}；忽略该来源`);
		return {};
	}
	const valid = pickValidFields(path, defaults, raw.value);
	return valid.ok ? valid.value : {};
}

export async function executeSettingsQuery(
	query: SettingsQuery,
	session: SettingsSession,
	globalRoot: string,
): Promise<SettingsResult> {
	const { defaults, globalPath, localPath, scope = "session" } = query;
	const globalFile = settingsFilePath(globalRoot, globalPath);
	if (!globalFile.ok) return globalFile;
	const localFile = scope === "global" ? undefined : settingsFilePath(join(session.cwd, ".pi"), localPath);
	if (localFile && !localFile.ok) return localFile;

	const validated = copySettings(defaults);
	if (!validated.ok) return validated;

	const current = session.isCurrent();
	if (!current.ok) return current;
	if (!current.value) return settingsFailure("SESSION_UNAVAILABLE", "my-settings session is no longer active");

	const [global, local] = await Promise.all([
		loadFile(globalFile.value, validated.value),
		localFile ? loadFile(localFile.value, validated.value) : Promise.resolve({} as Settings),
	]);

	const latest = session.isCurrent();
	if (!latest.ok) return latest;
	if (!latest.value) return settingsFailure("SESSION_UNAVAILABLE", "my-settings session changed while querying");

	let overlay: Settings = {};
	if (scope === "session") {
		const branch = session.getBranch();
		if (!branch.ok) {
			reportSettingsError(branch.error.message);
		} else {
			const patches = readSessionPatches(branch.value);
			if (!patches.ok) {
				reportSettingsError(patches.error.message);
			} else {
				for (const patch of patches.value) {
					if (patch.values) {
						const valid = pickValidFields(patch.source, validated.value, patch.values);
						if (valid.ok) overlay = { ...overlay, ...valid.value };
					}
					for (const key of patch.removed ?? []) delete overlay[key];
				}
			}
		}
	}

	const merged = { ...validated.value, ...global, ...local, ...overlay };
	const picked = Object.fromEntries(Object.keys(validated.value).map((key) => [key, merged[key]]));
	const detached = copySettings(picked);
	return detached.ok ? { ok: true, values: detached.value } : detached;
}
