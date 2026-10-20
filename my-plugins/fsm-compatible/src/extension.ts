import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { openOwnedRuntime, type OwnedRuntimeHandle } from "./runtime/owned-runtime.ts";
import { loadConfig } from "./runtime/runtime-config.ts";
import { parsePolicyInput } from "./admission/parse-policy-input.ts";
import { canonicalizeRequiredExtensions } from "./admission/canonicalize-required-extensions.ts";
import { registerCommandAliases } from "./commands/command-aliases.ts";
import { RootHealth } from "./runtime/root-health.ts";
import { installNotReadyGate } from "./runtime/not-ready-gate.ts";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(new URL("./index.ts", import.meta.url));

const extension: ExtensionFactory = async (pi) => {
	let handle: OwnedRuntimeHandle | undefined;
	pi.on("session_start", async (_event, ctx) => {
		registerCommandAliases(pi);
		try {
			if (handle) {
				// re-entry: unwind the previous runtime before building a new one.
				await handle.close(Date.now() + 10000);
				handle = undefined;
			}
			const config = await loadConfig();
			// Dispatched-subagent child mode: the parent Agent tool pre-claimed the
			// dispatch under (parent root session, dispatch tag) and passes both via env.
			const parentSid = process.env.FSM_PARENT_SESSION_ID;
			const agentTag = process.env.FSM_AGENT_ID;
			const childIdentity = parentSid && agentTag
				? { rootSessionId: parentSid, agentId: agentTag, agentName: process.env.PI_AGENT_SUBAGENT_TYPE ?? agentTag }
				: undefined;
			const parsed = parsePolicyInput({
				allowedAgentNames: [],
				requiredExtensions: [{ id: "fsm-compatible", path: SELF_PATH }],
				maxDepth: 8,
			});
			if (!parsed.ok) throw new Error("builtin policy invalid");
			const extensions = canonicalizeRequiredExtensions(parsed.value.requiredExtensions, SELF_PATH);
			if (!extensions.ok) throw new Error("mandatory extensions invalid");
			handle = await openOwnedRuntime(pi, ctx, config, { ...parsed.value, requiredExtensions: extensions.value.map((extension) => ({ id: extension.id, path: extension.path })) }, childIdentity);
		} catch (error) {
			handle = undefined;
			const diagnostic = `fsm-compatible runtime not ready: ${error instanceof Error ? error.message : "unknown"}`;
			// A failed assembly never runs ungated: block inputs and tools with the real diagnostic.
			installNotReadyGate(pi, new RootHealth([{ id: "fsm-compatible", canonicalPath: SELF_PATH }]), () => diagnostic);
			ctx.ui.notify(`fsm-compatible failed to start: ${error instanceof Error ? error.message : "unknown"}`, "error");
		}
	});
	pi.on("session_shutdown", async () => {
		if (handle) await handle.close(Date.now() + 10000);
		handle = undefined;
	});
};

export default extension;
