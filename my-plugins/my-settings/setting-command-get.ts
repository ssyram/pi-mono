import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createMySettingsClient } from "./client.ts";
import type { Settings, SettingsEntry, SettingsEventBus, SettingValue } from "./protocol.ts";
import type { CommandPaths } from "./setting-command-parse.ts";
import { readSettingsFile, settingsFilePath } from "./settings-files.ts";
import { readSessionPatches } from "./settings-session-log.ts";

export interface SettingCommandSession {
	session: object;
	sessionId: string;
}

function describeValue(value: unknown): string {
	return value === undefined ? "-" : (JSON.stringify(value) ?? "null");
}

function readBranch(
	context: ExtensionCommandContext,
): { ok: true; value: SettingsEntry[] } | { ok: false; message: string } {
	try {
		const manager = (context as unknown as { sessionManager?: { getBranch?: () => unknown } }).sessionManager;
		const branch = manager?.getBranch?.();
		if (Array.isArray(branch)) return { ok: true, value: branch as SettingsEntry[] };
		return { ok: false, message: "无法读取当前分支" };
	} catch (error) {
		return {
			ok: false,
			message: `无法读取当前分支：${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export async function runSettingGet(
	bus: SettingsEventBus,
	identity: SettingCommandSession,
	context: ExtensionCommandContext,
	paths: CommandPaths,
	keys: string[],
): Promise<string[]> {
	const client = createMySettingsClient(bus, identity);
	const globalPath = settingsFilePath(getAgentDir(), paths.globalFile);
	const localPath = settingsFilePath(join(context.cwd, ".pi"), paths.localFile);
	const branch = readBranch(context);
	const lines: string[] = [];
	for (const key of keys) {
		lines.push(`key ${key}`);
		let globalValue: SettingValue | undefined;
		let localValue: SettingValue | undefined;
		let sessionValue: SettingValue | undefined;
		let sessionRemoved = false;
		if (globalPath.ok) {
			const read = await readSettingsFile(globalPath.value);
			if (read.ok) globalValue = read.value[key];
		}
		if (localPath.ok) {
			const read = await readSettingsFile(localPath.value);
			if (read.ok) localValue = read.value[key];
		}
		if (branch.ok) {
			const patches = readSessionPatches(branch.value);
			if (patches.ok) {
				for (const patch of patches.value) {
					if (patch.values && key in patch.values) {
						sessionValue = patch.values[key];
						sessionRemoved = false;
					}
					if (patch.removed?.includes(key)) {
						sessionRemoved = true;
						sessionValue = undefined;
					}
				}
			}
		}
		lines.push(`  global  ${describeValue(globalValue)}`);
		lines.push(`  local   ${describeValue(localValue)}`);
		lines.push(`  session ${sessionRemoved ? "(unset)" : describeValue(sessionValue)}`);
		const fallback: Settings = {
			[key]: globalValue ?? localValue ?? sessionValue ?? null,
		};
		const merged = await client.query({
			defaults: fallback,
			globalPath: paths.globalFile,
			localPath: paths.localFile,
		});
		lines.push(
			merged.ok
				? `  merged  ${describeValue(merged.values[key])}`
				: `  merged  FAILED  ${merged.error.code}: ${merged.error.message}`,
		);
	}
	return lines;
}
