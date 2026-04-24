# Steering Flow Deployment Context and Descriptive Design Spec

_Date_: 2026-04-23  
_Basis_: `docs/correctness-audit.md`, `docs/hoare-audit-2026-04-21.md`, `docs/execution-behavior.md`, `README.md`, and reverse-read core implementation (`parser.ts`, `engine.ts`, plus audited references to `storage.ts`, `index.ts`, `types.ts`).

## 1. Scope and Purpose

This document captures the Step 0 deployment context for Hoare Audit of the `steering-flow` plugin. It is a **descriptive** system specification: it records the behavior the current implementation and audit docs establish, not an aspirational redesign.

The plugin implements a disk-backed finite-state-machine (FSM) runtime that:
- loads a flow definition from JSON / strict mini-YAML / Markdown front matter,
- validates structural and execution invariants at parse time,
- executes transition conditions as external child processes,
- persists FSM runtime state and tape to disk,
- exposes commands/tools for loading flows, firing actions, inspecting runtime, and saving tape values,
- auto-injects reminder messages on `agent_end` when a session remains inside an unfinished flow.

## 2. System Model

### 2.1 Architectural decomposition

The audited architecture is explicitly split into:
- **Parser (`parser.ts`)**: parses author-provided flow specs, normalizes builtin conditions, enforces schema and graph invariants, and builds an internal FSM representation.
- **Engine (`engine.ts`)**: executes conditions, interpolates runtime placeholders, advances FSM state, runs epsilon routing, and enforces runtime depth/timeout/output limits.
- **Storage (`storage.ts`)**: reads/writes runtime files using atomic rename and serializes in-process session mutation with a per-session async mutex.
- **Plugin/orchestration layer (`index.ts`)**: registers tools/commands/hooks, loads flows, pushes/pops the runtime stack, persists commits, and integrates stop-hook behavior.
- **Runtime types (`types.ts`)**: defines the persisted/runtime schema, including `FSMRuntime`, tape values, state/action structures, and condition unions.

### 2.2 Abstract machine

The system is a **stack of FSM runtimes** per session.
- Each loaded flow creates an `FSMRuntime` with its own state, tape, transition log, and originating `flow_dir`.
- Loading a child flow pushes a new runtime onto the session stack.
- Reaching `$END` pops the top runtime and resumes the parent runtime, if any.
- `/pop-steering-flow` force-pops the top runtime, but this is user-only rather than LLM-tool callable.

### 2.3 Persistent state model

Per-session on-disk state lives under:

```text
.pi/steering-flow/<SESSION-ID>/
  stack.json
  <FSM-ID>/
    fsm.json
    state.json
    tape.json
```

The persisted runtime schema includes at least:
- `fsm_id`
- `flow_name`
- `flow_dir`
- `task_description`
- `states`
- `current_state_id`
- `tape`
- `transition_log`

`TapeValue` is arbitrary JSON, not string-only.

## 3. Deployment Context

### 3.1 Host/runtime assumptions

The implementation assumes deployment inside the Pi framework / plugin host, with these environmental guarantees or expectations:
- a non-null session identifier exists for operations that mutate or inspect session-local flow state;
- plugin tools/commands/hooks are invoked by the host framework;
- tool calls may occur **in parallel** at the framework level;
- `agent_end` runs after tool execution and can send a user-visible reminder message;
- command execution happens in a Node.js runtime with OS subprocess support (`spawn`, signals, process groups, atomic rename on same filesystem);
- condition executables can be launched from the host filesystem and may read/write files accessible to the host process.

### 3.2 Operational surface

The plugin exposes the following user-visible commands:
- `/load-steering-flow <FILE>`
- `/pop-steering-flow`
- `/save-to-steering-flow <ID> <VALUE>`
- `/get-steering-flow-info`
- `/steering-flow-action <ACTION-ID> [ARGS...]`

The LLM-visible tool surface is:
- `load-steering-flow(file)`
- `steering-flow-action(action_id, args[])`
- `save-to-steering-flow(id, value)`
- `get-steering-flow-info()`

Notably, `pop-steering-flow` is **not** a tool; authority is intentionally asymmetric between user and LLM.

### 3.3 Artifact deployment assumptions

