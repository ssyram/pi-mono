#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
let source = "";
for await (const chunk of process.stdin) source += chunk;
const input = JSON.parse(source);
const messages = input.request?.context?.messages ?? [];
const text = (message) => typeof message.content === "string" ? message.content
	: (message.content ?? []).filter((part) => typeof part.text === "string").map((part) => part.text).join("\n");
const users = messages.filter((message) => message.role === "user").map(text).join("\n");
const lastUser = messages.findLastIndex((message) => message.role === "user");
const currentUser = lastUser >= 0 ? text(messages[lastUser]) : "";
const calls = messages.filter((message) => message.role === "assistant").flatMap((message) =>
	(message.content ?? []).filter((block) => typeof block.name === "string"));
const currentCalls = messages.slice(lastUser + 1).filter((message) => message.role === "assistant").flatMap((message) => message.content ?? []);
const results = messages.filter((message) => message.role === "toolResult").map((message) => ({ ...message,
	toolName: calls.find((call) => call.id === message.toolCallId)?.name ?? message.toolName }));
const recent = results.filter((message) => currentCalls.some((call) => call.id === message.toolCallId));
writeFileSync(`${process.env.FSM_TEST_WORKSPACE}/mock-request-shape.json`, JSON.stringify({ roles: messages.map((message) => message.role) }));
// Stop-reviewer protocol: judge requests carry the FSM-STOP-ANALYSIS marker in
// their system prompt; the verdict is scripted via CONTROL:stopverdict=... in
// the conversation so both hosts see identical analysis behavior.
const isStopReview = messages.filter((message) => message.role === "system").map(text).join("\n").includes("FSM-STOP-ANALYSIS");
const reply = (content, stopReason = "stop") => ({ content, api: input.api ?? "openai-completions",
	provider: "native-mock", model: input.model ?? "test", stopReason, timestamp: Date.now(),
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const call = (name, args) => reply([{ type: "toolCall", id: `probe-${calls.length}`, name, arguments: args }], "toolUse");
const done = () => reply([{ type: "text", text: "probe complete" }]);
if (isStopReview) {
	const requested = (users.match(/CONTROL:stopverdict=(\S+)/) ?? [])[1] ?? "observe";
	const verdicts = {
		wait: { action: "WaitForAsyncWork", reason: "async work still running per evidence" },
		human: { action: "HumanIntervention", reason: "same obstacle repeated without progress; human should intervene" },
		observe: { action: "ArrangeObservation", reason: "agent should continue and arrange observation" },
		invalid: { action: "Nonsense", reason: "" },
	};
	process.stdout.write(JSON.stringify(reply([{ type: "toolCall", id: `stop-${calls.length}`, name: "StructuredOutput", arguments: verdicts[requested] ?? verdicts.observe }], "toolUse")));
} else {
const has = (name) => results.find((message) => message.toolName === name);
const mark = (name, content) => call("Write", { file_path: `${process.env.FSM_TEST_WORKSPACE}/${name}`, content });
const exitProbe = () => !has("mcp__fsm__fsm_submit_self_check")
	? call("mcp__fsm__fsm_submit_self_check", { target: "_fsm_exit", checks: [] })
	: !has("mcp__fsm__exit_fsm") ? call("mcp__fsm__exit_fsm", {}) : done();
const launch = (prompt, type = "general") => call("agent", { description: "native boundary probe", subagent_type: type,
	prompt, cwd: process.env.FSM_TEST_WORKSPACE });
let response;
if (currentUser.includes("CONTROL:release") && !recent.length) response = mark("release-bridge", "release");
else if (currentUser.includes("CONTROL:list")) response = recent.length ? done() : call("agent_list", {});
else if (/CONTROL:(stop|send):/.test(currentUser)) {
	const [, action, target] = currentUser.match(/CONTROL:(stop|send):(\S+)/);
	response = recent.length ? done() : call(`agent_${action}`, { target, ...(action === "send" ? { message: "CHILD:resume" } : {}) });
} else if (currentUser.includes("CHILD:resume")) response = recent.length ? done() : mark("child-resumed", "resumed");
else if (users.includes("CHILD:retry")) {
	const marker = `${process.env.FSM_TEST_WORKSPACE}/retry-injected`;
	if (!existsSync(marker)) { writeFileSync(marker, "once"); response = { error: { status: 429, code: "rate_limited", message: "controlled retry" } }; }
	else response = done();
} else if (users.includes("CHILD:plain")) response = done();
else if (users.includes("CHILD:crash")) response = has("native_test_crash") ? done() : call("native_test_crash", {});
else if (/CHILD:stream:(\d+)x(\d+)/.test(users)) {
	const [, totalText, secsText] = users.match(/CHILD:stream:(\d+)x(\d+)/);
	const total = Number(totalText), secs = Number(secsText);
	const bashes = results.filter((message) => message.toolName === "Bash").length;
	if (bashes >= total) response = exitProbe();
	else {
		const chunk = `stream round ${bashes + 1}/${total} ${"∎∎∎∎∎∎∎∎∎∎".slice(0, Math.min(10, total))} ${Date.now()}`;
		response = reply([{ type: "text", text: chunk },
			{ type: "toolCall", id: `probe-${calls.length}`, name: "Bash", arguments: { command: `sleep ${secs}`, timeout: (secs + 60) * 1000 } }], "toolUse");
	}
} else if (users.includes("CHILD:slow")) {
	if (!has("Write")) response = mark("child-running", "running");
	else if (!has("Bash")) response = call("Bash", { command: `node -e ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(`${process.env.FSM_TEST_WORKSPACE}/child-shell-pid`)}, String(process.pid));setTimeout(() => {}, 60000)`)}`, timeout: 90000 });
	else response = exitProbe();
} else if (users.includes("CHILD:recursive-2")) {
	if (!has("agent")) response = launch("CHILD:plain");
	else if (!has("Write")) response = mark("recursion-at-limit", text(has("agent")));
	else response = done();
} else if (users.includes("CHILD:recursive-1")) {
	if (!has("agent")) response = launch("CHILD:recursive-2");
	else response = done();
} else if (users.includes("CHILD:guard")) {
	const state = has("mcp__fsm__fsm_get_state");
	if (!state) response = call("mcp__fsm__fsm_get_state", {});
	else if (users.includes("guard-bound") && !has("Write")) response = mark("forbidden-child-write", "must not write");
	else if (!results.some((message) => message.toolName === "Write" && text(message).includes("wrote "))) {
		const denial = users.includes("guard-bound") ? text(has("Write")) : "";
		response = mark("child-fsm-present", `${text(state)}\n${denial}`);
	} else if (users.includes("guard-bound-park") && !has("Bash")) response = call("Bash", {
		command: `node -e ${JSON.stringify(`const f=require('node:fs');const t=setInterval(()=>{if(f.existsSync(${JSON.stringify(`${process.env.FSM_TEST_WORKSPACE}/release-bridge`)}))clearInterval(t)},30)`)}`, timeout: 30000 });
	else response = users.includes("guard-bound") ? exitProbe() : done();
} else if (users.includes("CASE:hold")) {
	const rounds = messages.filter((message) => message.role === "assistant" && text(message).includes("probe complete")).length;
	if (!has("mcp__fsm__enter_fsm")) response = call("mcp__fsm__enter_fsm", { name: "NativeRoot" });
	else if (!has("mcp__fsm__fsm_dispatch_subagent")) response = call("mcp__fsm__fsm_dispatch_subagent", { fsm: "NativeWorker" });
	else if (rounds >= 10) response = exitProbe();
	else response = done();
} else if (users.includes("CASE:")) {
	if ((users.includes("CASE:guard") || users.includes("CASE:bridge") || users.includes("CASE:empty-queue")) && !has("mcp__fsm__enter_fsm")) response = call("mcp__fsm__enter_fsm", { name: "NativeRoot" });
	else if ((users.includes("CASE:guard") || users.includes("CASE:bridge")) && !has("mcp__fsm__fsm_dispatch_subagent")) response = call("mcp__fsm__fsm_dispatch_subagent", { fsm: "NativeWorker" });
	else if (!has("agent")) response = launch(users.includes("CASE:forbidden") || users.includes("CASE:empty-queue") ? "CHILD:plain"
		: users.includes("CASE:bridge") ? "CHILD:guard-bound-park" : users.includes("CASE:guard") ? "CHILD:guard-bound" : users.includes("CASE:recursive") ? "CHILD:recursive-1"
		: users.includes("CASE:slow") ? "CHILD:slow" : users.includes("CASE:crash") ? "CHILD:crash"
		: users.includes("CASE:retry") ? "CHILD:retry" : "CHILD:guard", users.includes("CASE:forbidden") ? "forbidden" : "general");
	else response = users.includes("CASE:guard") || users.includes("CASE:empty-queue")
		|| (users.includes("CASE:bridge") && existsSync(`${process.env.FSM_TEST_WORKSPACE}/release-bridge`)) ? exitProbe() : done();
} else response = done();
process.stdout.write(JSON.stringify(response));
}
