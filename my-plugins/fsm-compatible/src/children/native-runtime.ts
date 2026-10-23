import { join, resolve } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdmissionPolicy } from "../admission/admission-policy.ts";
import type { PersistedBinding } from "../binding/actor-binding.ts";
import type { RecordStore } from "../records/record-store.ts";
import type { SessionLifecycle } from "../records/session-record.ts";
import type { FsmCompatibleConfig } from "../runtime/runtime-config.ts";
import { NativeChildCoordinator } from "./native-child-coordinator.ts";
import { callNativeCoordinator, type NativeChildBootstrap } from "./native-child-bootstrap.ts";
import { registerNativeAgentTools } from "./native-agent-tools.ts";
import { parentExtensionArgs } from "./parent-extension-args.ts";
import { nativeChildSnapshot, NATIVE_CHILD_ENTRY } from "./native-child-snapshot.ts";
import { createDaemonRequester } from "../broker/daemon-request.ts";
import { authorizeNativeAction } from "./authorize-native-action.ts";
import type { NativeFsmPool } from "./native-fsm-pool.ts";

export interface FleetChildView {
	readonly sessionId: string;
	readonly parentSessionId: string | null;
	readonly name: string | null;
	readonly model: string;
	readonly thinking: string;
	readonly lifecycle: SessionLifecycle;
	readonly outcome: string | null;
	readonly runActive: boolean;
	readonly sessionFile: string;
	readonly cwd: string;
	readonly depth: number;
}

export interface FleetView {
	list(): readonly FleetChildView[];
	subscribe(listener: (sessionId: string, event: Record<string, unknown>) => void): () => void;
	send(target: string, message: string): Promise<void>;
}

export interface NativeRuntime {
	ready(): Promise<void>;
	close(): Promise<void>;
	busy(sessionId: string): boolean | Promise<boolean>;
	refresh(): void;
	handle(body: unknown, signal?: AbortSignal, onProgress?: (value: unknown) => void): Promise<unknown>;
	abort(sessionId: string): Promise<true>;
	fleet(): FleetView;
	manual?(action: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}

export function openNativeChildren(pi: ExtensionAPI, ctx: ExtensionContext, config: FsmCompatibleConfig,
	policy: AdmissionPolicy, binding: PersistedBinding, store: RecordStore, bridgeUrl: string,
	bridgePassword: string, bootstrap?: NativeChildBootstrap, fsm?: NativeFsmPool): NativeRuntime {
	if (bootstrap) {
		const off = registerNativeAgentTools(pi, { call: (action, input, signal) => callNativeCoordinator(bootstrap, action, input, signal) }, bootstrap.depth < policy.maxDepth);
		return { ready: async () => { await callNativeCoordinator(bootstrap, "ready", { sessionId: ctx.sessionManager.getSessionId() }); },
			close: async () => { off(); }, busy: async () => Boolean(await callNativeCoordinator(bootstrap, "busy", { params: {} })), refresh: () => {},
			handle: async () => { throw new Error("child has no coordinator"); }, abort: async () => { throw new Error("child has no coordinator"); },
			fleet: () => ({ list: () => [], subscribe: () => () => {}, send: async () => { throw new Error("child has no coordinator"); } }) };
	}
	if (!fsm) throw new Error("root FSM pool missing");
	const args = parentExtensionArgs();
	const extensions = [...policy.requiredExtensions];
	for (let index = 1; index < args.length; index += 2) {
		const path = resolve(process.cwd(), args[index]!);
		if (!extensions.some((item) => item.path === path)) extensions.push({ id: `cli-${index}`, path, requireForAllRunners: true });
	}
	const request = config.daemonRequester ? config.daemonRequester(config.dataDir) : createDaemonRequester(config.dataDir);
	const coordinator = new NativeChildCoordinator({ config, policy, binding, store, fsm,
		stateDirectory: join(getAgentDir(), "fsm-compatible", binding.rootSessionId), cli: process.argv[1] ?? "",
		extensions, url: () => bridgeUrl, bridgePassword, rootIdle: () => ctx.isIdle(),
		entries: ctx.sessionManager.getEntries(), persist: (row) => {
			if (ctx.sessionManager.getSessionId() !== binding.sessionId) throw new Error("native root session changed");
			pi.appendEntry(NATIVE_CHILD_ENTRY, nativeChildSnapshot(row));
		},
		authorize: (caller, action, input, signal) => authorizeNativeAction(request, caller, action, input, config.timeoutMs, signal),
		notify: (content) => {
			if (ctx.sessionManager.getSessionId() !== binding.sessionId) throw new Error("native root session changed");
			pi.sendMessage({ customType: "fsm-compatible:agent-report", content, display: true }, { triggerTurn: true });
		},
	});
	const off = registerNativeAgentTools(pi, { call: (action, input, signal) => coordinator.call(binding, action, input, signal) }, true);
	let closing: Promise<void> | undefined;
	return { ready: async () => {}, close: () => { off(); return closing ??= coordinator.close(); },
		busy: (id) => coordinator.busy(id), refresh: () => coordinator.refresh(), handle: (body, signal, progress) => coordinator.handle(body, signal, progress),
		abort: async (id) => {
			const row = coordinator.registry.rows.get(id);
			const parent = row ? coordinator.registry.find(row.binding.parentSessionId)?.binding : undefined;
			if (!row || !parent) throw new Error("execution not owned by coordinator");
			await coordinator.call(parent, "stop", { params: { target: id } }); return true;
		},
		fleet: () => ({
			list: () => [...coordinator.registry.rows.values()].map((row) => ({ sessionId: row.binding.sessionId,
				parentSessionId: row.binding.parentSessionId, name: row.name, model: row.model, thinking: row.thinking,
				lifecycle: row.lifecycle, outcome: row.outcome, runActive: row.runActive, sessionFile: row.sessionFile, cwd: row.cwd, depth: row.depth })),
			subscribe: (listener) => coordinator.addChildEventListener(listener),
			send: async (target, message) => { await coordinator.call(binding, "send", { params: { target, message } }); },
		}),
		manual: (action, input, signal) => coordinator.manual(action, input, signal) };
}
