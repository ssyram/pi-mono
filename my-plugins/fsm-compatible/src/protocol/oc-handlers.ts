import { OcHttpError } from "./oc-route.ts";
import type { OcHandlers } from "./oc-server.ts";
import type { RecordStore } from "../records/record-store.ts";
import { projectOcMessages } from "../records/oc-messages.ts";
import { projectOcRoster, projectOcStatuses } from "../records/oc-roster.ts";
import type { JudgeSessions } from "../judge/judge-session.ts";
import { parseJudgeInput } from "../judge/judge-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { ExecutionRecord } from "../records/session-record.ts";
import type { AdvisoryQueue } from "../watch/advisory-queue.ts";

function requireExecution(store: RecordStore, sessionId: string): ExecutionRecord {
	const record = store.getExecution(sessionId);
	if (!record) {
		if (store.getJudge(sessionId)) throw new OcHttpError(403);
		throw new OcHttpError(404);
	}
	return record;
}
function requireJudge(store: RecordStore, sessionId: string): void {
	if (store.getExecution(sessionId)) throw new OcHttpError(403);
	if (!store.getJudge(sessionId)) throw new OcHttpError(404);
}

/** Wires the OC HTTP surface to the real record store and judge sessions. */
export function createOcHandlers(store: RecordStore, judges: JudgeSessions, extras?: {
	launchAck?: (bootstrapRef: string, childSessionId: string) => void;
	advisories?: AdvisoryQueue;
	refresh?: () => void;
	abortExecution?: (id: string) => Promise<true>;
	agentMessage?: (target: string, message: string) => Promise<boolean>;
}): OcHandlers {
	return {
		roster: () => { extras?.refresh?.(); return projectOcRoster(store); },
		statuses: () => { extras?.refresh?.(); return Object.fromEntries(projectOcStatuses(store)); },
		session: (id) => {
			extras?.refresh?.();
			const roster = projectOcRoster(store).find((session) => session.id === id);
			if (roster) return roster;
			requireExecution(store, id);
			throw new OcHttpError(404);
		},
		children: (id) => {
			extras?.refresh?.();
			if (store.getJudge(id) && !store.getExecution(id)) return [];
			// The wire id space is protocol sids; the store keys executions by
			// host id, so resolve the root host id before matching children.
			const resolved = store.getExecution(id) ? id : (id === store.rootProtocolId ? store.rootId : null);
			requireExecution(store, resolved ?? id);
			return projectOcRoster(store)
				.filter((session) => session.parentID === id)
				.map((session) => ({ id: session.id, title: session.title ?? null }));
		},
		messages: (id) => { extras?.refresh?.(); return projectOcMessages(requireExecution(store, id)); },
		async createSession(body) {
			if (typeof body !== "object" || body === null || Array.isArray(body)
				|| (body as { title?: unknown }).title !== "fsm-gate"
				|| Object.keys(body).length !== 1) throw new OcHttpError(400);
			try {
				return { id: judges.create() };
			} catch (error) {
				if (error instanceof RuntimeError && error.code === "queue-full") throw new OcHttpError(503);
				throw error;
			}
		},
		async postMessage(id, body) {
			requireJudge(store, id);
			let input;
			try {
				input = parseJudgeInput(body);
			} catch (error) {
				if (error instanceof RuntimeError && error.code === "protocol-invalid") throw new OcHttpError(400);
				throw error;
			}
			try {
				return await judges.run(id, input);
			} catch (error) {
				if (error instanceof RuntimeError && error.code === "queue-full") throw new OcHttpError(409);
				throw error;
			}
		},
		async abort(id) {
			extras?.refresh?.();
			if (store.getExecution(id) && extras?.abortExecution) return extras.abortExecution(id);
			requireJudge(store, id);
			return judges.abort(id);
		},
		async promptAsync(id, body) {
			requireExecution(store, id);
			if (!extras?.advisories) throw new RuntimeError("not-ready");
			try {
				extras.advisories.accept(id, body);
			} catch (error) {
				if (error instanceof RuntimeError && error.code === "protocol-invalid") throw new OcHttpError(400);
				throw error;
			}
		},
		...(extras?.agentMessage ? { agentMessage: async (body: unknown) => {
			if (typeof body !== "object" || body === null || Array.isArray(body)
				|| typeof (body as { target?: unknown }).target !== "string"
				|| typeof (body as { message?: unknown }).message !== "string") throw new OcHttpError(400);
			const delivered = await extras.agentMessage?.((body as { target: string }).target, (body as { message: string }).message);
			if (!delivered) throw new OcHttpError(404);
			return { ok: true };
		} } : {}),
		...(extras?.launchAck ? { launchAck: (body: unknown) => {
			if (typeof body !== "object" || body === null || typeof (body as { bootstrapRef?: unknown }).bootstrapRef !== "string"
				|| typeof (body as { sessionId?: unknown }).sessionId !== "string") throw new OcHttpError(400);
			try {
				extras.launchAck?.((body as { bootstrapRef: string }).bootstrapRef, (body as { sessionId: string }).sessionId);
				return { ok: true };
			} catch (error) {
				if (error instanceof RuntimeError && error.code === "not-ready") throw new OcHttpError(404);
				throw error;
			}
		} } : {}),
	};
}
