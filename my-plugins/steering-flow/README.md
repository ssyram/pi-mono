# steering-flow

A pi plugin that enforces user-authored **state-machine workflows** on the model's behavior.

## Why

Large models tend to:

- **Stop early** on long tasks, leaving work incomplete.
- **Drift** mid-flow, skipping mandatory steps even when given a checklist.
- Ignore task lists that cannot express branching, retry, or data-dependent routing.

`steering-flow` lets you describe a workflow as a **finite state machine** — with program-based transition conditions (MCP-style: executable + fixed args), automatic routing (`epsilon`) states, and a writable tape (`tape.json`) the conditions read and write. The model is forced to drive the FSM to `$END` and cannot silently exit: a Stop hook re-injects the current state + legal actions until the flow completes.

## Documentation map

- [Architecture](docs/ARCHITECTURE.md) — canonical design summary
- [Flow config tutorial](docs/configuration-tutorial.md) — full syntax and invocation semantics
- [Runtime behavior](docs/execution-behavior.md) — load, parse, validation, and storage behavior
- [Builtin procedures](docs/builtin-procedures.md) — parser-expansion shortcuts
- [Comparison with MCP server FSM](docs/comparison-with-mcp-server-fsm.md) — alternative architecture comparison
- [Correctness audit](docs/correctness-audit.md) — verification history and open limitations
- [Authoring skill](skills/steering-flow-author/SKILL.md) — quick authoring checklist

## Concepts

### Flow config

```yaml
task_description: "Human-readable overall task"
states:
  - state_id: "$START"
    state_desc: "..."
    is_epsilon: false
    actions:
      - action_id: "plan"
        action_desc: "..."
        arguments:
          - { arg_name: "PLAN_TEXT", arg_desc: "..." }
        condition:
          cmd: "node"
          args: ["./scripts/save-plan.mjs", "${$TAPE_FILE}", "${PLAN_TEXT}"]
        next_state_id: "implement"
  # ...
  - state_id: "$END"
    state_desc: "Flow result description"
    is_epsilon: false
    actions: []
```

### Condition model

Each `condition` is one of:

- `{ default: true }` — only valid as the **last** action of an **epsilon** state. Always matches.
- `{ cmd: <executable>, args?: [<string>...] }` — runs a program.

At runtime the child process is spawned (no shell) with argv built from `args` after placeholder interpolation:

- `${$TAPE_FILE}` — replaced with the absolute path to `tape.json`.
- `${arg-name}` — replaced with the LLM-supplied value for that action argument.

Example: `args: ["./scripts/save-plan.mjs", "${$TAPE_FILE}", "${PLAN_TEXT}"]` expands to `[cmd, ./scripts/save-plan.mjs, /abs/tape.json, <llm-value>]`.

**Stdout contract**: first line is literally `true` or `false` (case-insensitive). Remaining lines are the human-readable reason (returned to the LLM verbatim).

Runtime limits: 30 s wall-clock timeout with process-group SIGKILL, 64 KiB stdout cap, 16 KiB stderr cap.

> **SIGKILL truncation accepted**: Condition processes write `tape.json` directly via the `${$TAPE_FILE}` path. If a condition is killed mid-write (30 s timeout → SIGKILL), `tape.json` may be left truncated. This is an inherent property of the external-process condition model and is accepted. The interrupt is absolute — if the tool did not report completion via stdout, the write is considered interrupted.

### Why argv, not shell

- No shell injection surface — LLM-supplied `args` are always positional argv, never interpreted by a shell.
- Portable — no `bash` dependency; works anywhere `cmd` is on PATH.
- Deterministic — no login profiles, no history expansion, no glob, no quoting puzzles.
- Testable — the flow author writes a script and can test it in isolation.

### Rules (enforced at parse time)

- Exactly one `$START`, exactly one `$END`. `$END` has no actions and is non-epsilon.
- `action_id` and non-sentinel `state_id` must match `/^[A-Za-z_][A-Za-z0-9_]*$/`.
- `arg_name` must match `/^[A-Za-z0-9_-]+$/`; names starting with `$` are reserved for special placeholders.
- No self-loops (`next_state_id !== state_id`).
- Every `next_state_id` must resolve.
- Epsilon states: all actions take no `arguments`, the **last** action's `condition` must be `{default: true}`, earlier actions must **not** be `{default: true}`.
- Non-epsilon states: no action may use `{default: true}`.
- `$END` must be reachable from `$START`, and every reachable state must have a path to `$END` (bidirectional BFS — no dead-end states).
- Flow file ≤ 2 MiB, YAML with tabs rejected, CRLF normalized.

### Turing tape

Per-FSM JSON file under `.pi/steering-flow/<session>/<fsm-id>/tape.json`. Writers:

- The condition process itself (by reading/modifying/writing the path received via `${$TAPE_FILE}` in its `args`).
- `/save-to-steering-flow <ID> <VALUE>` (user).
- `save-to-steering-flow` tool (LLM).

Caps: ≤ 64 KiB per value, ≤ 1024 keys total. Tape ids must match `/^[A-Za-z_][A-Za-z0-9_]*$/`.

> **Tape is cumulative, never rolled back**: Tape records execution history. When a transition fails (including epsilon chain failures), only `current_state_id` is rolled back; any tape mutations written by conditions during that attempt are preserved on disk. This is intentional — conditions write to tape as side effects representing work done regardless of whether the state transition succeeded. If full transactional rollback is needed, the recommended approach is git-based tape management external to steering-flow.

### Stack

Multiple FSMs can be nested. Each load pushes; reaching `$END` pops. `/pop-steering-flow` (user-only) force-pops.

### On-disk state

