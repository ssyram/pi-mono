# Round 2 Hoare Audit — Dimension Selection

**Plugin:** `steering-flow`  
**Audit stage:** Round 2 incremental (post 15-round prior audit + 8-issue delta; 4 issues fixed, 4 deferred)  
**Selected dimensions:** 5  
**Date:** 2026-04-23

---

## Rationale for selection strategy

The prior 15-round audit saturated the following areas: FSM structural rules (BFS reachability, dead-end detection), epsilon ordering and depth limits, tape key/value size limits at the *write* path, sentinel presence checks, builtin expansion correctness, and argv ordering for the submit script.  
This Round 2 therefore:
1. Targets all **4 deferred issues** (Issues 1, 2, 7, 8 from spec-gate.md) — none were covered by prior rounds.
2. Adds **fresh angles** uncovered even by the prior 15-round audit: tape-rollback asymmetry, error-path stack consistency, and quoted-string escape semantics.

---

## Selected Dimensions

---

### D1 — Functional Correctness (Parser)

**Why this codebase, not a generic reason:**  
`parser.ts` implements its own YAML-subset parser from scratch rather than using a library. Two concrete correctness faults survive in the current code:

- **Chomp indicator loss** (`parser.ts:505–516, 519–551`): `parseKeyValue` collapses `|-` → `"|"` and `|+` → `"|"`, discarding strip/keep semantics before `readBlockScalar` is called. `readBlockScalar` always strips trailing blank lines and then unconditionally appends `"\n"`, implementing clip semantics for all three chomp variants. A `|-` value (strip — no trailing newline) receives a spurious `\n`; a `|+` value (keep — preserve all trailing newlines) loses them. This is **Deferred Issue 1**.
- **Quoted-string escape blindness** (`parser.ts:553–579`): `parseScalar` extracts quoted strings via `s.slice(1, -1)` with no escape-sequence decoding. A double-quoted value `"foo\"bar"` produces the literal string `foo\"bar` with a backslash, not `foo"bar`. This is a **fresh angle** not audited in prior rounds.

**Modules/functions targeted:**  
`parser.ts` → `parseKeyValue`, `readBlockScalar`, `parseScalar`

**Pre/Post/Invariant violations it may find:**
- **Post-condition:** `parseKeyValue(line)` where `line` contains `|-` → result must have `chomp = "strip"` (strip semantics). Currently violated: chomp field is lost.
- **Post-condition:** `readBlockScalar` with chomp = strip → result string must not end with `\n`. Currently violated: always appends `\n`.
- **Post-condition:** `parseScalar("\"foo\\\"bar\"")` → result must equal `foo"bar`. Currently violated: returns `foo\"bar`.
- **Invariant:** any string value round-tripped through the parser must be semantically equivalent to what a conforming YAML parser would produce for the same input.

---

### D2 — External-API Contracts (Engine ↔ Builtin Scripts)

**Why this codebase, not a generic reason:**  
The engine spawns builtin `.mjs` scripts via `node` as child processes, passing `args` from the flow config directly as `argv`. The interface is a positional argv convention, not a typed API. The boundary between `engine.ts:runCondition`, `builtin-registry.ts:expandBuiltinCondition`, and the individual `.mjs` scripts carries implicit contracts that are unenforced by any schema.

Specifically, **Deferred Issue 2** lives here: `validate-non-empty-args.mjs:23–26` applies an absolute-path heuristic that strips the first argument when it looks like a tape path — but the engine only prepends the tape path when `needs_tape: true`. When `needs_tape: false`, the tape path is absent, so the heuristic silently drops a legitimate data argument. This is a violation of the interface contract between the engine's `needs_tape` flag and the builtin's assumption about argv layout.

**Modules/functions targeted:**  
`engine.ts` → `runCondition` (argv assembly at line 64–66), `builtin-registry.ts` → `expandBuiltinCondition`, `builtins/validate-non-empty-args.mjs` → argument index logic

**Pre/Post/Invariant violations it may find:**
- **Pre-condition:** `runCondition` with `needs_tape: false` → `argv[0]` presented to the builtin script is the first user-declared arg, not a tape path. Violation if the script treats `argv[0]` as a tape path unconditionally.
- **Invariant:** for every builtin, the set of arguments at argv positions `[0..n-1]` (with tape path prepended iff `needs_tape: true`) must match the script's documented positional expectations with no silent drops.
- **Post-condition:** `validate-non-empty-args.mjs` with `needs_tape: false` and one absolute-path argument → exit 0 iff the arg is non-empty. Currently may exit 0 after silently dropping it.
- **Cross-boundary invariant:** the comment in `builtin-registry.ts` ("pass `${$TAPE_FILE}` explicitly when the helper needs tape access") must be consistent with how `runCondition` actually constructs argv. Verify no other builtin makes similar tape-path assumptions.

