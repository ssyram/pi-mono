# external-dispose.md

Manifest external `dispose` — covered for Batch C. Write-once.

## `dispose()` (bus-delivered unsubscribe, SettingsEventBus.on return value)

Site (this batch): settings-service.ts:59 (`dispose()` inside the dispose closure `settings-service.ts:L57::value`); the binding originates from `bus.on(MY_SETTINGS_CHANNEL, handler)` at settings-service.ts:21.

- Pre: callable per protocol.ts:54 (`on(...) => () => void`); the closure treats it defensively — any behavior is allowed (return, throw, double-call effects).
- Post: on normal return the handler registered at settings-service.ts:21 no longer receives `my-settings:service:v1` emits; subsequent client emits degrade to structured SERVICE_UNAVAILABLE (client.ts:50-55). Real-host evidence: EventEmitter.removeListener on an absent listener is a no-op, so the natural double-dispose is idempotent — recorded as evidence, not contract.
- Failure behavior: a synchronous throw is caught at settings-service.ts:61 and folded by settingsFailure into a structured SettingsOutcome failure (:61-62) — the dispose closure is unconditionally no-throw for all dispose behavior domains (proved in fn-settings_service-value-L57.md).
- Contract-level 【unknown】: idempotency of double dispose and emit/dispose race semantics belong to the host bus implementation (protocol.ts:54 documents no timeout or idempotency clause); any outcome remains contained by the :61-62 catch.
