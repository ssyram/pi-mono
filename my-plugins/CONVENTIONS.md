# Plugin Development Conventions

## renderResult: treat `result.details` as `unknown`

### The Problem

The pi plugin system allows any plugin to replace a tool result's `details` via the `afterToolCall` hook. For example, the **impression** plugin replaces `details` with `{ thinking: "..." }` after distilling tool output. This means your `renderResult` may receive a completely different shape than what your `execute` function returned.

TypeScript's `as MyDetails` cast gives zero runtime protection here — the type system says it's `MyDetails`, but at runtime it's `{ thinking: "..." }`.

### Crash Paths

1. **Switch without default**: `switch (details.action)` where `action` is undefined → no case matches → function returns `undefined` → `Box.addChild(undefined)` crashes the TUI.
2. **Property access on wrong shape**: `details.jobId.slice(0, 8)` → `undefined.slice()` → `TypeError`.
3. **Array method on non-array**: `details.tasks.length` where `tasks` is undefined → `TypeError`.

### Required Pattern

Every `renderResult` must:

1. **Runtime shape guard** — validate the actual structure of `result.details` before using it:

```typescript
renderResult(result, options, theme, _context) {
    const raw = result.details;
    // Validate shape — details may be replaced by another plugin
    const details =
        typeof raw === "object" && raw !== null &&
        typeof (raw as Record<string, unknown>).action === "string" &&
        Array.isArray((raw as Record<string, unknown>).tasks)
            ? (raw as MyDetails)
            : undefined;

    if (!details) {
        // Fallback: render from content text
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
    }

    // Now safe to use details.action, details.tasks, etc.
}
```

2. **Always return a Component** — every code path must return a valid TUI component. No implicit `undefined` exits. Add `default` to all `switch` statements.

3. **Never use bare `as` casts** on `result.details` — `as MyDetails | undefined` is not a guard, it's a lie. The value may be any shape at runtime.

### Forbidden Patterns

```typescript
// BAD: bare type assertion
const details = result.details as MyDetails | undefined;

// BAD: "in" operator as pseudo-guard (fragile, breaks on overlapping keys)
if (details && "jobId" in details) { details.jobId.slice(0, 8); }

// BAD: switch without default
switch (details.action) {
    case "list": { ... }
    case "add": { ... }
    // missing default → undefined return → crash
}
```

### Why This Happens

The `afterToolCall` hook is a legitimate extension point. The impression plugin uses it to distill long tool outputs into compact summaries. Other plugins could do similar things. Your renderer cannot assume it is the only plugin in the chain.

### Reference

- Issue analysis: `.tmp/box-wrong-pattern.md`
- Already-fixed files: `task-tracker.ts`, `oh-my-pi/tools/task-renderers.ts`, `oh-my-pi/tools/call-agent.ts`, `oh-my-pi/tools/delegate-task.ts`
- Already-correct files (had shape guards from the start): `oh-my-pi/tools/background-task.ts`, `oh-my-pi/tools/background-output.ts`

---

# pi Extension Gotchas — Implicit Contracts the Type System Doesn't Enforce

The pi extension API looks deceptively simple (`pi.on(event, handler)`, `setInterval(...)`, etc.), but there are a lot of unwritten rules. Breaking them fails silently or only surfaces in specific modes (`pi -p`, subagent spawns, multi-extension loads). The type system catches **none** of them.

This section documents every trap we've hit. Read once before writing a new extension; re-read when debugging weird behavior.

## G1. `pi -p` / `pi --mode json -p` hangs on any leaked handle (CRITICAL)

**Symptom**: child `pi` process completes its work, prints final output, but **never exits**. Parent (e.g. `pi-subagents`) waits forever on `child.on("close")`.

**Root cause**: `packages/coding-agent/src/modes/print-mode.ts` and `main.ts` do **not** call `process.exit()` after business logic completes. They only `return`, handing control back to Node's event loop. Any alive handle keeps the process up forever.

**Reported multiple times, officially "closed" without fix**: upstream issues #161, #2195, #2576, #2584, #2677, #3011, #3015. Upstream stance: "extensions should clean up in `session_shutdown`".

**Rules**:

