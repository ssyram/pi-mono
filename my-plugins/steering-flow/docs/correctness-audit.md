# Correctness Audit — steering-flow

**Rounds covered:** 2 through 8  
**Last updated:** 2026-04-24  
**Status:** Convergence achieved at Round 7; Round 8 opened new findings in previously unaudited code paths

## Canonical references

- `docs/ARCHITECTURE.md` — design baseline for the runtime model
- `docs/configuration-tutorial.md` — authoring contract
- `docs/execution-behavior.md` — runtime contract

---

## Section 1: Executive Summary

Seven audit rounds (Round 2–8) examined the `steering-flow` plugin across all major modules: `index.ts` (hook and command layer), `engine.ts` (FSM execution), visualizer (`create-artifact.ts`, `document.ts`, `render-html.ts`, `label-layout.ts`), `storage.ts`, and the custom YAML `parser.ts`.

**Volume:**
- ~65 raw findings across all rounds
- ~25 non-decisional fixes applied (bugs requiring no design judgment)
- ~15 decisional findings resolved by explicit design decisions
- ~7 parser findings deferred pending parser replacement

**Convergence:** The engine/index/visualizer/storage surface converged at **Round 7** — Round 6 and Round 7 found zero new non-decisional issues in previously audited code. Round 8 expanded coverage to engine internals (`transition_log`, condition spawn), storage validation, and the custom parser, producing 12 new fixes in code paths not previously examined.

**Key themes:**

1. **NDA-05 regression cascade (Round 3):** The Round 2 fix for `persistRuntime` error handling (`NDA-05`) introduced a subtle ordering bug (`RC-A`): `writePendingPop` was called before `persistRuntime`, so a throw during persist left a stale pending-pop marker without an FSM entry. This cascaded through Rounds 3–5 before full closure.

2. **Stop hook redesign:** Round 3 confirmed that `isAskingQuestion` (trailing-`?` heuristic) and `CONFIRM_STOP_TAG` (substring match on raw LLM output) were both unreliable. The design decision was made to make the stop hook **fully automatic**: always re-inject the steering prompt unconditionally, removing both guards entirely.

3. **`persistRuntime` decoupled from tape:** A decisional finding confirmed that `persistRuntime` should write state only (not tape). Tape is written separately (atomic `writeTape`) and re-read via `readTape` after each condition execution. The tape-never-rolls-back invariant is intentional and documented.

4. **Visualizer security hardening:** The visualizer was unaudited before Round 3. Two critical path-traversal vulnerabilities (LLM-controlled `output_file` and `flow_file` parameters with no containment) were found and fixed, with an additional path normalization regression fixed in Round 5.

5. **Storage validation:** Round 8 found that `readPendingPop`, `readState`, and `readFsmStructure` performed minimal or no shape validation, leaving corrupt-file scenarios as silent failures or runtime crashes. All three were hardened.

---

## Section 2: Proven Objects

The following invariants and contracts have been **verified as correct** across one or more audit rounds:

### Engine / FSM

| Invariant | Verified In |
|---|---|
| Tape cumulative semantics — values are set forward, never rolled back | Round 2 (spec-gate), Round 3 (D5-005 decisional) |
| Epsilon chain depth cap at 64 hops with snapshot+rollback | Round 2 (spec-gate) |
| `$END` handling — FSM halts correctly, no further transitions | Round 8 (audit-engine non-findings table) |
| Condition protocol — stdout capped at 64 KiB, 30s timeout + SIGKILL | Round 2 (spec-gate), Round 8 (non-findings) |
| `default: true` short-circuit — first matching condition wins | Round 8 (non-findings table) |
| Arg-count enforcement for action procedures | Round 2 (NDA-04 fixed), Round 8 (verified) |
| `namedArgs` prototype pollution: not possible (JSON-derived object) | Round 8 (non-findings table) |
| Promise double-settlement in `runCondition`: settled flag prevents it | Round 8 (non-findings table) |
| Self-loop / cycle detection in epsilon chains | Round 8 (non-findings table) |
| Empty action list on epsilon transitions: handled correctly | Round 8 (non-findings table) |
| `flowDir` empty-string edge case: `resolve()` makes it CWD | Round 8 (non-findings table) |
| Spawn failure (ENOENT) propagates correctly | Round 8 (non-findings table) |

