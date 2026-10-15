# my-settings

A shared settings service on Pi's public `pi.events` bus. Protocol v1 semantics are specified by `arch/prototype.md` (user-approved); this README describes the implemented surface.

## Load

```sh
pi --extension ./my-plugins/my-settings/index.ts
```

For persistent installation, add this local package using Pi's package configuration. Merely importing the client does not install or start the service. The host supplies `@earendil-works/pi-coding-agent`; no runtime dependencies are installed by this package.

## Files and values

Default files (shared with Pi's own settings storage; saves preserve every unrelated key):

- Global: `getAgentDir()/settings.json`, normally `~/.pi/agent/settings.json`.
- Project: `<ctx.cwd>/.pi/settings.json`.

`globalPath` and `localPath` are optional relative file paths under those respective roots. `null` or omission selects `settings.json`, not an absent layer. Nested relative paths are supported. Absolute paths, empty paths, NUL bytes, and paths escaping the root with `..` are rejected. Paths follow normal filesystem symlink semantics; this is not a filesystem sandbox.

Settings are a flat JSON object. Values may be JSON strings, finite numbers, booleans, null, dense arrays, or plain objects with data properties. Getters, setters, serialization hooks, cycles, and non-JSON values are rejected without executing value methods. Patches merge by top-level key; an object/array value replaces the previous value, without recursive merging.

The session keyspace is shared, even when consumers choose different files. Consumers must use distinct prefixed keys such as `impression.enabled` and `task.noTaskNoTool`.

## Client

```ts
import { createMySettingsClient } from "./my-plugins/my-settings/client.ts";

const settings = createMySettingsClient(pi.events, {
  session: ctx.sessionManager,
  sessionId: ctx.sessionManager.getSessionId(),
});

const result = await settings.query({
  globalPath: "plugins/example.json",
  localPath: "plugins/example.json",
  defaults: { "example.enabled": true, "example.limit": 10 },
});

if (!result.ok) {
  // Surface result.error through the consumer's existing error boundary.
  return;
}
const values = result.values; // typed like the defaults
```

### Queries

```ts
settings.query({ globalPath, localPath, defaults, scope: "global" | "project" | "session" });
```

`scope` defaults to `session`:

| scope | Precedence, low to high |
| --- | --- |
| global | defaults, global file (local file not consulted) |
| project | defaults, global file, local file |
| session | defaults, global file, local file, session log |

Each key's expected type is the kind of its default (null/boolean/number/string/array/object). Per source and per key: a type mismatch is diagnosed (`[my-settings] <source>: <key> 期望 …，实际 …`) and that source's value is dropped — lower-priority valid values still win. A source that cannot be read at all (I/O error, invalid JSON) is diagnosed and skipped; the other layers still merge. Structurally corrupt session-log entries are skipped the same way. A missing file counts as an empty source. Invalid request arguments and dead sessions still return errors.

### Saves

```ts
settings.saveGlobalOnly({ globalPath, values });
settings.saveLocalOnly({ localPath, values });
settings.saveGlobalAndSession({ globalPath, values });
settings.saveLocalAndSession({ localPath, values });
settings.saveSession({ values });
```

- `saveGlobalOnly` / `saveLocalOnly` patch only their file; no session log is written.
- `saveSession` appends only a session-log entry (`my-settings-v1`, data `{ values }`).
- `AndSession` variants are `catchAndPrint(file step) + saveSession`: a file-step failure is diagnosed and the session log is still written, so the overall result is the session-log result. When such a result is an error, the file may already have been committed; check diagnostics. No rollback.
- Session-log entries make a patch win over the other file layer for the current session only; other sessions are unaffected.
- File saves are read-modify-write of the **raw original object** (never the filtered query result) under Pi's file mutation queue with an atomic rename. A corrupt original file is never overwritten.
- Saves validate JSON data legality only; per-key type expectations belong to queries.

Failure is `{ ok: false, error: { code, message } }`. Codes: `SERVICE_UNAVAILABLE`, `SESSION_UNAVAILABLE`, `INVALID_REQUEST`, `OPERATION_FAILED`. A missing/unbound service returns `SERVICE_UNAVAILABLE` with an instruction to install and enable `my-settings`, not defaults. All production functions return results instead of throwing; diagnostics go to Pi via `console.error` and never throw themselves.

## Public protocol

Channel `my-settings:service:v1`; requests carry `{ session, sessionId, operation, accept }`. The owning service calls `accept` synchronously with a promise; if nobody claims the request during `emit`, the client returns the install error without leaving pending promises. The first synchronous response wins; late or duplicate accepted promises are observed and their failures diagnosed. Operations: `query` and the five save ops above.

Service selection requires both session-manager identity and captured session ID; old clients cannot write into a replacement session, even when Pi reuses the manager.

## Startup

Ready channel `my-settings:ready:v1` carries `{ session, sessionId }` on `session_start` and `session_tree`; consumers query their keys when it fires and re-query on branch switches. Readiness is a lifecycle notice, not a completion barrier or a change-subscription mechanism.

## Manual e2e command

`/my-setting` is the only public-facing surface besides the service channel; no model tool is registered. `set` goes through the real mounted service (bus emit → handler → executor).

```text
/my-setting set [--global] [--local] [--session] [--global-file P] [--local-file P] KEY VAL
/my-setting get [--global-file P] [--local-file P] KEY...
/my-setting unset [--global] [--local] [--session] [--global-file P] [--local-file P] KEY...
```

- `VAL` is parsed strictly as JSON: `true` is boolean, `"true"` (quoted input) is string; a bare word is an error.
- `KEY` is a single whitespace-free token, or a quoted JSON string (`"my key"`) to contain whitespace, quotes (escaped `\"`), or a leading `--`. Keys are stored literally with no charset validation.
- Scope flags are ONLY saves; combined flags run global → local → session in order. AndSession combos are not exposed here.
- `--global-file`/`--local-file` set `globalPath`/`localPath` for the operation.
- `get` prints per-layer raw values (global/local/session) plus the service-merged value; the declared kind for merging is inferred from the lowest layer that has the key (global → local → session), so kind mismatches in higher layers show up as drops with diagnostics.
- `unset` removes keys: real deletion in global/local files (missing file is a no-op; corrupt originals are never overwritten); `--session` appends a `{removed:[keys]}` tombstone that cancels this session's overlay — lower layers show through again. Re-setting afterwards wins again; fold order is the log order. The service validates only that `keys` is an array of strings: empty arrays are no-op successes and empty-string keys are literal keys (the service is a JSON carrier; it does not police key names).

## Checks

```sh
node --import ./my-plugins/my-settings/test/sdk-import.mjs --test my-plugins/my-settings/test/settings-*.test.ts my-plugins/my-settings/test/setting-command*.test.ts
node node_modules/typescript/bin/tsc -p my-plugins/my-settings/tsconfig.json
node node_modules/@biomejs/biome/bin/biome lint --config-path my-plugins/my-settings/biome.json my-plugins/my-settings
```

## E2E test

`e2e/` contains a working demo consumer and mock LLM setup instructions:

- `e2e/index.ts` — demo-settings-consumer extension (load alongside `my-settings` to verify end-to-end)
- `e2e/mock-server.md` — how to run pi with a mock LLM and both extensions
- `e2e/README.md` — consumer patterns and e2e interaction transcript

Quick start:

```sh
# Start mock (see e2e/mock-server.md for full setup)
pi --extension ./my-plugins/my-settings/index.ts --extension ./my-plugins/my-settings/e2e/index.ts --model mock/round-counter
```

Verified in a real pi session (mock LLM via [mock-with-pi](../../../workspace/ai-tools/mock-with-pi/), both `my-settings` and `demo-settings-consumer` loaded):

- Ready event → consumer loads 9 keys including nested objects, arrays, matrix
- Sub-JSON values (objects, arrays, deeply nested, `number[][]`) stored/retrieved as whole values via `saveLocalAndSession`
- `/my-setting get` shows local + session layers with correct values; merged = session
- `/demo-settings reset KEY` → session tombstone (`(unset)` in get), merged falls back to local file
- `.pi/settings.json` on disk contains all saved keys with valid JSON

See `my-plugins/demo-settings-consumer/` for the consumer-side reference implementation.

`_cca_analysis/` holds the post-rewrite per-function verification (RUN 2026-10-15): 39/39 functions, zero explicit throw/reject, prototype semantics verified. `_cca_analysis-pre-repair/` preserves the earlier pre-repair report; it does not describe the current code.