```
.pi/steering-flow/<SESSION-ID>/
  stack.json                     # ordered list of FSM-IDs (last = top)
  <FSM-ID>/
    fsm.json                     # parsed FSM structure
    state.json                   # current_state_id + last_transition_chain + stagnation bookkeeping
    tape.json                    # { id: value, ... }
```

All writes are atomic (tmp + rename). Orphan `.tmp.*` files are swept on `session_start`. Per-session async mutex serializes all read-modify-write operations across parallel tool calls.

## Commands (user)

| Command | Purpose |
|---|---|
| `/load-steering-flow <FILE>` | Parse + push a flow config onto the stack |
| `/pop-steering-flow` | Pop the top FSM (user-only — LLM cannot) |
| `/save-to-steering-flow <ID> <VALUE>` | Write a tape entry |
| `/get-steering-flow-info` | Dump the stack, states, and tapes |
| `/steering-flow-action <ACTION-ID> [ARGS...]` | Invoke an action |
| `/visualize-steering-flow` | Visualize FSM states as a text diagram (user-only) |

> **Design decision — visualizer is a command-only tool**: The visualizer is invoked exclusively via `/visualize-steering-flow` — it is not available as an LLM tool. Warnings about skipped FSMs or empty visualizations are surfaced to the user via `ctx.ui.notify`. Output paths are contained within `cwd` (no path traversal).

## Tools (LLM)

- `load-steering-flow(file)`
- `steering-flow-action(action_id, args[])`
- `save-to-steering-flow(id, value)`
- `get-steering-flow-info()`

`pop-steering-flow` is intentionally **not** a tool (user-only per spec).

## Transitions

1. LLM calls `steering-flow-action` with `action_id` and positional `args`.
2. Engine finds the action under the current state. Rejects if the action doesn't exist or the arg count doesn't match the declaration.
3. Engine spawns the condition with argv built by interpolating `${$TAPE_FILE}` and `${arg-name}` placeholders in `cfg.args`.
4. Stdout `true\n<reason>` → transition to `next_state_id`. Stdout `false\n<reason>` → stay, surface reason.
5. After any successful transition, if the new state is epsilon, the engine auto-routes: tries each action's condition in declared order, first `true` wins, `{default:true}` matches unconditionally. Depth capped at 64.
6. Reaching `$END` pops the FSM and resumes the parent flow (if any).
7. If the epsilon chain fails after the chosen action's condition already passed, `current_state_id` is **rolled back** to the pre-transition state and nothing is written to `state.json`. Note: any tape mutations written by conditions during the attempt are **preserved** — tape is cumulative and is never rolled back (see below).
8. The in-memory tape is re-synced from disk after every condition so side-channel writes are visible next turn.

## Stop hook

When `agent_end` fires with a non-empty stack and a non-$END top state, the plugin re-injects the current state view + legal actions + overall task via `pi.sendUserMessage(...)`. Guards (matching the ralph-loop / boulder pattern):

- User abort (`ctx.signal.aborted` or `AssistantMessage.stopReason === "aborted"`)
- 30 s cooldown after `session_compact`
- Stagnation limit: 3 consecutive identical-`(state, tape)` reminders → pause reminders, notify user

> **Design decision — stop hook is fully automatic**: The stop hook **always** re-injects state when the LLM stops mid-flow (before `$END`). There is no question detection and no confirm-to-stop mechanism. The only way to stop the loop is reaching `$END` or the user manually calling `/pop-steering-flow`. The only guard beyond user abort is the 30-second compaction cooldown per session.

> **Stagnation counter freeze on ENOSPC accepted**: The stagnation counter (`reminder_count` in `state.json`) is written inside the stop hook's error-swallowing `try/catch`. If `writeState` fails (e.g., ENOSPC), the counter freezes and the user may receive repeated reminders. This is accepted because ENOSPC indicates a system-level failure beyond steering-flow's scope; propagating the error would risk crashing the agent on disk-full conditions.
- Corrupted state surfaced to the user (not silently swallowed)

## Example

See `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/examples/code-review.yaml` and `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/examples/scripts/`:

```
/load-steering-flow examples/code-review.yaml
# → $START with action `plan`
steering-flow-action plan "my plan text"
# → `implement` (save-plan.mjs wrote PLAN_TEXT to tape)
# ...do the work...
save-to-steering-flow CODE_WRITTEN 1
steering-flow-action mark_done
# → `test`
# ...run tests...
save-to-steering-flow TESTS_PASSED 1
steering-flow-action tests_run
# → epsilon test_router → `review`
steering-flow-action approve
# 🏁 $END, FSM popped.
```

## Writing conditions

- Keep the script short, deterministic, and exit quickly.
- Always print `true` or `false` as the **first** line.
- Put the reason on subsequent lines (required on `false`).
- `process.argv` layout (Node.js): `[node_binary, script_path, ...interpolated_args]`. Place `${$TAPE_FILE}` and `${arg-name}` tokens in `args` where you want them; the engine substitutes them before spawning. Example: `args: ["${$TAPE_FILE}", "${MY_ARG}"]` → `process.argv[2]` = tape path, `process.argv[3]` = LLM-supplied value.
- Exit code is ignored; stdout determines the outcome.
- If your condition doesn't need tape data, simply omit `${$TAPE_FILE}` from `args`.

## Builtin conditions

Steering-flow ships a small library of ready-to-use builtin conditions (e.g.
`validate/non-empty-args`, `self-check/basic`, `submit/required-fields`,
`soft-review/claude`). Reference them with `builtin:` instead of `cmd:`/`args:`
in your condition block — the parser expands them at load time into ordinary
`cmd`-based conditions.

See [`docs/builtin-procedures.md`](docs/builtin-procedures.md) for the full registry,
argument contracts, and authoring notes. Note that `soft-review/*` builtins are
placeholder stubs and fail closed until you replace their helper scripts with
real reviewer implementations.
