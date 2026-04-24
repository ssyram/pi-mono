# Audit: `engine.ts` — Steering-Flow FSM Execution Engine
**Round**: 8  
**Date**: 2026-04-24  
**Auditor**: Sisyphus-Junior  
**Files read**: `engine.ts`, `types.ts`, `parser.ts`

---

## Summary

6 findings: 1 high, 3 medium, 2 low.

---

## Findings

---

### R8-E-001 — `runtime.transition_log` is never updated
**Severity**: High  
**Dimension**: FSM semantics

`FSMRuntime` declares a `transition_log: TransitionRecord[]` field (types.ts). Every successful transition builds a local `chain: TransitionRecord[]` and returns it in `TransitionResult`, but **neither `executeAction` nor `chainEpsilon` nor `enterStart` ever appends to `runtime.transition_log`**.

The log is a persistent field on the runtime object — callers that rely on it for history, replay, or debugging will always see an empty array regardless of how many transitions have occurred.

**Counterexample**:
```ts
const result = await executeAction(runtime, "go-next", [], tapePath, cwd);
// result.chain has 3 records
// runtime.transition_log.length === 0  ← always
```

**Fix**: In `executeAction` and `enterStart`, after a successful transition, push all `chain` entries into `runtime.transition_log`.

---

### R8-E-002 — Partial epsilon hops silently discarded on rollback
**Severity**: Medium  
**Dimension**: Rollback correctness

When `chainEpsilon` fails after the initial action condition passes, `executeAction` rolls back `runtime.current_state_id` to `snapshotStateId` and returns `chain: []`. This is correct for the caller. However, `chain` is mutated by reference throughout: it already contains the initial `A → EpsilonB` record before `chainEpsilon` is called, and `chainEpsilon` may append further partial hops before failing. All of these records are silently discarded.

This is benign today because `transition_log` is never written (R8-E-001). But if R8-E-001 is fixed naively — by appending `chain` to `transition_log` after `chainEpsilon` returns — the partial hops would be logged as committed transitions even though the state was rolled back, leaving the log inconsistent with the actual FSM state.

**Counterexample**:  
State A →(action)→ EpsilonB →(cond1 fails, cond2 fails) → rollback to A.  
`chain` at rollback point = `[A→EpsilonB]`. If logged, the log shows a transition to EpsilonB that never committed.

**Fix**: Snapshot `chain.length` before calling `chainEpsilon`; on rollback, truncate `chain` back to that length before any logging. Or document explicitly that partial epsilon hops are never logged.

---

### R8-E-003 — `"error"` event handler does not set `closed = true` before calling `settle()`
**Severity**: Medium  
**Dimension**: Child process lifecycle / error handling

In `runCondition`, `killTree()` guards against signalling an already-reaped process via the `closed` flag. The `"close"` handler sets `closed = true` before calling `settle()`, so the guard works on the happy path. The `"error"` handler does not:

```ts
child.on("error", (err) => {
    // closed is still false here
    settle({ ok: false, reason: `condition kind=spawn-error: ${err.message}` });
    // settle() → killTree() → closed===false → attempts process.kill(-pid, SIGKILL)
});
```

Node.js guarantees that `"close"` fires after `"error"`, so `settle()` is called twice. The `settled` flag prevents double-resolution of the Promise, but `killTree()` is invoked twice: once spuriously from the `"error"` path (process may already be dead), and once from `"close"`. The ESRCH error from the first kill is silently swallowed, so there is no crash — but the intent of the `closed` guard is violated.

**Counterexample**:  
Condition script is not executable (EACCES) → `spawn` assigns a pid → `"error"` fires → `killTree()` sends SIGKILL to process group (spurious) → `"close"` fires → `settle()` no-ops.

**Fix**: Set `closed = true` at the top of the `"error"` handler before calling `settle()`.

---

### R8-E-004 — Post-interpolation `cmd` bypasses parser's path validation, enabling path traversal
**Severity**: Medium  
**Dimension**: Security

The parser validates `condition.cmd` at parse time, rejecting relative paths that don't start with `./` or `../` and aren't absolute (bare names like `node` are allowed via PATH). This check runs on the **literal config string**. At runtime, `interpolatePlaceholders` substitutes `${arg-name}` tokens in `cmd` with LLM-supplied positional arguments **before** `resolveTokenRelToFlow` is called. The post-interpolation value is never re-validated.

Because `shell: false` is used, classic shell injection is not exploitable. The risk is:

1. **Arbitrary binary execution via path traversal**: If `cmd` contains a placeholder (e.g., `"./${script}"`), an LLM argument of `../../bin/evil` resolves via `pathResolve(flowDir, "../../bin/evil")` to an absolute path outside the flow directory.
2. **Argument injection into trusted scripts**: LLM-supplied values substituted into `args` are passed as separate argv elements. A value like `--config=/etc/passwd` is passed verbatim to the condition script with no filtering.

