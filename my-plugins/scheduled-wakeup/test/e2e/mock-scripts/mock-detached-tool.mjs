#!/usr/bin/env node
// M4 detached survival: after pi exits, the wrapper finishes on disk; when
// the same session id returns, boot-scan reconnects and delivers the wake.
// M7 tool round-trip: add (onceReady -> warning line in the tool result),
// list, cancel, each confirmed through toolResult content the mock can read.
import { readFileSync } from "node:fs";

let input;
try {
	input = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
	process.stderr.write(`detached-tool: cannot parse stdin: ${error}\n`);
	process.exit(1);
}
const messages = input.request?.context?.messages ?? [];

const text = (value) => {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((block) => (typeof block === "string" ? block : block?.text))
			.filter((part) => typeof part === "string")
			.join("\n");
	return "";
};
const userText = (message) => (message.role === "user" ? text(message.content) : "");
const hasUser = (marker) => messages.some((message) => userText(message).includes(marker));
// The unified transcript carries toolResults without toolName; match content.
const allToolResults = messages
	.filter((message) => message.role === "toolResult")
	.map((message) => text(message.content))
	.join("\n");

const base = {
	api: input.api,
	provider: "loopmock",
	model: input.model,
	usage: {
		input: messages.length,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: messages.length + 1,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	timestamp: 0,
};

let reply;
if (hasUser("DETACHED-HIT")) {
	reply = { ...base, stopReason: "stop", content: [{ type: "text", text: "跨重启投递成功" }] };
} else {
	const added = /Added session task (session:[0-9a-f-]{36})/.exec(allToolResults);
	const sawWarning = allToolResults.includes("⚠️");
	const cancelled = allToolResults.includes("Cancelled");
	if (added !== null && sawWarning && !cancelled) {
		reply = {
			...base,
			stopReason: "toolUse",
			content: [
				{ type: "text", text: "已看到 onceReady 警告行，执行 list 与 cancel" },
				{
					type: "toolCall",
					id: "call_list",
					name: "scheduled_wakeup",
					arguments: { action: "list" },
				},
				{
					type: "toolCall",
					id: "call_cancel",
					name: "scheduled_wakeup",
					arguments: { action: "cancel", id: added[1] ?? "" },
				},
			],
		};
	} else if (cancelled) {
		reply = { ...base, stopReason: "stop", content: [{ type: "text", text: "工具往返成功" }] };
	} else {
		reply = {
			...base,
			stopReason: "toolUse",
			content: [
				{ type: "text", text: "通过工具创建 onceReady 任务" },
				{
					type: "toolCall",
					id: "call_gate",
					name: "task",
					arguments: { action: "add", start: true, text: "m7 tool roundtrip" },
				},
				{
					type: "toolCall",
					id: "call_add_urgent",
					name: "scheduled_wakeup",
					arguments: {
						action: "add",
						delay: "10s",
						prompt: "TOOL-HIT 不应到达",
						urgency: "onceReady",
					},
				},
			],
		};
	}
}
process.stdout.write(JSON.stringify(reply));
