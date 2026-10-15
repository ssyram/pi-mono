# demo-settings-consumer

A working example of a plugin that consumes the `my-settings` shared settings service. Load it alongside `my-settings` to see the full consumer pattern end-to-end.

## What this demonstrates

1. **Ready listener** — subscribe to `my-settings:ready:v1` in the extension factory (before `session_start`), then query your own keys when it fires.
2. **Client creation** — build a `createMySettingsClient` from the ready payload or from `ctx.sessionManager`.
3. **Typed defaults as schema** — each key's default value declares its kind (boolean, string, number, null, string[], object, array-of-objects, deeply nested object, number[][]). The service filters per-source values against these kinds.
4. **Own validation** — the consumer validates returned values against its own TypeScript interface (`validateState`). The service guarantees JSON legality; the consumer guarantees semantic shape.
5. **Sub-JSON values** — objects, arrays, deeply nested structures, and matrices are stored/retrieved as whole values. No recursive merging; a new value replaces the old one at the top-level key.
6. **Save + query round-trip** — `saveLocalAndSession` writes the project file + session log; the next query sees the updated value.
7. **Session unset (reset)** — `unsetSession` appends a tombstone that cancels this session's override, falling back to file-layer or default values.
8. **Error handling** — `result.ok === false` carries a structured error code and message; never a throw.

## Load

```sh
pi \
  --extension ./my-plugins/my-settings/index.ts \
  --extension ./my-plugins/demo-settings-consumer/index.ts
```

## Try it

```text
/demo-settings                          — show all 10 keys (nested objects, arrays, matrix)
/demo-settings set demo.server '{"host": "0.0.0.0", "port": 9443, "tls": true}'
/demo-settings set demo.tags '["prod", "staging", "dev", "canary"]'
/demo-settings set demo.matrix '[[0,1],[1,0]]'
/demo-settings set demo.nested '{"level1": {"level2": {"deep": "changed", "arr": [9,8,7,6,5]}}}'
/demo-settings set demo.limit 42
/demo-settings set demo.optional null
/demo-settings reset demo.server        — cancel this session's override, fall back to file/default
/my-setting get demo.server demo.tags demo.matrix demo.nested  — raw per-layer view via the service command
```

## Key patterns to copy

```ts
// Factory: subscribe before session_start
pi.events.on(MY_SETTINGS_READY_CHANNEL, (data) => {
	const client = createMySettingsClient(pi.events, data as SettingsReady);
	// query, save, unset — all return results, never throw
});

// Command handler: build from ctx
const identity = { session: ctx.sessionManager, sessionId: ctx.sessionManager.getSessionId() };
const client = createMySettingsClient(pi.events, identity);
```

## E2E verified

Loaded alongside `my-settings` in a real pi session (mock LLM):

```text
[demo-consumer] loaded 9 keys (incl. nested objects, arrays, matrix)

/demo-settings set demo.server {"host": "0.0.0.0", "port": 9443, "tls": true}
  → demo.server          {"tls":true,"port":9443,"host":"0.0.0.0"}

/demo-settings set demo.tags ["prod","staging","dev","canary"]
  → demo.tags            ["prod","staging","dev","canary"]

/demo-settings set demo.matrix [[0,1],[1,0]]
  → demo.matrix          [[0,1],[1,0]]

/demo-settings set demo.nested {"level1": {"level2": {"deep": "changed", "arr": [9,8,7,6,5]}}}
  → demo.nested          {"level1":{"level2":{"arr":[9,8,7,6,5],"deep":"changed"}}}

/demo-settings reset demo.server
  → /my-setting get demo.server:
      local   {"host":"0.0.0.0","port":9443,"tls":true}
      session (unset)
      merged  {"host":"0.0.0.0","port":9443,"tls":true}   ← fell back to local
```

## Files

- `index.ts` — the full extension (~200 lines, no dependencies beyond `my-settings` itself)
