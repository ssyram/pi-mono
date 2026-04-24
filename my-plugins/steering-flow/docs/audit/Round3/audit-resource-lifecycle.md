# Audit: Resource Lifecycle

**Dimension**: Resource Lifecycle (tmp files, child processes, FSM directories, file descriptors, memory)
**Spec**: `execution-behavior.md`
**Auditor**: Round 3 — fresh eyes
**Date**: 2025-04-23

---

## Finding RL-1: Tmp file leaked on `writeFile` failure in `atomicWriteJson`

**Classification**: LEAK

**Location**: `storage.ts:37-43`

```ts
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
    const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
    const text = JSON.stringify(data, null, 2);
    await fs.writeFile(tmp, text, "utf-8");   // ← if this throws (disk full, EACCES)
    await fs.rename(tmp, path);               // ← ...tmp file is never cleaned up
}
```

**Invariant violated**: Post-condition of `atomicWriteJson` — on failure, no side effects should persist on disk.

**Counterexample**: Disk reaches capacity mid-write. `fs.writeFile` throws `ENOSPC`. The partially-written tmp file `state.json.tmp.12345.a1b2c3d4` remains on disk. It is tagged with the current PID, so `sweepTmpFiles` (which skips own-PID files at `storage.ts:144`) will NOT clean it during the same process lifetime. Only a subsequent process restart followed by a `session_start` event will sweep it.

**Impact**: Orphan tmp files accumulate on repeated write failures within a single process lifetime. In a long-running pi session with a full or flaky disk, each failed atomic write leaves one orphan. These are only cleaned on next process boot.

**Missing**: A `try/catch` around `writeFile` + `rename` that does `fs.rm(tmp, { force: true })` in the catch path before rethrowing.

---

## Finding RL-2: Tmp file leaked on `rename` failure in `atomicWriteJson`

**Classification**: LEAK

**Location**: `storage.ts:42`

```ts
await fs.rename(tmp, path);  // ← if this throws (cross-device, EPERM), tmp persists
```

**Invariant violated**: Same as RL-1 — no side effects on failure.

**Counterexample**: `path` resolves to a different filesystem than `tmp` (e.g., symlinked `.pi/` directory). `fs.rename` throws `EXDEV`. The fully-written tmp file persists. Same own-PID skip logic in `sweepTmpFiles` prevents cleanup until next process.

**Impact**: Identical to RL-1. The tmp file is valid JSON but orphaned.

---

## Finding RL-3: `sweepTmpFiles` skips own-PID tmp files by design — no same-process recovery

**Classification**: PARTIAL

**Location**: `storage.ts:143-144`

```ts
const ownTag = `.tmp.${process.pid}.`;
const isOrphanTmp = (name: string) => name.includes(".tmp.") && !name.includes(ownTag);
```

**Invariant violated**: Spec §E.1 states "sweepTmpFiles 清理" (sweepTmpFiles cleans up crash residue). The own-PID exclusion means residue from the current process is never cleaned by the current process.

**Counterexample**: Process writes 100 flows in a loop. Each `atomicWriteJson` call for `tape.json` fails (disk full). 100 tmp files accumulate, all tagged with the current PID. `sweepTmpFiles` runs on next `session_start` within the same process — skips all 100 because they match `ownTag`. Only a different process (different PID) will clean them.

**Rationale for PARTIAL**: The skip is intentional to avoid deleting tmp files from concurrent in-flight writes within the same process. But combined with RL-1/RL-2 (no cleanup on failure), it creates a gap where same-process orphans are never reclaimed until process restart.

---

## Finding RL-4: `sweepTmpFiles` only scans one directory level deep

**Classification**: SAFE

**Location**: `storage.ts:146-159`

```ts
const entries = await fs.readdir(sessionDir, { withFileTypes: true });
for (const e of entries) {
    if (e.isFile() && isOrphanTmp(e.name)) {
        await fs.rm(join(sessionDir, e.name), { force: true });
    } else if (e.isDirectory()) {
        const sub = await fs.readdir(join(sessionDir, e.name));  // ← only one level
        for (const name of sub) { ... }
    }
}
```

