# Audit: State-Machine Correctness

**Dimension**: STATE-MACHINE CORRECTNESS (Hoare-style)
**Spec**: `docs/execution-behavior.md`
**Date**: 2026-04-23
**Scope**: engine.ts, parser.ts, types.ts, index.ts, storage.ts, stop-guards.ts, builtin-registry.ts

---

## 1. Epsilon Chain Termination Guarantees

### 1.1 Depth Limit Enforcement — GUARDED

**Spec claim** (§G.2): `chainEpsilon` loops with `depth < 64`; terminates on depth exceeded.

**Code** (`engine.ts:5`): `MAX_EPSILON_DEPTH = 64`
**Code** (`engine.ts:321`): `while (depth < MAX_EPSILON_DEPTH)` with `depth++` at line 350.

**Verification**: Loop runs iterations 0..63 (64 transitions max). At depth=64 the while-condition is false and the function returns `{ ok: false, error: "epsilon chain exceeded max depth 64" }`.

**Pre**: `depth === 0` on entry.
**Invariant**: `0 <= depth <= 64` and each iteration either returns early or increments depth.
**Post**: Function terminates in at most 64 iterations + 1 final check.

**Classification**: **GUARDED** — hard depth limit is correctly enforced.

### 1.2 Mutual Epsilon Cycles Pass Parser Validation — VULNERABLE

**Spec claim** (§D.3): Parser validates reachability via dual BFS; self-loops rejected.

**Code** (`parser.ts:138-139`): Self-loop check: `a.next_state_id === stateId` throws `ParseError`.
**Code** (`parser.ts:289-336`): Forward BFS from `$START`, reverse BFS from `$END`. No epsilon-aware cycle detection.

**Invariant violated**: The parser guarantees every state is on a path from `$START` to `$END`, but does NOT guarantee the epsilon subgraph is acyclic.

**Counterexample**:
```yaml
states:
  - state_id: $START
    state_desc: entry
    is_epsilon: true
    actions:
      - action_id: go_a
        action_desc: go to A
        condition: { default: true }
        next_state_id: A

  - state_id: A
    state_desc: router A
    is_epsilon: true
    actions:
      - action_id: go_end
        action_desc: try end
        condition: { cmd: "./check.sh" }
        next_state_id: $END
      - action_id: go_b
        action_desc: fallback to B
        condition: { default: true }
        next_state_id: B

  - state_id: B
    state_desc: router B
    is_epsilon: true
    actions:
      - action_id: go_end2
        action_desc: try end
        condition: { cmd: "./check.sh" }
        next_state_id: $END
      - action_id: go_a
        action_desc: fallback to A
        condition: { default: true }
        next_state_id: A

  - state_id: $END
    state_desc: done
```

This passes all parser validation:
- No self-loops (A->B, B->A, not A->A).
- Forward BFS reaches all states from `$START`.
- Reverse BFS reaches all states from `$END` (via the `cmd` edges).
- Last action of each epsilon state has `{default: true}`.

At runtime, if both `./check.sh` conditions return false, `chainEpsilon` enters the cycle A->B->A->B->... and burns through all 64 depth iterations before returning an error. The depth limit (Finding 1.1) prevents infinite looping, but the user gets a cryptic depth-exceeded error instead of a parse-time rejection.

**Classification**: **VULNERABLE** — epsilon cycles are not rejected at parse time. Runtime depth limit is the only safety net. A malicious or careless flow definition can trigger 64 subprocess spawns before failing.

### 1.3 `default:true` Enforcement on Last Epsilon Action — PROVEN

**Spec claim** (§D.3): Last action of every epsilon state must have `{default: true}`. Non-last actions must not. Non-epsilon states must not use `default:true`.

**Code** (`parser.ts:203`): `const isDefault = c.default === true` — strict equality.
**Code** (`parser.ts:215`): Epsilon + last + !default -> `ParseError`.
**Code** (`parser.ts:218`): Epsilon + !last + default -> `ParseError`.
**Code** (`parser.ts:222`): !epsilon + default -> `ParseError`.

**Pre**: `isEpsilon` and `isLast` flags correctly derived from state/action position.
**Post**: All three constraint branches are exhaustively covered.

**Classification**: **PROVEN** — the parser correctly enforces default:true placement rules with strict equality checks.

---

## 2. Rollback Correctness on Action Failure

