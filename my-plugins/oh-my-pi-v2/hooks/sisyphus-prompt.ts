/**
 * Sisyphus Prompt Hook v2 - Discovers agents from .md files, injects prompt with subagent() syntax.
 *
 * Detection: skips sub-agent sessions (systemPrompt starts with "[AGENT:")
 * Injects: Sisyphus core prompt + code enforcement rules + agent list + category guidance
 */

import type { BeforeAgentStartEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CATEGORIES, type OhMyPiConfig } from "../config.js";
import { SISYPHUS_PROMPT_CORE } from "./sisyphus-prompt-core.js";
import { SISYPHUS_PROMPT_EXECUTION } from "./sisyphus-prompt-execution.js";
import { SISYPHUS_PROMPT_QUALITY } from "./sisyphus-prompt-quality.js";

// ─── Agent Discovery ─────────────────────────────────────────────────────────

export interface DiscoveredAgent {
	name: string;
	description: string;
	model?: string;
	tools?: string;
	thinking?: string;
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: content };

	const meta: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		if (line.startsWith("#")) continue; // skip YAML comments
		const idx = line.indexOf(":");
		if (idx > 0) {
			const key = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			if (key && value) meta[key] = value;
		}
	}
	return { meta, body: match[2] };
}

export async function discoverAgents(agentsDir: string): Promise<DiscoveredAgent[]> {
	const agents: DiscoveredAgent[] = [];
	try {
		const files = await readdir(agentsDir);
		for (const file of files) {
			if (!file.endsWith(".md")) continue;
			try {
				const content = await readFile(join(agentsDir, file), "utf-8");
				const { meta } = parseFrontmatter(content);
				if (meta.name) {
					agents.push({
						name: meta.name,
						description: meta.description ?? "",
						model: meta.model,
						tools: meta.tools,
						thinking: meta.thinking,
					});
				}
			} catch (err) {
				console.error(`[oh-my-pi sisyphus] Failed to read agent file ${file}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	} catch (err) {
		console.error(`[oh-my-pi sisyphus] Failed to discover agents in ${agentsDir}: ${err instanceof Error ? err.message : String(err)}`);
	}
	return agents.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Supplement Builders ─────────────────────────────────────────────────────

function buildCodeEnforcementRules(): string {
	return `
## Code Enforcement Rules (Mandatory)

These rules are NON-NEGOTIABLE. Violations must be fixed immediately.

**Rule 1: index.ts files must only re-export.**
index.ts files serve as barrel exports only. They must not contain business logic,
class definitions, utility functions, or any implementation code. Only \`export { ... } from\`
and \`export * from\` statements are permitted.

**Rule 2: No utils.ts / helpers.ts bucket files.**
Generic catch-all files like utils.ts, helpers.ts, common.ts, or shared.ts are forbidden.
Each function or utility must live in a file named after its specific purpose
(e.g., \`format-date.ts\`, \`parse-config.ts\`).

**Rule 3: Single Responsibility Principle — one concept per file.**
Each file must address exactly one concept, type, or responsibility.
If a file handles multiple unrelated concerns, split it.

**Rule 4: 200 LOC hard limit per file.**
No source file may exceed 200 lines of code (excluding blank lines and comments).
If a file approaches this limit, decompose it into smaller, focused modules.`;
}

function buildAgentList(agents: DiscoveredAgent[]): string {
	if (agents.length === 0) return "";

	const lines = ["\n## Available Agents\n"];
	for (const agent of agents) {
		lines.push(`- **${agent.name}** (${agent.description})`);
	}
	return lines.join("\n");
}

function buildCategoryGuidance(config: OhMyPiConfig): string {
	const cats = { ...DEFAULT_CATEGORIES };
	if (config.categories) {
		for (const [name, override] of Object.entries(config.categories)) {
			if (cats[name]) {
				cats[name] = { ...cats[name], ...override } as typeof cats[string];
			}
		}
	}

	const lines = ["\n## Category → Agent Mapping\n"];
	lines.push("When delegating, pick the category that matches the task domain, then use the suggested agent:\n");
	lines.push("| Category | Agent | Model Preference | Domain |");
	lines.push("|---|---|---|---|");
	for (const [name, cat] of Object.entries(cats)) {
		lines.push(`| ${name} | ${cat.agent} | ${cat.model} | ${cat.description} |`);
	}
	lines.push("\nUse `subagent({agent: \"<agent>\", task: \"...\"})` to delegate.");
	lines.push("Use `subagent({tasks: [{agent: \"...\", task: \"...\"}, ...]})` for parallel execution.");
	return lines.join("\n");
}

// ─── Core Sisyphus Prompt ────────────────────────────────────────────────────

const SISYPHUS_PROMPT =
	SISYPHUS_PROMPT_CORE + SISYPHUS_PROMPT_EXECUTION + SISYPHUS_PROMPT_QUALITY;

// ─── Hook Registration ───────────────────────────────────────────────────────

export function registerSisyphusPrompt(
	pi: ExtensionAPI,
	config: OhMyPiConfig,
	agentsDir: string,
): void {
	let agents: DiscoveredAgent[] = [];
	const agentsReady = discoverAgents(agentsDir)
		.then((a) => {
			agents = a;
		})
		.catch((err: unknown) => {
			console.error(`[oh-my-pi sisyphus] Agent discovery failed: ${err instanceof Error ? err.message : String(err)}`);
		});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		try {
			await agentsReady;

			// Sub-agent detection: "[AGENT:" prefix is set by omp-v1's call-agent/delegate-task.
			// pi-subagents (v2) spawns separate processes, so this hook typically doesn't run
			// in sub-agent contexts at all. The check remains for v1 backward compatibility.
			if (ctx.getSystemPrompt().startsWith("[AGENT:")) return undefined;

			const supplements = [buildCodeEnforcementRules(), buildAgentList(agents), buildCategoryGuidance(config)]
				.filter(Boolean)
				.join("\n");

			return {
				systemPrompt: event.systemPrompt + "\n\n" + SISYPHUS_PROMPT + supplements,
			};
		} catch (err) {
			console.error(`[oh-my-pi sisyphus] Prompt injection failed: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	});
}
