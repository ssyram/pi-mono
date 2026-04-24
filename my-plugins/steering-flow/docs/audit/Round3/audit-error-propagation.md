# Audit: Error Propagation

**Dimension**: ERROR PROPAGATION  
**Spec**: `docs/execution-behavior.md`  
**Auditor**: Sisyphus  
**Date**: 2025-04-23  

---

## Finding EP-01: Silent swallowing of all errors in `agent_end` outer catch

**Location**: `index.ts:723` — bare `} catch {` with empty body  
**Classification**: **VULNERABLE**

**Invariant violated**: Spec Section M claims stop-hook errors are swallowed intentionally ("hooks can't crash"). However, the spec also claims (Section M, row "Stop hook CorruptedStateError") that CorruptedStateError is surfaced via `ctx.ui.notify`. This is only true for errors thrown by `readStack` (line 654–660) and `loadRuntime` (line 667–673), which have dedicated inner try/catch blocks. Errors from `readState` (line 683), `writeState` (lines 697, 703), `renderStateView` (line 706), and `pi.sendUserMessage` (line 715) are NOT individually caught — they fall through to the bare `catch {}` at line 723 and vanish.

**Counterexample**: `state.json` is corrupted (contains `"hello"` instead of a JSON object). The `readState` call at line 683 returns `"hello"` (no shape validation — see EP-02). Subsequent property access `stateFile.last_reminder_hash` on a string throws `TypeError`. This TypeError is silently swallowed at line 723. The stagnation-tracking mechanism silently stops functioning — no notification, no log, no re-prompt. The LLM exits mid-flow.

**Pre-condition**: Flow is active, `agent_end` fires, `state.json` is corrupted or disk is full.  
**Expected post-condition (spec)**: CorruptedStateError surfaced via `ctx.ui.notify`.  
**Actual post-condition**: Error silently swallowed. Flow enforcement ceases with no signal.

---

## Finding EP-02: `readState` has zero shape validation

**Location**: `storage.ts:233–234`  
**Classification**: **VULNERABLE**

**Invariant violated**: Spec Section O ("运行时不变量") assumes `state.json` always deserializes to a valid `StateFile` with `current_state_id`, `entered_at`, `last_transition_chain`. The code applies no runtime shape check — `readJsonStrict<StateFile>` is a bare `JSON.parse` with a type assertion, not a runtime guard.

**Counterexample**: User or external process writes `42` to `state.json`. `readJsonStrict` parses it successfully (valid JSON), returns `42` typed as `StateFile`. In `loadRuntime` (storage.ts:256), `state?.current_state_id` evaluates to `undefined` (number has no such property), so `current_state_id` silently defaults to `"$START"` (storage.ts:264). The FSM resets to `$START` with no error signal — all transition history is lost.

**Contrast with peers**: `readTape` (storage.ts:238–241) validates top-level is object. `readFsmStructure` (storage.ts:203–206) validates `data.states` exists. `readState` is the only reader with zero shape validation.

**Pre-condition**: `state.json` contains valid JSON that is not a `StateFile`-shaped object.  
**Expected post-condition**: CorruptedStateError thrown (consistent with `readTape`/`readFsmStructure`).  
**Actual post-condition**: Silent FSM reset to `$START`.

---

## Finding EP-03: Permission-denied errors not wrapped in CorruptedStateError

**Location**: `storage.ts:49–51` — `readJsonStrict` catch block  
**Classification**: **VULNERABLE**

**Invariant violated**: Spec Section M ("错误传播矩阵") claims tool-level CorruptedStateError produces a recovery-tip message via `friendlyError`. But `readJsonStrict` only wraps JSON parse failures in `CorruptedStateError`. EACCES, EPERM, EIO errors from `fs.readFile` are re-thrown as raw Node `SystemError` objects. `friendlyError` (index.ts:349–354) does not recognize these — they get the generic `e.message` branch, which omits the `.pi/steering-flow/<session>/` cleanup suggestion.

