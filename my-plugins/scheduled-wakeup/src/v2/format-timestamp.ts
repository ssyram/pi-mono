export function formatTimestamp(value: number): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? `epoch-ms ${value}`
		: date.toISOString();
}