### 2.1 executeAction Rollback of current_state_id — GUARDED

**Spec claim** (§G.1): Snapshot `current_state_id` before advance; rollback on epsilon chain failure.

**Code** (`engine.ts:259`): `const snapshotStateId = runtime.current_state_id;`
**Code** (`engine.ts:268`): `runtime.current_state_id = action.next_state_id;` (advance)
**Code** (`engine.ts:286`): `runtime.current_state_id = snapshotStateId;` (rollback on `!epsilonResult.ok`)

**Pre**: `snapshotStateId` captured before any mutation.
**Post**: On failure, `runtime.current_state_id` is restored to pre-action value.

**Note**: The rollback does NOT undo `runtime.current_state_id` mutations made inside `chainEpsilon` during its loop iterations (line 349). However, the final assignment at line 286 overwrites whatever `chainEpsilon` left behind, so the end state is correct.

**Classification**: **GUARDED** — rollback restores the correct state. Intermediate mutations during `chainEpsilon` are invisible to callers since the snapshot overwrite is unconditional.

### 2.2 enterStart Rollback — GUARDED

**Spec claim** (§G.3): Same snapshot+rollback pattern for initial epsilon chain from `$START`.

**Code** (`engine.ts:363`): `const snapshot = runtime.current_state_id;`
**Code** (`engine.ts:368`): Rollback: `runtime.current_state_id = snapshot;`

**Classification**: **GUARDED** — identical pattern to executeAction, correctly implemented.

### 2.3 actionCall Persistence Guard — PROVEN

**Spec claim** (§H.1): Failure = no disk write.

**Code** (`index.ts:243`): `if (result.success) { await persistRuntime(sessionDir, rt); }`

**Pre**: `executeAction` returns `success: false` with rolled-back `current_state_id`.
**Post**: No `persistRuntime` call on failure path. Disk state unchanged.

**Classification**: **PROVEN** — failure path provably skips all persistence.

### 2.4 loadAndPush Rollback on enterStart Failure — GUARDED

**Spec claim** (§C): Any failure after push triggers `popFsm` rollback.

**Code** (`index.ts:160`): `await pushFsm(sessionDir, fsmId);` — push happens after file writes.
**Code** (`index.ts:179-184`): Exception in `enterStart` -> `await popFsm(sessionDir)`.
**Code** (`index.ts:188-194`): `!entry.success` -> `await popFsm(sessionDir)`.

**Pre**: FSM is on stack after line 160.
**Post**: Both failure paths call `popFsm`, which removes the FSM from the stack and deletes its directory.

**Classification**: **GUARDED** — rollback is complete for both failure modes.

### 2.5 loadAndPush: pushFsm Failure Leaves Orphan Files — LEAK

**Spec claim** (§C): Implicit expectation that failed loads leave no artifacts.

**Code** (`index.ts:157-160`):
```typescript
await writeFsmStructure(sessionDir, fsmId, ...);
await writeState(sessionDir, fsmId, "$START", []);
await writeTape(sessionDir, fsmId, {});
await pushFsm(sessionDir, fsmId);  // if this throws...
```

**Invariant violated**: If `pushFsm` throws (e.g., disk full on `stack.json` write), three files (`fsm.json`, `state.json`, `tape.json`) remain in the FSM directory with no cleanup path. The `try/catch` at line 173 only wraps `enterStart`, not the file-write + push sequence.

**Counterexample**: Disk becomes full after `writeTape` succeeds but before `pushFsm` completes its `atomicWriteJson`. The FSM directory exists with valid files but is not on the stack — invisible to all operations, never cleaned up.

**Classification**: **LEAK** — orphan files accumulate on repeated push failures. Not a state-machine correctness violation (the FSM is never activated), but a resource leak that violates cleanup expectations.

---

## 3. BFS Reachability Validation Completeness

### 3.1 Structural Reachability — PROVEN

**Spec claim** (§D.3): Forward BFS from `$START` + reverse BFS from `$END`; dead-end detection.

**Code** (`parser.ts:289-303`): Forward BFS enqueues all `action.next_state_id` targets. Checks `$END` in `fwdVisited`.
**Code** (`parser.ts:307-336`): Reverse adjacency from all actions. Reverse BFS from `$END`. Dead-end = `fwdVisited \ revVisited \ {$END}`.

