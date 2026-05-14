/**
 * Phase 0 — Scope Determination.
 *
 * Runs a single sub-session to analyze the target and produce a ScopeResult.
 */

import { Type } from "@sinclair/typebox";
import { defineTool, type ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { loadPrompt, runPhase, type PhaseRunResult } from "../phase-runner.js";
import type { ScopeResult, ScopeFile } from "../types.js";

const submitScopeTool = defineTool({
	name: "submit_scope",
	label: "Submit Scope",
	description: "提交范围确定结果",
	parameters: Type.Object({
		files: Type.Array(
			Type.Object({
				path: Type.String(),
				type: Type.Union([
					Type.Literal("code"),
					Type.Literal("config"),
					Type.Literal("doc"),
					Type.Literal("test"),
				]),
				lines: Type.Number(),
			}),
		),
		digest: Type.String(),
	}),
	async execute() {
		return { content: [{ type: "text" as const, text: "已接收" }], details: undefined };
	},
});

interface ScopeSubmission {
	files: ScopeFile[];
	digest: string;
}

export interface Phase0Options {
	target: string;
	model: Model<Api>;
	cwd: string;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
}

export async function runPhase0(options: Phase0Options): Promise<ScopeResult> {
	const systemPrompt = loadPrompt("phase-0.md", {});
	const userMessage = `检查目标: ${options.target}`;

	const result: PhaseRunResult<ScopeSubmission> = await runPhase({
		phaseName: "Phase 0",
		systemPrompt,
		userMessage,
		builtinTools: ["read", "bash", "grep"],
		submitTool: submitScopeTool,
		model: options.model,
		cwd: options.cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});

	if (!result.submitted || !result.data) {
		throw new Error("Phase 0: submit_scope was not called by the model");
	}

	const { files, digest } = result.data;
	const totalLines = files.reduce((sum, f) => sum + f.lines, 0);

	return {
		target: options.target,
		files,
		totalLines,
		digest,
	};
}
