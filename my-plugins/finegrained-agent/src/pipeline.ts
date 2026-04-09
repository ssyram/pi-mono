/**
 * pipeline.ts — Main DAG orchestrator for the finegrained-agent pipeline.
 *
 * Coordinates all phases: scope → extract+dims → check+matrix → score → report.
 * Persists intermediate state to workdir for audit and resume.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type {
	PipelineState,
	PhaseResult,
	Proposition,
	PropositionGroup,
} from "./types.js";
import { computeScaleConfig, rebalanceIfNeeded } from "./auto-scale.js";
import { runPhase0 } from "./phases/phase-0-scope.js";
import { runPhase1 } from "./phases/phase-1-extract.js";
import { groupPropositions, runPhase2 } from "./phases/phase-2-check.js";
import { runPhase3a, runPhase3b } from "./phases/phase-3-matrix.js";
import { runPhase5 } from "./phases/phase-5-score.js";
import { runPhase6 } from "./phases/phase-6-report.js";

export interface PipelineOptions {
	target: string;
	cwd: string;
	mainModel: Model<Api>;
	nanoModel: Model<Api>;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
	/** Progress callback for TUI updates */
	onProgress?: (message: string) => void;
}

export interface PipelineResult {
	runId: string;
	workdir: string;
	reportPath: string;
	summary: {
		totalPropositions: number;
		totalContradictions: number;
		totalOmissions: number;
		totalMatrixGaps: number;
		highSeverityCount: number;
	};
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
	const { target, cwd, mainModel, nanoModel, onProgress } = options;
	const runId = randomUUID().slice(0, 8);
	const workdir = resolve(cwd, ".pi", "finegrained-runs", runId);
	mkdirSync(workdir, { recursive: true });

	const progress = (msg: string) => {
		onProgress?.(msg);
	};

	const state = initState(runId, target, workdir);
	persistState(workdir, state);

	// ── Phase 0: Scope ──────────────────────────────────────────────────
	progress("Phase 0: 确定检查范围...");
	const scope = await runPhase0({
		target,
		model: mainModel,
		cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});
	state.scope = scope;
	persistJson(workdir, "scope.json", scope);

	const config = rebalanceIfNeeded(computeScaleConfig(scope));
	state.config = config;
	progress(`Phase 0 完成: ${scope.files.length} 文件, ${scope.totalLines} 行`);
	progress(`缩放参数: ${config.targetPropositions} 目标命题, ${config.extractShardCount} 分片`);
	persistState(workdir, state);

	// ── Phase 1 & Phase 3a (parallel) ───────────────────────────────────
	progress("Phase 1 + 3a: 命题抽取 & 设计维度抽取 (并行)...");

	const propositions = await runPhase1({
		scope,
		config,
		model: nanoModel,
		cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
		onShardDone: (idx, count) => {
			progress(`  Phase 1 分片 ${idx} 完成: ${count} 条命题`);
		},
	});

	state.propositions = propositions;
	persistJson(workdir, "propositions.json", propositions);
	progress(`Phase 1 完成: ${propositions.length} 条命题`);

	progress("Phase 3a: 设计维度抽取...");
	const actualDesignPoints = await runPhase3a({
		scope,
		propositions,
		config,
		model: mainModel,
		cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});
	state.designPoints = actualDesignPoints;
	persistJson(workdir, "design-points.json", actualDesignPoints);
	progress(`Phase 3a 完成: ${actualDesignPoints.length} 个设计维度`);
	persistState(workdir, state);

	// ── Phase 2 & Phase 3b (parallel) ───────────────────────────────────
	progress("Phase 2 + 3b: 矛盾检测 & 矩阵验证 (并行)...");

	const groups = groupPropositions(propositions, config.groupSize);
	state.groups = groups;
	progress(`  分组: ${groups.length} 组, 组间 ${(groups.length * (groups.length - 1)) / 2} 对`);

