# Step 4.5 Reduction — Steering-Flow Hoare Audit Round 2

> 24 confirmed findings → minimal root-cause fix set  
> Principle: 只诛首恶 — fix the root, not the symptoms  
> Date: 2026-04-23

---

## Section 1: Root Cause Analysis

### RC-A · Parser scope boundary (D1-001, D1-002, D1-003, D1-004, D1-005, D1-006, D1-007, D1-008)

All 8 D1 findings share one root: the YAML subset parser (`parser.ts`) was written to handle a minimal happy-path grammar and never received a second pass for edge cases. Each finding is a distinct symptom of the same under-specified parser:

| Finding | Symptom | Root expression |
|---------|---------|-----------------|
| D1-001 | chomp variants collapse to clip | `readBlockScalar` has no `chomp` param |
| D1-002 | `\"` inside double-quoted string not unescaped | `s.slice(1,-1)` only, no escape walk |
| D1-003 | `''` inside single-quoted string not unescaped | same branch, no `''` substitution |
| D1-004 | unterminated double-quote silently returns raw | no error throw on missing closing `"` |
| D1-005 | mismatched quotes (`'hello"`) silently return raw | no quote-pair validation |
| D1-006 | bare `-` (no space) breaks array loop, drops all remaining items | `startsWith("- ")` check exits loop on bare `-` |
| D1-007 | empty scalar returns `""` not `null` | `parseScalar("")` has no null branch |
| D1-008 | bare `-` continuation same loop-break; `"- "` pushes `""` not `null` | same `startsWith("- ")` + `parseScalar("")` |

**D1-006 and D1-008 share a sub-root**: the `startsWith("- ")` guard that breaks the array-item loop on bare `-`. One fix eliminates both.  
**D1-007 and D1-008 share a sub-root**: `parseScalar("")` returning `""` instead of `null`. One fix eliminates both.

Single root cause to fix (if scope is accepted): add a proper escape-walk pass to the scalar parser, a null branch for empty scalars, and a tolerant array-item tokenizer that handles bare `-`.

---

### RC-B · Builtin script correctness (D2-001, D2-002, D2-003, D2-004)

All 4 D2 findings are independent point bugs in builtin scripts/docs — no shared root, but all are in the "builtin layer" and all are unambiguous.

| Finding | Symptom | Fix |
|---------|---------|-----|
| D2-001 | doc example missing `${$TAPE_FILE}` arg | update `docs/builtin-procedures.md:45` |
| D2-002 | `rubric` extracted but never used in `passed` computation | wire `rubric` into check logic |
| D2-003 | `text.includes(" done")` matches `"not done"` (false positive) | tighten to `=== "done"` or anchored match |
| D2-004 | `chainEpsilon` omits `namedArgs` (6th param) from `runCondition` | add missing arg at `engine.ts:330` |

No deduplication needed. Each is a standalone fix.

---

### RC-C · Error propagation gaps (D3-001, D3-002, D3-004, D3-005, D3-006)

Root: the engine/index layer has inconsistent error-handling discipline — some async calls are wrapped, others are bare awaits or silently swallowed.

| Finding | Symptom | Root expression |
|---------|---------|-----------------|
| D3-001 | `persistRuntime` has no try/catch | bare await, disk error crashes caller silently |
| D3-002 | `popFsm` rollback paths have bare awaits | `writeStack` at `storage.ts:114` can throw, unhandled |
| D3-004 | `chainEpsilon` discards per-hop failure reasons | `reasons` array never surfaced to caller |
| D3-005 | stagnation counter freezes on persistent disk error | `writeState` bare await inside swallowed `agent_end` catch |
| D3-006 | `popFsm` swallows `rm` failure, orphans FSM dir | intentional "not fatal" comment, but orphan is permanent |

D3-001 and D3-002 share a sub-root: missing try/catch on async storage calls in critical paths.  
D3-005 is distinct: the outer swallow is intentional per spec; the counter freeze is a side-effect of that contract.  
D3-006 is distinct: the swallow is intentional best-effort; the question is whether that contract is correct.

---

### RC-D · Tape rollback window (D4-001, D4-002, D4-003)

**Single shared root**: the tape is never included in the rollback snapshot. `snapshotStateId` captures only the FSM state string; no `writeTape` call exists in any rollback path.