1. **Every `setInterval` must be `.unref()`'d AND cleared in `session_shutdown`**. Not one or the other — both.
2. **Every long-lived `setTimeout` must be `.unref()`'d**. Short per-request watchdogs with guaranteed `clearTimeout` in both success/error paths are OK, but `.unref()` is still recommended as belt-and-suspenders.
3. **Every spawned child process** must be killed in `session_shutdown` (see `playwright-mcp.ts` for the reference pattern).
4. **Every `fs.watch` / chokidar / `net.Server` / `http.Server`** must be `.close()`'d in `session_shutdown`.
5. **undici/fetch keep-alive**: in extension-level fetch, pass `keepalive: false` or destroy the agent on shutdown.
6. `session_shutdown` is **not guaranteed to fire** (SIGKILL, crash, etc.) — always combine with `.unref()` where possible. Never rely on shutdown handlers alone for correctness.

**Reference fix patterns**:
- `recap/index.ts` — `setInterval` with `.unref()` + `session_shutdown clearInterval`
- `playwright-mcp.ts` — child process kill on `session_shutdown`
- `oh-my-pi/tools/concurrency.ts` — stale timer `.unref()`

## G2. Event listeners run **sequentially with `await`** — deadlock risk

**Trap**: `packages/agent/src/agent.ts:535-536`:

```typescript
for (const listener of this.listeners) {
    await listener(event, signal);
}
```

Every handler registered with `pi.on(event, handler)` is **awaited in series**. Contrary to Node's `EventEmitter` or DOM `addEventListener`, this is not fire-and-forget.

**Consequences**:
- A slow handler blocks every other extension's handler for the same event
- An `await`-chain inside a handler that waits for a state change only another extension can produce → **deadlock**
- An unhandled throw may abort the remainder of the chain depending on the upstream try/catch

**Rules**:
- Keep handlers fast and synchronous when possible
- If you need to do real work, fire-and-forget: `pi.on("agent_end", (evt, ctx) => { void doWork(evt, ctx); })` — do not return the promise
- Never `await` a state change that another extension is responsible for producing

## G3. Event handlers can **mutate** the event for downstream consumers

Many event types have a second result generic: `ExtensionHandler<E, EResult>`. When non-void, the handler's return value **replaces** the event as seen by subsequent listeners and the core.

Examples:
- `tool_call` → rewrite args
- `tool_result` / `afterToolCall` → rewrite `details` (this is what the original CONVENTIONS rule was about)
- `context` → inject text
- `session_before_*` → block / alter the transition
- `input` / `user_bash` → rewrite user input

**Rules**:
- Order of extension load matters; there is no dependency declaration mechanism (see G4)
- Never assume the event shape in your handler is the "original" — upstream extensions may have modified it
- When modifying events, return `undefined` to pass through unmodified; only return a new object when you actually want to mutate

## G4. Extension load order is implicit and fragile

There is no way to declare "my extension depends on X being loaded first". Order follows settings file order / alphabetical / discovery order depending on path.

**Consequences**:
- If your extension uses MCP tools registered by `mcp-bridge`, it works only if `mcp-bridge` loads first
- Changing `settings.json` ordering can silently break your extension
- Two extensions modifying the same event see each other's output in an undefined order

**Rule**: if you truly need another extension's state, check for it lazily inside handlers, not at setup. Fail gracefully.

## G5. Extension entry runs **before** session is ready

`export default async function myExt(pi: ExtensionAPI)` runs during pi startup — before session init, model resolution, or UI mount. Don't touch `pi.ctx.*` in the top-level body.

**Rule**: always defer real work to `pi.on("session_start", ctx => ...)`, or keep the function body to listener registration only.

## G6. Extensions can be **reloaded** mid-process — module-level state leaks

When the user runs `/reload` or triggers `ctx.reload()`, your extension's `default export` runs again in the **same process**. Module-level `let state = ...` from the previous load is still alive in memory but orphaned — its timers still fire, its references still pin memory.

**Rule**: if you must keep state across reloads, stash it on `globalThis` with a unique key, and **in your entry point, clean up the previous instance's resources first**. See `recap/index.ts:35-39`:

```typescript
const g = globalThis as Record<string, unknown>;
const prev = g[INSTANCE_KEY] as StoredState | undefined;
if (prev?.intervalTimer) clearInterval(prev.intervalTimer);
if (prev?.dismissTimer) clearTimeout(prev.dismissTimer);
```

## G7. Widget keys are **global**; no namespacing

`ctx.ui.setWidget(key, ...)` uses a flat key namespace across all extensions. Two extensions with the same key silently overwrite each other.

**Rule**: prefix keys with your extension name (`WIDGET_KEY = "my-ext:main"` not `"main"`).

