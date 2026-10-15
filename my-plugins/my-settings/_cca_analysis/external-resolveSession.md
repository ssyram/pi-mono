# external-resolveSession.md

Manifest external `resolveSession` — covered for Batch C. Write-once. Distinct from external-resolve.md (which covers `path.resolve` and `Promise.resolve`); this is the service's session-resolver parameter.

## `resolveSession(session, sessionId)` (settings-service parameter, realized by the extension resolver closure)

Sites (this batch): settings-service.ts:34 (`const session = resolveSession(data.session, data.sessionId)` inside the handler); parameter wired at settings-service.ts:16 to the resolver closure built in mySettings (extension.ts:16-59, direct edge recorded in edges/fn-settings_service-registerMySettingsService-L14.json).

- Pre (caller-side discharge, Batch B): the handler shape-validates `data.session` (in-data, truthy, object, non-array — settings-service.ts:26) and `data.sessionId` (in-data, non-empty string — settings-service.ts:30) BEFORE the call, so the argument domain is exactly `session: object` (non-null, non-array) ∧ `sessionId: string` (non-empty). The resolver only compares identity (`owner.context.sessionManager !== session`, `owner.sessionId !== sessionId`, extension.ts:19) and reads its own captured state — no property access on the argument, so hostile Proxies cannot fire traps through it.
- Post: returns `SettingsOutcome<SettingsSession | undefined>` (settings-service.ts:16). `ok:true` with `value: undefined` means "this request's session identity is not the active session" — the handler then silently drops (settings-service.ts:39) and the client sees SERVICE_UNAVAILABLE (client.ts:50-55). `ok:false` is a structured SettingsFailure accepted at settings-service.ts:36.
- Failure behavior: contractually never throws — the resolver closure is fully wrapped in try/catch (extension.ts:17-58), every port failure folding into settingsFailure (Batch B discharge). The handler still treats the call as fallible (inside its try, settings-service.ts:23-53) — double containment, no outward throw either way.
- Caller obligations: keep the :26-33 shape validation ahead of every call site (discharged in-repo); treat the returned value as immutable evidence, do not cache across session boundaries (active can flip via bind/shutdown, extension.ts:69/83).