| Finding | Symptom | Where |
|---------|---------|-------|
| D4-003 | `runCondition` at `engine.ts:245` precedes snapshot at `L259`; snapshot never includes tape | snapshot point too late |
| D4-001 | rollback at `engine.ts:286` restores only `snapshotStateId`; tape left dirty | rollback incomplete |
| D4-002 | `chainEpsilon` at `engine.ts:314-355` has zero tape snapshot/restore across hops | entire epsilon chain unprotected |

**One root-cause fix eliminates all three**: move the snapshot point to before any condition evaluation, and include tape state in the snapshot/restore pair.

Fix order within this group: D4-003 (move snapshot point) → D4-001 (add tape restore to single-hop rollback) → D4-002 (add tape snapshot/restore to epsilon chain). D4-001 and D4-002 depend on D4-003 being correct first.

---

### RC-E · Latent / external contract issues (D4-004, D4-006, D5-001, D5-002)

These four findings have distinct roots and each requires independent judgment:

| Finding | Root | Status |
|---------|------|--------|
| D4-004 | `enterStart` tape asymmetry; latent, guarded by `loadAndPush` | GUARDED |
| D4-006 | condition processes write tape via raw `$TAPE_FILE`; bypass `atomicWriteJson` | external process contract |
| D5-001 | `flow_dir ?? ""` in migrated sessions → wrong CWD resolution | migration gap |
| D5-002 | `writeStack` before `rm` in `popFsm`; `rm` failure silently orphans FSM dir | commit order |

---

## Section 2: 非决策性 (Non-Decisional) — Auto-fixable

These findings have unambiguous correct implementations, do not change public API or documented behavior, and carry no architectural tradeoffs.

### NDA-01 · D2-001 — Doc example missing `$TAPE_FILE` arg
- **File**: `docs/builtin-procedures.md:45`
- **Fix**: Add `${$TAPE_FILE}` to the `submit-required-fields` example invocation.
- **Risk**: None. Doc-only change.

### NDA-02 · D2-002 — `rubric` extracted but never used
- **File**: `builtins/self-check-basic.mjs:32`
- **Fix**: Wire the extracted `rubric` value into the `passed` computation logic.
- **Risk**: None. The variable is already extracted; the check is just incomplete.

### NDA-03 · D2-003 — `text.includes(" done")` false-positive on `"not done"`
- **File**: `builtins/self-check-basic.mjs:42`
- **Fix**: Replace `text.includes(" done")` with an exact/anchored match (e.g. `text.trim() === "done"`).
- **Risk**: None. The current behavior is a clear bug — `"not done"` should not pass.

### NDA-04 · D2-004 — `chainEpsilon` omits `namedArgs` from `runCondition`
- **File**: `engine.ts:330`
- **Fix**: Add the `namedArgs` argument (6th param) to the `runCondition` call inside `chainEpsilon`, matching the call at `engine.ts:245`.
- **Risk**: None. Epsilon conditions should receive the same args as normal conditions; the omission is clearly unintentional.

### NDA-05 · D3-001 — `persistRuntime` no try/catch
- **File**: `index.ts:244`
- **Fix**: Wrap the `persistRuntime` call in try/catch; propagate or log the error rather than letting it crash the caller silently.
- **Risk**: None. Adding error handling does not change the happy-path contract.

### NDA-06 · D3-002 — `popFsm` rollback paths have bare awaits
- **File**: `index.ts:180, 190`
- **Fix**: Wrap `writeStack` calls in rollback/failure paths with try/catch. On failure, log and surface the error rather than silently dropping it.
- **Risk**: None. Rollback paths should not themselves throw unhandled.

### NDA-07 · D3-004 — `chainEpsilon` discards per-hop failure reasons
- **File**: `engine.ts:337`
- **Fix**: Collect per-hop `reason` strings into the `reasons` array and include them in the returned failure result.
- **Risk**: None. This is pure information preservation; no behavior change on the success path.

### NDA-08 · RC-D root fix — Tape not in rollback window (D4-001, D4-002, D4-003)
> One fix entry covers all three findings.

