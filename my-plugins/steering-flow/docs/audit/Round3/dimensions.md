# Round 3 Audit Dimensions — Hoare Audit: steering-flow

**Date:** 2026-04-24
**Auditor:** Sisyphus-Junior
**Scope:** Fresh angles not covered in Round 2 + regression analysis of NDA-01–09 fixes (NDA-08 reverted).

---

## Dimension 1 — Regression Analysis of Round 2 Fixes (NDA-02/03/04/05/06/07/09)

**Priority:** HIGH — fixes that introduce new bugs are worse than the original defects.

### Target Files
- `builtins/self-check-basic.mjs` (NDA-02, NDA-03)
- `engine.ts` (NDA-04, NDA-07)
- `index.ts` (NDA-05, NDA-06, NDA-09)
- `storage.ts` (NDA-09)

### Functions Under Scrutiny
- `self-check-basic.mjs`: success-marker detection loop, rubric satisfaction check
- `engine.ts:chainEpsilon`: `runCondition(..., {})` empty-namedArgs call (NDA-04), `failReasons[]` accumulation (NDA-07)
- `index.ts:agent_end` outer try/catch (NDA-05/06), `infoCall` (NDA-06)
- `storage.ts:loadRuntime` `flow_dir ?? fsmDir(...)` fallback (NDA-09)

### Pre/Post/Invariant Violations to Look For

**NDA-02 (rubric substring match):**
- Pre: rubric item is a non-empty string from LLM-supplied YAML args.
- Violation: `text.includes(item.trim().toLowerCase())` is a substring match — rubric item `"ok"` matches `"book"`, `"token"`, `"workflow"`. Short or common rubric items produce false positives. The fix replaced word-boundary matching with a weaker check.
- Invariant broken: `rubricSatisfied = true` must mean the LLM text semantically satisfies every rubric item; substring containment does not guarantee this.

**NDA-03 (lookbehind `(?<!not\s)`):**
- Pre: `text` is lowercased LLM self-assessment.
- Violation 1: `\s` matches exactly one whitespace character. `"not  done"` (two spaces) bypasses the guard — lookbehind fails to match, marker is accepted as positive.
- Violation 2: `"not been done"`, `"not yet done"`, `"not fully done"` — any word between `"not"` and the marker bypasses the single-char lookbehind.
- Post broken: `markerFound = true` must mean the marker is asserted positively; the lookbehind is too narrow to catch common negation patterns.

**NDA-04 (epsilon namedArgs `{}`):**
- Pre: `chainEpsilon` calls `runCondition(cmd, configArgs, {})` with empty namedArgs.
- Check: does any builtin or user condition script rely on receiving named args during epsilon evaluation? If a condition script reads `process.env` or argv for named args and gets nothing, it may silently return `false` where it previously received inherited context. Verify no regression in `submit-required-fields.mjs` (uses `${$TAPE_FILE}` which is a configArg, not a namedArg — should be unaffected).

**NDA-07 (failReasons accumulation):**
- Pre: `failReasons` is declared before the epsilon action loop; each rejected action pushes its reason.
- Violation: `failReasons` is never reset between retry iterations if `chainEpsilon` is called recursively (it is not — depth-limited DFS, not retry). Confirm no double-accumulation across the depth stack.
- Post: error message must contain only reasons from the current call frame's actions, not from parent frames.

**NDA-05/06 (agent_end error handling):**
- Pre: `agent_end` hook must never throw (spec-gate: "hook errors silently swallowed").
- Check: the outer `catch (e)` at line ~744 calls `ctx.ui.notify(...)` — but `ctx.hasUI` guard is checked first. If `ctx.hasUI` is false (headless session), the error is fully swallowed with no log. Confirm this is acceptable per spec or is a silent regression.
- Invariant: `index.ts:351` bare `catch {}` (inside `infoCall` best-effort top-FSM render) — no log, no notify. Confirm this is the intended "already surfaced above" path and not a new silent swallow introduced by NDA-06 restructuring.

**NDA-09 (flow_dir fallback):**
- Pre: `loadRuntime` returns `runtime.flow_dir ?? fsmDir(sessionDir, fsmId)`.
- Violation: `fsmDir(sessionDir, fsmId)` is an absolute path to the FSM directory, not the original flow file's directory. For migrated sessions where `flow_dir` was never stored, condition scripts using `./`-relative paths will resolve against the FSM storage dir (inside `.pi/`) rather than the user's project directory — silently wrong resolution, not an error.
- Post broken: `runtime.flow_dir` must be the directory containing the `.flow.md`/`.flow.yaml` file; the fallback value violates this postcondition for migrated sessions.

