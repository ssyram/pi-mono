# Round 3 Candidate Findings

Spec source: Round 3 context derived from user decisions and current source contracts.

## R3-C1: `update_deps` can reject a valid final acyclic dependency rewrite

- Source report: `audit-postfix-regressions.md`.
- Claim: `executeUpdateDeps()` cycle precheck builds the proposed graph before removing stale reverse edges from the existing graph. A rewrite that would be acyclic after old reverse edges are removed can be rejected as cyclic.
- Classification: Non-Decisional candidate.

## R3-C2: persisted task dependency mirrors are not validated for reciprocity

- Source reports: `audit-postfix-regressions.md`, `audit-task-state-validation.md`.
- Claim: `validateTaskStateEntryData()` accepts entries where `A.blocks` mentions `B` but `B.blockedBy` does not mention `A`, or vice versa. Live state maintains reciprocal edges, while reload may make blocked work actionable.
- Classification: Non-Decisional candidate.

## R3-C3: persisted task timestamps accept invalid numeric values

- Source report: `audit-postfix-regressions.md`.
- Claim: `parseTask()` only checks `createdAt`/`updatedAt` are numbers, not finite nonnegative integers.
- Classification: Non-Decisional candidate.

## R3-C4: task widget shutdown cleanup can propagate synchronous UI failures

- Source report: `audit-postfix-regressions.md`.
- Claim: `index.ts` `session_shutdown` calls `ctx.ui.setWidget("omp-tasks", undefined)` without containment, unlike normal widget update paths.
- Classification: Non-Decisional candidate.

## R3-C5: deployment documentation omits actionable-task and current command semantics

- Source report: `audit-postfix-regressions.md`.
- Claim: deployment guide does not clearly state Boulder uses actionable work (`in_progress + ready pending`) and current command semantics after `/omp-stop` removal.
- Classification: Non-Decisional documentation candidate.

## R3-C6: keyword detector hook failures are silent

- Source report: `audit-hook-observability.md`.
- Claim: `keyword-detector.ts` catches local hook failures and returns `undefined` without diagnostics.
- Classification: Non-Decisional candidate.

## R3-C7: tool-output truncator failures are silent

- Source report: `audit-hook-observability.md`.
- Claim: `tool-output-truncator.ts` catches local truncation failures and returns `undefined` without diagnostics.
- Classification: Non-Decisional candidate.

## R3-C8: rules injector local failures are silent or indistinguishable from no-match paths

- Source report: `audit-hook-observability.md`.
- Claim: `rules-injector.ts` catches file/rule discovery and injection failures without diagnostics.
- Classification: Non-Decisional candidate.

## R3-C9: Sisyphus prompt hook failures are silent

- Source report: `audit-hook-observability.md`.
- Claim: `sisyphus-prompt.ts` catches agent discovery and prompt injection failures without diagnostics.
- Classification: Non-Decisional candidate.

## R3-C10: comment checker hook failures are silent

- Source report: `audit-hook-observability.md`.
- Claim: `comment-checker.ts` catches AST/checker and outer hook failures without diagnostics, making failures indistinguishable from no lazy comments.
- Classification: Non-Decisional candidate.

## R3-C11: context auto-compaction latch cannot observe failed/canceled compaction completion

- Source report: `audit-lifecycle-disablement.md`.
- Claim: `context-recovery.ts` calls `ctx.compact()` and sets `compactedSessions`; if compaction fails/cancels without `session_compact`, future auto-compaction does not retry in the session. Host API supports callbacks.
- Classification: Non-Decisional candidate if callback API is available; otherwise decisional host API limitation.

## R3-C12: README recommended-extension list is stale vs deployment guide

- Source report: `audit-doc-source-consistency.md`.
- Claim: README omits `pi-intercom` and recommends `pi-mcp-adapter` differently than deployment guide.
- Classification: Non-Decisional documentation candidate.

## R3-C13: Boulder user-facing/source wording still says pending tasks for actionable tasks

- Source report: `audit-doc-source-consistency.md`.
- Claim: `hooks/boulder.ts` restart message and `hooks/boulder-countdown.ts` comments/labels say pending tasks while source semantics pass actionable count/tasks.
- Classification: Non-Decisional candidate.
