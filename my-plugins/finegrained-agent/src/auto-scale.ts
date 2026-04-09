/**
 * Auto-scaling logic: compute shard/group/dimension counts from scope size.
 */

import type { ScaleConfig, ScopeResult } from "./types.js";

function clamp(min: number, max: number, value: number): number {
	return Math.max(min, Math.min(max, value));
}

export function computeScaleConfig(scope: ScopeResult, nanoConcurrency = 10): ScaleConfig {
	const { totalLines } = scope;
	const fileCount = scope.files.length;

	const targetPropositions = clamp(10, 300, Math.ceil((totalLines / 500) * 7));
	const minPropositions = clamp(10, 300, Math.ceil((totalLines / 500) * 5));
	const extractShardCount = clamp(1, 8, Math.ceil(fileCount / 10));
	const groupSize = clamp(5, 12, Math.ceil(Math.sqrt(targetPropositions)));
	const groupCount = Math.ceil(targetPropositions / groupSize);
	const crossPairCount = (groupCount * (groupCount - 1)) / 2;
	const designPointCount = clamp(8, 20, Math.ceil(Math.sqrt(targetPropositions * 2)));
	const matrixCellCount = (designPointCount * (designPointCount - 1)) / 2;

	return {
		targetPropositions,
		minPropositions,
		extractShardCount,
		groupSize,
		groupCount,
		crossPairCount,
		designPointCount,
		matrixCellCount,
		nanoConcurrency,
	};
}

/**
 * If cross-pair count is too high, increase group size to reduce pair count.
 * Returns updated config.
 */
export function rebalanceIfNeeded(config: ScaleConfig, maxPairs = 200): ScaleConfig {
	if (config.crossPairCount <= maxPairs) return config;

	// Solve: N*(N-1)/2 <= maxPairs → N <= (1 + sqrt(1 + 8*maxPairs)) / 2
	const maxGroups = Math.floor((1 + Math.sqrt(1 + 8 * maxPairs)) / 2);
	const newGroupSize = Math.ceil(config.targetPropositions / maxGroups);
	const newGroupCount = Math.ceil(config.targetPropositions / newGroupSize);
	const newCrossPairCount = (newGroupCount * (newGroupCount - 1)) / 2;

	return {
		...config,
		groupSize: newGroupSize,
		groupCount: newGroupCount,
		crossPairCount: newCrossPairCount,
	};
}
