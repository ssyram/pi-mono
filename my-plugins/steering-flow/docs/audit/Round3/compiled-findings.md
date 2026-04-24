# Round 3 Compiled Findings

**Scope**: 5 audit reports × filtered classification  
**Raw findings**: 33  
**True findings (this file)**: 25 (24 VULNERABLE/PARTIAL + 6 GUARDED)  
**Nits (see nits.md)**: 4  
**Excluded (intentional omission / no counterexample)**: 4  

---

## Classification Key

| Label | Meaning |
|---|---|
| VULNERABLE | Confirmed exploitable, fix required |
| PARTIAL | Fix partially applied, residual risk |
| GUARDED | Unreachable in current deployment context, document only |

---

## D1 — Regression Analysis

### D1-001 · VULNERABLE · Critical
**Source**: audit-regression-analysis.md  
**Origin**: NDA-05 regression  
**Title**: FSM stack leak when `writePendingPop` throws

`writePendingPop` is called inside the try block at index.ts:258. If it throws, the catch block returns early at line 270 — `popFsm` is never reached. The FSM directory is leaked on disk and the stack is left with a phantom entry.

**Counterexample**: `writePendingPop` throws ENOSPC → catch returns → `popFsm` skipped → FSM dir persists → stack count diverges from actual dirs.

**File**: `index.ts:258-270`  
**Runtime impact**: Reachable. Any disk-full or permission error on tmp write triggers this.

---

### D1-002 · VULNERABLE · Critical
**Source**: audit-regression-analysis.md  
**Origin**: NDA-06 regression  
**Title**: Silent rollback failure in epsilon chain leaves stack inconsistent

In the epsilon-chain catch block (index.ts:196-205), `popFsm` is called for rollback but its error is swallowed. If `popFsm` itself throws, the stack is left with a pushed-but-not-popped FSM entry and no signal is raised.

**Counterexample**: `popFsm` throws during rollback (e.g., FSM dir already deleted by concurrent sweep) → error swallowed → stack count +1 with no corresponding FSM dir.

**File**: `index.ts:196-205`  
**Runtime impact**: Reachable. Concurrent `session_start` sweep can delete FSM dirs.

---

### D1-003 · VULNERABLE · High
**Source**: audit-regression-analysis.md  
**Origin**: NDA-03 regression  
**Title**: Negative lookbehind `(?<!not\s)` bypassed by double space or tab

The regex `(?<!not\s)` only matches a single whitespace character. "not  confirmed" (double space) or "not\tconfirmed" (tab) bypasses the guard.

**Counterexample**: User types "not  confirmed" → lookbehind fails to match → condition treated as confirmed.

**File**: `builtins/self-check-basic.mjs:43`  
**Runtime impact**: Reachable. Normal prose typing produces double spaces.

---

### D1-004 · VULNERABLE · High
**Source**: audit-regression-analysis.md  
**Origin**: NDA-02 design flaw  
**Title**: Rubric checked with `text.includes()` causes substring false positives

`text.includes(rubric)` matches any rubric string that appears as a substring of a longer word. Short rubric tokens ("ok", "no", "yes") will match inside unrelated words.

**Counterexample**: Rubric token "ok" → matches "book", "cookbook", "looked" → false positive confirmation.

**File**: `builtins/self-check-basic.mjs:45`  
**Runtime impact**: Reachable. Any rubric with a short common token triggers this.

---

### D1-005 · PARTIAL · Medium
**Source**: audit-regression-analysis.md  
**Origin**: NDA-09 incomplete fix  
**Title**: Fallback `flow_dir` resolves to FSM storage dir, not YAML dir

When `flow_dir` is absent from state, the fallback resolves to the FSM storage directory. Migrated sessions that lack `flow_dir` in persisted state will fail to locate their YAML file.

**Counterexample**: Session created before NDA-09 fix, `flow_dir` absent → fallback resolves to FSM dir → YAML not found → load fails.

**File**: `storage.ts:279`  
**Runtime impact**: Reachable only for sessions migrated from pre-fix state. New sessions unaffected.

---

## D2 — Stop Hook

### D2-001 · VULNERABLE · High
**Source**: audit-stop-hook.md  
**Title**: `isAskingQuestion` trailing-`?` false positive via optional chaining

Optional chaining syntax (`obj?.prop`) ends in `?` and triggers the question-detection guard, causing a spurious stop.

**Counterexample**: AI response ends with `result?.value` → trailing `?` detected → stop hook fires → flow halted incorrectly.

