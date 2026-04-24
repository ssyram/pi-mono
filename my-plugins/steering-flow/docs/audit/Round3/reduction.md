# Round 3 Hoare Audit — Step 4.5 Reduction

> **Purpose**: Deduplicate confirmed findings, isolate root causes, classify into 非决策性 (non-discretionary) vs 决策性 (discretionary).
> All rejected and GUARDED findings have been filtered prior to this step.

---

## 1. Root Cause Clusters

Before listing individual findings, we collapse findings that share a single root cause. Fixing the root fixes all members.

---

### RC-A — writePendingPop ordering (NDA-05 regression cluster)

**Root cause**: In `index.ts` lines 258–271, `writePendingPop` is called *before* `persistRuntime`. The `try/catch` at lines 261–263 returns early on persist failure, so `popFsm` at line 270 is never reached and `deletePendingPop` is never called. This single ordering error propagates into four confirmed findings.

**Root fix**: Move `writePendingPop` to *after* a successful `persistRuntime`; add `deletePendingPop` in the `catch` path.

| Member | Location | Symptom |
|--------|----------|---------|
| D1-001 | `index.ts` 259–271 | `popFsm` skipped on persist failure; pending-pop file survives session (session-scoped, not permanent — crash recovery re-reads it on next `session_start`) |
| D5-001 | `index.ts` 258–264 | `writePendingPop` before `persistRuntime`; catch never calls `deletePendingPop` |
| D5-003 | stop hook → `loadRuntime` | Stop hook reads stale disk state after persist failure → identical hash → stagnation counter increments falsely |
| D5-004 | `index.ts` 761–765 | Crash recovery pops unconditionally without `$END` verification |

**Classification**: 非决策性 — ordering is unambiguously wrong; correct order is mechanically determined.

---

### RC-B — Naive `endsWith("?")` question detection

**Root cause**: `stop-guards.ts` lines 30–36 uses `text.trim().endsWith("?")` with no awareness of code blocks. Three false-positive patterns all collapse to this single check.

**Root fix**: Strip fenced code blocks from `text` before running the question-detection heuristic.

| Member | Location | Symptom |
|--------|----------|---------|
| D2-001 | `stop-guards.ts` 30–36 | `?.` optional-chaining operator triggers stop |
| D2-002 | `stop-guards.ts` 30–36 | URL ending in bare `?` triggers stop |
| D2-003 | `stop-guards.ts` 30–36 | Code block trailing `?` triggers stop |

**Classification**: 决策性 — the heuristic is inherently fuzzy. Stripping code blocks is the obvious first step, but the boundary of "what counts as a question" is a design choice (e.g., rhetorical questions, multi-sentence turns). The fix direction is clear; the exact heuristic requires a decision.

---

### RC-C — No path containment in visualizer output

**Root cause**: `create-artifact.ts` lines 12–16, `resolveOutputPath` explicitly passes absolute paths through unchanged. No `startsWith(cwd)` guard exists anywhere. Both path-escape findings share this root.

**Root fix**: Reject absolute paths outright, or enforce `path.resolve(cwd, outputFile)` and verify the result starts with `cwd`.

| Member | Location | Symptom |
|--------|----------|---------|
| D3-001 | `create-artifact.ts` 12–16, 43 | Arbitrary file write via absolute `outputFile` (CRITICAL) |
| D3-002 | `create-artifact.ts` (no guard) | `../` traversal escapes working directory |

**Classification**: 非决策性 — path containment is a security invariant, not a design preference.

---

## 2. Standalone Confirmed Findings

Findings not subsumed by a root-cause cluster.

### D1 — NDA Regressions

#### D1-002 · NDA-06 epsilon rollback silently corrupts stack
- **Location**: `index.ts` lines 183–191 (enterStart catch), 198–205 (primary rollback catch) — 2 sites
- **Symptom**: Epsilon rollback catch block silently swallows the error; stack is left in a corrupted intermediate state with no log or re-throw.
- **Classification**: 非决策性 — silent corruption on rollback failure is unambiguously wrong.

#### D1-003 · NDA-03 lookbehind double-space bypass
- **Location**: `self-check-basic.mjs` ~lines 44–46
- **Symptom**: Lookbehind pattern does not account for multiple consecutive spaces; double-space input bypasses the check. (Uppercase path is correctly handled — text is lowercased first.)
- **Classification**: 非决策性 — the regex gap is a clear omission; the fix is a tighter pattern.

#### D1-004 · NDA-02 rubric substring false positive
- **Location**: `self-check-basic.mjs` ~line 48
- **Symptom**: `includes()` with no word-boundary check; "ok" matches inside "book", "cookbook", etc.
- **Classification**: 非决策性 — word-boundary enforcement is a clear correctness fix.

---

### D2 — Stop Hook

#### D2-004 · CONFIRM_STOP tag in code blocks triggers stop
- **Location**: `index.ts` line 49 (tag definition), line 671 (`.includes()` raw text check)
- **Symptom**: A code block containing the literal string `CONFIRM_STOP` triggers the stop hook.
- **Classification**: 决策性 — whether to strip code blocks before tag detection is a design choice (same tradeoff as RC-B; could be resolved together, but the tag-detection policy is independent of question detection).

#### D2-009 · Cross-FSM compaction cooldown bleed
- **Location**: `index.ts` line 101 (Map keyed by `sessionId`), line 652 (set), lines 673–675 (read)
- **Symptom**: All FSMs within the same session share a single compaction cooldown; one FSM's compaction suppresses compaction for all others in the session.
- **Classification**: 决策性 — per-session vs per-FSM cooldown granularity is an explicit design choice with tradeoffs (over-compaction vs under-compaction).

---

