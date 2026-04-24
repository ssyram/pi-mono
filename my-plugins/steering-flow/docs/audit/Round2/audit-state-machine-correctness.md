# D4 Audit: State-Machine Correctness — Tape-State Rollback Asymmetry

**Dimension**: D4 — State-Machine Correctness  
**Auditor**: Sisyphus-Junior  
**Date**: 2026-04-23  
**Prior coverage**: None (first audit of this dimension)  
**Files examined**: `engine.ts`, `index.ts`, `storage.ts`, `docs/audit/Round2/spec-gate.md`

---

## Audit Scope

This audit examines whether the FSM engine maintains a consistent `(state, tape)` pair across all failure paths. The engine uses a snapshot-before-execute pattern for state, but the tape is a raw file on disk that condition child processes can write to freely. The central question is: when a transition fails, does the rollback restore *both* state and tape, or only state?

---

## Contract Baseline (from spec-gate.md)

| Contract | Source |
|---|---|
| "Snapshot + rollback on epsilon chain failure (after initial condition passed)" | Engine Contracts |
| "Tape re-synced from disk after every condition execution" | Engine Contracts |
| "persistRuntime: tape-first, state-second → at-least-once retry semantics on crash" | Storage Contracts |
| "Conditions must be idempotent (framework doesn't enforce)" | Intentional Omissions |
| "In-process mutex only (no cross-process locking)" | Intentional Omissions |

**Spec gap identified**: The rollback contract specifies state rollback only. Tape rollback is never mentioned. This audit treats the implicit invariant as: *after any failed transition, the observable FSM configuration `(current_state_id, tape)` must be identical to the pre-transition configuration*. The spec as written only guarantees the `current_state_id` half.

---

## Findings

---

### D4-001 — Epsilon Chain Failure Leaves Tape Permanently Mutated

**Severity**: Critical  
**Affected files**:
- `engine.ts` line ~268 (snapshot), line ~280–295 (rollback)
- `index.ts` line 237 (tape re-sync), line 243–244 (conditional persist)
- `storage.ts` line 131 (`tapePathFor`), line 253–259 (`loadRuntime`)

#### Violated Invariant

> **Post-condition of `executeAction`**: If the function returns `{ success: false }`, the FSM configuration `(current_state_id, tape)` must equal the pre-call configuration.

The code satisfies this for `current_state_id` but not for `tape`.

#### Code Path

```
engine.ts ~line 268:
  const snapshotStateId = runtime.current_state_id;
  // No tape snapshot taken. tapePath is a raw filesystem path.

engine.ts ~line 280:
  const epsilonResult = await chainEpsilon(runtime, chain, tapePath, cwd);
  // chainEpsilon calls runCondition(..., tapePath, ...) for each hop.
  // Each condition child process has direct write access to tape.json.

engine.ts ~line 290 (on epsilon failure):
  runtime.current_state_id = snapshotStateId;   // state restored (OK)
  // tape.json on disk is NOT restored.           tape NOT restored (BUG)

index.ts line 237:
  rt.tape = await readTape(sessionDir, fsmId);
  // re-syncs in-memory tape FROM disk: propagates the mutation into memory

index.ts line 243-244:
  if (result.success) {
    await persistRuntime(sessionDir, rt);
  }
  // on failure, persistRuntime is skipped.
  // state.json stays at old state_id.
  // tape.json already has condition-written mutations.
  // loadRuntime on next call returns (old_state, mutated_tape). [BUG]
```

#### Concrete Counterexample

**FSM configuration**:
```
States: A (normal), B (epsilon), C (normal)
Transitions from A:
  action "go": condition script passes -> next_state = B
Epsilon transitions from B:
  condition script: writes COUNTER=1 to tape.json -> next_state = C
  (but C does not exist in this FSM - epsilon chain fails)
```

