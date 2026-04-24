# Round 2 Reduction

Spec source: Round 2 context derived from user decisions and current source contracts.

## Confirmed candidates

R2-C1 through R2-C10 were independently confirmed. Async host-delivery portions were excluded where reports classified them as host/API limitations.

## Root causes fixed

### R2-RC1: Stagnation halt did not actually halt Boulder

- Source candidates: R2-C1.
- Classification: Non-Decisional.
- Fix: `handleStagnation()` now sets Boulder `disabled = true`, cancels any active countdown, and clears the handle after successfully sending the stagnation stop message.

### R2-RC2: Context auto-compaction latch was not once-per-session and could stick on sync failure

- Source candidates: R2-C2, R2-C6.
- Classification: Non-Decisional.
- Fix: `ctx.compact()` is called before adding the session to `compactedSessions`, and `session_compact` no longer clears `compactedSessions`. The latch is still cleared on `session_shutdown`.

### R2-RC3: Task reload and persisted-state validation could erase/corrupt live state

- Source candidates: R2-C3, R2-C5.
- Classification: Non-Decisional.
- Fix: added strict task-state entry validation in `tools/task-state-entry.ts`; reload installs only a valid persisted state and preserves current memory if no valid state exists.

### R2-RC4: Task mutations were not rolled back on synchronous persistence failure

- Source candidates: R2-C4.
- Classification: Non-Decisional.
- Fix: task tool snapshots `tasks`/`nextId` before mutating actions and restores them if `persistState()` throws synchronously.

### R2-RC5: Local hook/UI failures were swallowed or could break fallback paths

- Source candidates: R2-C7, R2-C8, R2-C10.
- Classification: Non-Decisional.
- Fixes:
  - Context recovery local failures now log via `console.error`.
  - Edit-error recovery local failures now log via `console.error`.
  - Custom compaction status setup and cleanup are inside the handler try path, and cleanup uses a guarded `clearStatus()` helper.

### R2-RC6: README overstated Boulder semantics

- Source candidates: R2-C9.
- Classification: Non-Decisional.
- Fix: README now says Boulder restarts only for actionable tasks (`in_progress` or ready/unblocked `pending`) and updates the directory-tree description.

## Remaining decisional limitations

### R2-D1: Extension `sendUserMessage` async delivery is not awaitable/correlatable

Boulder/context recovery can catch synchronous API errors only. Host async prompt failures are emitted through the runner. Requires host API design if extensions should observe delivery outcomes.

### R2-D2: Extension `appendEntry` does not expose persisted entry id/result

Task persistence can catch synchronous failures, but cannot verify a durable append acknowledgement through the current extension API. Requires host API design if stronger acknowledgement is needed.

### R2-D3: UI methods are void/fire-and-forget

Plugins can guard synchronous UI throws, but cannot observe asynchronous UI operation outcome. Requires host API design if acknowledgement is needed.

## Verification status

Root `npm run check` currently fails only in unrelated `my-plugins/revision` files. The first post-Round1 check passed before unrelated worktree changes appeared. Round 2 verification files record source-level validation for the fixes.