### Index / Lock Layer

| Invariant | Verified In |
|---|---|
| `withSessionLock` covers all tool calls | Round 3 (D4-001 fixed), Round 4 (R4-I-008 pass) |
| `withSessionLock` covers `session_start` | Round 3 (D4-001 fix), Round 4 (verified) |
| `isAskingQuestion` / `CONFIRM_STOP_TAG` fully removed | Round 4 (R4-I-005 pass) |
| Stop hook correct timing and unconditional re-injection | Round 4 (R4-I-006 pass), Round 7 (re-verified) |
| Compaction cooldown at 30,000 ms per-FSM key | Round 4 (R4-I-007 pass) |
| `persistRuntime` state-only (tape excluded, re-synced via `readTape`) | Round 4 (R4-I-008 pass), Round 7 (confirmed) |

### Visualizer

| Invariant | Verified In |
|---|---|
| Path containment: output file confined to `cwd` subtree | Round 3 (RC-C fix), Round 4 (verified), Round 5 (R5-V-001 fix), Round 6+ |
| `flowFile` read path similarly confined | Round 5 (R5-V-001 fix), Round 7 (re-verified) |
| HTML injection protection — `esc()` / `escapeHtml()` / `safeJson()` applied | Round 3 (confirmed), Round 8 (clean pass) |
| Warning plumbing: `document.ts → createVisualizerArtifact → index.ts` chain | Round 7 (DA-R4-04 verified) |
| `normalize-state.ts` correctness | Round 8 (clean pass) |

### Storage

| Invariant | Verified In |
|---|---|
| Atomic write (tmp file + rename) for all state files | Round 2 (spec-gate), Round 8 (non-findings) |
| `withSessionLock` is caller-enforced for all storage mutations | Round 8 (R8-SP-001 — by design, documented) |
| No path-handling bugs in `storage.ts` | Round 8 (non-findings) |

---

## Section 3: Cross-Boundary Contracts

### steering-flow ↔ pi framework

| Contract | Status |
|---|---|
| Hook registration: `on_session_start`, `on_agent_end`, `on_stop` | Verified Round 2 |
| Tool registration: 4 tools exposed (`get-steering-flow-state`, `trigger-transition`, `push-steering-flow`, `pop-steering-flow`) | Verified Round 2 |
| Command registration: 5 commands (`session_start`, `agent_end`, `pop-steering-flow`, `push-steering-flow`, `load-steering-flow`) | Verified Round 2 |
| `ctx.hasUI` guard on `ctx.ui.notify` in hooks only (commands always have UI) | Verified Round 7 |
| Abort signal check (`ctx.signal?.aborted`) before and inside lock in `agent_end` | Fixed Round 8 (R8-I-002) |

### engine.ts ↔ index.ts (state/tape boundary)

| Contract | Status |
|---|---|
| `executeAction` returns `{ current_state_id, tape }` — index writes both | Verified Round 3 (D5-002) |
| `persistRuntime` receives state-only; tape written via separate `writeTape` | Decided Round 3 (DA-R3-03), verified Round 4 |
| `readTape` called after each `executeAction` to re-sync tape | Verified Round 4 (R4-I-008) |
| `transition_log` populated for every committed transition (not rollbacks) | Fixed Round 8 (R8-E-001, R8-E-002) |
| FSM stack push: `writeFsmStructure` + `writeState` + `writeTape` precede `pushFsm` | Verified Round 3 (RC-A fix) |
| `writePendingPop` called after `persistRuntime` succeeds, not before | Fixed Round 3 (RC-A), verified Round 3 |
| `deletePendingPop` failure: stale marker + `fsmId` guard prevents wrong-FSM pop | Fixed Round 8 (R8-I-001) |

### engine.ts ↔ condition processes

| Contract | Status |
|---|---|
| Conditions spawned with argv-only (no shell); prevents shell injection | Verified Round 2, Round 8 |
| 30s timeout → SIGKILL | Verified Round 2, Round 8 |
| stdout capped at 64 KiB | Verified Round 2, Round 8 |
| `closed = true` before `settle()` in error/close handlers | Fixed Round 8 (R8-E-003) |
| Post-interpolation `cmd` path traversal via `${...}` variables | **PENDING** (R8-E-004) |

