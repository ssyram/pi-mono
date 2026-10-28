import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRootBinding } from "../binding/create-root-binding.ts";
import { BINDING_CUSTOM_TYPE } from "../binding/actor-binding.ts";
import { readPersistedBinding } from "../binding/read-persisted-binding.ts";
import type { PolicyInput } from "../admission/admission-policy.ts";
import { nativeRuntimePolicy } from "../admission/native-runtime-policy.ts";
import { appendFile } from "node:fs/promises";
import { createDaemonRequester, requireDaemonOk, type DaemonRequester } from "../broker/daemon-request.ts";
import { prepareBrokerChannel } from "../broker/broker-channel.ts";
import { registerProjectedTools } from "../broker/fsm-tools.ts";
import { NativeFsmPool } from "../children/native-fsm-pool.ts";
import { registerOcToolAliases } from "../gates/oc-tool-aliases.ts";
import { registerHcSurfaceTools } from "../tools/hc-surface-tools.ts";
import { registerHcNativeTools } from "../tools/hc-native-surface.ts";
const HC_NATIVE_ADAPTER_NAMES: ReadonlySet<string> = new Set(["read", "write", "edit", "bash", "grep", "glob"]);
import { hostModelSource } from "../judge/host-model-source.ts";
import { JudgeSessions } from "../judge/judge-session.ts";
import { createOcHandlers } from "../protocol/oc-handlers.ts";
import { OcServer } from "../protocol/oc-server.ts";
import { RecordStore } from "../records/record-store.ts";
import { installPermissionGate } from "../gates/permission-gate.ts";
import { installStopGate } from "../gates/stop-gate.ts";
import { createWaitState, registerAskTool } from "../watch/ask-tool.ts";
import { registerFleetUI } from "../tui/fleet-ui.ts";
import { registerSubagentCommand } from "../children/subagent-command.ts";
import { AdvisoryQueue } from "../watch/advisory-queue.ts";
import { drainOnce } from "../watch/drain-advisories.ts";
import { RootHealth } from "./root-health.ts";
import { installNotReadyGate } from "./not-ready-gate.ts";
import { RuntimeResources } from "./runtime-resources.ts";
import type { FsmCompatibleConfig } from "./runtime-config.ts";
import { openHcAgentRuntime, type HcRuntimeHandle } from "../subagents/hc-agent-runtime.ts";
import { crossTreeRegistry } from "../subagents/hc-session-registry.ts";
import { registerHcAgentTools } from "../subagents/hc-agent-tools.ts";

export interface OwnedRuntimeHandle {
	readonly bridgeUrl: string;
	ready(): boolean;
	close(deadline: number): Promise<void>;
}