- **Files**: `engine.ts:245–268` (snapshot point), `engine.ts:286` (single-hop rollback), `engine.ts:314–355` (epsilon chain)
- **Fix**:
  1. Move the snapshot point to before the first `runCondition` call and capture tape state alongside `snapshotStateId`.
  2. In the single-hop rollback path, restore tape from snapshot (add `writeTape` call).
  3. In `chainEpsilon`, add tape snapshot before the hop loop and tape restore in the failure branch.
- **Risk**: None. The rollback is already supposed to be atomic; tape was simply missing from it. No API change.
- **Covers**: D4-003, D4-001, D4-002

### NDA-09 · D5-001 — `flow_dir ?? ""` wrong CWD resolution for migrated sessions
- **File**: `storage.ts:261`, `engine.ts:23, 75–77, 84, 245, 330`
- **Fix**: When `flow_dir` is absent (migrated session), detect the undefined case explicitly. Reconstruct `flow_dir` from the `fsm.json` path (parent directory), or emit a clear warning and refuse to proceed rather than silently resolving against CWD.
- **Risk**: None on the fix itself. The current behavior (silent wrong-path resolution) is strictly worse than an explicit error.

---

**Non-decisional count: 9 fix entries covering 12 findings**  
(NDA-08 covers D4-001 + D4-002 + D4-003 as one root fix)

---

## Section 3: 决策性 (Decisional) — Requires Human Judgment

These findings require a choice between tradeoffs, change documented behavior, or have a "correct" answer that depends on product intent.

### DA-01 · D1-001 — Chomp collapse (block scalar)
- **Finding**: All block-scalar chomp variants (`|`, `|-`, `|+`) collapse to clip behavior.
- **Decision**: Adding full chomp support expands the parser's YAML subset scope. The alternative is to document the limitation explicitly.
- **Options**:
  - A) Implement `strip`/`keep` chomp variants in `readBlockScalar` — increases parser complexity.
  - B) Document that only clip (`|`) is supported; treat `|-`/`|+` as unsupported input.
- **Tension**: Parser scope vs. correctness for users who write `|-` blocks.

### DA-02 · D1-002 / D1-003 / D1-004 / D1-005 — Quote handling (escape sequences, mismatched quotes)
- **Findings**: No escape processing in double/single-quoted scalars; unterminated/mismatched quotes silently return raw strings.
- **Decision**: Implementing escape sequences and quote-pair validation is a parser scope expansion. The plugin intentionally implements a YAML subset.
- **Options**:
  - A) Add escape walk + quote validation — brings parser closer to YAML 1.2 compliance.
  - B) Document that escape sequences and mismatched quotes are unsupported; callers must avoid them.
- **Tension**: Full YAML compliance vs. keeping the parser minimal and auditable.

### DA-03 · D1-006 / D1-008 — Bare dash / continuation in arrays
- **Findings**: Bare `-` (no space) breaks the array-item loop, losing all remaining items. `"- "` (dash-space with empty value) pushes `""` not `null`.
- **Decision**: Same parser scope question as DA-02. Fixing bare `-` tolerance is a grammar extension.
- **Options**:
  - A) Make the tokenizer tolerant of bare `-` and treat `"- "` as a null item.
  - B) Document that array items must use `"- value"` format; bare `-` is unsupported.
- **Note**: The loop-break severity (all remaining items lost) makes this higher priority than DA-02 if scope is accepted.

### DA-04 · D1-007 — Empty scalar returns `""` not `null`
- **Finding**: `parseScalar("")` returns `""` instead of `null`.
- **Decision**: Changing this alters downstream behavior for any consumer that currently receives `""` and treats it as a valid empty string. This is a semantic change, not just a bug fix.
- **Options**:
  - A) Return `null` for empty scalars — YAML-correct, but breaks consumers expecting `""`.
  - B) Keep `""` — document that empty scalars are empty strings, not null.
  - C) Return `null` and audit all consumers for `=== ""` checks first.
- **Tension**: YAML spec correctness vs. backward compatibility with existing flow definitions.

### DA-05 · D3-005 — Stagnation counter freeze on persistent disk error
- **Finding**: `writeState` for `reminder_count` is a bare await inside the swallowed `agent_end` catch. A persistent disk error silently freezes the counter → infinite reminders.
- **Decision**: The outer swallow is documented contract (stop hook errors are intentionally swallowed per spec-gate). Changing the inner behavior alters the hook error contract.
- **Options**:
  - A) Move `reminder_count` write outside the swallowed catch — changes hook error contract.
  - B) Add a secondary error log for the counter write failure specifically, without re-throwing.
  - C) Accept the freeze as an acceptable consequence of the documented swallow contract.
