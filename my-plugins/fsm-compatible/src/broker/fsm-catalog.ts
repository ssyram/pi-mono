import { Ajv, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isDataArray } from "../admission/data-array.ts";
import { isAdmissionObject, isAdmissionIdentifier } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { McpTransport, RpcOptions } from "./mcp-transport.ts";

export interface FsmTool {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
	readonly validate: ValidateFunction;
}

export async function discoverFsmTools(transport: McpTransport, options: RpcOptions): Promise<ReadonlyMap<string, FsmTool>> {
	const tools = new Map<string, FsmTool>();
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (;;) {
		const value = await transport.call("tools/list", cursor === undefined ? {} : { cursor }, options);
		if (!isAdmissionObject(value) || !isDataArray(value.tools)) throw new RuntimeError("protocol-invalid");
		for (const tool of value.tools) {
			if (!isAdmissionObject(tool) || !isAdmissionIdentifier(tool.name) || tools.has(tool.name)
				|| !isAdmissionObject(tool.inputSchema)) throw new RuntimeError("protocol-invalid");
			const schema = tool.inputSchema;
			const schemaVersion = schema.$schema;
			if (schemaVersion !== undefined && typeof schemaVersion !== "string") throw new RuntimeError("protocol-invalid");
			const engine = typeof schemaVersion === "string" && schemaVersion.includes("2020-12")
				? new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
				: new Ajv({ strict: false, allErrors: true, validateFormats: false });
			let validate: ValidateFunction;
			try { validate = engine.compile(schema); } catch { throw new RuntimeError("protocol-invalid"); }
			tools.set(tool.name, Object.freeze({ name: tool.name,
				description: typeof tool.description === "string" ? tool.description : "FSM tool",
				inputSchema: structuredClone(schema), validate }));
		}
		if (value.nextCursor === undefined) break;
		if (typeof value.nextCursor !== "string" || !value.nextCursor || cursors.has(value.nextCursor)) throw new RuntimeError("protocol-invalid");
		cursor = value.nextCursor;
		cursors.add(cursor);
	}
	if (!tools.size) throw new RuntimeError("protocol-invalid");
	return tools;
}
