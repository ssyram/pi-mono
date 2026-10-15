# external-on.md

Backfilled by main agent per Batch C report: the bus/host `on` registration method is an fp target absent from manifest.json externals (the handler closure was captured as manifest fn settings-service.ts:L21::on / extension.ts:L67::bind, not the `on` method itself). Write-once.

## Form 1: `SettingsEventBus.on(channel, handler)` (protocol.ts:54; native evidence packages/coding-agent/src/core/event-bus.ts)

Site: settings-service.ts:21 (`bus.on(MY_SETTINGS_CHANNEL, handler)`).

- Pre: `channel` string; `handler` function. Event-bus dispatch is SYNCHRONOUS per emit (event-bus.ts:15-17): every emit iterates handlers and calls them inline, so a handler throw propagates into the emitter's stack.
- Post: returns an unsubscribe function; subsequent emits no longer invoke the handler after unsubscribe. Registration does not throw for valid arguments; a throwing emitter-side dispatch loop or exotic bus implementation is the host's domain (premise recorded in fn-settings_service-registerMySettingsService-L14.md).
- Caller obligations: handler must not throw outward (discharged: whole handler body is try/caught, settings-service.ts:23-53); unsubscribe (dispose) exceptions converted to structured failure in the returned dispose closure (settings-service.ts:57-64).

## Form 2: `pi.on(event, callback)` (host ExtensionAPI)

Sites: extension.ts:80 (`pi.on("session_start", bind)`), extension.ts:81 (`pi.on("session_tree", bind)`), extension.ts:82 (`pi.on("session_shutdown", shutdown arrow)`).

- Pre: event name string; callback function. Callbacks are dispatched later by the host on lifecycle events; dispatch is host-driven (extern-model.md Pi lifecycle dispatch).
- Post: registers the callback; per extern-model.md, dispatch timing relative to extension load is a host contract (missed-bind window is an 【unknown】 recorded in fn-extension-mySettings-L11.md).
- Failure behavior: any throw from `pi.on` itself is caught by mySettings' outer try (extension.ts:13-88) → diagnostic + inert plugin (fail-closed); partial registration across the three events leaves the service registered but permanently inert — documented, meets prototype diagnostic+inert doctrine.
