/**
 * scout-bridge-t3 — T3 MECHANISM TRIAL EXTENSION (virtual entry + bridge provider).
 *
 * NOT product code. Proves against the real installed loader/SDK/faux provider:
 *  - a plugin-owned physical bridge provider registered as a native, whose auth
 *    resolves by DELEGATING to the original profile's auth (no fabricated key,
 *    no credential writes), and whose stream/streamSimple delegate to the
 *    original transport with the wire model id glm-5.4;
 *  - a virtual model registered under the ORIGINAL profile id (zai-coding),
 *    routed to the bridge physical model, thinking level passed through and
 *    clamped by the bridge physical model's level map;
 *  - official takeover: on every host refresh cycle (cached phase included)
 *    the bridge's refreshModels checks the original catalog; when the official
 *    set gains the same id, the virtual entry is withdrawn through the real
 *    unregister path (guarded so it runs at most once — no supersede loop);
 *  - session restore re-applies the saved virtual selection after bind.
 *
 * Semantic differences vs native selection are LOGGED, not hidden:
 *  - assistant messages record provider=<bridge id>, model=glm-5.4;
 *  - model_change records the virtual selection (zai-coding/glm-5.4).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider, Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import { writeFileSync } from "node:fs";

const TARGET = "zai-coding";
const BRIDGE_ID = "scout-bridge-t3";
const VIRTUAL_ID = "glm-5.4";
const T3_VIRTUAL_CONTEXT_WINDOW = 111000;
const T3_PHYSICAL_CONTEXT_WINDOW = 222000;

function log(event: string, data: Record<string, unknown> = {}): void {
	const path = process.env.SCOUT_LOG;
	if (!path) return;
	try {
		writeFileSync(path, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`, { flag: "a" });
	} catch {
		/* trial logging must never break the mechanism */
	}
}

function restoreSavedSelection(pi: ExtensionAPI, ctx: { modelRegistry: { find: (p: string, id: string) => Model | undefined }; sessionManager: { getBranch: () => Array<Record<string, unknown>> } }): void {
	try {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type?: string; provider?: string; modelId?: string };
			if (entry?.type !== "model_change") continue;
			if (typeof entry.provider === "string" && typeof entry.modelId === "string") {
				const model = ctx.modelRegistry.find(entry.provider, entry.modelId);
				if (model) {
					void pi.setModel(model).then(
						(ok) => log("saved_selection_restored", { provider: entry.provider, modelId: entry.modelId, ok }),
						(e) => log("saved_selection_restore_failed", { error: String(e) }),
					);
				}
			}
			break;
		}
	} catch (error) {
		log("saved_selection_error", { error: error instanceof Error ? error.message : String(error) });
	}
}

export default function scoutBridgeT3(pi: ExtensionAPI): void {
	let virtualRegistered = false;

	pi.on("session_start", (event, ctx) => {
		const registry = ctx.modelRegistry;
		const original = registry.getRegisteredNativeProvider(TARGET);
		if (!original || typeof original.getModels !== "function") {
			log("no_native_target", { target: TARGET });
			return;
		}
		const template = original.getModels().find((m) => (m.type ?? "chat") === "chat");
		const bridgeModel = {
			id: VIRTUAL_ID,
			name: "GLM-5.4 (bridge physical)",
			api: template?.api ?? "openai-completions",
			provider: BRIDGE_ID,
			baseUrl: original.baseUrl,
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: T3_PHYSICAL_CONTEXT_WINDOW,
			maxTokens: 65536,
		} as unknown as Model;

		const bridge: Provider = {
			id: BRIDGE_ID,
			name: "model-scout bridge (t3 trial)",
			baseUrl: original.baseUrl,
			headers: original.headers,
			auth: { apiKey: {
				// Runtime delegation into the original profile's auth resolution.
				resolve: (input) => original.auth.apiKey.resolve(input),
			} },
			getModels: () => [bridgeModel],
			stream: (model, context, options) => original.stream(model, context, options),
			streamSimple: (model, context, options) => original.streamSimple(model, context, options),
			refreshModels: async (context: RefreshModelsContext) => {
				const official = original.getModels();
				const clash = official.some((m) => m.id === VIRTUAL_ID && (m.type ?? "chat") === "chat");
				log("bridge_refresh", { allowNetwork: context.allowNetwork, clash, virtualRegistered });
				if (clash && virtualRegistered) {
					virtualRegistered = false;
					pi.unregisterVirtualModel(TARGET, VIRTUAL_ID);
					log("takeover_withdrawn", { via: "unregisterVirtualModel" });
				}
			},
		};

		pi.registerProvider(bridge);
		pi.registerVirtualModel({
			provider: TARGET,
			id: VIRTUAL_ID,
			name: "GLM-5.4",
			reasoning: true,
			thinkingLevels: ["off", "low", "medium", "high"],
			contextWindow: T3_VIRTUAL_CONTEXT_WINDOW,
			maxTokens: 65536,
			route: (request) => ({ model: bridgeModel, thinkingLevel: request.thinkingLevel }),
		});
		virtualRegistered = true;
		log("registered", {
			bridge: BRIDGE_ID,
			target: TARGET,
			virtual: VIRTUAL_ID,
			originalAuthDelegated: bridge.auth.apiKey?.resolve === original.auth.apiKey?.resolve ? false : "wrapped-delegate",
			transportDelegated: bridge.stream === original.stream,
		});
		restoreSavedSelection(pi, ctx);
	});

	pi.on("session_shutdown", () => {
		if (virtualRegistered) {
			virtualRegistered = false;
			pi.unregisterVirtualModel(TARGET, VIRTUAL_ID);
		}
		log("session_shutdown_clean", { pid: process.pid });
	});
	log("loaded", { pid: process.pid });
}
