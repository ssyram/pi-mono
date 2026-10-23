import type { HcAgentModel } from "./hc-agent-types.ts";

export function selectAgentModel(caller: HcAgentModel, pinned?: HcAgentModel): HcAgentModel {
	return pinned ?? caller;
}
