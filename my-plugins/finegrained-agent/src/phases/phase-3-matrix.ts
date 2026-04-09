/**
 * Phase 3 — Design Dimension Extraction and Matrix Verification.
 *
 * Phase 3a: Extract design dimensions (1 session, main model)
 * Phase 3b: Verify matrix cells in parallel (nano model)
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
	ScaleConfig,
} from "../types.js";

// ─── Submit tools ────────────────────────────────────────────────────────────

const submitDesignPointsTool = defineTool({
	name: "submit_design_points",
	label: "Submit Design Points",
	description: "提交设计维度抽取结果",
	parameters: Type.Object({
		designPoints: Type.Array(
			Type.Object({
				id: Type.String(),
				name: Type.String(),
				description: Type.String(),
				tags: Type.Array(Type.String()),
			}),
		),
	}),
	async execute() {
		return { content: [{ type: "text" as const, text: "已接收" }], details: undefined };
	},
});

const submitMatrixCellTool = defineTool({
	name: "submit_matrix_cell",
	label: "Submit Matrix Cell",
	description: "提交设计维度交叉验证结果",
	parameters: Type.Object({
		covered: Type.Boolean(),
		gap: Type.Union([Type.String(), Type.Null()]),
		severity: Type.Union([
			Type.Literal("high"),
			Type.Literal("medium"),
			Type.Literal("low"),
			Type.Null(),
		]),
		relevantPropositions: Type.Array(Type.String()),
	}),
	async execute() {
		return { content: [{ type: "text" as const, text: "已接收" }], details: undefined };
	},
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface DesignPointSubmission {
	designPoints: DesignPoint[];
}

interface MatrixCellSubmission {
	covered: boolean;
	gap: string | null;
	severity: "high" | "medium" | "low" | null;
	relevantPropositions: string[];
}

// ─── Phase 3a: Dimension Extraction ──────────────────────────────────────────

export interface Phase3aOptions {
	scope: ScopeResult;
	propositions: Proposition[];
	config: ScaleConfig;
	model: Model<Api>;
	cwd: string;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
}

export async function runPhase3a(options: Phase3aOptions): Promise<DesignPoint[]> {
	const { scope, propositions, config } = options;

	// Condensed proposition list (subject + source only)
	const propositionSummary = propositions
		.map((p) => `${p.id}: ${p.subject} — ${p.verb} ${p.constraint} (${p.source.file})`)
		.join("\n");

	const systemPrompt = loadPrompt("phase-3a-dims.md", {
		targetCount: String(config.designPointCount),
		scopeDigest: scope.digest,
		propositionSummary,
	});

	const result = await runPhase<DesignPointSubmission>({
		phaseName: "Phase 3a",
		systemPrompt,
		userMessage: `请从范围和命题中归纳 ${config.designPointCount} 个设计维度。`,
		builtinTools: ["read"],
		submitTool: submitDesignPointsTool,
		model: options.model,
		cwd: options.cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});

	if (!result.submitted || !result.data) {
		throw new Error("Phase 3a: submit_design_points was not called");
	}

	return result.data.designPoints;
}

// ─── Phase 3b: Matrix Cell Verification ──────────────────────────────────────

export interface Phase3bOptions {
	designPoints: DesignPoint[];
	propositions: Proposition[];
	scope: ScopeResult;
	model: Model<Api>;
	cwd: string;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
	onCellDone?: (dimA: string, dimB: string) => void;
}

export async function runPhase3b(options: Phase3bOptions): Promise<MatrixCell[]> {
	const { designPoints, propositions, scope, onCellDone } = options;

	// Generate upper-triangle pairs
	const pairs: [DesignPoint, DesignPoint][] = [];
	for (let i = 0; i < designPoints.length; i++) {
		for (let j = i + 1; j < designPoints.length; j++) {
			pairs.push([designPoints[i], designPoints[j]]);
		}
	}

	const results = await Promise.all(
		pairs.map(async ([dimA, dimB]) => {
			// Filter propositions relevant to either dimension
			const relevant = filterRelevantPropositions(propositions, dimA, dimB);
			const relevantText = relevant.length > 0
				? relevant.map((p) =>
					`${p.id}: ${p.subject} ${p.verb} ${p.constraint} (${p.source.file})`
				).join("\n")
				: "（无直接相关命题）";

			const systemPrompt = loadPrompt("phase-3b-cell.md", {
				dimA: `${dimA.id}: ${dimA.name} — ${dimA.description} [tags: ${dimA.tags.join(", ")}]`,
				dimB: `${dimB.id}: ${dimB.name} — ${dimB.description} [tags: ${dimB.tags.join(", ")}]`,
				relevantPropositions: relevantText,
				scopeDigest: scope.digest,
			});

			const result = await runPhase<MatrixCellSubmission>({
				phaseName: `Phase 3b ${dimA.id}×${dimB.id}`,
				systemPrompt,
				userMessage: `判断 ${dimA.name} 和 ${dimB.name} 的交叉覆盖情况。`,
				builtinTools: ["read"],
				submitTool: submitMatrixCellTool,
				model: options.model,
				cwd: options.cwd,
				modelRegistry: options.modelRegistry,
				signal: options.signal,
			});

			onCellDone?.(dimA.id, dimB.id);

			if (!result.submitted || !result.data) {
				return {
					dimA: dimA.id,
					dimB: dimB.id,
					covered: false,
					gap: "sub-session did not return result",
					severity: "low" as const,
					relevantPropositions: [],
				};
			}

			return {
				dimA: dimA.id,
				dimB: dimB.id,
				...result.data,
			};
		}),
	);

	return results;
}

// ─── Proposition Filtering ───────────────────────────────────────────────────

function filterRelevantPropositions(
	propositions: Proposition[],
	dimA: DesignPoint,
	dimB: DesignPoint,
): Proposition[] {
	const tags = new Set([...dimA.tags, ...dimB.tags]);
	return propositions.filter((p) =>
		p.tags.some((t) => tags.has(t)),
	);
}
