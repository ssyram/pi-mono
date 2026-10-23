import { HcAgentDomainError } from "./hc-agent-errors.ts";
import { renderAgentMessage } from "./hc-agent-message.ts";
import { resolveAgentTarget } from "./hc-agent-tree.ts";
import { deliverCrossTree } from "./hc-session-registry.ts";
import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";

export interface HcAgentSendInput {
	readonly caller: string;
	readonly target: string;
	readonly message: string;
}

/**
 * HC AgentInbox.deliver: resolve in the caller's neighbourhood, refuse self,
 * take the target's own identity, and hand the rendered message to async
 * delivery. Accepted means scheduled, nothing more.
 */
export async function sendHcAgent(services: HcAgentRuntimeServices, input: HcAgentSendInput): Promise<{ resolved: string }> {
	const resolved = resolveAgentTarget({
		caller: input.caller,
		value: input.target,
		scope: "neighbor",
		sessions: services.directory.toAgentSessions(),
	});
	if (resolved === input.caller) throw HcAgentDomainError.selfDelivery();
	const caller = services.directory.get(input.caller);
	const target = services.directory.get(resolved);
	const rendered = renderAgentMessage({
		target: resolved,
		sender: caller.session_id,
		sender_name: caller.name,
		sender_agent: caller.agent_type,
		body: input.message,
	});
	if (!target) {
		if (!services.crossTree) throw HcAgentDomainError.agentNotFound(resolved);
		const outcome = await deliverCrossTree(services.crossTree, resolved, rendered);
		if (outcome === "unknown") throw HcAgentDomainError.agentNotFound(resolved);
		return { resolved };
	}
	if (!target.handle) {
		await services.host.open(target, services.launchPlan(target), services.observe);
	}
	await services.host.deliver(target, rendered);
	return { resolved };
}
