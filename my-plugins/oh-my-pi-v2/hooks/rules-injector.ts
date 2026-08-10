import { homedir } from "node:os";
import { join } from "node:path";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OhMyPiConfig } from "../config.js";
import { extractReferencedFiles, shouldApplyRule } from "./rule-applicability.js";
import type { ParsedRule } from "./rule-definition.js";
import { PROJECT_RULE_DIRS, scanRuleDirectory, USER_RULE_DIR } from "./rule-scanner.js";

export function registerRulesInjector(pi: ExtensionAPI, config: OhMyPiConfig): void {
	const injectedHashes = new WeakMap<ExtensionContext["sessionManager"], Set<string>>();
	const hashesFor = (context: ExtensionContext): Set<string> => {
		const existing = injectedHashes.get(context.sessionManager);
		if (existing) return existing;
		const created = new Set<string>();
		injectedHashes.set(context.sessionManager, created);
		return created;
	};
	pi.on("session_start", (_event, context) => {
		injectedHashes.set(context.sessionManager, new Set());
	});
	pi.on("session_shutdown", (_event, context) => {
		injectedHashes.delete(context.sessionManager);
	});
	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, context) => {
		try {
			if (config.sisyphus_rules_enabled === false) return undefined;
			const scans: Promise<ParsedRule[]>[] = PROJECT_RULE_DIRS.map(([parent, subdir]) =>
				scanRuleDirectory(join(context.cwd, parent, subdir), `${parent}/${subdir}`),
			);
			scans.push(scanRuleDirectory(join(homedir(), USER_RULE_DIR), "~/.claude/rules"));
			const rules = (await Promise.all(scans)).flat();
			if (rules.length === 0) return undefined;
			const referencedFiles = extractReferencedFiles(event.systemPrompt);
			const hashes = hashesFor(context);
			const applicable: ParsedRule[] = [];
			for (const rule of rules) {
				if (hashes.has(rule.hash) || !shouldApplyRule(rule, referencedFiles)) continue;
				hashes.add(rule.hash);
				applicable.push(rule);
			}
			if (applicable.length === 0) return undefined;
			const rulesContent = applicable
				.map((rule) => `### ${rule.name} <sub>(${rule.source})</sub>\n\n${rule.body}`)
				.join("\n\n");
			return {
				systemPrompt: `${event.systemPrompt}\n## Project Rules\n\n${rulesContent}`,
			};
		} catch {
			return undefined;
		}
	});
}
