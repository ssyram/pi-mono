import type { RuleMetadata } from "./rule-definition.js";

function stripQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function parseGlobsValue(rawValue: string, lines: string[], currentIndex: number): string[] {
	if (rawValue.startsWith("[")) {
		return rawValue
			.slice(1, rawValue.lastIndexOf("]"))
			.split(",")
			.map((value) => stripQuotes(value.trim()))
			.filter((value) => value.length > 0);
	}
	if (!rawValue) {
		const items: string[] = [];
		for (let index = currentIndex + 1; index < lines.length; index += 1) {
			const match = lines[index].match(/^\s+-\s*(.+)$/);
			if (match) items.push(stripQuotes(match[1].trim()));
			else if (lines[index].trim() !== "") break;
		}
		return items;
	}
	const value = stripQuotes(rawValue);
	if (!value.includes(",")) return value ? [value] : [];
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function parseSimpleYaml(yaml: string): RuleMetadata {
	const lines = yaml.split("\n");
	const metadata: RuleMetadata = {};
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		const colonIndex = line.indexOf(":");
		if (colonIndex < 0) {
			index += 1;
			continue;
		}
		const key = line.slice(0, colonIndex).trim();
		const rawValue = line.slice(colonIndex + 1).trim();
		if (key === "description") metadata.description = stripQuotes(rawValue);
		else if (key === "alwaysApply") metadata.alwaysApply = rawValue === "true";
		else if (key === "globs" || key === "paths" || key === "applyTo") {
			metadata.globs = [...(metadata.globs ?? []), ...parseGlobsValue(rawValue, lines, index)];
			if (!rawValue) {
				index += 1;
				while (index < lines.length && /^\s+-\s/.test(lines[index])) index += 1;
				continue;
			}
		}
		index += 1;
	}
	return metadata;
}

export function parseRuleFrontmatter(raw: string): { metadata: RuleMetadata; body: string } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { metadata: {}, body: raw };
	try {
		return { metadata: parseSimpleYaml(match[1]), body: match[2] };
	} catch {
		return { metadata: {}, body: raw };
	}
}