**Counterexample**: `chmod 000 .pi/steering-flow/<session>/<fsmId>/state.json`. Any operation reading state gets a raw `EACCES: permission denied` error. The user sees a generic error message with no recovery guidance, unlike the CorruptedStateError path which suggests manual cleanup.

**Pre-condition**: File exists but is not readable (EACCES/EPERM).  
**Expected post-condition**: Error surfaced with actionable recovery guidance.  
**Actual post-condition**: Raw system error message, no recovery tip.

---

## Finding EP-04: `readStack` silently drops non-string entries

**Location**: `storage.ts:92` — `.filter((x) => typeof x === "string")`  
**Classification**: **LEAK**

**Invariant violated**: Spec Section O assumes stack integrity. If `stack.json` contains `["fsm-1", null, "fsm-2"]`, the `null` entry is silently filtered out. The stack shrinks from 3 to 2 entries with no error signal. Subsequent `writeStack` calls persist the filtered (shorter) stack, permanently losing the corrupted entry.

**Counterexample**: Crash during `pushFsm` leaves a partially-written `stack.json` that a lenient JSON parser recovers as `["fsm-1", null]`. The `null` is silently dropped. `topFsmId` returns `"fsm-1"` instead of the intended new FSM. The new FSM's directory exists on disk but is orphaned — invisible to `info`, `pop`, or cleanup.

**Pre-condition**: `stack.json` contains non-string array elements.  
**Expected post-condition**: CorruptedStateError (consistent with the non-array check on line 91).  
**Actual post-condition**: Silent data loss, potential orphan FSM directories.

---

## Finding EP-05: `actionCall` readTape failure after successful executeAction loses transition

**Location**: `index.ts:237` — `rt.tape = await readTape(sessionDir, fsmId)`  
**Classification**: **VULNERABLE**

**Invariant violated**: Spec Section H1 claims "只在成功时持久化" (persist only on success). The implicit assumption is that a successful `executeAction` followed by `persistRuntime` is atomic. But `readTape` at line 237 sits between `executeAction` (line 235) and the `persistRuntime` call (line 244). If `readTape` throws (corrupted `tape.json`, EACCES), the successful transition is never persisted.

**Counterexample**: A condition script writes malformed JSON to `tape.json` (e.g., truncated write). `executeAction` succeeds (condition passed, `runtime.current_state_id` advanced in memory). `readTape` throws `CorruptedStateError`. The error propagates to the tool's outer catch (line 462). `persistRuntime` is never called. On next load, `state.json` still has the old state — the transition is lost. The LLM is told the action failed, but the condition script's side effects (external API calls, file writes) already executed.

**Pre-condition**: Condition script corrupts `tape.json` during execution.  
**Expected post-condition**: Transition persisted (executeAction succeeded) or clean rollback.  
**Actual post-condition**: In-memory state advanced, disk state stale, side effects committed. Inconsistent.

---

## Finding EP-06: Unguarded setup writes in `loadAndPush` leave orphan artifacts

**Location**: `index.ts:148–153` — `writeFsmStructure`, `writeState`, `writeTape`, `pushFsm` with no try/catch  
**Classification**: **VULNERABLE**

**Invariant violated**: Spec Section O claims "Failed load: stack 不变（已回滚）；FSM 目录已删" (stack unchanged, FSM dir deleted). This is true for `enterStart`/`readTape` failures (lines 166–178 have try/catch + `popFsm`). But the four setup writes at lines 148–153 have no try/catch. If `writeFsmStructure` succeeds but `writeState` throws (disk full), an orphan FSM directory with partial files remains on disk. `pushFsm` was never called, so the stack is clean, but the orphan directory is never cleaned up.

**Counterexample**: Disk fills up after `writeFsmStructure` writes `fsm.json`. `writeState` fails with `ENOSPC`. The error propagates to the tool's outer catch. The FSM directory exists with `fsm.json` but no `state.json` or `tape.json`. It is not on the stack, so `info` and `pop` don't see it. `sweepTmpFiles` only cleans `.tmp.*` files, not orphan directories.

