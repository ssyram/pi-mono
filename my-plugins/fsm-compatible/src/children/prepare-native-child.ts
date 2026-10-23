import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AdmissionPolicy, RequiredExtensionInput } from "../admission/admission-policy.ts";
import { admitChildLaunch } from "../admission/admit-child-launch.ts";
import type { PersistedBinding } from "../binding/actor-binding.ts";
import { createChildBinding } from "../binding/create-child-binding.ts";
import { parentDepth } from "../binding/parent-chain.ts";
import type { FsmCompatibleConfig } from "../runtime/runtime-config.ts";
import { NATIVE_THINKING_LEVELS, type NativeChildRecord } from "./native-child-record.ts";
import type { NativeChildRegistry } from "./native-child-registry.ts";
import { writeChildExtensionBundle } from "./native-child-bootstrap.ts";
import { tmuxSessionName } from "./tmux-session.ts";
import { ensureChildMetadata } from "./child-inbox.ts";

export async function prepareNativeChild(options: { caller: PersistedBinding; input: Record<string, unknown>;
	model: string; thinking: string; config: FsmCompatibleConfig; policy: AdmissionPolicy; registry: NativeChildRegistry;
	extensions: readonly RequiredExtensionInput[]; stateDirectory: string }): Promise<NativeChildRecord> {
	const { caller, input, policy, registry, config } = options;
	if (!NATIVE_THINKING_LEVELS.includes(options.thinking)) throw new Error("invalid native thinking level");
	if (Object.keys(input).some((key) => !["description", "prompt", "subagent_type", "cwd", "name", "extraArgs"].includes(key))
		|| typeof input.prompt !== "string" || !input.prompt || typeof input.description !== "string"
		|| (input.cwd !== undefined && typeof input.cwd !== "string")
		|| (input.name !== undefined && (typeof input.name !== "string" || !input.name || input.name.startsWith("ses")))) throw new Error("invalid native Agent parameters");
	const extraArgs = sanitizeExtraArgs(input.extraArgs);
	const admitted = admitChildLaunch(policy, { rootSessionId: caller.rootSessionId, sessionId: caller.sessionId },
		{ agentName: input.subagent_type, executionMode: "async" }, registry, { availableToolNames: [], requiredToolNames: [] });
	if (!admitted.ok) throw new Error(`native Agent rejected: ${admitted.code}`);
	const depth = parentDepth(caller.rootSessionId, caller.sessionId, registry);
	if (!depth.ok) throw new Error("invalid native caller ancestry");
	const id = `ses_${randomBytes(12).toString("hex")}`;
	const binding = createChildBinding(caller.rootSessionId, id, admitted.value.agentName, policy, caller.sessionId);
	const parentCwd = registry.rows.get(caller.sessionId)?.cwd ?? config.cwd;
	const cwd = typeof input.cwd === "string" ? resolve(parentCwd, input.cwd) : await mkdtemp(join(tmpdir(), "fsm-agent-work-"));
	const directory = join(options.stateDirectory, id);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const bundle = join(directory, "extensions.ts");
	await writeChildExtensionBundle(bundle, options.extensions);
	const configFile = join(directory, "config.json");
	await writeFile(configFile, JSON.stringify({ dataDir: config.dataDir, clientCommand: config.clientCommand,
		clientArgs: config.clientArgs, cwd, capacity: config.capacity, timeoutMs: config.timeoutMs, modelSource: {},
		allowedAgentNames: policy.agents.map((agent) => agent.canonicalName), maxDepth: policy.maxDepth,
		requiredExtensions: policy.requiredExtensions.map(({ id, path }) => ({ id, path })) }), { mode: 0o600 });
	const sessionFile = join(directory, "session.jsonl");
	await ensureChildMetadata(directory, { sessionId: id, parentSessionId: caller.sessionId, rootSessionId: caller.rootSessionId,
		tmuxSession: tmuxSessionName(id), cwd, model: options.model, thinking: options.thinking, launchArgs: [], extraArgs,
		state: "starting", hasStarted: false, outcome: null, summary: "" });
	await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id, cwd, timestamp: new Date().toISOString() })}\n`, { mode: 0o600 });
	return { binding, token: randomBytes(32).toString("hex"), cwd, directory, sessionFile, bundle, configFile,
		model: options.model, thinking: options.thinking, name: typeof input.name === "string" ? input.name : null, depth: depth.value + 1, extraArgs, tmuxSession: tmuxSessionName(id), startController: undefined, startupError: false, lifecycle: "starting", outcome: null,
		summary: "", ready: undefined, runActive: false };
}

const RESERVED_CHILD_FLAGS = new Set(["--session", "--mode", "-s", "-m"]);

/** User passthrough pi flags: reserved flags rejected, model/thinking stripped (the record owns them). */
export function sanitizeExtraArgs(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("extraArgs must be an array of strings");
	const reserved = value.find((arg) => RESERVED_CHILD_FLAGS.has(arg));
	if (reserved) throw new Error(`child flag ${reserved} is owned by the coordinator`);
	const filtered: string[] = [];
	for (let index = 0; index < value.length; index++) {
		const arg = value[index]!;
		if (arg === "--model" || arg === "--thinking") { index++; continue; }
		filtered.push(arg);
	}
	return filtered;
}
