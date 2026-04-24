# Round 4 Context

Spec source: user-provided decisions on top of /hoare-design-style reverse-engineered source spec, refined by Round 1-3 fixes.

## Target

`my-plugins/oh-my-pi-v2`

## Current ground-truth contracts

1. No `/omp-stop`; no persistent command-level stop latch.
2. Esc countdown cancellation is one-shot only.
3. Active/actionable work is `in_progress + ready`, where ready means unblocked `pending`.
4. Blocked pending tasks alone must not trigger Boulder continuation, active prompt injection, compaction task context, or context-restoration continuation.
5. Stagnation stop must actually halt Boulder until session reset.
6. Boulder/context/task/hooks must not crash the host, and local synchronous failures must be observable via logs/UI warning where feasible.
7. Repeated local/synchronous Boulder failures disable Boulder and notify/log.
8. Task state reload installs only strictly valid persisted task-state entries; absent/invalid entries must not erase live memory.
9. Mutating task operations must not notify UI before persistence succeeds and must roll back live memory if synchronous persistence fails.
10. `task.start` only transitions unblocked `pending` tasks to `in_progress`; terminal tasks cannot be resurrected.
11. Dependency graphs must remain reciprocal and acyclic in live updates and persisted reloads.
12. Non-audit docs and user-facing strings must describe current command set and actionable-task semantics.
13. Source must use top-level imports, not inline dynamic imports.

## Known remaining decisional/API limitations

- `sendUserMessage(...): void` prevents extensions from awaiting/correlating async prompt delivery failure.
- `appendEntry(...): void` does not expose persisted entry id/result through the extension API.
- UI methods are void/fire-and-forget except synchronous throws.

Treat these as decisional host/API issues unless current plugin source exposes a local supported fix.

## Selected Round 4 audit dimensions

1. **Post-Round3 regression sweep** — look for new local bugs introduced by fixes.
2. **State-machine/actionability proof** — task statuses, dependencies, Boulder gating.
3. **Hook/API contract proof** — extension API usage, callback/lifecycle containment.
4. **Observability/source-policy proof** — silent catches, inline imports, local failure logging.
5. **Documentation consistency proof** — non-audit docs and user-facing strings.
