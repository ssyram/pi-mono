export function formatPrintedResources(contents: string[]): string {
	if (contents.length === 0) return "";
	return (
		"\n---\nThe following comes some of the referenced SKILLs, no need to load them manually.\n---\n" +
		contents.join("\n---\n")
	);
}