**Pre-condition**: Disk full or permission error during any of the four setup writes.  
**Expected post-condition (spec)**: FSM dir deleted, stack unchanged.  
**Actual post-condition**: Orphan directory persists indefinitely.

---

## Finding EP-07: `writeState` with `preserve_entered_at` can throw CorruptedStateError during a write path

**Location**: `storage.ts:220–222` — `readState` called inside `writeState`  
**Classification**: **VULNERABLE**

**Invariant violated**: Write operations should not fail due to read-path corruption. `writeState` with `preserve_entered_at: true` calls `readState` (line 221) to retrieve the existing `entered_at` timestamp. If `state.json` is corrupted (invalid JSON), `readJsonStrict` throws `CorruptedStateError`. The write never completes.

**Counterexample**: In the `agent_end` handler, `writeState` is called at lines 697 and 703 with `preserve_entered_at: true`. If `state.json` was corrupted by a prior crash, the stagnation-tracking write fails with `CorruptedStateError`. This error falls through to the bare `catch {}` at line 723 — silently swallowed (see EP-01). The flow's stagnation counter is never updated, and the reminder mechanism silently breaks.

**Pre-condition**: `state.json` corrupted, `agent_end` fires with `preserve_entered_at: true`.  
**Expected post-condition**: Write succeeds (overwriting corrupted file) or error surfaced.  
**Actual post-condition**: Write fails silently. Stagnation tracking permanently broken for this FSM.

---

## Finding EP-08: `killTree` double-catch silently swallows process cleanup errors

**Location**: `engine.ts:108–115`  
**Classification**: **PARTIAL**

**Invariant violated**: Spec Section F describes process group kill as the cleanup mechanism for timed-out or capped conditions. `killTree` has two nested try/catch blocks — the outer catches failure of `process.kill(-child.pid, "SIGKILL")` (process group kill), the inner catches failure of `child.kill("SIGKILL")` (direct kill fallback). Both catch blocks are empty.

**Counterexample**: Condition process spawns a child that acquires a file lock on `tape.json`. The condition times out. `killTree` fails to kill the process group (ESRCH — race with natural exit). The fallback `child.kill` also fails. The grandchild process continues holding the lock. Subsequent `readTape`/`writeTape` calls may hang or fail with EBUSY on platforms with mandatory locking.

**Classification rationale**: PARTIAL — the settle-once pattern ensures the condition resolves with `ok:false` regardless of kill success. The vulnerability is limited to leaked child processes, not to the condition result itself.

---

## Finding EP-09: Non-zero exit code from condition command is ignored

**Location**: `engine.ts:150–170` — `child.on("close")` handler  
**Classification**: **VULNERABLE**

**Invariant violated**: Spec Section F defines the condition protocol as "first line of stdout is `true`/`false`". The implementation faithfully follows this — but exit code is purely informational. A condition process that crashes (segfault, exit code 139) but happened to flush `true\n` to stdout before crashing is accepted as `ok: true`.

**Counterexample**: A condition script writes `true` to stdout, then crashes with a segfault (exit code 139) during cleanup. `engine.ts:161` reads the first line as `"true"`, returns `ok: true`. The transition proceeds despite the condition process crashing. Any side effects the script intended to perform after writing `true` (e.g., updating tape, releasing resources) never completed.

**Pre-condition**: Condition process writes `true` then crashes.  
**Expected post-condition**: At minimum, a warning that the process exited abnormally.  
**Actual post-condition**: Silent acceptance. Exit code only appears in the malformed-output diagnostic branch (line 165), never in the success path.

---

## Finding EP-10: `is_epsilon` truthy coercion accepts semantically wrong values

**Location**: `parser.ts:94` — `const is_epsilon = !!s.is_epsilon`  
**Classification**: **VULNERABLE**

**Invariant violated**: `is_epsilon` is a boolean semantic flag. The parser coerces any truthy value to `true` via `!!`. The custom YAML parser (`parseScalar`) converts the string `"no"` to the string `"no"` (not `false`), and `!!"no"` is `true`.

