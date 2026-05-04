# steering-flow Architecture

This is the canonical design summary for `my-plugins/steering-flow`.
If a specialized doc disagrees with this file, the specialized doc should be
updated to match this model.

## Purpose

`steering-flow` is an in-process pi plugin that enforces user-authored
finite-state-machine workflows on model behavior.
It is not a daemon, not an MCP server, and not a general task runner.

The plugin combines:

- FSM-driven control flow
- program-based transition conditions
- automatic routing states (`epsilon`)
- interactive pause states (`interactive`)
- per-FSM persistent tape
- a stop-hook loop that keeps ordinary states alive while allowing explicit gated pauses

## Canonical reading order

| Need | Read first |
| --- | --- |
| Overall system model | `docs/ARCHITECTURE.md` |
| Flow syntax and condition invocation | `docs/configuration-tutorial.md` |
| Runtime / load / parse / storage behavior | `docs/execution-behavior.md` |
| Builtin condition expansion | `docs/builtin-procedures.md` |
| Comparison with the MCP daemon FSM | `docs/comparison-with-mcp-server-fsm.md` |
| Historical audit / verification | `docs/correctness-audit.md` |
| Authoring checklist | `skills/steering-flow-author/SKILL.md` |

## Core terms

- **Flow**: one user-authored FSM configuration.
- **State**: a node in the flow.
- **Action**: a named branch from a state.
- **Condition**: an external process whose first stdout line decides the branch.
- **Tape**: per-FSM JSON state stored on disk and visible to conditions.
- **Stack**: nested active FSMs in the current session.
- **Epsilon state**: a zero-cost router that auto-chooses a branch.
- **Interactive state**: a non-epsilon gate that may pause the stop-hook loop after the model reaches it.
- **Builtin**: an authoring-time shortcut that expands to a normal condition.

## Runtime model

1. The user loads a flow.
2. The plugin parses and validates the config.
3. The FSM is pushed onto the session stack.
4. The engine enters `$START`.
5. Actions evaluate conditions as spawned processes.
6. Successful transitions advance `current_state_id`.
7. Tape writes persist independently of control-state rollback.
8. When the model reaches `$END`, the FSM pops.
9. If the model is still inside an ordinary flow state at `agent_end`, the stop hook
   re-injects the current state and legal actions.
10. If the top state is interactive, the stop hook shows an info notification and
    lets the agent stop until the next user prompt or a user-only manual command.

The key design decision is the split between:

- **control state**: may roll back on failed transitions
- **tape state**: cumulative, persistent, and not rolled back

## Condition model

Conditions are canonical objects of the form:

```ts
{ cmd: string, args?: string[] }
```

Important rules:

- The engine spawns conditions directly; there is no shell expansion.
- The first stdout line must be `true` or `false`.
- Remaining stdout lines, if any, are the human-readable reason.
- `${$TAPE_FILE}` resolves to the current tape path.
- `${arg-name}` resolves to an action argument.
- Builtins are compiled into canonical conditions before runtime.

## FSM shape

The flow schema is intentionally small:

- `$START` and `$END` are mandatory.
- `$END` is terminal and has no outgoing actions.
- Non-terminal states must have actions.
- Epsilon states are used only for automatic routing.
- Interactive states are non-epsilon gates that still require outgoing actions.
- `default: true` is only valid as the last action in an epsilon state.
- Self-loops are rejected.
- Reachability is enforced so the graph can reach `$END`.

## Tape model

Tape is per-FSM and stored under:

`.pi/steering-flow/<SESSION-ID>/<FSM-ID>/tape.json`

Rules:

- tape is cumulative
- tape is never rolled back
- failed transitions restore control state only
- conditions may read and write tape
- tape writes are serialized with the session lock

## Session / stack model

Each session maintains a stack of active FSMs.

- loading a flow pushes a new FSM
- reaching `$END` pops the current FSM
- `/steering-flow pop` is a user-only escape hatch
- nested FSMs are supported explicitly

## Tool and command boundaries

User-facing command surfaces are consolidated under one slash command:

- `/steering-flow`, `/steering-flow help`, `/steering-flow h`, and `/steering-flow --help` show help
- `/steering-flow load <FILE>` pairs with `load-steering-flow`
- `/steering-flow action <ACTION-ID> [ARGS...]` pairs with `steering-flow-action`
- `/steering-flow save <ID> <VALUE>` pairs with `save-to-steering-flow`
- `/steering-flow context-info` pairs with `get-steering-flow-info`
- `/steering-flow info` is command-only and notify-only
- `/steering-flow set-state` is command-only and user-only
- `/steering-flow reset-state` is command-only and user-only
- `/steering-flow set-action` is command-only and user-only
- `/steering-flow visualize` is command-only
- `/steering-flow pop` is command-only and user-only

Unknown or unparsable subcommands first show a UI error and then render help.

## Persistence model

The runtime persists a small on-disk state bundle per session.
The design relies on atomic writes and a per-session lock so concurrent actions
cannot interleave state mutations.

Files of interest:

- `stack.json`
- `fsm.json`
- `state.json` stores the rollback-capable control state, reminder metadata, and any interactive-pause bookkeeping
- `tape.json` stores cumulative condition-visible data

## Known limitations

The verification audit tracks a few open follow-ups in the implementation and
visualizer paths. See `docs/correctness-audit.md` for the current list.

## Design invariant summary

If you remember only five things, remember these:

1. FSMs drive the model.
2. Conditions are external processes with boolean-first stdout.
3. Tape is persistent and separate from control-state rollback.
4. Epsilon states are routers, not work states.
5. Interactive states are gates: they stop automatic re-injection but remain inside the FSM.
6. The stop hook keeps ordinary states alive until `$END` or a user pop.
