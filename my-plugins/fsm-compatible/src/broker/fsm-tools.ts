import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { PersistedBinding } from "../binding/actor-binding.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { FsmBroker } from "./fsm-broker.ts";
import type { FsmTool } from "./fsm-catalog.ts";
import { projectMcpToolResult } from "./mcp-tool-result.ts";

export interface ProjectedToolOwner {
	readonly broker: FsmBroker;
	readonly catalog: ReadonlyMap<string, FsmTool>;
	readonly timeoutMs: number;
	/** The host session that owns this runtime; defaults to the calling context's
	 * session. A dispatched child's binding.sessionId is its dispatch tag, so the
	 * child passes its own host session id explicitly. */
	readonly hostSessionId?: string;
	ready(): boolean;
	binding(ctx: ExtensionToolContext): PersistedBinding;
}

export function registerProjectedTools(pi: ExtensionAPI, owner: ProjectedToolOwner): () => void {
	const existing = pi.getAllTools();
	for (const name of owner.catalog.keys()) {
		if (existing.some((tool) => tool.name === name || tool.name.endsWith(`__${name}`))) throw new RuntimeError("not-ready");
	}
	let active = true;
	// Step P3: published tools can only call the broker with their actual session binding.
	for (const tool of owner.catalog.values()) {
		const piName = `mcp__fsm__${tool.name}`;
		// Register OC-name alias: "fsm_" + MCP tool name (e.g., fsm_enter_fsm → mcp__fsm__enter_fsm)
		const ocName = `fsm_${tool.name}`;
		pi.registerTool({ name: ocName, label: tool.name, description: `[OC alias] ${tool.description}`,
			parameters: structuredClone(tool.inputSchema),
			async execute(id, params, signal, onUpdate, ctx) {
				if (!active || !owner.ready()) throw new RuntimeError("not-ready");
				// Route through the same invoke path as the canonical name
				const binding = owner.binding(ctx);
				if ((owner.hostSessionId ?? binding.sessionId) !== ctx.sessionManager.getSessionId()) throw new RuntimeError("owner-unavailable");
				// FSM tools run the full gate suite server-side (clightgen, git audits,
				// judge sessions — legitimately minutes); the 30s daemon-call timeoutMs
				// is for quick HTTP, not these. A deadline miss closes the transport and
				// kills the whole FSM surface, so give gates headroom.
				const result = await owner.broker.invoke(binding, tool.name, params, {
					deadline: Date.now() + owner.timeoutMs * 10, ...(signal ? { signal } : {}),
					...(onUpdate ? { onProgress: (progress: unknown) => onUpdate({ content: [], details: { progress } }) } : {}),
				});
				return projectMcpToolResult(result);
			},
		});
		pi.registerTool({ name: piName, label: tool.name, description: tool.description,
			parameters: structuredClone(tool.inputSchema),
			async execute(_id, params, signal, onUpdate, ctx) {
				if (!active || !owner.ready()) throw new RuntimeError("not-ready");
				const binding = owner.binding(ctx);
				if ((owner.hostSessionId ?? binding.sessionId) !== ctx.sessionManager.getSessionId()) throw new RuntimeError("owner-unavailable");
				// FSM tools run the full gate suite server-side (clightgen, git audits,
				// judge sessions — legitimately minutes); the 30s daemon-call timeoutMs
				// is for quick HTTP, not these. A deadline miss closes the transport and
				// kills the whole FSM surface, so give gates headroom.
				const result = await owner.broker.invoke(binding, tool.name, params, {
					deadline: Date.now() + owner.timeoutMs * 10, ...(signal ? { signal } : {}),
					...(onUpdate ? { onProgress: (progress: unknown) => onUpdate({ content: [], details: { progress } }) } : {}),
				});
				return projectMcpToolResult(result);
			},
		});
	}
	return () => { active = false; };
}
