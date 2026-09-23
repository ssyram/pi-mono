export function findHeader(headers: Record<string, string | null> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name.toLowerCase() && typeof value === "string" && value.trim() !== "") return value;
	}
	return undefined;
}
