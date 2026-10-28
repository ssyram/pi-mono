import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { classifyHcRunOutcome, renderAgentNotification, type HcDelegationOutcome } from "./hc-agent-delegation.ts";
import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";
import { recordInboxSidecar } from "./hc-inbox-sidecar.ts";
import type { HcSessionRecord } from "./hc-session-record.ts";

function isAssistant(message: AgentMessage): message is AssistantMessage {
	return (message as AssistantMessage).role === "assistant";
}

function isToolResult(message: AgentMessage): message is ToolResultMessage {
	return (message as ToolResultMessage).role === "toolResult";
}

/** Split a finished run's messages into the final assistant and its tool results (HC parts projection). */
export function classifyFromRun(messages: readonly AgentMessage[], sessionId: string): HcDelegationOutcome {
	const finalAssistant = messages.findLast(isAssistant);
	const toolResults = messages.filter(isToolResult);
	return classifyHcRunOutcome({ finalAssistant, toolResults }, sessionId);
}

function liveDescendantExists(services: HcAgentRuntimeServices, record: HcSessionRecord): boolean {
	return services.directory
		.descendants(record.session_id)
		.some((descendant) => descendant.status === "busy" || descendant.status === "retry");
}

function reportableNow(services: HcAgentRuntimeServices, record: HcSessionRecord): boolean {
	if (services.host.hasQueuedInput(record)) return false;
	return !liveDescendantExists(services, record);
}

function reportableWhy(services: HcAgentRuntimeServices, record: HcSessionRecord): string {
	if (services.host.hasQueuedInput(record)) return "queued-input";
	return liveDescendantExists(services, record) ? "live-descendant" : "ok";
}

async function deliverParentNotice(services: HcAgentRuntimeServices, record: HcSessionRecord, outcome: HcDelegationOutcome): Promise<void> {
	const parentId = record.parent_id;
	if (parentId === undefined) return;
	const state = outcome.kind === "completed" ? "completed" : "error";
	const description = record.description || record.title;
	const summary = outcome.kind === "completed" ? `Agent completed: ${description}` : `Agent failed: ${description}`;
	const text = outcome.kind === "cancelled" ? "" : renderAgentNotification({ sessionId: record.session_id, state, summary, text: outcome.text });
	const parent = services.directory.get(parentId);
	if (parent.session_id === services.root.rootSessionId) {
		// HC lifecycle.ts:456: completion notices travel the inbox (a user
		// message, steered in when busy), never a flush-at-turn-boundary
		// custom channel — the latter races the parent's next model step.
		await services.deliverRendered(parentId, text);
		return;
	}
	if (!parent.handle) {
		await services.host.open(parent, services.launchPlan(parent), services.observe);
	}
	recordInboxSidecar(parent, text);
	await services.host.deliver(parent, text);
}

/**
 * HC prompt.ts run-end reporting: cancelled settles only; completed/failed are
 * delivered once no user turn is pending and the subtree is quiet. Deferred
 * reports re-enter through recheckDeferred when any later run settles.
 */
export async function reportHcRunEnd(services: HcAgentRuntimeServices, deferred: Set<string>, record: HcSessionRecord, outcome: HcDelegationOutcome): Promise<void> {
	if (record.parent_id === undefined || !record.notify) return;
	if (outcome.kind === "cancelled") {
		await services.publishDelegation(record, "settled");
		return;
	}
	if (!reportableNow(services, record)) {
		if (process.env.FSM_DUAL_DEBUG) console.error("REPORT-DEFER", record.session_id, reportableWhy(services, record));
		deferred.add(record.session_id);
		// A freshly settled session's queued-input flag can read true for a
		// moment; deferral must not wait for the *next* settle event (a busy
		// parent waiting on this very report would deadlock past its
		// deadline). Self-recheck on a short timer.
		const once = setTimeout(() => { void recheckDeferredHcReports(services, deferred); }, 150);
		once.unref?.();
		return;
	}
	deferred.delete(record.session_id);
	try {
		await deliverParentNotice(services, record, outcome);
	} finally {
		await services.publishDelegation(record, "settled");
	}
}

export async function recheckDeferredHcReports(services: HcAgentRuntimeServices, deferred: Set<string>): Promise<void> {
	for (const sessionId of [...deferred]) {
		const record = services.directory.find(sessionId);
		if (!record || record.status !== "idle") {
			if (!record) deferred.delete(sessionId);
			continue;
		}
		if (!reportableNow(services, record)) continue;
		const outcome = record.lastOutcome;
		if (!outcome) {
			deferred.delete(sessionId);
			continue;
		}
		deferred.delete(sessionId);
		try {
			await deliverParentNotice(services, record, outcome);
		} finally {
			await services.publishDelegation(record, "settled");
		}
	}
}