**Pre**: All state references validated to exist in `stateMap` (line 280).
**Post**: Every state reachable from `$START` can also reach `$END` via some path.

**Classification**: **PROVEN** — structural graph connectivity is correctly validated.

### 3.2 Semantic Reachability (Condition-Aware) — PARTIAL

**Spec**: Not explicitly claimed, but implied by "no deadlocks" guarantee.

**Code**: BFS traverses ALL edges unconditionally. No condition evaluation at parse time.

**Invariant gap**: A state reachable only through conditions that always evaluate to `false` at runtime passes BFS validation but is unreachable in practice.

**Counterexample**: State `X` is only reachable via an action whose condition is `{ cmd: "false" }` (always fails). BFS marks `X` as reachable. At runtime, `X` is never entered. If `X` is the only path to `$END` from some other state, that state becomes a runtime dead-end despite passing static validation.

**Classification**: **PARTIAL** — this is an inherent limitation of static analysis (condition evaluation requires runtime context). The spec's "no deadlocks" guarantee (§G.2) is conditional on the `default:true` fallback mechanism, not on semantic reachability. Documented as a known limitation rather than a defect.

---

## 4. State Transition Atomicity

### 4.1 Tape-First Write Order — GUARDED

**Spec claim** (§H.2): Write tape first, then state. Crash between = pre-transition world.

**Code** (`index.ts:110-111`):
```typescript
await writeTape(sessionDir, rt.fsm_id, rt.tape);
await writeState(sessionDir, rt.fsm_id, rt.current_state_id, rt.transition_log);
```

**Pre**: Both writes use `atomicWriteJson` (tmp + rename, POSIX atomic per-file).
**Post**: If crash occurs after tape write but before state write, `state.json` still has the old `current_state_id`. On reload, the FSM sees pre-transition state with potentially updated tape data.

**Invariant**: `state.json` is the commit marker. Tape data may be ahead of state, but never behind.

**Classification**: **GUARDED** — at-least-once semantics are correctly implemented. Tape may contain data from a "future" transition, but the FSM re-executes the transition on retry, which is idempotent for condition evaluation.

### 4.2 No Cross-File Transaction — PARTIAL

**Spec claim** (§H.2): Acknowledged as "at-least-once retry" semantics.

**Invariant**: There is no atomic transaction spanning `tape.json` + `state.json` + `stack.json`. Each is individually atomic (tmp+rename) but not collectively.

**Scenario**: `persistRuntime` writes tape successfully, then the process crashes before writing state. On restart, tape has new data but state points to old `current_state_id`. The condition that was already satisfied may be re-evaluated with the updated tape, potentially producing a different result.

**Classification**: **PARTIAL** — the spec explicitly acknowledges this limitation and accepts at-least-once semantics. Not a defect against the spec, but a real consistency gap for condition scripts with side effects.

### 4.3 In-Memory Mutation Window During chainEpsilon — GUARDED

**Code** (`engine.ts:349`): `runtime.current_state_id = matched.next_state_id;` inside the loop.

Between the advance at line 349 and either the next iteration or the rollback at `executeAction:286`, `runtime.current_state_id` holds an intermediate value. However:
- All operations are wrapped in `withSessionLock` (`index.ts:375,399`), so no concurrent reader can observe the intermediate state via the same session.
- The runtime object is local to the `actionCall`/`loadAndPush` function — no external reference exists.

**Classification**: **GUARDED** — in-memory mutations are invisible to external observers due to session locking and local scoping.

---

## 5. Tape Mutation Consistency

### 5.1 External Tape Mutation by Condition Scripts — PARTIAL

**Spec claim** (§G.1, §H.1): Condition scripts receive `${$TAPE_FILE}` and may mutate tape.

**Code** (`index.ts:177`): After `enterStart`: `rt.tape = await readTape(sessionDir, fsmId);`
**Code** (`index.ts:237`): After `executeAction`: `rt.tape = await readTape(sessionDir, fsmId);`

**Invariant**: In-memory tape is re-synced from disk after any operation that may have spawned condition scripts.

**Gap**: During `chainEpsilon`, multiple condition scripts run sequentially (engine.ts:330). Each script receives the same `tapePath` and can read/write `tape.json`. Script N+1 sees mutations from script N (they share the file). But the engine does NOT re-read tape between condition evaluations — it only passes the file path. This means:
- Condition scripts CAN see each other's tape mutations (via the shared file) — this is correct.
- The in-memory `runtime.tape` is stale during the entire epsilon chain — but it's re-synced afterward, so the final state is correct.