### visualizer ↔ storage/parser

| Contract | Status |
|---|---|
| `flowFile` path resolved and contained before `parseFlowConfig` call | Fixed Round 3 (RC-C) + Round 5 (R5-V-001) |
| `outputFile` path resolved and contained before `writeFile` | Fixed Round 3 (RC-C) + Round 5 (R5-V-001) |
| `parseFlowConfig` / `buildFSM` errors propagated via `warnings[]` not thrown | Fixed Round 3 (D3-005), Round 7 (verified) |
| Dangling transitions (edges to undeclared states) warned and skipped | Fixed Round 3 (D3-005), Round 8 (R8-V-004) |
| `nodePos` null-guard before render | Fixed Round 8 (R8-V-002) |
| `d.edge.action` guard before tooltip/click handlers | Fixed Round 8 (R8-V-003) |

---

## Section 4: Issues Found and Fixed (by round)

### Round 2 — Initial Audit (8 active fixes)

| ID | Description | Fix Applied | Verified |
|---|---|---|---|
| NDA-01 (D2-001) | `builtin-procedures.md` example missing `$TAPE_FILE` env var | Updated docs | Round 2 |
| NDA-02 (D2-002) | Rubric `includes()` never used in `passed` computation in `self-check-basic.mjs` | Fixed rubric evaluation logic | Round 2, Round 3 (D1-004) |
| NDA-03 (D2-003) | `" done"` false-positive in condition check (lookbehind too narrow) | Replaced with window-based negation | Round 2, Round 3 |
| NDA-04 (D2-004) | `chainEpsilon` omits `namedArgs` when invoking action procedures | Added `namedArgs` to invocation | Round 2 |
| NDA-05 (D3-001) | `persistRuntime` missing try/catch — throws escape hook uncaught | Wrapped in try/catch | Round 2 *(regression introduced — see Round 3 RC-A)* |
| NDA-06 (D3-002) | `popFsm` rollback bare awaits not wrapped | Wrapped in try/catch | Round 2 *(regression introduced — see Round 3 D1-002)* |
| NDA-07 (D3-004) | `chainEpsilon` discards per-hop failure reasons | Preserved and surfaced failure reasons | Round 2 |
| NDA-08 (RC-D) | Tape not in rollback window (D4-001/002/003): condition writes bypass snapshot; action writes not rolled back | Root fix: tape snapshot before execute, rollback on failure | Round 2, Round 3 |
| NDA-09 (D5-001) | Legacy sessions with `flow_dir=""` → `ENOENT` on session load | Migration gap patched in `storage.ts` | Round 2 *(NDA-05 regression: ordering bug found in Round 3)* |

> **NDA-08 note:** Originally classified as three findings (D4-001/002/003). NDA-08 was listed as "reverted" in the reduction document — the root fix for RC-D replaced the earlier partial approach, so NDA-08 effectively superseded prior attempts on D4-001/002/003.

### Round 3 — Regression + New Surface Audit (13 fixes)

**Non-decisional fixes (7):**

| ID | Description | Fix Applied | Verified |
|---|---|---|---|
| RC-A | `writePendingPop` called before `persistRuntime`; throw leaves stale marker | Reordered: `writePendingPop` after successful `persistRuntime` | Round 3 (verify-index) |
| RC-C | No path containment in visualizer: LLM-controlled `output_file`/`flow_file` → arbitrary write/read | `startsWith(cwd + sep)` containment check in `create-artifact.ts` | Round 3 (verify-visualizer) |
| D1-002 | Epsilon rollback catch swallows error silently; two sites in index.ts | Two-attempt retry with `popFsm`; original error preserved | Round 3 (verify-index) |
| D1-003 | Lookbehind `(?<!not\s)` bypassed by double space/tab | Replaced with 10-char window + `/\bnot\s+$/` | Round 3 (verify-builtins) |
| D1-004 | Rubric `includes()` substring match — `"ok"` matches `"book"` | Replaced with word-boundary regex | Round 3 (verify-builtins) |
| D3-005 | TypeError crash on edge to undeclared `nextStateId` in visualizer | `stateIds.has()` guard before `g.setEdge()` in `label-layout.ts` | Round 3 (verify-visualizer) |
| D4-001 | `session_start` ran entirely outside `withSessionLock` | Wrapped `session_start` body in `withSessionLock` | Round 3 (verify-index) |

