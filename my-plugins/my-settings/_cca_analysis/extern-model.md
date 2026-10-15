# External dispatch model for my-settings no-throw analysis (post-rewrite)

## Scope and fixed purpose

Analyze only the production TypeScript files directly under `my-plugins/my-settings/`. Exclude `test/`, `_cca_analysis/`, `_cca_analysis-pre-repair/`, `arch/`, JSON manifests, and Markdown from the source workset. The authoritative semantic spec is `arch/prototype.md` (user-approved). Do not modify any source.

The owner's standing requirement: every production function — exported helpers, callbacks, closures, async paths — must not throw or reject outward. Explicit `throw` is a deviation even when caught by a caller. Failures may only become structured `SettingsResult`/`SettingsOutcome` errors or safe Pi diagnostics (`reportSettingsError` → `console.error`, never throwing). Do not accept "outer catch", "tests pass", or README claims as proof of per-function no-throw.

## Public entry surfaces

- Package default export: `mySettings` in `extension.ts` (re-exported via `index.ts`).
- Consumer factory: `createMySettingsClient` in `client.ts`; its returned methods `query`, `saveGlobalOnly`, `saveLocalOnly`, `saveGlobalAndSession`, `saveLocalAndSession`, `saveSession` are public entry surfaces.
- Service registration: `registerMySettingsService` in `settings-service.ts` — the callback installed via `bus.on` is externally driven.
- Query executor: `executeSettingsQuery` (`settings-query.ts`); save executor: `executeSettingsSave` (`settings-save.ts`); field filter `pickValidFields` (`settings-kind.ts`); session log `appendSessionSettings`/`readSessionPatches` (`settings-session-log.ts`); operation parser `parseSettingsOperation` (`settings-operation.ts`); JSON snapshot `copySettings` (`json-settings.ts`); file helpers `settingsFilePath`/`readSettingsFile`/`writeSettingsFile` (`settings-files.ts`); `settingsFailure`/`reportSettingsError` (`settings-error.ts`). All are independently callable exports with their own exception contracts.

## Pi lifecycle dispatch

`pi.on(name, callback)` registers callbacks for later host dispatch (`session_start`, `session_tree`, `session_shutdown` in `extension.ts`). Lifecycle callbacks are external entry surfaces. `pi.appendEntry(customType, data)` is synchronous, can fail, and must not rely on Pi catching plugin errors. `sessionManager.getSessionId()`/`getBranch()` can change or fail; a captured context is not guaranteed current after an await. `withFileMutationQueue(path, action)` from the host serializes same-file read-modify-write per process (native evidence: `packages/coding-agent/src/core/tools/file-mutation-queue.ts`).

## Event bus dispatch

`bus.emit`/`bus.on` per `packages/coding-agent/src/core/event-bus.ts`. Service channel `my-settings:service:v1` (`MY_SETTINGS_CHANNEL`); ready channel `my-settings:ready:v1`. The client's `invoke` emits requests; the service handler must call `accept(promise)` synchronously. The `accept` callback belongs to the requesting client; late or duplicate accepts must not leak unhandled rejections. Function-valued session ports (`isCurrent`, `getBranch`, `appendEntry`) are invoked by the service through the `SettingsSession` abstraction; connect calls to the closures constructed in `extension.ts`.

## Semantics to verify against the prototype

1. Query merge order defaults < global file < local file < session log; `scope: "global"` must not read the local file; `scope` defaults to session.
2. Per-key kind filtering by the default value's kind (null/boolean/number/string/array/object): mismatch → diagnose + drop that source's key only; lower-priority valid values still win. Source file read failure → diagnose + skip that source. Structurally corrupt session-log entries → skip individually; branch read failure → skip the session layer with a diagnostic.
3. Saves: five ops. Only-variants write exactly their file, never the log; `saveSession` only appends the log; AndSession = file step whose failure is diagnosed and swallowed, then the log step decides the overall result; log entry data is `{ values }` only. File saves use the raw original object as baseline (never the filtered query result) and must not overwrite a corrupt original.
4. `PARTIAL_SAVE` no longer exists in the error code union.

## Unresolved dispatch handling

For each dynamic registration/call, record real source-backed edges or `unknown-dispatch`. Do not treat strings/type declarations as executed calls. Report extractor gaps (arrow methods, nested callbacks) instead of certifying them absent.