**Counterexample for concern**: If a condition script writes tape AND the engine needed to use in-memory tape for some decision, the stale in-memory copy would be wrong. Currently the engine never reads `runtime.tape` during condition evaluation (it passes the file path), so this is not exploitable.

**Classification**: **PARTIAL** — correct by accident of current implementation. If engine.ts ever starts reading `runtime.tape` during condition evaluation, this becomes a bug. No structural guarantee prevents this regression.

### 5.2 saveCall Tape Mutation Without State Guard — SAFE (by design)

**Code** (`index.ts:264-283`): `saveCall` reads tape, modifies it, writes it back. No check on current FSM state.

**Spec**: The tape is explicitly designed as a shared scratchpad accessible at any time. No state-dependent write restrictions are specified.

**Classification**: **SAFE** — matches spec intent. The tape is state-independent storage.

### 5.3 Tape Size Limits — PROVEN

**Code** (`index.ts:270`): `Buffer.byteLength(value, "utf-8") > MAX_TAPE_VALUE_BYTES` (64KB per value).
**Code** (`index.ts:278`): `Object.keys(tape).length >= MAX_TAPE_KEYS` (1024 keys max).

**Classification**: **PROVEN** — both limits are enforced before mutation.

---

## 6. FSM Stack Push/Pop Correctness

### 6.1 Push/Pop Serialization via withSessionLock — GUARDED

**Spec claim** (§E.4, §N): All RMW operations serialized per session via `withSessionLock`.

**Code** (`index.ts:375`): `loadAndPush` (contains `pushFsm`) wrapped in `withSessionLock`.
**Code** (`index.ts:399`): `actionCall` (contains `popFsm` on `reached_end`) wrapped in `withSessionLock`.
**Code** (`index.ts:426`): `saveCall` wrapped in `withSessionLock`.
**Code** (`storage.ts:107-112`): `pushFsm` = `readStack` -> `push` -> `writeStack` (non-atomic RMW, relies on external lock).
**Code** (`storage.ts:114-126`): `popFsm` = `readStack` -> `pop` -> `writeStack` -> `rm` (non-atomic RMW, relies on external lock).

**Pre**: All callers hold `withSessionLock` before invoking push/pop.
**Post**: No concurrent stack modification is possible within the same process.

**Classification**: **GUARDED** — correct under single-process assumption. The spec (§N) explicitly notes no cross-process protection.

### 6.2 popFsm Irreversibility — VULNERABLE

**Spec claim** (§E.4): `popFsm` removes FSM from stack and deletes its directory.

**Code** (`storage.ts:118-125`):
```typescript
const top = stack.pop();
await writeStack(sessionDir, stack);
if (top) {
    try {
        await fs.rm(fsmDir(sessionDir, top), { recursive: true, force: true });
    } catch { /* Leave orphan on rm error; not fatal */ }
}
return top;
```

**Invariant violated**: Once `popFsm` completes, the FSM's entire state (structure, state, tape) is permanently deleted. If any operation after `popFsm` fails, there is no way to recover the popped FSM.

**Counterexample**: In `actionCall` (`index.ts:250`), after a successful transition reaches `$END`:
```typescript
if (result.reached_end) {
    await popFsm(sessionDir);  // FSM directory deleted
    const remaining = await readStack(sessionDir);  // if this throws...
    // ... the FSM is already gone, but the user never sees the completion message
}
```
If `readStack` throws after `popFsm` succeeds, the FSM is deleted but the user receives an error instead of the completion message. The FSM cannot be recovered. This is a minor issue since `readStack` failure is unlikely (it just reads a file that was just written), but the invariant is technically violated.

More significantly, in `loadAndPush` (`index.ts:200-207`):
```typescript
await persistRuntime(sessionDir, rt);  // writes tape + state
if (entry.reached_end) {
    await popFsm(sessionDir);  // deletes the directory we just persisted to
}
```
The `persistRuntime` at line 197 writes to the FSM directory, then `popFsm` at line 200 deletes that same directory. The persist is wasted work. Not a correctness bug, but indicates the persist-then-delete sequence is not optimized.

