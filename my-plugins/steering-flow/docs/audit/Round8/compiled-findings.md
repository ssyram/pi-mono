# Round 8 Audit — Compiled Findings

> Sources: audit-index.md, audit-engine.md, audit-visualizer.md, audit-storage-parser.md
> Baseline: Round2/spec-gate.md, Round2/deployment-context.md
> Date: 2026-04-24

---

## Classification Legend

| Label | Meaning |
|---|---|
| **VULNERABLE / 非决策性** | Real bug, clear fix, no design input needed — implement directly |
| **VULNERABLE / 决策性** | Real bug, but fix requires a design/policy decision from human |
| **GUARDED** | Known risk, accepted by design or deployment contract |
| **DEFERRED** | Scheduled for resolution via a separate planned change |
| **NIT** | Cosmetic / low-signal, no action required |

---

## Module: index.ts

### R8-I-001 — `popFsm` recovery pops wrong FSM on `deletePendingPop` failure
**Severity:** High
**Classification:** VULNERABLE / 非决策性

**Finding:**
`popFsm` writes the `pendingPop` marker, then calls `deletePendingPop`. If `deletePendingPop` throws, the stale marker persists. On the next session open, recovery logic sees the marker and pops the stack — but it pops the current top (the parent FSM) instead of the child that was being removed. This silently corrupts the FSM stack.

**Root cause:** Recovery path does not verify that `pendingPop.fsmId` matches the current stack top before executing the pop.

**Fix:** In the recovery branch, assert `pendingPop.fsmId === stack[top].fsmId` before popping. If mismatch, log an error and clear the stale marker without popping.

**Design input needed:** None. The invariant is unambiguous — a pending pop should only be replayed for the FSM it was issued against.

---

### R8-I-002 — Abort signal checked before lock acquisition in `agent_end`
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
`agent_end` checks `ctx.signal?.aborted` before entering `withSessionLock`. By the time the lock is granted, the signal may have been set, causing a spurious "stop reminder" to be sent to an already-aborted session.

**Root cause:** Stale abort check outside the critical section.

**Fix:** Re-check `ctx.signal?.aborted` as the first statement inside the `withSessionLock` callback and return early if true.

**Design input needed:** None.

---

### R8-I-003 — Second `loadRuntime` error silently swallowed in `infoCall`
**Severity:** Low
**Classification:** NIT

**Finding:**
The second `loadRuntime` call in `infoCall` has a catch block with the comment "already surfaced above" — but this is a separate call for the top FSM, not the same call. Errors here are silently dropped.

**Disposition:** Logging gap only; no data corruption or security impact. Moved to nits.md.

---

### R8-I-004 — Orphaned FSM directory on `pushFsm` failure in `loadAndPush`
**Severity:** Low
**Classification:** VULNERABLE / 非决策性

**Finding:**
If `writeFsmStructure`, `writeState`, or `writeTape` succeed but `pushFsm` subsequently throws, the partially-written FSM directory is left on disk with no cleanup.

**Root cause:** No rollback / best-effort cleanup on the failure path.

**Fix:** Wrap the sequence in try/catch; on failure, attempt `fs.rm(fsmDir, { recursive: true, force: true })` and re-throw.

**Design input needed:** None. Orphaned dirs are unambiguously wrong; best-effort cleanup is the correct response.

---

## Module: engine.ts

### R8-E-001 — Transition log never written
**Severity:** High
**Classification:** VULNERABLE / 非决策性

**Finding:**
`transition_log` entries are built and returned by the transition chain but never appended to `runtime.transition_log`. The log is always empty at persist time.

**Root cause:** Missing `runtime.transition_log.push(...chain)` (or equivalent) after a successful transition.

**Fix:** After confirming the transition chain is committed, append all entries to `runtime.transition_log` before `persistRuntime`.

**Design input needed:** None — the log field exists precisely for this purpose.

---

### R8-E-002 — Partial epsilon hops silently discarded on rollback (interacts with R8-E-001)
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
When a rollback occurs mid-chain, partial epsilon hops already traversed are silently discarded. A naive fix for R8-E-001 (append chain on success) would correctly exclude these. However, if R8-E-001 is fixed carelessly (e.g., appending eagerly before commit confirmation), partial hops would be logged as committed transitions.

