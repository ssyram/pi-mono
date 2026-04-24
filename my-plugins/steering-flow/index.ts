/**
 * steering-flow — dynamic FSM-based workflow enforcement.
 *
 * Loads a YAML/JSON/front-matter flow config, enforces state-machine transitions,
 * and prevents Claude from silently exiting mid-flow via a Stop hook.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { parseFlowConfig, buildFSM, ParseError, isReservedJsName } from "./parser.js";
import type { State, FSMRuntime, TransitionResult } from "./types.js";
import {
	ensureSessionDir,
	getSessionDir,
	readStack,
	topFsmId,
	pushFsm,
	popFsm,
	writeFsmStructure,
	writeState,
	readState,
	readTape,
	writeTape,
	loadRuntime,
	newFsmId,
	withSessionLock,
	tapePathFor,
	sweepTmpFiles,
	CorruptedStateError,
	writePendingPop,
	readPendingPop,
	deletePendingPop,
} from "./storage.js";
import { enterStart, executeAction, renderStateView, renderTransitionResult } from "./engine.js";
import { createVisualizerArtifact } from "./visualizer/index.js";
import { wasAborted } from "./stop-guards.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_FLOW_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TAPE_VALUE_BYTES = 64 * 1024;
const MAX_TAPE_KEYS = 1024;
const STOP_HOOK_STAGNATION_LIMIT = 3;
const COMPACTION_GUARD_MS = 30_000;

/**
 * Shell-style tokenizer for slash-command args: supports single/double quotes
 * and backslash escapes. Splits on whitespace outside quotes.
 * Returns the parsed tokens or throws on unterminated quote.
 */
function tokenizeArgs(input: string): string[] {
	const out: string[] = [];
	let i = 0;
	const n = input.length;
	while (i < n) {
		while (i < n && /\s/.test(input[i])) i++;
		if (i >= n) break;
		let cur = "";
		let quote: '"' | "'" | null = null;
		while (i < n) {
			const ch = input[i];
			if (quote) {
				if (ch === "\\" && quote === '"' && i + 1 < n) {
					cur += input[i + 1];
					i += 2;
					continue;
				}
				if (ch === quote) { quote = null; i++; continue; }
				cur += ch;
				i++;
				continue;
			}
			if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
			if (ch === "\\" && i + 1 < n) { cur += input[i + 1]; i += 2; continue; }
			if (/\s/.test(ch)) break;
			cur += ch;
			i++;
		}
		if (quote) throw new Error(`Unterminated ${quote === '"' ? "double" : "single"}-quoted string`);
		out.push(cur);
	}
	return out;
}

/** Stable canonical JSON with sorted keys — used for stagnation hashing. */
function stableStringify(v: unknown): string {
	if (v === undefined) return "null";
	if (v === null || typeof v !== "object") return JSON.stringify(v);
	if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
	const keys = Object.keys(v as Record<string, unknown>).sort();
	return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
}

// ─── Module state (guarded) ─────────────────────────────────────────────────

const lastCompactionAt = new Map<string, number>();  // sessionId → ms

function resolveFilePath(cwd: string, p: string): string {
	return isAbsolute(p) ? p : resolve(cwd, p);
}

async function persistRuntime(sessionDir: string, rt: FSMRuntime): Promise<void> {
	// Write state only — tape is managed separately by the tape-writing operations.
	await writeState(sessionDir, rt.fsm_id, rt.current_state_id, rt.transition_log);
}

// ─── Core ops (call under withSessionLock) ──────────────────────────────────

