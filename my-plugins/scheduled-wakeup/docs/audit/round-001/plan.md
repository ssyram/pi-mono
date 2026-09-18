# SCCO Round 001 Plan

> **Superseded by Loop 2.0** — reviews the removed Loop 1.x design; kept as history. Current audit trail: [`docs/ver-2.0/audit/`](../../ver-2.0/audit/).

## Review object

- `my-plugins/scheduled-wakeup/docs/design/principles.md`
- `my-plugins/scheduled-wakeup/docs/design/research.md`
- `my-plugins/scheduled-wakeup/docs/design/architecture.md`
- `my-plugins/scheduled-wakeup/docs/design/detailed-design.md`
- `my-plugins/scheduled-wakeup/README.md`
- `my-plugins/scheduled-wakeup/index.ts`
- `my-plugins/scheduled-wakeup/src/*.ts`
- `my-plugins/scheduled-wakeup/test/*.ts`

## Spec source

- Primary: `my-plugins/scheduled-wakeup/docs/design/principles.md`
- Design: `my-plugins/scheduled-wakeup/docs/design/architecture.md`, `my-plugins/scheduled-wakeup/docs/design/detailed-design.md`
- Project constraints: `AGENTS.md` rules and `my-plugins/CONVENTIONS.md`
- Pi API docs already consulted: extension lifecycle, `sendUserMessage`, `session_start`, `session_shutdown`, timer cleanup.

## Focus

- Sound: implementation/design alignment, lifecycle safety, reload ownership, timer semantics.
- Complete: coverage of stated commands, persistence, busy delivery, overdue and long-delay behavior.
- Concise: unnecessary structures or unsupported claims.
- Optimization: simpler equivalent designs and avoidable dependency/surface area.

## Roles and outputs

- Challenger: `challenger.md`
- Prover: `prover.md`
- Counter: `counter.md`
- Judge: `judge.md`
- Final aggregation/fixes: `resolution.md`
