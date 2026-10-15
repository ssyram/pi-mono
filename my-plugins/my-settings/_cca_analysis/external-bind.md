# external-bind.md

Backfilled by main agent per Batch C report: `Function.prototype.bind` is an fp target absent from manifest.json externals (the callgraph edges pointing at extension.ts:L67::bind from these sites are name-collision noise — see open-questions.md). Write-once.

## `Function.prototype.bind(thisArg, ...args)` (ES built-in)

Sites: settings-service.ts:25 (`data.accept.bind(data)`), settings-save.ts:26 (`session.isCurrent.bind(session)`).

- Pre: receiver is callable. In-repo receivers: `data.accept` (guarded `typeof data.accept === "function"` at settings-service.ts:24) and `session.isCurrent` (typed port; exotic session objects are the caller's domain — see fn reports for containment).
- Post: returns a new bound function wrapping the receiver with fixed `this`; never throws for callable receivers (es-spec: bound function exotic object creation cannot throw for valid arguments).
- Failure behavior: for a Proxy whose `getPrototypeOf`/`get` traps throw during bound-function construction or later bound-call `this` resolution, ES permits the trap throw to surface — the call sites sit inside try blocks that convert any throw into structured failures (settings-service.ts:23-53 handler try; settings-files.ts:52-80 queued-action try via writeSettingsFile).
- Caller obligations: none beyond keeping the call inside those boundaries (discharged in-repo).