	const [findings, matrixCells] = await Promise.all([
		runPhase2({
			groups,
			scope,
			model: nanoModel,
			cwd,
			modelRegistry: options.modelRegistry,
			signal: options.signal,
			onPairDone: (kind, label) => {
				progress(`  Phase 2${kind === "cross" ? "a" : "b"} ${label} ✓`);
			},
		}),
		runPhase3b({
			designPoints: actualDesignPoints,
			propositions,
			scope,
			model: nanoModel,
			cwd,
			modelRegistry: options.modelRegistry,
			signal: options.signal,
			onCellDone: (a, b) => {
				progress(`  Phase 3b ${a}×${b} ✓`);
			},
		}),
	]);

	state.findings = findings;
	state.matrixCells = matrixCells;
	persistJson(workdir, "findings.json", findings);
	persistJson(workdir, "matrix-cells.json", matrixCells);
	progress(`Phase 2 完成: ${findings.length} findings`);
	const gaps = matrixCells.filter((c) => !c.covered).length;
	progress(`Phase 3b 完成: ${matrixCells.length} cells, ${gaps} 空洞`);
	persistState(workdir, state);

	// ── Phase 5: Score & Rank ───────────────────────────────────────────
	progress("Phase 5: 汇总与严重性重排...");
	const scoredFindings = await runPhase5({
		findings,
		matrixCells,
		model: mainModel,
		cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});
	state.scoredFindings = scoredFindings;
	persistJson(workdir, "findings-scored.json", scoredFindings);
	progress(`Phase 5 完成: ${scoredFindings.length} 条评分 findings`);
	persistState(workdir, state);

	// ── Phase 6: Report ─────────────────────────────────────────────────
	const reportPath = resolveReportPath(target, cwd);
	progress(`Phase 6: 生成报告 → ${reportPath}`);

	const reportResult = await runPhase6({
		scope,
		propositions,
		designPoints: actualDesignPoints,
		scoredFindings,
		matrixCells,
		reportPath,
		model: mainModel,
		cwd,
		modelRegistry: options.modelRegistry,
		signal: options.signal,
	});

	state.reportPath = reportResult.reportPath;
	persistState(workdir, state);
	progress("Pipeline 完成!");

	return {
		runId,
		workdir,
		reportPath: reportResult.reportPath,
		summary: reportResult.summary,
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initState(runId: string, target: string, workdir: string): PipelineState {
	return {
		runId,
		target,
		workdir,
		startedAt: Date.now(),
		scope: null,
		propositions: null,
		groups: null,
		designPoints: null,
		findings: null,
		matrixCells: null,
		scoredFindings: null,
		reportPath: null,
		phases: [],
		config: {
			targetPropositions: 0,
			minPropositions: 0,
			extractShardCount: 1,
			groupSize: 8,
			groupCount: 0,
			crossPairCount: 0,
			designPointCount: 8,
			matrixCellCount: 0,
			nanoConcurrency: 10,
		},
	};
}

function persistState(workdir: string, state: PipelineState): void {
	writeFileSync(resolve(workdir, "state.json"), JSON.stringify(state, null, 2));
}

function persistJson(workdir: string, filename: string, data: unknown): void {
	writeFileSync(resolve(workdir, filename), JSON.stringify(data, null, 2));
}

function resolveReportPath(target: string, cwd: string): string {
	// If target is a file, put report next to it
	// If target is a directory, put report inside it
	const resolved = resolve(cwd, target);
	if (existsSync(resolved)) {
		const stat = statSync(resolved);
		if (stat.isDirectory()) {
			return resolve(resolved, "_finegrained_report.md");
		}
		// File — put report in same directory
		const base = resolved.replace(/\.[^.]+$/, "");
		return `${base}_finegrained_report.md`;
	}
	// Topic/theme — put in cwd
	return resolve(cwd, "_finegrained_report.md");
}
