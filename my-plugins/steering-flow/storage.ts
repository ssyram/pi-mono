import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { FSMRuntime, State, TransitionRecord } from "./types.js";

/**
 * File layout:
 *   .pi/steering-flow/<SESSION-ID>/
 *     stack.json             — ordered list of FSM-IDs (last = top)
 *     <FSM-ID>/
 *       fsm.json             — full parsed FSM structure
 *       state.json           — current state + reminder counter
 *       tape.json            — turing tape (k/v pairs)
 *
 * All writes go through atomicWriteJson (tmp+rename) to avoid truncation on crash.
 * All reads distinguish ENOENT (no file) from JSON.parse errors (corruption).
 */

export class CorruptedStateError extends Error {
	constructor(public path: string, public cause: unknown) {
		super(`Corrupted steering-flow state file: ${path} (${cause instanceof Error ? cause.message : cause})`);
		this.name = "CorruptedStateError";
	}
}

export function getSessionDir(cwd: string, sessionId: string): string {
	const safeId = sessionId && sessionId.length > 0 ? sessionId : "_no_session_";
	return resolve(cwd, ".pi", "steering-flow", safeId);
}

export async function ensureSessionDir(cwd: string, sessionId: string): Promise<string> {
	const dir = getSessionDir(cwd, sessionId);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
	const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
	const text = JSON.stringify(data, null, 2);
	await fs.writeFile(tmp, text, "utf-8");
	// rename is atomic on POSIX (within same filesystem)
	await fs.rename(tmp, path);
}

async function readJsonStrict<T>(path: string): Promise<T | undefined> {
	let text: string;
	try {
		text = await fs.readFile(path, "utf-8");
	} catch (e) {
		const err = e as NodeJS.ErrnoException;
		if (err.code === "ENOENT") return undefined;
		throw e;
	}
	try {
		return JSON.parse(text) as T;
	} catch (e) {
		throw new CorruptedStateError(path, e);
	}
}

// ─── Per-session async mutex ────────────────────────────────────────────────
// Framework runs tool calls in parallel (see agent-loop.ts). This serializes
// all read-modify-write operations per session.
const sessionLocks = new Map<string, Promise<unknown>>();

export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
	const key = sessionId || "_no_session_";
	const prev = sessionLocks.get(key) ?? Promise.resolve();
	// Swallow prior rejection so the next waiter always runs.
	const prevSettled: Promise<unknown> = prev.then(() => undefined, () => undefined);
	const next: Promise<T> = prevSettled.then(fn);
	// Store the already-settled-swallowing version as the tail so the identity
	// check in `finally` can actually match.
	const tail: Promise<unknown> = next.then(() => undefined, () => undefined);
	sessionLocks.set(key, tail);
	try {
		return await next;
	} finally {
		if (sessionLocks.get(key) === tail) {
			sessionLocks.delete(key);
		}
	}
}

// ─── Stack ──────────────────────────────────────────────────────────────────

export async function readStack(sessionDir: string): Promise<string[]> {
	const p = join(sessionDir, "stack.json");
	const arr = await readJsonStrict<unknown>(p);
	if (arr === undefined) return [];
	if (!Array.isArray(arr)) throw new CorruptedStateError(p, "stack.json is not an array");
	return arr.filter((x) => typeof x === "string") as string[];
}

export async function writeStack(sessionDir: string, stack: string[]): Promise<void> {
	await fs.mkdir(sessionDir, { recursive: true });
	await atomicWriteJson(join(sessionDir, "stack.json"), stack);
}

export async function topFsmId(sessionDir: string): Promise<string | undefined> {
	const stack = await readStack(sessionDir);
	return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

export async function pushFsm(sessionDir: string, fsmId: string): Promise<void> {
	const stack = await readStack(sessionDir);
	stack.push(fsmId);
	await writeStack(sessionDir, stack);
}

export async function popFsm(sessionDir: string): Promise<string | undefined> {
	const stack = await readStack(sessionDir);
	const top = stack.pop();
	await writeStack(sessionDir, stack);
	if (top) {
		// Best-effort cleanup of the popped FSM's directory
		try {
			await fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true });
		} catch {
			// Leave orphan on rm error; not fatal
		}
	}
	return top;
}

export function fsmDir(sessionDir: string, fsmId: string): string {
	return join(sessionDir, fsmId);
}

/** Absolute path to the tape.json file for a given FSM. */
export function tapePathFor(sessionDir: string, fsmId: string): string {
	return join(fsmDir(sessionDir, fsmId), "tape.json");
}

/**
 * Best-effort sweep of orphan `.tmp.<pid>.<rand>` files left by a crashed
 * atomicWriteJson. Safe to call at session_start.
 *
 * Skips tmp files tagged with the current process's PID, so this is safe to
 * call even while the same process may be performing concurrent writes.
 */