**Analysis**: The disk layout (spec §P) is `<SESSION-ID>/<FSM-ID>/{fsm.json, state.json, tape.json}`. Tmp files for `fsm.json`, `state.json`, and `tape.json` live inside `<FSM-ID>/` subdirectories — exactly one level deep from `sessionDir`. This IS covered. `stack.json` lives directly in `sessionDir` — also covered (top-level scan). The current depth is sufficient for the documented layout.

**Verdict**: SAFE for the current disk layout. Would become LEAK if nesting depth increases.

---

## Finding RL-5: Child process TOCTOU race in `killTree`

**Classification**: VULNERABLE

**Location**: `engine.ts:104-113`

```ts
const killTree = () => {
    if (closed) return;           // ← check
    if (child.pid === undefined) return;
    try {
        process.kill(-child.pid, "SIGKILL");  // ← use (race window)
    } catch {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }
};
```

**Invariant violated**: `killTree` must only signal the intended process group.

**Counterexample**: The `close` event fires on the Node.js event loop. Between the `if (closed) return` check and the `process.kill(-child.pid)` call, the child process exits naturally and the OS recycles the PID. The SIGKILL is sent to an unrelated process group. This is a classic TOCTOU race.

**Practical likelihood**: Extremely narrow window (microseconds). On Linux, PID recycling requires wrapping through `/proc/sys/kernel/pid_max` (default 32768 or 4194304). On macOS, PID reuse is more aggressive but still unlikely in this window. Additionally, `killTree` and the `close` handler both run on the same Node.js event loop thread — the race can only occur if the OS reaps the child between the `closed` check and the `process.kill` syscall within the same synchronous execution frame. This makes the window even narrower (kernel-level only).

**Impact**: Theoretical — could kill an unrelated process group. In practice, near-zero probability in normal operation.

---

## Finding RL-6: Non-POSIX (Windows) process group kill fails silently — subtree orphaning

**Classification**: VULNERABLE

**Location**: `engine.ts:108-113`

```ts
try {
    process.kill(-child.pid, "SIGKILL");  // ← invalid on Windows (negative PID)
} catch {
    try { child.kill("SIGKILL"); } catch { /* already dead */ }  // ← only kills direct child
}
```

**Invariant violated**: Spec §F states the child is started in its own process group so that "SIGKILL on timeout reaches the entire subtree." On Windows, `process.kill(-pid)` throws, the catch block kills only the direct child via `child.kill("SIGKILL")`, and any grandchild processes become orphans.

**Counterexample**: A condition script `validate.sh` spawns a subprocess `python heavy_check.py`. On timeout, `killTree` fails the process group kill (Windows), falls back to killing only `validate.sh`. `python heavy_check.py` continues running indefinitely as an orphan.

**Impact**: On Windows, every timed-out condition that spawns subprocesses leaks orphan processes. On POSIX, this is SAFE.

---

## Finding RL-7: stdout/stderr Buffer arrays retained after `settle()` until `close` event

**Classification**: PARTIAL

**Location**: `engine.ts:96-101, 115-121, 127-152`

```ts
const stdoutChunks: Buffer[] = [];   // ← allocated per runCondition call
// ...
const settle = (r: ConditionResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    killTree();
    resolvePromise(r);               // ← promise resolved, caller continues
};
// ...
child.stdout?.on("data", (d: Buffer) => {  // ← listener still active after settle
    if (stdoutCapped) return;               // ← but still referenced
    // ...
});
```

**Invariant violated**: Resources should be released promptly after they are no longer needed.

**Counterexample**: Timeout fires at 30s. `settle()` resolves the promise and sends SIGKILL. The caller proceeds. But `stdoutChunks` and `stderrChunks` arrays (up to 64KB + 16KB) remain referenced by the `data` event closures until the child's streams emit `close`. If SIGKILL is delivered promptly, this is milliseconds. If the child is in an uninterruptible state (D-state on Linux), the buffers persist indefinitely.

