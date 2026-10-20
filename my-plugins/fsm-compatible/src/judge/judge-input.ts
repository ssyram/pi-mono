import { Ajv, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

export interface JudgeInput {
	readonly system: string;
	readonly tools: Readonly<Record<string, boolean>>;
	readonly schema: Record<string, unknown>;
	readonly user: string;
	readonly validate: ValidateFunction;
}

function parseTools(value: unknown): Readonly<Record<string, boolean>> {
	if (!isAdmissionObject(value)) throw new RuntimeError("protocol-invalid");
	const tools: Record<string, boolean> = {};
	for (const [name, enabled] of Object.entries(value)) {
		if (!name || typeof enabled !== "boolean") throw new RuntimeError("protocol-invalid");
		tools[name] = enabled;
	}
	return Object.freeze(tools);
}

function parseUser(value: unknown): string {
	if (!Array.isArray(value) || !value.length) throw new RuntimeError("protocol-invalid");
	const texts: string[] = [];
	for (const part of value) {
		if (!isAdmissionObject(part) || part.type !== "text" || typeof part.text !== "string") throw new RuntimeError("protocol-invalid");
		texts.push(part.text);
	}
	return texts.join("\n");
}

export function parseJudgeInput(body: unknown): JudgeInput {
	// Step P3: one request -> one turn; nothing here touches a model or session.
	if (!isAdmissionObject(body)) throw new RuntimeError("protocol-invalid");
	const known = new Set(["system", "tools", "format", "parts"]);
	for (const key of Object.keys(body)) {
		if (!known.has(key)) throw new RuntimeError("protocol-invalid");
	}
	if (typeof body.system !== "string" || !body.system) throw new RuntimeError("protocol-invalid");
	const tools = parseTools(body.tools);
	if (!isAdmissionObject(body.format) || body.format.type !== "json_schema" || !isAdmissionObject(body.format.schema)) {
		throw new RuntimeError("protocol-invalid");
	}
	const schema = structuredClone(body.format.schema);
	const schemaVersion = schema.$schema;
	if (schemaVersion !== undefined && typeof schemaVersion !== "string") throw new RuntimeError("protocol-invalid");
	const engine = typeof schemaVersion === "string" && schemaVersion.includes("2020-12")
		? new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
		: new Ajv({ strict: false, allErrors: true, validateFormats: false });
	let validate: ValidateFunction;
	try { validate = engine.compile(schema); } catch { throw new RuntimeError("protocol-invalid"); }
	return Object.freeze({ system: body.system, tools, schema, user: parseUser(body.parts), validate });
}
