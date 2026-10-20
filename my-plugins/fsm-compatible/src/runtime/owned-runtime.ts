import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRootBinding } from "../binding/create-root-binding.ts";
import { createChildBinding } from "../binding/create-child-binding.ts";
import type { PersistedBinding } from "../binding/actor-binding.ts";
import { buildAdmissionPolicy } from "../admission/build-admission-policy.ts";
import type { AdmissionPolicy, PolicyInput } from "../admission/admission-policy.ts";
import { createDaemonRequester, requireDaemonOk } from "../broker/daemon-request.ts";
import { prepareBrokerChannel } from "../broker/broker-channel.ts";
import { registerProjectedTools } from "../broker/fsm-tools.ts";
import { registerAgentTool } from "../children/agent-tool.ts";
import { parentExtensionArgs } from "../children/parent-extension-args.ts";
import { parentModelArg } from "../children/parent-model-arg.ts";
import { registerOcToolAliases } from "../gates/oc-tool-aliases.ts";
import { hostModelSource } from "../judge/host-model-source.ts";
import { JudgeSessions } from "../judge/judge-session.ts";
import { createOcHandlers } from "../protocol/oc-handlers.ts";
import { OcServer } from "../protocol/oc-server.ts";
import { RecordStore } from "../records/record-store.ts";
import { installPermissionGate } from "../gates/permission-gate.ts";
import { installStopGate } from "../gates/stop-gate.ts";
import { createWaitState, registerAskTool } from "../watch/ask-tool.ts";
import { AdvisoryQueue } from "../watch/advisory-queue.ts";
import { drainOnce } from "../watch/drain-advisories.ts";
import { RootHealth } from "./root-health.ts";
import { installNotReadyGate } from "./not-ready-gate.ts";
import { RuntimeResources } from "./runtime-resources.ts";
import type { FsmCompatibleConfig } from "./runtime-config.ts";

export interface OwnedRuntimeHandle {
	readonly bridgeUrl: string;
	ready(): boolean;
	close(deadline: number): Promise<void>;
}

/** Root assembly: every resource prepares before ready; failures unwind in reverse order. */
export interface ChildIdentity {
	readonly rootSessionId: string;
	readonly agentId: string;
	readonly agentName: string;
}

