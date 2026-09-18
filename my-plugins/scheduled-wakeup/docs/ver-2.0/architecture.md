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
```

- `definition-store.ts` owns one scope catalog transaction: definition create/get/list, index membership, and ordinary/force delete all share one file lock and atomic replace.
- `registration-store.ts` owns only session-entry references and progress.
- `loop-core.ts` coordinates catalog-first registration, session-first unregistration, current-session cleanup after delete, and reconciliation.
- `loop-command-autocomplete.ts` exports a future slash-command wrapper; it has no runtime registration.

## Durable structures

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

A catalog is invalid if a definition/index has another scope, duplicate definition ID, or duplicate `(sessionId, registrationId)`. It is then unavailable rather than partially trusted.

## Registration and deletion flow

1. Registration resolves a definition and atomically writes the index record. It then appends the current session registration. Retrying finds the same index/local reference and is idempotent.
2. Unregistration first appends the session state without that registration, then atomically removes its index record. A failed second step leaves a stale, conservative index.
3. Normal delete locks the selected catalog, checks for index entries with another `sessionId`, and returns `registered-by-others` without mutation when found. Otherwise it removes the definition and all matching index entries atomically.
4. Force delete uses the same transaction without the other-session guard. It invalidates all old references before any offline session can execute them. In-flight work already past definition resolution cannot be recalled.
5. Reconciliation scans local registrations and removes those whose matching index/definition is confirmed absent from a valid catalog. An unreadable catalog preserves local references while blocking execution. Reconciliation is local-session cleanup, not cross-session JSONL mutation.

## Query and execution flow

- `listActive()` lists active local tasks and active registrations; an unresolved registration remains visible with `definition: undefined`.
- `listAvailable()` reads shared definitions and excludes this session's local registrations; it has no side effect.
- Registration execution requires the matching catalog index and definition on every attempt. Missing either returns `unavailable` without advancing progress.
