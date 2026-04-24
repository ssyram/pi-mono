# Deployment Context — `steering-flow` Plugin

> **Audit round**: Round 2 — Step 1a (Hoare audit prerequisite)
> **Source of truth**: `index.ts`, `storage.ts`, `engine.ts` read directly; `docs/execution-behavior.md` and `README.md` consulted for corroboration.
> **Policy**: every claim below is traceable to code; speculative or doc-only claims are flagged.

---

## Axis 1 — Execution Model

### Plugin category

`steering-flow` is a **pi coding-agent plugin** — a Node.js module loaded in-process by the pi framework at startup. It runs inside the same single Node.js process as the rest of the agent; there is no separate server or daemon.

### Registration surface

The plugin registers **five LLM-callable tools** and **six user-facing slash commands** via `pi.registerTool` / `pi.registerCommand`, plus **three lifecycle hooks** (`session_start`, `session_compact`, `agent_end`).

| Surface | Names |
|---|---|
| LLM tools (5) | `load-steering-flow`, `steering-flow-action`, `save-to-steering-flow`, `visualize-steering-flow`, `get-steering-flow-info` |
| User commands (6) | `/load-steering-flow`, `/pop-steering-flow`, `/save-to-steering-flow`, `/visualize-steering-flow`, `/get-steering-flow-info`, `/steering-flow-action` |
| Hooks (3) | `session_start`, `session_compact`, `agent_end` |

### Event-driven dispatch

All incoming work arrives via the pi framework's event/callback mechanism. There are no background timers, no polling loops, and no server sockets owned by this plugin. The process is idle between framework callbacks.

### Serialization via per-session async mutex

Every tool handler and every command handler wraps its read-modify-write body in `withSessionLock(sessionId, () => …)` (`storage.ts`). The lock is a **promise-chain per `sessionId`** stored in a module-level `Map`; new waiters are chained onto the tail of the current promise. This is necessary because the pi framework can execute **multiple tool calls from the same turn in parallel** (confirmed by the comment in `storage.ts` referencing `agent-loop.ts:390–438` and by `execution-behavior.md` §N).

`pi.sendUserMessage` calls inside hook bodies are issued **after** the lock is released; the lock is not held across async I/O that does not touch session state.

### Condition processes

When an FSM transition has a `condition` field, the engine spawns a **child process** (`child_process.spawn`) with:

```
spawn(cmd, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env })
```

Key properties verified in `engine.ts`:
- **No shell** — `shell` option is not set (defaults to `false`); the executable is invoked directly with an `args` array.
- **argv-only argument passing** — transition arguments are interpolated into the command `args` array; no string is passed to a shell.
- `${$TAPE_FILE}` and named `${arg-name}` placeholders are expanded in the `args` array before the spawn call.
- The child is spawned **detached** so process-group kill (`process.kill(-pid, "SIGKILL")`) can reap the entire subtree on timeout.
- `stdin` is `"ignore"`; the plugin writes nothing to the child's stdin.

---

## Axis 2 — Trust Boundary

### Principal hierarchy

| Principal | Trust level | Rationale |
|---|---|---|
| **User** (human at keyboard) | **Trusted** | Sends slash commands; the only principal that can pop the FSM stack |
| **Condition scripts** | **Trusted** | Placed by the flow author on disk before the session starts; not supplied at runtime by the LLM |
| **YAML flow configs** | **Semi-trusted** | Authored by the user/flow-author but parsed with full structural validation at load time |
| **LLM** | **Untrusted** | Can invoke tools but cannot escalate privileges or pop the FSM stack |

### What the LLM can and cannot do

**Can do (five registered tools):**

