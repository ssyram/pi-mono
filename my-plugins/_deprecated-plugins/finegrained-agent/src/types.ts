/**
 * Core type definitions for the finegrained-agent pipeline.
 */

// ─── Phase 0: Scope ──────────────────────────────────────────────────────────

export interface ScopeFile {
	path: string;
	type: "code" | "config" | "doc" | "test";
	lines: number;
}

export interface ScopeResult {
	target: string;
	files: ScopeFile[];
	totalLines: number;
	digest: string; // compact summary for sub-sessions
}

// ─── Phase 1: Propositions ───────────────────────────────────────────────────

export interface Proposition {
	id: string; // P1, P2, ...
	subject: string;
	verb: string;
	constraint: string;
	source: {
		file: string;
		line: number | null;
		section: string | null;
	};
	category: "code" | "config" | "doc" | "cross-file";
	tags: string[]; // for matrix cell filtering
}

export interface PropositionGroup {
	id: string; // G01, G02, ...
	module: string; // source file/module name
	propositions: Proposition[];
}

// ─── Phase 2: Findings ──────────────────────────────────────────────────────

export type Severity = "high" | "medium" | "low";
export type FindingKind = "contradiction" | "omission";

export interface Finding {
	id: string; // F1, F2, ...
	kind: FindingKind;
	severity: Severity;
	propositionIds: string[]; // e.g. ["P1", "P3"]
	description: string;
	impact: string;
	sourceContext: string; // pair/group that found it
}

// ─── Phase 3: Design Matrix ─────────────────────────────────────────────────

export interface DesignPoint {
	id: string; // D01, D02, ...
	name: string;
	description: string;
	tags: string[]; // for proposition filtering
}

export interface MatrixCell {
	dimA: string; // D01
	dimB: string; // D02
	covered: boolean;
	gap: string | null; // explanation if not covered
	severity: Severity | null;
	relevantPropositions: string[];
}

// ─── Phase 5: Scored Findings ────────────────────────────────────────────────

export interface ScoredFinding extends Finding {
	finalSeverity: Severity;
	rationale: string; // why severity was changed (or kept)
}

// ─── Pipeline State ──────────────────────────────────────────────────────────

export type PhaseStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface PhaseResult {
	phase: string;
	status: PhaseStatus;
	startedAt: number;
	completedAt: number | null;
	error: string | null;
	tokenUsage: { input: number; output: number } | null;
	retries: number;
}

export interface PipelineState {
	runId: string;
	target: string;
	workdir: string;
	startedAt: number;

	scope: ScopeResult | null;
	propositions: Proposition[] | null;
	groups: PropositionGroup[] | null;
	designPoints: DesignPoint[] | null;
	findings: Finding[] | null;
	matrixCells: MatrixCell[] | null;
	scoredFindings: ScoredFinding[] | null;
	reportPath: string | null;

	phases: PhaseResult[];
	config: ScaleConfig;
}

// ─── Auto-Scale Config ───────────────────────────────────────────────────────

export interface ScaleConfig {
	targetPropositions: number;
	minPropositions: number;
	extractShardCount: number;
	groupSize: number;
	groupCount: number;
	crossPairCount: number;
	designPointCount: number;
	matrixCellCount: number;
	nanoConcurrency: number;
}