**File**: `index.ts` (isAskingQuestion guard)  
**Runtime impact**: Reachable. LLM frequently emits optional chaining in code blocks.

---

### D2-002 · VULNERABLE · Medium
**Source**: audit-stop-hook.md  
**Title**: `isAskingQuestion` trailing-`?` false positive via URL query strings

A URL ending in `?param` or `?` triggers the question guard.

**Counterexample**: AI response ends with `https://example.com/api?` → trailing `?` → stop hook fires.

**File**: `index.ts` (isAskingQuestion guard)  
**Runtime impact**: Reachable. LLM commonly emits URLs in responses.

---

### D2-003 · VULNERABLE · Medium
**Source**: audit-stop-hook.md  
**Title**: `isAskingQuestion` trailing-`?` false positive via code block ending in `?`

A fenced code block whose last line ends in `?` (e.g., a ternary, regex, or query) triggers the guard.

**Counterexample**: Code block last line is `return val?` → trailing `?` → stop hook fires.

**File**: `index.ts` (isAskingQuestion guard)  
**Runtime impact**: Reachable. Common in TypeScript/SQL code blocks.

---

### D2-004 · VULNERABLE · High
**Source**: audit-stop-hook.md  
**Title**: `CONFIRM_STOP_TAG` `includes()` fires when tag appears in prose explanation

If the AI explains the stop tag in its response (e.g., "use `[[STOP]]` to terminate"), the `includes()` check fires and the flow stops prematurely.

**Counterexample**: AI writes "The tag `[[STOP]]` signals termination" → `includes()` matches → stop hook fires mid-explanation.

**File**: `index.ts` (CONFIRM_STOP_TAG guard)  
**Runtime impact**: Reachable. LLM instructed to explain its own protocol will trigger this.

---

### D2-005 · VULNERABLE · Medium
**Source**: audit-stop-hook.md  
**Title**: `stableStringify` treats `undefined` and `null` as identical hashes

Both `undefined` and `null` values serialize to the same output, producing hash collisions between states that differ only in null vs undefined fields.

**Counterexample**: State `{a: null}` and `{a: undefined}` produce identical hashes → stagnation guard fails to detect the transition.

**File**: `index.ts` (stableStringify)  
**Runtime impact**: Reachable but exposure limited by TypeScript type system. JSON round-trips drop undefined, reducing practical collision surface.

---

### D2-006 · GUARDED · Low
**Source**: audit-stop-hook.md  
**Title**: `stableStringify` hashes `Date` objects as `{}`

Date objects placed in tape serialize as empty objects, producing hash collisions for states differing only in Date values.

**Counterexample**: State `{ts: new Date("2024-01-01")}` and `{ts: new Date("2024-01-02")}` → both hash as `{ts: {}}` → stagnation guard blind to date changes.

**File**: `index.ts` (stableStringify)  
**Runtime impact**: GUARDED. Tape is populated via JSON I/O; `JSON.parse` never produces Date objects. Unreachable in current deployment.

---

### D2-007 · GUARDED · Low
**Source**: audit-stop-hook.md  
**Title**: `stableStringify` has no circular-reference guard — stack overflow risk

A circular object passed to `stableStringify` causes infinite recursion and a stack overflow.

**Counterexample**: `obj.a.self = obj` → `stableStringify(obj)` → stack overflow.

**File**: `index.ts` (stableStringify)  
**Runtime impact**: GUARDED. Tape is populated via JSON round-trips; JSON cannot represent circular references. Unreachable in current deployment.

---

### D2-009 · VULNERABLE · High
**Source**: audit-stop-hook.md  
**Title**: Compaction cooldown keyed by `sessionId` not `fsmId` — cross-FSM bleed in nested flows

The compaction cooldown map uses `sessionId` as key. In nested FSM sessions, FSM-B triggering compaction silences FSM-A's compaction for the full 60-second window.

**Counterexample**: Session with FSM-A and FSM-B; FSM-B compacts → cooldown set on sessionId → FSM-A's tape grows unbounded for 60s even if it independently needs compaction.

**File**: `index.ts` (compaction cooldown)  
**Runtime impact**: Reachable. Any nested flow with two active FSMs triggers this.

---

### D2-010 · VULNERABLE · Medium
**Source**: audit-stop-hook.md  
**Title**: Compaction guard checked outside session mutex — TOCTOU race

The compaction eligibility check (tape length, cooldown) happens before `withSessionLock` is acquired. A concurrent call can pass the same check and both proceed to compact.

**Counterexample**: Two parallel tool calls both read tape length > threshold before either acquires the lock → both compact → double compaction, potential tape corruption.