**Impact**: Up to 80KB per stuck condition process. Minor memory pressure, not a true leak since the buffers are bounded by caps and will eventually be GC'd when the child finally closes.

---

## Finding RL-8: `popFsm` silently swallows directory cleanup failures

**Classification**: PARTIAL

**Location**: `storage.ts:111-123`

```ts
export async function popFsm(sessionDir: string): Promise<string | undefined> {
    const stack = await readStack(sessionDir);
    const top = stack.pop();
    await writeStack(sessionDir, stack);
    if (top) {
        try {
            await fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true });
        } catch {
            // Leave orphan on rm error; not fatal
        }
    }
    return top;
}
```

**Invariant violated**: Spec §O states "到达 $END: FSM 目录已删" and "失败 load: FSM 目录已删". The silent catch means the directory may persist.

**Counterexample**: A condition script holds an open file handle on `tape.json` (Windows file locking) or the directory has been made read-only. `fs.rm` fails. The FSM directory persists as an orphan — it is no longer referenced by `stack.json` but occupies disk space. No retry or notification mechanism exists.

**Impact**: Orphan directories accumulate silently. Each contains `fsm.json` + `state.json` + `tape.json` (typically a few KB). No upper bound on accumulation across sessions. No periodic garbage collection scans for unreferenced FSM directories.

**Missing**: Either (a) a periodic GC that scans for FSM directories not referenced in `stack.json`, or (b) logging/notification on cleanup failure so the user is aware.

---

## Finding RL-9: `lastCompactionAt` Map grows unboundedly across sessions

**Classification**: LEAK

**Location**: `index.ts:98, 631, 732-733`

```ts
const lastCompactionAt = new Map<string, number>();  // line 98 — module-level

pi.on("session_compact", async (_event, ctx) => {
    lastCompactionAt.set(ctx.sessionManager.getSessionId(), Date.now());  // line 631
});

pi.on("session_start", async (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    lastCompactionAt.delete(sid);  // line 732-733
});
```

**Invariant violated**: Module-level state should not grow unboundedly over the process lifetime.

**Counterexample**: A long-running pi process handles 10,000 distinct sessions. Each session triggers `session_compact` (adding an entry) and then is abandoned (never triggers `session_start` again). Over months, entries accumulate with no ceiling.

**Practical impact**: Each entry is ~50 bytes (string key + number value). 10,000 abandoned sessions ≈ 500KB. Low severity but unbounded growth.

**Missing**: A `session_end` or `session_destroy` hook to clean up, or a periodic sweep of stale entries (e.g., entries older than 24h).

---

## Finding RL-10: `sessionLocks` Map — correct cleanup verified

**Classification**: SAFE

**Location**: `storage.ts:64-83`

```ts
const sessionLocks = new Map<string, Promise<unknown>>();

export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const key = sessionId || "_no_session_";
    const prev = sessionLocks.get(key) ?? Promise.resolve();
    const prevSettled: Promise<unknown> = prev.then(() => undefined, () => undefined);
    const next: Promise<T> = prevSettled.then(fn);
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
```

**Analysis**: The identity check `sessionLocks.get(key) === tail` ensures only the last waiter in a chain deletes the entry. If a new caller enqueues while `fn` is running, it replaces `tail` in the map, so the earlier caller's `finally` sees a mismatch and does NOT delete. The last caller's `finally` sees its own `tail` and deletes. The `prevSettled` swallowing ensures a failed predecessor does not block successors.

**Verified**: No leak. Map entry is deleted when the last queued operation for a session completes.

---

## Finding RL-11: No file descriptor leaks — all I/O uses high-level `fs.promises` API

**Classification**: SAFE

**Location**: All of `storage.ts`, `index.ts`

