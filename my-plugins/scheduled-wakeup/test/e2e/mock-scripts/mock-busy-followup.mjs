#!/usr/bin/env node
// M1 busy followUp boundary: while bash sleep holds the turn, a wake prompt
// task fires and must join at the settle boundary as a continuation — the
// model sees FOLLOWUP-HIT in the SAME conversation and closes the turn.
import { readFileSync } from "node:fs";

let input;
try {
	input = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
	process.stderr.write(`busy-followup: cannot parse stdin: ${error}\n`);
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
const has = (marker) => messages.some((message) => userText(message).includes(marker));
// The unified transcript carries toolResults without toolName; match content.
const scheduled = messages.some(
	(message) =>
		message.role === "toolResult" &&
		text(message.content).includes("Added session task"),
);

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
if (has("FOLLOWUP-HIT")) {
	reply = { ...base, stopReason: "stop", content: [{ type: "text", text: "边界投递收到" }] };
} else if (scheduled) {
	// close the turn so the settle boundary can deliver the held wake
	reply = { ...base, stopReason: "stop", content: [{ type: "text", text: "忙碌结束，等待边界投递" }] };
} else {
	reply = {
		...base,
		stopReason: "toolUse",
		content: [
			{ type: "text", text: "调度 15s 后的 followUp 任务并保持忙碌" },
			{
				type: "toolCall",
				id: "call_gate",
				name: "task",
				arguments: { action: "add", start: true, text: "m1 busy followup" },
			},
			{
				type: "toolCall",
				id: "call_add",
				name: "scheduled_wakeup",
				arguments: { action: "add", delay: "15s", prompt: "FOLLOWUP-HIT 边界投递到达" },
			},
			{ type: "toolCall", id: "call_hold", name: "bash", arguments: { command: "sleep 25" } },
		],
	};
}
process.stdout.write(JSON.stringify(reply));
