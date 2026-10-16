export function validOnceTime(value: number): boolean {
	return (
		Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000
	);
}
