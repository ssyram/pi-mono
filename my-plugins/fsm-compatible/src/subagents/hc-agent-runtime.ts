import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import type { RootBinding } from "../binding/actor-binding.ts";
import type { DaemonRequester } from "../broker/daemon-request.ts";
import { requireDaemonOk } from "../broker/daemon-request.ts";
import type { FsmInvoker } from "../broker/fsm-tools.ts";
import type { FsmTool } from "../broker/fsm-catalog.ts";
import type { JudgeSessions } from "../judge/judge-session.ts";
import type { RecordStore } from "../records/record-store.ts";
import type { FsmCompatibleConfig } from "../runtime/runtime-config.ts";
import { createHcAgent } from "./hc-agent-create.ts";
import { findHcAgentDefinition, HC_NATIVE_AGENT_DEFINITIONS, type HcAgentDefinition } from "./hc-agent-definitions.ts";
import { renderAgentMessage } from "./hc-agent-message.ts";
import { classifyFromRun, recheckDeferredHcReports, reportHcRunEnd } from "./hc-agent-report.ts";
import type { HcAgentMessage, HcAgentModel } from "./hc-agent-types.ts";
import type { HcAgentRuntimeServices } from "./hc-agent-services.ts";
import { HcNicoSessionHost, hcModelRef, type HcNicoLaunchPlan } from "./hc-nico-host.ts";
import { HC_SESSION_ENTRY, HcSessionDirectory, makeRootRecord, readHcSessionSnapshots } from "./hc-session-directory.ts";
import type { HcSessionRecord, HcSessionSnapshot } from "./hc-session-record.ts";
import type { CrossTreeRegistry } from "./hc-session-registry.ts";
import { publishHcExecution } from "./hc-record-publish.ts";
import { hcFleetView, type FleetView } from "./hc-fleet-view.ts";
import { hcChildHook } from "./hc-child-hooks.ts";
import type { ChildSessionEvent, ChildSessionFactory } from "./hc-nico-factory.ts";
import { HcFleetExternalBridge } from "../tui/hc-fleet-external.ts";

export interface HcRuntimeDeps {
	/** Shared registry publishing this tree's sids for cross-tree agent_send. */
	readonly crossTree?: CrossTreeRegistry;
	readonly bridgeUrl?: string;
	readonly bridgePassword?: string;
	readonly pi: ExtensionAPI;
	readonly ctx: ExtensionContext;
	readonly config: FsmCompatibleConfig;
	readonly policy: AdmissionPolicy;
	readonly binding: RootBinding;
	readonly store: RecordStore;
	readonly broker: FsmInvoker;
	readonly catalog: ReadonlyMap<string, FsmTool>;
	readonly request: DaemonRequester;
	readonly judges: JudgeSessions;
	/** Injection seam for headless smoke runs; production uses the default Nico factory. */
	readonly hostFactory?: () => ChildSessionFactory;
}

export interface HcRuntimeHandle {
	readonly services: HcAgentRuntimeServices;
	readonly fleet: FleetView;
	busy(sessionId: string): boolean;
	abort(sessionId: string): Promise<true>;
	refresh(): void;
	manualLaunch(input: { description: string; prompt: string; subagent_type: string; name?: string; cwd?: string; model: HcAgentModel; variant: string }): Promise<{ session_id: string }>;
	close(): Promise<void>;
}

/** HC applyAgentRoster parity: a sentinel-marked block on the last user
 * message naming the session's direct children (running rows, else a
 * none-(N idle) summary). */
function withAgentRoster(directory: HcSessionDirectory, sessionId: string, text: string): string {
	const children = directory.list().filter((record) => record.parent_id === sessionId);
	if (children.length === 0) return text;
	const live = children
		.filter((record) => record.status === "busy" || record.status === "retry")
		.sort((left, right) => right.time_created - left.time_created);
	const shown = live.slice(0, 10);
	const rows = shown.map((record) => `  ${record.session_id}  ${record.name ?? ""}  — ${record.title}`);
	const roster = [
		"<!-- opencode:subagents -->",
		shown.length === 0
			? `Your subagents working right now: none (${children.length - live.length} idle).`
			: "Your subagents working right now:",
		...rows,
		...(live.length > 10 ? [`  ${live.length - 10} more are running.`] : []),
	].join("\n");
	return `${text}\n${roster}`;
}