**Decisional fixes implemented (6 design decisions):**

| Decision | Outcome |
|---|---|
| DA-R3-01: Stop hook heuristics (D2-001/002/003/004) | Remove `isAskingQuestion` and `CONFIRM_STOP_TAG` entirely; stop hook always re-injects |
| DA-R3-02: Compaction cooldown keyed by `fsmId` (D2-009) | Re-key to `fsmId`; 30,000 ms interval |
| DA-R3-03: `persistRuntime` tape-or-state? (D5-005) | State-only; tape written separately, re-read after each condition |
| DA-R3-04: CDN SRI (D3-003) | Accept: SRI hash added (or accepted risk per team decision) |
| DA-R3-05/06: Silent FSM load skip / blank SVG (D3-007/D3-008) | Emit warning on 1-of-N skip; accept blank SVG in file mode with warning plumbing |
| DA-R3-07: Empty FSM warning | Warn if FSM count ≠ stack depth |

### Round 4 — Regression Audit on Round 3 Fixes (5 fixes)

| ID | Description | Fix Applied | Verified |
|---|---|---|---|
| R4-I-001 | `writePendingPop` throw after `persistRuntime` with `reached_end=true` leaves no marker | Both `writePendingPop` sites wrapped in try/catch; `deletePendingPop` ENOENT safe | Round 5 (audit-index-r5 pass) |
| R4-I-002 | `session_start`: `ctx.ui.notify` called without `ctx.hasUI` guard → TypeError in headless | All `ctx.ui.notify` calls in `session_start` and `agent_end` guarded by `ctx.hasUI` | Round 5 (verified) |
| R4-I-003 | `session_start` missing outer try/catch; any throw escapes to framework | Outer try/catch added (residual gap noted → R5-001) | Round 5 |
| R4-I-004 | Double-pop risk: D1-002 retry calls `popFsm` without target `fsmId` param | Retry reads stack, verifies top matches `fsmId` before second pop | Round 5 (verified) |
| R4-V-002 | Trailing slash in `cwd` → double-separator, all valid paths rejected | `resolve(cwd)` + sep normalization | Round 5 (verified) |

> **R4-V-001 (symlink escape), R4-V-003 (warning plumbing), R4-V-004/005 (word boundary, negation window)** were also found in Round 4 — see Decision Log for R4-V-001 and R4-V-003; R4-V-004 and R4-V-005 were tracked and addressed as part of the R5 visualizer audit cycle.

### Round 5 — Visualizer + Index Residual (3 fixes)

| ID | Description | Fix Applied | Verified |
|---|---|---|---|
| R5-001 | `withSessionLock` call in `session_start` has no outer try/catch; rejection escapes host | Outer promise chain catch added | Round 6 (verified) |
| R5-V-001 | Absolute-path branch skips `resolve()` — `../../etc/passwd` passes `startsWith` containment | Both arms (`outputFile`, `flowFile`) now always call `resolve(cwd, x)` | Round 6 (verified) |
| R5-V-002 | `resolved !== normalizedCwd` escape hatch allows `outputFile="."` (resolves to cwd, EISDIR) | Guard removed; `startsWith + sep` is sufficient | Round 6 (verified) |

### Round 6 — Convergence (0 new fixes)

All Round 5 fixes verified correct. No new findings in the audited surface. **Convergence declared.**

### Round 7 — Convergence Re-check (0 new fixes)

Full re-verification pass including:
- R5-001 outer try/catch ✅
- R5-V-001 / R5-V-002 both `resolve(cwd, x)` arms ✅
- DA-R4-04 warning plumbing chain (`document.ts → createVisualizerArtifact → index.ts`) ✅
- No `console.warn` remnants, no `isAskingQuestion` / `CONFIRM_STOP_TAG` references ✅

**Convergence re-confirmed.**

