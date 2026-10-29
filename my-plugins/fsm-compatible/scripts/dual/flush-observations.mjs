// Standalone observation flush for the Pi dual runner: converts Pi transcripts
// (root + every plugin-owned child tree) and the daemon-call log into the
// hc-fsm-reference observation files. Runs before each use-plot invocation.
import { createHash } from "node:crypto";
import { appendFile, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const cfg = JSON.parse(await readFile(process.argv[3], "utf8"));
const { run, work } = cfg;
const stageFile = process.env.FSM_FLUSH_STAGE;
let stageN = 0;
const stage = async (name) => {
	if (!stageFile) return;
	await appendFile(stageFile, `${process.argv[2]} #${stageN++} ${name}\n`).catch(() => {});
};
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
// Judge sessions persist under each root's work directory (in-memory no more):
// .fsm-compatible-judges/<sid>/session.jsonl carries their turns.
for (const session of sessions) {
	const judgeRoot = join(session.agentDir ?? join(run, "agent"), "..", "..", "work", ".fsm-compatible-judges");
	for (const sid of await readdir(judgeRoot).catch(() => [])) {
		sources.push({ sid, file: join(judgeRoot, sid, "session.jsonl") });
	}
}
{
	const workJudges = join(work, ".fsm-compatible-judges");
	for (const sid of await readdir(workJudges).catch(() => [])) {
		sources.push({ sid, file: join(workJudges, sid, "session.jsonl") });
	}
}

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
		await new Promise((r) => setTimeout(r, 15));
	}
	return previous;
};
const facadePath = join(run, "facade-messages.json");
// The engine reads this file on every settle; it must exist even before the
// first projected event.
await appendFile(join(run, "hc-tools.jsonl"), "");
// D9 declared boundary (owner ruling a): a send whose Accepted receipt is on
// disk must actually land in the recipient's transcript before the engine
// compares inboxes — wait lock-free (this shim holds no state lock).
const d9Tokens = (() => {
	try {
		return Object.values(JSON.parse(process.env.PLOT_D9_SKIP ?? "{}")).flat();
	} catch {
		return [];
	}
})();
if (d9Tokens.length) {
	const tokenOnDisk = (needle) => {
		for (const source of sources) {
			let text = "";
			try {
				text = readFileSync(source.file, "utf8");
			} catch {
				continue;
			}
			if (text.includes(needle)) return text.includes('"role":"user"') || true;
		}
		return false;
	};
	// Wait only until the send's toolCall/receipt lands on disk: holding this
	// shim (lock-free) gives the sender's engine call the processing window,
	// and the boundary wrapper can then backfill from the real send arguments.
	const sendOnDisk = (token) => {
		for (const source of sources) {
			let text = "";
			try {
				text = readFileSync(source.file, "utf8");
			} catch {
				continue;
			}
			if (!text.includes(token)) continue;
			for (const line of text.split("\n")) {
				if (!line.includes(token) || !line.includes("agent_send")) continue;
				try {
					const entry = JSON.parse(line);
					const message = entry.message ?? {};
					const blocks = Array.isArray(message.content) ? message.content : [];
					if (blocks.some((b) => b && (b.type === "toolCall" || b.type === "toolResult") && (b.name === "agent_send" || b.toolCallId))) return true;
				} catch { /* partial line */ }
			}
		}
		return false;
	};
	const missingSend = () => d9Tokens.some((token) => !sendOnDisk(token));
	// The D9 send-receipt wait belongs to the request path (one shim flush per
	// model call); the engine's 50ms poll must never hold the state lock for
	// seconds waiting on tokens, so polls take a single quick pass.
	const budget = process.argv[2] === "--poll" ? 1 : 80;
	for (let i = 0; i < budget && missingSend(); i++) {
		await new Promise((r) => setTimeout(r, 150));
	}
}

