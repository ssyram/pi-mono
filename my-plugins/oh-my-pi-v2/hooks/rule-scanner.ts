import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ParsedRule } from "./rule-definition.js";
import { parseRuleFrontmatter } from "./rule-frontmatter.js";

const MAX_RULE_LINES = 2000;
const RULE_EXTENSIONS = [".md", ".mdc"];

export const PROJECT_RULE_DIRS: readonly [string, string][] = [
	[".github", "instructions"],
	[".cursor", "rules"],
	[".claude", "rules"],
	[".sisyphus", "rules"],
];
export const USER_RULE_DIR = join(".claude", "rules");

export async function scanRuleDirectory(dir: string, source: string): Promise<ParsedRule[]> {
	try {
		const entries = await readdir(dir, { recursive: true });
		const files = entries.filter((file) => RULE_EXTENSIONS.some((extension) => file.endsWith(extension)));
		const rules: ParsedRule[] = [];
		for (const file of files) {
			try {
				let raw = await readFile(join(dir, file), "utf-8");
				const lineCount = raw.split("\n").length;
				if (lineCount > MAX_RULE_LINES) {
					raw = `${raw.split("\n").slice(0, MAX_RULE_LINES).join("\n")}\n\n[truncated: original had ${lineCount} lines]`;
				}
				const { metadata, body } = parseRuleFrontmatter(raw);
				rules.push({
					name: basename(file).replace(/\.(md|mdc)$/, ""),
					body,
					metadata,
					hash: createHash("sha256").update(body).digest("hex"),
					source,
				});
			} catch {}
		}
		return rules;
	} catch {
		return [];
	}
}
