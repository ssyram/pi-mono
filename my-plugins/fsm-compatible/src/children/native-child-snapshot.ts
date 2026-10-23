import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { BINDING_CUSTOM_TYPE } from "../binding/actor-binding.ts";
import { readPersistedBinding } from "../binding/read-persisted-binding.ts";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { NATIVE_THINKING_LEVELS, type NativeChildRecord } from "./native-child-record.ts";

export const NATIVE_CHILD_ENTRY = "fsm-compatible:native-child";

export function nativeChildSnapshot(row: NativeChildRecord): Record<string, unknown> {
	return { binding: row.binding, cwd: row.cwd, directory: row.directory, sessionFile: row.sessionFile,
		bundle: row.bundle, configFile: row.configFile, model: row.model, thinking: row.thinking, depth: row.depth, name: row.name,
		outcome: row.outcome, summary: row.summary };
}

export function savedNativeChildren(entries: readonly SessionEntry[], rootId: string, stateDirectory: string): Omit<NativeChildRecord, "token">[] {
	const saved = new Map<string, Omit<NativeChildRecord, "token">>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== NATIVE_CHILD_ENTRY) continue;
		const data = entry.data;
		if (!isAdmissionObject(data) || !isAdmissionObject(data.binding) || typeof data.binding.sessionId !== "string") throw new Error("invalid saved child");
		const binding = readPersistedBinding([{ type: "custom", customType: BINDING_CUSTOM_TYPE, data: data.binding }], data.binding.sessionId);
		if (!binding.ok || !binding.value || binding.value.kind !== "execution-child" || binding.value.rootSessionId !== rootId) throw new Error("invalid saved child identity");
		const directory = join(stateDirectory, binding.value.sessionId);
		if (data.directory !== directory || data.sessionFile !== join(directory, "session.jsonl")
			|| data.bundle !== join(directory, "extensions.ts") || data.configFile !== join(directory, "config.json")
			|| typeof data.cwd !== "string" || typeof data.model !== "string" || typeof data.thinking !== "string" || !NATIVE_THINKING_LEVELS.includes(data.thinking) || typeof data.depth !== "number"
			|| !Number.isSafeInteger(data.depth) || data.depth < 1) throw new Error("invalid saved child paths");
		saved.set(binding.value.sessionId, { binding: binding.value, cwd: data.cwd, directory,
			sessionFile: data.sessionFile, bundle: data.bundle, configFile: data.configFile, model: data.model, thinking: data.thinking, depth: data.depth,
			name: typeof data.name === "string" ? data.name : null, outcome: typeof data.outcome === "string" ? data.outcome : "interrupted",
			summary: typeof data.summary === "string" ? data.summary : "", extraArgs: [], tmuxSession: `fsm-${binding.value.sessionId}`,
			startController: undefined, startupError: false, lifecycle: "unavailable", runActive: false, ready: undefined });
	}
	return [...saved.values()];
}