export async function openOwnedRuntime(pi: ExtensionAPI, ctx: ExtensionContext, config: FsmCompatibleConfig,
	policyInput: PolicyInput, childIdentity?: ChildIdentity): Promise<OwnedRuntimeHandle> {
	const sessionId = ctx.sessionManager.getSessionId();
	const built = buildAdmissionPolicy(policyInput, [], policyInput.requiredExtensions.map((extension) => ({
		id: extension.id, path: extension.path, requireForAllRunners: true,
	})));
	if (!built.ok) throw new Error("admission policy invalid for root assembly");
	const policy: AdmissionPolicy = built.value;
	// Child mode (dispatched subagent): the binding addresses the child actor under
	// the parent root session; gates and broker calls all key by (rootSessionId, agentId).
	const binding: PersistedBinding = childIdentity
		? createChildBinding(childIdentity.rootSessionId, childIdentity.agentId, childIdentity.agentName, policy)
		: createRootBinding(sessionId, policy);
	const store = new RecordStore(binding);
	store.publishExecution(binding, { title: childIdentity ? childIdentity.agentName : "main", lifecycle: "running", updatedAt: Date.now(),
		// Child mode: the host session header belongs to the child pi process, not
		// the dispatch tag identity — omit it rather than fail the id equality.
		header: childIdentity ? null : ctx.sessionManager.getHeader(),
		branch: ctx.sessionManager.getBranch(),
		sessionFile: ctx.sessionManager.getSessionFile() ?? null, errorMessage: null });

	const health = new RootHealth([{ id: "fsm-compatible", canonicalPath: "self" }]);
	const resources = new RuntimeResources();
	const gateOffs: Array<() => void> = [];
	let bound = false;
	const bindingRef = () => bound ? { sessionId: binding.rootSessionId, agentId: binding.agentId } : undefined;

	// Step P4: every acquisition below sits inside one unwind scope; any throw reverse-frees handlers, scope dir, bridge and channel.
	try {
	const offInput = installNotReadyGate(pi, health, () => "fsm-compatible runtime not ready");
	gateOffs.push(offInput);
	const waitState = createWaitState();
	const request = config.daemonRequester ? config.daemonRequester(config.dataDir) : createDaemonRequester(config.dataDir);
	{
		// Acquire before tools are available, matching the OC SubagentStart hook.
		// Reacquiring a preclaimed or restored actor is idempotent.
		try {
			await request({ method: "POST", path: "/actor/acquire", deadline: Date.now() + config.timeoutMs,
				body: { session_id: binding.rootSessionId, agent_id: binding.agentId } });
		} catch {
			/* daemon unreachable: gates below fail closed anyway */
		}
	}

	const judges = new JudgeSessions(store, config.cwd,
		hostModelSource(ctx.model, ctx.modelRegistry) ?? config.modelSource, config.capacity);
	// Native Agent tool (CC name, behavioral parity with haokun-code)
	// OC tool aliases: accept OC parameter names (filePath/include etc) for mock scripts
	registerOcToolAliases(pi, config.cwd);
	const hostModel = parentModelArg() ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
	const acquireChildActor = !childIdentity ? async (agentId: string) => {
		requireDaemonOk(await request({ method: "POST", path: "/actor/acquire", deadline: Date.now() + config.timeoutMs,
			body: { session_id: binding.rootSessionId, agent_id: agentId } }));
	} : undefined;
	const agentOff = registerAgentTool(pi, { model: hostModel ?? config.modelSource?.model?.id ?? "zai-000-g-l/glm-5.3", projectDir: config.cwd, timeoutMs: config.timeoutMs * 4, childArgs: parentExtensionArgs(),
		...(acquireChildActor ? { acquireChildActor, rootSessionId: binding.rootSessionId } : {}) });
	gateOffs.push(agentOff);
	const advisories = new AdvisoryQueue(config.capacity);

	const server = new OcServer(createOcHandlers(store, judges, { advisories }));
	const bridgePassword = randomBytes(24).toString("hex");
	server.setPassword(bridgePassword);
	const bridgeUrl = await server.listen();
	resources.own(() => server.close());
	// Export the bridge coordinates into this process's env so shell children
	// (wire7 analysis_state.py) inherit OPENCODE_SERVER_URL and reach it.
	process.env.OPENCODE_SERVER_URL = bridgeUrl;
	process.env.OPENCODE_SERVER_PASSWORD = bridgePassword;
	{
		// OPENCODE_SERVER_PASSWORD: the FSM client's soft-review judge reads this env
		// (review.rs opencode_endpoint) to authenticate back into our OC bridge.
		const channelEnv: NodeJS.ProcessEnv = { ...(config.env ?? process.env), OPENCODE_SERVER_PASSWORD: bridgePassword };
		const channel = await prepareBrokerChannel({
			rootSessionId: binding.rootSessionId, cwd: config.cwd, serverUrl: bridgeUrl, dataDir: config.dataDir,
			clientCommand: config.clientCommand, clientArgs: config.clientArgs, env: channelEnv,
			capacity: config.capacity,
			...(config.scope ? { scope: config.scope } : {}),
		}, Date.now() + config.timeoutMs, resources.signal, request);
		resources.own(async (deadline) => { await channel.close(deadline); });
		const offTools = registerProjectedTools(pi, { broker: channel.broker, catalog: channel.catalog,
			timeoutMs: config.timeoutMs, ready: () => health.ready, binding: () => binding, hostSessionId: sessionId });
		gateOffs.push(offTools);

		gateOffs.push(installPermissionGate(pi, request, bindingRef, config.timeoutMs));
		gateOffs.push(installStopGate(pi, request, bindingRef, config.timeoutMs, {
			hasBusyChild: (sessionId) => {
				return store.executionChildren(sessionId)
					.some((child) => child.lifecycle === "running" || child.lifecycle === "settling");
			},
		}));
		if (ctx.hasUI) gateOffs.push(registerAskTool(pi, { request, binding: bindingRef, waitState, timeoutMs: config.timeoutMs }));

		gateOffs.push(pi.on("agent_settled", () => {
			drainOnce(pi, advisories, {
				isIdle: (target) => target === sessionId ? ctx.isIdle() : false,
				consumed: (deliveryId, target) => (store.getExecution(target)?.branch ?? [])
					.some((entry) => entry.type === "custom_message"
						&& (entry.details as { deliveryId?: string } | undefined)?.deliveryId === deliveryId),
			});
		}));
		resources.own(async () => { advisories.close(); });

		const epoch = health.begin(sessionId);
		health.markInitialized("fsm-compatible", true);
		health.markPrepared(epoch, sessionId);
		if (!health.commit(epoch)) throw new Error("root ready commit failed");
		bound = true;
		return {
			bridgeUrl,
			ready: () => health.ready,
			close: async (deadline: number) => {
				bound = false;
				health.close();
				for (const off of gateOffs.splice(0).reverse()) off();
				await resources.close(deadline);
			},
		};
	}
	} catch (error) {
		bound = false;
		health.close();
		for (const off of gateOffs.splice(0).reverse()) off();
		await resources.close(Date.now() + 10000);
		throw error;
	}
}