1. `load-steering-flow` — parse and push an FSM (path resolved via `resolveFilePath`, size-capped at 2 MiB, full parse-time validation).
2. `steering-flow-action` — drive one named transition on the top-of-stack FSM (arg count strictly validated; no shell execution possible from this path).
3. `save-to-steering-flow` — write a value to the tape (key validated against `/^[A-Za-z_][A-Za-z0-9_]*$/` and JS reserved-name list; value capped at 64 KiB; key count capped at 1 024).
4. `visualize-steering-flow` — render a read-only DOT/Mermaid/text view of the current FSM; no state mutation.
5. `get-steering-flow-info` — read-only rendering of the full stack; no state mutation.

**Cannot do:**

- **Pop the FSM stack.** `pop-steering-flow` is explicitly **not** registered as a tool. The source comment in `index.ts` reads: *"NOTE: pop-steering-flow is intentionally NOT registered as a tool (user-only per spec)."* An LLM that wants to exit a flow must reach the `$END` state through normal transitions; the pop itself is executed by the framework after `$END` is detected.
- **Bypass argument validation.** `executeAction` in `engine.ts` hard-rejects calls where the count of supplied positional arguments does not exactly match the action's declared `arguments` list.
- **Bypass the session lock.** All tool handlers go through `withSessionLock`; the LLM cannot issue concurrent writes that race each other within one session.
- **Run arbitrary shell commands.** Condition scripts are resolved at parse time relative to `flowDir`; the LLM cannot supply a new script path at action time.

### YAML configs (semi-trusted)

YAML is parsed via a standard library (no `eval`). After parsing, `parser.ts` enforces:
- Exactly one `$START` and one `$END` state.
- No self-loop transitions.
- Every reachable state has a path to `$END` (bidirectional BFS).
- Epsilon constraints (no epsilon on `$END`, depth ≤ 64).
- No tab characters; CRLF normalized to LF.
- Total file size ≤ 2 MiB.

Parse failures are surfaced as user-visible errors and abort the load; malformed YAML cannot reach the engine.

---

## Axis 3 — Persistence Model

### Session directory layout

All mutable state lives under:

```
<project-root>/.pi/steering-flow/<SESSION-ID>/
  stack.json              # ordered array of active FSM IDs
  <FSM-ID>/
    fsm.json              # immutable parsed flow (written once on load)
    state.json            # current_state_id (the "commit marker")
    tape.json             # key-value tape
```

`<SESSION-ID>` comes from the pi framework's session identifier. The fallback value `_no_session_` is used only when the framework provides an empty string (edge case, not normal operation).

`<FSM-ID>` format: `<timestamp>-<slug>-<4-random-bytes-hex>` — unique per load, monotonically increasing.

### Atomic writes

All JSON writes go through `atomicWriteJson` (`storage.ts`):

1. Compute a tmp path: `<target>.tmp.<process.pid>.<4-random-bytes-hex>`.
2. Write full JSON content to the tmp file.
3. `fs.rename(tmp, target)` — a POSIX atomic replace on the same filesystem.

No partial writes can be observed by concurrent readers. Rename atomicity holds as long as both paths share the same filesystem mount point (standard `.pi/` usage).

### Tape-first / state-second commit order

`persistRuntime` (`index.ts`) writes in this order:

1. `tape.json` — written first (data payload).
2. `state.json` — written second (commit marker, `current_state_id`).

The source comment reads: *"state.json is effectively the commit marker."*

Crash semantics: a process killed between step 1 and step 2 leaves `tape.json` updated but `state.json` pointing to the old state. On recovery the engine will re-enter the old state and retry the transition — **at-least-once** delivery of tape writes for any transition that advanced the tape.

If a `steering-flow-action` call fails (condition returns `false`, arg error, epsilon-chain error), `persistRuntime` is **not called** at all; `runtime.current_state_id` is rolled back in memory before the function returns.

### Orphan tmp sweep on session_start

`sweepTmpFiles(sessionDir)` is called in the `session_start` hook. It scans the session directory (top level and one subdirectory level) for files matching `*.tmp.*`, skipping any tagged with the current `process.pid`. This removes tmp files left by crashed prior processes. The sweep is **best-effort** — all errors are silently swallowed — and is **not** protected by the session lock (no tool calls are in flight at session start).

