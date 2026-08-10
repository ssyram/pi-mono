import { matchesGlob as nodeMatchesGlob } from "node:path";
import type { ParsedRule } from "./rule-definition.js";

function matchesGlob(filename: string, pattern: string): boolean {
	if (pattern.startsWith("!")) return !matchesGlob(filename, pattern.slice(1));
	try {
		return nodeMatchesGlob(filename, pattern);
	} catch {
		return false;
	}
}

export function extractReferencedFiles(systemPrompt: string): string[] {
	const filePattern = /(?:^|[\s"'`(,])([^\s"'`),]+\.\w{1,10})(?=[\s"'`),]|$)/gm;
	const files: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = filePattern.exec(systemPrompt)) !== null) {
		const candidate = match[1];
		if (candidate && !candidate.startsWith("http") && !candidate.startsWith("//") && candidate.length > 2) {
			files.push(candidate);
		}
	}
	return files;
}

export function shouldApplyRule(rule: ParsedRule, referencedFiles: string[]): boolean {
	const { metadata } = rule;
	if (!metadata.globs && metadata.alwaysApply === undefined) return true;
	if (metadata.alwaysApply === true) return true;
	if (metadata.globs && metadata.globs.length > 0) {
		return referencedFiles.some((file) => metadata.globs?.some((pattern) => matchesGlob(file, pattern)));
	}
	if (metadata.alwaysApply === false) return false;
	return true;
}
