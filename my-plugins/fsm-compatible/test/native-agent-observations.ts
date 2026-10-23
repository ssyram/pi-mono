import assert from "node:assert/strict";
import type { JsonAgentSessionEvent, RpcClient } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export function nativeToolResult(events: readonly JsonAgentSessionEvent[], name: string) {
	const event = events.findLast((item) => item.type === "tool_execution_end" && item.toolName === name);
	let content: { type: string; text?: string }[], isError: boolean | undefined;
	if (event?.type === "tool_execution_end") {
		content = (event.result as { content: { type: string; text?: string }[] }).content; isError = event.isError;
	} else {
		const ended = events.findLast((item) => item.type === "message_end" && item.message.role === "toolResult" && item.message.toolName === name);
		assert.ok(ended?.type === "message_end" && ended.message.role === "toolResult", `missing ${name} result`);
		content = ended.message.content; isError = ended.message.isError;
	}
	return { isError, text: content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n") };
}

export async function nativeAgentList(rpc: RpcClient): Promise<Record<string, unknown>[]> {
	const result = nativeToolResult(await nativePrompt(rpc, "CONTROL:list", "agent_list"), "agent_list");
	assert.equal(result.isError, false, result.text);
	return JSON.parse(result.text) as Record<string, unknown>[];
}

export async function nativePrompt(rpc: RpcClient, message: string, toolName: string): Promise<JsonAgentSessionEvent[]> {
	const events: JsonAgentSessionEvent[] = [];
	let seen = false;
	let unsubscribe = () => {};
	let timer: NodeJS.Timeout;
	let rejectRun!: (error: Error) => void;
	const completed = new Promise<JsonAgentSessionEvent[]>((resolve, reject) => {
		rejectRun = reject;
		timer = setTimeout(() => { unsubscribe(); reject(new Error(`missing settled ${toolName}`)); }, 25000);
		unsubscribe = rpc.onEvent((event) => {
			events.push(event);
			if ((event.type === "tool_execution_end" && event.toolName === toolName)
				|| (event.type === "message_end" && event.message.role === "toolResult" && event.message.toolName === toolName)) seen = true;
			if (event.type === "agent_settled" && seen) { clearTimeout(timer); unsubscribe(); resolve(events); }
		});
	});
	void rpc.prompt(message, undefined, "followUp").then((disposition) => {
		if (disposition === "handled") { clearTimeout(timer); unsubscribe(); rejectRun(new Error("probe input unexpectedly handled")); }
	}, (error) => { clearTimeout(timer); unsubscribe(); rejectRun(error instanceof Error ? error : new Error("probe input rejected")); });
	return completed;
}

export async function waitNativeReport(rpc: RpcClient, id: string): Promise<string[]> {
	const deadline = Date.now() + 15000;
	for (;;) {
		const { entries } = await rpc.getEntries();
		const reports = entries.filter((entry) => entry.type === "custom_message"
			&& entry.customType === "fsm-compatible:agent-report" && typeof entry.content === "string"
			&& entry.content.startsWith(`[Agent ${id} `)).map((entry) => (entry as { content: string }).content);
		if (reports.length) return reports;
		if (Date.now() >= deadline) assert.fail("native completion report missing");
		await delay(40);
	}
}

export async function waitNativeFile(path: string): Promise<string> {
	const deadline = Date.now() + 15000;
	for (;;) {
		try { return await readFile(path, "utf8"); }
		catch (error) { if (Date.now() >= deadline) throw error; await delay(40); }
	}
}
