# Round 2 Candidate Findings

Spec source: Round 2 context derived from user decisions and current source contracts.

## Candidates requiring independent confirmation

### R2-C1: Stagnation threshold sends another continuation instead of halting

- Reports: R2-SM-001.
- Files/functions: `hooks/boulder.ts:handleStagnation` and stagnation branch.
- Claim: after three unchanged actionable-task restarts, Boulder sends another user message and resets `stagnationCount`, but does not disable/latch. This allows recurring continuation attempts for the same stagnant task set.
- Proposed class: Non-Decisional if confirmed.

### R2-C2: Context auto-compaction latch is cleared by compaction

- Reports: R2-SM-002.
- Files/functions: `hooks/context-recovery.ts` `compactedSessions` handling.
- Claim: auto-compaction is documented/source-commented as once per session, but `session_compact` deletes the session from `compactedSessions`, permitting repeated auto-compaction in the same session.
- Proposed class: Non-Decisional if confirmed.

### R2-C3: Task reload can erase live in-memory state when no valid persisted entry exists

- Reports: R2-SM-003 and failure/recovery finding 2 related validation issue.
- Files/functions: `tools/task.ts:reloadState`.
- Claim: `reloadState` assigns empty/default state after scanning if no valid persisted task-state entry exists, erasing current live tasks on `session_tree`/reload.
- Proposed class: Non-Decisional if confirmed.

### R2-C4: Mutating task actions can leave unpersisted in-memory state after synchronous persistence failure

- Reports: failure/recovery finding 1.
- Files/functions: `tools/task.ts` execute path and task action mutations.
- Claim: actions mutate `tasks` before `persistState`; if `appendEntry` throws synchronously, memory remains mutated while durable state is stale.
- Proposed class: Non-Decisional if confirmed.

### R2-C5: Malformed persisted task entries can replace healthy memory

- Reports: failure/recovery finding 2.
- Files/functions: `tools/task.ts:getTaskStateFromEntry`, `reloadState`.
- Claim: minimal validation accepts malformed task arrays that can break downstream task helpers or corrupt active-work decisions.
- Proposed class: Non-Decisional if confirmed.

### R2-C6: Context auto-compaction latch can stick if `ctx.compact()` throws synchronously

- Reports: failure/recovery finding 3.
- Files/functions: `hooks/context-recovery.ts:before_agent_start`.
- Claim: `compactedSessions.add(sessionId)` happens before `ctx.compact()`; synchronous compact failure leaves the latch set and prevents future auto-compact attempts silently.
- Proposed class: Non-Decisional if confirmed.

### R2-C7: Context post-compaction task-restoration synchronous send failures are silent

- Reports: failure/recovery finding 4, external API H1.
- Files/functions: `hooks/context-recovery.ts:session_compact` catch.
- Claim: synchronous failures while sending active-task restoration after compaction are swallowed with no log/notify.
- Proposed class: Non-Decisional if confirmed.

### R2-C8: Custom compaction UI status failures can break fallback/error paths

- Reports: failure/recovery finding 5.
- Files/functions: `hooks/custom-compaction.ts:session_before_compact`.
- Claim: initial `ctx.ui.setStatus` is outside the main try; cleanup status calls in catch/fallback are unguarded, so UI failures can prevent fallback behavior.
- Proposed class: Non-Decisional if confirmed.

### R2-C9: README overstates Boulder as restarting for incomplete tasks

- Reports: DOC-CONSISTENCY-001.
- Files/functions: `README.md` wording.
- Claim: README says Boulder restarts for incomplete tasks, contradicting source/spec active-work semantics `in_progress + ready`.
- Proposed class: Non-Decisional doc fix if confirmed.

### R2-C10: Context recovery and edit-error recovery swallow local hook failures silently

- Reports: external API H1/H2.
- Files/functions: `hooks/context-recovery.ts`, `hooks/edit-error-recovery.ts`.
- Claim: local catches prevent host observability and provide no replacement log/notify.
- Proposed class: Non-Decisional if confirmed.

## Decisional / limitation candidates

### R2-D1: `sendUserMessage` async delivery cannot be awaited/correlated by extensions

- Host/API limitation; requires API design decision.

### R2-D2: `appendEntry` returns no persisted entry id/result through extension API

- Host/API limitation; requires API design decision if stronger persistence acknowledgement is desired.

### R2-D3: UI methods are void/fire-and-forget except synchronous throws

- Host/API limitation; requires API design decision if UI operation acknowledgement is desired.