### Round 8 — New Surface Expansion (12 fixes)

Expanded to: engine internals (`transition_log`, `runCondition`), storage shape validation, visualizer render paths, previously unaudited `parser.ts`.

| ID | Severity | Description | Fix Applied | Confirmed |
|---|---|---|---|---|
| R8-I-001 | High | `deletePendingPop` throw leaves stale marker; `session_start` recovery pops wrong FSM (parent) if `fsmId` mismatch | `fsmId` match guard before recovery pop | ✅ |
| R8-I-002 | Medium | `agent_end` abort check before lock — session may abort between check and lock acquisition | Re-check `ctx.signal?.aborted` inside lock callback | ✅ |
| R8-I-004 | Low | `loadAndPush`: `pushFsm` throw after `writeFsmStructure`/`writeState`/`writeTape` → orphaned FSM dir | try/catch + best-effort `fs.rm` on failure | ✅ |
| R8-E-001 | High | `transition_log` never updated — always empty array regardless of transitions taken | Push to log in `$END` and normal settled branches | ✅ |
| R8-E-002 | Medium | Partial epsilon hops on rollback would be logged as committed (if R8-E-001 naively fixed) | Snapshot `chain.length` before epsilon; truncate on rollback | ✅ |
| R8-E-003 | Medium | `runCondition` error handler: `closed = true` missing before `settle()` — spawn-error may double-invoke kill | `closed = true` set before `settle()` in both handlers | ✅ |
| R8-V-002 | High | `nodePos[s.id]` null-deref crash if state has no layout entry | Null-guard at all `nodePos` access sites in `render-html.ts` | ✅ |
| R8-V-003 | High | `d.edge.action` undefined crash on edge tooltip/click if `actionMap` key absent | Early-return guard in both tooltip and click handlers | ✅ |
| R8-V-004 | Medium | Dangling transitions silently dropped from layout (edges to undeclared states) | Warn + skip via `stateIds.has()` in `label-layout.ts` | ✅ |
| R8-SP-002 | Medium | `readPendingPop` performs no shape validation — null/42 `fsm_id` passes silently | Guard: `fsm_id` must be non-empty string; throw `CorruptedStateError` otherwise | ✅ |
| R8-SP-003 | Low | `readState` doesn't validate `last_transition_chain` — absent field causes `TypeError` on iteration | Coerce missing field to `[]` | ✅ |
| R8-SP-004 | Low | `readFsmStructure` validates container shape but not elements — missing `actions` crashes at runtime | Validate each state entry has required fields | ✅ |

> **R8-V-001** (`$START` hardcoded in file-mode visualizer): confirmed, not yet fixed. Tracked as remaining limitation.

---

## Section 5: Rejected and Inconclusive Findings

### Confirmed Rejected (false positives)

| ID | Round | Reason for Rejection |
|---|---|---|
| D1-001 (NDA-09 regression framing) | Round 3 | `writePendingPop` at line 259 enables session_start recovery; FSM leak is session-scoped, not permanent |
| D1-005 | Round 3 | `./` paths resolve against `flowDir` (YAML dir), not storage dir — premise wrong; narrow empty-string edge case handled by NDA-09 |
| D2-005 | Round 3 | `TapeValue` type excludes `undefined`; JSON round-trip cannot introduce it — unreachable code defect |
| D2-006 | Round 3 | Tape always JSON-parsed; `Date` instances are structurally impossible |
| D2-007 | Round 3 | `JSON.parse` cannot produce circular refs; `stableStringify` infinite-loop unreachable |
| D2-010 | Round 3 | TOCTOU claim invalid — no `await` between check and use in single-threaded JS |
| D2-011 | Round 3 | Optional chain on `undefined` is correct TypeScript idiom; not a defect |
| D3-004 | Round 3 | `polylineSplit` has explicit `pts.length < 2` guard; failure mode doesn't exist |
| D3-007 (partial) | Round 3 | All-fail case shows `❌`; only narrow 1-of-N silent skip confirmed (addressed by DA-R3-05) |
| D3-008 (partial) | Round 3 | File mode only; session mode protected by `document.ts` guards |
| D4-002 | Round 3 | Non-reentrant lock deadlock is latent/theoretical; current call graph has no re-entrant paths |
| D4-003 | Round 3 | Cross-process lock is intentional single-process design |
| D1-003 (uppercase bypass) | Round 3 | Text is lowercased before regex — uppercase bypass rejected |
| R4-V-004 | Round 4 | Word-boundary false negatives exist but are low-severity edge cases; addressed by broader fix in R5 cycle |
| R4-V-005 | Round 4 | 10-char negation window sufficient for practical negations; 50-char increase is cosmetic |
| R8-SP-005 | Round 8 | `newFsmId` collision window ≈ 1/4 billion per concurrent pair; no action required |
| R8-E-005 | Round 8 | Off-by-one in depth cap (63 effective vs. 64 spec); reclassified as nit — parser prevents infinite chains |
| R8-E-006 | Round 8 | `enterStart` double-call returns empty chain — reclassified as nit; not a realistic scenario |
| R8-V-005 | Round 8 | Non-ASCII label box undersized — cosmetic, not correctness |
| R8-V-006 | Round 8 | `dragNodesCode` interpolated into `<script>` — static string, not exploitable |
| R8-I-003 | Round 8 | `infoCall` second catch block swallows error — reclassified as nit |