export async function openOwnedRuntime(pi: ExtensionAPI, ctx: ExtensionContext, config: FsmCompatibleConfig,
	policyInput: PolicyInput): Promise<OwnedRuntimeHandle> {
	const sessionId = ctx.sessionManager.getSessionId();
	const policy = nativeRuntimePolicy(pi, ctx, policyInput);
	const binding = createRootBinding(sessionId, policy);
	const saved = readPersistedBinding(ctx.sessionManager.getEntries(), sessionId);
	if (!saved.ok || (saved.value && (saved.value.rootSessionId !== binding.rootSessionId
		|| saved.value.agentId !== binding.agentId))) throw new Error("binding restore conflict");
	pi.appendEntry(BINDING_CUSTOM_TYPE, binding);
	const store = new RecordStore(binding);
	// HC hosts set the root session title at creation (the plot's declared
	// controller title); mirror it when the host provides one.
	const rootTitle = process.env.FSM_COMPATIBLE_ROOT_TITLE ?? binding.agentName ?? "main";
	const publishRoot = () => store.publishExecution(binding, { title: rootTitle,
		lifecycle: ctx.isIdle() ? "idle" : "running", updatedAt: Date.now(), header: ctx.sessionManager.getHeader(),
		branch: ctx.sessionManager.getBranch(), sessionFile: ctx.sessionManager.getSessionFile() ?? null, errorMessage: null });
	publishRoot();
	const health = new RootHealth([{ id: "fsm-compatible", canonicalPath: "self" }]);
	const resources = new RuntimeResources();
	const offs: Array<() => void> = [];
	let bound = false;
	let hc: HcRuntimeHandle | undefined;
	const bindingRef = () => bound ? { sessionId: binding.rootSessionId, agentId: binding.agentId } : undefined;
	try {
		offs.push(installNotReadyGate(pi, health, () => "fsm-compatible runtime not ready"));
		const waitState = createWaitState();
	const baseRequest = config.daemonRequester ? config.daemonRequester(config.dataDir) : createDaemonRequester(config.dataDir);
	const dualLog = process.env.FSM_DUAL_DAEMON_LOG;
	const request: DaemonRequester = dualLog ? async (input) => {
		const reply = await baseRequest(input);
		await appendFile(dualLog, JSON.stringify({ path: input.path, method: input.method, body: input.body, status: reply.status, replyBody: reply.body, t: Date.now() }) + "\n");
		return reply;
	} : baseRequest;
		// HC parity (fsm-plugin announceSubagentStart): root sessions are never
		// pre-registered — main is acquired by its first identity-acquire, which
		// carries agent_cli so the actor is created with full context in one step
		// and no premature _default stack is persisted before the first read-only
		// fsm_get_state.
		const judges = new JudgeSessions(store, config.cwd, hostModelSource(ctx.model, ctx.modelRegistry) ?? config.modelSource, config.capacity);
		const advisories = new AdvisoryQueue(config.capacity);
		const bridgePassword = randomBytes(24).toString("hex");
		const crossTree = process.env.FSM_DATA_DIR ? crossTreeRegistry(join(process.env.FSM_DATA_DIR, "pi-sessions")) : undefined;
		const handlers = createOcHandlers(store, judges, { advisories,
			refresh: () => { publishRoot(); hc?.refresh(); },
			abortExecution: async (id) => {
				if (!hc) throw new Error("hc runtime not ready");
				return hc.abort(id);
			},
			agentMessage: async (target, message) => {
				if (!hc) throw new Error("hc runtime not ready");
				return hc.services.deliverRendered(target, message);
			} });
		const server = new OcServer({ ...handlers });
		server.setPassword(bridgePassword);
		const bridgeUrl = await server.listen();
		resources.own(() => server.close());
		const env = { ...(config.env ?? process.env), OPENCODE_SERVER_URL: bridgeUrl, OPENCODE_SERVER_PASSWORD: bridgePassword };
		registerOcToolAliases(pi, config.cwd, env);
		// HC surface: the file/shell/search tools are re-registered under
		// HC's exact wire schema; the shadowed Pi builtins must leave the
		// active set first (a registration shadowing an active builtin
		// disappears from the wire).
		try {
			const active = pi.getActiveTools().filter((name) => !(name in HC_NATIVE_ADAPTER_NAMES));
			pi.setActiveTools(active);
		} catch { /* headless hosts without the loadout API */ }
		offs.push(registerHcSurfaceTools(pi));
		offs.push(await registerHcNativeTools(pi, (tool, input) => {
			const target = pi.getAllTools().find((candidate) => candidate.name === tool && candidate.sourceInfo === undefined);
			throw new Error(`hc-native adapter for ${tool} not wired to an executor yet`);
		}));
		const channelConfig = { rootSessionId: binding.rootSessionId, cwd: config.cwd, serverUrl: bridgeUrl,
			dataDir: config.dataDir, clientCommand: config.clientCommand, clientArgs: config.clientArgs, env,
			capacity: config.capacity, ...(config.scope ? { scope: config.scope } : {}) };
		const channel = await prepareBrokerChannel(channelConfig, Date.now() + config.timeoutMs, resources.signal, request);
		resources.own(async (deadline) => { await channel.close(deadline); });
		const pool = new NativeFsmPool(channel, channelConfig, resources.signal, request, config.timeoutMs,
			(agentId) => hc?.services.directory.find(agentId)?.workdir?.path ?? config.cwd);
		resources.own((deadline) => pool.close(deadline));
		hc = await openHcAgentRuntime({ pi, ctx, config, policy, binding, store,
			broker: pool, catalog: pool.catalog, request, judges,
			...(crossTree ? { crossTree, bridgeUrl, bridgePassword } : {}) });
		await crossTree?.publish({ sid: binding.rootSessionId, bridgeUrl, bridgePassword });
		if (process.env.FSM_DUAL_DEBUG) console.error("[hc-root-debug] runtime ready");
		resources.own(() => hc!.close());
		resources.own(async () => {
			if (!crossTree || !hc) return;
			await crossTree.remove(binding.rootSessionId);
			for (const record of hc.services.directory.list()) await crossTree.remove(record.session_id);
		});
		offs.push(registerProjectedTools(pi, { broker: pool, catalog: pool.catalog, timeoutMs: config.timeoutMs,
			ready: () => health.ready, binding: () => binding,
			extensionPath: policy.requiredExtensions.find((item) => item.id === "fsm-compatible")!.path }));
		offs.push(registerHcAgentTools(pi, { services: hc.services, depth: 0,
			permitted: policy.agents.map((agent) => agent.canonicalName),
			callerVariant: () => pi.getThinkingLevel() ?? "default" }));
		offs.push(installPermissionGate(pi, request, bindingRef, config.timeoutMs));
		offs.push(installStopGate(pi, request, bindingRef, config.timeoutMs, { hasBusyChild: (id) => hc!.busy(id),
			judges, analysisEnabled: config.stopAnalysis ?? true, sourcePassword: bridgePassword,
			markStopContinuation: (id) => { const r = hc!.services.directory.get(id); if (r) r.turnProfile = "build"; } }));
		if (ctx.hasUI) offs.push(registerAskTool(pi, { request, binding: bindingRef, waitState, timeoutMs: config.timeoutMs }));
		if (ctx.hasUI && (config.fleetWidgetPlacement ?? "belowEditor") !== "off") {
			const model = ctx.model;
			offs.push(registerFleetUI(pi, ctx, { placement: config.fleetWidgetPlacement === "aboveEditor" ? "aboveEditor" : "belowEditor",
				fleet: () => hc!.fleet, rootSessionId: sessionId, rootSessionFile: () => ctx.sessionManager.getSessionFile() ?? undefined,
				actors: async () => { const reply = await request({ method: "GET", path: "/actors", deadline: Date.now() + config.timeoutMs });
					const body = reply.body as { actors?: { agent_id?: string; fsm_name?: string; state_id?: string; no_progress_count?: number }[] };
					return (body.actors ?? []).map((actor) => ({ agentId: actor.agent_id ?? "", fsmName: actor.fsm_name ?? "_default",
						stateId: actor.state_id ?? "?", noProgress: actor.no_progress_count ?? 0 })); },
				contextWindowOf: (ref) => { const [provider, ...rest] = ref.split("/");
					const found = provider && rest.length ? ctx.modelRegistry.find(provider, rest.join("/")) : undefined;
					return found?.contextWindow ?? model?.contextWindow ?? null; } }));
		}
		offs.push(registerSubagentCommand(pi, ctx, {
			dispatch: async (fsmName) => { await pool.invoke(binding, "fsm_dispatch_subagent", { fsm: fsmName },
				{ deadline: Date.now() + config.timeoutMs * 10 }); },
			launch: async (input, model, thinking) => {
				const slash = model.indexOf("/");
				return hc!.manualLaunch({ description: input.description, prompt: input.prompt,
					subagent_type: input.subagent_type, ...(input.name ? { name: input.name } : {}),
					model: { providerID: slash > 0 ? model.slice(0, slash) : model, modelID: slash > 0 ? model.slice(slash + 1) : "" },
					variant: thinking });
			},
			intel: async () => { const reply = await request({ method: "GET", path: "/actors", deadline: Date.now() + config.timeoutMs });
				const body = reply.body as { actors?: { session_id?: string; agent_id?: string; fsm_name?: string; state_id?: string; no_progress_count?: number }[] };
				const actors = new Map((body.actors ?? []).map((actor) => [actor.agent_id ?? "", actor]));
				return hc!.fleet.list().map((view) => { const actor = actors.get(view.sessionId);
					return { sessionId: view.sessionId, name: view.name, parentSessionId: view.parentSessionId,
						sessionFile: view.sessionFile, state: view.runActive ? "busy" : view.lifecycle,
						model: view.model, thinking: view.thinking, outcome: view.outcome, runActive: view.runActive,
						fsmName: actor?.fsm_name ?? "_default", fsmState: actor?.state_id ?? "?", noProgress: actor?.no_progress_count ?? 0 }; }); },
			hostAgentName: () => policy.agents[0]?.canonicalName ?? "general",
			defaultModel: () => { const current = ctx.model; return current ? `${current.provider}/${current.id}` : undefined; },
			defaultThinking: () => pi.getThinkingLevel(),
		}));
		offs.push(pi.on("agent_settled", () => {
			publishRoot();
			drainOnce(pi, advisories, { isIdle: (target) => target === sessionId && ctx.isIdle(),
				consumed: (deliveryId, target) => (store.getExecution(target)?.branch ?? []).some((entry) =>
					entry.type === "custom_message" && (entry.details as { deliveryId?: string } | undefined)?.deliveryId === deliveryId) });
		}));
		resources.own(async () => { advisories.close(); });
		// The root is an addressable agent for cross-tree sends (HC delivers to
		// any existing session id): publish it once the bridge is up.
		if (crossTree) await crossTree.publish({ sid: binding.rootSessionId, bridgeUrl, bridgePassword: bridgePassword });
		const epoch = health.begin(sessionId); health.markInitialized("fsm-compatible", true); health.markPrepared(epoch, sessionId);
		if (!health.commit(epoch)) throw new Error("root ready commit failed");
		bound = true;
		return { bridgeUrl, ready: () => health.ready, close: async (deadline) => {
			bound = false; health.close(); for (const off of offs.splice(0).reverse()) off();
			try { await hc?.close(); } finally { await resources.close(deadline); }
		} };
	} catch (error) {
		bound = false; health.close(); for (const off of offs.splice(0).reverse()) off();
		try { await hc?.close(); } finally { await resources.close(Date.now() + 10000); }
		throw error;
	}
}