**Classification**: **VULNERABLE** — `popFsm` is a destructive, irreversible operation with no compensating transaction. Post-pop failures leave the system in an unrecoverable state where the FSM is gone but downstream operations may not have completed.

### 6.3 Stack Integrity on Concurrent Sessions — GUARDED

**Code** (`storage.ts:60-80`): `withSessionLock` uses a per-key `Map<string, Promise>` to serialize operations within the same session.

**Pre**: Different sessions have independent directories and lock keys.
**Post**: No cross-session interference possible.

**Classification**: **GUARDED** — session isolation is correctly maintained.

---

## Summary Table

| # | Finding | Location | Classification |
|---|---------|----------|----------------|
| 1.1 | Epsilon depth limit (64) correctly enforced | engine.ts:5,321 | GUARDED |
| 1.2 | Mutual epsilon cycles pass parser validation | parser.ts:138,289-336 | VULNERABLE |
| 1.3 | `default:true` placement rules exhaustive | parser.ts:203,215-222 | PROVEN |
| 2.1 | executeAction rollback of current_state_id | engine.ts:259,268,286 | GUARDED |
| 2.2 | enterStart rollback | engine.ts:363,368 | GUARDED |
| 2.3 | actionCall persistence guard (no write on failure) | index.ts:243 | PROVEN |
| 2.4 | loadAndPush rollback via popFsm | index.ts:160,179-194 | GUARDED |
| 2.5 | pushFsm failure leaves orphan files | index.ts:157-160 | LEAK |
| 3.1 | Structural BFS reachability | parser.ts:289-336 | PROVEN |
| 3.2 | Semantic (condition-aware) reachability | parser.ts:289-336 | PARTIAL |
| 4.1 | Tape-first write order | index.ts:110-111 | GUARDED |
| 4.2 | No cross-file transaction | index.ts:110-111 | PARTIAL |
| 4.3 | In-memory mutation window during chainEpsilon | engine.ts:349 | GUARDED |
| 5.1 | External tape mutation by condition scripts | index.ts:177,237 | PARTIAL |
| 5.2 | saveCall tape mutation without state guard | index.ts:264-283 | SAFE |
| 5.3 | Tape size limits | index.ts:270,278 | PROVEN |
| 6.1 | Push/pop serialization via withSessionLock | index.ts:375,399; storage.ts:107-126 | GUARDED |
| 6.2 | popFsm irreversibility | storage.ts:118-125; index.ts:250 | VULNERABLE |
| 6.3 | Stack integrity on concurrent sessions | storage.ts:60-80 | GUARDED |

## Verdicts by Dimension

| Dimension | Verdict | Key Risk |
|-----------|---------|----------|
| 1. Epsilon chain termination | GUARDED (runtime) / VULNERABLE (static) | Mutual epsilon cycles not rejected at parse time; runtime depth limit is sole safety net |
| 2. Rollback correctness | GUARDED | All rollback paths verified; minor LEAK on pushFsm failure |
| 3. BFS reachability | PROVEN (structural) / PARTIAL (semantic) | Condition semantics not modeled — inherent static analysis limitation |
| 4. State transition atomicity | GUARDED | Tape-first ordering correct; no cross-file transaction (accepted by spec) |
| 5. Tape mutation consistency | PARTIAL | Correct by implementation accident; no structural guarantee against regression |
| 6. FSM stack push/pop | GUARDED / VULNERABLE | popFsm is irreversible; post-pop failures are unrecoverable |

## Recommended Mitigations

1. **Finding 1.2 (VULNERABLE)**: Add epsilon-subgraph cycle detection in `buildFSM` after BFS. A simple DFS on the epsilon-only subgraph (edges where source `is_epsilon`) detecting back-edges would reject mutual cycles at parse time. Cost: ~20 lines in parser.ts.

2. **Finding 2.5 (LEAK)**: Wrap the file-write + pushFsm sequence in a try/catch that cleans up the FSM directory on pushFsm failure. Alternatively, write files after push (push an empty slot, then populate).

3. **Finding 6.2 (VULNERABLE)**: Consider a two-phase pop: (1) mark FSM as "popping" in stack metadata, (2) delete directory, (3) finalize stack. On recovery, incomplete pops can be detected and completed. Alternatively, defer directory deletion to a background sweep rather than inline with pop.
