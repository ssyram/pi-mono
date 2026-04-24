# Compiled Findings — Round 2 Hoare Audit

**Generated:** 2026-04-23  
**Source reports:** D1 (parser), D2 (external API contracts), D3 (error propagation), D4 (state-machine correctness), D5 (resource lifecycle)  
**Total raw findings:** 30  
**True Hoare findings:** 18  
**Nits (demoted):** 9  
**Excluded (intentional omission):** 1 (D4-005)  
**Deferred-issue closures noted:** 2 (D2-006, D3-003)

---

## Summary Table

| ID | Dimension | Title | Severity | Classification | File:Line |
|----|-----------|-------|----------|----------------|-----------|
| D1-001 | Parser | Chomp indicators silently discarded | HIGH | DISPROVEN | `parser.ts:512-513,535,549` |
| D1-002 | Parser | Double-quoted escape sequences not decoded | HIGH | VULNERABLE | `parser.ts:558-559` |
| D1-003 | Parser | Single-quoted `''` escape not decoded | HIGH | VULNERABLE | `parser.ts:558-559` |
| D1-004 | Parser | Unterminated double-quote silent pass-through | MEDIUM | VULNERABLE | `parser.ts:553-565` |
| D1-005 | Parser | Mismatched quote silent pass-through | MEDIUM | VULNERABLE | `parser.ts:553-565` |
| D1-006 | Parser | Block-mapping continuation lines silently dropped | HIGH | DISPROVEN | `parser.ts:389,454` |
| D1-007 | Parser | `parseScalar("")` returns `""` not `null` | LOW | PARTIAL | `parser.ts:563` |
| D1-008 | Parser | Bare `-` null list items silently dropped | LOW | PARTIAL | `parser.ts:389` |
| D2-001 | API Contracts | `submit/required-fields` doc omits `$TAPE_FILE` arg | HIGH | VULNERABLE | `docs/builtin-procedures.md`, `builtins/submit-required-fields.mjs:18` |
| D2-002 | API Contracts | `self-check/basic` rubric captured but never evaluated | MEDIUM | VULNERABLE | `builtins/self-check-basic.mjs:32,42` |
| D2-003 | API Contracts | `self-check/basic` false-positives on negation phrases | MEDIUM | VULNERABLE | `builtins/self-check-basic.mjs:42` |
| D2-004 | API Contracts | `chainEpsilon` calls `runCondition` without `namedArgs` | MEDIUM | VULNERABLE | `engine.ts:330,44` |
| D2-005 | API Contracts | Empty stdout yields opaque error message | LOW | NIT | `engine.ts:171` |
| D2-006 | API Contracts | Deferred Issue #2 heuristic does not exist in source | LOW | NIT / CLOSE | `builtins/validate-non-empty-args.mjs:23-26` |
| D3-001 | Error Propagation | `persistRuntime` no try/catch after disk write | HIGH | VULNERABLE | `index.ts:244` |
| D3-002 | Error Propagation | `popFsm` in catch path not wrapped in try/catch | HIGH | VULNERABLE | `index.ts:180,190` |
| D3-003 | Error Propagation | `renderTransitionResult` hint omits `needs_tape` caveat | MEDIUM | NIT (Deferred #3) | `engine.ts:456` |
| D3-004 | Error Propagation | `chainEpsilon` discards per-condition rejection reasons | MEDIUM | VULNERABLE | `engine.ts:337` |
| D3-005 | Error Propagation | `writeState` in stagnation path swallowed by hook catch | MEDIUM | PARTIAL | `index.ts:700,709,728` |
| D3-006 | Error Propagation | `popFsm` swallows `fs.rm` errors | LOW | VULNERABLE | `storage.ts:118-120` |
| D3-007 | Error Propagation | `readJsonStrict` re-throws raw fs errors without file path | LOW | NIT | `storage.ts:52` |
| D4-001 | State Machine | Epsilon chain failure: tape mutated, state rolled back | CRITICAL | VULNERABLE | `engine.ts:268,290; index.ts:237,243` |
| D4-002 | State Machine | Partial epsilon chain: tape left at Nth hop | CRITICAL | VULNERABLE | `engine.ts:321-355,337` |
| D4-003 | State Machine | Action condition tape mutation precedes snapshot point | HIGH | VULNERABLE | `engine.ts:200-268` |
| D4-004 | State Machine | `enterStart` identical tape asymmetry | HIGH | GUARDED | `engine.ts:356-380; index.ts:178-200` |
| D4-005 | State Machine | Crash window causes double-execution of non-idempotent conditions | HIGH | EXCLUDED | `index.ts:104-113; storage.ts:253-259` |
| D4-006 | State Machine | Condition process writes `tape.json` directly, bypassing atomic write | MEDIUM | VULNERABLE | `storage.ts:131; engine.ts:70` |
| D5-001 | Resource Lifecycle | Migrated session `flow_dir=""` resolves relative paths against Pi CWD | HIGH | VULNERABLE | `storage.ts:261; engine.ts:23,75-77,84,245,330` |
| D5-002 | Resource Lifecycle | `popFsm` commits stack before `rm`; `rm` failure orphans FSM dirs | MEDIUM | VULNERABLE | `storage.ts:111-124,119-120; index.ts:180,190,200,250,338` |
| D5-003 | Resource Lifecycle | `FSMRuntime.flow_dir` typed `string` but deserialises as `undefined` | LOW | NIT | `types.ts:50; storage.ts:261` |

---

## Section 1: True Hoare Findings

A finding qualifies as a True Hoare Finding when it has (a) a specific Pre/Post/Invariant that is violated, and (b) a concrete counterexample. These are candidates for fixes.

### D1-001 — Chomp indicators silently discarded
**Severity:** HIGH | **Classification:** DISPROVEN  
**File:** `parser.ts:512-513, 535, 549`

**Violated contract:**  
Pre: YAML scalar with chomp indicator (`|-`, `|+`, `>-`, `>+`) is present.  
Post: `parseScalar` must return a block scalar with trailing-newline policy matching the indicator.  
**Violation:** Always-clip semantics are applied; chomp modes `|+`/`>+` (keep) and `|-`/`>-` (strip) are both collapsed to clip.

**Counterexample:**
```yaml
message: |-
  no trailing newline
```
→ `parseScalar` returns `"no trailing newline\n"` (clip) instead of `"no trailing newline"` (strip).

**Note:** Confirms Deferred Issue #1 from Round 1. Not an intentional omission.

---

### D1-002 — Double-quoted escape sequences not decoded
**Severity:** HIGH | **Classification:** VULNERABLE  
**File:** `parser.ts:558-559`

**Violated contract:**  
Pre: scalar is double-quoted.  
Post: `parseScalar` must decode `\n`, `\t`, `\\`, `\"`, `\uXXXX` per YAML 1.2 §7.3.1.  
**Violation:** Implementation slices off quotes but never calls a decode pass; escape sequences returned as literals.

**Counterexample:**
```yaml
message: "hello\nworld"
```
→ `parseScalar` returns `"hello\\nworld"` (7 chars + backslash) instead of `"hello\nworld"` (11 chars with newline).

---

### D1-003 — Single-quoted `''` escape not decoded
**Severity:** HIGH | **Classification:** VULNERABLE  
**File:** `parser.ts:558-559`

**Violated contract:**  
Pre: scalar is single-quoted.  
Post: `parseScalar` must decode `''` → `'` per YAML 1.2 §7.3.3.  
**Violation:** Single-quoted content is sliced only; `''` returned as two apostrophes.

**Counterexample:**
```yaml
label: 'it''s fine'
```
→ `parseScalar` returns `"it''s fine"` instead of `"it's fine"`.

---

### D1-004 — Unterminated double-quote silent pass-through
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `parser.ts:553-565`

**Violated contract:**  
Pre: scalar begins with `"` but has no closing `"`.  
Post: `parseScalar` must throw or return a parse error.  
**Violation:** Returns the raw string including the leading `"` as a value.

**Counterexample:**
```yaml
action_id: "unclosed
```
→ `parseScalar` returns `"\"unclosed"` silently.

---

### D1-005 — Mismatched quote silent pass-through
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `parser.ts:553-565`

**Violated contract:**  
Pre: scalar begins with `"` and ends with `'` (or vice versa).  
Post: `parseScalar` must reject as malformed.  
**Violation:** Mismatched delimiters pass through; free-text fields receive the raw malformed literal (action_id/state_id are caught by `IDENT_RE` only by accident).

**Counterexample:**
```yaml
description: "wrong end'
```
→ `parseScalar` returns `"\"wrong end'"` silently.

---

### D1-006 — Block-mapping continuation lines silently dropped
**Severity:** HIGH | **Classification:** DISPROVEN  
**File:** `parser.ts:389, 454`

**Violated contract:**  
Pre: block-mapping item has a value token on the line following a bare `-`.  
Post: parsed document must include that continuation value.  
**Violation:** Content on the continuation line is silently discarded; only the bare `-` node is emitted.

**Counterexample:**
```yaml
steps:
  -
    action: go
```
→ `action: go` is dropped; `steps` contains one null-like entry.

---

### D1-007 — `parseScalar("")` returns `""` not `null`
**Severity:** LOW | **Classification:** PARTIAL  
**File:** `parser.ts:563`

**Violated contract:**  
Pre: YAML empty scalar (bare key, no value token).  
Post: `parseScalar` should return `null` per YAML 1.2 §10.3.  
**Violation:** Returns `""` instead of `null`.  
**Caveat:** Only observable via `=== null` checks; truthiness-based downstream checks treat both equivalently. Classify PARTIAL — real violation, limited reachability.

**Counterexample:**
```yaml
tag:
```
→ `parseScalar` returns `""` where `null` is specified.

---

### D1-008 — Bare `-` null list items silently dropped
**Severity:** LOW | **Classification:** PARTIAL  
**File:** `parser.ts:389`

**Violated contract:**  
Pre: YAML sequence contains a bare `-` (null list item per YAML 1.2 §8.2.1).  
Post: parsed list must contain a `null` entry at that position.  
**Violation:** Bare `-` with no trailing space is dropped entirely; list length shrinks by 1.

**Counterexample:**
```yaml
items:
  -
  - value
```
→ `items` parsed as `["value"]` (length 1) instead of `[null, "value"]` (length 2).

---

### D2-001 — `submit/required-fields` doc omits `$TAPE_FILE` arg
**Severity:** HIGH | **Classification:** VULNERABLE  
**File:** `docs/builtin-procedures.md` (example block), `builtins/submit-required-fields.mjs:18`

**Violated contract:**  
Pre: LLM calls `steering-flow-action` with procedure `submit/required-fields`, positional args `[PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED]`.  
Post: procedure executes successfully.  
**Violation:** The last positional arg is treated as the tape file path (`readFileSync(args.at(-1))`). When the doc example has no tape-path arg, `readFileSync("TESTS_PASSED")` → ENOENT.

**Counterexample:**  
LLM follows documented example with args `[PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED]` →  
`readFileSync("TESTS_PASSED")` → `ENOENT: no such file or directory`.

---

### D2-002 — `self-check/basic` rubric captured but never evaluated
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `builtins/self-check-basic.mjs:32, 42`

**Violated contract:**  
Pre: `self-check/basic` called with a rubric array of N items.  
Post: result pass/fail reflects whether rubric items are satisfied.  
**Violation:** Rubric is read at line 32 and appears in the display string but plays no role in the pass/fail logic at line 42. Any assessment text causes `pass=true`.

**Counterexample:**  
`rubric=["all tests pass", "coverage ≥ 80%", "no lint errors"]`, `assessment="done"` →  
`pass=true` with zero rubric items evaluated.

---

### D2-003 — `self-check/basic` false-positives on negation phrases
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `builtins/self-check-basic.mjs:42`

**Violated contract:**  
Pre: LLM assessment contains the phrase `"not done"`.  
Post: `pass=false` (task is incomplete).  
**Violation:** `text.includes(" " + m)` where `m = "done"` matches `"not done"` → `pass=true`.

**Counterexample:**  
`assessment="task is not done"` → `text.includes(" done")` is `true` → `pass=true`.

---

### D2-004 — `chainEpsilon` calls `runCondition` without `namedArgs`
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `engine.ts:330, 44`

**Violated contract:**  
Pre: condition uses `${arg-name}` template placeholders.  
Post: placeholders are resolved before condition execution.  
**Violation:** `chainEpsilon` invokes `runCondition` without the `namedArgs` parameter, which defaults to `{}`; placeholders pass through as literals silently.

**Counterexample:**  
Epsilon condition with `${threshold}` in script path: `runCondition({…})` (no namedArgs) →  
`spawn("./conditions/${threshold}.mjs")` → ENOENT or spurious execution.

---

### D3-001 — `persistRuntime` no try/catch after disk write
**Severity:** HIGH | **Classification:** VULNERABLE  
**File:** `index.ts:244`

**Violated contract:**  
Invariant: `disk_state_id == memory_state_id` after a successful tool call.  
**Violation:** `persistRuntime` writes state to disk without a try/catch after the transition has already succeeded in memory. Any disk error (ENOSPC, EIO) after this point leaves disk showing old state while memory has advanced.

**Counterexample:**  
Transition A→B succeeds in memory. `persistRuntime` encounters ENOSPC on disk write →  
throws uncaught, exits tool call. Disk: `state_id=A`. Memory: `state_id=B`. Session corrupt.

---

### D3-002 — `popFsm` in catch path not wrapped in try/catch
**Severity:** HIGH | **Classification:** VULNERABLE  
**File:** `index.ts:180, 190`

**Violated contract:**  
Post: on `enterStart` failure, caller receives the original error and rollback status; FSM dir is removed.  
**Violation:** `popFsm` is called inside catch blocks with no try/catch of its own. If `fs.rm` throws (EPERM, EBUSY), the new exception escapes, the original error is discarded, and the FSM dir remains on disk.

**Counterexample:**  
`enterStart` fails with ErrorA. Catch block calls `popFsm`. `fs.rm` → EPERM →  
EPERM propagates up; ErrorA is lost; FSM dir persists.

---

### D3-004 — `chainEpsilon` discards per-condition rejection reasons
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `engine.ts:337`

**Violated contract:**  
Post: when epsilon chain fails, caller error message must contain sufficient detail to diagnose which condition failed and why.  
**Violation:** All per-condition rejection reasons (including spawn failures) are discarded; the returned error only names the target state.

**Counterexample:**  
3 conditions evaluated; all fail (one with ENOENT on the script, two with non-zero exit). Returned error: `"cannot reach state C"` — zero diagnostic information.

---

### D3-005 — `writeState` in stagnation path swallowed by hook catch
**Severity:** MEDIUM | **Classification:** PARTIAL  
**File:** `index.ts:700, 709, ~728`

**Violated contract:**  
Post: after `agent_end` detects stagnation, `stagnation_count` must be incremented and eventually reach the stagnation limit.  
**Violation:** `writeState` in the stagnation path sits inside the "Hooks must never throw" catch boundary. ENOSPC on `writeState` → silently swallowed → `stagnation_count` never incremented → stagnation guard never fires → LLM loops indefinitely.

**Caveat:** The outer catch is intentional per spec ("Stop hook errors silently swallowed"). This is a tension between the intentional error-swallowing policy and stagnation correctness. Classified PARTIAL — the outer catch is by-design but the effect on stagnation correctness is not.

**Counterexample:**  
Stagnation detected. `writeState` (increment counter) → ENOSPC → swallowed →  
next agent_end: counter still 0 → loop forever.

---

### D3-006 — `popFsm` swallows `fs.rm` errors
**Severity:** LOW | **Classification:** VULNERABLE  
**File:** `storage.ts:118-120`

**Violated contract:**  
Post: after `popFsm`, the popped FSM directory must not exist on disk.  
**Violation:** `fs.rm` failure is caught and silently swallowed (the `force:true` flag suppresses only ENOENT; EPERM/EBUSY are also swallowed). Caller is told "stack rolled back" when the directory remains.

**Counterexample:**  
`popFsm` called. Stack pop + write succeeds. `fs.rm` → EPERM on subdirectory →  
caught silently. Stack: `[]`. Disk: FSM dir persists. Invariant violated.

*Note: `deployment-context.md` confirms FSM cleanup is "best-effort" per spec. However, the false positive (caller told success when dir remains) is the violation — the spec allows silent errors, not silent lies about state.*

---

### D4-001 — Epsilon chain failure: tape permanently mutated, state rolled back
**Severity:** CRITICAL | **Classification:** VULNERABLE  
**File:** `engine.ts:268, 290; index.ts:237, 243`

**Violated contract:**  
Pre: epsilon chain is executing.  
Invariant (spec-gate §Engine): "Snapshot + rollback on epsilon chain failure."  
Post: on chain failure, tape must be restored to pre-chain snapshot.  
**Violation:** Snapshot covers state_id only. Tape writes made by intermediate epsilon hops before the failure point are not rolled back.

**Counterexample:**  
State A→B: epsilon writes `COUNTER=1` to tape. B→C: condition not found. Engine rolls state back to A but tape remains `{COUNTER:1}`. Contract requires tape to revert to `{}`.

---

### D4-002 — Partial epsilon chain: tape left at Nth hop
**Severity:** CRITICAL | **Classification:** VULNERABLE  
**File:** `engine.ts:321-355, 337`

**Violated contract:**  
Pre: epsilon chain of length M; hops 1..N succeed; hop N+1 fails.  
Invariant: "Snapshot + rollback on epsilon chain failure."  
Post: tape must be at pre-chain state.  
**Violation:** Tape is left at the post-condition of hop N, not the pre-chain snapshot.

**Counterexample:**  
3-hop chain A→B→C→D. Hop D fails. Tape = `{STEP:3}` (written by C's condition). State = A (rolled back). Tape must be `{}` (pre-chain). Contract violated.

---

### D4-003 — Action condition tape mutation precedes snapshot point
**Severity:** HIGH | **Classification:** VULNERABLE  
**File:** `engine.ts:200-268`

**Violated contract:**  
Pre: action condition runs and writes to tape before the snapshot is taken.  
Invariant: rollback window must cover all writes made during the transition attempt.  
**Violation:** Snapshot is taken after the action condition runs. Tape writes made by the action condition are permanently committed even when the subsequent epsilon chain fails.

**Counterexample:**  
Action condition runs, writes `INIT=true` to tape. Epsilon chain then fails. State rolls back to A but tape contains `{INIT:true}` permanently.

---

### D4-004 — `enterStart` identical tape asymmetry
**Severity:** HIGH | **Classification:** GUARDED  
**File:** `engine.ts:356-380; index.ts:178-200`

**Violated contract:**  
Pre: `enterStart` is called on a fresh FSM push.  
Post: if `enterStart` fails, tape must be identical to pre-push state.  
**Violation:** (latent) `enterStart` can write to tape before the failure point; `popFsm` cleanup removes the FSM dir but does not revert tape writes made inside `enterStart`.

**Guard:** `loadAndPush` wraps `enterStart` with `popFsm` as a safety net, and the current call graph always uses `loadAndPush`. The violation is latent: it only materialises if `enterStart` is ever called without `popFsm` cleanup, or if the safety net is bypassed.

**Assessment:** No immediate fix required; maintain guard. Flag if `enterStart` call sites expand.

---

### D4-006 — Condition process writes `tape.json` directly, bypassing atomic write
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `storage.ts:131; engine.ts:70`

**Violated contract:**  
Invariant: all writes to `tape.json` must go through `atomicWriteJson` (tmp + rename) to prevent partial-write corruption.  
**Violation:** The API surface exposed to condition processes writes `tape.json` directly (no tmp intermediary). A process crash or OS interruption mid-write produces a truncated JSON file, permanently corrupting the session with an unrecoverable `CorruptedStateError`.

**Counterexample:**  
Condition process writes 4 KB to `tape.json`; killed by OOM killer at 2 KB →  
`tape.json` = truncated JSON → next session read → `CorruptedStateError` — session permanently bricked.

---

### D5-001 — Migrated session `flow_dir=""` resolves relative paths against Pi CWD
**Severity:** HIGH | **Classification:** VULNERABLE  
**File:** `storage.ts:261; engine.ts:23, 75-77, 84, 245, 330`

**Violated contract:**  
Pre: session saved before `flow_dir` was added to the schema (legacy session).  
Invariant: relative condition tokens must resolve against the YAML file's directory for the session lifetime.  
Post: condition scripts resolve correctly regardless of session age.  
**Violation:** `storage.ts:261` patches missing `flow_dir` with `""`. `engine.ts:23` short-circuits on falsy `flowDir` (returns token unchanged). Spawn at `engine.ts:84` uses `process.cwd()` as base → ENOENT for any relative path.

**Counterexample:**  
Flow at `/projects/budget/flow.yaml`, condition `./check-budget.mjs`. Session saved pre-schema. Resumed from `/home/user/` →  
`spawn("/home/user/check-budget.mjs")` → ENOENT.

**Note:** Extends Deferred Issue #4. That deferral tracked the `??""` patch; this finding provides the concrete counterexample path and spawn failure.

---

### D5-002 — `popFsm` commits stack before `rm`; `rm` failure orphans FSM dirs
**Severity:** MEDIUM | **Classification:** VULNERABLE  
**File:** `storage.ts:111-124, 119-120; index.ts:180, 190, 200, 250, 338`

**Violated contract:**  
Post: after `popFsm`, the popped FSM directory must not exist on disk.  
Invariant: `dirs_on_disk ⊆ IDs_in_stack`.  
**Violation:** `stack.pop()` + `writeStack` commits the stack change first. `fs.rm` then fails (EBUSY, EPERM) and is swallowed silently. Result: stack no longer references the dir, but the dir persists permanently with no recovery path.

**Counterexample:**  
`pop-steering-flow` (user action). Stack: `["fsm-1", "fsm-2"]`. `popFsm` called:  
`stack.pop()` → `["fsm-1"]`, written to disk. `fs.rm("fsm-2")` → EBUSY →  
swallowed. Disk: `fsm-2/` persists. Stack: `["fsm-1"]`. No recovery possible.

---

## Section 2: Nits

Findings demoted to Nits because they are code-quality, documentation, UX, or type-accuracy concerns without a formal Pre/Post violation, or because they match a spec-gate intentional omission. Full records in `nits.md`.

| ID | Reason for Demotion |
|----|---------------------|
| D2-005 | Error message quality / UX only — no Pre/Post violation |
| D2-006 | Tracking note — deferred Issue #2 code does not exist; recommend CLOSE |
| D3-003 | Hint text accuracy — documentation issue; matches Deferred Issue #3 |
| D3-007 | Error message quality — path omitted from re-throw; no behavioral violation |
| D5-003 | Type-accuracy only — `flow_dir: string` vs runtime `undefined`; patched by `??""` |
| D4-005 | **EXCLUDED** — maps directly to Intentional Omission #2 ("Conditions must be idempotent; framework doesn't enforce") |

---

## Section 3: Classification of True Hoare Findings

### VULNERABLE / DISPROVEN / REFUTED — Fix Candidates

These have a concrete counterexample, no intentional omission cover, and no runtime guard.

| ID | Classification | Rationale |
|----|----------------|-----------|
| D1-001 | DISPROVEN | Spec is unambiguous; always-clip contradicts `|-`/`|+`/`>-`/`>+` semantics |
| D1-002 | VULNERABLE | No escape decode pass; counterexample trivially reproduced |
| D1-003 | VULNERABLE | `''` not decoded; trivially reproduced |
| D1-004 | VULNERABLE | Unterminated quote passes through silently |
| D1-005 | VULNERABLE | Mismatched quote passes through silently |
| D1-006 | DISPROVEN | Continuation lines dropped; verified counterexample |
| D2-001 | VULNERABLE | Doc + runtime contract mismatch; causes ENOENT in normal LLM use |
| D2-002 | VULNERABLE | Rubric evaluates to vacuous truth; contract broken by design |
| D2-003 | VULNERABLE | Negation false-positive; trivially reproduced |
| D2-004 | VULNERABLE | `namedArgs` omitted in `chainEpsilon`; placeholders pass through |
| D3-001 | VULNERABLE | Disk/memory divergence after successful transition on ENOSPC |
| D3-002 | VULNERABLE | Original error discarded, FSM dir orphaned on EPERM in rollback |
| D3-004 | VULNERABLE | All per-condition errors discarded; diagnostic blackout |
| D3-006 | VULNERABLE | `fs.rm` EPERM swallowed; caller told success, dir persists |
| D4-001 | VULNERABLE | Tape not in rollback window; spec says rollback applies to tape |
| D4-002 | VULNERABLE | Partial chain leaves tape at Nth hop; same rollback contract violated |
| D4-003 | VULNERABLE | Action condition writes outside rollback window |
| D4-006 | VULNERABLE | Direct `tape.json` write bypasses atomic write; OOM → permanent corruption |
| D5-001 | VULNERABLE | Legacy session `flow_dir=""` → ENOENT for all relative conditions |
| D5-002 | VULNERABLE | Stack committed before rm; rm failure orphans dir permanently |

### GUARDED / PARTIAL — Case-by-Case

| ID | Classification | Rationale |
|----|----------------|-----------|
| D1-007 | PARTIAL | Real YAML spec violation; downstream impact only on `=== null` checks |
| D1-008 | PARTIAL | Real YAML spec violation; list-length impact only if null items used |
| D3-005 | PARTIAL | Outer catch is intentional; writeState failure impact on stagnation is unintended side-effect — requires design decision |
| D4-004 | GUARDED | Latent defect; current call graph always uses `loadAndPush` safety net |

### SAFE / PROVEN / CONFIRMED — No Action Needed

No findings in this category. All surviving true Hoare findings have verifiable violations.

---

## Section 4: Runtime Impact

Deployment context: single Node.js process, LLM = untrusted caller (5 tools), user = trusted caller (slash commands), conditions = trusted author-placed scripts.

### D4-001 — REACHABLE (HIGH IMPACT)
**Path:** LLM calls `steering-flow-action` → trigger epsilon chain → intermediate hop writes tape → later hop fails.  
**Trigger:** Any multi-hop epsilon chain where a condition has a side-effect on tape and a later condition fails. No special permissions required. LLM-callable.  
**Impact:** Tape is corrupted relative to state after every such failure; session proceeds with inconsistent tape state.

### D4-002 — REACHABLE (HIGH IMPACT)
**Path:** Same as D4-001 but for chains of length ≥ 2 where any non-final hop succeeds.  
**Trigger:** Normal multi-hop epsilon transition. LLM-callable.  
**Impact:** Tape/state divergence grows with chain length; partially applied tape state persists.

### D4-003 — REACHABLE (HIGH IMPACT)
**Path:** LLM calls `steering-flow-action` → action condition runs (tape write) → epsilon chain fails.  
**Trigger:** Any flow where an action condition modifies tape and the epsilon chain can fail. LLM-callable.  
**Impact:** Action condition tape writes are permanently committed even when the logical transition is rolled back.

### D4-001+D4-002+D4-003 Shared Root: Tape rollback window excludes condition-side tape writes. All three are variants of the same defect class. Fix order: D4-003 → D4-001 → D4-002 (snapshot point must move before all condition evaluations).

### D4-006 — REACHABLE (MEDIUM IMPACT, TRUSTED PATH)
**Path:** Condition script → tape write API → direct `tape.json` write → OS kills process mid-write.  
**Trigger:** OOM killer, SIGKILL, power loss during condition. Only condition scripts can trigger (trusted author). Not LLM-triggerable directly.  
**Impact:** `CorruptedStateError` on next read; session permanently unrecoverable without manual file repair.

### D3-001 — REACHABLE (MEDIUM IMPACT)
**Path:** Any LLM tool call → successful in-memory transition → `persistRuntime` → ENOSPC/EIO on disk write.  
**Trigger:** Full disk or I/O error (Docker volumes, network mounts). LLM-callable (any tool call that transitions state).  
**Impact:** Disk/memory diverge; subsequent calls observe old state on reload but new state in current session — split-brain per session.

### D3-002 — REACHABLE (LOW-MEDIUM IMPACT)
**Path:** Any failed LLM tool call → catch block → `popFsm` called without try/catch → EPERM on `fs.rm`.  
**Trigger:** EPERM on cleanup during error recovery. LLM-callable error path.  
**Impact:** Original error swallowed; FSM dir orphaned; caller receives EPERM instead of the original diagnostic.

### D3-004 — REACHABLE (MEDIUM IMPACT, DIAGNOSTIC)
**Path:** Any epsilon chain failure → error message discards per-condition details.  
**Trigger:** Normal epsilon chain failure. LLM-callable.  
**Impact:** Diagnostic blackout — LLM cannot self-correct from the returned error; operator cannot diagnose failures without log inspection.

### D3-005 — REACHABLE (LOW IMPACT, CONDITIONAL)
**Path:** `agent_end` hook → stagnation detected → `writeState` → ENOSPC → swallowed → stagnation counter frozen.  
**Trigger:** ENOSPC during stagnation write. Requires disk-full condition coincident with stagnation event.  
**Impact:** Stagnation guard never fires → LLM loops indefinitely. Lower probability (two conditions must coincide). Requires design decision (see Section 3).

### D3-006 — REACHABLE (LOW IMPACT, TRUSTED PATH)
**Path:** User `pop-steering-flow` → `popFsm` → `fs.rm` EPERM → swallowed.  
**Trigger:** User-initiated pop on EPERM filesystem. Trusted principal only.  
**Impact:** FSM dir orphaned; disk accumulates stale dirs; user told "success" when dir persists.

### D5-001 — REACHABLE (HIGH IMPACT, LEGACY SESSIONS)
**Path:** Resume legacy session (pre-schema) → `flow_dir=""` → condition resolves against `process.cwd()` → ENOENT.  
**Trigger:** Any session saved before `flow_dir` was added to the schema. LLM-callable (any tool call in resumed session).  
**Impact:** All condition scripts silently fail with ENOENT; entire session is non-functional.

### D5-002 — REACHABLE (LOW IMPACT, TRUSTED PATH)
**Path:** User `pop-steering-flow` → `popFsm` → stack committed → `fs.rm` EBUSY → swallowed.  
**Trigger:** User-initiated pop on busy filesystem. Trusted principal only.  
**Impact:** Orphaned FSM dirs accumulate; no recovery path (stack no longer references them). Inert but permanent.

### D2-001 — REACHABLE (HIGH IMPACT)
**Path:** LLM follows documented `submit/required-fields` example → args without tape-path → `readFileSync(last_arg)` → ENOENT.  
**Trigger:** Correct use of documented API. LLM-callable. Triggered by following the documentation.  
**Impact:** Procedure always fails when used as documented. The documentation is the attack surface.

### D2-002+D2-003 — REACHABLE (MEDIUM IMPACT)
**Path:** LLM calls `self-check/basic` with rubric → pass/fail is vacuous or inverted.  
**Trigger:** Normal use of `self-check/basic`. LLM-callable.  
**Impact:** Quality gate passes unconditionally (D2-002) or fails to detect explicit incompleteness (D2-003); LLM proceeds past broken gates.

### D2-004 — REACHABLE (MEDIUM IMPACT)
**Path:** Author configures epsilon condition with `${arg-name}` placeholders → LLM triggers transition → placeholders not resolved → spawn with literal `${…}` path.  
**Trigger:** Author uses template placeholders in epsilon conditions (valid design intent). LLM-callable.  
**Impact:** Conditions silently spawn with wrong paths; transition failures are opaque.

### D1-001 — REACHABLE (PARSER, ALL PATHS)
**Path:** Any YAML with chomp indicators → `parseScalar` → wrong trailing-newline policy applied.  
**Trigger:** Author uses block scalars with `|-`/`|+`/`>-`/`>+`. Parser-time (affects all tool calls reading flow YAML).  
**Impact:** Trailing newlines in string values are incorrect; may affect script arguments, condition outputs, and tape values.

### D1-002+D1-003 — REACHABLE (PARSER, ALL PATHS)
**Path:** Any YAML with quoted scalars using escape sequences → `parseScalar` → literals returned.  
**Trigger:** Author uses standard YAML escapes. Parser-time.  
**Impact:** String values contain backslash-escape text instead of decoded characters; affects all downstream use of those values.

### D1-004+D1-005 — REACHABLE (MEDIUM IMPACT)
**Path:** YAML with malformed quotes → `parseScalar` → raw malformed literal passes through.  
**Trigger:** Author typo in YAML. Parser-time. Only `IDENT_RE` incidentally catches some cases for action_id/state_id fields.  
**Impact:** Malformed values reach condition arguments and tape; silent corruption.

### D1-006 — REACHABLE (PARSER)
**Path:** YAML with block-mapping items using continuation-line syntax → parser drops continuation content.  
**Trigger:** Author uses valid YAML block syntax. Parser-time.  
**Impact:** Configuration is silently truncated; missing fields cause downstream failures.

---

## Appendix A: Excluded Findings

### D4-005 — EXCLUDED: Intentional Omission #2

**Raw finding:** Crash between tape write and state write causes double-execution of non-idempotent conditions (at-least-once retry semantics on reload).  
**Exclusion reason:** `spec-gate.md` Intentional Omission #2: *"Conditions must be idempotent (framework doesn't enforce)."* The crash-recovery behaviour (tape-first, then state) is documented and deliberate. The framework's contract does not cover idempotency enforcement.  
**Note:** There is a design tension — the crash-safety argument relies on idempotency, but idempotency is the author's responsibility. This is worth noting in user-facing documentation but does not constitute a Hoare violation within the spec's scope.

---

## Appendix B: Deferred Issue Status

| Deferred Issue | Status | Notes |
|----------------|--------|-------|
| #1 — Chomp indicators silently collapsed | **CONFIRMED VIOLATION** → D1-001 | Promoted to fix candidate (DISPROVEN). Not an intentional omission. |
| #2 — `validate-non-empty-args.mjs` tape-path heuristic | **RECOMMEND CLOSE** → D2-006 | Lines 23-26 contain no heuristic; code is a standard empty-arg check. Bug never existed or was removed. Deferred tracking entry should be closed. |
| #3 — `renderTransitionResult` hint omits `needs_tape` caveat | **NIT** → D3-003 | Hint text quality issue; no Pre/Post violation. Remains as documentation improvement. |
| #4 — `loadRuntime flow_dir ?? ""` migrated sessions | **EXTENDED** → D5-001 | Deferred issue correctly identified the root. D5-001 provides the concrete failure path and counterexample. Promotes from deferred to fix candidate (VULNERABLE). |