---

### D3 — Error Propagation (Failure Hint Accuracy)

**Why this codebase, not a generic reason:**  
`engine.ts:renderTransitionResult` produces human-readable failure messages that are the user's primary debugging surface when a condition command fails. The message currently hints at `${$TAPE_FILE}` interpolation as the fix for argument problems — but it does not mention that `needs_tape: true` must also be set in the flow config for the tape path to be injected at all. A user who only reads the hint will add `${$TAPE_FILE}` to their `args` list without setting `needs_tape`, observe that the placeholder is not expanded, and remain stuck. This is **Deferred Issue 7**.

This dimension is distinct from "functional correctness" because the code path executes correctly in its own logic — the failure is that the *information emitted* misleads the operator, violating the contract that diagnostic output must be sufficient for a competent user to self-recover.

**Modules/functions targeted:**  
`engine.ts` → `renderTransitionResult` (~line 415–430); also the analogous hint text anywhere else error messages reference tape-related debugging

**Pre/Post/Invariant violations it may find:**
- **Post-condition:** `renderTransitionResult(result)` where `result.success === false` → the emitted hint must be **complete** — it must mention both the `${$TAPE_FILE}` interpolation token *and* the `needs_tape: true` requirement.
- **Invariant:** every failure hint must be self-contained — a user reading only the hint must be able to attempt the correct fix without consulting source code.
- **Fresh angle** — also check whether `renderTransitionResult` distinguishes between "condition exited non-zero" vs "condition was never reached due to epsilon chain short-circuit" — these require different user actions and emitting the same hint for both would be a post-condition violation.

---

### D4 — State-Machine Correctness (Tape–State Rollback Asymmetry)

**Why this codebase, not a generic reason:**  
The engine's `executeAction` takes a snapshot of `current_state_id` and rolls it back on failure (`engine.ts:290–320`). However, condition scripts that run as child processes can write to `tape.json` directly (via `save-to-steering-flow` tool calls from within the LLM turn, or via script output parsed by the engine). If a condition script mutates the tape then fails, `current_state_id` is rolled back but `tape.json` is **not** — it retains the mutation. The FSM is now in a state where the tape reflects a partial transition that was officially rolled back.

This asymmetry is **not covered by any prior audit round** (prior audit I-6 validated snapshot+rollback, but only for `current_state_id`). The `FSMRuntime` invariant — that `(current_state_id, tape)` jointly represent the pre-transition snapshot after a rollback — is violated.

Additionally, `index.ts:192–225` shows that `loadAndPush` calls `popFsm` in its error path, but if `popFsm` itself throws, the stack has a dangling entry. This is a secondary state-consistency gap in the error-recovery path.

**Modules/functions targeted:**  
`engine.ts` → `executeAction`, `chainEpsilon` (rollback logic); `index.ts` → `actionCall` (tape re-sync after action), `loadAndPush` (popFsm in error path); `storage.ts` → `readTape`, `writeTape`

**Pre/Post/Invariant violations it may find:**
- **Invariant:** after `executeAction` returns `success: false`, the on-disk `(state.json, tape.json)` pair must reflect the pre-transition snapshot. Currently violated if any condition script wrote to tape during the failed chain.
- **Post-condition:** `loadAndPush` on `enterStart` failure → `stack.json` must not contain the newly-pushed fsmId. Violated if `popFsm` throws internally.
- **Pre-condition for rollback:** a valid rollback requires that condition scripts cannot externally mutate tape during condition evaluation — this pre-condition is not enforced; tape is a shared file during execution.
- **Fresh angle:** check whether the `readTape` call in `index.ts:actionCall` after `executeAction` re-syncs an already-mutated-then-rolled-back tape, potentially cementing a partial mutation as the new baseline.

---

### D5 — Resource Lifecycle (Migrated-Session Path Resolution)