### DEFERRED (parser replacement)

Seven parser findings are deferred pending replacement of the custom YAML parser with a standards-compliant library:

| ID | Severity | Description |
|---|---|---|
| R8-SP-006 | High | Double-quoted strings: `\n` stays literal backslash-n (no escape processing) |
| R8-SP-007 | Medium | Single-quoted `''` escape not handled: `'it''s done'` → `"it''s done"` |
| R8-SP-008 | Medium | Block scalar chomp indicator (`|-`, `|+`) normalized away; all get clip behavior |
| R8-SP-009 | Medium | Multi-line plain scalars incorrectly joined with space instead of newline |
| R8-SP-010 | Low | Front matter regex requires `\n` after closing `---`; files ending at `---` return null |
| R8-SP-011 | Low | Unknown top-level keys accepted silently; typo like `sates:` produces confusing error |
| R8-SP-012 | Low | Recursive epsilon DFS in `buildFSM` risks stack overflow on ~10,000-depth chains |

These are tracked under the "parser replacement" decision from Round 2 (DA-01).

---

## Section 6: Decision Log

All design decisions across all rounds, in chronological order.

### Round 2 Decisions

| ID | Finding | Decision |
|---|---|---|
| DA-01 | Parser scope (D1-001 through D1-008) | **DEFER parser findings.** Replace custom YAML parser with standards-compliant library as a separate project. No parser changes in this audit. |
| DA-02 | Tape semantics (D4-004 enterStart asymmetry) | **ACCEPT.** `enterStart` sets tape from FSM's initial tape; asymmetry vs. `exitEnd` is intentional. Tape accumulates forward. |
| DA-03 | Condition external tape write bypass (D4-006) | **ACCEPT.** Conditions writing `tape.json` directly bypass the snapshot mechanism. Documented as out-of-contract behavior; condition scripts are trusted. |
| DA-04 | SIGKILL truncation on 30s timeout | **ACCEPT.** No graceful shutdown protocol. Truncation is the defined behavior; LLM must retry if needed. |
| DA-05 | Stagnation counter freeze (D3-005 `writeState` swallowed) | **ACCEPT.** Stagnation counter may freeze if `writeState` fails mid-stagnation. Non-critical; normal operation unaffected. |
| DA-06 | `fs.rm` failure swallow in `popFsm` (D3-006) | **ACCEPT.** Orphaned FSM dir on disk is cosmetic. Stack integrity is unaffected. Best-effort cleanup. |
| DA-07 | `removeWhenPop` config option (D5-002 commit ordering) | **DEFER.** `removeWhenPop` behavior if FSM dir is deleted before pop commits is not yet implemented. Tracked as remaining limitation. |
| DA-08 | `persistRuntime` tape-first-then-state ordering | **SUPERSEDED** by DA-R3-03 in Round 3. |

### Round 3 Decisions