### D3 — Visualizer

#### D3-003 · CDN d3 without SRI
- **Location**: `render-html.ts` (CDN `<script>` tag, no `integrity` / `crossorigin` attributes); floating `d3@7`
- **Symptom**: No Subresource Integrity hash; CDN compromise or version drift goes undetected.
- **Classification**: 决策性 — SRI adoption is a security posture choice. Pinning the hash requires a release process decision; bundling d3 locally is an alternative. Neither is automatically correct.

#### D3-005 · TypeError crash on undeclared nextStateId
- **Location**: `label-layout.ts` (`g.setEdge` with unregistered `nextStateId`); `render-html.ts` ~line 460 (`dtgtNode` undefined → `.x` throws)
- **Symptom**: Render crashes with `TypeError` when a transition references a state not declared in the FSM node list.
- **Classification**: 非决策性 — a crash on malformed-but-plausible input is a clear bug; a guard or early validation is required.

#### D3-007 · Silent 1-of-N FSM load skip
- **Location**: `document.ts` (`continue` with no notification on single-FSM parse failure in multi-FSM document)
- **Symptom**: When one FSM in a multi-FSM document fails to parse, it is silently skipped; the visualizer renders the remaining FSMs without any indication of the omission. (All-fail case does surface an error.)
- **Classification**: 决策性 — error reporting verbosity on partial load is a design choice (silent skip vs warning vs hard fail).

#### D3-008 · Blank SVG in file mode
- **Location**: Visualizer file-mode path; no empty-states guard before render
- **Symptom**: An FSM with zero states produces a blank SVG with no error in file mode. (Session mode is protected by explicit throws in `document.ts`.)
- **Classification**: 决策性 — whether to emit an error, a placeholder, or a blank SVG for an empty FSM is a design choice.

---

### D4 — Concurrency

#### D4-001 · session_start runs without lock
- **Location**: `index.ts` `session_start` handler; calls `sweepTmpFiles` / `readPendingPop` / `popFsm` / `deletePendingPop` / `readStack` / `readState` with zero lock coverage; all other tools use `withSessionLock`
- **Symptom**: Concurrent `session_start` calls can interleave with in-progress tool calls, producing torn reads/writes.
- **Classification**: 非决策性 — omission of `withSessionLock` on `session_start` breaks the established locking contract; it is a clear bug.

---

### D5 — Cross-Module

#### D5-005 · writeTape + writeState non-atomic pair
- **Location**: tape/state write pair (post-transition tape, pre-transition state pointer)
- **Symptom**: Tape is written post-transition while the state pointer is written pre-transition; a crash between the two writes leaves them inconsistent. Code comment claims safety but the argument is flawed.
- **Classification**: 决策性 — the "tape never rolls back" design is an intentional architectural choice. Accepting the inconsistency window is a deliberate tradeoff; making the pair atomic requires a design decision (WAL, rename-swap, or single-file encoding).

---

## 3. Consolidated Classification Table

| ID | Root Cluster | 非决策性 / 决策性 | One-line rationale |
|----|-------------|------------------|--------------------|
| RC-A (D1-001, D5-001, D5-003, D5-004) | RC-A | 非决策性 | writePendingPop ordering is unambiguously wrong |
| D1-002 | — | 非决策性 | Silent stack corruption on rollback is unambiguously wrong |
| D1-003 | — | 非决策性 | Regex gap; tighter pattern is mechanically determined |
| D1-004 | — | 非决策性 | Word-boundary enforcement is a clear correctness fix |
| RC-B (D2-001, D2-002, D2-003) | RC-B | 决策性 | Question-detection heuristic boundary is a design choice |
| D2-004 | — | 决策性 | Tag detection in code blocks is a design policy choice |
| D2-009 | — | 决策性 | Per-session vs per-FSM cooldown granularity is a design choice |
| RC-C (D3-001, D3-002) | RC-C | 非决策性 | Path containment is a security invariant |
| D3-003 | — | 决策性 | SRI adoption is a security posture choice |
| D3-005 | — | 非决策性 | Crash on valid-but-incomplete input is a clear bug |
| D3-007 | — | 决策性 | Partial-load error verbosity is a design choice |
| D3-008 | — | 决策性 | Empty-FSM output behavior is a design choice |
| D4-001 | — | 非决策性 | Missing lock on session_start breaks established locking contract |
| D5-005 | — | 决策性 | Non-atomic pair is accepted by tape-never-rolls-back design |

**非决策性 total**: 7 logical items → RC-A, D1-002, D1-003, D1-004, RC-C, D3-005, D4-001
**决策性 total**: 7 logical items → RC-B, D2-004, D2-009, D3-003, D3-007, D3-008, D5-005

(Raw finding count before deduplication: 22 confirmed findings collapsed into 14 logical entries.)

---

## 4. Recommended Fix Sequencing (非决策性 only)

Priority order based on severity and dependency:

1. **RC-C** (D3-001 / D3-002) — CRITICAL security; path containment before any other visualizer work
2. **RC-A** (D1-001 / D5-001 / D5-003 / D5-004) — reorder `writePendingPop`; one change unblocks correct crash recovery across four symptoms
3. **D4-001** — wrap `session_start` in `withSessionLock`; low-effort, high-correctness gain
4. **D1-002** — add re-throw (or structured log + re-throw) at both epsilon rollback catch sites
5. **D3-005** — add `nextStateId` existence guard before `g.setEdge`; propagate error rather than crash
6. **D1-003** — tighten lookbehind regex to handle `\s+` (one-or-more spaces)
7. **D1-004** — replace `includes()` with word-boundary regex match

决策性 items require explicit design decisions before implementation; they are out of scope for the current fix pass.
