# Loop 2.0 Audit Expectations

## Q — review questions

1. Does all session-local status live in plain custom entries rather than LLM-visible messages or shared JSON?
2. Do workspace/global catalogs contain only pure definitions plus registration-index membership, with no run count or automatic execution path?
3. Can `available` be called repeatedly without appending a session entry or creating a registration?
4. Can two sessions register one definition and advance their progress independently?
5. Can two processes for one session execute the same registration concurrently?
6. Can an AI request gain shared authority merely by adding `scope`?
7. Does the shared catalog index every executable registration and make ordinary/force deletion deterministic under its scope lock?
8. Do AI `force`/`scope` inputs fail, and does reconciliation remove invalidated local references without editing another session JSONL?
9. Did any v2 change touch the existing Loop 1.x integration files?

## P — expected proof

| Requirement | Expected evidence |
| --- | --- |
| custom-entry persistence | `v2-session-state.test.ts` checks plain `custom` entries, invalid-snapshot skipping, recovery, and append failure rollback |
| session default and AI boundary | `v2-core.test.ts` rejects AI `scope`, creates a session task without scope, and uses user-only shared commands |
| workspace/global definitions | `v2-core.test.ts` writes and lists independent workspace/global stores |
| query does not register | `v2-core.test.ts` checks empty registrations after `available` |
| cross-session independence | `v2-core.test.ts` registers one global definition in two separate journals and verifies separate run counts |
| exclusion and restoration | `v2-execution.test.ts` uses two independently constructed cores for the same session, proves one gets `locked`, and reconstructs completed progress |
| shared index and deletion | `v2-shared-delete.test.ts` covers two sessions, conservative failed registration append, ordinary delete blocking, force invalidation, and reconciliation |
| autocomplete | `v2-command-autocomplete.test.ts` covers top-level, scope, dynamic IDs, force, loose matching, forced Tab, and fallback |
| no old-loop wiring | changed-file review contains only `src/v2/`, `test/v2-*.test.ts`, and `docs/ver-2.0/` |

## D — acceptance boundaries

The review must accept at-least-once delivery after a crash between external delivery and session-entry append; that limitation is documented, visible in the `failed`/`compromised` outcomes, and is not hidden as exactly-once behavior. It must reject any implementation that copies a shared prompt/schedule into `Registration`, lets an AI tool accept a shared scope, or writes execution progress to a shared definition document.

The review must also reject a lock that is released before delivery, a state update that occurs before delivery success, a cancellation path that bypasses the task/registration execution lock, an executable registration without a catalog index, or force semantics that claim to atomically erase another session JSONL.

## I — audit procedure

1. Inspect line counts for every `src/v2/*.ts` file; each must be at most 200 lines and use no `any` or dynamic import.
2. Run the three v2 tests directly, then all scheduled-wakeup tests directly through Node with `tsx`.
3. Run `npx tsc -p my-plugins/scheduled-wakeup/tsconfig.json` and root `npm run check`.
4. Review the diff against the non-target list in `integration-plan.md`.
5. Confirm `git diff --cached --name-only` is empty; this task does not stage or commit files.