**Execution sequence**:
1. FSM is in state A, tape = `{}`
2. Agent calls `action_call go`
3. `executeAction`: action condition passes, `snapshotStateId = "A"`, `runtime.current_state_id = "B"`
4. `chainEpsilon`: epsilon condition for B runs, writes `{"COUNTER": 1}` directly to `tape.json`
5. Epsilon chain fails (C not found) -> `runtime.current_state_id = "A"` (restored)
6. `actionCall` re-syncs: `rt.tape = readTape(...)` -> `rt.tape = {"COUNTER": 1}`
7. `persistRuntime` skipped (failure path)
8. **Disk state**: `state.json = {current_state_id: "A"}`, `tape.json = {"COUNTER": 1}`
9. Next `loadRuntime` returns `(state="A", tape={"COUNTER":1})` — inconsistent pair

**Observable consequence**: The FSM is back in state A but the tape carries a mutation that only makes sense in the context of the A->B->C transition that never completed. Any subsequent transition from A that reads `COUNTER` from tape sees a phantom value.

---

### D4-002 — Partial Epsilon Chain Leaves Tape at Intermediate Hop's State

**Severity**: Critical  
**Affected files**:
- `engine.ts` lines ~321–355 (`chainEpsilon` body)
- `engine.ts` line ~337 (early return on no-match)

#### Violated Invariant