### FSM directory cleanup on pop

When the top FSM is popped (`popFsm`), its entire `<FSM-ID>/` subdirectory is removed via `fs.rm({ recursive: true })`. This is also best-effort (errors swallowed); if removal fails, stale directories are inert because `stack.json` no longer references the FSM ID.

---

## Axis 4 — Concurrency Model

### Single process

There is exactly one Node.js process. No worker threads, no cluster forks, no IPC channels are used by this plugin.

### Per-session promise-chain mutex

`withSessionLock(sessionId, fn)` in `storage.ts`:

- Maintains a `Map<string, Promise<void>>` (`sessionLocks`) keyed by `sessionId`.
- Chains each new call onto the map's current tail: `newTail = currentTail.then(() => fn(), () => fn())` — the second `() => fn()` means a rejection in a prior waiter does **not** block the next waiter.
- When the tail settles and is still the map's current entry, the key is deleted to prevent unbounded map growth.

The lock is held only for the duration of the async function `fn`; it is released before `pi.sendUserMessage` is called.

### Why the lock is necessary

The pi framework executes tool calls from the same LLM turn in parallel (per `execution-behavior.md` §N, citing `agent-loop.ts:390–438`). Without the lock, two simultaneous `steering-flow-action` calls could both read the same `state.json`, both decide a transition is valid, and both write different resulting states — last-write-wins corruption. The lock serializes all read-modify-write operations per session.

The `agent_end` hook also acquires the lock; it waits for any in-flight tool calls to finish before running the stop-guard logic.

### No cross-process coordination

There is no file-based lock, no named semaphore, and no advisory lock. If two pi processes share the same session directory (not a supported configuration), atomic writes prevent partial-file corruption but cannot prevent lost-update races. The plugin does not detect or mitigate this scenario.

### Condition process concurrency

Condition subprocesses are spawned and awaited sequentially within a single epsilon/action evaluation. The session lock is held for the duration of the condition call, so no other tool call can mutate session state while a condition is running.

---

## Axis 5 — Threat Model

### T1 — Malicious LLM tool calls

**Description**: A jailbroken or adversarially prompted LLM attempts to abuse its five tool entrypoints to escape the FSM, corrupt state, or read/write arbitrary files.

**Mitigations in code:**

| Attack vector | Mitigation |
|---|---|
| Attempt to pop the stack via a tool | `pop-steering-flow` not registered as a tool; `$END` detection handled by framework code, not LLM-invocable |
| Supply crafted action args to trigger path traversal or shell injection | Args interpolated into an `args` array only — no shell; `resolveFilePath` restricts load paths; condition script paths fixed at parse time |
| Write oversized or malformed tape keys/values | Key regex + JS reserved-name check; 64 KiB value cap; 1 024 key cap; all enforced before disk write |
| Race two tool calls to corrupt state | Per-session mutex serializes all writes |
| Loop the agent by repeatedly calling tools without advancing the FSM | Stagnation guard: SHA1 hash of `(state + tape)` tracked across `agent_end` invocations; after 3 identical hashes, re-prompt is paused and user is notified |
| Suppress the re-prompt indefinitely via `CONFIRM_STOP_TAG` | Only suppresses one turn; stagnation is measured over multiple turns |

**Residual risk**: The LLM can still load an arbitrary YAML file (any path the pi process can read) via `load-steering-flow` if it can guess or discover a valid path. The 2 MiB cap and parse-time validation limit the blast radius of a malformed file but do not restrict which paths are loadable.

### T2 — Corrupt disk state

**Description**: A crash, filesystem error, or manual edit leaves `state.json` or `tape.json` in an unparseable state.

**Mitigations in code:**