**Counterexample**:
```yaml
condition:
  cmd: "./${user_script}"
  args: []
```
LLM passes `../../bin/malicious` → resolves to `/abs/path/bin/malicious` → executed.

**Fix**: Forbid `${...}` placeholders in `cmd` entirely (parser-level), or re-run the same path validation on the post-interpolation `cmd` value inside `runCondition` before spawning.

---

### R8-E-005 — Off-by-one in `chainEpsilon` depth limit: effective cap is 63, not 64
**Severity**: Low  
**Dimension**: FSM semantics / edge case

```ts
while (depth < MAX_EPSILON_DEPTH) {  // MAX_EPSILON_DEPTH = 64; iterates depth 0..63
    ...
    runtime.current_state_id = matched.next_state_id;
    depth++;
    if (runtime.current_state_id === "$END") return { ok: true };
}
return { ok: false, error: `epsilon chain exceeded max depth ${MAX_EPSILON_DEPTH}` };
```

On the 64th iteration (`depth` starts at 63), a transition is taken and `depth` becomes 64. The `$END` check fires — if the destination is `$END`, it returns correctly. If the destination is another epsilon state, the `while` condition is now false and the function errors out. A valid acyclic chain of exactly 64 epsilon hops (no `$END` at hop 64) is rejected. The parser's cycle detection ensures no infinite chains, so this is a reachable false-negative for flows with exactly 64 epsilon states.

**Fix**: Change `while (depth < MAX_EPSILON_DEPTH)` to `while (depth <= MAX_EPSILON_DEPTH)` and update the error string, or move `depth++` to the top of the loop.

---

### R8-E-006 — `enterStart` silently succeeds when called on an already-advanced runtime
**Severity**: Low  
**Dimension**: FSM semantics / caller contract

`enterStart` assumes `runtime.current_state_id === "$START"` but does not assert it. If called on a runtime that has already advanced (double-call, or caller bug), `chainEpsilon` runs from the current non-`$START` state. If that state is non-epsilon, `chainEpsilon` returns `{ ok: true }` immediately, and `enterStart` returns `success: true, chain: [], final_state_id: <current>`. The caller receives a success result with no chain, indistinguishable from a `$START` that had no epsilon transitions — a silent no-op that masks the misuse.

**Counterexample**:
```ts
await enterStart(runtime, tapePath, cwd);  // advances to "review"
await enterStart(runtime, tapePath, cwd);  // called again
// → { success: true, chain: [], final_state_id: "review" }
// No error. Caller cannot detect the double-call.
```

**Fix**:
```ts
if (runtime.current_state_id !== "$START") {
    return {
        success: false,
        chain: [],
        final_state_id: runtime.current_state_id,
        reasons: [`enterStart called but current state is '${runtime.current_state_id}', not '$START'`],
        reached_end: false,
    };
}
```

---

## Non-Findings (explicitly checked)

| Area | Verdict |
|---|---|
| `$END` handling in `executeAction` | Correct — checked immediately after state assignment, before epsilon chain |
| `$END` handling in `chainEpsilon` | Correct — checked after each hop; `$END` is non-epsilon so `!state.is_epsilon` guard also catches it |
| Condition protocol (stdout `true`/`false`) | Correct — exit code is not used; first stdout line is the signal |
| Malformed stdout handling | Correct — anything other than `"true"`/`"false"` on line 1 produces `ok: false` with a descriptive reason |
| Condition crash (non-zero exit, no stdout) | Handled — `first` will be `""`, falls into the `malformed` branch with exit code in reason |
| Timeout kill reaching process group | Correct — `detached: true` + `process.kill(-pid, "SIGKILL")` with ESRCH fallback to direct kill |
| Stdout/stderr byte cap | Correct — per-chunk accounting with subarray truncation; no OOM risk |
| `default: true` short-circuit | Correct — checked first in `runCondition` before any spawn attempt |
| Arg-count enforcement | Correct — strict equality before condition evaluation; signature shown in error |
| `namedArgs` prototype pollution | Safe — `Object.prototype.hasOwnProperty.call` used; reserved JS names blocked by parser |
| Promise double-settlement | Safe — `settled` flag in `settle()` prevents double-resolution |
| Self-loop prevention | Parser rejects at parse time; engine need not re-check |
| Epsilon cycle prevention | Parser DFS at parse time; `MAX_EPSILON_DEPTH` is a runtime safety net |
| Empty action list on epsilon state | Parser enforces ≥1 action on epsilon states; engine's loop over empty array would produce no match → `chainEpsilon` errors correctly |
| `flowDir` empty string | `resolveTokenRelToFlow` guards `if (!flowDir) return token` — no crash |
| `spawn` failure (ENOENT) | Caught in the `try/catch` around `spawn()`; resolves `{ ok: false, reason: "failed to spawn ..." }` |
