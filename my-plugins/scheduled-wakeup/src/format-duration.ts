const UNITS = [
	{ suffix: "d", ms: 86_400_000 },
	{ suffix: "h", ms: 3_600_000 },
	{ suffix: "m", ms: 60_000 },
	{ suffix: "s", ms: 1_000 },
] as const;

export function formatDuration(ms: number): string {
	for (const unit of UNITS) {
		if (ms % unit.ms === 0) return `${ms / unit.ms}${unit.suffix}`;
	}

	return `${Math.ceil(ms / 1_000)}s`;
}