**Counterexample**: Flow YAML contains `is_epsilon: no` (without YAML boolean parsing for bare `no`). The custom `parseScalar` (parser.ts:~340) handles `true`/`false`/`null` but does NOT handle `yes`/`no`/`on`/`off` as YAML booleans. `"no"` is returned as the string `"no"`. `!!"no"` evaluates to `true`. The state is silently marked as epsilon. Its actions are evaluated automatically during epsilon chaining instead of being presented to the LLM as choices. The flow author intended the opposite.

**Pre-condition**: Flow YAML uses `is_epsilon: no` or `is_epsilon: off`.  
**Expected post-condition**: `is_epsilon` is `false`.  
**Actual post-condition**: `is_epsilon` is `true`. State behavior inverted.

---

## Finding EP-11: Extra/unknown keys in flow config silently ignored

**Location**: `parser.ts:54–72` (validateFlowConfig), `parser.ts:75–114` (validateState), `parser.ts:117–175` (validateAction), `parser.ts:180–254` (validateCondition)  
**Classification**: **LEAK**

**Invariant violated**: No validation function checks for unexpected keys. The parser destructures known fields and ignores everything else.

**Counterexample**: A flow author writes `{ state_id: "X", state_desc: "...", is_epslon: true, actions: [...] }` (typo: `is_epslon` instead of `is_epsilon`). `s.is_epsilon` is `undefined`, `!!undefined` is `false`. The state is treated as non-epsilon when the author intended epsilon. No ParseError is raised. The typo is invisible — the flow compiles and runs with silently inverted behavior.

Note: typos in required fields (`state_id`, `action_id`, `condition`) ARE caught because their absence triggers validation errors. Only optional/defaulted fields (`is_epsilon`, `args`, `arg_desc`) are vulnerable.

**Pre-condition**: Typo in any optional field name.  
**Expected post-condition**: ParseError for unknown key.  
**Actual post-condition**: Silent default behavior. Potentially inverted semantics.

---

## Finding EP-12: `loadRuntime` silently resets FSM to `$START` on missing `state.json`

**Location**: `storage.ts:264` — `state?.current_state_id ?? "$START"`  
**Classification**: **LEAK**

**Invariant violated**: Spec Section O assumes state persistence integrity. If `state.json` is deleted (manual intervention, `fs.rm` race, disk error), `readState` returns `undefined` (ENOENT path). `loadRuntime` silently defaults `current_state_id` to `"$START"` and `transition_log` to `[]`. The FSM appears to have just started — all progress is lost with no error signal.

**Counterexample**: User accidentally deletes `state.json` while the flow is at state `REVIEW`. Next `agent_end` or tool call loads the runtime, gets `current_state_id: "$START"`. The LLM is told the flow is at `$START` and re-executes the entire flow from scratch. No warning that state was lost.

**Pre-condition**: `state.json` deleted while `fsm.json` and `tape.json` exist.  
**Expected post-condition**: Error indicating state file missing (distinguishable from fresh start).  
**Actual post-condition**: Silent reset. Indistinguishable from a newly loaded flow.

---

## Finding EP-13: Epsilon chain failure discards successful first-hop transition record

**Location**: `engine.ts:268–276`  
**Classification**: **LEAK**

**Invariant violated**: Spec Section O claims "Failed action: state.json 不变, runtime.current_state_id 已回滚" (state unchanged, current_state_id rolled back). The rollback is correct — `current_state_id` is restored to `snapshotStateId`. However, the return at line 275 sets `chain: []`, discarding the record of the successful first hop that was rolled back. The caller (and the LLM) receives no information about which transition succeeded before the epsilon chain failed.

**Counterexample**: Action `submit` transitions from `DRAFT` to epsilon state `VALIDATE` (succeeds). `VALIDATE` has two epsilon actions; both conditions fail. `executeAction` rolls back to `DRAFT` and returns `chain: []`. The LLM sees "transition failed" with no detail about which epsilon condition failed or why. Debugging the flow requires reading condition script logs externally.

