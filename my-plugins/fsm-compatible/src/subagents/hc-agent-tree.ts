import { HcAgentDomainError } from "./hc-agent-errors.ts";
import type { HcAgentMember, HcAgentRelation, HcAgentSession, HcAgentStatus } from "./hc-agent-types.ts";

const RELATION_ORDER: Record<HcAgentRelation, number> = { self: 0, parent: 1, child: 2, sibling: 3 };

function indexSessions(sessions: readonly HcAgentSession[]): Map<string, HcAgentSession> {
	const byId = new Map<string, HcAgentSession>();
	for (const session of sessions) {
		byId.set(session.session_id, session);
	}
	return byId;
}

function depthOf(session: HcAgentSession, byId: Map<string, HcAgentSession>): number {
	let depth = 0;
	let current = session;
	while (current.parent_id !== undefined) {
		const parent = byId.get(current.parent_id);
		if (!parent) throw HcAgentDomainError.agentNotFound(current.parent_id);
		depth++;
		current = parent;
	}
	return depth;
}

function toRunning(status: HcAgentSession["status"]): HcAgentStatus {
	return status === "busy" || status === "retry" ? "running" : "idle";
}

function compareSessionIds(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function agentNeighborhood(caller: string, sessions: readonly HcAgentSession[]): HcAgentMember[] {
	const byId = indexSessions(sessions);
	const self = byId.get(caller);
	if (!self) throw HcAgentDomainError.agentNotFound(caller);
	let parent: HcAgentSession | undefined;
	if (self.parent_id !== undefined) {
		parent = byId.get(self.parent_id);
		if (!parent) throw HcAgentDomainError.agentNotFound(self.parent_id);
	}
	const classified: { session: HcAgentSession; relation: HcAgentRelation }[] = [];
	for (const session of sessions) {
		if (session.session_id === caller) {
			classified.push({ session, relation: "self" });
			continue;
		}
		if (parent && session.session_id === parent.session_id) {
			classified.push({ session, relation: "parent" });
			continue;
		}
		if (session.parent_id === caller) {
			classified.push({ session, relation: "child" });
			continue;
		}
		if (parent && session.parent_id === parent.session_id) {
			classified.push({ session, relation: "sibling" });
		}
	}
	return classified
		.map(({ session, relation }) => ({
			...session,
			depth: depthOf(session, byId),
			relation,
			status: toRunning(session.status),
		}))
		.sort(
			(a, b) =>
				RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] ||
				a.time_created - b.time_created ||
				compareSessionIds(a.session_id, b.session_id),
		);
}

export function resolveAgentTarget(input: {
	caller: string;
	value: string;
	scope: "neighbor" | "child";
	sessions: readonly HcAgentSession[];
}): string {
	if (input.value.startsWith("ses")) {
		return input.value;
	}
	const scoped = agentNeighborhood(input.caller, input.sessions).filter((member) => {
		if (member.relation === "self") return false;
		return input.scope === "child" ? member.relation === "child" : true;
	});
	const matches = scoped.filter((member) => member.name === input.value).map((member) => member.session_id);
	if (matches.length === 1) {
		return matches[0] as string;
	}
	if (matches.length === 0) {
		throw HcAgentDomainError.targetNotAddressable(input.value);
	}
	throw HcAgentDomainError.targetAmbiguous(input.value, matches);
}

export function planAgentStop(caller: string, target: string, sessions: readonly HcAgentSession[]): HcAgentSession[][] {
	const byId = indexSessions(sessions);
	const targetSession = byId.get(target);
	if (!targetSession) throw HcAgentDomainError.agentNotFound(target);
	if (targetSession.parent_id !== caller) throw HcAgentDomainError.notAChild(target);
	const subtree: HcAgentSession[] = [];
	const collect = (root: HcAgentSession): void => {
		subtree.push(root);
		for (const session of sessions) {
			if (session.parent_id === root.session_id) {
				collect(session);
			}
		}
	};
	collect(targetSession);
	const groups = new Map<number, HcAgentSession[]>();
	for (const session of subtree) {
		const depth = depthOf(session, byId);
		const group = groups.get(depth);
		if (group) {
			group.push(session);
		} else {
			groups.set(depth, [session]);
		}
	}
	return [...groups.keys()]
		.sort((a, b) => b - a)
		.map((depth) => groups.get(depth) as HcAgentSession[]);
}
