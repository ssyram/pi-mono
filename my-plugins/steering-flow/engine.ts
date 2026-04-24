import { spawn } from "node:child_process";
import { resolve as pathResolve } from "node:path";
import type { Action, Condition, FSMRuntime, State, TransitionRecord, TransitionResult } from "./types.js";

const MAX_EPSILON_DEPTH = 64;
const CONDITION_TIMEOUT_MS = 30_000;
const CONDITION_STDOUT_CAP = 64 * 1024;
const CONDITION_STDERR_CAP = 16 * 1024;

export interface ConditionResult {
	ok: boolean;
	reason: string;
}

/**
 * Resolve a cmd-or-arg token. If it starts with `./` or `../`, it's treated
 * as relative to `flowDir` (the directory of the flow config file). Absolute
 * paths and bare names (PATH lookup) are passed through unchanged.
 */
function resolveTokenRelToFlow(token: string, flowDir: string): string {
	if (!flowDir) return token;
	if (token.startsWith("./") || token.startsWith("../")) {
		return pathResolve(flowDir, token);
	}
	return token;
}

/**
 * Interpolate `${placeholder}` tokens in a single string.
 *
 * Recognised placeholders:
 *   `${$TAPE_FILE}` — absolute path to the current tape.json
 *   `${arg-name}`   — value of a named action argument (A-Za-z0-9_- prefix, no leading $)
 *
 * Unknown placeholders are left as-is.
 */
function interpolatePlaceholders(
	token: string,
	tapePath: string,
	namedArgs: Record<string, string>,
): string {
	return token.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
		if (key === "$TAPE_FILE") return tapePath;
		if (Object.prototype.hasOwnProperty.call(namedArgs, key)) return namedArgs[key]!;
		return match;
	});
}

/**
 * Run a condition command.
 *
 * The condition is spawned WITHOUT a shell (no injection surface).
 * Before path resolution, `${$TAPE_FILE}` and `${arg-name}` placeholders
 * are interpolated in `cmd` and every element of `args`.
 *
 * Stdout contract: first line = "true" | "false"; remainder = reason.
 *
 * The child is started in its own process group (detached) so that SIGKILL
 * on timeout reaches the entire subtree (not just the entry-point process).
 */