A valid deployment includes:
- the plugin code itself;
- flow definition files authored in supported formats;
- any helper scripts/builtin-expanded executables referenced by conditions;
- a writable `.pi/steering-flow/` storage root on the same filesystem used for atomic rename;
- a process environment suitable for child-process execution and process-group kill.

### 3.4 Backward-compatibility caveat

Audit notes identify a migrated-session risk: persisted sessions missing `flow_dir` may misresolve relative condition paths after restart or cwd changes. Therefore, resumed-session correctness depends on `flow_dir` being present and accurate in persisted runtime state.

## 4. Design Contracts / Descriptive Spec

### 4.1 Flow authoring and parser boundary

Accepted input formats are:
- JSON,
- strict mini-YAML,
- Markdown files with YAML front matter.

Normalization / input guards:
- file size capped at **2 MiB**;
- UTF-8 BOM stripped;
- CRLF / CR normalized to LF;
- tabs rejected in YAML;
- YAML nesting depth capped at **64**.

Top-level schema requirements:
- flow config must be an object;
- `task_description` must be a non-empty string;
- `states` must be a non-empty array.

State invariants:
- `$START` and `$END` are required sentinel states;
- `$END` cannot be epsilon and cannot have actions;
- non-`$END` states must have actions;
- non-sentinel state IDs must match `^[A-Za-z_][A-Za-z0-9_]*$`;
- duplicate/reserved-property identifiers are rejected.

Action invariants:
- `action_id` must be identifier-like and unique within a state;
- every `next_state_id` must resolve to an existing state;
- direct self-loops are rejected;
- epsilon actions cannot accept arguments;
- argument names are validated, duplicates rejected, and names beginning with `$` are forbidden.

Condition invariants:
- canonical runtime condition form is `{ default: true }` or `{ cmd, args?, needs_tape? }`;
- `builtin:` forms are parse-time sugar and are expanded before final validation;
- `{ default: true }` is exclusive with `cmd`/`args`/`needs_tape`;
- non-epsilon states may not use `{ default: true }`;
- epsilon states must use declared-order routing where the **last** action is `{ default: true }`, and earlier epsilon actions may not be default actions.

Graph invariants (validated before execution):
- duplicate states are rejected;
- `$END` must be reachable from `$START`;
- every forward-reachable state must also be able to reach `$END`;
- this eliminates structural dead-end states, but does **not** prove runtime termination of arbitrary condition logic.

### 4.2 Builtin lowering contract

Builtins are not a separate runtime mechanism. The parser lowers builtin conditions into ordinary command-based conditions and then re-validates them. As a result:
- runtime execution does not branch on builtin-vs-non-builtin semantics;
- each builtin’s semantics reduce to an executable command plus arguments and optional `needs_tape` behavior;
- trust analysis should treat builtin helper scripts as ordinary external condition executables.

### 4.3 Runtime execution semantics

#### 4.3.1 Explicit actions

At runtime, an explicit action call is valid only in a non-epsilon current state.

`executeAction` behavior is:
1. locate current state and requested action;
2. validate argument count;
3. snapshot the current state for rollback;
4. run the action condition;
5. if condition stdout-first-line is `true`, advance to `next_state_id`;
6. if condition stdout-first-line is `false`, remain in the current state;
7. after a successful explicit transition, automatically run epsilon routing from the entered state;
8. if epsilon chaining fails after the explicit action already passed, restore the snapshot and treat the action as failed for persistence purposes.

#### 4.3.2 Epsilon routing

Epsilon routing semantics:
- epsilon actions are evaluated automatically in declared order;
- the trailing `{default:true}` action functions as unconditional fallback;
- chaining depth is capped at **64** (`MAX_EPSILON_DEPTH`);
- entering `$END` pops the current FSM and resumes the parent runtime.

The parser guarantees structural fallback shape; the engine enforces runtime depth bound and rollback on failed chains.

#### 4.3.3 Placeholder interpolation

Only these runtime placeholders are recognized:
- `${$TAPE_FILE}` → absolute path to the current FSM’s `tape.json`
- `${arg-name}` → corresponding user/LLM-supplied action argument

Unknown placeholders remain unchanged.

Relative path tokens beginning with `./` or `../` are resolved relative to persisted `flow_dir`. Absolute paths and bare command names are left unchanged.

