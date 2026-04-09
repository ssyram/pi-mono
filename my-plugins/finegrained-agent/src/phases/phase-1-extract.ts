/**
 * Phase 1 — Sharded Proposition Extraction.
 *
 * Splits scope files into shards, runs parallel sub-sessions,
 * then merges and renumbers all propositions.
 */

import { Type } from "@sinclair/typebox";
import { defineTool, type ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { loadPrompt, runPhase } from "../phase-runner.js";
import type { Proposition, ScopeFile, ScopeResult, ScaleConfig } from "../types.js";

// ─── Submit tool schema ──────────────────────────────────────────────────────

const submitPropositionsTool = defineTool({
	name: "submit_propositions",
	label: "Submit Propositions",
	description: "提交命题抽取结果",
	parameters: Type.Object({
		propositions: Type.Array(
			Type.Object({
				id: Type.String(),
				subject: Type.String(),
				verb: Type.String(),
				constraint: Type.String(),
				source: Type.Object({
					file: Type.String(),
					line: Type.Union([Type.Number(), Type.Null()]),
					section: Type.Union([Type.String(), Type.Null()]),
				}),
				category: Type.Union([
					Type.Literal("code"),
					Type.Literal("config"),
					Type.Literal("doc"),
					Type.Literal("cross-file"),
				]),
				tags: Type.Array(Type.String()),
			}),
		),
	}),
	async execute() {
		return { content: [{ type: "text" as const, text: "已接收" }], details: undefined };
	},
});

// ─── Shard logic ─────────────────────────────────────────────────────────────

function chunkFiles(files: ScopeFile[], shardSize: number): ScopeFile[][] {
	const shards: ScopeFile[][] = [];
	for (let i = 0; i < files.length; i += shardSize) {
		shards.push(files.slice(i, i + shardSize));
	}
	return shards;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PropositionSubmission {
	propositions: Proposition[];
}

export interface Phase1Options {
	scope: ScopeResult;
	config: ScaleConfig;
	model: Model<Api>;
	cwd: string;
	modelRegistry: ModelRegistry;
	signal?: AbortSignal;
	/** Called when a shard completes */
	onShardDone?: (shardIndex: number, count: number) => void;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export async function runPhase1(options: Phase1Options): Promise<Proposition[]> {
	const { scope, config, onShardDone } = options;

	const shardSize = Math.ceil(scope.files.length / config.extractShardCount);
	const shards = chunkFiles(scope.files, shardSize);
	const propsPerShard = Math.ceil(config.targetPropositions / shards.length);

	// Run shards in parallel
	const shardResults = await Promise.all(
		shards.map(async (shardFiles, idx) => {
			const fileList = shardFiles.map((f) => `- ${f.path} (${f.type}, ${f.lines} lines)`).join("\n");

			const systemPrompt = loadPrompt("phase-1.md", {
				shardIndex: String(idx + 1),
				shardTotal: String(shards.length),
				targetCount: String(propsPerShard),
				fileList,
				scopeDigest: scope.digest,
			});

			const result = await runPhase<PropositionSubmission>({
				phaseName: `Phase 1 Shard ${idx + 1}`,
				systemPrompt,
				userMessage: `请读取你负责的文件并抽取命题。目标: ${propsPerShard} 条。`,
				builtinTools: ["read"],
				submitTool: submitPropositionsTool,
				model: options.model,
				cwd: options.cwd,
				modelRegistry: options.modelRegistry,
				signal: options.signal,
			});

			if (!result.submitted || !result.data) {
				throw new Error(`Phase 1 Shard ${idx + 1}: submit_propositions was not called`);
			}

			onShardDone?.(idx + 1, result.data.propositions.length);
			return result.data.propositions;
		}),
	);

	// Merge and renumber
	return renumberPropositions(shardResults.flat());
}

function renumberPropositions(raw: Proposition[]): Proposition[] {
	// Deduplicate by subject+verb+source.file
	const seen = new Set<string>();
	const unique: Proposition[] = [];

	for (const p of raw) {
		const key = `${p.subject}|${p.verb}|${p.source.file}`;
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(p);
		}
	}

	// Renumber P1..PN
	return unique.map((p, i) => ({ ...p, id: `P${i + 1}` }));
}