export async function runCondition(
	condition: Condition,
	tapePath: string,
	llmArgs: string[],
	cwd: string,
	flowDir: string,
	namedArgs: Record<string, string> = {},
): Promise<ConditionResult> {
	if ("default" in condition && condition.default === true) {
		return { ok: true, reason: "default transition" };
	}
	// Type narrowing: must be { cmd, args? }
	const rawCmd = (condition as { cmd: string }).cmd;
	const rawConfigArgs = (condition as { args?: string[] }).args ?? [];
	const cmd = resolveTokenRelToFlow(interpolatePlaceholders(rawCmd, tapePath, namedArgs), flowDir);
	const configArgs = rawConfigArgs.map((a) =>
		resolveTokenRelToFlow(interpolatePlaceholders(a, tapePath, namedArgs), flowDir),
	);
	const argv: string[] = [...configArgs, ...llmArgs];

	return await new Promise((resolvePromise) => {
		let child;
		try {
			child = spawn(cmd, argv, {
				cwd,
				// Inherit env but do NOT inject SF_* values (tape is read via the file path).
				env: process.env,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			resolvePromise({ ok: false, reason: `failed to spawn '${cmd}': ${err instanceof Error ? err.message : String(err)}` });
			return;
		}

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let stdoutCapped = false;
		let stderrCapped = false;
		let settled = false;
		let closed = false;
		const killTree = () => {
			if (closed) return;  // Natural close already reaped; no need to signal.
			if (child.pid === undefined) return;
			try {
				// Negative PID → process group. Valid because we used detached:true on POSIX.
				process.kill(-child.pid, "SIGKILL");
			} catch {
				// Fallback: kill the direct child only
				try { child.kill("SIGKILL"); } catch { /* already dead */ }
			}
		};
		const settle = (r: ConditionResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			killTree();
			resolvePromise(r);
		};

		const timer = setTimeout(() => {
			settle({ ok: false, reason: `condition timed out after ${CONDITION_TIMEOUT_MS}ms (killed)` });
		}, CONDITION_TIMEOUT_MS);

		child.stdout?.on("data", (d: Buffer) => {
			if (stdoutCapped) return;
			const remaining = CONDITION_STDOUT_CAP - stdoutBytes;
			if (remaining <= 0) { stdoutCapped = true; return; }
			if (d.length <= remaining) {
				stdoutChunks.push(d);
				stdoutBytes += d.length;
			} else {
				stdoutChunks.push(d.subarray(0, remaining));
				stdoutBytes = CONDITION_STDOUT_CAP;
				stdoutCapped = true;
			}
		});
		child.stderr?.on("data", (d: Buffer) => {
			if (stderrCapped) return;
			const remaining = CONDITION_STDERR_CAP - stderrBytes;
			if (remaining <= 0) { stderrCapped = true; return; }
			if (d.length <= remaining) {
				stderrChunks.push(d);
				stderrBytes += d.length;
			} else {
				stderrChunks.push(d.subarray(0, remaining));
				stderrBytes = CONDITION_STDERR_CAP;
				stderrCapped = true;
			}
		});
		child.on("close", (code) => {
			closed = true;
			// Decode at the end; truncation may split a multi-byte codepoint but
			// Buffer.toString("utf-8") replaces invalid sequences with U+FFFD.
			const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
			const stderr = Buffer.concat(stderrChunks).toString("utf-8");
			const lines = stdout.split("\n");
			const first = (lines[0] ?? "").trim().toLowerCase();
			const rest = lines.slice(1).join("\n").trim();
			const cap = stdoutCapped ? " [stdout truncated]" : "";
			const exitStr = code === null ? "killed by signal" : `exit ${code}`;
			if (first === "true") {
				settle({ ok: true, reason: (rest || "condition true") + cap });
			} else if (first === "false") {
				settle({ ok: false, reason: (rest || stderr.trim() || "condition false (no reason provided)") + cap });
			} else {
				settle({
					ok: false,
					reason: `condition kind=malformed: expected first stdout line to be 'true' or 'false', got '${first}'. ${exitStr}. stderr: ${stderr.trim()}${cap}`,
				});
			}
		});
		child.on("error", (err) => {
			closed = true;
			settle({ ok: false, reason: `condition kind=spawn-error: ${err.message}` });
		});
	});
}

/**
 * Execute an action explicitly chosen by the LLM.
 * If the condition passes and we enter an epsilon state, chain through.
 * If we reach $END, reached_end is true.
 *
 * `tapePath` is the absolute path to the current FSM's tape.json.
 */
export async function executeAction(
	runtime: FSMRuntime,
	actionId: string,
	positionalArgs: string[],
	tapePath: string,
	cwd: string,
): Promise<TransitionResult> {
	const current = runtime.states[runtime.current_state_id];
	if (!current) {
		return {
			success: false,
			chain: [],
			final_state_id: runtime.current_state_id,
			reasons: [`current state '${runtime.current_state_id}' not found in FSM`],
			reached_end: false,
		};
	}

	if (current.is_epsilon) {
		return {
			success: false,
			chain: [],
			final_state_id: runtime.current_state_id,
			reasons: [`current state '${current.state_id}' is epsilon (auto-routing); cannot invoke action explicitly — call /get-steering-flow-info to inspect`],
			reached_end: false,
		};
	}

	const action = current.actions.find((a) => a.action_id === actionId);
	if (!action) {
		const available = current.actions.map((a) => a.action_id).join(", ");
		return {
			success: false,
			chain: [],
			final_state_id: runtime.current_state_id,
			reasons: [`unknown action '${actionId}' in state '${current.state_id}'. Available: ${available}`],
			reached_end: false,
		};
	}

	// Strict positional arg-count enforcement.
	if (positionalArgs.length !== action.arguments.length) {
		const sig = action.arguments.map((a) => `<${a.arg_name}>`).join(" ");
		return {
			success: false,
			chain: [],
			final_state_id: runtime.current_state_id,
			reasons: [`action '${actionId}' expects ${action.arguments.length} arg(s) (${sig || "none"}) but got ${positionalArgs.length}`],
			reached_end: false,
		};
	}

	const namedArgs: Record<string, string> = {};
	for (let i = 0; i < action.arguments.length; i++) {
		namedArgs[action.arguments[i]!.arg_name] = positionalArgs[i]!;
	}

	const condResult = await runCondition(action.condition, tapePath, positionalArgs, cwd, runtime.flow_dir, namedArgs);

	if (!condResult.ok) {
		return {
			success: false,
			chain: [],
			final_state_id: runtime.current_state_id,
			reasons: [`action '${actionId}' condition rejected: ${condResult.reason}`],
			reached_end: false,
		};
	}

	// Transition succeeded on the chosen action. Snapshot so we can rollback
	// if the subsequent epsilon chain fails (spec: "如果全部失败，保持当前状态不变").
	const snapshotStateId = runtime.current_state_id;
	const chain: TransitionRecord[] = [{
		from: current.state_id,
		to: action.next_state_id,
		action_id: action.action_id,
		reason: condResult.reason,
		timestamp: new Date().toISOString(),
	}];

	runtime.current_state_id = action.next_state_id;

	// Check $END
	if (runtime.current_state_id === "$END") {
		runtime.transition_log ??= [];
		runtime.transition_log.push(...chain);
		return {
			success: true,
			chain,
			final_state_id: "$END",
			reasons: chain.map((r) => `${r.from} → ${r.to} (${r.action_id}): ${r.reason}`),
			reached_end: true,
			end_desc: runtime.states["$END"]?.state_desc ?? "",
		};
	}

	// Chain through epsilon states
	const epsilonResult = await chainEpsilon(runtime, chain, tapePath, cwd);
	if (!epsilonResult.ok) {
		// Rollback: restore state but preserve tape (tape is cumulative, never rolled back)
		runtime.current_state_id = snapshotStateId;
		return {
			success: false,
			chain: [],
			final_state_id: runtime.current_state_id,
			reasons: [
				`action '${actionId}' condition passed, but subsequent epsilon routing failed; state rolled back to '${snapshotStateId}'.`,
				epsilonResult.error!,
			],
			reached_end: false,
		};
	}

	runtime.transition_log ??= [];
	runtime.transition_log.push(...chain);
	return {
		success: true,
		chain,
		final_state_id: runtime.current_state_id,
		reasons: chain.map((r) => `${r.from} → ${r.to} (${r.action_id}): ${r.reason}`),
		reached_end: runtime.current_state_id === "$END",
		end_desc: runtime.current_state_id === "$END" ? runtime.states["$END"]?.state_desc : undefined,
	};
}

/**
 * From current state: if epsilon, run condition actions in order.
 * First true wins; if none match and last is { default: true }, take it.
 * Mutates runtime.current_state_id and appends to chain.
 */
export async function chainEpsilon(
	runtime: FSMRuntime,
	chain: TransitionRecord[],
	tapePath: string,
	cwd: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	let depth = 0;
	while (depth < MAX_EPSILON_DEPTH) {
		const state = runtime.states[runtime.current_state_id];
		if (!state) {
			return { ok: false, error: `state '${runtime.current_state_id}' not found` };
		}
		if (!state.is_epsilon) return { ok: true };  // $END is non-epsilon, caught here

		// Try actions in order (no LLM args on epsilon actions)
		let matched: Action | undefined;
		let matchedReason = "";
		// NDA-07: collect per-condition rejection reasons
		const failReasons: string[] = [];
		for (const act of state.actions) {
			// NDA-04: pass explicit empty namedArgs (epsilon states have no declared args)
			const res = await runCondition(act.condition, tapePath, [], cwd, runtime.flow_dir, {});
			if (res.ok) {
				matched = act;
				matchedReason = res.reason;
				break;
			}
			failReasons.push(`action '${act.action_id}': ${res.reason}`);
		}

		if (!matched) {
			const detail = failReasons.length > 0 ? `; tried: ${failReasons.join(" | ")}` : "";
			return { ok: false, error: `epsilon state '${state.state_id}' had no matching condition (and no { default: true })${detail}` };
		}

		chain.push({
			from: state.state_id,
			to: matched.next_state_id,
			action_id: matched.action_id,
			reason: matchedReason,
			timestamp: new Date().toISOString(),
		});
		runtime.current_state_id = matched.next_state_id;
		depth++;

		if (runtime.current_state_id === "$END") return { ok: true };
	}
	return { ok: false, error: `epsilon chain exceeded max depth ${MAX_EPSILON_DEPTH}` };
}

/** Initial entry: after loading, run epsilon chain from $START. */
export async function enterStart(
	runtime: FSMRuntime,
	tapePath: string,
	cwd: string,
): Promise<TransitionResult> {
	const snapshot = runtime.current_state_id;
	const chain: TransitionRecord[] = [];
	const epsilonResult = await chainEpsilon(runtime, chain, tapePath, cwd);
	if (!epsilonResult.ok) {
		runtime.current_state_id = snapshot;
		return {
			success: false,
			chain: [],
			final_state_id: runtime.current_state_id,
			reasons: [epsilonResult.error!],
			reached_end: false,
		};
	}
	return {
		success: true,
		chain,
		final_state_id: runtime.current_state_id,
		reasons: chain.map((r) => `${r.from} → ${r.to} (${r.action_id}): ${r.reason}`),
		reached_end: runtime.current_state_id === "$END",
		end_desc: runtime.current_state_id === "$END" ? runtime.states["$END"]?.state_desc : undefined,
	};
}

/** Render current state + available actions for the LLM. */
export function renderStateView(runtime: FSMRuntime, header?: string): string {
	const state = runtime.states[runtime.current_state_id];
	const lines: string[] = [];
	if (header) lines.push(header);
	lines.push(`## Steering-Flow: ${runtime.flow_name}`);
	lines.push(`**Overall task**: ${runtime.task_description}`);
	lines.push(`**Current state**: \`${runtime.current_state_id}\``);
	if (state) {
		lines.push(`**State description**: ${state.state_desc}`);
		if (state.is_epsilon) {
			lines.push(`_(epsilon / auto-routing state)_`);
		}
	}

	if (runtime.current_state_id === "$END") {
		lines.push("");
		lines.push("🏁 Flow reached $END — it will be popped from the stack.");
		return lines.join("\n");
	}

	if (state && state.actions.length > 0) {
		lines.push("");
		lines.push("**Available actions** (call via `steering-flow-action` tool or `/steering-flow-action`):");
		for (const a of state.actions) {
			const args = a.arguments.length > 0
				? ` — args: ${a.arguments.map((ar) => `<${ar.arg_name}: ${ar.arg_desc}>`).join(", ")}`
				: "";
			lines.push(`- \`${a.action_id}\`: ${a.action_desc}${args}`);
		}
	}

	const tapeKeys = Object.keys(runtime.tape);
	if (tapeKeys.length > 0) {
		lines.push("");
		lines.push(`**Tape keys**: ${tapeKeys.join(", ")}`);
	}

	return lines.join("\n");
}

export function renderTransitionResult(runtime: FSMRuntime, result: TransitionResult): string {
	const lines: string[] = [];
	if (result.success) {
		if (result.chain.length > 0) {
			const path = result.chain.map((r) => r.to).join(" → ");
			lines.push(`✅ **Transitioned**: ${result.chain[0].from} → ${path}`);
			lines.push("");
			lines.push("**Transition reasons**:");
			for (const r of result.chain) {
				lines.push(`- ${r.from} → ${r.to} (via \`${r.action_id}\`): ${r.reason}`);
			}
		}
		if (result.reached_end) {
			lines.push("");
			lines.push(`🏁 **Flow complete**: ${result.end_desc ?? ""}`);
		} else {
			lines.push("");
			lines.push(renderStateView(runtime));
		}
	} else {
		lines.push(`❌ **Transition failed**. State unchanged: \`${runtime.current_state_id}\``);
		lines.push("");
		lines.push("**Reasons**:");
		for (const r of result.reasons) {
			lines.push(`- ${r}`);
		}
		lines.push("");
		lines.push(renderStateView(runtime));
		lines.push("");
		lines.push("_Hint: use `save-to-steering-flow` to write context into tape.json; condition commands can reference the tape path via `${$TAPE_FILE}` in their `cmd` or `args`._");
	}
	return lines.join("\n");
}