### 4.4 Condition subprocess contract

The transition-condition trust contract is:
- conditions execute as external child processes via Node `spawn`;
- no shell string evaluation is used;
- child inherits `process.env` as-is;
- plugin does not inject extra `SF_*` environment variables;
- child runs with `detached: true`, enabling process-group kill;
- configured argv is composed from interpolated command/args plus runtime action args, with tape-path injection controlled by `needs_tape` semantics;
- when `needs_tape !== false`, tape path is injected by default;
- when `needs_tape === false`, no implicit tape arg is inserted.

Truth contract:
- **only the first line of stdout is authoritative**;
- first line `true` means the condition passes;
- first line `false` means the condition fails but this is a normal in-model result;
- later stdout lines become explanatory reason text;
- exit code is ignored except to help describe malformed-output failures;
- malformed or spawn-error outcomes are treated as failures.

Resource limits:
- wall-clock timeout: **30 seconds**;
- stdout buffer cap: **64 KiB**;
- stderr buffer cap: **16 KiB**;
- on timeout/settle failure, the engine attempts SIGKILL on the entire process group (`process.kill(-pid, ...)`) and falls back to killing the child.

### 4.5 Tape model

Each FSM owns one JSON tape file. Tape writers include:
- the condition process, if given `${$TAPE_FILE}` or implicit tape path;
- `/save-to-steering-flow`;
- `save-to-steering-flow` tool.

Tape constraints:
- tape keys must match `^[A-Za-z_][A-Za-z0-9_]*$`;
- each stored value is capped at **64 KiB**;
- maximum **1024** keys per tape.

After every condition execution, tape is reloaded from disk so out-of-band changes made by the child process become visible to the runtime.

### 4.6 Persistence and commit model

Persistence is intentionally two-phase and crash-aware:
- successful transitions persist;
- failed actions do **not** become committed state;
- tape is written **before** `state.json`;
- `state.json` acts as the commit marker for model-visible state;
- writes use temp-file + rename atomic replacement on the same filesystem.

This means a crash may leave an updated tape without an updated state marker, but not a committed new state without the corresponding tape write the engine meant to expose.

`readJsonStrict` distinguishes missing files from corruption. Startup/session-load also sweeps orphan `.tmp.*` files, skipping same-process temp files that may still be active.

### 4.7 Stop-hook / reminder model

On `agent_end`, if the steering-flow stack is non-empty and the top state is not `$END`, the plugin may inject a reminder describing the current state, legal actions, and overall task.

Reminder suppression guards include:
- aborted run;
- last message ended with `?`;
- `<STEERING-FLOW-CONFIRM-STOP/>` escape tag;
- cooldown after `session_compact`;
- stagnation limit of 3 identical `(state, tape)` reminders.

Reminder metadata is stored in runtime state and later overwritten by successful persistence, causing the counter to self-reset.

## 5. Trust Boundaries

### 5.1 Boundary A: flow author input → parser

Untrusted or semi-trusted flow files cross into the system here.
Parser protections include:
- strict schema validation,
- identifier/path checks,
- size and nesting bounds,
- builtin lowering + re-validation,
- graph sanity checks.

Residual risk:
- parser acceptance does not prove semantic liveness;
- YAML block-scalar chomp semantics are not fully preserved per audit notes.

### 5.2 Boundary B: engine → external condition executable

This is the primary execution trust boundary.
The system trusts external scripts/processes to:
- emit stdout whose first line obeys the `true`/`false` contract,
- avoid harmful side effects outside the model,
- behave deterministically enough for workflow control,
- treat any tape file argument according to the documented argv contract.

The model does **not** roll back external side effects if a condition later fails or an epsilon chain is rolled back. Therefore condition idempotence / side-effect discipline is an explicit assumption for sound reasoning.

### 5.3 Boundary C: child process ↔ tape file

Tape exchange is file-based rather than in-process. The child may mutate tape out-of-band by writing JSON to the provided file path.

Consequences:
- the tape file is a shared mutable artifact across trust boundary B;
- correctness depends on child behavior preserving valid JSON/tape schema expectations;
- the engine compensates by re-reading tape after condition execution.

### 5.4 Boundary D: runtime ↔ filesystem / OS primitives