**Pre-condition**: First-hop transition succeeds, subsequent epsilon chain fails.  
**Expected post-condition**: Chain includes the successful hop + failure reasons for diagnostic purposes.  
**Actual post-condition**: Empty chain. Diagnostic information lost.

---

## Finding EP-14: Condition timeout reason omits captured stderr

**Location**: `engine.ts:121–123` — timeout settle call  
**Classification**: **PARTIAL**

**Invariant violated**: When a condition times out, `settle` is called with `ok: false` and reason `"timed out after 30000ms"`. Any stderr output captured before the timeout (which may contain the root cause — e.g., connection timeout messages, stack traces) is discarded. The `reason` field in the settle call is a hardcoded string, not composed from the stderr buffer.

**Counterexample**: Condition script attempts an HTTP request that hangs. It writes `"Connection to api.example.com timed out"` to stderr before the 30s engine timeout fires. The settle reason is `"timed out after 30000ms"` — the stderr diagnostic is lost.

**Pre-condition**: Condition process writes to stderr before timing out.  
**Expected post-condition**: Timeout reason includes captured stderr for diagnostics.  
**Actual post-condition**: Generic timeout message only.

---

## Finding EP-15: `popFsm` in `loadAndPush` catch can itself throw, masking original error

**Location**: `index.ts:173–178` — catch block calls `await popFsm(sessionDir)`  
**Classification**: **PARTIAL**

**Invariant violated**: The catch block at line 173 is meant to roll back a failed `enterStart`/`readTape`. It calls `popFsm`, which calls `readStack` → `readJsonStrict`. If `stack.json` is also corrupted, `popFsm` throws `CorruptedStateError`, which replaces the original error. The caller sees a stack corruption error instead of the actual `enterStart` failure.

**Counterexample**: `enterStart` fails because a condition script is missing (ENOENT from spawn). The catch block calls `popFsm`. `stack.json` was corrupted by a concurrent write race. `popFsm` throws `CorruptedStateError`. The tool's outer catch reports "corrupted state: stack.json" — the user has no idea that the actual problem was a missing condition script.

**Pre-condition**: `enterStart` fails AND `stack.json` is corrupted.  
**Expected post-condition**: Original error preserved; rollback failure reported separately.  
**Actual post-condition**: Original error masked by rollback failure.

---

## Summary Table

| ID | Location | Classification | Focus Area |
|----|----------|---------------|------------|
| EP-01 | index.ts:723 | VULNERABLE | Silent error swallowing in stop hook |
| EP-02 | storage.ts:233 | VULNERABLE | Storage read — no shape validation |
| EP-03 | storage.ts:49–51 | VULNERABLE | Storage read — EACCES not wrapped |
| EP-04 | storage.ts:92 | LEAK | Storage read — silent data loss |
| EP-05 | index.ts:237 | VULNERABLE | Tool error → result propagation gap |
| EP-06 | index.ts:148–153 | VULNERABLE | Storage write — orphan artifacts |
| EP-07 | storage.ts:220–222 | VULNERABLE | CorruptedStateError in write path |
| EP-08 | engine.ts:108–115 | PARTIAL | Process cleanup swallowed |
| EP-09 | engine.ts:150–170 | VULNERABLE | Condition exit code ignored |
| EP-10 | parser.ts:94 | VULNERABLE | Parser validation — truthy coercion |
| EP-11 | parser.ts:54–175 | LEAK | Parser validation — no unknown-key rejection |
| EP-12 | storage.ts:264 | LEAK | Storage read — silent state reset |
| EP-13 | engine.ts:268–276 | LEAK | Epsilon chain diagnostic loss |
| EP-14 | engine.ts:121–123 | PARTIAL | Condition timeout diagnostic loss |
| EP-15 | index.ts:173–178 | PARTIAL | Error masking in rollback path |

**VULNERABLE**: 7 — **LEAK**: 4 — **PARTIAL**: 3 — **SAFE/PROVEN**: 0
