/**
 * Phase 2 — Contradiction and Omission Detection.
 *
 * Phase 2a: Cross-group pairs (upper triangle)
 * Phase 2b: Intra-group analysis
 * Both run in parallel via Promise.all.
 */

import { Type } from "@sinclair/typebox";
import { defineTool, type ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { loadPrompt, runPhase } from "../phase-runner.js";
import type {
	Finding,
	Proposition,
	PropositionGroup,
	ScopeResult,
} from "../types.js";

// ─── Submit tool ─────────────────────────────────────────────────────────────

const submitFindingsTool = defineTool({
	name: "submit_findings",
	label: "Submit Findings",
	description: "提交矛盾与遗漏检查结果",
	parameters: Type.Object({
		findings: Type.Array(
			Type.Object({
				kind: Type.Union([Type.Literal("contradiction"), Type.Literal("omission")]),
				severity: Type.Union([
					Type.Literal("high"),
					Type.Literal("medium"),
					Type.Literal("low"),
				]),
				propositionIds: Type.Array(Type.String()),
				description: Type.String(),
				impact: Type.String(),
			}),
		),
	}),
	async execute() {
		return { content: [{ type: "text" as const, text: "已接收" }], details: undefined };
	},
});

// ─── Grouping ────────────────────────────────────────────────────────────────

export function groupPropositions(
	propositions: Proposition[],
	groupSize: number,
): PropositionGroup[] {
	// Group by source file, then chunk by groupSize
	const byFile = new Map<string, Proposition[]>();
	for (const p of propositions) {
		const key = p.source.file;
		if (!byFile.has(key)) byFile.set(key, []);
		byFile.get(key)!.push(p);
	}

	const groups: PropositionGroup[] = [];
	let idx = 1;
	let currentGroup: Proposition[] = [];
	let currentModule = "";

	for (const [file, props] of byFile) {
		for (const p of props) {
			if (currentGroup.length >= groupSize) {
				groups.push({
					id: `G${String(idx).padStart(2, "0")}`,
					module: currentModule,
					propositions: currentGroup,
				});
				idx++;
				currentGroup = [];
			}
			currentGroup.push(p);
			currentModule = file;
		}
	}

	if (currentGroup.length > 0) {
		groups.push({
			id: `G${String(idx).padStart(2, "0")}`,
			module: currentModule,
			propositions: currentGroup,
		});
	}

	return groups;
}

// ─── Upper triangle pairs ────────────────────────────────────────────────────

function upperTrianglePairs<T>(items: T[]): [T, T][] {
	const pairs: [T, T][] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			pairs.push([items[i], items[j]]);
		}
	}
	return pairs;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface FindingSubmission {
	findings: Array<{
		kind: "contradiction" | "omission";
		severity: "high" | "medium" | "low";
		propositionIds: string[];
		description: string;
		impact: string;
	}>;
}

export interface Phase2Options {
	groups: PropositionGroup[];
	scope: ScopeResult;
	model: Model<Api>;
	cwd: string;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
	onPairDone?: (kind: "cross" | "intra", label: string) => void;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export async function runPhase2(options: Phase2Options): Promise<Finding[]> {
	const { groups, scope, onPairDone } = options;
	const crossPairs = upperTrianglePairs(groups);

	// Run 2a and 2b in parallel
	const [crossFindings, intraFindings] = await Promise.all([
		runCrossGroupPairs(crossPairs, scope, options),
		runIntraGroups(groups, scope, options),
	]);

	// Assign IDs
	const all = [...crossFindings, ...intraFindings];
	return all.map((f, i) => ({ ...f, id: `F${i + 1}` }));
}

async function runCrossGroupPairs(
	pairs: [PropositionGroup, PropositionGroup][],
	scope: ScopeResult,
	options: Phase2Options,
): Promise<Finding[]> {
	const results = await Promise.all(
		pairs.map(async ([gA, gB]) => {
			const groupData = JSON.stringify(
				{ group_a: { id: gA.id, propositions: gA.propositions },
				  group_b: { id: gB.id, propositions: gB.propositions } },
				null, 2,
			);
			const systemPrompt = loadPrompt("phase-2a-cross.md", {
				groupData,
				scopeDigest: scope.digest,
			});

			const result = await runPhase<FindingSubmission>({
				phaseName: `Phase 2a ${gA.id}×${gB.id}`,
				systemPrompt,
				userMessage: `检查 ${gA.id} 和 ${gB.id} 之间的矛盾与遗漏。`,
				builtinTools: ["read"],
				submitTool: submitFindingsTool,
				model: options.model,
				cwd: options.cwd,
				modelRegistry: options.modelRegistry,
				signal: options.signal,
			});

			options.onPairDone?.("cross", `${gA.id}×${gB.id}`);

			if (!result.submitted || !result.data) return [];
			return result.data.findings.map((f) => ({
				...f,
				id: "", // assigned later
				sourceContext: `cross:${gA.id}×${gB.id}`,
			}));
		}),
	);

	return results.flat();
}

async function runIntraGroups(
	groups: PropositionGroup[],
	scope: ScopeResult,
	options: Phase2Options,
): Promise<Finding[]> {
	const results = await Promise.all(
		groups.map(async (group) => {
			const groupData = JSON.stringify(
				{ group: { id: group.id, propositions: group.propositions } },
				null, 2,
			);
			const systemPrompt = loadPrompt("phase-2b-intra.md", {
				groupData,
				scopeDigest: scope.digest,
			});

			const result = await runPhase<FindingSubmission>({
				phaseName: `Phase 2b ${group.id}`,
				systemPrompt,
				userMessage: `检查 ${group.id} 组内的矛盾与遗漏。`,
				builtinTools: ["read"],
				submitTool: submitFindingsTool,
				model: options.model,
				cwd: options.cwd,
				modelRegistry: options.modelRegistry,
				signal: options.signal,
			});

			options.onPairDone?.("intra", group.id);

			if (!result.submitted || !result.data) return [];
			return result.data.findings.map((f) => ({
				...f,
				id: "",
				sourceContext: `intra:${group.id}`,
			}));
		}),
	);

	return results.flat();
}