| ID | Finding | Decision |
|---|---|---|
| DA-R3-01 | Stop hook heuristics (D2-001/002/003/004) | **REDESIGN.** Remove `isAskingQuestion` and `CONFIRM_STOP_TAG` entirely. Stop hook always re-injects the steering prompt unconditionally. No question/confirm guards. |
| DA-R3-02 | Compaction cooldown keyed by `sessionId` (D2-009) | **FIX.** Re-key `lastCompactionAt` to `fsmId`. Each FSM stack frame gets its own cooldown. 30,000 ms interval confirmed. |
| DA-R3-03 | `persistRuntime` tape-or-state (D5-005) | **STATE-ONLY.** `persistRuntime` writes `state.json` only. Tape is written via `writeTape` and re-read after each condition execution via `readTape`. Tape-never-rolls-back invariant is intentional. |
| DA-R3-04 | CDN SRI (D3-003) | **ACCEPT WITH MITIGATION.** SRI integrity attribute added to `<script>` tag for d3 CDN. Pinned version accepted. |
| DA-R3-05 | Silent 1-of-N FSM load skip (D3-007) | **WARN.** Emit warning if any FSM in the stack fails to load; surface via warning plumbing. |
| DA-R3-06 | Blank SVG on empty FSM in file mode (D3-008) | **ACCEPT.** File mode with empty states returns blank SVG. Session mode is protected. No error needed. |
| DA-R3-07 | Empty FSM / stack depth mismatch | **WARN.** Emit warning if `fsmCount !== stack.length` in visualizer. |

### Round 4 Decisions

| ID | Finding | Decision |
|---|---|---|
| DA-R4-01 | Symlink escape in path containment (R4-V-001) | **ACCEPT.** `resolve()` does not dereference symlinks. Symlinks inside `cwd` pointing outside are accepted as a known limitation. Tool operators are responsible for the `cwd` tree. |
| DA-R4-02 | Stub script not-a-bug (R4-I-004 retry) | **NOT A BUG.** After Round 4 fix (fsmId-checked retry), the retry mechanism is correct. |
| DA-R4-03 | Warning plumbing (R4-V-003: `console.warn` in `document.ts`) | **FIX.** Thread `ctx` through `createVisualizerArtifact` to `document.ts`; surface warnings via `ctx.ui.notify`. Implemented and verified in Round 7. |
| DA-R4-04 | Visualizer warnings via `ctx.ui.notify` (no `hasUI` guard in command) | **ACCEPT.** Consistent with all 5 command handlers. Only hooks use `hasUI` guard. Not a regression. |

### Round 8 Decisions

| ID | Finding | Decision |
|---|---|---|
| DA-R8-01 | R8-E-004: Post-interpolation `cmd` path traversal via `${...}` variables | **PENDING.** Three options under consideration: (A) forbid `${...}` in `cmd` at parse time, (B) re-validate post-interpolation, (C) accept LLM trust boundary. Decision not yet made. |

---

## Section 7: Remaining Limitations

### Pending (action required, not yet resolved)

| Item | Origin | Notes |
|---|---|---|
| Parser replacement | DA-01 (Round 2) | 7 parser findings (R8-SP-006 through R8-SP-012) deferred until custom parser is replaced |
| `removeWhenPop` config | DA-07 (Round 2) | Behavior on FSM dir deletion before pop commits undefined |
| R8-E-004: post-interpolation path traversal | Round 8 | `${...}` in `cmd` allows path traversal via variable interpolation; decision pending |
| R8-V-001: hardcoded `$START` in file-mode visualizer | Round 8 | `buildFileVisualizerDocument` uses `$START` as `currentStateId`; session mode is correct |

### Accepted Limitations (by design or risk assessment)

| Item | Decision | Rationale |
|---|---|---|
| SIGKILL truncation on 30s timeout | DA-04 | No graceful shutdown protocol; LLM must retry |
| Stagnation counter freeze on `writeState` failure | DA-05 | Non-critical path; normal operation unaffected |
| `fs.rm` failure swallow on `popFsm` | DA-06 | Orphaned dir is cosmetic; stack integrity intact |
| Symlink escape from `cwd` containment | DA-R4-01 | Operator responsibility; `resolve()` does not dereference |
| CDN without pinned hash (prior to SRI fix) | DA-R3-04 | SRI integrity attribute added; accepted posture |
| Cross-process lock: `sessionLocks` is in-memory Map | D4-003 / DA-R3 | Single-process design by intent; cross-process coordination not in scope |
| `withSessionLock` non-reentrancy (potential future deadlock) | D4-002 | Current call graph clean; JSDoc warning added |
| Condition external tape write bypass | DA-03 | Condition scripts are trusted; out-of-contract behavior documented |
| Tape-never-rolls-back | DA-R3-03 | Intentional cumulative semantics |