// ---- lock-free scan ----
const scanned = [];
for (const source of sources) {
	const text = await stableRead(source.file);
	if (!text) continue;
	const lines = text.split("\n").filter(Boolean);
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
			if (b.type === "toolCall") calls.set(b.id, { name: b.name, args: b.arguments, ts: Date.parse(e.timestamp ?? "") || (typeof e.message?.timestamp === "number" ? e.message.timestamp : undefined),
				providerID: e.message.provider, modelID: e.message.model });
		}
	}
	scanned.push({ source, lines, calls });
}
// ---- write phase: serialized between overlapping request shims ----
const { mkdir, rmdir } = await import("node:fs/promises");
const lockDir = join(run, "flush.lock");
// Poll mode runs inside the engine's 50ms dependency loop: never queue behind
// another flush, just skip this round — the next poll picks it up.
const pollMode = process.argv[2] === "--poll";
await stage("pre-lock");
for (let attempt = 0; ; attempt++) {
	try {
		await mkdir(lockDir);
		break;
	} catch {
		// A poll under contention waits briefly rather than skipping: skipping
		// let a co-polling engine hold the lock in near-continuous cycles and
		// starve this session's transcript projection indefinitely.
		if (attempt > (pollMode ? 40 : 400)) {
			if (pollMode) process.exit(0);
			throw new Error("flush lock contention");
		}
		await new Promise((r) => setTimeout(r, 15));
	}
}
const release = () => rmdir(lockDir).catch(() => {});
await stage("locked");
Object.assign(seen, JSON.parse(await readFile(statePath, "utf8").catch(() => "{}")));
seen.files ??= {}; seen.hooks ??= 0; seen.daemonLines ??= 0; seen.runningPartIds ??= {};
// Re-read the facade under the lock too: a stale copy would drop messages
// another shim appended between our scan and this write phase.
const facade = JSON.parse(await readFile(facadePath, "utf8").catch(() => "{}"));
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

