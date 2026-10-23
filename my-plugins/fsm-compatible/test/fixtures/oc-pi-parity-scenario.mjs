#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
const input = JSON.parse(await new Promise((resolve) => { let text = ""; process.stdin.on("data", (chunk) => { text += chunk; }); process.stdin.on("end", () => resolve(text)); }));
const messages = input.request?.context?.messages ?? [];
const textOf = (message) => typeof message?.content === "string" ? message.content
	: (message?.content ?? []).filter((block) => typeof block.text === "string").map((block) => block.text).join("\n");
const firstUser = textOf(messages.find((message) => message.role === "user"));
const child = firstUser.includes("PARITY:child") || firstUser.includes("PARITY:unexpected");
const role = child ? "child" : "main";
const work = process.env.FSM_TEST_WORKSPACE;
const calls = messages.filter((message) => message.role === "assistant").flatMap((message) =>
	(message.content ?? []).filter((block) => typeof block.name === "string"));
const results = new Map(messages.filter((message) => message.role === "toolResult").map((message) => [message.toolCallId, message]));
const reply = (content, stopReason = "stop") => ({ content, stopReason, api: input.api ?? "openai-completions",
	provider: "native-mock", model: input.model ?? "test", timestamp: Date.now(),
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const done = (value) => reply([{ type: "text", text: value }]);
const invoke = (name, args) => reply([{ type: "toolCall", id: `parity-${calls.length}`, name, arguments: args }], "toolUse");
const checked = [];
const save = (name, value) => { const path = `${work}/${name}`; const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(value)); renameSync(temporary, path); };
const require = (condition, message) => { if (!condition) throw new Error(message); };
const parsed = (result) => { const value = JSON.parse(textOf(result)); require(value && !value.error, "tool returned an error"); return value; };
function step(label, name, args, match, check) {
	const call = calls.find((item) => item.name === name && match(item.arguments));
	if (!call) return invoke(name, args);
	const result = results.get(call.id);
	require(result, `missing result: ${label}`);
	check(result); checked.push({ label, passed: true }); return null;
}
const write = (label, file, value, denied = false) => step(label, "write", { filePath: `${work}/${file}`, content: value },
	(args) => args.filePath === `${work}/${file}`, (result) => {
		if (denied) { require(/blacklist/i.test(textOf(result)), `${label}: blacklist missing`); require(!existsSync(`${work}/${file}`), `${label}: denied write occurred`); }
		else require(existsSync(`${work}/${file}`) && readFileSync(`${work}/${file}`, "utf8") === value, `${label}: write missing`);
	});
const waitFor = (label, file) => step(label, "bash", { description: label,
	command: `node -e ${JSON.stringify(`const f=require('node:fs');let n=0;const t=setInterval(()=>{if(f.existsSync(${JSON.stringify(`${work}/${file}`)})){clearInterval(t)}else if(++n>500){process.exit(2)}},30)`)}` },
	(args) => args.command.includes(file), () => require(existsSync(`${work}/${file}`), `${label}: marker missing`));
const exit = () => step("self-check", "fsm_fsm_submit_self_check", { target: "_fsm_exit", checks: [] },
	(args) => args.target === "_fsm_exit", (result) => parsed(result))
	?? step("exit", "fsm_exit_fsm", {}, () => true, (result) => require(/_default/.test(JSON.stringify(parsed(result))), "exit did not return default"));
function childId() {
	const call = calls.find((item) => item.name === "agent" && item.arguments.prompt === "PARITY:child");
	const result = call ? results.get(call.id) : undefined;
	require(result, "child launch result missing");
	const value = textOf(result).trim();
	let id;
	if (value.startsWith("{")) {
		const data = JSON.parse(value); require(data.status === "started" || data.status === "queued", "child was not started");
		id = data.session_id ?? data.sessionId;
	} else {
		require(/^Started .+ agent\./.test(value), "OC child was not started");
		id = value.match(/(?:^|\n)session_id:\s*(\S+)/)?.[1];
	}
	require(typeof id === "string", "child session id missing"); return id;
}
let response;
try {
	if (firstUser.startsWith("BEGIN UNTRUSTED STOP EVIDENCE")) response = calls.some((item) => item.name === "StructuredOutput")
		? done("fixture stop verdict submitted") : invoke("StructuredOutput", { action: "wait_for_async_work", reason: "fixture worker/report is asynchronous; allow this turn to yield" });
	else if (firstUser.includes("PARITY:unexpected")) response = write("unexpected-child", "unexpected-child", "bad") ?? done("unexpected child ran");
	else if (child) {
		response = step("child-state", "fsm_fsm_get_state", {}, () => true,
			(result) => require(/NativeWorker/.test(JSON.stringify(parsed(result))), "child did not inherit dispatched FSM"))
			?? write("child-deny", "forbidden-child-write", "bad", true)
			?? write("child-ready", "child-ready", "child")
			?? waitFor("child-wait-release", "release-parity");
		if (!response) {
			require(messages.some((message) => message.role === "user" && textOf(message).includes("PARITY:ping")), "agent_send did not reach child");
			response = write("child-ping", "child-ping", "ping") ?? exit();
		}
		if (!response) {
			save("parity-child.json", { role, checked });
			response = done("PARITY_CHILD_FINISHED");
		}
	} else {
		response = step("enter", "fsm_enter_fsm", { name: "NativeRoot" }, () => true,
			(result) => require(/NativeRoot/.test(JSON.stringify(parsed(result))), "parent did not enter probe FSM"))
			?? write("main-deny", "forbidden-child-write", "bad", true)
			?? write("main-write", "main-ok", "main")
			?? step("empty-dispatch", "agent", { description: "must be denied", prompt: "PARITY:unexpected", subagent_type: "general", cwd: work },
				(args) => args.prompt === "PARITY:unexpected", (result) => {
					require(/dispatch/i.test(textOf(result)), "empty dispatch was not rejected"); require(!existsSync(`${work}/unexpected-child`), "unreserved child ran");
				})
			?? step("dispatch", "fsm_fsm_dispatch_subagent", { fsm: "NativeWorker" }, () => true,
				(result) => require(parsed(result).ok === true, "dispatch failed"))
			?? step("launch", "agent", { description: "parity worker", prompt: "PARITY:child", subagent_type: "general", cwd: work },
				(args) => args.prompt === "PARITY:child", () => childId())
			?? waitFor("main-wait-child", "child-ready");
		if (!response) response = step("send", "agent_send", { target: childId(), message: "PARITY:ping" }, () => true,
			(result) => require(!/error|failed/i.test(textOf(result)), "agent_send failed"))
			?? write("release", "release-parity", "release")
			?? waitFor("main-wait-ping", "child-ping");
		if (!response && !messages.some((message) => textOf(message).includes("PARITY_CHILD_FINISHED"))) response = done("Waiting for child report");
		if (!response) response = step("list", "agent_list", {}, () => true,
			(result) => require(textOf(result).includes(childId()), "child missing from agent_list")) ?? exit();
		if (!response) { save("parity-main.json", { role, checked }); response = done("PARITY_MAIN_FINISHED"); }
	}
} catch (error) {
	save("parity-failure.json", { role, stage: checked.at(-1)?.label, error: error instanceof Error ? error.message : "scenario failure" });
	response = done("PARITY_FAILED");
}
process.stdout.write(JSON.stringify(response));
