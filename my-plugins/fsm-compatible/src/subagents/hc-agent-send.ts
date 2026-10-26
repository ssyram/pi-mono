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
	// Cross-tree targets are absent here by design; find (not get) so the
	// cross-tree branch below can take over instead of throwing.
	const target = services.directory.find(resolved);
	const rendered = renderAgentMessage({
		target: resolved,
		sender: caller.session_id,
		sender_name: caller.name,
		sender_agent: caller.turnProfile ?? caller.agent_type,
		body: input.message,
	});
	if (!target) {
		if (!services.crossTree) throw HcAgentDomainError.agentNotFound(resolved);
		const outcome = await deliverCrossTree(services.crossTree, resolved, rendered);
		if (outcome === "unknown") throw HcAgentDomainError.agentNotFound(resolved);
		return { resolved };
	}
	// Root-bound messages go to the root conversation (sendUserMessage), never
	// through the child-session host: the root record intentionally has no
	// child handle or session file.
	if (target.session_id === services.root.rootSessionId) {
		await services.deliverMessage({ target: resolved, sender: caller.session_id,
			sender_name: caller.name, sender_agent: caller.turnProfile ?? caller.agent_type, body: input.message });
		return { resolved };
	}
	// One inbox path for every target: the runtime's deliverRendered owns
	// handle-open, turn-profile reset, and the HC roster block on idle wakes.
	const delivered = await services.deliverRendered(resolved, rendered);
	if (!delivered) throw HcAgentDomainError.agentNotFound(resolved);
	return { resolved };
}
