# Round 2 Context

Spec source: user-provided decisions on top of /hoare-design-style reverse-engineered source spec, refined by Round 1 fixes.

## Target

`my-plugins/oh-my-pi-v2`

## Current ground-truth contracts

1. There is no `/omp-stop` command and no persistent command-level Boulder stop latch.
2. Esc countdown cancellation is a one-shot interruption only; it cancels the current countdown/restart attempt and does not create persistent stop state.
3. Boulder active work is `in_progress + ready`, where ready means unblocked `pending`. Blocked pending tasks alone must not trigger automatic continuation, active task prompt injection, compaction task context, or context-restoration continuation.
4. Boulder hook failures must not throw into the host. They must be observable via diagnostics/log/UI warning where possible. Repeated local/synchronous Boulder failures disable Boulder and notify/log.
5. Task state is session-backed with append-only custom entries. Reload must not destroy current in-memory state on failed session reads. Mutating task operations must not notify UI before persistence succeeds.
6. `task.start` is only valid for `pending` tasks that are unblocked. Terminal `done`/`expired` tasks must not be resurrected by `start`.

## Remaining known limitation from Round 1

Extension-facing `sendUserMessage(...): void` prevents Boulder from awaiting async prompt delivery failures. Host may emit those failures separately. Treat this as a limitation / potential decisional API item, not a local non-decisional source bug unless a local subscription or deterministic workaround exists in source.

## Deployment context

- Execution model: pi extension/plugin for an interactive CLI coding agent.
- Trust boundary: local user input, LLM-generated messages/tool calls, extension hooks, and pi host APIs.
- Persistence model: task state is disk/session-backed through append-only custom session entries; Boulder runtime state is in-memory timers/hook state.
- Concurrency model: async single-process event loop with hook callbacks, countdown timers, queued/follow-up user-message injection, and session lifecycle events.
- Threat model: local-user-only correctness and stability. Primary risks are runaway continuation, hidden hook failure, task-state drift, stale docs, and host instability; not internet-facing adversarial security.

## Selected audit dimensions

1. **Post-fix protocol/state-machine correctness** — verify the revised Boulder state machine under countdown, disablement, stagnation, compaction, and task-state transitions.
2. **Cross-consumer task actionability consistency** — all consumers of task state must agree on `in_progress + ready` where they mean active work.
3. **Failure/recovery correctness** — logging/disablement/persistence changes must not introduce new inconsistent states or repeated hidden failures.
4. **Documentation/spec consistency** — non-audit docs must describe current command set and actionable-task semantics.
5. **External API limitation boundary** — distinguish local bugs from host API constraints around void extension APIs and hook error channels.
