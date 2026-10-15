import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { copySettings } from "./json-settings.ts";
import { MY_SETTINGS_DEFAULT_PATH, type Settings, type SettingsOutcome } from "./protocol.ts";
import { settingsFailure } from "./settings-error.ts";

export type SettingsMutationQueue = <T>(path: string, action: () => Promise<T>) => Promise<T>;

export function settingsFilePath(root: string, configured?: string | null): SettingsOutcome<string> {
	try {
		const name = configured ?? MY_SETTINGS_DEFAULT_PATH;
		if (typeof name !== "string" || !name.trim() || name.includes("\0") || isAbsolute(name)) {
			return settingsFailure("INVALID_REQUEST", "Settings paths must be non-empty relative file paths without NUL");
		}
		const path = resolve(root, name);
		const within = relative(resolve(root), path);
		if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
			return settingsFailure("INVALID_REQUEST", "Settings paths must stay within their global or project root");
		}
		return { ok: true, value: path };
	} catch (error) {
		return settingsFailure("INVALID_REQUEST", error);
	}
}

export async function readSettingsFile(path: string): Promise<SettingsOutcome<Settings>> {
	try {
		const text = await readFile(path, "utf8");
		const copied = copySettings(JSON.parse(text));
		return copied.ok ? copied : settingsFailure("OPERATION_FAILED", copied.error.message);
	} catch (error) {
		try {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return { ok: true, value: {} };
		} catch {}
		return settingsFailure("OPERATION_FAILED", error);
	}
}