**Root cause:** Rollback path does not explicitly clear the in-progress chain before R8-E-001 is fixed.

**Fix:** Ensure the append in R8-E-001's fix only runs on the fully-committed chain, not on the pre-rollback partial chain. These two findings share a single fix site — address together.

**Design input needed:** None. The correct semantics (log only committed transitions) are unambiguous.

---

### R8-E-003 — Double `killTree` call on `"error"` event in `runCondition`
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
The `"error"` handler in `runCondition` calls `settle()` without first setting `closed = true`. Because `settle()` triggers cleanup that also calls `killTree`, and the error handler itself may call `killTree`, the tree is killed twice spuriously.

**Root cause:** Missing `closed = true` guard before `settle()` in the error handler.

**Fix:** Set `closed = true` immediately at the top of the `"error"` handler, mirroring the pattern used in other event handlers.

**Design input needed:** None.

---

### R8-E-004 — Post-interpolation `cmd` bypasses parser path validation
**Severity:** Medium
**Classification:** VULNERABLE / 决策性

**Finding:**
After LLM args are interpolated into the command string, the resulting `cmd` is executed without re-running the parser's path validation. A crafted LLM argument such as `"../../etc/passwd"` in a `"./${user_script}"` template produces a path that was never validated. `shell: false` prevents shell injection but does not prevent path traversal — the process is spawned with the attacker-controlled path directly.

deployment-context.md confirms: "Residual risk: LLM can load arbitrary YAML file (any path pi process can read)."

**Root cause:** Path validation runs on the template before interpolation; it does not run on the resolved value after interpolation.

**Why 决策性:** The fix requires a policy decision:
- Option A: Re-validate the post-interpolation `cmd` against the same path allowlist (strict, may break legitimate dynamic paths).
- Option B: Restrict interpolation to argument slots only, never to the command/path segment (requires parser schema change).
- Option C: Accept the risk as within the LLM trust boundary (explicit sign-off needed).

**Human decision required:** Which option, or whether to accept residual risk.

---

### R8-E-005 — Off-by-one in `chainEpsilon` depth cap
**Severity:** Low
**Classification:** NIT

**Finding:**
`while (depth < MAX_EPSILON_DEPTH)` caps at 63 iterations, not 64 as documented. Functionally negligible — moved to nits.md.

---

### R8-E-006 — `enterStart` silently succeeds on already-advanced runtime
**Severity:** Low
**Classification:** NIT

**Finding:**
`enterStart` does not assert that the runtime is at `$START` before proceeding. Calling it on an already-advanced runtime silently no-ops or corrupts state. Low-risk in practice (callers control this). Moved to nits.md.

---

## Module: visualizer (document.ts, render-html.ts, label-layout.ts)

### R8-V-001 — Hardcoded `$START` as `currentStateId` in file mode
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
`document.ts:103` sets `currentStateId = "$START"` unconditionally in file mode. Session mode correctly reads the persisted current state. File mode therefore always renders the diagram as if the machine is at `$START`, regardless of actual state.

**Root cause:** Missing state read in the file-mode branch.

**Fix:** In file mode, read `currentStateId` from the loaded runtime (same field session mode uses) rather than hardcoding `$START`.

**Design input needed:** None.

---

### R8-V-002 — Null-deref crash when `nodePos[s.id]` is missing in `render-html.ts`
**Severity:** High
**Classification:** VULNERABLE / 非决策性

**Finding:**
`render-html.ts:520` (and lines 436, 583–584, 591) accesses `nodePos[s.id]` without a null guard. If a state exists in the FSM but has no computed layout position (e.g., isolated node, layout failure), the renderer crashes with an uncaught TypeError.

**Root cause:** No defensive check before dereferencing layout position.

**Fix:** Guard each access: `const pos = nodePos[s.id]; if (!pos) continue;` (or equivalent skip/fallback). Apply at all four sites.

**Design input needed:** None.

---

### R8-V-003 — Null-deref crash on `d.edge.action` undefined on hover/click
**Severity:** High
**Classification:** VULNERABLE / 非决策性

