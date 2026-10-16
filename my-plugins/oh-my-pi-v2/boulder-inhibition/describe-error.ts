export function describeThrown(error: unknown): string {
	try {
		return String(error instanceof Error ? error.message : error);
	} catch {
		return "undescribable error";
	}
}