- `readJsonStrict` (`storage.ts`) catches `JSON.parse` failures and throws `CorruptedStateError` (a typed error with `.path` and `.cause` fields) rather than returning garbage.
- The outer try/catch in every tool and command handler catches `CorruptedStateError` and converts it to a `friendlyError` message shown to the user. The plugin does not crash.
- The stop hook (`agent_end`) swallows its own exceptions entirely to prevent hook failures from surfacing as unhandled rejections.

**Residual risk**: A corrupt `stack.json` (top-level array) triggers a `CorruptedStateError` that surfaces to the user but does not auto-recover. Manual deletion of `.pi/steering-flow/<SESSION-ID>/` is the recovery path; the plugin provides no automatic repair.

### T3 — Runaway condition scripts

**Description**: A condition script enters an infinite loop, forks many children, or produces unbounded output, exhausting CPU or memory.

**Mitigations in code (`engine.ts`):**

| Threat | Mitigation |
|---|---|
| Infinite loop / hang | 30 000 ms timeout (`CONDITION_TIMEOUT_MS`); on expiry `process.kill(-child.pid, "SIGKILL")` kills the entire process group |
| Stdout flood | Accumulated stdout buffer capped at 64 KiB (`CONDITION_STDOUT_CAP`); excess is silently dropped |
| Stderr flood | Accumulated stderr buffer capped at 16 KiB (`CONDITION_STDERR_CAP`); excess is silently dropped |
| Double-settle (kill after natural exit) | `settled` flag in the `settle()` closure prevents the SIGKILL from firing after the process has already exited |

**Residual risk**: The SIGKILL targets the process group (`-pid`). If the condition script itself calls `setpgid` or `setsid` before forking, grandchild processes could escape the group kill. The session lock is held for up to `CONDITION_TIMEOUT_MS` (30 s) while a runaway condition is executing, blocking all other tool calls for that session.

### T4 — YAML injection / malformed flow files

**Description**: A crafted YAML file exploits the parser or the plugin's structural assumptions to bypass FSM invariants.

**Mitigations in code (`parser.ts`):**

- Parsed with a standard YAML library (no `eval`, no custom deserializer).
- Structural invariants enforced post-parse: single `$START`/`$END`, no self-loops, full reachability BFS, epsilon-depth ≤ 64, file size ≤ 2 MiB.
- Tab characters rejected (YAML tab ambiguity); CRLF normalized before parse.
- `builtin:` references are expanded at parse time to concrete script paths; no dynamic resolution at runtime.

**Residual risk**: YAML aliases and anchors (standard YAML features that can create deeply nested or exponentially large structures — "billion laughs") are only constrained by the 2 MiB file-size cap. A carefully crafted file under 2 MiB could still produce a deeply nested in-memory structure. Whether the chosen YAML library defends against this is not verifiable from the plugin source alone.

---

## Summary Table

| Axis | Key facts |
|---|---|
| **Execution model** | Single Node.js process; event-driven; 5 tools + 6 commands + 3 hooks; per-session async mutex; conditions spawned without shell, SIGKILL on 30 s timeout |
| **Trust boundary** | LLM untrusted (5 tools, no pop); user trusted (pop + 5 other commands); condition scripts trusted (author-placed); YAML semi-trusted (parse-time validated) |
| **Persistence model** | `.pi/steering-flow/<SESSION-ID>/`; atomic tmp+rename; tape-first/state-second commit; orphan tmp sweep on `session_start`; FSM dir deleted on pop |
| **Concurrency model** | Single process; per-session promise-chain mutex; lock needed because pi runs parallel tool calls per turn; no cross-process coordination; atomic writes prevent corruption, not lost updates |
| **Threat model** | T1 malicious LLM (arg validation + lock + no-pop); T2 corrupt disk (CorruptedStateError + friendlyError); T3 runaway conditions (30 s timeout + SIGKILL + stdout/stderr caps); T4 YAML injection (parse-time validation + 2 MiB cap) |
