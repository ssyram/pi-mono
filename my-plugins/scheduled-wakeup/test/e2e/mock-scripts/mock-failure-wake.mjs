#!/usr/bin/env node
// M5 + M6 failure wakes: the loop's synthesized/killed failed results arrive
// as wake turns; the mock identifies which marker it got and confirms. Used
// by both the lost-wrapper and timeout scenarios.
import { readFileSync } from "node:fs";

let input;
try {
	input = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
	process.stderr.write(`failure-wake: cannot parse stdin: ${error}\n`);
	process.exit(1);
}
const messages = input.request?.context?.messages ?? [];
const userText = (message) => {
	if (message.role !== "user") return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.map((block) => (typeof block === "string" ? block : block.text))
			.filter((text) => typeof text === "string")
			.join("\n");
	return "";
};
const all = messages.map((message) => userText(message)).join("\n");

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

let text = "等待投递";
if (all.includes("LOST-HIT")) text = "lost 合成被唤醒";
else if (all.includes("TIMEOUT-HIT")) text = "timeout 处理正确";
process.stdout.write(JSON.stringify({ ...base, stopReason: "stop", content: [{ type: "text", text }] }));
