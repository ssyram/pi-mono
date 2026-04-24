import type { ReviseOptions, RevisionMode } from "./types.js";

const UPT0_FLAG = "--upto";
const NO_SUMMARY_FLAG = "--no-summary";
const VISIBLE_SUMMARY_FLAG = "--visible-summary";

function parsePositiveInt(value: string | undefined): number | null {
	if (!value) return null;
	if (!/^\d+$/.test(value)) return null;
	const parsed = Number.parseInt(value, 10);
	return parsed > 0 ? parsed : null;
}

export function parseReviseArgs(args: string): ReviseOptions {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	let upto = 1;
	let mode: RevisionMode = "hidden-summary";
	let flagsDone = false;
	const promptParts: string[] = [];

	for (let i = 0; i < parts.length; i += 1) {
		const part = parts[i];
		if (!flagsDone && part === UPT0_FLAG) {
			const parsed = parsePositiveInt(parts[i + 1]);
			if (parsed == null) {
				throw new Error(`Expected a positive integer after ${UPT0_FLAG}`);
			}
			upto = parsed;
			i += 1;
			continue;
		}
		if (!flagsDone && part === NO_SUMMARY_FLAG) {
			if (mode === "visible-summary") {
				throw new Error(`Cannot combine ${NO_SUMMARY_FLAG} with ${VISIBLE_SUMMARY_FLAG}`);
			}
			mode = "no-summary";
			continue;
		}
		if (!flagsDone && part === VISIBLE_SUMMARY_FLAG) {
			if (mode === "no-summary") {
				throw new Error(`Cannot combine ${VISIBLE_SUMMARY_FLAG} with ${NO_SUMMARY_FLAG}`);
			}
			mode = "visible-summary";
			continue;
		}
		flagsDone = true;
		promptParts.push(part);
	}

	const prompt = promptParts.join(" ").trim();
	if (!prompt) {
		throw new Error("Usage: /revise [--upto N] [--no-summary | --visible-summary] prompt");
	}

	return { upto, mode, prompt };
}
