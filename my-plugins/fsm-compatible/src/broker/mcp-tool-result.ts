import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

type Json = NonNullable<AgentToolResult<unknown>["structuredContent"]>;
function isJson(value: unknown): value is Json {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJson);
	return isAdmissionObject(value) && Object.values(value).every(isJson);
}

export function projectMcpToolResult(result: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
	if (!Array.isArray(result.content) || (result.isError !== undefined && typeof result.isError !== "boolean")) {
		throw new RuntimeError("protocol-invalid");
	}
	const content: AgentToolResult<unknown>["content"] = [];
	for (const block of result.content) {
		if (!isAdmissionObject(block) || typeof block.type !== "string") throw new RuntimeError("protocol-invalid");
		if (block.type === "text") {
			if (typeof block.text !== "string") throw new RuntimeError("protocol-invalid");
			content.push({ type: "text", text: block.text });
		} else if (block.type === "image") {
			if (typeof block.data !== "string" || typeof block.mimeType !== "string") throw new RuntimeError("protocol-invalid");
			content.push({ type: "image", data: block.data, mimeType: block.mimeType });
		} else {
			content.push({ type: "text", text: JSON.stringify(block) });
		}
	}
	if (result.structuredContent !== undefined && (!isAdmissionObject(result.structuredContent) || !isJson(result.structuredContent))) {
		throw new RuntimeError("protocol-invalid");
	}
	return { content, details: structuredClone(result),
		...(result.structuredContent !== undefined ? { structuredContent: structuredClone(result.structuredContent) } : {}),
		...(typeof result.isError === "boolean" ? { isError: result.isError } : {}) };
}