/** Owning runtime for one HC session tree; children are in-process Nico sessions. */
export async function openHcAgentRuntime(deps: HcRuntimeDeps): Promise<HcRuntimeHandle> {
	const { pi, ctx, config, policy, binding, store, request } = deps;
	const crossTree = deps.crossTree;
	const stateDirectory = join(getAgentDir(), "fsm-compatible", binding.rootSessionId);
	const directory = new HcSessionDirectory(binding, readHcSessionSnapshots(ctx.sessionManager.getEntries()));
	const host = new HcNicoSessionHost({
		instanceDirectory: config.cwd,
		parentSessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
		parentProviderRegistry: ctx.modelRegistry,
		...(deps.hostFactory ? { createFactory: deps.hostFactory } : {}),
	});
	const events = new Set<(sessionId: string, event: Record<string, unknown>) => void>();
	const deferred = new Set<string>();
	const permitted = policy.agents.map((agent) => agent.canonicalName);
	const subagentDepth = config.subagentDepth ?? 3;
	// Display-only mirror of every HC session into pi-subagents' Fleet overlay
	// (external runs carry the live FSM frame in their label). Harmless absent.
	const fleetBridge = new HcFleetExternalBridge(ctx.sessionManager.getSessionId());
	const syncFleetBridge = async () => {
		try {
			const reply = await request({ method: "GET", path: "/actors", deadline: Date.now() + config.timeoutMs });
			const body = reply.body as { actors?: { agent_id?: string; fsm_name?: string; state_id?: string; no_progress_count?: number }[] };
			const facts = new Map((body.actors ?? []).map((actor) => [actor.agent_id ?? "",
				{ fsmName: actor.fsm_name, stateId: actor.state_id, noProgress: actor.no_progress_count ?? 0 }]));
			await fleetBridge.sync(directory.list(), (sid) => facts.get(sid === binding.rootSessionId ? "main" : sid));
		} catch {
			/* the mirror is best-effort */
		}
	};
	const notifyFleet = (sessionId: string, event: Record<string, unknown>) => {
		for (const listener of events) {
			try {
				listener(sessionId, event);
			} catch {
				/* listener isolation */
			}
		}
	};
	const services: HcAgentRuntimeServices = {
		root: binding,
		...(crossTree ? { crossTree } : {}),
		policy,
		directory,
		host,
		catalog: HC_NATIVE_AGENT_DEFINITIONS,
		instanceDirectory: config.cwd,
		stateDirectory,
		subagentDepth,
		persist: (snapshot: HcSessionSnapshot) => {
			pi.appendEntry(HC_SESSION_ENTRY, snapshot);
		},
		acquireActor: async (agentId) => {
			requireDaemonOk(await request({ method: "POST", path: "/actor/acquire", deadline: Date.now() + config.timeoutMs,
				body: { session_id: binding.rootSessionId, agent_id: agentId } }));
		},
		deliverMessage: async (message: HcAgentMessage) => {
			await services.deliverRendered(message.target, renderAgentMessage(message));
		},
		deliverRendered: async (target: string, rendered: string) => {
			// HC inbox delivery is a plain user message (string content on the
			// wire): busy → read at the next step (steer), idle → next run.
			// HC applies the agent roster only when a delivery STARTS a turn
			// (idle wake): direct children as a sentinel-marked block.
			if (target === binding.rootSessionId) {
				const idle = deps.ctx.isIdle();
				const text = idle ? withAgentRoster(directory, target, rendered) : rendered;
				await pi.sendUserMessage(text, idle ? undefined : { deliverAs: "steer" });
				return true;
			}
			const record = directory.find(target);
			if (!record) return false;
			if (!record.handle) await host.open(record, services.launchPlan(record), services.observe);
			delete record.turnProfile;
			await host.deliver(record, record.status === "idle" ? withAgentRoster(directory, target, rendered) : rendered);
			return true;
		},
		deliverNotification: async (parentId, text, meta) => {
			await pi.sendMessage({ customType: "fsm-compatible:agent-report", content: text, details: meta, display: true }, { triggerTurn: true });
			void parentId;
		},
		publishDelegation: async (record, status) => {
			publishHcExecution(store, record, config.cwd);
			if (status === "started" && crossTree && deps.bridgeUrl && deps.bridgePassword) {
				await crossTree.publish({ sid: record.session_id, bridgeUrl: deps.bridgeUrl, bridgePassword: deps.bridgePassword });
			}
			notifyFleet(record.session_id, { type: "delegation", status });
		},
		observe: (record: HcSessionRecord, event: ChildSessionEvent) => {
			if (event.type === "agent_start") {
				record.status = "busy";
				record.lastOutcome = undefined;
				publishHcExecution(store, record, config.cwd);
				notifyFleet(record.session_id, event);
			} else if (event.type === "auto_retry_start") {
				record.status = "retry";
				publishHcExecution(store, record, config.cwd);
				notifyFleet(record.session_id, event);
			} else if (event.type === "agent_end") {
				record.lastRunMessages = Array.isArray(event.messages) ? (event.messages as HcSessionRecord["lastRunMessages"]) : [];
			} else if (event.type === "agent_settled") {
				record.status = "idle";
				const aborted = event.aborted === true;
				const outcome = aborted ? { kind: "cancelled" as const } : classifyFromRun(record.lastRunMessages ?? [], record.session_id);
				record.lastRunMessages = undefined;
				record.lastOutcome = { kind: outcome.kind, text: outcome.kind === "cancelled" ? "" : outcome.text,
					summary: outcome.kind === "completed" ? `Agent completed: ${record.description || record.title}`
						: outcome.kind === "failed" ? `Agent failed: ${record.description || record.title}` : "" };
				publishHcExecution(store, record, config.cwd);
				notifyFleet(record.session_id, event);
				void reportHcRunEnd(services, deferred, record, outcome).finally(() => {
					void recheckDeferredHcReports(services, deferred);
				});
			} else if (event.type === "message_end") {
				notifyFleet(record.session_id, event);
			}
		},
		launchPlan: (record: HcSessionRecord): HcNicoLaunchPlan => {
			const definition: HcAgentDefinition = (record.agent_type ? findHcAgentDefinition(HC_NATIVE_AGENT_DEFINITIONS, record.agent_type) : undefined)
				?? { name: record.agent_type ?? "general", description: "", mode: "subagent", hidden: false, tools: undefined, excludeTools: ["codemode"], model: undefined };
			return {
				definition,
				modelRef: hcModelRef(record.model.providerID, record.model.modelID, record.variant),
				depth: record.depth,
				maxDepth: subagentDepth,
				hooks: [hcChildHook({ services, record, broker: deps.broker, catalog: deps.catalog, request, judges: deps.judges,
					timeoutMs: config.timeoutMs, analysisEnabled: config.stopAnalysis ?? true, permitted })],
			};
		},
		hasBusyDescendant: (sessionId) => directory.descendants(sessionId)
			.some((record) => record.status === "busy" || record.status === "retry"),
	};
	return {
		services,
		fleet: hcFleetView(services, events),
		busy: (sessionId) => directory.descendants(sessionId).some((record) => record.status === "busy" || record.status === "retry"),
		abort: async (sessionId) => {
			const record = directory.get(sessionId);
			await host.cancel(record);
			return true;
		},
		refresh: () => {
			for (const record of directory.list()) publishHcExecution(store, record, config.cwd);
			void syncFleetBridge();
		},
		manualLaunch: async (input) => {
			const started = await createHcAgent(services, {
				caller: binding.rootSessionId,
				description: input.description,
				prompt: input.prompt,
				subagent_type: input.subagent_type,
				name: input.name,
				cwd: input.cwd,
				callerModel: input.model,
				callerVariant: input.variant,
			});
			return { session_id: started.sessionId };
		},
		close: async () => {
			await fleetBridge.dispose();
			await host.close();
		},
	};
}


