import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** HC's native tool schemas (real collect snapshot) are the wire contract. */
export async function loadHcToolSchemas(): Promise<Record<string, { description: string; parameters: Record<string, unknown> }>> {
	const raw = await readFile(join(import.meta.dirname, "../../data/hc-tool-schemas.json"), "utf8");
	return JSON.parse(raw);
}

type Adapter = (input: Record<string, unknown>, ctx: { cwd: string }) => Promise<unknown> | unknown;

/** Parameter adapters: HC wire names → the host implementation's input. */
const ADAPTERS: Record<string, Adapter> = {
	read: (input) => ({ path: input.filePath, limit: input.limit, offset: input.offset }),
	write: (input) => ({ path: input.filePath, content: input.content }),
	bash: (input) => ({ command: input.command, ...(input.timeout !== undefined ? { timeout: Number(input.timeout) / 1000 } : {}) }),
	grep: (input) => ({ pattern: input.pattern, path: input.path, glob: input.include ?? input.glob }),
	glob: (input) => ({ pattern: input.pattern, path: input.path }),
};

/**
 * Re-register the file/shell/search tools under HC's exact wire schema.
 * The Pi builtins with the same names must first leave the active set:
 * a registration shadowing an active builtin disappears from the wire.
 */
export async function registerHcNativeTools(pi: ExtensionAPI, run: (tool: string, input: unknown) => Promise<unknown>): Promise<() => void> {
	const schemas = await loadHcToolSchemas();
	for (const [name, adapter] of Object.entries(ADAPTERS)) {
		const schema = schemas[name];
		if (!schema) continue;
		pi.registerTool({
			name,
			label: name,
			description: schema.description,
			parameters: schema.parameters as never,
			async execute(_id: string, input: Record<string, unknown>) {
				return run(name, adapter(input, { cwd: process.cwd() }));
			},
		} as never);
	}
	return () => { /* registerTool has no unregister */ };
}
