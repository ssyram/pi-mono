import { copySettings } from "./json-settings.ts";
import {
	MY_SETTINGS_ENTRY_TYPE,
	type Settings,
	type SettingsEntry,
	type SettingsOutcome,
	type SettingsSession,
} from "./protocol.ts";
import { reportSettingsError, settingsFailure } from "./settings-error.ts";

export interface SessionPatch {
	source: string;
	values?: Settings;
	removed?: string[];
}

function sessionAlive(session: SettingsSession): SettingsOutcome<true> {
	const current = session.isCurrent();
	if (!current.ok) return current;
	if (!current.value) return settingsFailure("SESSION_UNAVAILABLE", "my-settings session changed before logging");
	return { ok: true, value: true };
}

export function appendSessionSettings(session: SettingsSession, values: Settings): SettingsOutcome<void> {
	try {
		const alive = sessionAlive(session);
		if (!alive.ok) return alive;
		const copied = copySettings(values);
		if (!copied.ok) return copied;
		return session.appendEntry(MY_SETTINGS_ENTRY_TYPE, {
			values: copied.value,
		});
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}

export function appendSessionRemoval(session: SettingsSession, keys: readonly string[]): SettingsOutcome<void> {
	try {
		const alive = sessionAlive(session);
		if (!alive.ok) return alive;
		const removed = [...new Set(keys)];
		if (removed.length === 0) return { ok: true, value: undefined };
		return session.appendEntry(MY_SETTINGS_ENTRY_TYPE, { removed });
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}

/**
 * Read session-log patches from oldest to newest. A structurally corrupt
 * entry is diagnosed and skipped; only a whole-branch read failure is an Error.
 */
export function readSessionPatches(entries: readonly SettingsEntry[]): SettingsOutcome<SessionPatch[]> {
	try {
		const patches: SessionPatch[] = [];
		let index = 0;
		for (const entry of entries) {
			index++;
			if (entry.type !== "custom" || entry.customType !== MY_SETTINGS_ENTRY_TYPE) continue;
			const data = entry.data;
			if (!data || typeof data !== "object" || Array.isArray(data)) {
				reportSettingsError(`session log #${index}: 结构损坏；忽略该条补丁`);
				continue;
			}
			const record = data as { values?: unknown; removed?: unknown };
			const hasValues = "values" in record;
			const hasRemoved = "removed" in record;
			if (!hasValues && !hasRemoved) {
				reportSettingsError(`session log #${index}: 结构损坏；忽略该条补丁`);
				continue;
			}
			let values: Settings | undefined;
			if (hasValues) {
				const copied = copySettings(record.values);
				if (!copied.ok) {
					reportSettingsError(`session log #${index}: ${copied.error.message}；忽略该条补丁`);
					continue;
				}
				values = copied.value;
			}
			let removed: string[] | undefined;
			if (hasRemoved) {
				const list = record.removed;
				if (!Array.isArray(list) || list.some((key) => typeof key !== "string")) {
					reportSettingsError(`session log #${index}: removed 必须是字符串数组；忽略该条补丁`);
					continue;
				}
				removed = list;
			}
			patches.push({ source: `session log #${index}`, values, removed });
		}
		return { ok: true, value: patches };
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}