**Analysis**: Every file operation uses `fs.readFile`, `fs.writeFile`, `fs.rename`, `fs.rm`, `fs.stat`, `fs.mkdir`, `fs.readdir`. None return raw file descriptors. Node.js internally manages fd open/close for these high-level APIs. No `fs.open()`, `fs.createReadStream()`, or `fs.createWriteStream()` calls exist anywhere in the codebase.

**Verdict**: No fd leak vectors present.

---

## Finding RL-12: `transition_log` in FSMRuntime is bounded by design

**Classification**: SAFE

**Location**: `types.ts` (TransitionRecord[]), `index.ts:238`, `engine.ts:260-266`

**Analysis**: Despite `transition_log` being a `TransitionRecord[]` with no explicit size limit in the type, the runtime resets it on every action call:

```ts
// index.ts:238
rt.transition_log = result.chain;
```

`persistRuntime` writes it to `state.json` as `last_transition_chain` — it holds only the chain from the most recent transition, not a cumulative log. Maximum length is bounded by `MAX_EPSILON_DEPTH` (64) since each epsilon hop adds one record.

**Verdict**: Bounded at 64 entries per transition. No unbounded growth.

---

## Finding RL-13: Tape size bounded by `MAX_TAPE_KEYS` and `MAX_TAPE_VALUE_BYTES`

**Classification**: SAFE

**Location**: `index.ts:42-43, 270-278`

```ts
const MAX_TAPE_VALUE_BYTES = 64 * 1024;   // 64 KiB per value
const MAX_TAPE_KEYS = 1024;               // 1024 keys max
```

**Analysis**: `saveCall` enforces both limits. Maximum tape size = 1024 × 64KB = 64MB theoretical upper bound. Condition scripts can write to `tape.json` directly (via `${$TAPE_FILE}`), bypassing these limits, but the tape is re-read from disk on each operation so in-memory size tracks disk size. Condition scripts are trusted code authored by the flow designer.

**Verdict**: Bounded for LLM-initiated writes. Condition script bypass is by design.

---

## Finding RL-14: Detached child process with no `unref()` — correct design

**Classification**: SAFE

**Location**: `engine.ts:84-89`

```ts
child = spawn(cmd, argv, {
    cwd,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
});
```

**Analysis**: `detached: true` creates a new process group but does NOT detach from the parent's event loop. The parent holds a reference to the child via the `ChildProcess` object and its piped stdout/stderr streams. `child.unref()` is never called. This is correct — the parent MUST hold a reference to collect stdout/stderr and handle the `close` event. The `settle()` function ensures the promise resolves (via timeout or close), after which the `ChildProcess` object becomes eligible for GC when the child's streams close.

**Verdict**: Correct design. No orphaning risk on POSIX.

---

## Summary Table

| ID | Finding | Classification | Severity |
|----|---------|---------------|----------|
| RL-1 | Tmp file leaked on `writeFile` failure | LEAK | Medium |
| RL-2 | Tmp file leaked on `rename` failure | LEAK | Medium |
| RL-3 | `sweepTmpFiles` skips own-PID — no same-process recovery | PARTIAL | Low |
| RL-4 | `sweepTmpFiles` depth — sufficient for current layout | SAFE | — |
| RL-5 | TOCTOU race in `killTree` PID check | VULNERABLE | Low (theoretical) |
| RL-6 | Windows process group kill fails — subtree orphaning | VULNERABLE | High (Windows-only) |
| RL-7 | Buffer arrays retained after settle until child close | PARTIAL | Low |
| RL-8 | `popFsm` silently swallows directory cleanup failures | PARTIAL | Medium |
| RL-9 | `lastCompactionAt` Map grows with abandoned sessions | LEAK | Low |
| RL-10 | `sessionLocks` Map cleanup | SAFE | — |
| RL-11 | No file descriptor leaks | SAFE | — |
| RL-12 | `transition_log` bounded by design | SAFE | — |
| RL-13 | Tape size bounded (condition script bypass by design) | SAFE | — |
| RL-14 | Detached child with no `unref()` — correct design | SAFE | — |