**Finding:**
`render-html.ts:496, 507` accesses `d.edge.action` in hover and click handlers without checking for undefined. Transitions without an action field (valid per spec) trigger a crash in the rendered HTML.

**Root cause:** Missing optional-chaining or guard on `action`.

**Fix:** Use `d.edge.action ?? ""` (or `d.edge?.action`) at both sites.

**Design input needed:** None.

---

### R8-V-004 — Dangling transitions silently dropped in `label-layout.ts`
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
`label-layout.ts` silently drops transitions whose source or target state has no layout position (dangling transitions). No warning is emitted. The rendered diagram is incomplete with no indication to the user.

**Root cause:** Silent discard with no diagnostic output.

**Fix:** Emit a `console.warn` (or route through the existing warning plumbing) for each dropped transition, identifying the transition by name/id.

**Design input needed:** None — the existing warning plumbing is confirmed clean and available.

---

### R8-V-005 — `estimateBox` uses fixed `textLength * 7` — wrong for non-ASCII
**Severity:** Low
**Classification:** NIT

**Finding:**
`label-layout.ts` estimates label box width as `textLength * 7`. This is incorrect for CJK characters, emoji, and other wide glyphs, causing label overlap in non-ASCII diagrams. Moved to nits.md.

---

### R8-V-006 — Raw `dragNodesCode` interpolated into `<script>` block
**Severity:** Low (latent)
**Classification:** GUARDED

**Finding:**
`render-html.ts:150` interpolates `dragNodesCode` directly into a `<script>` block without escaping. Currently not exploitable because `dragNodesCode` is a static internal string, not user-controlled. All other user-facing values use `esc`/`escapeHtml`/`safeJson`.

**Disposition:** GUARDED — not exploitable under current data flow. If `dragNodesCode` ever becomes dynamic or user-influenced, this becomes a stored XSS. Noted for awareness; no immediate action required.

---

## Module: storage.ts

### R8-SP-001 — No internal lock in `storage.ts`
**Severity:** —
**Classification:** GUARDED

**Finding:**
`storage.ts` has no internal mutex.

**Disposition:** By design. `deployment-context.md` explicitly confirms the lock is held at the caller level (`withSessionLock` in `index.ts`). Storage is intentionally lock-free.

---

### R8-SP-002 — `writeState` accepts and persists unknown/invalid state IDs
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
`writeState` does not validate that the provided state ID exists in the loaded FSM structure before writing. An invalid state ID is silently persisted, corrupting the runtime.

**Fix:** Validate state ID against `fsmStructure.states` before write.

**Design input needed:** None.

---

### R8-SP-003 — `writeTape` does not enforce tape entry schema
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
`writeTape` accepts arbitrary objects as tape entries without validating required fields (e.g., `role`, `content`). Malformed entries are silently persisted.

**Fix:** Validate each entry against the tape entry schema before appending.

**Design input needed:** None.

---

### R8-SP-004 — `loadRuntime` does not validate persisted shape on read
**Severity:** Medium
**Classification:** VULNERABLE / 非决策性

**Finding:**
`loadRuntime` deserializes JSON from disk without validating the shape of the result. A corrupted or manually-edited file can produce a runtime object with missing or wrong-typed fields that propagates silently into engine logic.

**Fix:** Add a schema validation step (zod or manual guard) after JSON.parse in `loadRuntime`.

**Design input needed:** None.

---

### R8-SP-005 — Negligible TOCTOU window in `atomicWriteJson`
**Severity:** Low
**Classification:** NIT

**Finding:**
Tiny race window between temp-file write and rename. Negligible in practice given single-process, lock-held context. Moved to nits.md.

---

## Module: parser.ts (R8-SP-006 through R8-SP-012)

### R8-SP-006 through R8-SP-012 — Various parser correctness issues
**Severity:** Low–Medium
**Classification:** DEFERRED

