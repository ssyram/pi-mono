#!/usr/bin/env node
// Loop urgency E2E mock: a stateless transcript state machine that walks the
// steering → onceReady delivery script. Round identity comes only from the
// unified transcript, never from process state.
//
// State A (no URG marker seen): announce, schedule a 1s steering prompt task,
//   then hold the turn busy with `sleep 10`.
// State B (URG-STEER-HIT user message present → steering worked): print the
//   steering success line, schedule a 5s onceReady prompt task, then hold the
//   turn with `sleep 30 && echo 'sleep done'` (which onceReady must abort).
// State C (URG-ONCE-HIT user message present): print the final success line.
//
// stdin : mock-llm-server unified request JSON
// stdout: AssistantMessage JSON
import { readFileSync } from "node:fs";

let input;
try {
	input = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
	process.stderr.write(`loop-urgency: cannot parse stdin JSON: ${error}\n`);
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
const hasUserMarker = (marker) =>
	messages.some((message) => userText(message).includes(marker));

const usage = {
	input: messages.length,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: messages.length + 1,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const base = {
	api: input.api,
	provider: "loopmock",
	model: input.model,
	usage,
	timestamp: 0,
};

if (hasUserMarker("URG-ONCE-HIT")) {
	process.stdout.write(
		JSON.stringify({
			...base,
			stopReason: "stop",
			content: [{ type: "text", text: "成功完成预期的 onceReady 测试" }],
		}),
	);
} else if (hasUserMarker("URG-STEER-HIT")) {
	process.stdout.write(
		JSON.stringify({
			...base,
			stopReason: "toolUse",
			content: [
				{ type: "text", text: "成功完成 steering 测试" },
				{
					type: "toolCall",
					id: "call_once_add",
					name: "scheduled_wakeup",
					arguments: {
						action: "add",
						delay: "5s",
						prompt: "URG-ONCE-HIT onceReady 投递到达",
						urgency: "onceReady",
					},
				},
				{
					type: "toolCall",
					id: "call_long_sleep",
					name: "bash",
					arguments: { command: "sleep 30 && echo 'sleep done'" },
				},
			],
		}),
	);
} else {
	process.stdout.write(
		JSON.stringify({
			...base,
			stopReason: "toolUse",
			content: [
				{ type: "text", text: "loop 1s 后调用的 steering" },
				{
					type: "toolCall",
					id: "call_task_gate",
					name: "task",
					arguments: {
						action: "add",
						start: true,
						text: "urgency e2e walkthrough",
					},
				},
				{
					type: "toolCall",
					id: "call_steer_add",
					name: "scheduled_wakeup",
					arguments: {
						action: "add",
						delay: "1s",
						prompt: "URG-STEER-HIT steering 投递到达",
						urgency: "steering",
					},
				},
				{ type: "toolCall", id: "call_sleep10", name: "bash", arguments: { command: "sleep 10" } },
			],
		}),
	);
}
