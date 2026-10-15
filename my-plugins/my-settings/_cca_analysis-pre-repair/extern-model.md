# External dispatch model for my-settings no-throw analysis

## Scope and fixed purpose

Analyze only the production TypeScript files directly under `my-plugins/my-settings/`. Exclude `test/`, `_cca_analysis/`, JSON manifests, and Markdown from the source workset. Repository code referenced below is external evidence, not permission to enlarge the production scope or edit it.

The owner requires every analyzed production function, including exported helpers, callbacks, and async paths, to avoid throwing or rejecting outward. Explicit internal `throw` statements are deviations even when caught by a caller. Failures may become structured `SettingsResult` errors or safely contained Pi diagnostics only. Existing README explanations and passing tests do not weaken this requirement.

## Public entry surface

- Package default export: `mySettings` in `extension.ts`, re-exported through `index.ts`.
- Consumer factory: `createMySettingsClient` in `client.ts`, re-exported through `index.ts`; its returned `query`, `saveGlobal`, `saveLocal`, and `saveSession` methods are callable public entry surfaces.
- Protocol adapter: the callback installed by `registerMySettingsService` in `settings-service.ts` is externally driven by the event bus.
- Module-exported helpers are independently callable TypeScript exports; examine their own exception contracts, not merely containment in the main adapter.

Source anchors: `index.ts`, `client.ts`, `extension.ts`, and `README.md` in the analysis root. Determine exact manifest IDs from the generated inventory; do not fabricate IDs or silently omit returned arrows/methods.

## Pi lifecycle dispatch

`pi.on(name, callback)` registers the callback for a Pi event, not a direct immediate call. This plugin registers `session_start`, `session_tree`, and `session_shutdown` in `extension.ts`. The host may invoke these callbacks with an `ExtensionContext`; lifecycle callbacks are external entry surfaces.

Native evidence: repository `packages/coding-agent/src/core/extensions/types.ts` declares the event contracts, and `packages/coding-agent/src/core/extensions/runner.ts` dispatches handlers. `ExtensionContext.sessionManager` is a native readonly session manager. `getSessionId()` may change when a manager is reused for a different session. Do not assume captured context remains current after an await.

`pi.appendEntry(customType, data)` synchronously requests native non-message session-log persistence. It can fail. The plugin must not rely on Pi catching its errors. Read only `getBranch()` for branch-local settings; `getEntries()` or all branches are not equivalent evidence.

## Event bus dispatch

`bus.on(channel, handler)` registers a callback; `bus.emit(channel, data)` triggers handlers for that channel. In `registerMySettingsService`, the channel is `MY_SETTINGS_CHANNEL` (`my-settings:service:v1`). In `client.ts`, `invoke` emits requests on this same channel, so the rich callgraph must connect this emit to the registered service callback, subject to matching channel and session ownership guards.

Native evidence: repository `packages/coding-agent/src/core/event-bus.ts`. Its `EventEmitter.emit` starts registered safe handlers synchronously; each wrapper calls the extension handler before its first await. That explains the synchronous acknowledgement obligation, not an assumption that every async operation has finished.

The protocol `accept(response: Promise<SettingsResult>)` callback belongs to the requesting client. Calling `accept` connects the service callback to the request's `accept` method in `client.ts`. The client must observe the accepted promise and must not wait forever if no service acknowledges during `emit`.

The ready channel is `MY_SETTINGS_READY_CHANNEL` (`my-settings:ready:v1`). The service publishes `{session, sessionId}` from its bind callback. External consumers may listen and query then; no production consumer migration is part of this source scope.

Function-valued ports supplied by `extension.ts` to the service include `isCurrent`, `getBranch`, and `appendEntry`. The service invokes these methods through the `SettingsSession` abstraction; connect those calls to their actual callbacks when source anchors and construction flow close the dispatch proof. `session.isCurrent` is also passed into `writeSettingsFile` as an ownership guard and invoked there.

## Mutation queue and Promise dispatch

`withFileMutationQueue(path, action)` calls `action` after obtaining the same-process file lane and observes its returned promise. It releases the lane in a finally block. Native evidence: repository `packages/coding-agent/src/core/tools/file-mutation-queue.ts`. `extension.ts` passes this host function as the queue argument; `settings-files.ts` invokes `queue(path, async () => ...)`. Connect the queue call to that async callback; distinguish action rejection from ownership revalidation.

Promise `then`/`catch` and async functions have normal ECMAScript rejection semantics. `try` around constructing a Promise does not contain an eventual rejection unless that promise is awaited or rejection-handled. Event-handler callback failures and diagnostics must be contained by this plugin, not by the EventBus's logging catch.

## Filesystem and JSON contracts

Node `fs/promises` operations return promises which may reject. Missing files mean an empty configuration only for the handled `ENOENT` case. Other I/O errors, invalid JSON, invalid values, and invalid paths must become error results under the owner's no-throw requirement; do not invent success/defaults after these failures.

`JSON.parse`, `JSON.stringify`, property accessors/proxies, and externally supplied callback functions can throw under relevant inputs. Analysis must identify the exact containing boundary or explicit premise; do not use TypeScript casts or a passing test as a runtime proof.

File rename can succeed before session logging fails or the session changes. No cross-file/session transaction exists; partial persistence must be reported and must not write a log into a replacement session. The host mutation queue is process-local, not a cross-process lock.

## Unresolved dispatch handling

For each dynamic registration/call above, record real source-backed edges or an `unknown-dispatch` item with its missing guard/bridge. Do not treat strings/type declarations alone as executed calls, and do not seed unrelated top-level graph roots merely to hide missing dispatch edges. Callback functions uncovered by the parser must be reported as extraction/coverage gaps, not certified as absent.
