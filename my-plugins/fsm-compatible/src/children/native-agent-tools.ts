import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface NativeAgentOperations {
	call(action: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

export function registerNativeAgentTools(pi: ExtensionAPI, operations: NativeAgentOperations, canSpawn: boolean): () => void {
	let active = true;
	const launch = Type.Object({ description: Type.String(), prompt: Type.String(), subagent_type: Type.String(),
		cwd: Type.Optional(Type.String()), name: Type.Optional(Type.String()) }, { additionalProperties: false });
	const registrations = [
		...(canSpawn ? ["Agent", "agent", "task", "subagent"].map((name) => ({ name, action: "launch", parameters: launch })) : []),
		{ name: "agent_list", action: "list", parameters: Type.Object({}, { additionalProperties: false }) },
	{ name: "agent_status", action: "status", parameters: Type.Object({ target: Type.String() }, { additionalProperties: false }) },
		{ name: "agent_send", action: "send", parameters: Type.Object({ target: Type.String(), message: Type.String() }, { additionalProperties: false }) },
		...(canSpawn ? [{ name: "agent_stop", action: "stop", parameters: Type.Object({ target: Type.String() }, { additionalProperties: false }) }] : []),
	];
	for (const item of registrations) pi.registerTool({ name: item.name, label: item.name,
		description: item.action === "launch" ? "Start an admitted persistent Pi agent asynchronously; completion is reported to its parent."
			: `${item.action} persistent agents without bypassing their FSM permissions`,
		parameters: item.parameters,
		async execute(_id, input, signal, _update, ctx) {
			if (!active) throw new Error("native Agent tools closed");
			const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
			const value = await operations.call(item.action, { params: input, ...(model ? { model } : {}), thinking: pi.getThinkingLevel() }, signal);
			return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
		},
	});
	return () => { active = false; };
}