---

## Dimension 2 — Stop Hook Correctness

**Priority:** HIGH — the stop hook is the primary flow-enforcement mechanism; incorrect behavior lets the LLM escape the flow silently.

### Target Files
- `index.ts` (agent_end hook, stagnation logic, compaction cooldown)
- `stop-guards.ts` (`wasAborted`, `isAskingQuestion`)

### Functions Under Scrutiny
- `agent_end` hook: full decision chain (signal abort → wasAborted → isAskingQuestion → CONFIRM_STOP_TAG → compaction cooldown → stagnation)
- `isAskingQuestion`: text-ends-with-`?` heuristic, `toolCall.name === "question"` branch
- Stagnation: hash computation, counter increment, `writeState` with `preserve_entered_at`, `pi.sendUserMessage` reminder
- `lastCompactionAt`: module-level Map, cleared in `session_start`

### Pre/Post/Invariant Violations to Look For

**isAskingQuestion heuristic:**
- Pre: `last.content` is an array of content blocks; text blocks are joined and trimmed.
- Violation: `text.trim().endsWith("?")` fires on any trailing `?` — including code snippets ending in `?`, TypeScript optional chaining (`?.`), regex patterns, or markdown like `"Is this correct?\n\`\`\`"` where trim removes trailing whitespace but not the code block. A false positive here causes the hook to return early, allowing the LLM to exit the flow by appending a question mark.
- Invariant: the hook must only skip enforcement when the LLM is genuinely asking the user a question, not when `?` appears incidentally.

**Stagnation counter never resets to zero:**
- Pre: `nextCount = (state.stagnation_count ?? 0) + 1`; written back via `writeState`.
- Invariant: counter must reset when a real state transition occurs. The reset mechanism is hash-change detection (`hash !== state.last_reminder_hash`), not an explicit zero-write. If a transition occurs but the new state happens to produce the same hash (same `current_state_id` + same tape), the counter continues incrementing — stagnation reminders fire even after a successful transition.
- Post: when `nextCount > STOP_HOOK_STAGNATION_LIMIT`, the hook writes `nextCount` (not a capped value) and returns. The counter grows unboundedly across turns; no ceiling enforced.

**Compaction cooldown Map not cleared on FSM pop:**
- Pre: `lastCompactionAt` is keyed by `sessionId` (not `fsmId`). Cleared only in `session_start`.
- Violation: after a sub-flow FSM is pushed and popped, the parent FSM's compaction cooldown is still governed by the timestamp set during the sub-flow's execution. If the sub-flow triggered a compaction check, the parent FSM inherits the cooldown — potentially suppressing a legitimate stop for up to 60 seconds after pop.
- Invariant: compaction cooldown should be per-FSM or reset on pop, not shared across the entire session.

**CONFIRM_STOP_TAG check scope:**
- Pre: tag is searched in the last assistant message only (`findLastAssistant`).
- Check: if the LLM emits the tag in a tool-call result block (not a text block), `findLastAssistant` returns the message but the tag search is over `last.content` text blocks only — verify the tag check in `agent_end` covers all content block types, not just `type === "text"`.

---

## Dimension 3 — Visualizer Module Correctness

**Priority:** MEDIUM — never audited; contains LLM-supplied data flowing into HTML output and filesystem write paths.

### Target Files
- `visualizer/create-artifact.ts`
- `visualizer/render-html.ts`
- `visualizer/normalize-state.ts`
- `visualizer/label-layout.ts`
- `visualizer/index.ts` (buildSessionVisualizerDocument, buildFileVisualizerDocument)

### Functions Under Scrutiny
- `createVisualizerArtifact`: `outputFile` and `flowFile` path resolution
- `renderVisualizerHtml`: `safeJson` embedding, `dragNodesCode` raw interpolation, CDN script tag
- `buildSessionVisualizerDocument`: null-runtime silent skip, tape passthrough
- `buildFileVisualizerDocument`: no error handling around `parseFlowConfig`/`buildFSM`
- `layoutFsm`: `nodeMap` dead code, dagre undefined-width fallback

### Pre/Post/Invariant Violations to Look For