- **Tension**: Spec-documented swallow behavior vs. stagnation detection correctness.

### DA-06 · D3-006 — `popFsm` swallows `rm` failure, orphans FSM dir
- **Finding**: `rm` failure in `popFsm` is intentionally swallowed ("not fatal" comment). The orphaned dir cannot be accidentally reloaded (not on stack) and `sweepOrphans` only targets `.tmp.*` files.
- **Decision**: The "not fatal" intent is explicit. The question is whether the caller contract should be strengthened.
- **Options**:
  - A) Surface `rm` failure to caller — changes the "best-effort cleanup" contract.
  - B) Add orphan to a GC list / extend `sweepOrphans` to cover non-tmp orphans.
  - C) Accept current behavior; document that FSM dirs may persist after pop on disk error.
- **Tension**: Best-effort cleanup contract vs. disk hygiene / long-running session accumulation.

### DA-07 · D4-004 — `enterStart` tape asymmetry (GUARDED)
- **Finding**: `enterStart` has the same tape-not-in-rollback gap as D4-001, but is guarded by `loadAndPush` which performs a full FSM dir deletion on failure, making the tape inconsistency unreachable in practice.
- **Decision**: Fixing this now is premature hardening of a latent path. The guard is real. However, if `popFsm` ever becomes non-destructive (see DA-09), the guard disappears.
- **Options**:
  - A) Fix now alongside NDA-08 — low cost, eliminates latent risk proactively.
  - B) Defer until `popFsm` behavior changes — avoids touching a guarded path unnecessarily.
- **Tension**: Defensive hardening vs. YAGNI on a currently-unreachable path.

### DA-08 · D4-006 — Condition writes bypass `atomicWriteJson`
- **Finding**: Conditions are external processes that write tape via raw `$TAPE_FILE` path. They bypass `atomicWriteJson`. On SIGKILL (30s timeout), partial writes are possible with no recovery path.
- **Decision**: Conditions are external processes — the engine cannot enforce atomic writes on their behalf without changing the condition API contract.
- **Options**:
  - A) Change condition API to write to a temp file and have the engine atomically commit — breaking API change.
  - B) Add post-condition tape validation / checksum — detects corruption but doesn't prevent it.
  - C) Document the limitation; accept that SIGKILL during tape write is a known data-loss risk.
- **Tension**: Correctness guarantee vs. external process API stability.

### DA-09 · D5-002 — `popFsm` commit order (`writeStack` before `rm`)
- **Finding**: `writeStack` commits before `rm`; if `rm` fails, the FSM dir is orphaned with no GC path.
- **Decision**: Reversing the order (`rm` before `writeStack`) has its own tradeoff: if `writeStack` then fails, the stack is corrupt and the FSM dir is gone.
- **Options**:
  - A) Keep current order (`writeStack` → `rm`) — orphan risk on `rm` failure, but stack is always consistent.
  - B) Reverse order (`rm` → `writeStack`) — eliminates orphan risk, but introduces stack-corruption risk on `writeStack` failure.
  - C) Two-phase: write to temp stack, `rm` FSM dir, rename temp stack — eliminates both risks, higher complexity.
- **Tension**: Stack consistency vs. disk hygiene; neither simple order is strictly safe.

---

**Decisional count: 9 entries covering 12 findings**

---

## Section 4: Fix Order (非决策性 items, dependency-ordered)

Dependencies flow from storage layer → engine layer → builtin/doc layer.