## G8. Tool / command name collisions are silent

`pi.registerTool("foo", ...)` / `pi.registerCommand("foo", ...)` across two extensions has undefined behavior — may overwrite, may throw, may coexist orphaned depending on internal map semantics.

**Rule**: prefix tool and command names by extension scope. When in doubt, grep the whole monorepo before picking a name.

## G9. `AbortSignal` semantics vary by event

Handlers for different events receive `signal` parameters with different meanings:
- In `agent_*` events: agent loop abort
- In `session_*` events: session teardown
- In `compact` / `before_*` events: operation cancellation

**Same parameter name, different triggers.** The type `ExtensionHandler<E>` doesn't tell you which.

**Rule**: when handling `signal.aborted`, cross-reference the event name to understand what you should do. Usually: drop in-flight work and return quickly.

## G10. Handler deduplication is your responsibility

`pi.on(event, handler)` does **not** dedupe. Registering the same function twice makes it fire twice per event.

**Rule**: register each handler exactly once, at setup, and not in a path that might re-run.

## G11. Extension-level `complete()` / `completeSimple()` calls are invisible to the user

Calls you make to small models for internal summarization (like `recap` and `impression` do) **consume the user's tokens** but are **not** shown in the session usage panel. Users see inflated cost with no explanation.

**Rule**: log your extension's LLM usage at minimum via `ctx.ui.notify` or a debug log. Consider caching aggressively.

## G12. `session.prompt()` resolving ≠ all handlers done

`await session.prompt(msg)` resolves when the agent loop's final `message_end` is processed, but per G2, the `agent_end` listeners may still be awaiting serially. Extension cleanup code placed **after** `await session.prompt(...)` may observe pre-final state.

**Rule**: if you need to run code after absolutely everything, register an `agent_end` handler, don't rely on `prompt()` resolution.

## G13. Grandchildren processes inheriting stdio pin the parent's `close` event

If a tool spawns a process that itself spawns a detached grandchild without redirecting stdio (common with `nohup ... &` or misconfigured daemons), the grandchild holds the stdio pipes open. The immediate child can exit cleanly, but the parent's `child.on("close")` **never fires** because the pipes are still open.

This is subagent hang failure mode #2 from upstream issue `nicobailon/pi-subagents#95`.

**Rule**: in extension-spawned processes, always `detached: true` + `stdio: ["ignore", "ignore", "ignore"]` for fire-and-forget; use `child.unref()` and don't wait for `close` if you genuinely want fire-and-forget semantics.

## G14. `ctx.*` methods may return stale data

During rapid event sequences (`turn_start` → `message_update` → `turn_end`), `ctx.sessionManager.getBranch()` / `ctx.getSystemPrompt()` may reflect intermediate state. No guarantee of consistency snapshot.

**Rule**: capture what you need at event fire time into local variables, don't re-query `ctx` later inside an async continuation.

## G15. `session_shutdown` is not guaranteed to fire

Ways it silently doesn't fire:
- `SIGKILL` from outside
- Uncaught exception in another extension's sync path
- `process.exit()` called from anywhere
- Segfault in native addon
- OOM

**Rule**: `session_shutdown` cleanup is a **best effort**, not a correctness guarantee. For critical state (data you must not lose), use atomic writes + on-write persistence, not deferred-on-shutdown persistence. For resources, combine with `.unref()` (G1).

---

# Checklist for Every New Extension

Before committing a new extension, verify:

- [ ] All `setInterval` are `.unref()`'d **and** cleared in `session_shutdown` (G1)
- [ ] All long-lived `setTimeout` are `.unref()`'d (G1)
- [ ] All spawned child processes are killed in `session_shutdown` (G1)
- [ ] All file watchers / servers are closed in `session_shutdown` (G1)
- [ ] No top-level work in `export default` — defer to `session_start` (G5)
- [ ] Previous instance cleanup if you use global state (G6)
- [ ] Widget keys prefixed with extension name (G7)
- [ ] Tool / command names prefixed or verified unique (G8)
- [ ] Event handlers are fast / fire-and-forget for heavy work (G2)
- [ ] `renderResult` uses runtime shape guards for `result.details` (original rule above)
- [ ] Never `return`-mutate events you didn't mean to modify (G3)
- [ ] Handlers registered once, not in a loop (G10)
- [ ] Internal `complete()` calls are surfaced / logged (G11)
