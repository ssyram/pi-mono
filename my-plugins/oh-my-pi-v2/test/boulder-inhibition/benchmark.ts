import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import process from "node:process";
import type { BoulderBranchReader, BoulderEntryLike } from "../../boulder-inhibition/protocol.ts";
import { readBoulderInhibition } from "../../boulder-inhibition/read-inhibition.ts";

interface ParentNode {
	entry: BoulderEntryLike;
	parent: ParentNode | undefined;
}

function simulatedParentChain(length: number, sourceCount: number): BoulderBranchReader {
	let leaf: ParentNode | undefined;
	for (let index = 0; index < length; index++) {
		leaf = {
			entry: {
				type: "custom", customType: "OMPv2InhibitBoulder",
				data: { type: `source/${index % sourceCount}`, value: index % 3 === 0 },
			},
			parent: leaf,
		};
	}
	return {
		getBranch: () => {
			const entries: BoulderEntryLike[] = [];
			for (let current = leaf; current !== undefined; current = current.parent) entries.push(current.entry);
			entries.reverse();
			return entries;
		},
	};
}

console.log(JSON.stringify({
	benchmark: "simulated parent-chain getBranch allocation + reverse + inhibition scan",
	note: "Synthetic workload only; not real SDK or TUI timing. No millisecond pass threshold.",
	node: process.version, platform: process.platform, arch: process.arch,
	units: "milliseconds", warmupRepeats: 3,
}));

for (const length of [1_000, 10_000, 100_000]) {
	for (const sourceCount of [32, length]) {
		const reader = simulatedParentChain(length, sourceCount);
		const expectedStates: { type: string; value: boolean }[] = [];
		for (let index = length - 1; index >= length - sourceCount; index--) {
			expectedStates.push({ type: `source/${index % sourceCount}`, value: index % 3 === 0 });
		}
		const expectedBlockers = expectedStates.filter((signal) => signal.value).map((signal) => signal.type);
		for (let warmup = 0; warmup < 3; warmup++) {
			assert.deepEqual(readBoulderInhibition(reader.getBranch()), {
				states: expectedStates, blockers: expectedBlockers, inhibited: expectedBlockers.length > 0,
			});
		}
		const repeats = length === 100_000 ? 10 : length === 10_000 ? 25 : 50;
		let getBranchMs = 0;
		let scanMs = 0;
		let checksum = 0;
		const samples: number[] = [];
		for (let repeat = 0; repeat < repeats; repeat++) {
			const start = performance.now();
			const branch = reader.getBranch();
			const afterBranch = performance.now();
			const snapshot = readBoulderInhibition(branch);
			const afterScan = performance.now();
			getBranchMs += afterBranch - start;
			scanMs += afterScan - afterBranch;
			samples.push(afterScan - start);
			assert.equal(branch.length, length);
			assert.deepEqual(snapshot, {
				states: expectedStates, blockers: expectedBlockers, inhibited: expectedBlockers.length > 0,
			});
			checksum += snapshot.states.length + snapshot.blockers.length;
		}
		const totalMs = getBranchMs + scanMs;
		console.log(JSON.stringify({
			N: length, K: sourceCount, repeats, warmupRepeats: 3,
			getBranchTotalMs: getBranchMs, scanTotalMs: scanMs, totalMs,
			meanMs: totalMs / repeats, minMs: Math.min(...samples), maxMs: Math.max(...samples), checksum,
		}));
	}
}