await stage("scanned:" + scanned.length);
for (const { source, lines, calls } of scanned) {
	const seenCalls = (seen.files[source.file] ??= []);

	const facadeMessages = (facade[source.sid] ??= []);
	let facadeIds = new Set(facadeMessages.map((m) => m.id));
	// Plain user messages (inbox deliveries, completion notices) are part of
	// the observable surface: wait_messages and completion reports scan them
	// through the facade. Projected once, keyed by their stable transcript id.
	seen.userMsgIds ??= {};
	for (const line of lines) {
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.type !== "message" || e.message?.role !== "user") continue;
		const um = e.message;
		const text = typeof um.content === "string" ? um.content
			: Array.isArray(um.content) ? um.content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n") : "";
		if (!text.trim()) continue;
		const key = um.id ?? createHash("sha256").update(`${source.sid}:${um.timestamp}:${text}`).digest("hex").slice(0, 20);
		// Self-healing idempotence: a concurrent writer can persist the seen
		// key while this facade copy lost the entry — only trust the key when
		// the text is actually present here.
		if (seen.userMsgIds[key] && facadeMessages.some((m) => m.parts.some((part) => part.text === text))) continue;
		seen.userMsgIds[key] = true;
		const mid = `msg_${rid()}`;
		facadeIds.add(mid);
		facadeMessages.push({ id: mid, info: { id: mid, sessionID: source.sid, role: "user",
			providerID: null, modelID: null, agent: null, time: { created: um.timestamp ?? Date.now() } },
			parts: [{ type: "text", text }] });
	}
	// Steered deliveries land in a sidecar the moment they are accepted;
	// their transcript entries appear only when the next request is built.
	{
		let inboxText = "";
		try {
			inboxText = await readFile(join(dirname(source.file), "inbox.jsonl"), "utf8");
		} catch { /* none */ }
		for (const line of inboxText.split("\n")) {
			if (!line.trim()) continue;
			let entry;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			const text = typeof entry.text === "string" ? entry.text : "";
			if (!text.trim()) continue;
			const key = createHash("sha256").update(`${source.sid}:${entry.ts ?? 0}:${text}`).digest("hex").slice(0, 20);
			if (seen.userMsgIds[key] && facadeMessages.some((m) => m.parts.some((part) => part.text === text))) continue;
			seen.userMsgIds[key] = true;
			const mid = `msg_${rid()}`;
			facadeIds.add(mid);
			facadeMessages.push({ id: mid, info: { id: mid, sessionID: source.sid, role: "user",
				providerID: null, modelID: null, agent: null, time: { created: entry.ts ?? Date.now() } },
				parts: [{ type: "text", text }] });
		}
	}
	facadeIds = new Set(facadeMessages.map((m) => m.id));
	for (const line of lines) {
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.type !== "message" || e.message?.role !== "toolResult") continue;
		const m = e.message;
		// HC parts persist across the running→completed transition with one
		// stable identity; reuse the synthesized running part's ids.
		const stableIds = seen.runningPartIds[m.toolCallId];
		const call = calls.get(m.toolCallId);
		if (!call || seenCalls.includes(m.toolCallId) || emitted.has(m.toolCallId)) continue;
		seenCalls.push(m.toolCallId);
		const start = call.ts ?? Date.now();
		const end = Date.parse(e.timestamp ?? "") || (typeof e.message?.timestamp === "number" ? e.message.timestamp : undefined) || Date.now();
		const output = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
		// HC durable parts carry shell facts for Bash: the command as title and
		// {output, exit, truncated} in metadata; other tools use title "" and
		// {truncated: false}.
		const toolName = m.toolName ?? call.name;
		const isBash = toolName === "bash";
		// HC StructuredOutput durable part: fixed title, validity in metadata.
		const isStructured = toolName === "StructuredOutput";
		const command = typeof call.args?.command === "string" ? call.args.command : "";
		// HC agent parts carry the description as title and creation metadata;
		// the created sid is parsed from the Started receipt itself.
		const isAgent = toolName === "agent";
		const startedSid = isAgent ? (/session_id: (ses_[A-Za-z0-9]+)/.exec(output)?.[1] ?? null) : null;
		const isSend = toolName === "agent_send";
		const isStop = toolName === "agent_stop";
		const isList = toolName === "agent_list";
		const rawTarget = typeof call.args?.target === "string" ? call.args.target : "";
		// HC agent_list part metadata carries the roster count and title "agents".
		const listCount = isList ? Math.max(0, output.split("\n").length - 3) : 0;
		const part = {
			type: "tool",
			callID: m.toolCallId,
			tool: m.toolName ?? call.name,
			sessionID: source.sid,
			id: stableIds?.partId ?? `prt_${rid()}`,
			messageID: stableIds?.messageId ?? `msg_${rid()}`,
			state: m.isError
				? { status: "error", input: call.args, error: output, time: { start: Math.min(start, end), end: Math.max(start, end) } }
				: {
					status: "completed",
					input: call.args,
					output,
				// Title/metadata mirror the production tool result's own
				// details (the same facts HC's durable part inherits);
				// only Bash's shell facts are derived here.
				title: isStructured ? "Structured Output" : isBash ? command
					: (m.details && typeof m.details.title === "string" ? m.details.title : ""),
				metadata: isStructured
					? { valid: true }
					: toolName === "write"
						? { diagnostics: {}, filepath: call.args?.filePath, exists: false, truncated: false }
					: isBash && m.details && typeof m.details.metadata === "object" && m.details.metadata !== null && "exit" in m.details.metadata
						? { truncated: false, ...m.details.metadata }
						: isBash
							? { output, exit: 0, truncated: false }
						: (m.details && m.details.metadata && typeof m.details.metadata === "object"
							? { truncated: false, ...m.details.metadata }
							: { truncated: false }),
					time: { start, end },
				},
		};
		await emit({ kind: "before", input: { tool: part.tool, sessionID: source.sid, callID: part.callID }, output: { args: call.args }, observedAt: start });
		await emit({ kind: "event", input: { id: `evt_${rid()}`, type: "message.part.updated", properties: { sessionID: source.sid, part, time: end } }, output: null, observedAt: end });
		await writeFile(join(run, "hc-tool-parts", `${part.callID}.json`), JSON.stringify(part, null, 1));
		if (stableIds) {
			const stale = facadeMessages.findIndex((entry) => entry.id === stableIds.messageId);
			if (stale >= 0) facadeMessages.splice(stale, 1);
			facadeIds.delete(part.messageID);
		}
		if (!facadeIds.has(part.messageID)) {
			facadeMessages.push({ id: part.messageID, info: { id: part.messageID, sessionID: source.sid, role: "assistant",
				providerID: call.providerID, modelID: call.modelID, agent: null, time: { created: end } }, parts: [part] });
		}
	}
	// Unsettled calls are genuinely running: emit one stable running part so
	// the cancellation boundary can observe the in-flight tool; once settled,
	// drop it so exactly one durable part remains per call.
	seen.running ??= {};
	for (const [callId, call] of calls) {
		const settled = seenCalls.includes(callId) || emitted.has(callId);
		const mid = seen.running[callId];
		if (settled) {
			if (mid) {
				const idx = facadeMessages.findIndex((m) => m.id === mid);
				// The completed part may already occupy this message slot under
				// the reused stable id; only retire a still-running placeholder.
				if (idx >= 0 && facadeMessages[idx].parts.some((part) => part.state?.status === "running")) facadeMessages.splice(idx, 1);
				delete seen.running[callId];
				delete seen.runningPartIds[callId];
			}
			continue;
		}
		if (mid) continue;
		const start = call.ts ?? Date.now();
		const rpart = {
			type: "tool", callID: callId, tool: call.name, sessionID: source.sid,
			id: `prt_${rid()}`, messageID: `msg_${rid()}`,
			state: call.name === "bash"
				? { status: "running", input: call.args, metadata: { output: "" }, time: { start } }
				: { status: "running", input: call.args, time: { start } },
		};
		seen.running[callId] = rpart.messageID;
		(seen.runningPartIds ??= {})[callId] = { partId: rpart.id, messageId: rpart.messageID };
		await emit({ kind: "event", input: { id: `evt_${rid()}`, type: "message.part.updated", properties: { sessionID: source.sid, part: rpart, time: start } }, output: null, observedAt: start });
		if (!facadeIds.has(rpart.messageID)) {
			facadeMessages.push({ id: rpart.messageID, info: { id: rpart.messageID, sessionID: source.sid, role: "assistant",
				providerID: call.providerID, modelID: call.modelID, agent: null, time: { created: start } }, parts: [rpart] });
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

// Dual Stop decisions: synthesize the reference hook's five-file record so
// stop-phase observation can match verdicts verbatim.
{
	let stopText = "";
	try {
		stopText = await readFile(join(run, "stop-decisions.jsonl"), "utf8");
	} catch { /* none */ }
	const lines = stopText.split("\n").filter(Boolean);
	const freshStop = lines.slice(seen.stopDecisions ?? 0);
	seen.stopDecisions = lines.length;
	for (const line of freshStop) {
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		const id = ++seen.hooks;
		const prefix = join(run, "hooks", String(id));
		const blocked = e.decision === "block";
		// HC allow verdicts: wait_for_async_work carries no count; human
		// intervention's allow does. Blocks always carry the anti-spiral count.
		const withCount = e.decision === "block" || e.action === "human_intervention";
		const verdict = { decision: e.decision, reason: e.reason, ...(withCount && e.no_progress_count !== undefined ? { no_progress_count: e.no_progress_count } : {}) };
		const stdoutText = JSON.stringify(verdict, Object.keys(verdict).sort()) + "\n";
		await writeFile(`${prefix}.argv`, [e.agent ?? "stop", "--emit", "json", "--agent-cli", "opencode"].join("\n") + "\n");
		await writeFile(`${prefix}.input.json`, JSON.stringify({ session_id: e.session_id, agent_id: e.agent_id,
			last_assistant_message: e.last_assistant_message, cwd: work }));
		await writeFile(`${prefix}.exit`, (blocked ? 2 : 0) + "\n");
		await writeFile(`${prefix}.stdout`, stdoutText);
		// HC emit_verdict: the evaluator's reason always goes to the
		// diagnostics channel, allow included.
		await writeFile(`${prefix}.stderr`, String(e.reason) + "\n");
	}
}

await writeFile(statePath, JSON.stringify(seen));
// Atomic swap: concurrent engine polls read this file while another flush
// rewrites it; a torn read parses as {} and observers see empty sessions.
{
	const temporary = `${facadePath}.${process.pid}.tmp`;
	await writeFile(temporary, JSON.stringify(facade));
	await rename(temporary, facadePath);
}
await release();
