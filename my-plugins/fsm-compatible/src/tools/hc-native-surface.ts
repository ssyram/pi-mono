import { createReadTool, createWriteTool, createEditTool, createGrepTool, createFindTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** HC's native tool schemas (real collect snapshot) are the wire contract. */
export async function loadHcToolSchemas(): Promise<Record<string, { description: string; parameters: Record<string, unknown> }>> {
	const raw = await readFile(join(import.meta.dirname, "../../data/hc-tool-schemas.json"), "utf8");
	return JSON.parse(raw);
}

type Adapter = (input: Record<string, unknown>) => Record<string, unknown>;

// HC wire names → the host factory tool's input. Executors are inlined
// factory instances: no getTool lookup, no active-set timing, nothing to
// shadow — a shadowed builtin must still execute through its own factory.
const ADAPTERS: Record<string, { adapt: Adapter; make: (cwd: string) => { execute: (id: string, input: never, s?: AbortSignal, u?: unknown, c?: unknown) => Promise<unknown> } }> = {
	read: { adapt: (i) => ({ path: i.filePath, limit: i.limit, offset: i.offset }), make: (cwd) => createReadTool(cwd) as never },
	write: { adapt: (i) => ({ path: i.filePath, content: i.content }), make: (cwd) => createWriteTool(cwd) as never },
	edit: { adapt: (i) => ({ path: i.filePath, edits: [{ oldText: i.oldString, newText: i.newString, replaceAll: i.replaceAll }] }), make: (cwd) => createEditTool(cwd) as never },
	grep: { adapt: (i) => ({ pattern: i.pattern, path: i.path, glob: i.include ?? i.glob }), make: (cwd) => createGrepTool(cwd) as never },
	glob: { adapt: (i) => ({ pattern: i.pattern, path: i.path }), make: (cwd) => createFindTool(cwd) as never },
};

export async function registerHcNativeTools(pi: ExtensionAPI, cwd: string): Promise<() => void> {
	const schemas = await loadHcToolSchemas();
	for (const [name, adapter] of Object.entries(ADAPTERS)) {
		const schema = schemas[name];
		if (!schema) continue;
		const executor = adapter.make(cwd).execute;
		pi.registerTool({
			name,
			label: name,
			description: schema.description,
			parameters: schema.parameters as never,
			async execute(id: string, input: Record<string, unknown>, signal?: AbortSignal) {
				return executor(id, adapter.adapt(input) as never, signal);
			},
		} as never);
	}
	return () => { /* registerTool has no unregister */ };
}
