const UNIT_MS: Readonly<Record<string, number>> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

export function parseDuration(value: string): number | undefined {
	const match = /^(\d+)([smhd])$/i.exec(value.trim());
	if (!match) return undefined;

	const amountText = match[1];
	const unitText = match[2]?.toLowerCase();
	if (!amountText || !unitText) return undefined;

	const amount = Number.parseInt(amountText, 10);
	const unitMs = UNIT_MS[unitText];
	if (!Number.isSafeInteger(amount) || amount <= 0 || unitMs === undefined) {
		return undefined;
	}

	const durationMs = amount * unitMs;
	return Number.isSafeInteger(durationMs) ? durationMs : undefined;
}
