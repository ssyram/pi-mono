const UNITS = [
	{ suffix: "y", seconds: 365 * 86_400 },
	{ suffix: "M", seconds: 30 * 86_400 },
	{ suffix: "d", seconds: 86_400 },
	{ suffix: "h", seconds: 3_600 },
	{ suffix: "m", seconds: 60 },
	{ suffix: "s", seconds: 1 },
] as const;

export function formatDuration(ms: number): string {
	let rest = Math.ceil(ms / 1000);
	if (rest <= 0) return "0s";
	const parts: string[] = [];
	for (const unit of UNITS) {
		const value = Math.floor(rest / unit.seconds);
		if (value > 0) {
			parts.push(`${value}${unit.suffix}`);
			rest -= value * unit.seconds;
		}
	}
	return parts.join("");
}