```
Phase 1 — Storage / snapshot foundation (no dependencies)
  [1] NDA-09  D5-001   flow_dir migration gap (storage.ts:261)
              Fixes session loading correctness that engine fixes depend on
              for valid test scenarios.

Phase 2 — Engine rollback correctness (depends on Phase 1 being stable)
  [2] NDA-08  D4-003   Move snapshot point before runCondition (engine.ts:245–268)
              MUST be done first within RC-D group.
  [3] NDA-08  D4-001   Add tape restore to single-hop rollback (engine.ts:286)
              Depends on [2]: snapshot must exist before restore can be written.
  [4] NDA-08  D4-002   Add tape snapshot/restore to chainEpsilon (engine.ts:314–355)
              Depends on [2]: same snapshot contract must be established first.

Phase 3 — Engine information / arg correctness (batch with Phase 2)
  [5] NDA-04  D2-004   Add namedArgs to chainEpsilon runCondition call (engine.ts:330)
              Independent of tape fixes; batch with [4] (same function).
  [6] NDA-07  D3-004   Surface per-hop failure reasons in chainEpsilon (engine.ts:337)
              Independent; touches same function as [4] and [5] — batch together.

Phase 4 — Index-layer error handling (after engine is correct)
  [7] NDA-05  D3-001   Wrap persistRuntime in try/catch (index.ts:244)
  [8] NDA-06  D3-002   Wrap popFsm rollback bare awaits (index.ts:180, 190)
              [7] and [8] are independent of each other; can be done in parallel.

Phase 5 — Builtin scripts and docs (fully independent, any time)
  [9] NDA-02  D2-002   Wire rubric into passed computation (self-check-basic.mjs:32)
  [10] NDA-03 D2-003   Fix false-positive done check (self-check-basic.mjs:42)
              [9] and [10] touch the same file — batch into one edit.
  [11] NDA-01 D2-001   Fix doc example missing $TAPE_FILE (builtin-procedures.md:45)
              Fully independent; can be done at any point.
```

### Dependency graph summary

```
NDA-09 (D5-001)
    └─► NDA-08/D4-003 ──► NDA-08/D4-001
                      └─► NDA-08/D4-002
                               └─► NDA-04 (D2-004)  ← batch with D4-002 (same fn)
                               └─► NDA-07 (D3-004)  ← batch with D4-002 (same fn)

NDA-05 (D3-001) ─┐
NDA-06 (D3-002) ─┘  (parallel, after engine layer stable)

NDA-02 (D2-002) ─┐
NDA-03 (D2-003) ─┘  (parallel, fully independent)
NDA-01 (D2-001)     (fully independent)
```

---

## Appendix: Full Finding → Classification Map

| ID | Title | Classification | Entry |
|----|-------|---------------|-------|
| D1-001 | Chomp collapse | 决策性 | DA-01 |
| D1-002 | Double-quote no escape | 决策性 | DA-02 |
| D1-003 | Single-quote no escape | 决策性 | DA-02 |
| D1-004 | Unterminated double-quote silent | 决策性 | DA-02 |
| D1-005 | Mismatched quotes silent | 决策性 | DA-02 |
| D1-006 | Bare dash breaks array loop | 决策性 | DA-03 |
| D1-007 | Empty scalar returns "" not null | 决策性 | DA-04 |
| D1-008 | Bare dash / dash-space continuation | 决策性 | DA-03 |
| D2-001 | Doc example missing $TAPE_FILE | 非决策性 | NDA-01 |
| D2-002 | rubric never used in passed check | 非决策性 | NDA-02 |
| D2-003 | " done" false-positive | 非决策性 | NDA-03 |
| D2-004 | chainEpsilon omits namedArgs | 非决策性 | NDA-04 |
| D3-001 | persistRuntime no try/catch | 非决策性 | NDA-05 |
| D3-002 | popFsm rollback bare awaits | 非决策性 | NDA-06 |
| D3-004 | chainEpsilon discards reasons | 非决策性 | NDA-07 |
| D3-005 | Stagnation counter freeze | 决策性 | DA-05 |
| D3-006 | popFsm swallows rm failure | 决策性 | DA-06 |
| D4-001 | Tape not restored on rollback | 非决策性 | NDA-08 |
| D4-002 | chainEpsilon no tape snapshot | 非决策性 | NDA-08 |
| D4-003 | Snapshot point after runCondition | 非决策性 | NDA-08 |
| D4-004 | enterStart tape asymmetry (GUARDED) | 决策性 | DA-07 |
| D4-006 | Condition writes bypass atomic | 决策性 | DA-08 |
| D5-001 | flow_dir migration gap | 非决策性 | NDA-09 |
| D5-002 | popFsm commit order | 决策性 | DA-09 |

**Total**: 24 findings — 12 非决策性 (9 fix entries, NDA-08 covers 3) — 12 决策性 (9 entries)
