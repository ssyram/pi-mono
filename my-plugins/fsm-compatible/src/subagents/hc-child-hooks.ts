import type { DaemonRequester } from "../broker/daemon-request.ts";
import type { FsmInvoker } from "../broker/fsm-tools.ts";
import { registerProjectedTools } from "../broker/fsm-tools.ts";
import type { FsmTool } from "../broker/fsm-catalog.ts";
import { installPermissionGate } from "../gates/permission-gate.ts";
import { installStopGate } from "../gates/stop-gate.ts";
import type { JudgeSessions } from "../judge/judge-session.ts";
import type { ChildHookExtension } from "./hc-nico-factory.ts";
import { registerHcAgentTools } from "./hc-agent-tools.ts";
import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";
import type { HcSessionRecord } from "./hc-session-record.ts";

export interface HcChildHookDeps {
	readonly services: HcAgentRuntimeServices;
	readonly record: HcSessionRecord;
	readonly broker: FsmInvoker;
	readonly catalog: ReadonlyMap<string, FsmTool>;
	readonly request: DaemonRequester;
	readonly judges: JudgeSessions;
	readonly timeoutMs: number;
	readonly analysisEnabled: boolean;
	readonly permitted: readonly string[] | undefined;
}

/**
 * In-process child wiring: the child session gets the FSM tool projection,
 * the permission and stop gates, and (below the HC depth limit) the four HC
 * tools. Same-process direct method calls; no child HTTP proxy, no bootstrap.
 */
export function hcChildHook(deps: HcChildHookDeps): ChildHookExtension {
	const wire = (pi: Parameters<NonNullable<ChildHookExtension["factory"]>>[0]) => {
			const binding = () => deps.services.directory.get(deps.record.session_id).binding;
			registerProjectedTools(pi, {
				broker: deps.broker,
				catalog: deps.catalog,
				timeoutMs: deps.timeoutMs,
				ready: () => true,
				binding: () => binding(),
				// The host id is assigned by factory.create's return, after
				// session_start wired this hook; resolve it lazily at call time.
				get hostSessionId() { return deps.record.hostSessionId ?? undefined; },
			});
			// HC hook identity: session_id is always the root sid, agent_id the
			// acting child sid — the daemon's (rootSID, childSID) actor identity.
			installPermissionGate(pi, deps.request, () => {
				const current = binding();
				return { sessionId: current.rootSessionId, agentId: current.sessionId };
			}, deps.timeoutMs);
			installStopGate(pi, deps.request, () => {
				const current = binding();
				return { sessionId: current.rootSessionId, agentId: current.sessionId };
			}, deps.timeoutMs, {
				// The busy-descendant check looks below the stopping child, not
				// the root: the child itself being busy (agent_before_settle) is
				// the normal stopping path, never "live work".
				hasBusyChild: (sessionId) => {
					const current = binding();
					if (sessionId === current.rootSessionId) return deps.services.hasBusyDescendant(current.sessionId);
					return deps.services.hasBusyDescendant(sessionId);
				},
				judges: deps.judges,
				analysisEnabled: deps.analysisEnabled,
				markStopContinuation: (id) => { const r = deps.services.directory.get(id); if (r) r.turnProfile = "build"; },
			});
			registerHcAgentTools(pi, {
				services: deps.services,
				depth: deps.record.depth,
				permitted: deps.permitted,
				callerVariant: () => pi.getThinkingLevel() ?? "default",
			});
			if (process.env.FSM_DUAL_DEBUG) {
				console.error("[hc-child-tools]", deps.record.session_id, JSON.stringify(pi.getAllTools().map((t) => t.name)));
			}
	};
	return {
		name: "fsm-compatible:hc-child",
		factory: (pi) => {
			// Action methods (getAllTools, registerTool with lookups) are only
			// valid once the runtime is initialized; wire on session_start like the
			// root runtime does, not during extension loading.
			pi.on("session_start", () => {
				try {
					wire(pi);
				} catch (error) {
					console.error("[hc-child-hook-failed]", deps.record.session_id, error);
					throw error;
				}
			});
		},
	};
}
