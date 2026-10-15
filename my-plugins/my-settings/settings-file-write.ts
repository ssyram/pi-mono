import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { copySettings } from "./json-settings.ts";
import { MY_SETTINGS_DEFAULT_PATH, type Settings, type SettingsOutcome } from "./protocol.ts";
import { reportSettingsError, settingsFailure } from "./settings-error.ts";
import { readSettingsFile, type SettingsMutationQueue } from "./settings-files.ts";

function isCurrentNow(isCurrent: () => SettingsOutcome<boolean>): SettingsOutcome<true> {
	const current = isCurrent();
	if (!current.ok) return current;
	if (!current.value) return settingsFailure("SESSION_UNAVAILABLE", "Settings session changed before saving");
	return { ok: true, value: true };
}

async function commitText(
	target: string,
	text: string,
	isCurrent: () => SettingsOutcome<boolean>,
): Promise<SettingsOutcome<void>> {
	const temporary = join(dirname(target), `.${MY_SETTINGS_DEFAULT_PATH}.${randomUUID()}.tmp`);
	let committed = false;
	try {
		await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
		const latest = isCurrentNow(isCurrent);
		if (!latest.ok) return latest;
		await rename(temporary, target);
		committed = true;
		return { ok: true, value: undefined };
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	} finally {
		if (!committed) {
			try {
				await unlink(temporary);
			} catch (error) {
				reportSettingsError(error);
			}
		}
	}
}

async function canonicalTarget(path: string): Promise<SettingsOutcome<string>> {
	try {
		await mkdir(dirname(path), { recursive: true });
		return {
			ok: true,
			value: join(await realpath(dirname(path)), basename(path)),
		};
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}

export async function writeSettingsFile(
	path: string,
	values: Settings,
	queue: SettingsMutationQueue,
	isCurrent: () => SettingsOutcome<boolean>,
): Promise<SettingsOutcome<void>> {
	try {
		const patch = copySettings(values);
		if (!patch.ok) return patch;
		const target = await canonicalTarget(path);
		if (!target.ok) return target;
		return await queue(target.value, async (): Promise<SettingsOutcome<void>> => {
			try {
				const current = isCurrentNow(isCurrent);
				if (!current.ok) return current;
				const existing = await readSettingsFile(target.value);
				if (!existing.ok) return existing;
				const text = `${JSON.stringify({ ...existing.value, ...patch.value }, null, "\t")}\n`;
				return await commitText(target.value, text, isCurrent);
			} catch (error) {
				return settingsFailure("OPERATION_FAILED", error);
			}
		});
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}

export async function unsetKeysFromFile(
	path: string,
	keys: readonly string[],
	queue: SettingsMutationQueue,
	isCurrent: () => SettingsOutcome<boolean>,
): Promise<SettingsOutcome<void>> {
	try {
		if (keys.length === 0) return { ok: true, value: undefined };
		const target = await canonicalTarget(path);
		if (!target.ok) return target;
		return await queue(target.value, async (): Promise<SettingsOutcome<void>> => {
			try {
				const current = isCurrentNow(isCurrent);
				if (!current.ok) return current;
				let text: string;
				try {
					text = await readFile(target.value, "utf8");
				} catch (error) {
					if (error instanceof Error && "code" in error && error.code === "ENOENT") {
						return { ok: true, value: undefined };
					}
					return settingsFailure("OPERATION_FAILED", error);
				}
				const parsed = copySettings(JSON.parse(text));
				if (!parsed.ok) return settingsFailure("OPERATION_FAILED", parsed.error.message);
				const updated: Settings = { ...parsed.value };
				for (const key of keys) delete updated[key];
				return await commitText(target.value, `${JSON.stringify(updated, null, "\t")}\n`, isCurrent);
			} catch (error) {
				return settingsFailure("OPERATION_FAILED", error);
			}
		});
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}
