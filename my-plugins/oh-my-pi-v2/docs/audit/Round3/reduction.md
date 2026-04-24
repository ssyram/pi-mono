# Round 3 Reduction

Spec source: Round 3 context derived from user decisions and current source contracts.

## Confirmed candidates

All Round 3 candidates R3-C1 through R3-C13 were independently confirmed.

## Root causes to fix

### R3-RC1: Dependency graph invariants are split across live mutation and persisted reload paths

- Source candidates: R3-C1, R3-C2.
- Classification: Non-Decisional.
- Root cause: live `update_deps` mutation and persisted-state validation both reason about dependency edges, but neither has a single normalized reciprocal graph representation before validation. `update_deps` checks cycles before removing stale reverse edges; reload validation accepts non-reciprocal mirrors.
- Fix expectation: build proposed dependency graph from the final intended relation before cycle detection, and require persisted `blocks`/`blockedBy` reciprocity.

### R3-RC2: Persisted primitive validation is incomplete

- Source candidate: R3-C3.
- Classification: Non-Decisional.
- Root cause: timestamp fields are accepted as any JavaScript number, while live code writes `Date.now()` timestamps.
- Fix expectation: require finite nonnegative integer timestamps and a coherent `updatedAt >= createdAt` ordering.

### R3-RC3: Local hook/UI failure containment is inconsistent

- Source candidates: R3-C4, R3-C6, R3-C7, R3-C8, R3-C9, R3-C10.
- Classification: Non-Decisional.
- Root cause: several hooks preserve host stability by returning fallback values, but they do so silently or without guarding cleanup UI paths.
- Fix expectation: add `console.error` diagnostics to local catch paths and contain shutdown widget cleanup failures.

### R3-RC4: Context compaction latch models attempt, not completion/in-flight outcome

- Source candidate: R3-C11.
- Classification: Non-Decisional; confirmation found current host API supports compaction callbacks.
- Root cause: context recovery calls `ctx.compact()` without callbacks and latches the session after trigger attempt, so failed/canceled/non-completing compactions cannot clear or report the latch.
- Fix expectation: use current `ctx.compact` callback API to log completion/failure and clear the latch on failure.

### R3-RC5: Docs/user-facing wording was only partially updated from pending/incomplete to actionable semantics

- Source candidates: R3-C5, R3-C12, R3-C13.
- Classification: Non-Decisional documentation/user-facing fix.
- Root cause: Round 1/2 source behavior changed from broad pending/incomplete wording to actionable-task semantics, but remaining messages and docs were not fully synchronized.
- Fix expectation: align README/deployment guide/restart/countdown wording with `in_progress + ready pending`, and align recommended extension lists.

## Decisional findings

No new Round 3 decisional findings. Known host API limitations from prior rounds remain decisional only for async delivery/acknowledgement semantics outside the local callback APIs.