export async function sweepTmpFiles(sessionDir: string): Promise<void> {
	const ownTag = `.tmp.${process.pid}.`;
	const isOrphanTmp = (name: string) => name.includes(".tmp.") && !name.includes(ownTag);
	try {
		const entries = await fs.readdir(sessionDir, { withFileTypes: true });
		for (const e of entries) {
			if (e.isFile() && isOrphanTmp(e.name)) {
				await fs.rm(join(sessionDir, e.name), { force: true });
			} else if (e.isDirectory()) {
				try {
					const sub = await fs.readdir(join(sessionDir, e.name));
					for (const name of sub) {
						if (isOrphanTmp(name)) {
							await fs.rm(join(sessionDir, e.name, name), { force: true });
						}
					}
				} catch { /* ignore */ }
			}
		}
	} catch { /* sessionDir may not exist yet; ignore */ }
}

// ─── FSM files ──────────────────────────────────────────────────────────────

interface FsmStructure {
	fsm_id: string;
	flow_name: string;
	flow_dir: string;
	task_description: string;
	states: Record<string, State>;
}

interface StateFile {
	current_state_id: string;
	entered_at: string;
	last_transition_chain: TransitionRecord[];
	reminder_count?: number;
	last_reminder_hash?: string;
}

export async function writeFsmStructure(
	sessionDir: string,
	fsmId: string,
	flowName: string,
	flowDir: string,
	taskDescription: string,
	states: Record<string, State>,
): Promise<void> {
	const dir = fsmDir(sessionDir, fsmId);
	await fs.mkdir(dir, { recursive: true });
	await atomicWriteJson(join(dir, "fsm.json"), {
		fsm_id: fsmId,
		flow_name: flowName,
		flow_dir: flowDir,
		task_description: taskDescription,
		states,
	});
}

export async function readFsmStructure(sessionDir: string, fsmId: string): Promise<FsmStructure | undefined> {
	const data = await readJsonStrict<FsmStructure>(join(fsmDir(sessionDir, fsmId), "fsm.json"));
	if (!data) return undefined;
	if (typeof data !== "object" || !data.states || typeof data.states !== "object") {
		throw new CorruptedStateError(join(fsmDir(sessionDir, fsmId), "fsm.json"), "invalid shape");
	}
	return data;
}

export async function writeState(
	sessionDir: string,
	fsmId: string,
	currentStateId: string,
	lastTransitionChain: TransitionRecord[],
	reminderMeta?: { reminder_count?: number; last_reminder_hash?: string; preserve_entered_at?: boolean },
): Promise<void> {
	const dir = fsmDir(sessionDir, fsmId);
	await fs.mkdir(dir, { recursive: true });
	let enteredAt = new Date().toISOString();
	if (reminderMeta?.preserve_entered_at) {
		const existing = await readState(sessionDir, fsmId);
		if (existing?.entered_at) enteredAt = existing.entered_at;
	}
	const payload: StateFile = {
		current_state_id: currentStateId,
		entered_at: enteredAt,
		last_transition_chain: lastTransitionChain,
		...(reminderMeta && { reminder_count: reminderMeta.reminder_count, last_reminder_hash: reminderMeta.last_reminder_hash }),
	};
	await atomicWriteJson(join(dir, "state.json"), payload);
}

export async function readState(sessionDir: string, fsmId: string): Promise<StateFile | undefined> {
	return await readJsonStrict<StateFile>(join(fsmDir(sessionDir, fsmId), "state.json"));
}

export async function readTape(sessionDir: string, fsmId: string): Promise<Record<string, import("./types.js").TapeValue>> {
	const data = await readJsonStrict<unknown>(join(fsmDir(sessionDir, fsmId), "tape.json"));
	if (data === undefined) return {};
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new CorruptedStateError(join(fsmDir(sessionDir, fsmId), "tape.json"), "tape.json must be a JSON object at the top level");
	}
	// Accept arbitrary JSON values; the plugin doesn't interpret them, only flows do.
	return data as Record<string, import("./types.js").TapeValue>;
}

export async function writeTape(sessionDir: string, fsmId: string, tape: Record<string, import("./types.js").TapeValue>): Promise<void> {
	const dir = fsmDir(sessionDir, fsmId);
	await fs.mkdir(dir, { recursive: true });
	await atomicWriteJson(join(dir, "tape.json"), tape);
}

export async function loadRuntime(sessionDir: string, fsmId: string): Promise<FSMRuntime | undefined> {
	const struct = await readFsmStructure(sessionDir, fsmId);
	if (!struct) return undefined;
	const state = await readState(sessionDir, fsmId);
	const tape = await readTape(sessionDir, fsmId);
	return {
		fsm_id: fsmId,
		flow_name: struct.flow_name,
		flow_dir: struct.flow_dir ?? "",  // backward-compat: older on-disk records may lack it
		task_description: struct.task_description,
		states: struct.states,
		current_state_id: state?.current_state_id ?? "$START",
		tape,
		transition_log: state?.last_transition_chain ?? [],
	};
}

export function newFsmId(flowName: string): string {
	const ts = Date.now();
	const slug = (flowName || "flow").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "flow";
	const rand = randomBytes(4).toString("hex");
	return `${ts}-${slug}-${rand}`;
}
