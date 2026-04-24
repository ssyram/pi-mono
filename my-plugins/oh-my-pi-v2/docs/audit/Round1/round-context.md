# Round 1 Context

Spec source: user-provided decisions on top of /hoare-design-style reverse-engineered source spec.

## Target

`my-plugins/oh-my-pi-v2`

## User decisions incorporated into the spec

1. `/omp-stop` should be removed. There should be no persistent command-level Boulder stop mechanism.
2. Esc countdown cancellation is correct as a single-interruption behavior only. It cancels the current countdown/restart attempt and does not create persistent stop state.
3. Boulder active work should be `in_progress + ready`, where ready means unblocked `pending`. Blocked pending tasks alone should not trigger automatic continuation.
4. Boulder hook failures should not throw into the host system, but must be observable. Use diagnostics/log/UI warning, and after repeated failures disable Boulder and notify the user.

## Deployment context

- Execution model: pi extension/plugin for an interactive CLI coding agent.
- Trust boundary: local user input, LLM-generated messages/tool calls, extension hooks, and pi host APIs.
- Persistence model: task state is disk/session-backed through append-only custom session entries; Boulder runtime state is in-memory timers/hook state.
- Concurrency model: async single-process event loop with hook callbacks, countdown timers, and queued/follow-up user-message injection.
- Threat model: local-user-only correctness and stability. Primary risks are runaway continuation, hidden hook failure, task-state drift, and host instability; not internet-facing adversarial security.

## Selected audit dimensions

1. **Protocol / state-machine correctness** — Boulder is a restart state machine driven by `agent_end`, countdown cancellation, task state, and host message injection.
2. **Task actionability / functional correctness** — the user-specified active-work contract is `in_progress + ready`, not all pending tasks.
3. **Resource lifecycle / async concurrency** — countdown timers and hook callbacks must not race, leak, or restart after cancellation/suppression.
4. **Error propagation & observability** — user decision requires non-throwing failures that are still visible and eventually disable Boulder after repeated failures.
5. **External pi API contracts** — Boulder depends on pi hook ordering, `sendUserMessage`, `deliverAs`, UI notification APIs, and custom entry/session behavior; source must be checked, not docs assumed.