**File**: `index.ts` (compaction guard, outside mutex)  
**Runtime impact**: Reachable. pi framework issues parallel tool calls per turn.

---

### D2-011 · GUARDED · Low
**Source**: audit-stop-hook.md  
**Title**: `ctx.signal?.aborted` optional chaining masks missing signal

If `ctx.signal` is absent, the optional chain silently returns `undefined` (falsy). The secondary `wasAborted` guard provides partial coverage but only if `stopReason` was populated.

**Counterexample**: `ctx.signal` absent AND `stopReason` not set → abort goes undetected → flow continues past intended stop.

**File**: `index.ts` (abort guard)  
**Runtime impact**: GUARDED. Requires both signal absent AND stopReason unpopulated simultaneously. No known code path produces this combination.

---

## D3 — Visualizer

### D3-001 · VULNERABLE · Critical
**Source**: audit-visualizer.md  
**Title**: Arbitrary file write/read via unvalidated LLM-supplied paths

`resolveOutputPath` in `create-artifact.ts:16` uses absolute paths verbatim with no `cwd` containment check. LLM-supplied `output_file` or `flow_file` values can write to or read from arbitrary filesystem locations.

**Counterexample**: LLM supplies `output_file="/etc/cron.d/pwned"` → `writeFile` executes at that path. `flow_file="../../.ssh/authorized_keys"` → arbitrary file read.

**Files**: `create-artifact.ts:16,27`, `index.ts:469-473`  
**Runtime impact**: Reachable. LLM is untrusted per deployment-context threat model. Direct path traversal / arbitrary write vulnerability.

---

### D3-002 · VULNERABLE · High
**Source**: audit-visualizer.md  
**Title**: Post-condition violated: `outputPath` not constrained to cwd

`result.outputPath` can be an absolute path outside cwd, violating the documented cwd-containment post-condition on the artifact creation contract.

**Counterexample**: `outputFile="/tmp/evil.html"` → `result.outputPath="/tmp/evil.html"` → caller assumes cwd-relative path, invariant broken.

**Files**: `create-artifact.ts:16,43`, `types.ts:52-56`  
**Runtime impact**: Reachable. Same trigger as D3-001; this is the contract-level consequence.

---

### D3-003 · VULNERABLE · Medium
**Source**: audit-visualizer.md  
**Title**: CDN script loaded without SRI hash

`render-html.ts:35` loads d3 from jsDelivr with no `integrity` attribute. Major version pinned only; any patch auto-fetched.

**Counterexample**: CDN compromise or DNS poisoning → attacker-controlled JS executes in developer's `file://` context.

**File**: `render-html.ts:35`  
**Runtime impact**: Reachable. Visualizer output is opened in browser; CDN fetch happens at render time.

---

### D3-004 · VULNERABLE · Medium
**Source**: audit-visualizer.md  
**Title**: Missing `pts.length > 0` guard before `pts[0]` access

`label-layout.ts:200-214` accesses `pts[0]` without checking array length. Dagre returns `ed.points = []` for degenerate self-loops.

**Counterexample**: FSM with a self-loop transition → dagre returns empty points array → `pts[0].x` throws TypeError → `createVisualizerArtifact` throws, no HTML output.

**File**: `label-layout.ts:200-214`  
**Runtime impact**: Reachable. Self-loop transitions are valid FSM constructs.

---

### D3-005 · VULNERABLE · Medium
**Source**: audit-visualizer.md  
**Title**: Phantom-node invariant: edges to undeclared states crash render

`label-layout.ts:170-176` calls `setEdge` with `nextStateId` values not declared as nodes. `render-html.ts:436` then accesses `nodePos[e.tgtId]` which is `undefined`.

**Counterexample**: FSM uses `$END` in an action but `$END` is not declared as a state → dagre phantom node → `nodePos["$END"] = undefined` → `tgt.x` throws in browser render loop.

**Files**: `label-layout.ts:170-176`, `render-html.ts:436`  
**Runtime impact**: Reachable. `$END` and other implicit terminal states are common FSM patterns.

---

### D3-006 · GUARDED · Low
**Source**: audit-visualizer.md  
**Title**: O(iterations × n²) repulsion loop — blocking on large graphs

`label-layout.ts:52-100` runs 80 outer iterations × n*(n-1)/2 pairs. At 1000 transitions this is ~40M float comparisons (~400ms blocking on MCP server thread).

**Counterexample**: FSM with 1000 transitions → ~400ms block.

**File**: `label-layout.ts:52-100`  
**Runtime impact**: GUARDED. Only triggers at >300 edges. Typical FSMs are well below this threshold. No crash risk; bounded performance degradation only.

