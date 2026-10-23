import { HcAgentDomainError } from "./hc-agent-errors.ts";
import { escapeAgentField, renderAgentMessage } from "./hc-agent-message.ts";
import { planAgentStop, resolveAgentTarget } from "./hc-agent-tree.ts";
import type { HcStopOutcome } from "./hc-agent-types.ts";
import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";
import type { HcSessionRecord } from "./hc-session-record.ts";

export interface HcAgentStopInput {
	readonly caller: string;
	readonly target: string;
}

/** HC lifecycle.ts:477-491: one cancellation notice from the target to the caller. */
function renderTermination(record: HcSessionRecord, descendants: number): string {
	const agent = escapeAgentField(record.agent_type ?? "agent");
	const who = record.name ? `${escapeAgentField(record.name)} (${agent})` : agent;
	return [
		`Agent cancelled: ${who}`,
		`session_id: ${record.session_id}`,
		`title: ${escapeAgentField(record.title)}`,
		...(descendants > 0 ? [`Its ${descendants} descendant Agent(s) were stopped as well.`] : []),
		"Its session and history are intact; it can be resumed with agent_send.",
	].join("\n");
}

/**
 * HC AgentLifecycle.stop: direct-child check in the planner, deepest layer
 * first with same-layer concurrency, one caller notice, no dispose, no delete.
 */
export async function stopHcAgent(services: HcAgentRuntimeServices, input: HcAgentStopInput): Promise<HcStopOutcome> {
	const resolved = resolveAgentTarget({
		caller: input.caller,
		value: input.target,
		scope: "child",
		sessions: services.directory.toAgentSessions(),
	});
	if (!services.directory.find(resolved)) throw HcAgentDomainError.agentNotFound(resolved);
	const layers = planAgentStop(input.caller, resolved, services.directory.toAgentSessions());
	const outcome: HcStopOutcome = { stopped: [], failed: [] };
	for (const layer of layers) {
		const results = await Promise.allSettled(layer.map(async (session) => {
			const record = services.directory.get(session.session_id);
			await services.host.cancel(record);
		}));
		for (let index = 0; index < results.length; index++) {
			const sessionId = layer[index]!.session_id;
			const result = results[index]!;
			if (result.status === "fulfilled") outcome.stopped.push(sessionId);
			else outcome.failed.push({ session_id: sessionId, reason: String(result.reason) });
		}
	}
	const target = services.directory.get(resolved);
	try {
		await services.deliverMessage({
			target: input.caller,
			sender: target.session_id,
			sender_name: target.name,
			sender_agent: target.agent_type,
			body: renderTermination(target, outcome.stopped.length - 1),
		});
	} catch {
		/* notice delivery failure is not part of the stop result (HC Effect.ignore) */
	}
	return outcome;
}
