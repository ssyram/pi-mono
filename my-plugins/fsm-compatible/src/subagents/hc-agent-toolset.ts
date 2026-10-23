import type { HcAgentToolName } from "./hc-agent-types.ts";

export const HC_AGENT_TOOL_NAMES: readonly HcAgentToolName[] = ["agent", "agent_list", "agent_send", "agent_stop"];

export function availableAgentTools(depth: number, limit: number = 3): HcAgentToolName[] {
	return depth >= limit
		? ["agent_list", "agent_send"]
		: ["agent", "agent_list", "agent_send", "agent_stop"];
}
