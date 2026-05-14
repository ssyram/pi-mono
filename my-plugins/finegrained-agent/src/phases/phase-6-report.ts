/**
 * Phase 6 — Report Generation.
 *
 * Takes all structured data and generates a final Markdown report.
 */

import { Type } from "@sinclair/typebox";
import { defineTool, type ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { loadPrompt, runPhase } from "../phase-runner.js";
import type {
	DesignPoint,
	MatrixCell,
	Proposition,
	ScopeResult,
	ScoredFinding,
} from "../types.js";

// ─── Submit tool ─────────────────────────────────────────────────────────────

const submitReportTool = defineTool({
	name: "submit_report",
	label: "Submit Report",
	description: "确认报告已写入",
	parameters: Type.Object({
		reportPath: Type.String(),
		summary: Type.Object({
			totalPropositions: Type.Number(),
			totalContradictions: Type.Number(),
			totalOmissions: Type.Number(),
			totalMatrixGaps: Type.Number(),
			highSeverityCount: Type.Number(),
		}),
	}),
	async execute() {
		return { content: [{ type: "text" as const, text: "已接收" }], details: undefined };
	},
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReportSubmission {
	reportPath: string;
	summary: {
		totalPropositions: number;
		totalContradictions: number;
		totalOmissions: number;
		totalMatrixGaps: number;
		highSeverityCount: number;
	};
}

export interface Phase6Options {
	scope: ScopeResult;
	propositions: Proposition[];
	designPoints: DesignPoint[];
	scoredFindings: ScoredFinding[];
	matrixCells: MatrixCell[];
	reportPath: string;
	model: Model<Api>;
	cwd: string;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export async function runPhase6(options: Phase6Options): Promise<ReportSubmission> {
	const {
		scope,
		propositions,
		designPoints,
		scoredFindings,
		matrixCells,
		reportPath,
	} = options;

	const systemPrompt = loadPrompt("phase-6.md", {
		scope: JSON.stringify(scope, null, 2),
		propositionCount: String(propositions.length),
		propositions: JSON.stringify(propositions, null, 2),
		designPoints: JSON.stringify(designPoints, null, 2),
		scoredFindings: JSON.stringify(scoredFindings, null, 2),
		matrix: JSON.stringify(matrixCells, null, 2),
		reportPath,
	});

	const result = await runPhase<ReportSubmission>({
		phaseName: "Phase 6",
		systemPrompt,
		userMessage: `请生成最终报告并写入 ${reportPath}`,
		builtinTools: ["read"],
		submitTool: submitReportTool,
		model: options.model,
		cwd: options.cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});

	if (!result.submitted || !result.data) {
		throw new Error("Phase 6: submit_report was not called");
	}

	return result.data;
}
