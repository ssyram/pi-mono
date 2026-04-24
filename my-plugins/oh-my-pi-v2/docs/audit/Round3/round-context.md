# Round 3 Context

Spec source: user-provided decisions on top of /hoare-design-style reverse-engineered source spec, refined by Round 1 and Round 2 fixes.

## Target

`my-plugins/oh-my-pi-v2`

## Current ground-truth contracts

1. No `/omp-stop`; no persistent command-level stop latch.
2. Esc countdown cancellation is one-shot only.
3. Active/actionable task work is `in_progress + ready`, where ready means unblocked `pending`.
4. Blocked pending tasks alone must not trigger Boulder continuation, active prompt injection, compaction task context, or context-restoration continuation.
5. Stagnation stop must actually halt Boulder until session reset.
6. Boulder/context/task hooks must not crash the host, but local synchronous failures must be observable via logs/UI warning where feasible.
7. Repeated local/synchronous Boulder failures disable Boulder and notify/log.
8. Task state reload installs only strictly valid persisted task-state entries; absent/invalid entries must not erase live memory.
9. Mutating task operations must not notify UI before persistence succeeds and must roll back live memory if synchronous persistence fails.
10. `task.start` only transitions unblocked `pending` tasks to `in_progress`; terminal tasks cannot be resurrected.
11. Non-audit docs must describe current command set and actionable-task semantics.

## Remaining known decisional limitations

- `sendUserMessage(...): void` prevents extensions from awaiting/correlating async prompt delivery failure.
- `appendEntry(...): void` does not expose persisted entry id/result through the extension API.
- UI methods are void/fire-and-forget except synchronous throws.

Treat these as decision items, not local non-decisional bugs, unless current source exposes a local supported fix.

## Deployment context

- Execution model: pi extension/plugin for an interactive CLI coding agent.
- Trust boundary: local user input, LLM-generated messages/tool calls, extension hooks, and pi host APIs.
- Persistence model: task state is disk/session-backed through append-only custom session entries; Boulder runtime state is in-memory timers/hook state.
- Concurrency model: async single-process event loop with hook callbacks, countdown timers, queued/follow-up user-message injection, and session lifecycle events.
- Threat model: local-user-only correctness and stability.

## Selected Round 3 audit dimensions

1. **Post-fix regression correctness** — inspect for bugs introduced by Round 2 fixes.
2. **Task-state validation completeness** — strict persisted-entry validation and rollback semantics.
3. **Hook observability coverage** — remaining local silent failures or fallback-breaking throws.
4. **Lifecycle/disablement correctness** — session reset, stagnation halt, countdown cleanup, and compaction latches.
5. **Documentation/source consistency** — current operational docs vs source/spec.
