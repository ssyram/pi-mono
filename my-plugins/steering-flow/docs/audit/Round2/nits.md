# Nits — Round 2 Hoare Audit

**Generated:** 2026-04-23  
**Source:** Demoted from `compiled-findings.md` — all findings here lack a formal Pre/Post/Invariant violation or are documentation/UX concerns, or match a spec-gate intentional omission.

These do not require Hoare-grade fixes. Each is a code-quality, UX, type-accuracy, or tracking issue. Prioritise based on engineering discretion.

---

## NIT-001 (from D2-005) — Empty stdout yields opaque error message

**Severity:** LOW  
**Source finding:** D2-005  
**File:** `engine.ts:171`

**Issue:** When a condition script writes nothing to stdout, the engine returns the error `got ''` with no further hint that stdout must contain `true` or `false`. The error message is opaque to a first-time author or the LLM operator.

**Demotion reason:** No Pre/Post contract violation. The condition fails correctly; only the error message quality is suboptimal.

**Suggested improvement:** Change error text to something like: `"Condition produced no output. Condition scripts must write 'true' or 'false' to stdout."` No contract fix needed.

---

## NIT-002 (from D2-006) — Deferred Issue #2 should be CLOSED

**Severity:** LOW  
**Source finding:** D2-006  
**File:** `builtins/validate-non-empty-args.mjs:23-26`; `spec-gate.md` Deferred Issue #2

**Issue:** Deferred Issue #2 from Round 1 described a "tape-path heuristic" at lines 23-26 of `validate-non-empty-args.mjs` that strips the first absolute-path argument when `needs_tape:false`. Inspection of the current source shows no such heuristic exists at those lines. The code at lines 23-26 is a standard empty-arg presence check.

**Demotion reason:** No code behavior violation present. The deferred issue describes a bug that either never existed or was removed before Round 2.

**Action:** **Close Deferred Issue #2.** Remove or mark the entry in `spec-gate.md` as resolved-not-reproduced. No source fix needed.

---

## NIT-003 (from D3-003) — `renderTransitionResult` hint omits `needs_tape` caveat

**Severity:** MEDIUM  
**Source finding:** D3-003  
**File:** `engine.ts:456`

**Issue:** When a condition fails and the failure hint is generated, `renderTransitionResult` mentions `$TAPE_FILE` but does not mention the positional-arg mechanism (`needs_tape:true` with `$1`/`$2` args). Authors who set up positional-arg conditions receive a hint that points them at the wrong configuration surface.

**Demotion reason:** Documentation/UX issue in a hint string. No Pre/Post violation — condition evaluation itself is correct. Matches Deferred Issue #3 from Round 1.

**Action:** Update the hint text at `engine.ts:456` to mention both `$TAPE_FILE` (for `needs_tape:true` with tape-file injection) and positional `$1`/`$2` args. No contract fix needed.

---

## NIT-004 (from D3-007) — `readJsonStrict` re-throws raw fs errors without file path

**Severity:** LOW  
**Source finding:** D3-007  
**File:** `storage.ts:52`

**Issue:** When `readJsonStrict` encounters a filesystem error (EIO, ENOENT), it re-throws the raw Node.js error. The error message contains no file path or session context. Compare: the JSON parse error path correctly uses `CorruptedStateError(path, e)` which includes the path.

**Demotion reason:** UX/debugging quality issue. No Pre/Post contract violation — the error propagates correctly (it does not get swallowed). The diagnostic experience is degraded, not the behavior.

**Suggested improvement:** Wrap raw fs errors in a context object that includes the file path, consistent with the JSON parse error path:
```ts
// current
throw e;
// suggested
throw Object.assign(e, { pi_path: path });
// or a custom error class consistent with CorruptedStateError
```

---

## NIT-005 (from D5-003) — `FSMRuntime.flow_dir` typed `string` but deserialises as `undefined`

**Severity:** LOW  
**Source finding:** D5-003  
**File:** `types.ts:50; storage.ts:261`

**Issue:** `FSMRuntime.flow_dir` is declared as `string` (non-optional) in the type definition. For legacy sessions serialised before `flow_dir` was added to the schema, deserialisation yields `undefined`. `storage.ts:261` patches this with `?? ""` but does not correct the type, hiding the mismatch.

**Demotion reason:** Type-accuracy issue, not a behavioral Pre/Post violation. The `??""` patch prevents a runtime crash. The underlying behavior consequence (legacy sessions resolving paths incorrectly) is separately captured as true Hoare finding D5-001.

**Suggested improvement:** Change `types.ts:50` to `flow_dir?: string` (optional) and handle the `undefined` case explicitly. This surfaces the legacy-session case at the type level and eliminates the silent `??""` patch that D5-001 exploits.

---

## NIT-006 (from D4-005) — EXCLUDED: Crash window double-execution (Intentional Omission)

**Severity:** HIGH (raw) → **EXCLUDED**  
**Source finding:** D4-005  
**File:** `index.ts:104-113; storage.ts:253-259`

**Exclusion reason:** Maps directly to `spec-gate.md` Intentional Omission #2: *"Conditions must be idempotent (framework doesn't enforce)."* The tape-first / state-second commit order and resulting at-least-once retry semantics on crash are deliberate design choices. The framework's contract explicitly does not cover idempotency enforcement.

**Design tension note (non-actionable):** The crash-safety argument depends on idempotency, but idempotency is solely the author's responsibility. Consider adding a documentation note in the flow authoring guide that explains: "Conditions may execute more than once after a crash. Condition scripts must be idempotent (i.e., safe to re-run with the same inputs without unintended side effects)." This is a documentation improvement, not a code fix.

---

## Summary

| NIT ID | Source | Category | Action |
|--------|--------|----------|--------|
| NIT-001 | D2-005 | Error message quality | Improve error text at `engine.ts:171` |
| NIT-002 | D2-006 | Deferred issue tracking | **Close Deferred Issue #2** in `spec-gate.md` |
| NIT-003 | D3-003 | Hint text / documentation | Update hint at `engine.ts:456`; close Deferred Issue #3 |
| NIT-004 | D3-007 | Error message quality | Add path to fs re-throws in `storage.ts:52` |
| NIT-005 | D5-003 | Type accuracy | Change `flow_dir` to optional in `types.ts:50` |
| NIT-006 | D4-005 | EXCLUDED (Intentional Omission #2) | Add idempotency note to authoring guide |
