import { copySettings } from "./json-settings.ts";
import type { Settings, SettingsOutcome, SettingValue } from "./protocol.ts";
import { reportSettingsError, settingsFailure } from "./settings-error.ts";

type ValueKind = "null" | "boolean" | "number" | "string" | "array" | "object";

function kindOf(value: SettingValue): ValueKind {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "object") return "object";
	return typeof value as "boolean" | "number" | "string";
}

/**
 * Pick the requested keys whose value kind matches the default's kind.
 * Kind mismatches are diagnosed and dropped for this source only;
 * other keys and lower-priority sources keep their contributions.
 */
export function pickValidFields(source: string, defaults: Settings, raw: Settings): SettingsOutcome<Settings> {
	try {
		const picked: Settings = {};
		for (const key of Object.keys(defaults)) {
			if (!(key in raw)) continue;
			const expected = kindOf(defaults[key]);
			const actualRaw: unknown = raw[key];
			const actual = kindOf(actualRaw as SettingValue);
			if (actual !== expected) {
				reportSettingsError(`${source}: ${key} 期望 ${expected}，实际 ${actual}；忽略该来源的该值`);
				continue;
			}
			picked[key] = actualRaw as SettingValue;
		}
		return copySettings(picked);
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}
