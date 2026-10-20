import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface AgentToolConfig {
	readonly model: string;
	readonly projectDir: string;
	readonly timeoutMs: number;
	/** Extra CLI args forwarded to the child pi (e.g. -e extension flags from the parent). */
	readonly childArgs?: readonly string[];
	/** Root session that dispatch queue entries are keyed by. */
	readonly rootSessionId?: string;
	/** Bind the dispatched actor before acknowledging the child launch. */
	readonly acquireChildActor?: (agentId: string) => Promise<void>;
}

interface AgentResult {
	readonly content: string;
	readonly isError: boolean;
	readonly details: { sessionDir: string; durationMs: number };
}

/**
 * OC-style async dispatch: spawn the child detached, return its session tag
 * immediately, let it run in the background. Main continues (OC subagents are
 * asynchronous; the CCV workflow relies on main proceeding while children
 * work — a synchronous child would deadlock wait_main against main's release).
 */
async function runChildAgent(config: AgentToolConfig, prompt: string, subagentType: string, signal?: AbortSignal): Promise<AgentResult> {
	const start = Date.now();
	const sessionTag = `ses_${randomBytes(8).toString("hex")}`;
	if (config.acquireChildActor && config.rootSessionId) {
		await config.acquireChildActor(sessionTag);
	}
	const logDir = join(config.projectDir, ".fsm-agent-logs");
	await mkdir(logDir, { recursive: true }).catch(() => undefined);
	const logHandle = await open(join(logDir, `${sessionTag}.log`), "a").catch(() => undefined);
	const out = logHandle?.createWriteStream();
	// Strip inherited PI_* session markers (this shell's pi environment leaks
	// through the harness into the child: PI_SUBAGENT_PARENT_SESSION would make
	// the child load the subagent profile and its task gate). PI_CODING_AGENT_DIR
	// is kept so the child finds the real pi install under redirected HOME.
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("PI_") && key !== "PI_CODING_AGENT_DIR") continue;
		env[key] = value;
	}
	env.PI_AGENT_SUBAGENT_TYPE = subagentType;
	if (config.rootSessionId) {
		env.FSM_PARENT_SESSION_ID = config.rootSessionId;
		env.FSM_AGENT_ID = sessionTag;
	}
	const child = spawn(process.execPath, [
		process.argv[1] ?? "pi",
		"--print", "-ne", "--model", config.model,
		...(config.childArgs ?? []),
		prompt,
	], {
		cwd: config.projectDir,
		env,
		stdio: ["ignore", out ? "pipe" : "ignore", out ? "pipe" : "ignore"],
	});
	if (out) {
		child.stdout?.pipe(out);
		child.stderr?.pipe(out);
	}
	child.once("close", () => { void logHandle?.close().catch(() => undefined); });
	const abort = () => { child.kill("SIGTERM"); };
	signal?.addEventListener("abort", abort, { once: true });
	// Safety cap only — the child self-terminates; CCV workers legitimately run
	// for many minutes (main polls their progress via analysis_state CLI).
	setTimeout(() => { child.kill("SIGKILL"); }, config.timeoutMs * 15).unref();
	child.unref();
	return {
		content: `child session ${sessionTag} started (agent: ${subagentType}, log: ${join(logDir, `${sessionTag}.log`)})`,
		isError: false,
		details: { sessionDir: sessionTag, durationMs: Date.now() - start },
	};
}

/**
 * Native Agent tool with CC-compatible name and params (behavioral parity with haokun-code).
 * The FSM permission gate sees tool_name "Agent" which matches skill rules with requires_dispatch.
 */
export function registerAgentTool(pi: ExtensionAPI, config: AgentToolConfig): () => void {
	let active = true;
	const execute = async (_toolCallId: string, params: unknown, signal?: AbortSignal) => {
		if (!active) throw new Error("Agent tool disabled");
		const record = params as { description?: string; prompt?: string; subagent_type?: string };
		if (typeof record.prompt !== "string" || !record.prompt) throw new Error("Agent tool requires prompt");
		if (typeof record.subagent_type !== "string" || !record.subagent_type) throw new Error("Agent tool requires subagent_type");
		const result = await runChildAgent(config, record.prompt, record.subagent_type, signal);
		return {
			content: [{ type: "text" as const, text: result.content }],
			isError: result.isError,
			details: result.details,
		};
	};
	const parameters = Type.Object({
		description: Type.String({ description: "A short (3-5 word) description of the task" }),
		prompt: Type.String({ description: "The task for the agent to perform" }),
		subagent_type: Type.String({ description: "The type of specialized agent to use" }),
	});
	// CC name plus OC/Pi aliases; the permission gate normalizes all of them to "Agent".
	for (const name of ["Agent", "agent", "task", "subagent"]) {
		 pi.registerTool({
			name, label: name,
			description: "Dispatch a subagent to perform a task. The subagent runs with its own session and model.",
			parameters, execute,
		} as never);
	}
	return () => { active = false; };
}