**create-artifact.ts — path traversal write:**
- Pre: `options.outputFile` is LLM-supplied (from `visualize-steering-flow` tool parameter).
- Violation: `resolveOutputPath` resolves relative paths against `cwd` and passes absolute paths through unchanged. An LLM-supplied `outputFile` of `"../../.ssh/authorized_keys"` or `"/etc/cron.d/pwn"` writes arbitrary content to arbitrary filesystem locations.
- Post broken: output must be confined to a safe directory (e.g., under `cwd`); no boundary check exists.

**create-artifact.ts — arbitrary file read:**
- Pre: `options.flowFile` is LLM-supplied.
- Violation: `flowFile` is resolved from `cwd` or used as absolute — no path confinement. An LLM can read any file readable by the process (e.g., `"../../.env"`, `"/etc/passwd"`) by supplying it as `flowFile`.
- Post broken: `flowFile` must be confined to the project directory.

**render-html.ts — CDN without SRI:**
- Pre: `<script src="https://cdn.jsdelivr.net/npm/d3@7">` is emitted with no `integrity` attribute.
- Invariant: a compromised or version-bumped CDN response executes arbitrary JS in the artifact viewer's browser context. The artifact contains LLM session data (tape, transition log, task description) — exfiltration surface.
- Note: `dragNodesCode` is a static TypeScript string literal with no LLM-supplied content — no injection risk there.

**visualizer/index.ts — buildFileVisualizerDocument uncaught throws:**
- Pre: `parseFlowConfig(content, filename)` and `buildFSM(flow)` both throw on invalid input.
- Violation: no try/catch in `buildFileVisualizerDocument` — a malformed flow file causes an unhandled rejection that propagates to the `visualize-steering-flow` command handler. Verify the command handler's outer try/catch catches this and surfaces a friendly error (not a raw stack trace to the UI).

**visualizer/index.ts — silent skip on null runtime:**
- Pre: `loadRuntime` returns `null` for corrupted FSMs.
- Violation: `if (!runtime) continue` silently omits the FSM from the document. The caller receives a `VisualizerDocument` with fewer FSMs than the stack depth, with no indication of which FSMs were skipped or why.
- Invariant: `fsmCount` in `VisualizerArtifactResult` must equal `stack.length`; silent skip breaks this.

**label-layout.ts — dead code:**
- `nodeMap` is computed (`new Map(nodes.map(...))`) but never referenced. Harmless but signals the layout function may be incomplete (was `nodeMap` intended for the `forceAvoid` collision pass?).

---

## Dimension 4 — Concurrency and Session Lock Correctness

**Priority:** MEDIUM — `withSessionLock` is the sole concurrency guard; any gap allows interleaved state corruption.

### Target Files
- `storage.ts` (`withSessionLock`, `writeState` preserve_entered_at, `atomicWriteJson`)
- `index.ts` (all tool/command handlers, `agent_end` hook, `session_start` handler)

### Functions Under Scrutiny
- `withSessionLock(sessionId, fn)`: chain-mutex implementation, Map cleanup
- `writeState(..., {preserve_entered_at: true})`: read-then-write pattern
- `atomicWriteJson`: tmp-write + rename sequence
- `session_start` crash recovery: pendingPop + stuck-$END sweep (sequential, both under lock?)

### Pre/Post/Invariant Violations to Look For

**withSessionLock — Map entry lifetime:**
- Pre: `sessionLocks.get(key) === tail` identity check in `finally` before `delete`.
- Invariant: if a third waiter arrives and overwrites `sessionLocks.set(key, newTail)` before the first holder's `finally` runs, the `delete` is correctly skipped (identity check fails). Verify this is true — the Map entry must persist for the chain to remain intact.
- Check: under what conditions does `sessionLocks` grow unboundedly? If a session is abandoned mid-lock (process crash), the Map entry persists in memory but the next process start has a fresh Map — no leak across restarts. Within a single process, verify the chain always terminates.

**session_start crash recovery — lock coverage:**
- Pre: `session_start` handler runs `readPendingPop` + `popFsm` + `deletePendingPop`, then `readStack` + `readState` + `popFsm` — two sequential FSM mutations.
- Violation: verify both recovery paths (Part A and Part B) execute inside `withSessionLock`. If `session_start` is not wrapped, a concurrent tool call arriving immediately after session start could observe a half-recovered stack.
- Post: after `session_start` completes, the stack must be in a consistent state (no `$END` top, no pending pop marker).

