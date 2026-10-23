import type { HcAgentModel } from "./hc-agent-types.ts";

export interface HcAgentDefinition {
	readonly name: string;
	readonly description: string;
	readonly mode: "subagent" | "primary" | "all";
	readonly hidden: boolean;
	readonly tools: readonly string[] | undefined;
	readonly excludeTools: readonly string[];
	readonly model: HcAgentModel | undefined;
}

const GENERAL_DESCRIPTION =
	"General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.";

const EXPLORE_DESCRIPTION =
	'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg "src/components/**/*.tsx"), search code for keywords (eg "API endpoints"), or answer questions about the codebase (eg "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.';

/** HC native agent types (packages/opencode/src/agent/agent.ts at the fixed baseline). */
export const HC_NATIVE_AGENT_DEFINITIONS: readonly HcAgentDefinition[] = Object.freeze([
	Object.freeze({
		name: "general",
		description: GENERAL_DESCRIPTION,
		mode: "subagent",
		hidden: false,
		tools: undefined,
		excludeTools: Object.freeze(["codemode"]),
		model: undefined,
	}),
	Object.freeze({
		name: "explore",
		description: EXPLORE_DESCRIPTION,
		mode: "subagent",
		hidden: false,
		tools: Object.freeze(["read", "grep", "find", "ls", "bash"]),
		excludeTools: Object.freeze(["codemode"]),
		model: undefined,
	}),
]);

export function findHcAgentDefinition(catalog: readonly HcAgentDefinition[], type: string): HcAgentDefinition | undefined {
	return catalog.find((definition) => definition.name === type);
}

/** Unknown-type error list: every non-hidden catalog name (HC agent.ts list order, not the description filter). */
export function hcAgentAvailableNames(catalog: readonly HcAgentDefinition[]): string[] {
	return catalog.filter((definition) => !definition.hidden).map((definition) => definition.name);
}

/**
 * Dynamic `agent` description suffix: non-primary definitions the caller may use,
 * sorted by name. `permitted` is the FSM admission's agent set for this runtime.
 */
export function hcAgentDescriptionLines(
	catalog: readonly HcAgentDefinition[],
	permitted: readonly string[] | undefined,
): string[] {
	const allowed = permitted ? new Set(permitted) : undefined;
	return catalog
		.filter((definition) => definition.mode !== "primary" && !definition.hidden)
		.filter((definition) => allowed === undefined || allowed.has(definition.name))
		.toSorted((left, right) => left.name.localeCompare(right.name))
		.map((definition) => `- ${definition.name}: ${definition.description}`);
}
