export interface KeepRecentOptions {
	count: number;
	summary: boolean;
	assistantCut: boolean;
}

export function parseArgs(args: string): KeepRecentOptions {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	let count: number | null = null;
	let summary = true; // default
	let summaryFlag: "summary" | "no-summary" | null = null;
	let assistantCut = false;

	for (const part of parts) {
		if (part === "--summary") {
			if (summaryFlag === "no-summary") {
				throw new Error("Cannot combine --summary with --no-summary");
			}
			summaryFlag = "summary";
			summary = true;
		} else if (part === "--no-summary") {
			if (summaryFlag === "summary") {
				throw new Error("Cannot combine --no-summary with --summary");
			}
			summaryFlag = "no-summary";
			summary = false;
		} else if (part === "--assistant-cut") {
			assistantCut = true;
		} else if (/^\d+$/.test(part)) {
			if (count !== null) {
				throw new Error("Multiple count values provided");
			}
			count = Number.parseInt(part, 10);
		} else {
			throw new Error(`Unknown argument: ${part}`);
		}
	}

	if (count === null) {
		throw new Error("Usage: /keep-recent [--summary | --no-summary] [--assistant-cut] N");
	}

	if (count <= 0) {
		throw new Error("Count must be greater than 0");
	}

	return { count, summary, assistantCut };
}
