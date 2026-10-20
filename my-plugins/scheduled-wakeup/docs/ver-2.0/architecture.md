# Loop 2.0 Architecture

## Scope model

| Scope | Durable owner | Contents | Automatic execution |
| --- | --- | --- | --- |
| `session` | current session custom entries | local definition and progress | only when its session polls |
| `workspace` | workspace shared catalog | reusable definitions and registration index | never until registered |
| `global` | global shared catalog | reusable definitions and registration index | never until registered |

A shared definition is never copied into a session task. A session registration is `{ scope, definitionId }`, private progress, and a matching shared-index record. The index has no prompt, schedule, or progress.

## Components

```text
SessionEntryAdapter --> SessionLoopState <-- RegistrationStore
       |                    ^       |
       | custom snapshots   |       +--> reconciliation
       v                    |
Pi session JSONL            |
                            LoopV2Core --> SharedDefinitionStore (one locked scope catalog)
                                  |                |
                                  |                +--> definition + registration-index transaction
                                  +--> registration/task locks --> executors --> delivery callback
                                  +--> defer-active-task --> session progress snapshot (no delivery)

src/extension.ts (runtime wiring)
       +--> session_start: core construction, reconciliation, countdown restore / expiry, autocomplete, poller gating
       +--> session_shutdown: stop poller, persist suspension marker, dispose runtime
       +--> src/loop-command-handler.ts --> UserLoopV2Commands  (/loop command dispatch)
       +--> src/v2/register-v2-tool.ts --> AiSessionActions     (scheduled_wakeup tool)
       +--> src/v2/due-poller.ts -----> core.runDue()           (adaptive timer + followUp delivery)
       +--> src/v2/parse-v2-command.ts / src/v2/format-list.ts (command grammar / human-readable output)
```

- `definition-store.ts` retains the existing proper-lockfile directory lock around each scope's read/modify/atomic-JSON-replace transaction. Lock-free queries read complete snapshots. Stale timeout is 30 seconds; a writer paused past that limit and later resumed can lose mutual exclusion, an explicitly accepted user boundary. No SQLite or auxiliary writer is introduced.
- `registration-store.ts` owns only session-entry references and progress.
- `loop-core.ts` coordinates catalog-first registration, session-first unregistration, current-session cleanup after delete, reconciliation, session-private defer, and state-locked suspend/resume.
- `session-schedule-lifecycle.ts` batches suspension/restoration into one session snapshot; `resume-progress.ts` preserves interval remaining time or expires a past one-shot without delivery. Executors also restore a suspended reference when an unavailable shared definition becomes resolvable.
- `defer-active-task.ts` owns defer: task/registration execution lock, session state lock, fresh progress lookup, time validation, and persistence through the existing progress action. It does not write shared definitions or registration indexes.
- `loop-command-autocomplete.ts` provides the `/loop` argument provider, including `defer` and active IDs; `src/extension.ts` registers it every `session_start` (Pi drops wrappers on reload).

## Script execution and progress UI

Definitions and targets carry exactly one of the existing `prompt` or a prepared `scriptTask`; task-content.ts handles cloning/read validation without duplicate prompts. The common decoder preserves it in both scope catalogs and session snapshots. Prefix JSON/options parsing and the tool schema feed existing prepareScriptTask; argv remains opaque.

The synchronous core dispatches into task-dispatcher.ts and advances schedule progress on start. The dispatcher owns its in-flight IDs/AbortControllers, calls executeScriptTask without holding state/catalog locks, publishes one custom result with triggerTurn=shouldWake, then re-arms the existing poller. Manual run uses this same path without advancing progress; cancel only removes future scheduling. Runtime disposal stops timers, aborts owned process groups, clears its widget/countdown timer and rejects late publication.

loop-widget-items.ts projects active schedules plus the same in-flight map, deduplicating IDs and putting running rows first. loop-running-widget.ts keeps a one-line aboveEditor summary whenever N>0, hidden at zero. Only fullscreen MouseRegion/keyboard can expand inline; total height is <=10 lines, each item is one waiting countdown or I/K/M/current-command row. Legacy never expands. loop-widget-space.ts measures the official Pi 1.2 public dock components with our own summary forced to one line; unknown/insufficient layouts stay collapsed. A one-second repaint timer exists only for expanded waiting rows and reads cached data, not task storage. /loop show off|on records a branch-local custom preference, default on; no business state, scheduler or settings service is introduced. The old running-only overlay and its line renderer were removed. task-run-renderer.ts wraps the already-generated result text in official Box/Text. Busy NoWake messages follow the official non-continuing queue; they remain in later model context.

## Durable structures

`session-persistence-error.ts` checks the public `getSessionFile()` path is an existing regular file before command `add`/`define`/`register` and tool `add`. Unsaved sessions receive a UI error before creation; list/help/available are not gated. This is the user-approved reduced support boundary, not custom-only flushing or a new database. Pi remains read-only.