> **Invariant of `chainEpsilon`**: If the function returns `{ ok: false }`, the tape must reflect the pre-call state (i.e., no epsilon condition's side effects are visible).

#### Code Path

```
engine.ts ~line 321 (chainEpsilon):
  while (depth < MAX_EPSILON_DEPTH) {
    // for each epsilon state, find matching condition:
    for (const act of state.actions) {
      const condResult = await runCondition(act.condition, tapePath, [], cwd, ...);
      // condition writes to tape.json directly (child process, no lock)
      if (condResult.passed) {
        runtime.current_state_id = act.next_state_id;  // mutate state inline
        chain.push(...);
        break;  // move to next epsilon hop
      }
    }
    // if no action matched:
    return { ok: false, error: "epsilon state '...' had no matching condition" };
    // returns immediately. No tape rollback. No state rollback (caller does that).
  }
```

#### Concrete Counterexample

**FSM configuration**:
```
States: A (normal), B (epsilon), C (epsilon), D (normal)
Epsilon chain: A -> B -> C -> D
  B condition: writes STEP=1 to tape -> passes -> next = C
  C condition: writes STEP=2 to tape -> passes -> next = D
  D condition: writes STEP=3 to tape -> FAILS (returns exit code 1)
```

**Execution sequence**:
1. FSM in state A, tape = `{}`
2. `chainEpsilon` starts: depth=0, current epsilon state = B
3. B condition runs: tape.json = `{"STEP": 1}`, passes -> `current_state_id = "C"`
4. C condition runs: tape.json = `{"STEP": 2}`, passes -> `current_state_id = "D"`
5. D condition runs: tape.json = `{"STEP": 3}`, FAILS
6. `chainEpsilon` returns `{ ok: false }` — no tape rollback
7. Caller (`executeAction`) restores `current_state_id = "A"`
8. **Disk state**: `state.json = {current_state_id: "A"}`, `tape.json = {"STEP": 3}`

**Observable consequence**: Tape is at the state produced by D's condition (which failed), while the FSM is back at A. The tape reflects 3 hops of mutations from a transition that never committed. The rollback is not to pre-B state, not to pre-C state, but to post-D-condition state — the worst possible intermediate point.

---

### D4-003 — Action Condition Tape Mutation Precedes Snapshot Point

**Severity**: High  
**Affected files**:
- `engine.ts` lines ~200–268 (`executeAction` pre-snapshot section)

#### Violated Pre-condition

> **Pre-condition of snapshot**: The snapshot must be taken before any side-effecting operation that the rollback is intended to cover.

#### Code Path

```
engine.ts ~line 200-255:
  // Action condition runs FIRST:
  const condResult = await runCondition(action.condition, tapePath, positionalArgs, cwd, ...);
  // condition child process can write to tape.json here

  if (!condResult.passed) {
    return { success: false, ... };  // early return - no snapshot was ever taken
  }

  // Snapshot taken AFTER condition:
  const snapshotStateId = runtime.current_state_id;  // line ~268
```

The snapshot is taken after the action condition has already run. If the action condition writes to tape and then the epsilon chain fails, the tape mutation from the action condition itself is also unprotected — it occurred before the snapshot point and is therefore outside the rollback window.

#### Concrete Counterexample

**FSM configuration**:
```
States: A (normal), B (epsilon), C (normal - does not exist)
Action from A: "go"
  condition script: writes INIT=true to tape -> passes -> next_state = B
  epsilon from B: condition -> next_state = C (C not found -> fails)
```

**Execution sequence**:
1. FSM in state A, tape = `{}`
2. `executeAction("go")`: action condition runs, writes `{"INIT": true}` to tape.json
3. Condition passes -> `snapshotStateId = "A"` (snapshot taken AFTER tape write)
4. `chainEpsilon` fails (C not found)
5. Rollback: `current_state_id = "A"`
6. **Disk state**: `state.json = {current_state_id: "A"}`, `tape.json = {"INIT": true}`

**Observable consequence**: Even the action condition's tape writes — not just epsilon condition writes — survive a failed transition. The snapshot/rollback mechanism provides zero tape protection for the entire `executeAction` call, not just the epsilon portion.

---

### D4-004 — `enterStart` Has Identical Tape Asymmetry at FSM Initialization

**Severity**: High  
**Affected files**:
- `engine.ts` lines ~356–380 (`enterStart`)
- `index.ts` lines ~115–200 (`loadAndPush`)

#### Violated Invariant

> **Post-condition of `enterStart`**: If the function returns `{ success: false }`, the FSM tape must be empty (as initialized by `loadAndPush` line 159).

#### Code Path

```
engine.ts ~line 356:
  export async function enterStart(runtime, tapePath, cwd) {
    const snapshot = runtime.current_state_id;  // state-only snapshot
    const epsilonResult = await chainEpsilon(runtime, chain, tapePath, cwd);
    if (!epsilonResult.ok) {
      runtime.current_state_id = snapshot;  // state restored (OK)
      // tape NOT restored                   tape NOT restored (LATENT BUG)
      return { success: false, ... };
    }
  }

index.ts line 159:
  await writeTape(sessionDir, fsmId, {});  // tape initialized to {}

index.ts line 178:
  rt.tape = await readTape(sessionDir, fsmId);  // re-sync after enterStart

index.ts line 180/190/200:
  await popFsm(sessionDir);  // on enterStart throw or !entry.success - deletes FSM dir (contains tape.json)
```

**Note**: `loadAndPush` calls `popFsm` on failure, which deletes the entire FSM directory including `tape.json`. This means the tape mutation is cleaned up at the `loadAndPush` level. However, `enterStart` itself does not roll back the tape — it relies on the caller to clean up. If `enterStart` is ever called from a context that does NOT call `popFsm` on failure, the tape asymmetry becomes exploitable.

**Current risk**: Medium — contained by `loadAndPush`'s `popFsm` cleanup, but the asymmetry is a latent defect. Any future call site that invokes `enterStart` without the `popFsm` safety net will silently inherit the bug. The function does not document this caller obligation.

---

### D4-005 — `persistRuntime` Crash-Safety Argument Fails on Non-Idempotent Conditions

**Severity**: High  
**Affected files**:
- `index.ts` lines 104–113 (`persistRuntime`)
- `storage.ts` lines 253–259 (`loadRuntime`)

#### Violated Invariant

> **At-least-once retry semantics** (spec-gate.md): "if we crash between the two [tape write and state write], the tape is already durable and the state.current_state_id is unchanged from the previous successful transition, so the next read sees a consistent (pre-transition) world."

This argument is only valid if conditions are idempotent. The spec explicitly lists "Conditions must be idempotent (framework doesn't enforce)" as an intentional omission — meaning the framework makes no guarantee. The spec's crash-safety claim and its idempotency disclaimer are in direct tension: the crash-safety claim is false for any non-idempotent condition.

#### Code Path

```
index.ts line 104-113 (persistRuntime):
  async function persistRuntime(sessionDir, rt) {
    await writeTape(sessionDir, rt.fsm_id, rt.tape);   // (1) tape written
    // CRASH WINDOW: tape.json updated, state.json still has old state_id
    await writeState(sessionDir, rt.fsm_id, rt.current_state_id);  // (2) state written
  }
```

On crash between (1) and (2):
- `tape.json` has the post-transition tape values
- `state.json` has the pre-transition `current_state_id`
- `loadRuntime` returns `(old_state, new_tape)` — inconsistent pair
- The engine re-executes the transition from `old_state` with `new_tape` as input

#### Concrete Counterexample

**FSM configuration**:
```
States: A (normal), B (normal)
Action from A: "transfer"
  condition script: reads BALANCE from tape, deducts 100, writes new BALANCE -> passes
  next_state = B
```

**Execution sequence**:
1. FSM in state A, tape = `{"BALANCE": 500}`
2. `actionCall("transfer")`: condition runs, tape.json = `{"BALANCE": 400}`, passes
3. `persistRuntime` called: `writeTape` completes -> tape.json = `{"BALANCE": 400}`
4. **CRASH** before `writeState`
5. Restart: `loadRuntime` returns `(state="A", tape={"BALANCE": 400})`
6. Agent retries `actionCall("transfer")`: condition reads BALANCE=400, deducts 100, tape.json = `{"BALANCE": 300}`
7. `persistRuntime` completes: state = B, tape = `{"BALANCE": 300}`

**Observable consequence**: The deduction was applied twice (500->400->300) even though the transition only committed once. The spec's "at-least-once retry semantics" is only safe if the condition is idempotent. For any condition with observable side effects (counter increments, balance deductions, append-only log writes), the crash window produces incorrect results.

**Spec gap**: The spec documents the idempotency assumption but does not document the consequence of violating it in the crash window. Users implementing non-idempotent conditions have no warning that a crash between tape-write and state-write will cause double-execution with incorrect intermediate tape state.

---

### D4-006 — Condition Process Writes Bypass `atomicWriteJson` — Tape Corruption on Crash

**Severity**: Medium  
**Affected files**:
- `storage.ts` line 131 (`tapePathFor`)
- `storage.ts` lines 37–44 (`atomicWriteJson`)
- `storage.ts` lines 237–245 (`readTape`)
- `engine.ts` lines ~60–90 (`runCondition` — tape path passed to child)

#### Violated Invariant

> **Storage invariant** (storage.ts line 15 comment): "All writes go through atomicWriteJson (tmp+rename) to avoid truncation on crash."

Condition processes receive the raw `tape.json` path and write directly to it, bypassing `atomicWriteJson`.

#### Code Path

```
storage.ts line 131:
  export function tapePathFor(sessionDir, fsmId): string {
    return join(fsmDir(sessionDir, fsmId), "tape.json");
    // returns raw path to tape.json
  }

engine.ts ~line 70 (runCondition):
  // tapePath is interpolated into condition script argv:
  // e.g., condition = "my-script.sh ${$TAPE_FILE}"
  // child process receives the raw path and writes directly to tape.json
  // No atomicWriteJson. No tmp+rename. No crash protection.

storage.ts line 237-245 (readTape):
  const raw = await readFile(path, "utf8").catch(...);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || ...) throw new CorruptedStateError(...);
  // if condition process crashed mid-write, tape.json contains truncated JSON
  // JSON.parse throws -> CorruptedStateError
  // no recovery path; FSM is permanently unreadable
```

#### Concrete Counterexample

**Execution sequence**:
1. FSM in state A, tape = `{"KEY": "value"}`
2. Condition script opens tape.json for writing, begins writing `{"KEY": "new_val` — process killed mid-write (OOM, SIGKILL, timeout)
3. tape.json now contains truncated, invalid JSON
4. Next `actionCall`: `loadRuntime` -> `readTape` -> `JSON.parse` throws -> `CorruptedStateError`
5. FSM is permanently unreadable. No recovery path exists in the codebase.

**Observable consequence**: A condition process crash (OOM kill, SIGKILL, signal from OS) corrupts the tape file permanently. The `atomicWriteJson` protection that guards all other writes in the system (state.json, stack.json, fsm.json) does not apply to condition-process tape writes. The storage layer's stated invariant ("all writes go through atomicWriteJson") is violated by design for the tape's primary write path.

---

## Summary Table

| ID | Description | Severity | Affected File:Line | Violated Contract |
|---|---|---|---|---|
| D4-001 | Epsilon chain failure leaves tape permanently mutated; state rolls back but tape does not | **Critical** | `engine.ts:~268,~290`; `index.ts:237,243` | Post-condition of `executeAction`: `(state, tape)` must equal pre-call on failure |
| D4-002 | Partial epsilon chain (N-of-M hops pass) leaves tape at Nth hop's post-condition state | **Critical** | `engine.ts:~321–355,~337` | Invariant of `chainEpsilon`: tape must reflect pre-call state on `{ok:false}` |
| D4-003 | Action condition tape mutation precedes snapshot — outside rollback window entirely | **High** | `engine.ts:~200–268` | Pre-condition of snapshot: snapshot must precede all side-effecting operations it covers |
| D4-004 | `enterStart` has identical tape asymmetry; currently contained by `popFsm` but latent | **High** | `engine.ts:~356–380`; `index.ts:~178–200` | Post-condition of `enterStart`: tape must be empty on failure |
| D4-005 | `persistRuntime` crash window causes double-execution of non-idempotent conditions | **High** | `index.ts:104–113`; `storage.ts:253–259` | At-least-once retry semantics require idempotent conditions — not enforced or warned |
| D4-006 | Condition processes write tape.json directly, bypassing `atomicWriteJson` — crash corrupts tape permanently | **Medium** | `storage.ts:131`; `engine.ts:~70` | Storage invariant: "all writes go through atomicWriteJson" |

---

## Root Cause Analysis

All six findings share a single architectural root cause: **the tape is treated as an external side-effect channel, not as part of the FSM's transactional state**.

The engine's snapshot/rollback mechanism was designed for `current_state_id` — a single in-memory string that is trivially snapshotted and restored. The tape is a file on disk that condition processes write to as a side channel. The two are never treated as a unit:

1. No tape snapshot is taken before any condition runs
2. No tape restore is performed on any failure path
3. The persistence layer (`persistRuntime`) writes them sequentially with a crash window between them
4. The storage layer's atomicity guarantee (`atomicWriteJson`) does not extend to condition-process writes

The spec acknowledges the idempotency assumption but does not document the full consequence: the system is only correct if every condition is both idempotent AND does not write to the tape on a path that might fail. In practice, conditions that write to tape to communicate results (the primary use case of the tape) are precisely the conditions most likely to be non-idempotent.

---

## Recommended Fix Directions (non-prescriptive)

- **D4-001/D4-002/D4-003**: Take a tape snapshot (read tape.json into memory) before any condition runs in `executeAction` and `chainEpsilon`. On failure, restore tape.json from the in-memory snapshot via `writeTape`. This is the minimal fix: one additional `readTape` call at entry, one `writeTape` call on all failure exits.
- **D4-004**: Either snapshot/restore tape in `enterStart`, or document (and type-enforce) that `enterStart` callers must handle tape cleanup. Currently the caller obligation is implicit and undocumented.
- **D4-005**: Either enforce idempotency at the framework level (e.g., a condition wrapper that records a transition-id in the tape and skips re-execution if the id matches), or reverse `persistRuntime` to write state-first/tape-second — accepting that a crash leaves state advanced and tape at old value, so the transition is skipped on retry rather than re-executed.
- **D4-006**: Provide a tape-write helper binary that condition scripts must use instead of writing to the raw path directly. The helper calls `atomicWriteJson` internally. Alternatively, have `runCondition` write condition output to a tmp path and rename it atomically after the condition exits cleanly.
