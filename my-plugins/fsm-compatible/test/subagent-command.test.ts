import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseSubagentSend, parseModelRef, registerSubagentCommand, type SubagentCommandDeps } from "../src/children/subagent-command.ts";
import { sanitizeExtraArgs } from "../src/children/prepare-native-child.ts";

test("parseSubagentSend covers quoting, flags, passthrough and rejections", () => {
	const ok = parseSubagentSend('send "do the work" --fsm NativeWorker --model "native-mock/test:low" --name probe -- -e extra.ts -ns');
	assert.ok(!("error" in ok));
	if (!("error" in ok)) {
		assert.equal(ok.prompt, "do the work");
		assert.equal(ok.fsmName, "NativeWorker");
		assert.equal(ok.model, "native-mock/test");
		assert.equal(ok.thinking, "low");
		assert.equal(ok.name, "probe");
		assert.deepEqual(ok.extraArgs, ["-e", "extra.ts", "-ns"]);
	}

	const unquoted = parseSubagentSend("send plain prompt text --fsm X");
	if (!("error" in unquoted)) assert.equal(unquoted.prompt, "plain prompt text");

	const expectError = (raw: string, fragment: string) => { const parsed = parseSubagentSend(raw); assert.ok("error" in parsed, raw); assert.equal((parsed as { error: string }).error.includes(fragment), true, raw); };
	expectError('send "x"', "--fsm <skill-name> is required");
	expectError('send "x" --fsm', "--fsm requires a value");
	expectError('send "x" --fsm X --bogus', "unknown token");
	expectError('send "x" --fsm X -- --session', "owned by the coordinator");
	expectError('send "x" --fsm X --model p/m:nope', "unknown thinking level");
});

test("model passthrough flags are stripped because the record owns model and thinking", () => {
	const parsed = parseSubagentSend('send "p" --fsm X -- --model other/model --thinking max -e ok.ts');
	assert.ok(!("error" in parsed));
	assert.deepEqual(parsed?.extraArgs, ["-e", "ok.ts"]);
	assert.deepEqual(sanitizeExtraArgs(["--thinking", "high", "-e", "ok.ts"]), ["-e", "ok.ts"]);
	assert.throws(() => sanitizeExtraArgs(["--mode"]), /owned by the coordinator/);
	assert.throws(() => sanitizeExtraArgs(["not", 5]), /array of strings/);
	assert.deepEqual(sanitizeExtraArgs(undefined), []);
});

test("parseModelRef splits thinking suffix and validates it", () => {
	assert.deepEqual(parseModelRef("a/b"), { model: "a/b", thinking: undefined });
	assert.deepEqual(parseModelRef("a/b:high"), { model: "a/b", thinking: "high" });
	assert.equal(typeof parseModelRef("a/b:ultra"), "string");
});

test("registerSubagentCommand dispatches first, then launches with resolved model", async () => {
	const calls: string[] = [];
	const launched: unknown[] = [];
	let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
	const notifications: string[] = [];
	const pi = { registerCommand: (_name: string, def: { handler: typeof handler }) => { handler = def.handler; } } as unknown as ExtensionAPI;
	const deps: SubagentCommandDeps = {
		dispatch: async (fsm) => { calls.push(`dispatch:${fsm}`); },
		intel: async () => [],
		launch: async (input, model, thinking) => { launched.push({ input, model, thinking }); calls.push(`launch:${model}:${thinking}`); return { session_id: "ses_manual1" }; },
		hostAgentName: () => "general",
		defaultModel: () => "host/default",
		defaultThinking: () => "low",
	};
	registerSubagentCommand(pi, undefined as never, deps);
	assert.ok(handler);
	const ctx = { ui: { notify: (message: string) => notifications.push(message) } } as never as ExtensionCommandContext;
	await handler!('send "manual work" --fsm NativeWorker -- -ne', ctx);
	assert.deepEqual(calls, ["dispatch:NativeWorker", "launch:host/default:low"]);
	assert.deepEqual((launched[0] as { input: { extraArgs?: string[] } }).input.extraArgs, ["-ne"]);
	assert.ok(notifications[0]!.includes("ses_manual1"));

	calls.length = 0;
	await handler!('send "x" --fsm Y --model zai/glm:high', ctx);
	assert.deepEqual(calls, ["dispatch:Y", "launch:zai/glm:high"]);
	await handler!('send "x"', ctx);
	assert.ok(notifications.at(-1)!.includes("--fsm"));
});