---

### D3-007 · VULNERABLE · Low
**Source**: audit-visualizer.md  
**Title**: Silent drop of FSM load failures in multi-FSM visualization

`document.ts:40` uses `if (!runtime) continue` with no log or warning. Failed FSM loads are silently skipped.

**Counterexample**: 4-FSM session, FSM#2 corrupted → visualization shows 3 FSMs with no indication FSM#2 was skipped.

**File**: `document.ts:40`  
**Runtime impact**: Reachable. Any corrupted FSM dir (e.g., from D1-001 leak) triggers this.

---

### D3-008 · VULNERABLE · Low
**Source**: audit-visualizer.md  
**Title**: Silent early-return swallows render errors — blank diagram indistinguishable from empty FSM

`render-html.ts:407` returns silently when `!fsm || !layout`. No diagnostic is injected into the SVG output.

**Counterexample**: `activeFsmId` points to a D3-007-dropped FSM → blank diagram pane, user cannot distinguish from an intentionally empty FSM.

**File**: `render-html.ts:407`  
**Runtime impact**: Reachable. Directly downstream of D3-007.

---

## D4 — Concurrency

### D4-001 · VULNERABLE · Critical
**Source**: audit-concurrency.md  
**Title**: `session_start` hook performs multi-step state mutations without `withSessionLock`

`session_start` (index.ts:752-778) calls `sweepTmpFiles`, `readPendingPop`, `popFsm`, `deletePendingPop`, `readStack`, `readState` — all outside `withSessionLock`. Every other tool/command entry point holds the lock for its full duration.

**Counterexample**: Parallel tool call on same `sessionId` races with `session_start`'s `popFsm` → active FSM stack corrupted.

**File**: `index.ts:752-778`  
**Runtime impact**: Reachable. pi framework issues parallel tool calls per turn; `session_start` fires concurrently with tool calls.

---

### D4-002 · GUARDED · Medium
**Source**: audit-concurrency.md  
**Title**: `withSessionLock` is non-reentrant — recursive same-key call deadlocks permanently

`storage.ts:70-87` implements the mutex as a promise chain. A recursive call on the same key appends to the chain and waits forever.

**Counterexample**: Future refactor introduces recursive lock acquisition → permanent deadlock.

**File**: `storage.ts:70-87`  
**Runtime impact**: GUARDED. No current code path triggers reentrant locking. Risk is latent — relevant if lock scope is expanded (e.g., wrapping session_start per D4-001 fix).

---

### D4-003 · GUARDED · Low
**Source**: audit-concurrency.md  
**Title**: `sweepTmpFiles` PID guard does not protect against a second concurrent process

`storage.ts:151-152` checks PID to avoid sweeping another process's tmp files, but two processes with different PIDs can both sweep concurrently.

**Counterexample**: Two Node.js processes on same session dir → both sweep → one deletes the other's active tmp file.

**File**: `storage.ts:151-152`  
**Runtime impact**: GUARDED. Deployment context is single-process only (deployment-context.md). Cross-process coordination is a documented known limitation, not a finding.

---

## D5 — Cross-Module

### D5-001 · VULNERABLE · High
**Source**: audit-cross-module.md  
**Origin**: NDA-05 introduced  
**Title**: `writePendingPop` runs before `persistRuntime` — crash leaves pending-pop without committed state

In the same try block, `writePendingPop` is called at index.ts:259 before `persistRuntime` at index.ts:263. If `persistRuntime` fails, `pending-pop.json` exists but `state.json` is unchanged. On crash recovery, `session_start` sees `pending-pop.json` and pops the FSM against stale state.

**Counterexample**: `persistRuntime` throws after `writePendingPop` succeeds → crash → recovery pops FSM with pre-action state.

**File**: `index.ts:259-263`  
**Runtime impact**: Reachable. Any I/O error during `persistRuntime` triggers this.

---

### D5-002 · VULNERABLE · High
**Source**: audit-cross-module.md  
**Title**: `executeAction` mutates `rt.current_state_id` in-place before `persistRuntime` — no rollback on failure

`engine.ts:268` mutates `rt.current_state_id` directly. If `persistRuntime` subsequently fails, in-memory runtime has the new state but disk has the old state. The catch block does not roll back the in-memory mutation.

**Counterexample**: `persistRuntime` throws → in-memory `rt.current_state_id` = new state, disk `state.json` = old state → subsequent in-memory reads diverge from disk truth.

