# external-catch.md

Backfilled by main agent per Batch A report: `Promise.prototype.catch` is an fp target absent from manifest.json externals (the reaction arrow at client.ts:39-42 was captured as function client.ts:L39::catch). Write-once.

## `Promise.prototype.catch(onRejected)` (ES built-in)

Site: client.ts:39 (`Promise.resolve(result).catch((error: unknown) => {...})`).

- Pre: receiver is a Promise; `onRejected` is a function (here always a closure).
- Post: returns a new Promise. If the receiver rejects, `onRejected` runs as a reaction with the rejection reason; the returned promise settles with `onRejected`'s return value (here: a structured `SettingsFailure`, so the returned promise always fulfills). If the receiver fulfills, `onRejected` never runs.
- Failure behavior: per ES spec, calling `.catch` itself never throws for a Promise receiver; exceptions thrown inside the `onRejected` reaction become rejections of the returned promise. In client.ts:39-42 the reaction body itself is defensive (reportSettingsError never throws, settingsFailure never throws), so the reaction cannot produce a new unhandled rejection.
- Caller obligations: the reaction must not throw (discharged in-repo: reaction body calls only settingsFailure/reportSettingsError, both required no-throw — load-bearing premise forwarded to the settings-error batch); attach `.catch` before the promise can reject (discharged: reaction attached synchronously at creation site client.ts:39).