**Finding summary:**
- R8-SP-006: Multi-document YAML (`---` separator) not supported; silently parses only first document.
- R8-SP-007: Block scalars (`|`, `>`) not parsed; silently dropped.
- R8-SP-008: Quoted strings with escape sequences (`\n`, `\t`, `\"`) not unescaped.
- R8-SP-009: Inline sequences/mappings (`[a, b]`, `{k: v}`) not supported.
- R8-SP-010: Front-matter regex requires trailing newline after closing `---`; files without it silently return null.
- R8-SP-011: `validateFlowConfig` ignores unknown top-level keys; typo in key produces unhelpful error.
- R8-SP-012: Epsilon DFS in `buildFSM` is recursive; deep chains risk stack overflow (mitigated by `MAX_YAML_DEPTH=64`).

**Disposition:** DEFERRED — the custom YAML parser is already scheduled for replacement with the `yaml` library. Fixing these individually would be wasted effort. All seven findings are resolved by the parser replacement. Track as a single deferred block.

---

## Summary Table

| ID | Module | Severity | Classification |
|---|---|---|---|
| R8-I-001 | index.ts | High | VULNERABLE / 非决策性 |
| R8-I-002 | index.ts | Medium | VULNERABLE / 非决策性 |
| R8-I-003 | index.ts | Low | NIT |
| R8-I-004 | index.ts | Low | VULNERABLE / 非决策性 |
| R8-E-001 | engine.ts | High | VULNERABLE / 非决策性 |
| R8-E-002 | engine.ts | Medium | VULNERABLE / 非决策性 (fix with R8-E-001) |
| R8-E-003 | engine.ts | Medium | VULNERABLE / 非决策性 |
| R8-E-004 | engine.ts | Medium | VULNERABLE / 决策性 |
| R8-E-005 | engine.ts | Low | NIT |
| R8-E-006 | engine.ts | Low | NIT |
| R8-V-001 | visualizer | Medium | VULNERABLE / 非决策性 |
| R8-V-002 | visualizer | High | VULNERABLE / 非决策性 |
| R8-V-003 | visualizer | High | VULNERABLE / 非决策性 |
| R8-V-004 | visualizer | Medium | VULNERABLE / 非决策性 |
| R8-V-005 | visualizer | Low | NIT |
| R8-V-006 | visualizer | Low (latent) | GUARDED |
| R8-SP-001 | storage.ts | — | GUARDED |
| R8-SP-002 | storage.ts | Medium | VULNERABLE / 非决策性 |
| R8-SP-003 | storage.ts | Medium | VULNERABLE / 非决策性 |
| R8-SP-004 | storage.ts | Medium | VULNERABLE / 非决策性 |
| R8-SP-005 | storage.ts | Low | NIT |
| R8-SP-006–012 | parser.ts | Low–Medium | DEFERRED |

---

## Action Queue

### 非决策性 VULNERABLE — implement directly (priority order)

1. **R8-V-002** — null-deref crash in render-html.ts (4 sites) — High
2. **R8-V-003** — null-deref crash on d.edge.action (2 sites) — High
3. **R8-E-001 + R8-E-002** — transition log never written + rollback interaction — High (fix together)
4. **R8-I-001** — popFsm recovery pops wrong FSM — High
5. **R8-SP-002** — writeState accepts invalid state IDs — Medium
6. **R8-SP-003** — writeTape no schema validation — Medium
7. **R8-SP-004** — loadRuntime no shape validation — Medium
8. **R8-E-003** — double killTree in runCondition error handler — Medium
9. **R8-V-001** — hardcoded $START in file mode — Medium
10. **R8-V-004** — dangling transitions silently dropped — Medium
11. **R8-I-002** — stale abort check in agent_end — Medium
12. **R8-I-004** — orphaned FSM dir on pushFsm failure — Low

### 决策性 VULNERABLE — needs human decision before implementing

1. **R8-E-004** — post-interpolation cmd bypasses path validation
   - Option A: Re-validate post-interpolation cmd against path allowlist
   - Option B: Restrict interpolation to argument slots only (parser schema change)
   - Option C: Accept as within LLM trust boundary (explicit sign-off)

### DEFERRED

- **R8-SP-006–012** — Blocked on parser replacement with `yaml` library. No action until replacement lands.

### GUARDED — no action

- R8-SP-001 (lock by design), R8-V-006 (static string, not user-controlled)