Crash consistency and subprocess cleanup depend on host guarantees:
- atomic rename on the same filesystem,
- correct file permissions / writable storage,
- process-group signaling support,
- Node child-process and fs semantics.

### 5.5 Boundary E: plugin ↔ framework scheduler

The plugin assumes the host may schedule tool calls in parallel, but only provides **in-process per-session serialization**. Therefore:
- same-session mutation is safe against parallel calls inside one process;
- cross-process coordination is not guaranteed by the documented mutex alone and remains an accepted limitation.

## 6. Concurrency Model

### 6.1 Intended concurrency semantics

The framework may issue parallel tool calls, but all steering-flow read-modify-write operations are wrapped in a **per-session async mutex** (`withSessionLock(sessionId, ...)`).

Thus the intended model is:
- parallelism across unrelated sessions is allowed;
- parallelism across independent read-only work may exist at framework level;
- mutation of a single session’s steering-flow state is serialized within one process.

### 6.2 Serialization scope

Serialized operations include the core orchestration paths in `index.ts`, including load, action execution, save-to-tape, info retrieval over persisted state, and stack mutation.

This prevents in-process lost updates between:
- action execution and persistence,
- stack push/pop,
- tape/state write sequences,
- temp-file cleanup racing with active writes from the same process.

### 6.3 Non-goals / limits

The documented design does **not** establish a distributed or cross-process lock. Therefore the safe concurrency claim is limited to **single-process, per-session serialization**.

### 6.4 Concurrency-relevant invariants

Within the intended deployment model:
- no two in-process operations should concurrently commit different states for the same session;
- temp sweep should not delete same-process active temp files;
- a successful transition becomes visible only after atomic persistence completes;
- a failed action leaves persisted committed state unchanged.

## 7. Safety and Liveness Summary

### 7.1 Safety properties the docs/code support

The current audited design supports these descriptive safety claims:
- structurally malformed or graph-invalid flows are rejected before execution;
- explicit action calls cannot be issued from epsilon states;
- child-process output is bounded in time and memory;
- same-session in-process mutations are serialized;
- persistence uses atomic replacement and tape-first/state-second commit ordering;
- failed action paths do not persist partially committed new runtime state;
- `$END` has special terminal stack-pop semantics.

### 7.2 Liveness limitations / assumptions

The current system does **not** prove full runtime liveness. Instead it assumes:
- flow authors provide conditions that eventually succeed when progress is intended;
- helper scripts honor the stdout truth contract;
- external condition side effects are either idempotent or acceptable if replay/rollback occurs around them;
- resumed sessions retain valid `flow_dir` if relative executables are used.

## 8. Known Caveats Relevant to Audit Step 0

From the existing audit docs, the main caveats for downstream reasoning are:
- YAML block-scalar chomp variants are not preserved exactly;
- builtin helper scripts have per-builtin tape-argument contracts; not all helpers are tape-aware;
- `soft-review/*` builtins are documented as placeholder / non-production stubs that fail closed;
- some docs/examples historically drifted from core semantics, so core parser/engine/storage behavior should be treated as normative over example prose;
- older persisted sessions missing `flow_dir` can misresolve relative executables.

## 9. Recommended Hoare-Audit Working Assumptions

For subsequent Hoare-style reasoning, use the following assumptions unless disproven in later rounds:
1. **Session-local single-process serialization**: all same-session mutations occur under `withSessionLock`.
2. **Atomic persistence**: temp+rename on a single filesystem is atomic enough to model committed state via `state.json`.
3. **Tape-first commit discipline**: new committed state implies the corresponding tape write was attempted and persisted before `state.json`.
4. **External-condition opacity**: condition executables are black-box transitions constrained only by argv/stdout/time/output contracts.
5. **No shell expansion**: command execution uses argv semantics, not shell semantics.
6. **Builtin lowering**: builtins can be reasoned about as ordinary external commands after parse-time normalization.
7. **Rollback scope**: rollback restores FSM runtime state, but cannot undo external side effects.
8. **Structural liveness only**: parser/build validation proves graph-level reachability to `$END`, not eventual runtime termination.

---

This document is intended to be the baseline Step 0 deployment/spec context for subsequent audit rounds.