```ts
type SharedRegistrationIndex = {
  scope: "workspace" | "global";
  definitionId: string;
  sessionId: string;
  registrationId: string;
  registeredAt: number;
};

type SharedCatalog = {
  version: 2;
  definitions: SharedDefinition[];
  registrations: SharedRegistrationIndex[];
};
```

Active progress may include `suspendedAt`; expired progress records `expiredAt` and preserves execution history without a `nextRunAt`. These fields are session-owned and never appear in a shared catalog. See [the close/resume contract](detailed-design.md#close-and-resume-contract).

A catalog is invalid if a definition/index has another scope, duplicate definition ID, or duplicate `(sessionId, registrationId)`. It is then unavailable rather than partially trusted.

## Registration and deletion flow

1. Registration resolves a definition and atomically writes the index record. It then appends the current session registration. Retrying finds the same index/local reference and is idempotent.
2. Unregistration first appends the session state without that registration, then atomically removes its index record. A failed second step leaves a stale, conservative index.
3. Normal delete locks the selected catalog, checks for index entries with another `sessionId`, and returns `registered-by-others` without mutation when found. Otherwise it removes the definition and all matching index entries atomically.
4. Force delete uses the same transaction without the other-session guard. It invalidates all old references before any offline session can execute them. In-flight work already past definition resolution cannot be recalled.
5. Reconciliation scans local registrations and removes those whose matching index/definition is confirmed absent from a valid catalog. An unreadable catalog preserves local references while blocking execution. Reconciliation is local-session cleanup, not cross-session JSONL mutation.

## Query, defer, and execution flow

- `listActive()` lists active local tasks and active registrations; an unresolved registration remains visible with `definition: undefined`.
- `listAvailable()` reads shared definitions and excludes this session's local registrations; it has no side effect.
- `deferActive()` updates only an active local task/registration's `nextRunAt`; user command dispatch re-arms the existing poller after success. Run count, last run, definition, and other sessions stay unchanged. See [the defer contract](detailed-design.md#defer-contract) for relative/absolute time rules and rejected targets.
- Registration execution requires the matching catalog index and definition on every attempt. Missing either returns `unavailable` without advancing progress.
- Resume restores interval remaining time, keeps future one-shot deadlines absolute, and expires past one-shots before timers start. Expired tasks/registrations do not appear in `listActive()`; shared index membership is preserved.
- After a deferred delivery, a one-shot completes and a recurring task schedules actual delivery time plus its unchanged interval. Already delivered or queued prompts cannot be recalled.

## Boulder service integration

Definitions optionally persist `inhibitBoulder`; registrations resolve the flag from their shared definition and index. `boulder-sync.ts` maps the owning core state to the OMP public get/set Result service, without receiving its private cancel/UI capabilities. No signal enters wakeup prompt content.

`create-loop-runtime.ts` constructs a core/client/poller bound to cwd, manager identity and session ID. `extension.ts` handles startup, branch refresh, service-ready notification, command/tool mutations and shutdown. `DuePoller.fire` synchronizes after due progress advances. Service-ready corrects extension loading order and stores no extra boolean cache.

Current function contracts and no-escape responsibilities: [D.integration](../../../oh-my-pi-v2/docs/boulder-inhibition/integration-contracts.md). Live Pi loading and acceptance are not inferred from unit tests or old standalone CCA results.

## Outer failure boundaries

Pi command/lifecycle/tool callbacks contain ordinary failures; internal operations may retain throwing contracts. Failure reporting is best-effort and never proves rollback. Tool results use `active: null` when state cannot be read, not an invented empty set; schedule-refresh failure preserves the action result. Async completion delegates are awaited inside their catch boundary. A timer unable to re-arm stops its poller and reports the failure without escaping.

New once deadlines must be positive safe integers representable by JavaScript Date. Existing out-of-range data remains inspectable as epoch-ms rather than crashing an entire list. Catalog parsing enforces unique `(sessionId, registrationId)`; failed atomic replacements attempt cleanup of only their own temporary file.

See [the correction contract](../script-tasks/outer-boundary-fix.md) and [the adjudicated findings](../script-tasks/audit/cca-findings.md). Custom-only creation is now explicitly rejected until the session file exists. Same-transcript multiple executors are user-defined UB, not a normal-use guarantee. `loop-instance-owner.ts` isolates reload cleanup by SessionManager identity in a WeakMap; an unrelated instance cannot dispose it. Catalog locking is restored to proper-lockfile; arbitrary pauses beyond its 30-second stale timeout are not covered. The discarded SQLite implementation and its dedicated tests have been removed. Direct tests are not a new CCA certificate. Script task execution and the running widget are now integrated under the user's subsequent approval; the old CCA snapshot is not a proof of these new changes.
