import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ASYNC_STARTED_EVENT = "subagent:async-started";
const ASYNC_COMPLETE_EVENT = "subagent:async-complete";
interface AsyncLifecycleEvent {
	id?: string;
	runId?: string;
	sessionId?: string;
}

export interface BoulderBackgroundWork {
	isActive(context: ExtensionContext): boolean;
}

export function registerBoulderBackgroundWork(pi: ExtensionAPI): BoulderBackgroundWork {
	const activeRuns = new Map<string, Set<string>>();
	pi.events.on(ASYNC_STARTED_EVENT, (payload) => {
		const event = parseLifecycleEvent(payload);
		if (!event?.id || !event.sessionId) return;
		const runs = activeRuns.get(event.sessionId) ?? new Set<string>();
		runs.add(event.id);
		activeRuns.set(event.sessionId, runs);
	});
	pi.events.on(ASYNC_COMPLETE_EVENT, (payload) => {
		const event = parseLifecycleEvent(payload);
		const runId = event?.runId ?? event?.id;
		if (!runId || !event?.sessionId) return;
		const runs = activeRuns.get(event.sessionId);
		runs?.delete(runId);
		if (runs?.size === 0) activeRuns.delete(event.sessionId);
	});
	pi.on("session_shutdown", (_event, context) => activeRuns.delete(sessionIdOf(context)));

	return {
		isActive(context) {
			return (activeRuns.get(sessionIdOf(context))?.size ?? 0) > 0;
		},
	};
}

function sessionIdOf(context: ExtensionContext): string {
	return context.sessionManager.getSessionFile() ?? context.sessionManager.getSessionId() ?? "";
}

function parseLifecycleEvent(value: unknown): AsyncLifecycleEvent | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const event = value as Record<string, unknown>;
	return {
		id: typeof event.id === "string" ? event.id : undefined,
		runId: typeof event.runId === "string" ? event.runId : undefined,
		sessionId: typeof event.sessionId === "string" ? event.sessionId : undefined,
	};
}
