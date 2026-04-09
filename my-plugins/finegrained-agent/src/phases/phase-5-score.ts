/**
 * Phase 5 — Merge Findings and Re-Score Severity.
 *
 * Takes all findings from Phase 2a/2b + matrix gaps from Phase 3b,
 * deduplicates, and re-evaluates severity from a global perspective.
 */

import { Type } from "@sinclair/typebox";
import { defineTool, type ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { loadPrompt, runPhase } from "../phase-runner.js";
import type { Finding, MatrixCell, ScoredFinding } from "../types.js";

// ─── Submit tool ─────────────────────────────────────────────────────────────

const submitScoredFindingsTool = defineTool({
	name: "submit_scored_findings",
	label: "Submit Scored Findings",
	description: "提交重新评分后的 findings",
	parameters: Type.Object({
		scoredFindings: Type.Array(
			Type.Object({
				id: Type.String(),
				kind: Type.Union([Type.Literal("contradiction"), Type.Literal("omission")]),
				severity: Type.Union([
					Type.Literal("high"),
					Type.Literal("medium"),
					Type.Literal("low"),
				]),
				finalSeverity: Type.Union([
					Type.Literal("high"),
					Type.Literal("medium"),
					Type.Literal("low"),
				]),
				propositionIds: Type.Array(Type.String()),
				description: Type.String(),
				impact: Type.String(),
				sourceContext: Type.String(),
				rationale: Type.String(),
			}),
		),
	}),
	async execute() {
		return { content: [{ type: "text" as const, text: "已接收" }], details: undefined };
	},
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScoredFindingSubmission {
	scoredFindings: ScoredFinding[];
}

export interface Phase5Options {
	findings: Finding[];
	matrixCells: MatrixCell[];
	model: Model<Api>;
	cwd: string;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export async function runPhase5(options: Phase5Options): Promise<ScoredFinding[]> {
	const { findings, matrixCells } = options;

	const matrixGaps = matrixCells.filter((c) => !c.covered);

	const findingsText = JSON.stringify(findings, null, 2);
	const matrixGapsText = JSON.stringify(
		matrixGaps.map((c) => ({
			dimA: c.dimA,
			dimB: c.dimB,
			gap: c.gap,
			severity: c.severity,
		})),
		null, 2,
	);

	const systemPrompt = loadPrompt("phase-5.md", {
		findings: findingsText,
		matrixGaps: matrixGapsText,
	});

	const result = await runPhase<ScoredFindingSubmission>({
		phaseName: "Phase 5",
		systemPrompt,
		userMessage: `请对 ${findings.length} 条 findings 和 ${matrixGaps.length} 个矩阵空洞进行去重和重新评分。`,
		builtinTools: [],
		submitTool: submitScoredFindingsTool,
		model: options.model,
		cwd: options.cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});

	if (!result.submitted || !result.data) {
		throw new Error("Phase 5: submit_scored_findings was not called");
	}

	return result.data.scoredFindings;
}
