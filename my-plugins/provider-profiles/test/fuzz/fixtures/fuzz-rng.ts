/** Deterministic seeded PRNG for the official-catalog fuzz suites
 * (robustness-and-proof.md §3). One fixed default seed per suite; replay a
 * failure with the PP_FUZZ_SEED / PP_FUZZ_NET_SEED env overrides and the
 * logged case index. No test-only product parameters are introduced. */

export class FuzzRng {
	private state: number;

	constructor(readonly seed: number) {
		this.state = seed >>> 0;
	}

	nextUint32(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	}

	/** Uniform integer in [0, bound). */
	int(bound: number): number {
		if (bound <= 0) throw new Error("bound must be positive");
		return this.nextUint32() % bound;
	}

	bool(trueProbability = 0.5): boolean {
		return this.int(1 / trueProbability) === 0;
	}

	pick<T>(items: readonly T[]): T {
		return items[this.int(items.length)];
	}

	/** Non-negative finite float below max, biased toward small values. */
	number(max: number): number {
		const tier = this.int(4);
		if (tier === 0) return 0;
		if (tier === 1) return this.int(Math.min(max, 1000) + 1);
		if (tier === 2) return (this.nextUint32() / 0x100000000) * max;
		return max - this.int(Math.min(max, 5) + 1);
	}
}

export function seedFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
