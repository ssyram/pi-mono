# Round 3 Nits

**Definition**: Observations that were filtered out of the main findings list because they lack a concrete counterexample, are documentation-only, or describe behavior that is unreachable / intentional in the current deployment context.

These are retained for traceability only. No fix action required.

---

## D2-008 · NIT · Documentation/Comment Only
**Source**: audit-stop-hook.md  
**Title**: Comment at `index.ts:719` says "Reset count" but code writes `nextCount` (incremented value)

The comment is misleading but the code is functionally correct. `nextCount` is the incremented value that supersedes the old count; the comment says "reset" when it should say "update" or "write".

**Reason for exclusion**: Documentation-only finding. No behavioral defect. No counterexample possible — the code does exactly what is intended, only the comment is wrong.

**File**: `index.ts:719`

---

## D4-004 · NIT · No Concrete Counterexample in Single-Threaded Context
**Source**: audit-concurrency.md  
**Title**: `lastCompactionAt.delete(sid)` at `index.ts:755` runs outside the session lock

A race is described: two concurrent paths could both attempt to delete the same cooldown key. However, JavaScript is single-threaded and `Map.delete` is synchronous. No concurrent interleaving is possible between two synchronous statements in the same event loop tick.

**Reason for exclusion**: No concrete counterexample exists in the deployment's single-threaded Node.js runtime. The described race requires true parallelism, which is absent here.

**File**: `index.ts:755`

---

## D3-XSS · NIT · Disproven — XSS Guards Confirmed Present
**Source**: audit-visualizer.md (non-findings section)  
**Title**: XSS via unescaped FSM data in generated HTML

Auditor initially raised XSS as a concern for user-controlled FSM data rendered into HTML.

**Reason for exclusion**: Auditor's own analysis confirmed all injection points are covered: `escapeHtml()`, `safeJson()`, and `esc()` are applied at every FSM-data-to-HTML boundary. No counterexample was produced. Cleared by the auditor before filing as a finding.

**Files**: `render-html.ts` (multiple)

---

## D3-INFLOOP · NIT · Disproven — BFS Guard Confirmed Present
**Source**: audit-visualizer.md (non-findings section)  
**Title**: `getOutgoingLeveled` potential infinite loop on cyclic FSM graphs

Auditor initially raised a concern that BFS traversal over a cyclic FSM graph could loop infinitely.

**Reason for exclusion**: Auditor's own analysis confirmed a visited-set guard is present in the BFS implementation. No cycle can cause an infinite loop. No counterexample was produced. Cleared by the auditor before filing as a finding.

**File**: `label-layout.ts` (getOutgoingLeveled)

---

## Excluded Findings (Intentional Omissions / Known Limitations)

These were raised but are excluded from both findings and nits because they describe behavior that is explicitly accepted in spec-gate.md or deployment-context.md.

| Finding | Reason |
|---|---|
| Any finding assuming tape rollback on non-epsilon failure | Tape never rolls back — design decision (deployment-context.md). Only epsilon chain failure triggers rollback. |
| D4-003 cross-process sweep race | Single-process deployment only. Cross-process coordination is a documented known limitation (deployment-context.md). Filed as GUARDED in compiled-findings.md. |
| Condition idempotency enforcement | Conditions must be idempotent — not enforced by framework (spec-gate.md intentional omission). |
| SIGKILL tape truncation / corruption | SIGKILL truncation accepted (deployment-context.md). |