**writeState preserve_entered_at — TOCTOU:**
- Pre: reads existing state, merges `entered_at`, writes back — two async ops.
- Invariant: always called within `withSessionLock` (confirmed from storage.ts notes). But verify all callers of `writeState(..., {preserve_entered_at: true})` in `index.ts` (stagnation update path) are indeed inside the lock — if the stagnation write in `agent_end` is outside the lock, a concurrent `actionCall` could overwrite the state between the read and write.

**Parallel tool calls — tape consistency:**
- Pre: `saveCall` and `actionCall` both call `persistRuntime` which writes tape then state.
- Violation: if two `save-to-steering-flow` calls arrive in the same turn (LLM parallel tool use), `withSessionLock` serializes them — but verify the second call re-reads the tape from disk (not from a stale in-memory snapshot) before writing. If both calls load the same `runtime` object and write independently, the second write silently discards the first call's tape entry.

---

## Dimension 5 — Cross-Module Contract Consistency (index.ts → engine/storage callers)

**Priority:** MEDIUM — index.ts is the integration layer; mismatched arg types/counts between callers and callees are invisible to TypeScript if types are loose.

### Target Files
- `index.ts` (all call sites for `executeAction`, `loadAndPush`, `enterStart`, `persistRuntime`, `loadRuntime`, `writeState`, `readStack`, `popFsm`)
- `engine.ts` (`executeAction`, `enterStart`, `chainEpsilon` signatures)
- `storage.ts` (`persistRuntime`, `loadRuntime`, `writeState`, `readStack` signatures)
- `types.ts` (`FSMRuntime`, `TransitionResult`)

### Functions Under Scrutiny
- `index.ts:actionCall` → `executeAction(runtime, actionId, positionalArgs)`
- `index.ts:loadAndPush` → `enterStart(runtime)` after push
- `index.ts:agent_end` → `loadRuntime`, `readStack`, `writeState` (stagnation path)
- `index.ts:infoCall` → `loadRuntime` for each stack FSM
- `index.ts:saveCall` → `persistRuntime(sessionDir, fsmId, runtime)` after tape mutation

### Pre/Post/Invariant Violations to Look For

**executeAction positional arg count:**
- Pre: `index.ts:actionCall` extracts `positionalArgs` from tool input and passes to `executeAction`.
- Invariant: `executeAction` enforces strict arg count against `action.arguments.length`. If `index.ts` passes `args` from the tool schema (which may include extra keys or missing keys due to LLM non-compliance), the count check throws. Verify the error is caught and surfaced as a friendly message, not a raw stack trace.
- Check: `tokenizeArgs` is used for command-based invocations — verify it is NOT used for tool-based `actionCall` (tool args arrive as structured JSON, not shell strings; tokenizing them would double-parse).

**persistRuntime call ordering:**
- Pre: `persistRuntime` writes tape first, then state (state = commit marker per spec).
- Invariant: every `persistRuntime` call in `index.ts` must pass the current `runtime` object (not a stale snapshot). In `actionCall`, `runtime` is mutated by `executeAction` (state transition), then `persistRuntime` is called — verify the mutated object is passed, not the pre-action snapshot.
- Check: `loadAndPush` calls `persistRuntime` after `enterStart` mutates `runtime.current_state_id` — verify the post-enterStart runtime (with updated `current_state_id`) is what gets persisted, not the pre-enterStart version.

**writeState stagnation path — field completeness:**
- Pre: stagnation update calls `writeState(sessionDir, fsmId, { ..., stagnation_count: nextCount, last_reminder_hash: hash, preserve_entered_at: true })`.
- Invariant: `writeState` must receive all required fields of the state schema, or the merge must be additive (not replace). Verify `writeState` merges into the existing state rather than overwriting — a full-replace write with only stagnation fields would erase `current_state_id` and `transition_log`.

**loadRuntime null propagation:**
- Pre: `loadRuntime` returns `null` for missing/corrupted FSMs.
- Violation: `index.ts:infoCall` has a try/catch per FSM but the null check path (`if (!rt) { lines.push("CORRUPTED"); continue; }`) — verify this null guard exists and is not accidentally removed by NDA-06 restructuring. A missing null check followed by property access on `null` throws, which the outer `catch {}` at line 351 silently swallows.

**saveCall tape mutation — runtime object identity:**
- Pre: `saveCall` loads `runtime` via `loadRuntime`, mutates `runtime.tape[id]`, calls `persistRuntime`.
- Invariant: the `runtime` object must be freshly loaded from disk (not cached) to avoid overwriting concurrent tape writes. Verify `saveCall` always calls `loadRuntime` at the start of its lock-protected body, not before acquiring the lock.