**Why this codebase, not a generic reason:**  
`storage.ts:loadRuntime` deserializes persisted FSMRuntime objects with `flow_dir: struct.flow_dir ?? ""`. Sessions created before `flow_dir` was added to the schema (migrated sessions) have no `flow_dir` on disk, so they get `""`. In `engine.ts:resolveTokenRelToFlow` (~line 20–27), the guard is `if (!flowDir) return token` — empty string is falsy, so relative paths in `cmd` are returned unchanged and subsequently resolved by `child_process.spawn` against the **process CWD**, not the flow's directory. This is **Deferred Issue 8**.

This is a resource/lifecycle issue because the resolution failure is silent and context-dependent: the same flow YAML works correctly on first load (when `flow_dir` is populated) and breaks silently after session migration (when `flow_dir` is absent). The failure mode is not an exception but a wrong file path being passed to `spawn`, which may succeed or fail depending on CWD.

**Modules/functions targeted:**  
`storage.ts` → `loadRuntime` (line 234–249); `engine.ts` → `resolveTokenRelToFlow` (line 20–27), `runCondition`

**Pre/Post/Invariant violations it may find:**
- **Post-condition:** `loadRuntime(sessionId, fsmId)` → result must have `flow_dir` equal to the directory from which the flow YAML was originally loaded, or an empty string only if the flow was loaded without a known directory (and the caller is prepared to handle that). Currently: empty string is used as a sentinel but treated as "not present" rather than "unknown".
- **Invariant:** `resolveTokenRelToFlow(token, flowDir)` where `token` begins with `./` or `../` and `flowDir === ""` → must either throw or resolve against a documented default. Currently: silently returns the relative token unchanged.
- **Pre-condition for spawn:** any `cmd` that starts with `./` or `../` requires `flowDir` to be non-empty. This pre-condition is not checked; the engine calls `spawn` with a relative path and inherits CWD silently.
- **Fresh angle:** audit whether `loadRuntime` should reject/warn on `flow_dir: ""` for flows that contain any relative-path `cmd`, or whether `resolveTokenRelToFlow` should assert `flowDir` is non-empty before resolving relative tokens.

---

## Excluded Dimensions with Justification

| Dimension | Reason for exclusion |
|---|---|
| **State-machine correctness** (FSM structure) | Prior audit rounds 1–15 saturated this: BFS reachability, dead-end detection, epsilon ordering, depth limits all proven. Re-covering would find nothing new. |
| **Security / input validation** | Parser builds pure data structures (no eval, no shell expansion). `engine.ts` uses `shell: false` on spawn. Builtin scripts are internal .mjs files, not user-supplied code. No meaningful attack surface. |
| **Concurrency integrity** | In-process async mutex (`withSessionLock`) validated in prior audit. Spec intentionally excludes cross-process guarantees. Only one Node.js event loop processes a session. Nothing to add. |
| **Performance / DoS** | Stdout capped at 64 KiB, timeout enforced at 30 s, YAML size capped at 2 MiB, epsilon depth at 64 — all proven in prior audit. No unbounded loops visible in fresh code paths. |
| **Idempotency** | Spec explicitly documents that conditions need not be idempotent. No contract to audit against. |
| **Compatibility** | Plugin targets a single pi-ai runtime version; no versioned API surface. `builtin-registry.ts` expansion is deterministic and internal. No cross-version migration logic beyond `flow_dir` (covered by D5). |
| **Testability / observability** | No test infrastructure exists in this plugin; auditing testability would produce no actionable Hoare triples. Out of scope for a correctness audit. |
| **Connection / session lifecycle** | Not applicable — no network connections, no persistent client sessions. Session files managed via storage.ts, already covered under D4/D5. |
| **Determinism** | Condition scripts are external processes; non-determinism is explicitly accepted (LLM tape jitter). No determinism contract to verify. |

---

## Deferred Issues → Dimension Mapping

| Deferred Issue | Severity | Covered by |
|---|---|---|
| Issue 1: YAML chomp indicators silently collapsed (`parser.ts:515–516, 537`) | MEDIUM | **D1** Functional Correctness (Parser) |
| Issue 2: tape-path heuristic strips absolute-path arg under `needs_tape:false` (`validate-non-empty-args.mjs:23–26`) | LOW-MEDIUM | **D2** External-API Contracts |
| Issue 7: failure hint omits `needs_tape` caveat (`engine.ts:renderTransitionResult`) | LOW | **D3** Error Propagation |
| Issue 8: `flow_dir ?? ""` causes relative paths to resolve against CWD (`storage.ts:loadRuntime`) | LOW | **D5** Resource Lifecycle |

All 4 deferred issues are covered. **D4** (Tape–State Rollback Asymmetry) is a fresh angle not present in any prior audit round.