async function loadAndPush(
	cwd: string,
	sessionId: string,
	filePath: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const absPath = resolveFilePath(cwd, filePath);
	let stat;
	try {
		stat = await fs.stat(absPath);
	} catch (e) {
		return { ok: false, error: `Could not stat '${absPath}': ${e instanceof Error ? e.message : e}` };
	}
	if (!stat.isFile()) return { ok: false, error: `'${absPath}' is not a regular file` };
	if (stat.size > MAX_FLOW_FILE_BYTES) {
		return { ok: false, error: `Flow file exceeds ${MAX_FLOW_FILE_BYTES} bytes (got ${stat.size})` };
	}

	let content: string;
	try {
		content = await fs.readFile(absPath, "utf-8");
	} catch (e) {
		return { ok: false, error: `Could not read '${absPath}': ${e instanceof Error ? e.message : e}` };
	}

	let fsm: ReturnType<typeof buildFSM>;
	try {
		const cfg = parseFlowConfig(content, absPath);
		fsm = buildFSM(cfg);
	} catch (e) {
		const msg = e instanceof ParseError ? e.message : (e instanceof Error ? e.message : String(e));
		return { ok: false, error: `Failed to parse flow config: ${msg}` };
	}

	const sessionDir = await ensureSessionDir(cwd, sessionId);
	const fileBase = basename(absPath);
	const flowName = fileBase.replace(/\.(ya?ml|json|md)$/i, "") || "flow";
	const flowDir = dirname(absPath);
	const fsmId = newFsmId(flowName);

	const statesRec: Record<string, State> = {};
	for (const [k, v] of fsm.states.entries()) statesRec[k] = v;

	await writeFsmStructure(sessionDir, fsmId, flowName, flowDir, fsm.task_description, statesRec);
	await writeState(sessionDir, fsmId, "$START", []);
	await writeTape(sessionDir, fsmId, {});
	try {
		await pushFsm(sessionDir, fsmId);
	} catch (pushErr) {
		await fs.rm(`${sessionDir}/${fsmId}`, { recursive: true, force: true }).catch(() => {});
		throw pushErr;
	}

	const rt: FSMRuntime = {
		fsm_id: fsmId,
		flow_name: flowName,
		flow_dir: flowDir,
		task_description: fsm.task_description,
		states: statesRec,
		current_state_id: "$START",
		tape: {},
		transition_log: [],
	};

	const tapePath = tapePathFor(sessionDir, fsmId);
	let entry;
	try {
		entry = await enterStart(rt, tapePath, cwd);
		// Condition processes may have written to tape.json; re-sync the in-memory tape.
		rt.tape = await readTape(sessionDir, fsmId);
	} catch (e) {
		try {
			await popFsm(sessionDir);
		} catch (rollbackErr) {
			console.error('[steering-flow] popFsm rollback failed during $START catch:', rollbackErr);
			throw e;
		}
		return {
			ok: false,
			error: `Flow '${flowName}' failed during $START entry; stack rolled back. Cause: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
	rt.transition_log = entry.chain;

	if (!entry.success) {
		// Roll back: pop and remove the FSM dir so we don't leave a half-loaded flow.
		// D1-002: retry popFsm once on failure; warn loudly if stack is left inconsistent.
		let popSucceeded = false;
		try {
			await popFsm(sessionDir);
			popSucceeded = true;
		} catch (rollbackErr) {
			console.error('[steering-flow] popFsm rollback failed after epsilon chain failure (attempt 1):', rollbackErr);
			// R4-I-004: Before retrying, re-read the stack to check if attempt 1 partially
			// succeeded (wrote stack but failed on rename). If fsmId is no longer on top,
			// the pop already completed — skip retry to avoid double-pop.
			try {
				const stackAfterAttempt1 = await readStack(sessionDir);
				if (stackAfterAttempt1[stackAfterAttempt1.length - 1] !== fsmId) {
					// FSM was already popped by attempt 1 — no retry needed.
					popSucceeded = true;
				} else {
					await popFsm(sessionDir);
					popSucceeded = true;
				}
			} catch (retryErr) {
				console.error('[steering-flow] CRITICAL: popFsm rollback failed after epsilon chain failure (attempt 2) — FSM stack may be inconsistent:', retryErr);
			}
		}
		return {
			ok: false,
			error: `Flow '${flowName}' loaded but its initial epsilon chain from $START failed; stack rolled back. Reasons:\n${entry.reasons.map((r) => `  - ${r}`).join("\n")}${!popSucceeded ? "\n⚠️  WARNING: stack cleanup failed — FSM stack may be inconsistent." : ""}`,
		};
	}

	// RC-A: persist state BEFORE writing pending-pop marker so crash recovery never
	// sees a marker for an FSM whose state was never saved.
	await persistRuntime(sessionDir, rt);
	// R4-I-001: writePendingPop is best-effort; if it throws after persistRuntime succeeded,
	// the $END sweep in session_start provides secondary recovery. Log but don't rethrow.
	if (entry.reached_end) {
		try {
			await writePendingPop(sessionDir, fsmId);
		} catch (pendingPopErr) {
			console.error('[steering-flow] writePendingPop failed after loadAndPush (state was saved; $END sweep will recover):', pendingPopErr);
		}
	}

	if (entry.reached_end) {
		await popFsm(sessionDir);
		await deletePendingPop(sessionDir);
		const endDesc = statesRec["$END"]?.state_desc ?? "";
		let text = `🏁 Flow '${flowName}' loaded and immediately reached $END: ${endDesc}`;
		// If there is a parent flow, resurface it so the LLM knows context continues there.
		const remaining = await readStack(sessionDir);
		if (remaining.length > 0) {
			const parent = await loadRuntime(sessionDir, remaining[remaining.length - 1]);
			if (parent) text += "\n\n" + renderStateView(parent, "**Resumed parent flow:**");
		}
		return { ok: true, text };
	}

	const header = `📥 Loaded steering-flow \`${flowName}\` (fsm_id: \`${fsmId}\`). Stack depth: ${(await readStack(sessionDir)).length}.`;
	let text = renderStateView(rt, header);
	if (entry.chain.length > 0) {
		text += "\n\n**Initial epsilon chain**:\n" + entry.chain.map((r) => `- ${r.from} → ${r.to} (${r.action_id}): ${r.reason}`).join("\n");
	}
	return { ok: true, text };
}

async function actionCall(
	cwd: string,
	sessionId: string,
	actionId: string,
	args: string[],
): Promise<string> {
	const sessionDir = getSessionDir(cwd, sessionId);
	const fsmId = await topFsmId(sessionDir);
	if (!fsmId) {
		return "❌ No active steering-flow. Use `/load-steering-flow <FILE>` or the `load-steering-flow` tool to load one.";
	}
	const rt = await loadRuntime(sessionDir, fsmId);
	if (!rt) return `❌ Could not load runtime for FSM '${fsmId}'`;

	const tapePath = tapePathFor(sessionDir, fsmId);
	const result: TransitionResult = await executeAction(rt, actionId, args, tapePath, cwd);
	// Condition processes may have mutated tape.json; re-sync.
	rt.tape = await readTape(sessionDir, fsmId);
	rt.transition_log = result.chain;

	// Only persist when the transition actually succeeded (state advanced).
	// On failure, executeAction rolls back runtime.current_state_id; we skip
	// persistence entirely to avoid churn on state.json.
	if (result.success) {
		try {
			// RC-A: persist state BEFORE writing pending-pop marker.
			await persistRuntime(sessionDir, rt);
		} catch (persistErr) {
			console.error('[steering-flow] persistRuntime failed after successful action:', persistErr);
			return `✅ Action succeeded but state persistence failed: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}. The transition completed but current state may not be saved.`;
		}
		// R4-I-001: writePendingPop is best-effort; if it throws after persistRuntime succeeded,
		// the $END sweep in session_start provides secondary recovery. Log but don't rethrow.
		if (result.reached_end) {
			try {
				await writePendingPop(sessionDir, fsmId);
			} catch (pendingPopErr) {
				console.error('[steering-flow] writePendingPop failed after actionCall (state was saved; $END sweep will recover):', pendingPopErr);
			}
		}
	}

	let text = renderTransitionResult(rt, result);

	if (result.reached_end) {
		await popFsm(sessionDir);  // also rm's the FSM dir
		await deletePendingPop(sessionDir);
		const remaining = await readStack(sessionDir);
		text += `\n\n📤 Popped FSM \`${fsmId}\` from stack. Stack depth: ${remaining.length}.`;
		if (remaining.length > 0) {
			const parent = await loadRuntime(sessionDir, remaining[remaining.length - 1]);
			if (parent) {
				text += "\n\n**Resuming parent flow**:\n\n" + renderStateView(parent);
			}
		}
	}

	return text;
}

async function saveCall(
	cwd: string,
	sessionId: string,
	id: string,
	value: string,
): Promise<string> {
	if (Buffer.byteLength(value, "utf-8") > MAX_TAPE_VALUE_BYTES) {
		return `❌ Tape value for '${id}' exceeds ${MAX_TAPE_VALUE_BYTES} bytes.`;
	}
	const sessionDir = getSessionDir(cwd, sessionId);
	const fsmId = await topFsmId(sessionDir);
	if (!fsmId) return "❌ No active steering-flow.";
	const tape = await readTape(sessionDir, fsmId);
	if (!(id in tape) && Object.keys(tape).length >= MAX_TAPE_KEYS) {
		return `❌ Tape is full (${MAX_TAPE_KEYS} keys max). Update an existing key or remove one first.`;
	}
	tape[id] = value;
	await writeTape(sessionDir, fsmId, tape);
	return `✅ Saved tape[\`${id}\`] = ${JSON.stringify(value.length > 200 ? value.slice(0, 200) + "…" : value)} (accessible in condition scripts via \${$TAPE_FILE} in their args). Total tape keys: ${Object.keys(tape).length}.`;
}

async function infoCall(cwd: string, sessionId: string): Promise<string> {
	const sessionDir = getSessionDir(cwd, sessionId);
	const stack = await readStack(sessionDir);
	if (stack.length === 0) return "(No active steering-flow. Stack is empty.)";

	const lines: string[] = [];
	lines.push(`## Steering-Flow Stack (depth ${stack.length})`);
	for (let i = 0; i < stack.length; i++) {
		const fsmId = stack[i];
		let rt: FSMRuntime | undefined;
		try {
			rt = await loadRuntime(sessionDir, fsmId);
		} catch (e) {
			lines.push(`\n### ${i + 1}. \`${fsmId}\` — ⚠️ CORRUPTED`);
			lines.push(`- ${friendlyError(e)}`);
			continue;
		}
		if (!rt) {
			lines.push(`\n### ${i + 1}. \`${fsmId}\` — (FSM structure missing on disk)`);
			continue;
		}
		const marker = i === stack.length - 1 ? " ← TOP" : "";
		lines.push(`\n### ${i + 1}. \`${rt.flow_name}\` (fsm_id: \`${fsmId}\`)${marker}`);
		lines.push(`- Task: ${rt.task_description}`);
		lines.push(`- Current state: \`${rt.current_state_id}\``);
		const st = rt.states[rt.current_state_id];
		if (st) lines.push(`- State desc: ${st.state_desc}`);
		const tk = Object.keys(rt.tape);
		if (tk.length > 0) {
			lines.push(`- Tape (${tk.length}):`);
			for (const k of tk) {
				const v = rt.tape[k];
				const s = typeof v === "string" ? v : JSON.stringify(v);
				const shown = s.length > 200 ? s.slice(0, 200) + "…" : s;
				lines.push(`  - \`${k}\` = ${typeof v === "string" ? JSON.stringify(shown) : shown}`);
			}
		}
	}
	// For the top FSM also render available actions (best effort)
	try {
		const top = await loadRuntime(sessionDir, stack[stack.length - 1]);
		if (top) {
			lines.push("");
			lines.push(renderStateView(top, "### Active (top) flow view"));
		}
	} catch {
		// already surfaced above
	}
	return lines.join("\n");
}

async function popCall(cwd: string, sessionId: string): Promise<string> {
	const sessionDir = getSessionDir(cwd, sessionId);
	const popped = await popFsm(sessionDir);
	if (!popped) return "(Nothing to pop — stack is empty.)";
	const remaining = await readStack(sessionDir);
	let text = `📤 Popped FSM \`${popped}\`. Stack depth: ${remaining.length}.`;
	if (remaining.length > 0) {
		const parent = await loadRuntime(sessionDir, remaining[remaining.length - 1]);
		if (parent) text += "\n\n" + renderStateView(parent, "**Resumed parent flow:**");
	}
	return text;
}

function friendlyError(e: unknown): string {
	if (e instanceof CorruptedStateError) {
		return `steering-flow corrupted state: ${e.message}. You may need to manually clear \`.pi/steering-flow/<session>/\` to recover.`;
	}
	return e instanceof Error ? e.message : String(e);
}

// ═══════════════════════════════════════════════════════════════════════════
// Plugin entry point
// ═══════════════════════════════════════════════════════════════════════════

export default async function steeringFlow(pi: ExtensionAPI) {
	// ── Tools ─────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "load-steering-flow",
		label: "Load Steering-Flow",
		description:
			"Load a YAML/JSON/front-matter flow config file (state machine). Pushes a new FSM onto the steering-flow stack for the current session. Returns the $START state description and available actions.",
		parameters: Type.Object({
			file: Type.String({ description: "Path to the flow config file (.yaml/.yml/.json/.md). Relative paths resolve against cwd." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const res = await withSessionLock(sessionId, () => loadAndPush(cwd, sessionId, params.file));
				const text = res.ok ? res.text : res.error;
				return { content: [{ type: "text", text }], isError: !res.ok, details: undefined };
			} catch (e) {
				return { content: [{ type: "text", text: `❌ ${friendlyError(e)}` }], isError: true, details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "steering-flow-action",
		label: "Steering-Flow Action",
		description:
			"Invoke an action in the current (top) steering-flow FSM to trigger a state transition. On success, returns the new state + available actions. On failure (condition rejected), returns the failure reason and keeps the state unchanged.",
		parameters: Type.Object({
			action_id: Type.String({ description: "The action_id to invoke (must be listed in the current state's available actions)." }),
			args: Type.Optional(Type.Array(Type.String(), {
				description: "Positional arguments matching the action's declared arguments (in order).",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const text = await withSessionLock(sessionId, () => actionCall(cwd, sessionId, params.action_id, params.args ?? []));
				return { content: [{ type: "text", text }], details: undefined };
			} catch (e) {
				return { content: [{ type: "text", text: `❌ ${friendlyError(e)}` }], isError: true, details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "save-to-steering-flow",
		label: "Save to Steering-Flow Tape",
		description:
			"Write a key-value pair to the current (top) FSM's Turing tape (tape.json). Transition conditions read/write this file — condition scripts access it via ${$TAPE_FILE} in their args. Overwrites any existing value for the same id.",
		parameters: Type.Object({
			id: Type.String({ description: "Tape key (must match /^[A-Za-z_][A-Za-z0-9_]*$/)." }),
			value: Type.String({ description: "The value to store (max 64 KiB)." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.id)) {
				return { content: [{ type: "text", text: `❌ Invalid tape id '${params.id}': must be a valid env-var-safe identifier.` }], isError: true, details: undefined };
			}
			if (isReservedJsName(params.id)) {
				return { content: [{ type: "text", text: `❌ Tape id '${params.id}' is a reserved JS property name.` }], isError: true, details: undefined };
			}
			try {
				const text = await withSessionLock(sessionId, () => saveCall(cwd, sessionId, params.id, params.value));
				return { content: [{ type: "text", text }], details: undefined };
			} catch (e) {
				return { content: [{ type: "text", text: `❌ ${friendlyError(e)}` }], isError: true, details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "visualize-steering-flow",
		label: "Visualize Steering-Flow",
		description:
			"Generate a static HTML visualizer for the active steering-flow stack, or for a specific flow file if provided.",
		parameters: Type.Object({
			flow_file: Type.Optional(Type.String({ description: "Optional flow file to visualize instead of the active session stack." })),
			output_file: Type.Optional(Type.String({ description: "Optional output HTML path. Defaults to .pi/steering-flow-visualizer.html under cwd." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const result = await withSessionLock(sessionId, () =>
					createVisualizerArtifact({
						cwd,
						sessionId,
						flowFile: params.flow_file,
						outputFile: params.output_file,
					}),
				);
				return {
					content: [{
						type: "text",
						text: `✅ Wrote steering-flow visualizer (${result.mode}, ${result.fsmCount} FSMs) to ${result.outputPath}\nSource: ${result.sourceLabel}`,
					}],
					details: undefined,
				};
			} catch (e) {
				return { content: [{ type: "text", text: `❌ ${friendlyError(e)}` }], isError: true, details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "get-steering-flow-info",
		label: "Get Steering-Flow Info",
		description:
			"Inspect the full steering-flow stack: each FSM's name, task, current state, tape contents, and the active flow's available actions.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const text = await withSessionLock(sessionId, () => infoCall(cwd, sessionId));
				return { content: [{ type: "text", text }], details: undefined };
			} catch (e) {
				return { content: [{ type: "text", text: `❌ ${friendlyError(e)}` }], isError: true, details: undefined };
			}
		},
	});

	// NOTE: pop-steering-flow is intentionally NOT registered as a tool (user-only per spec).

	// ── Commands ──────────────────────────────────────────────────────────

	pi.registerCommand("load-steering-flow", {
		description: "Load a steering-flow config file and push it onto the FSM stack",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const filePath = args.trim();
			if (!filePath) { ctx.ui.notify("Usage: /load-steering-flow <FILE>", "error"); return; }
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const res = await withSessionLock(sessionId, () => loadAndPush(cwd, sessionId, filePath));
				if (!res.ok) { ctx.ui.notify(res.error, "error"); return; }
				pi.sendUserMessage(res.text);
			} catch (e) {
				ctx.ui.notify(friendlyError(e), "error");
			}
		},
	});

	pi.registerCommand("pop-steering-flow", {
		description: "Pop the top steering-flow FSM from the stack (user-only)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const text = await withSessionLock(sessionId, () => popCall(cwd, sessionId));
				ctx.ui.notify(text.split("\n")[0], "info");
				pi.sendUserMessage(text);
			} catch (e) {
				ctx.ui.notify(friendlyError(e), "error");
			}
		},
	});

	pi.registerCommand("save-to-steering-flow", {
		description: "Save <ID> <VALUE> to the top FSM's Turing tape (value = remainder of args)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			const firstSpace = trimmed.indexOf(" ");
			if (firstSpace === -1) { ctx.ui.notify("Usage: /save-to-steering-flow <ID> <VALUE>", "error"); return; }
			const id = trimmed.slice(0, firstSpace);
			const value = trimmed.slice(firstSpace + 1);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
				ctx.ui.notify(`Invalid tape id '${id}'.`, "error"); return;
			}
			if (isReservedJsName(id)) {
				ctx.ui.notify(`Tape id '${id}' is a reserved JS property name.`, "error"); return;
			}
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const text = await withSessionLock(sessionId, () => saveCall(cwd, sessionId, id, value));
				ctx.ui.notify(text.split("\n")[0], "info");
			} catch (e) {
				ctx.ui.notify(friendlyError(e), "error");
			}
		},
	});

	pi.registerCommand("visualize-steering-flow", {
		description: "Generate a static HTML visualizer for the active stack or for a specific flow file",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let parts: string[];
			try {
				parts = tokenizeArgs(args);
			} catch (e) {
				ctx.ui.notify(`${friendlyError(e)}. Usage: /visualize-steering-flow [FLOW_FILE] [-o OUTPUT.html]`, "error");
				return;
			}
			let flowFile: string | undefined;
			let outputFile: string | undefined;
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				if (part === "-o" || part === "--output") {
					outputFile = parts[i + 1];
					if (!outputFile) {
						ctx.ui.notify("Usage: /visualize-steering-flow [FLOW_FILE] [-o OUTPUT.html]", "error");
						return;
					}
					i++;
					continue;
				}
				if (flowFile !== undefined) {
					ctx.ui.notify("Usage: /visualize-steering-flow [FLOW_FILE] [-o OUTPUT.html]", "error");
					return;
				}
				flowFile = part;
			}
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const result = await withSessionLock(sessionId, () =>
					createVisualizerArtifact({ cwd, sessionId, flowFile, outputFile }),
				);
				pi.sendUserMessage(
					`## Steering-Flow Visualizer\n- Mode: ${result.mode}\n- FSM count: ${result.fsmCount}\n- Source: ${result.sourceLabel}\n- Output: ${result.outputPath}`,
				);
				for (const warning of result.warnings) {
					ctx.ui.notify(warning, "warning");
				}
			} catch (e) {
				ctx.ui.notify(friendlyError(e), "error");
			}
		},
	});

	pi.registerCommand("get-steering-flow-info", {
		description: "Print the current steering-flow stack, states, and tape contents",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const text = await withSessionLock(sessionId, () => infoCall(cwd, sessionId));
				pi.sendUserMessage(text);
			} catch (e) {
				ctx.ui.notify(friendlyError(e), "error");
			}
		},
	});

	pi.registerCommand("steering-flow-action", {
		description: "Invoke an action: /steering-flow-action <ACTION-ID> [ARG1] [ARG2] ... (use quotes for args with spaces)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let parts: string[];
			try {
				parts = tokenizeArgs(args);
			} catch (e) {
				ctx.ui.notify(`${friendlyError(e)}. Usage: /steering-flow-action <ACTION-ID> [ARGS...]`, "error");
				return;
			}
			if (parts.length === 0) { ctx.ui.notify("Usage: /steering-flow-action <ACTION-ID> [ARGS...]", "error"); return; }
			const [actionId, ...rest] = parts;
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();
			try {
				const text = await withSessionLock(sessionId, () => actionCall(cwd, sessionId, actionId, rest));
				pi.sendUserMessage(text);
			} catch (e) {
				ctx.ui.notify(friendlyError(e), "error");
			}
		},
	});

	// ── Compaction guard ──────────────────────────────────────────────────

	pi.on("session_compact", async (_event, ctx) => {
		lastCompactionAt.set(ctx.sessionManager.getSessionId(), Date.now());
	});

	// ── Stop hook: re-prompt the LLM if it stops mid-flow ────────────────

	pi.on("agent_end", async (event, ctx) => {
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			const cwd = ctx.sessionManager.getCwd();

			// Guard: user abort
			if (ctx.signal?.aborted) return;
			if (wasAborted(event.messages)) return;



			// Guard: compaction cooldown
			const lastCompact = lastCompactionAt.get(sessionId) ?? 0;
			if (Date.now() - lastCompact < COMPACTION_GUARD_MS) return;

			await withSessionLock(sessionId, async () => {
				if (ctx.signal?.aborted) return;
				const sessionDir = getSessionDir(cwd, sessionId);
				let stack: string[];
				try {
					stack = await readStack(sessionDir);
				} catch (e) {
					// Surface corruption rather than silently skipping the reminder.
					if (ctx.hasUI) {
						ctx.ui.notify(`steering-flow: ${friendlyError(e)}`, "error");
					}
					return;
				}
				if (stack.length === 0) return;

				const topId = stack[stack.length - 1];
				let rt: FSMRuntime | undefined;
				try {
					rt = await loadRuntime(sessionDir, topId);
				} catch (e) {
					if (ctx.hasUI) ctx.ui.notify(`steering-flow: ${friendlyError(e)}`, "error");
					return;
				}
				if (!rt) return;
				if (rt.current_state_id === "$END") return;

				// Stagnation: stable hash over (state, sorted tape). Resets when state changes.
				const hash = createHash("sha1")
					.update(rt.current_state_id + "\0" + stableStringify(rt.tape))
					.digest("hex");
				const stateFile = await readState(sessionDir, topId);
				const prevHash = stateFile?.last_reminder_hash;
				const prevCount = stateFile?.reminder_count ?? 0;
				const nextCount = prevHash === hash ? prevCount + 1 : 1;

				if (nextCount > STOP_HOOK_STAGNATION_LIMIT) {
					// Stop re-prompting; notify the user instead.
					if (ctx.hasUI) {
						ctx.ui.notify(
							`steering-flow: stagnation detected in '${rt.flow_name}' at state '${rt.current_state_id}' (${nextCount - 1} identical reminders). Re-prompt paused — use /pop-steering-flow to abandon or /get-steering-flow-info to inspect.`,
							"warning",
						);
					}
					// Reset count so the next real transition re-enables the hook.
					await writeState(sessionDir, topId, rt.current_state_id, rt.transition_log, {
						reminder_count: nextCount,
						last_reminder_hash: hash,
						preserve_entered_at: true,
					});
					return;
				}

				await writeState(sessionDir, topId, rt.current_state_id, rt.transition_log, {
					reminder_count: nextCount,
					last_reminder_hash: hash,
					preserve_entered_at: true,
				});

				const reminder = renderStateView(
					rt,
					`🧭 **steering-flow active** (reminder ${nextCount}/${STOP_HOOK_STAGNATION_LIMIT}) — you must drive the flow to completion. ` +
						"Call the `steering-flow-action` tool to transition, or `save-to-steering-flow` to provide tape data a condition needs. " +
						"You cannot exit silently until `$END` is reached.",
				);

				pi.sendUserMessage(reminder);
			});
		} catch (e) {
			// Hooks must never throw — but log so failures are diagnosable
			if (ctx.hasUI) ctx.ui.notify(`steering-flow: stop-hook error: ${e instanceof Error ? e.message : String(e)}`, "warning");
		}
	});

	// ── Lifecycle cleanup ─────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// New session/resume/fork: clear in-memory compaction timestamps for this sessionId.
		const sid = ctx.sessionManager.getSessionId();
		lastCompactionAt.delete(sid);
		// D4-001: wrap all file I/O in the session lock so concurrent tool calls
		// cannot interleave with crash-recovery reads/writes.
		try {
			await withSessionLock(sid, async () => {
			// R4-I-003: wrap entire recovery body in try/catch so a crash here never
			// silently kills the session_start hook.
			const dir = getSessionDir(ctx.sessionManager.getCwd(), sid);
			try {
				// Best-effort orphan-tmp sweep (from atomicWriteJson crashes in previous runs).
				await sweepTmpFiles(dir);

				// CS-2 Part B: Check for pending pop marker (crash during $END transition)
				const pendingPop = await readPendingPop(dir);
				if (pendingPop) {
					const stackForPop = await readStack(dir);
					if (!stackForPop.length || stackForPop[stackForPop.length - 1] !== pendingPop.fsmId) {
						console.warn(`[steering-flow] Stale pending-pop marker (fsmId=${pendingPop.fsmId} not at stack top) — deleting without pop`);
						await deletePendingPop(dir);
					} else {
						await popFsm(dir);
						await deletePendingPop(dir);
						// R4-I-002: guard ctx.ui access with hasUI check.
						if (ctx.hasUI) ctx.ui.notify(`[steering-flow] Auto-popped FSM ${pendingPop.fsmId} (crash recovered from pending pop marker)`, "warning");
					}
				}

				// CS-2 Part A: Sweep stack top for stuck $END state (e.g. crash before marker was written)
				const stack = await readStack(dir);
				if (stack.length > 0) {
					const topId = stack[stack.length - 1];
					const state = await readState(dir, topId);
					if (state && state.current_state_id === "$END") {
						await popFsm(dir);
						// R4-I-002: guard ctx.ui access with hasUI check.
						if (ctx.hasUI) ctx.ui.notify(`[steering-flow] Auto-popped stuck $END FSM ${topId} from stack`, "warning");
					}
				}
			} catch (e) {
				console.error('[steering-flow] session_start recovery error:', e);
				await deletePendingPop(dir).catch(() => {});
			}
		});
		} catch (e) {
			console.error('[steering-flow] session_start withSessionLock error:', e);
		}
	});
}
