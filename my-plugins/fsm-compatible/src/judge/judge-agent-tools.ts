import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { CaptureTurn } from "./capture-turn.ts";
import { createJudgeFileTools, type JudgeToolResult } from "./judge-file-tools.ts";
import type { JudgeToolPolicy } from "./judge-tool-policy.ts";

function toToolResult(resolved: JudgeToolResult): { content: { type: "text"; text: string }[]; isError?: boolean; details?: unknown } {
	return { content: [{ type: "text", text: resolved.content }], ...(resolved.isError ? { isError: true } : {}),
		...(resolved.details !== undefined ? { details: resolved.details } : {}) };
}

function simpleTool(
	name: string,
	schema: object,
	run: (input: unknown, signal?: AbortSignal) => JudgeToolResult | Promise<JudgeToolResult>,
): AgentTool {
	return {
		name,
		label: name,
		parameters: schema as never,
		// Step P3: wrappers carry the per-turn policy; execution stays within the judge cwd rules.
		async execute(_id: string, params: unknown, signal?: AbortSignal) {
			return toToolResult(await run(params, signal));
		},
	} as unknown as AgentTool;
}

const READ = Type.Object({ filePath: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) });
const GREP = Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()), include: Type.Optional(Type.String()) });
const GLOB = Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) });
const BASH = Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number()), workdir: Type.Optional(Type.String()) });
const EDIT = Type.Object({ filePath: Type.String(), oldString: Type.String(), newString: Type.String(), replaceAll: Type.Optional(Type.Boolean()) });

export function structuredOutputSystemSuffix(schema: Record<string, unknown>): string {
	return `Your StructuredOutput tool input must exactly match this JSON schema:\n${JSON.stringify(schema)}`;
}

export function buildJudgeAgentTools(cwd: string, policy: JudgeToolPolicy, turn: CaptureTurn): AgentTool[] {
	const files = createJudgeFileTools(cwd, policy.externalDirectory);
	const tools: AgentTool[] = [];
	if (policy.allowed.has("read")) tools.push(simpleTool("read", READ, (input, signal) => files.read(input, signal)));
	if (policy.allowed.has("grep")) tools.push(simpleTool("grep", GREP, (input, signal) => files.grep(input, signal)));
	if (policy.allowed.has("glob")) tools.push(simpleTool("glob", GLOB, (input, signal) => files.glob(input, signal)));
	if (policy.allowed.has("bash")) tools.push(simpleTool("bash", BASH, (input, signal) => files.bash(input, signal)));
	if (policy.allowed.has("edit")) tools.push(simpleTool("edit", EDIT, (input, signal) => files.edit(input, signal)));
	tools.push({
		name: "StructuredOutput",
		label: "StructuredOutput",
		parameters: Type.Object({}, { additionalProperties: true }) as never,
		async execute(toolCallId: string, params: unknown) {
			const outcome = turn.capture(toolCallId, (params ?? {}) as Record<string, unknown>);
			return { content: [{ type: "text", text: outcome.content }], ...(outcome.kind === "invalid" ? { isError: true } : { terminate: true }) };
		},
	} as unknown as AgentTool);
	return tools;
}
