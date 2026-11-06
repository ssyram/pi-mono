#!/usr/bin/env node
// M2 no-wake quiet append: a never-wake script task finishes while bash holds
// the turn; its result must append as boundary entries WITHOUT a new turn.
// Only when the user later says "check" does the model confirm seeing it.
import { readFileSync } from "node:fs";

let input;
try {
	input = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
	process.stderr.write(`quiet-append: cannot parse stdin: ${error}\n`);
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
if (has("QUIET-HIT-CONTENT")) {
	reply = { ...base, stopReason: "stop", content: [{ type: "text", text: "看到 QUIET-HIT" }] };
} else if (scheduled) {
	reply = { ...base, stopReason: "stop", content: [{ type: "text", text: "忙碌结束" }] };
} else {
	reply = {
		...base,
		stopReason: "toolUse",
		content: [
			{ type: "text", text: "安排静默任务并保持忙碌" },
			{
				type: "toolCall",
				id: "call_gate",
				name: "task",
				arguments: { action: "add", start: true, text: "m2 quiet append" },
			},
			{
				type: "toolCall",
				id: "call_add",
				name: "scheduled_wakeup",
				arguments: {
					action: "add",
					delay: "3s",
					scriptTask: {
						wakeUp: { kind: "never" },
						scripts: [{ path: "/bin/echo", params: ["QUIET-HIT-CONTENT"] }],
					},
				},
			},
			{ type: "toolCall", id: "call_hold", name: "bash", arguments: { command: "sleep 12" } },
		],
	};
}
process.stdout.write(JSON.stringify(reply));
