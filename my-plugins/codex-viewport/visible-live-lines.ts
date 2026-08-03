function visibleLiveLines(lines: string[], terminalRows: number, trailingRows: number): string[] {
	const capacity = Math.max(0, terminalRows - trailingRows);
	if (capacity === 0) return [];
	return lines.slice(-capacity);
}

export { visibleLiveLines };
