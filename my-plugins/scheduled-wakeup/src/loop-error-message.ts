export function loopErrorMessage(error: unknown): string {
	try {
		return String(error instanceof Error ? error.message : error);
	} catch {
		return "undescribable loop error";
	}
}
