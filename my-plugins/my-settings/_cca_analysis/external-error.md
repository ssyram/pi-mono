# external-error.md

Manifest external `error` — covered for Batch C. Write-once.

## `console.error(...)` (host console diagnostic sink)

Site (this batch): settings-error.ts:14 (`console.error(`[my-settings] ${settingsFailure(...).error.message}`)`) — the package's single diagnostic doctrine outlet (arch/prototype.md §2 `reportError`).

- Pre: none assumed. The global `console` may be absent, `console.error` may be non-functional, or a replaced/throwing implementation — the whole call is inside the try at settings-error.ts:13-15.
- Post: returns undefined synchronously in the normal case; at most one diagnostic line emitted. The template argument is always a string (settingsFailure's message is string by construction).
- Failure behavior: ReferenceError (no `console`), TypeError (non-function `error`), or a synchronous throw from a host/patched implementation are all swallowed by the empty catch at settings-error.ts:15 — the diagnostic is lost, nothing propagates. This is exactly prototype.md §2: "诊断自身失败也不向外抛异常".
- Async after-effects (stderr stream 'error' events, process-level crashes from a broken stderr) are host-environment behavior, not a JS exception contract of this call site — recorded separately, not a deviation.
- Caller obligations: route ALL diagnostics through this function (in-repo convention holds: every diagnostic site calls reportSettingsError, never console.error directly).