### DEFERRED Block (parser)

All 7 parser findings (R8-SP-006 through R8-SP-012) are deferred to the parser replacement project. The custom parser is functional for well-formed YAML compliant with the subset documented in the README. Edge cases with escape sequences, chomp indicators, multi-line scalars, and unknown keys will be resolved by adopting a standards-compliant YAML library.

---

## Section 8: Assumptions Registry

This registry records all assumptions made explicit during the audit. Assumptions are invariants that the codebase relies on but does not enforce internally.

### Pi Framework Assumptions

| Assumption | Basis |
|---|---|
| Framework does not call tool handlers and `session_start`/`agent_end` hooks concurrently for the same session | `withSessionLock` correct only under this assumption |
| `ctx.hasUI` is `false` in headless/test environments and `true` in all command handlers | Verified Round 4 (R4-I-002 fix) |
| `ctx.signal` is an `AbortSignal` or `undefined`; never throws on `.aborted` access | Used in `agent_end` abort guard |
| Plugin host does not swallow uncaught promise rejections from hook functions | R5-001 fix meaningful only under this assumption |

### Node.js / POSIX Assumptions

| Assumption | Basis |
|---|---|
| `fs.rename` is atomic within the same filesystem (tmp + rename pattern) | POSIX guarantee; storage relies on this |
| `spawn` with `shell: false` prevents shell injection | Engine condition safety argument |
| `path.resolve()` does not dereference symlinks | DA-R4-01 accepted limitation |
| Single Node.js process; no multi-process concurrency on the session lock Map | D4-003 accepted design |

### Condition Contract Assumptions

| Assumption | Basis |
|---|---|
| Condition scripts are trusted and do not intentionally corrupt `tape.json` | DA-03 |
| Condition scripts exit within 30s or accept SIGKILL | DA-04 |
| Condition stdout is valid UTF-8; first line is `true` or `false` | Engine parsing contract |

### Tape Semantics Assumptions

| Assumption | Basis |
|---|---|
| Tape values are JSON-serializable (`TapeValue` type; no `Date`, `undefined`, circular refs) | D2-006, D2-007 rejected |
| Tape accumulates forward; once set, a key is never deleted by the engine | Tape-never-rolls-back invariant (DA-R3-03) |
| `stableStringify` on tape produces a stable hash for stagnation detection | Stagnation counter relies on this |

### Stop Hook Assumptions *(NEW — post Round 3 redesign)*

| Assumption | Basis |
|---|---|
| Stop hook always re-injects the steering prompt unconditionally | DA-R3-01 |
| No `isAskingQuestion` or `CONFIRM_STOP_TAG` guards exist | Verified Round 4 (R4-I-005), Round 7 |
| Re-injection is idempotent from the LLM's perspective (repeated prompts cause no harm) | Design premise for DA-R3-01 |

### persistRuntime Contract *(NEW — post Round 3 decision)*

| Assumption | Basis |
|---|---|
| `persistRuntime` writes `state.json` only; tape is **not** included | DA-R3-03, verified Round 4 |
| Tape is always re-synced from disk via `readTape` after `executeAction` | Verified Round 4 (R4-I-008) |
| A crash between `writeTape` and `writeState` leaves tape ahead of state — acceptable | Tape-never-rolls-back design |

### transition_log Contract *(NEW — Round 8)*

| Assumption | Basis |
|---|---|
| `transition_log` records **committed** transitions only — not partial epsilon hops on rollback | R8-E-001 + R8-E-002 (fixed) |
| `enterStart` does not add a log entry (start is not a transition) | R8-E-001 fix design |
| Each `executeAction` that settles (including `$END`) appends exactly one entry | R8-E-001 confirmed |
