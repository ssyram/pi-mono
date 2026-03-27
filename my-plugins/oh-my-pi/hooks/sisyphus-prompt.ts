/**
 * Sisyphus Prompt Hook - Injects the Sisyphus agent prompt into the main session.
 *
 * Detection logic:
 * - If systemPrompt starts with "[AGENT:" → this is a sub-agent session → skip
 * - Otherwise → this is the main session → inject Sisyphus core prompt + supplements
 *
 * Supplements (appended after core prompt):
 * 1. Code enforcement rules (4 rules)
 * 2. Available agents list (dynamic from agents map)
 *
 * NOTE: Pending task injection is handled exclusively by task.ts to avoid
 * double injection into the system prompt.
 */

import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import type { AgentDef } from "../agents/types.js";
import { resolvePrompt } from "../agents/types.js";

// ─── Supplement builders ─────────────────────────────────────────────────────

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

function buildAgentList(agents: Map<string, AgentDef>): string {
	if (agents.size === 0) return "";

	const lines = ["\n## Available Agents\n"];
	agents.forEach((agent, name) => {
		lines.push(
			`- **${name}** (${agent.toolPreset}): ${agent.description}`,
		);
	});
	return lines.join("\n");
}

// ─── Hook registration ──────────────────────────────────────────────────────

export function registerSisyphusPrompt(
	pi: ExtensionAPI,
	agents: Map<string, AgentDef>,
): void {
	// Resolve the primary agent definition once at registration time
	const sisyphusDef = agents.get("sisyphus");

	pi.on(
		"before_agent_start",
		async (event: BeforeAgentStartEvent, ctx) => {
			try {
				// Sub-agent sessions are prefixed with [AGENT:xxx] → skip injection
				if (ctx.getSystemPrompt().startsWith("[AGENT:")) return undefined;

				// No Sisyphus agent definition available → skip
				if (!sisyphusDef) return undefined;

				// Resolve model-appropriate prompt variant
				const corePrompt = ctx.model
					? resolvePrompt(sisyphusDef, ctx.model)
					: sisyphusDef.systemPrompt;

				// Build supplements
				const supplements = [
					buildCodeEnforcementRules(),
					buildAgentList(agents),
				]
					.filter(Boolean)
					.join("\n");

				return {
					systemPrompt: event.systemPrompt + "\n\n" + corePrompt + supplements,
				};
			} catch {
				// Hooks must never throw
				return undefined;
			}
		},
	);
}
