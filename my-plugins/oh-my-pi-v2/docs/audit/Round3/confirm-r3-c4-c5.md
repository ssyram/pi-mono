# Round 3 Independent Confirmation: R3-C4 through R3-C5

Scope: independently verified only R3-C4 and R3-C5 against current source/docs, after reading `round-context.md` and `candidates.md`. Prior Round1/Round2 audit reports were not used.

## R3-C4 — CONFIRMED

Candidate claim: `index.ts` `session_shutdown` calls `ctx.ui.setWidget("omp-tasks", undefined)` without containment, unlike normal widget update paths.

### Source evidence

- `index.ts:58-121` shows the normal task-widget update callback is wrapped in `try/catch`.
- Within that contained path, `index.ts:62` and `index.ts:77` call `latestCtx.ui.setWidget("omp-tasks", undefined)`, and `index.ts:117` calls `latestCtx.ui.setWidget("omp-tasks", lines)`.
- `index.ts:118-120` catches and logs widget update failures: `[oh-my-pi task] Widget update failed: ...`.
- `index.ts:208-212` shows the `session_shutdown` handler directly calls `ctx.ui.setWidget("omp-tasks", undefined);` and then clears `latestCtx`, with no local `try/catch` in the handler.

### Minimal trigger / rationale

If `ctx.ui.setWidget("omp-tasks", undefined)` throws synchronously during `session_shutdown`, that exception is not locally contained by `index.ts`, unlike ordinary task-widget update failures. This conflicts with the Round3 context requirement that hooks must not crash the host and synchronous failures should be observable where feasible.

## R3-C5 — CONFIRMED

Candidate claim: the deployment guide does not clearly state Boulder uses actionable work (`in_progress + ready pending`) and current command semantics after `/omp-stop` removal.

### Source/doc evidence

- `docs/deployment-guide.md:1-151` contains the displayed deployment guide content and does not mention `/omp-stop`, `/omp-start`, `/omp-consult`, `/omp-review`, `in_progress`, `ready`, `pending`, or `actionable`.
- The only Boulder reference in the deployment guide is `docs/deployment-guide.md:132`, which says to test `task/subagent` calls and that Esc can single-cancel a Boulder countdown.
- Current source defines actionable/active task checks as `status === "in_progress"` or `status === "pending" && isUnblocked(t, tasks)` in `index.ts:65-67` and `index.ts:89`.
- Current source registers only `registerStartWork`, `registerConsult`, and `registerReviewPlan` in `index.ts:138-141`; no stop command registration appears there.
- `README.md:11` does document Boulder as restarting when actionable tasks remain: `in_progress` or ready/unblocked `pending`.
- `README.md:14` lists current commands as `/omp-start`, `/omp-consult`, and `/omp-review`, and the shown README excerpts do not list `/omp-stop`.

### Minimal trigger / rationale

A user following `docs/deployment-guide.md` alone does not get the current Boulder actionability rule or the current slash-command surface after `/omp-stop` removal. Although README has the current contract, the deployment guide omits it, so the documentation-gap candidate is confirmed for the deployment guide specifically.
