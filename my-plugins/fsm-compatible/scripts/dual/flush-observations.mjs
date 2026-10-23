// Standalone observation flush for the Pi dual runner: converts Pi transcripts
// (root + every plugin-owned child tree) and the daemon-call log into the
// hc-fsm-reference observation files. Runs before each use-plot invocation.
import { createHash } from "node:crypto";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cfg = JSON.parse(await readFile(process.argv[3], "utf8"));
const { run, work } = cfg;
let sessionFile = null;
let protoSid = null;
for (let i = 0; i < 200; i++) {
	try {
		const s = JSON.parse(await readFile(join(run, "pi-session.json"), "utf8"));
		sessionFile = s.sessionFile;
		protoSid = s.protoSid;
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 50));
	}
}
const rid = () => createHash("sha256").update(`${run}:${Math.random()}`).digest("hex").slice(0, 20);
// Serialize concurrent flushes (one shim per model request can overlap).
const { mkdir, rmdir } = await import("node:fs/promises");
const lockDir = join(run, "flush.lock");
for (let attempt = 0; ; attempt++) {
	try {
		await mkdir(lockDir);
		break;
	} catch {
		if (attempt > 100) throw new Error("flush lock contention");
		await new Promise((r) => setTimeout(r, 50));
	}
}
const release = () => rmdir(lockDir).catch(() => {});
process.on("exit", () => { try { require("node:fs").rmdirSync(lockDir); } catch { /* best effort */ } });
const statePath = join(run, "adapter-state.json");
const seen = JSON.parse(await readFile(statePath, "utf8").catch(() => "{}"));
seen.files ??= {};
seen.hooks ??= 0;
seen.daemonLines ??= 0;
const emit = (record) => appendFile(join(run, "hc-tools.jsonl"), JSON.stringify(record) + "\n");

// Root transcript plus every child tree the plugin owns: the directory name is
// the child's HC protocol sid.
const sessions = JSON.parse(await readFile(join(run, "pi-sessions.json"), "utf8").catch(() => "null"))
	?? [{ protoSid, sessionFile, agentDir: join(run, "agent") }];
const sources = sessions.filter((session) => session.sessionFile).map((session) => ({ sid: session.protoSid, file: session.sessionFile }));
for (const session of sessions) {
	const hcRoot = join(session.agentDir, "fsm-compatible");
	for (const rootDir of await readdir(hcRoot).catch(() => [])) {
		for (const sid of await readdir(join(hcRoot, rootDir)).catch(() => [])) {
			sources.push({ sid, file: join(hcRoot, rootDir, sid, "session.jsonl") });
		}
	}
}

// Idempotence under overlap: never re-emit a callID that already has a
// before event on disk.
const emitted = new Set();
try {
	for (const line of (await readFile(join(run, "hc-tools.jsonl"), "utf8")).split("\n")) {
		if (!line) continue;
		try {
			const record = JSON.parse(line);
			if (record.kind === "before") emitted.add(record.input?.callID);
		} catch { /* partial trailing line */ }
	}
} catch { /* first flush */ }
// Transcript writes race model requests: re-read until stable.
const stableRead = async (file) => {
	let previous = "";
	for (let i = 0; i < 3; i++) {
		let text = "";
		try {
			text = await readFile(file, "utf8");
		} catch {
			return previous;
		}
		if (text === previous) return text;
		previous = text;
		await new Promise((r) => setTimeout(r, 60));
	}
	return previous;
};
const facadePath = join(run, "facade-messages.json");
const facade = JSON.parse(await readFile(facadePath, "utf8").catch(() => "{}"));

