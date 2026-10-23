#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
let bytes = ""; for await (const chunk of process.stdin) bytes += chunk;
const input = JSON.parse(bytes), messages = input.request?.context?.messages ?? [];
const text = (message) => typeof message?.content === "string" ? message.content
	: (message?.content ?? []).filter((part) => typeof part.text === "string").map((part) => part.text).join("\n");
const system = messages.filter((message) => message.role === "system").map(text).join("\n");
const calls = messages.filter((message) => message.role === "assistant").flatMap((message) =>
	(message.content ?? []).filter((part) => typeof part.name === "string"));
const results = new Map(messages.filter((message) => message.role === "toolResult").map((message) => [message.toolCallId, message]));
const reply = (content, stopReason = "stop") => ({ content, stopReason, api: input.api ?? "openai-completions",
	provider: "native-mock", model: input.model ?? "test", timestamp: Date.now(),
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const done = (value) => reply([{ type: "text", text: value }]);
const invoke = (name, args) => reply([{ type: "toolCall", id: `delivery-${calls.length}`, name, arguments: args }], "toolUse");
const firstUser = text(messages.find((message) => message.role === "user"));
if (firstUser.trimStart().startsWith("Watch tick")) {
	process.stdout.write(JSON.stringify(calls.some((call) => call.name === "StructuredOutput") ? done("fixture watcher submitted")
		: invoke("StructuredOutput", { status_summary: "controlled fixture integration", findings: [], notify_agent: false, notify_reason: "no scripted advisory" })));
} else if (system.includes("StructuredOutput")) {
	process.stdout.write(JSON.stringify(calls.some((call) => call.name === "StructuredOutput") ? done("fixture review submitted")
		: invoke("StructuredOutput", { checks: [{ criterion: "fixture integration verdict", passed: true, reason: "scripted protocol verdict, not a semantic review" }],
			overall_passed: true, blocking_issues: [], summary: "fixture PASS for real hard-gate delivery integration only" })));
} else {
	const context = JSON.parse(readFileSync(`${dirname(process.env.FSM_TEST_WORKSPACE)}/ccv-delivery-context.json`, "utf8"));
	const work = context.workspace, checked = [];
	const require = (condition, message) => { if (!condition) throw new Error(message); };
	const matches = (name, predicate = () => true) => calls.filter((call) => call.name === name && predicate(call.arguments));
	const result = (name, index = 0, predicate) => { const call = matches(name, predicate)[index]; return call ? results.get(call.id) : undefined; };
	const json = (message) => { const value = JSON.parse(text(message)); require(!value.error, "tool returned error"); return value; };
	const step = (label, name, args, index, predicate, check) => {
		const call = matches(name, predicate)[index];
		if (!call) return invoke(name, typeof args === "function" ? args() : args);
		const value = results.get(call.id); require(value, `result missing: ${label}`); check(value); checked.push(label); return null;
	};
	const state = (index) => json(result("fsm_fsm_get_state", index));
	const enter = () => json(result("fsm_enter_fsm"));
	const checks = (view) => view.liveness_properties.map((property) => ({ property, satisfied: true,
		evidence: "controlled fixture: input/report presence is observed; hard gates independently decide validity; negative report test deliberately challenges the declaration" }));
	const self = (target, properties, index = 0) => step(`self-${target}-${index}`, "fsm_fsm_submit_self_check",
		() => ({ target, checks: checks(typeof properties === "function" ? properties() : properties) }), index,
		(args) => args.target === target, (value) => require(json(value).status === "ready", "self-check not ready"));
	const transition = (target, index, accept, reason) => step(`transition-${target}-${index}`, "fsm_fsm_try_transition",
		{ target, evidence: `controlled delivery fixture ${reason}` }, index, (args) => args.target === target,
		(value) => { const data = json(value); require(data.status === (accept ? "accept" : "reject"), `transition ${target} unexpected status`);
			if (!accept && target === "V_DELIVER") require(data.issues.some((issue) => issue.passed === false
				&& issue.check_name.includes("failed_report_check") && issue.detail.includes("must be non-empty")), "negative report did not reach its hard gate");
			if (!accept && target === "V_A_INTENT") require(JSON.stringify(data).includes("syntax error"), "negative input rejected for infrastructure rather than frontend syntax"); });
	const commit = (index, message) => step(`stage-${index}`, "bash", { description: "stage fixture report", command: "git add -A" }, index * 3, () => true,
		(value) => require(!/not in whitelist|blacklist/i.test(text(value)), "staging rejected"))
		?? step(`commit-${index}`, "bash", { description: message, command: `git commit -m '${message}'` }, index * 3 + 1, () => true,
			(value) => require(!/not in whitelist|blacklist|identity unknown/i.test(text(value)), "commit rejected"))
		?? step(`head-${index}`, "bash", { description: "read fixture commit", command: "git rev-parse HEAD" }, index * 3 + 2, () => true,
			(value) => require(/\b[0-9a-f]{40}\b/.test(text(value)), "fixture commit failed"));
	const head = (index) => text(result("bash", index)).match(/\b[0-9a-f]{40}\b/g).at(-1);
	const setHead = (index) => step(`state-commit-${index}`, "fsm_fsm_set_var", () => ({ key: "state_commit", value: index === 0 ? context.head : head(index * 3 - 1) }),
		index, (args) => args.key === "state_commit", (value) => json(value));
	const originalReport = () => text(result("read", 0));
	function report(body) {
		const lines = originalReport().split("\n"), start = lines.findIndex((line) => line.trim() === "## 具体原因与证据");
		require(start >= 0, "gate-owned report heading missing");
		const next = lines.findIndex((line, index) => index > start && line.startsWith("## "));
		return [...lines.slice(0, start + 1), body, ...lines.slice(next < 0 ? lines.length : next)].join("\n");
	}
	const writeReport = (index, body) => step(`report-${index}`, "write", () => ({ filePath: context.report, content: report(body) }), index,
		(args) => args.filePath === context.report, () => {
			if (matches("write", (args) => args.filePath === context.report).length === index + 1) require(readFileSync(context.report, "utf8") === report(body), "report write mismatch");
		});
	const save = (name, value) => { const path = `${context.directory}/${name}`, temp = `${path}.${process.pid}.tmp`;
		writeFileSync(temp, JSON.stringify(value)); renameSync(temp, path); };
	let response;
	try {
		response = step("enter", "fsm_enter_fsm", { name: "CCodeVerify", vars: {
			toolchain_switch: readFileSync(`${work}/.ccv-config/toolchain`, "utf8").split("\n").find((line) => line.startsWith("switch="))?.slice(7), parallel_worker_capacity: "6" } }, 0, () => true,
			(value) => require(json(value).state_id === "V_INTAKE", "wrong intake state"))
			?? setHead(0) ?? self("V_A_INTENT", enter)
			?? transition("V_A_INTENT", 0, false, "real frontend rejects invalid immutable input")
			?? self("V_FAILED", enter) ?? transition("V_FAILED", 0, true, "honest frontend failure")
			?? step("failed-state", "fsm_fsm_get_state", {}, 0, () => true, (value) => require(json(value).state_id === "V_FAILED", "failure state missing"))
			?? step("read-report", "read", { filePath: context.report }, 0, () => true, (value) => require(text(value).includes("EVIDENCE-SHA256:"), "gate-owned report missing"))
			?? writeReport(0, "") ?? commit(0, "V_FAILED: negative empty explanation fixture") ?? setHead(1)
			?? self("V_DELIVER", () => state(0)) ?? transition("V_DELIVER", 0, false, "empty human explanation must fail")
			?? writeReport(1, "Immutable fixture input/src/broken.i is syntactically incomplete: its closing brace is missing. The canonical frontend was spawned and rejected the input; the locked failure evidence records its diagnostics. No memory_safety target was established and no cert is produced. Continuing requires a replacement input, which this fixture explicitly prohibits.")
			?? commit(1, "V_FAILED: explain gate-owned frontend failure") ?? setHead(2)
			?? self("V_DELIVER", () => state(0), 1) ?? transition("V_DELIVER", 1, true, "honest report corrected")
			?? step("deliver-state", "fsm_fsm_get_state", {}, 1, () => true, (value) => require(json(value).state_id === "V_DELIVER", "deliver state missing"))
			?? self("_fsm_exit", () => state(1))
			?? step("exit", "fsm_exit_fsm", {}, 0, () => true, (value) => require(JSON.stringify(json(value)).includes("_default"), "FSM did not exit"));
		if (!response) {
			require(!existsSync(`${work}/proof/vst/cert.json`), "honest failure must not create a cert");
			save("ccv-delivery-result.json", { passed: true, branch: "V_FAILED", checked, no_cert: true }); response = done("CCV honest-failure delivery complete");
		}
	} catch (error) { save("ccv-delivery-failure.json", { stage: checked.at(-1), error: error instanceof Error ? error.message : "fixture error" }); response = done("CCV delivery fixture failed"); }
	process.stdout.write(JSON.stringify(response));
}
