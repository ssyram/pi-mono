import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { JudgeModelSource } from "../judge/judge-session.ts";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import type { RequiredExtensionInput } from "../admission/admission-policy.ts";

export interface FsmCompatibleConfig {
	readonly dataDir: string;
	readonly clientCommand: string;
	readonly clientArgs: readonly string[];
	readonly cwd: string;
	readonly capacity: number;
	readonly timeoutMs: number;
	readonly modelSource: JudgeModelSource;
	readonly allowedAgentNames?: readonly string[];
	readonly maxDepth?: number;
	/** HC subagent_depth: tool visibility + create depth limit; default 3. Independent of the FSM admission maxDepth. */
	readonly subagentDepth?: number;
	readonly requiredExtensions?: readonly RequiredExtensionInput[];
	readonly fleetWidgetPlacement?: "aboveEditor" | "belowEditor" | "off";
	readonly stopAnalysis?: boolean;
	readonly stopJudgeModel?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly scope?: string;
	readonly daemonRequester?: (dataDir: string) => DaemonRequester;
}

function isConfig(value: unknown): value is FsmCompatibleConfig {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (typeof record.dataDir !== "string" || typeof record.clientCommand !== "string"
		|| !Array.isArray(record.clientArgs) || !(record.cwd === undefined || typeof record.cwd === "string")
		|| typeof record.capacity !== "number" || !Number.isSafeInteger(record.capacity) || record.capacity < 1
		|| typeof record.timeoutMs !== "number" || !Number.isSafeInteger(record.timeoutMs) || record.timeoutMs < 1000
		|| !record.modelSource || typeof record.modelSource !== "object") return false;
	return (record.scope === undefined || typeof record.scope === "string")
		&& (record.subagentDepth === undefined || (typeof record.subagentDepth === "number" && Number.isSafeInteger(record.subagentDepth) && record.subagentDepth >= 1))
		&& (record.fleetWidgetPlacement === undefined || ["aboveEditor", "belowEditor", "off"].includes(record.fleetWidgetPlacement as string));
}

export async function loadConfig(path?: string): Promise<FsmCompatibleConfig> {
	const file = path ?? process.env.FSM_COMPATIBLE_CONFIG ?? join(fileURLToPath(new URL("../../fsm-compatible.config.json", import.meta.url)));
	const raw = await readFile(file, "utf8");
	const parsed = JSON.parse(raw) as FsmCompatibleConfig;
	if (!isConfig(parsed)) throw new Error(`invalid fsm-compatible config at ${file}`);
	// FSM_DATA_DIR env var overrides the config's dataDir (harness isolation seam).
	const envDir = process.env.FSM_DATA_DIR;
	// FSM_COMPATIBLE_CLIENT env var overrides the config's clientCommand (CCV runtime client).
	const envClient = process.env.FSM_COMPATIBLE_CLIENT;
	// cwd defaults to the host process cwd — FSM hard gates run in the identity cwd,
	// which must be the agent's real working directory (the workspace).
	return Object.freeze({ ...parsed, cwd: parsed.cwd ?? process.cwd(), dataDir: envDir ?? parsed.dataDir,
		...(envClient ? { clientCommand: envClient, clientArgs: [] } : {}) });
}
