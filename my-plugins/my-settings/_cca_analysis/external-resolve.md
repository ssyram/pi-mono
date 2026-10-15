# external-resolve.md

Backfilled by main agent per Batch A report: the bare external name `resolve` in manifest.json covers TWO distinct call forms at the same identifier name. Write-once — workers must not rewrite.

## Form 1: `path.resolve` (node:path)

Sites: settings-files.ts:16 (`resolve(root, name)`), settings-files.ts:17 (`relative(resolve(root), path)`).

- Pre: `root`/`name` are strings (or path segments); no side effects.
- Post: returns an absolute normalized path string; throws only on non-string input (TypeError).
- Failure behavior: in settings-files.ts both sites run inside try blocks that convert any throw into a structured `settingsFailure("INVALID_REQUEST"|"OPERATION_FAILED", error)`; callers must keep these calls inside such boundaries.

## Form 2: `Promise.resolve` (ES built-in)

Sites: client.ts:39 (`Promise.resolve(result)`), settings-service.ts:27, settings-service.ts:36, settings-service.ts:45 (indirect via `operation.ok ? execute... : Promise.resolve(operation)`), settings-service.ts:49.

- Pre: any value (including thenables/promises).
- Post: returns a Promise settled/resolved per thenable adoption; per ES spec, obtaining `.then` from a thenable may throw synchronously only for accessor getters — that throw propagates synchronously from `Promise.resolve` itself (host-level); for plain values/promises it never throws.
- Caller obligations (in-repo discharge): every `Promise.resolve(...)` argument in this repo is a structured `SettingsResult`/`SettingsOutcome` or the result object; the receiving side must attach a `.catch` reaction (client.ts:39-42 does) so rejection cannot surface as an unhandled rejection.

Caller obligation summary: treat both forms as non-throwing under the in-repo argument domain; any exotic thenable passed to `Promise.resolve` with a throwing `then` accessor is outside the analyzed contract domain (marked 【unknown】 in fn-client-invoke-L27.md).
