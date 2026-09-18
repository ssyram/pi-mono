# Loop 2.0 remediation decisions

## Accepted changes

### D1 — Reject a mixed-scope shared document

**Decision:** `SharedDefinitionStore` passes the selected scope into `load()`. If any parseable definition has a different embedded scope, the store returns an empty list for that document.

**Why:** Scope is a durable-store invariant, not merely a caller filter. Returning the valid-looking subset would conceal a corrupt document and would leave the store's ownership boundary ambiguous. Treating the document as unavailable matches the existing corrupt-document recovery rule.

**Test:** `v2-core.test.ts` uses a workspace-file fixture containing both workspace and global definitions and verifies `list` and `get` do not materialize either entry.

### D2 — Preserve unresolved active registrations in `listActive()`

**Decision:** An active registration is returned even if the referenced shared definition is missing or corrupt. It uses the existing `kind: "registration"` shape with an explicit `definition: undefined` value.

**Why:** The registration and its progress are session-owned facts. A failed shared-store lookup must not erase that fact from `/loop list`. Keeping the existing kind avoids introducing a second representation for the same registration; the undefined definition makes its resolution state explicit.

**Test:** `v2-core.test.ts` corrupts a previously registered workspace document and verifies the active registration remains listed and unresolved.

### D3 — Map only state-lock contention during cancellation to `busy`

**Decision:** Add a private non-throwing state-lock attempt for the two cancellation operations. They retain resource-lock-first ordering and return `busy` only when the state lock cannot be acquired.

**Why:** `CancellationResult` promises `busy` for contention. Broad exception swallowing would hide append or storage failures and weaken observability, so ordinary mutation APIs and non-contention failures retain their existing behavior.

**Test:** `v2-execution.test.ts` cancels a second local task and unregisters a shared registration from inside a delivery callback while the first task owns the state lock. It also verifies the AI cancel surface returns a normal busy response.

### D4 — Complete the reference-only regression assertion

**Decision:** Assert that a persisted registration has neither an own `prompt` property nor an own `schedule` property.

**Why:** Both fields would denormalize the shared definition into session state and violate the reference-only registration contract.

### D5 — Catalog registration index and deletion authority

**Decision:** Each scope catalog persists registration membership beside definitions, without progress. Registration adds its catalog record before its session entry; unregistration removes the session entry before the catalog record. Ordinary deletion rejects another session's registration; user force deletion atomically invalidates all catalog membership and the definition.

**Why:** A session log alone cannot answer whether another session has registered a shared definition. A catalog transaction makes the delete check and mutation race-free. The ordering makes stale state conservative: stale index can block deletion, but an unindexed local reference cannot execute.

**Test:** `v2-shared-delete.test.ts` covers two-session membership, normal blocking, AI force rejection, force invalidation, reconciliation, idempotent retry, and observable ordering.

### D6 — `/loop` autocomplete provider *(superseded by D8)*

**Decision:** Export the Loop-specific wrapper without registering it. It completes command grammar, scope tokens, active IDs, shared IDs, and force from a runtime source.

**Why:** It provides the same forced-Tab and fallback behavior as Impression without implicitly changing Loop 1.x command registration.

**Superseded:** D8's integration registers this provider on every `session_start` from `src/extension.ts`; the "do not register" half no longer applies. The provider itself is unchanged.

**Test:** `v2-command-autocomplete.test.ts` covers normal/forced suggestions, fuzzy match, dynamic candidates, apply, and fallback.

### D7 — Do not equate an unreadable catalog with force deletion

**Decision:** Catalog reads distinguish `unavailable` from a valid catalog that confirms an index is missing. Reconciliation removes only the latter; executors reject both as unavailable for execution.

**Why:** A malformed or transiently unreadable shared file is not evidence that the user deleted its definitions. Treating both states alike would silently erase session registrations during startup reconciliation.

**Test:** `v2-core.test.ts` corrupts the catalog, verifies the registration remains visible and unresolved, then verifies reconciliation preserves it.

### D8 — Loop 2.0 became the only implementation

**Decision:** With user approval, Loop 2.0 was wired into `src/extension.ts` (command dispatch via `src/v2/parse-v2-command.ts` and `src/loop-command-handler.ts`, tool via `src/v2/register-v2-tool.ts`, timers via `src/v2/due-poller.ts`, formatting via `src/v2/format-list.ts`). Loop 1.x (`scheduler.ts`, `job-store.ts`, `register-scheduled-wakeup-tool.ts`, `parse-loop-command.ts`, `format-job.ts`, `types.ts`) was deleted outright — no dual-track, no compatibility layer, no jobs.json migration.

**Why:** Two schedulers sharing one `/loop` name invited divergent state. The v2 core had passed design review and audit; the cutover removes the drift risk instead of managing it.

**Test:** `test/parse-v2-command.test.ts` (full grammar), `test/due-poller.test.ts` (arming, chunking, unref/runner ref, clearing, failure backoff), `test/register-v2-tool.test.ts` (delay/at/interval conversion, scope/force rejection, onMutation), `test/extension.test.ts` (print-mode poller skip, runner-mode delivery, shutdown timer clearing, session_start reconciliation and autocomplete wiring).

## Explicit non-decisions

- *(superseded by D8)* Do not add Loop 2.0 imports, commands, tools, scheduler hooks, timers, or extension wiring. The current task is core-only by contract.
- Do not change the behavior of a missing definition during execution: it remains `unavailable` and does not advance local progress.
- Do not repair unrelated root TypeScript diagnostics, global staged content, or the plugin's untracked Git provenance. They are verification constraints outside this remediation.
- *(superseded by user approval)* Do not stage or commit any files.