**Files**: `engine.ts:268`, `index.ts:249-263`  
**Runtime impact**: Reachable. Any I/O error during persist triggers this.

---

### D5-003 · VULNERABLE · High
**Source**: audit-cross-module.md  
**Origin**: NDA-05 introduced  
**Title**: Stop hook reads stagnation hash from disk — stale disk state causes premature stagnation trigger

Stop hook calls `loadRuntime` (index.ts:704) to compute the stagnation hash. If a prior `persistRuntime` failed (D5-002), disk has the pre-action state. Hash unchanged → stagnation guard fires prematurely.

**Counterexample**: `persistRuntime` fails → disk state unchanged → stop hook computes same hash as previous turn → stagnation detected → flow stopped incorrectly.

**File**: `index.ts:704`  
**Runtime impact**: Reachable. Directly downstream of D5-002.

---

### D5-004 · VULNERABLE · High
**Source**: audit-cross-module.md  
**Origin**: NDA-05 introduced  
**Title**: Crash recovery unconditionally pops FSM when `pending-pop.json` exists — precondition not verified

`session_start` at index.ts:761-765 calls `popFsm` whenever `pending-pop.json` exists, without verifying that `state.json` has `current_state_id=$END`. `pending-pop.json` can exist while state is mid-action (same root cause as D5-001).

**Counterexample**: Crash after `writePendingPop` but before `persistRuntime` → recovery pops FSM unconditionally → FSM popped with wrong state.

**File**: `index.ts:761-765`  
**Runtime impact**: Reachable. Same trigger as D5-001.

---

### D5-005 · VULNERABLE · High
**Source**: audit-cross-module.md  
**Title**: `persistRuntime` writes tape then state sequentially — partial write leaves inconsistent assembled runtime

`index.ts:112-113` calls `writeTape` then `writeState` sequentially. If `writeTape` succeeds and `writeState` throws, `tape.json` is updated but `state.json` is stale. Next `loadRuntime` assembles an inconsistent runtime.

**Counterexample**: `writeTape` succeeds, `writeState` throws → `tape.json` has new entries, `state.json` has old `current_state_id` → assembled runtime is incoherent.

**File**: `index.ts:112-113`  
**Runtime impact**: Reachable. Any I/O error between the two sequential writes triggers this.

---

## Summary Table

| ID | Dimension | Severity | Classification | Fix Priority |
|---|---|---|---|---|
| D1-001 | Regression | Critical | VULNERABLE | P0 |
| D1-002 | Regression | Critical | VULNERABLE | P0 |
| D4-001 | Concurrency | Critical | VULNERABLE | P0 |
| D3-001 | Visualizer | Critical | VULNERABLE | P0 |
| D1-003 | Regression | High | VULNERABLE | P1 |
| D1-004 | Regression | High | VULNERABLE | P1 |
| D2-001 | Stop Hook | High | VULNERABLE | P1 |
| D2-004 | Stop Hook | High | VULNERABLE | P1 |
| D2-009 | Stop Hook | High | VULNERABLE | P1 |
| D3-002 | Visualizer | High | VULNERABLE | P1 |
| D5-001 | Cross-Module | High | VULNERABLE | P1 |
| D5-002 | Cross-Module | High | VULNERABLE | P1 |
| D5-003 | Cross-Module | High | VULNERABLE | P1 |
| D5-004 | Cross-Module | High | VULNERABLE | P1 |
| D5-005 | Cross-Module | High | VULNERABLE | P1 |
| D1-005 | Regression | Medium | PARTIAL | P2 |
| D2-002 | Stop Hook | Medium | VULNERABLE | P2 |
| D2-003 | Stop Hook | Medium | VULNERABLE | P2 |
| D2-005 | Stop Hook | Medium | VULNERABLE | P2 |
| D2-010 | Stop Hook | Medium | VULNERABLE | P2 |
| D3-003 | Visualizer | Medium | VULNERABLE | P2 |
| D3-004 | Visualizer | Medium | VULNERABLE | P2 |
| D3-005 | Visualizer | Medium | VULNERABLE | P2 |
| D3-007 | Visualizer | Low | VULNERABLE | P3 |
| D3-008 | Visualizer | Low | VULNERABLE | P3 |
| D2-006 | Stop Hook | Low | GUARDED | — |
| D2-007 | Stop Hook | Low | GUARDED | — |
| D2-011 | Stop Hook | Low | GUARDED | — |
| D3-006 | Visualizer | Low | GUARDED | — |
| D4-002 | Concurrency | Medium | GUARDED | — |
| D4-003 | Concurrency | Low | GUARDED | — |
