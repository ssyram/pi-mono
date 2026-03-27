/**
 * Sisyphus Prompt Hook - Injects supplementary rules into the system prompt.
 *
 * Adds (only to the primary Sisyphus agent, not sub-agents):
 * 1. Code enforcement rules (4 rules)
 * 2. Available agents list (dynamic from agents map)
 *
 * NOTE: Pending task injection is handled exclusively by task.ts to avoid
 * double injection into the system prompt.
 *
 * Phase 0-3 orchestration instructions are defined in the agent's own systemPrompt
 * (sisyphus.ts) and are NOT duplicated here.
 */

import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import type { AgentDef } from "../agents/types.js";

// Phase 0-3 and Category Routing Table are defined in sisyphus.ts systemPrompt.
// This hook only adds code enforcement rules and available agents.

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

export function registerSisyphusPrompt(
  pi: ExtensionAPI,
  agents: Map<string, AgentDef>,
): void {
  pi.on(
    "before_agent_start",
    async (event: BeforeAgentStartEvent, _ctx) => {
      try {
        // Skip injection for sub-agents that don't need orchestration
        if (!event.systemPrompt.includes("Phase 0") &&
            !event.systemPrompt.includes("Intent Gate") &&
            !event.systemPrompt.includes("Sisyphus")) {
          return undefined;
        }

        const injection = [
          buildCodeEnforcementRules(),
          buildAgentList(agents),
        ]
          .filter(Boolean)
          .join("\n");

        return {
          systemPrompt: event.systemPrompt + injection,
        };
      } catch {
        // Hooks must never throw
        return undefined;
      }
    },
  );
}