for (const source of sources) {
	const text = await stableRead(source.file);
	if (!text) continue;
	const lines = text.split("\n").filter(Boolean);
	const seenCalls = (seen.files[source.file] ??= []);
	const calls = new Map();
	for (const line of lines) {
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.type !== "message") continue;
		for (const b of e.message?.content ?? []) {
			if (b.type === "toolCall") calls.set(b.id, { name: b.name, args: b.arguments, ts: Date.parse(e.timestamp),
				providerID: e.message.provider, modelID: e.message.model });
		}
	}
	const facadeMessages = (facade[source.sid] ??= []);
	const facadeIds = new Set(facadeMessages.map((m) => m.id));
	for (const line of lines) {
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.type !== "message" || e.message?.role !== "toolResult") continue;
		const m = e.message;
		const call = calls.get(m.toolCallId);
		if (!call || seenCalls.includes(m.toolCallId) || emitted.has(m.toolCallId)) continue;
		seenCalls.push(m.toolCallId);
		const start = call.ts ?? Date.now();
		const end = Date.parse(e.timestamp) || Date.now();
		const output = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
		// HC durable parts carry shell facts for Bash: the command as title and
		// {output, exit, truncated} in metadata; other tools use title "" and
		// {truncated: false}.
		const toolName = m.toolName ?? call.name;
		const isBash = toolName === "bash";
		const command = typeof call.args?.command === "string" ? call.args.command : "";
		// HC agent parts carry the description as title and creation metadata;
		// the created sid is parsed from the Started receipt itself.
		const isAgent = toolName === "agent";
		const startedSid = isAgent ? (/session_id: (ses_[A-Za-z0-9]+)/.exec(output)?.[1] ?? null) : null;
		const isSend = toolName === "agent_send";
		const isStop = toolName === "agent_stop";
		const rawTarget = typeof call.args?.target === "string" ? call.args.target : "";
		const part = {
			type: "tool",
			callID: m.toolCallId,
			tool: m.toolName ?? call.name,
			sessionID: source.sid,
			id: `prt_${rid()}`,
			messageID: `msg_${rid()}`,
			state: m.isError
				? { status: "error", input: call.args, error: output, time: { start, end } }
				: {
					status: "completed",
					input: call.args,
					output,
					title: isBash ? command : isAgent ? String(call.args?.description ?? "") : isSend || isStop ? rawTarget : "",
					metadata: isBash
						? { output, exit: 0, truncated: false }
						: isAgent
							? { model: { providerID: "plot", modelID: "plot-model" }, sessionId: startedSid, parentSessionId: source.sid, truncated: false }
							: isSend
								? { target: rawTarget, truncated: false }
								: isStop
									? { stopped: (output.match(/^Stopped (\d+) Agent/m)?.[1] ? Number(output.match(/^Stopped (\d+) Agent/m)[1]) : 0),
										failed: (/^Failed:/m.test(output) ? (output.match(/^- /gm)?.length ?? 0) : 0), truncated: false }
									: { truncated: false },
					time: { start, end },
				},
		};
		await emit({ kind: "before", input: { tool: part.tool, sessionID: source.sid, callID: part.callID }, output: { args: call.args }, observedAt: start });
		await emit({ kind: "event", input: { id: `evt_${rid()}`, type: "message.part.updated", properties: { sessionID: source.sid, part, time: end } }, output: null, observedAt: end });
		await writeFile(join(run, "hc-tool-parts", `${part.callID}.json`), JSON.stringify(part, null, 1));
		if (!facadeIds.has(part.messageID)) {
			facadeMessages.push({ id: part.messageID, info: { id: part.messageID, sessionID: source.sid, role: "assistant",
				providerID: call.providerID, modelID: call.modelID, agent: null, time: { created: end } }, parts: [part] });
		}
	}
}

let daemonText = "";
try {
	daemonText = await readFile(join(run, "daemon-calls.jsonl"), "utf8");
} catch {
	/* no daemon activity yet */
}
const dlines = daemonText.split("\n").filter(Boolean);
const fresh = dlines.slice(seen.daemonLines);
seen.daemonLines = dlines.length;
for (const line of fresh) {
	let e;
	try {
		e = JSON.parse(line);
	} catch {
		continue;
	}
	const sub = e.path === "/identity/acquire" ? "identity-acquire" : e.path === "/check-permission" ? "check-permission" : null;
	if (!sub || !e.body) continue;
	const id = ++seen.hooks;
	const prefix = join(run, "hooks", String(id));
	const payload = { session_id: e.body.session_id, agent_id: e.body.agent_id, tool_name: e.body.tool_name, cwd: work };
	if (sub === "check-permission") payload.tool_input = e.body.tool_input ?? e.body.input ?? {};
	const reply = e.replyBody ?? {};
	const blocked = reply.allowed === false;
	// Mirrors crates/hook check-permission deny composition.
	const reason = blocked ? `FSM 门禁：工具 ${e.body.tool_name} 不允许使用。原因：${typeof reply.reason === "string" ? reply.reason : ""}` : "";
	const decision = blocked ? { decision: "block", reason } : { decision: "allow" };
	await writeFile(`${prefix}.argv`, [sub, "--emit", "json", "--agent-cli", "opencode"].join("\n") + "\n");
	await writeFile(`${prefix}.input.json`, JSON.stringify(payload));
	await writeFile(`${prefix}.exit`, `${blocked ? 2 : 0}\n`);
	await writeFile(`${prefix}.stdout`, JSON.stringify(decision) + "\n");
	await writeFile(`${prefix}.stderr`, blocked ? `${reason}\n` : "");
}

await writeFile(statePath, JSON.stringify(seen));
await writeFile(facadePath, JSON.stringify(facade));
await release();
