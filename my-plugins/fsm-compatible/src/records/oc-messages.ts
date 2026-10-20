import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { entryMillis, messageMillis } from "./record-time.ts";
import type { ExecutionRecord } from "./session-record.ts";
import type { OcMessage, OcPart } from "./oc-shapes.ts";
import { projectToolPart, type CallSource, type ResultSource } from "./oc-tool-parts.ts";

interface ToolCallBlock { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
type AnyMessage = { role: string; [key: string]: unknown };

function isToolCallBlock(value: unknown): value is ToolCallBlock {
	return isAdmissionObject(value) && value.type === "toolCall" && typeof value.id === "string"
		&& typeof value.name === "string" && isAdmissionObject(value.arguments);
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
	return isAdmissionObject(value) && value.type === "text" && typeof value.text === "string";
}

function isImageBlock(value: unknown): value is { type: "image"; data: string; mimeType: string } {
	return isAdmissionObject(value) && value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string";
}

function finishFor(stopReason: string): "stop" | "tool-calls" | "length" | "error" {
	if (stopReason === "toolUse") return "tool-calls";
	if (stopReason === "length") return "length";
	if (stopReason === "error" || stopReason === "aborted") return "error";
	return "stop";
}

function errorFor(message: AnyMessage): { name: string; data: Record<string, unknown> } | undefined {
	const reason = message.stopReason;
	if (reason !== "error" && reason !== "aborted" && reason !== "length") return undefined;
	const name = reason === "aborted" ? "MessageAbortedError"
		: reason === "length" ? "MessageOutputLengthError" : "UnknownProviderError";
	const text = typeof message.errorMessage === "string" ? message.errorMessage.slice(0, 2000) : "";
	return { name, data: { message: text } };
}

export function projectOcMessages(record: { readonly sessionId: string; readonly branch: readonly import("@earendil-works/pi-coding-agent").SessionEntry[] }): readonly OcMessage[] {
	const sessionId = record.sessionId;
	const calls = new Map<string, { block: ToolCallBlock; source: CallSource }>();
	const results = new Map<string, ResultSource>();
	const messages: OcMessage[] = [];
	// Step P1: index real calls and results first; association failures reject the whole snapshot.
	for (const entry of record.branch) {
		if (entry.type !== "message") continue;
		const message = entry.message as AnyMessage;
		const fallback = entryMillis(entry);
		if (message.role === "assistant") {
			const created = messageMillis(message as { timestamp?: number }, fallback);
			for (const block of message.content as unknown[]) {
				if (!isToolCallBlock(block)) continue;
				if (calls.has(block.id)) throw new RuntimeError("protocol-invalid");
				calls.set(block.id, { block, source: { name: block.name, arguments: structuredClone(block.arguments), observedStart: created } });
			}
		}
		if (message.role === "toolResult") {
			const toolCallId = message.toolCallId;
			if (typeof toolCallId !== "string" || !toolCallId || results.has(toolCallId)) throw new RuntimeError("protocol-invalid");
			const content = message.content;
			if (!Array.isArray(content)) throw new RuntimeError("protocol-invalid");
			const texts = content.filter(isTextBlock).map((block) => block.text);
			const images = content.filter(isImageBlock).map((block) => ({ data: block.data, mimeType: block.mimeType }));
			results.set(toolCallId, {
				toolName: typeof message.toolName === "string" ? message.toolName : "",
				texts, images,
				isError: message.isError === true,
				end: messageMillis(message as { timestamp?: number }, fallback),
				details: message.details,
				nested: message.nestedCalls,
			});
		}
	}
	for (const [toolCallId] of results) {
		if (!calls.has(toolCallId)) throw new RuntimeError("protocol-invalid");
	}
	for (const entry of record.branch) {
		if (entry.type !== "message" && entry.type !== "custom_message") continue;
		const message = entry.type === "message"
			? entry.message as AnyMessage
			: { role: "custom", customType: entry.customType, content: entry.content, details: entry.details } as AnyMessage;
		const fallback = entryMillis(entry);
		const created = messageMillis(message as { timestamp?: number }, fallback);
		const push = (role: "user" | "assistant", parts: readonly OcPart[], extra?: Record<string, unknown>) => {
			messages.push({ info: { role, id: `msg_${entry.id}`, sessionID: sessionId, time: { created } },
				parts, ...(extra ? { metadata: { pi: Object.freeze(extra) } } : {}) });
		};
		if (message.role === "user" || message.role === "system" || message.role === "custom") {
			const content = message.content;
			const parts: OcPart[] = [];
			if (typeof content === "string") {
				parts.push({ type: "text", id: `prt_${entry.id}_0`, sessionID: sessionId, messageID: `msg_${entry.id}`, text: content });
			} else if (Array.isArray(content)) {
				for (const [index, block] of content.entries()) {
					const id = { id: `prt_${entry.id}_${index}`, sessionID: sessionId, messageID: `msg_${entry.id}` };
					if (isTextBlock(block)) parts.push({ type: "text", ...id, text: block.text });
					else if (isImageBlock(block)) parts.push({ type: "file", ...id, mime: block.mimeType, url: `data:${block.mimeType};base64,${block.data}` });
					else throw new RuntimeError("protocol-invalid");
				}
			} else throw new RuntimeError("protocol-invalid");
			const extra: Record<string, unknown> = {};
			if (message.role === "system") extra.role = "system";
			if (message.role === "custom") {
				extra.customType = message.customType;
			if (message.details !== undefined) extra.details = message.details;
			}
			push("user", parts, extra);
			continue;
		}
		if (message.role === "bashExecution") {
			const cancelled = message.cancelled === true;
			const exitCode = typeof message.exitCode === "number" ? message.exitCode : undefined;
			const ok = exitCode === 0 && !cancelled;
			const output = typeof message.output === "string" ? message.output : "";
			const command = typeof message.command === "string" ? message.command : "";
			const part: OcPart = { type: "tool", id: `prt_${entry.id}_0`, sessionID: sessionId,
				messageID: `msg_${entry.id}`, tool: "bash", callID: `bash_${entry.id}`,
				state: { input: { command }, status: ok ? "completed" : "error",
					...(ok ? { output } : { error: output || `bash failed (exit ${String(exitCode)})` }),
					time: { start: created } },
				metadata: { pi: { bashExecution: { command, output, exitCode, cancelled,
						truncated: message.truncated === true } } } };
			const info: OcMessage["info"] = { role: "assistant", id: `msg_${entry.id}`, sessionID: sessionId,
				time: { created }, finish: "stop" };
			messages.push({ info, parts: [part] });
			continue;
		}
		if (message.role !== "assistant") continue;
		const parts: OcPart[] = [];
		let end = created;
		let allCallsResolved = true;
		for (const block of message.content as unknown[]) {
			if (isTextBlock(block)) {
				parts.push({ type: "text", id: `prt_${entry.id}_${parts.length}`, sessionID: sessionId, messageID: `msg_${entry.id}`, text: block.text });
				continue;
			}
			if (isAdmissionObject(block) && block.type === "thinking" && typeof block.thinking === "string") {
				parts.push({ type: "reasoning", id: `prt_${entry.id}_${parts.length}`, sessionID: sessionId, messageID: `msg_${entry.id}`, text: block.thinking });
				continue;
			}
			if (isToolCallBlock(block)) {
				const call = calls.get(block.id);
				if (!call) throw new RuntimeError("protocol-invalid");
				const result = results.get(block.id);
				if (result) end = Math.max(end, result.end);
				else allCallsResolved = false;
				parts.push(projectToolPart(sessionId, entry.id, parts.length, block.id, call.source, result));
			}
		}
		const stopReason = typeof message.stopReason === "string" ? message.stopReason : "stop";
		const complete = stopReason !== "pending" && (parts.every((part) => part.type !== "tool") || allCallsResolved);
		const error = errorFor(message);
		const info: OcMessage["info"] = { role: "assistant", id: `msg_${entry.id}`, sessionID: sessionId,
			time: { created, ...(complete ? { completed: Math.max(created, end) } : {}) }, finish: finishFor(stopReason),
			...(error ? { error } : {}) };
		const extra: Record<string, unknown> = { stopReason };
		if (typeof message.model === "string") extra.model = message.model;
		messages.push({ info, parts, metadata: { pi: Object.freeze(extra) } });
	}
	return messages;
}
