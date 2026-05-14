import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptVariant } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

function readPrompt(name: string): string {
	return readFileSync(join(PROMPTS_DIR, name), "utf-8");
}

const promptCache = new Map<string, string>();

function getCached(name: string): string {
	let cached = promptCache.get(name);
	if (cached === undefined) {
		cached = readPrompt(name);
		promptCache.set(name, cached);
	}
	return cached;
}

export function getDistillerSystemPrompt(variant: PromptVariant): string {
	return getCached(`distiller-${variant}.md`);
}

export function getDistillerUserTemplate(variant: PromptVariant): string {
	return getCached(`distiller-user-${variant}.md`);
}

export function getImpressionTextTemplate(): string {
	return getCached("impression-text.md");
}

export function getImpressionSystemAppendTemplate(): string {
	return getCached("impression-system-append.md");
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replaceAll(`{{${key}}}`, value);
	}
	return result.trimEnd();
}
