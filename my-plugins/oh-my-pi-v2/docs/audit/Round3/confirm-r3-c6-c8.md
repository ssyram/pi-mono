# Round 3 Independent Confirmation: R3-C6 through R3-C8

Scope: verified against current source only for:

- `my-plugins/oh-my-pi-v2/hooks/keyword-detector.ts`
- `my-plugins/oh-my-pi-v2/hooks/tool-output-truncator.ts`
- `my-plugins/oh-my-pi-v2/hooks/rules-injector.ts`

Round context says hook failures must not crash the host, but local synchronous failures should be observable via logs/UI warning where feasible. It also says known async host API limitations should not be confirmed as local bugs. These candidates concern local hook catch/fallback paths, not async host API limitations.

## R3-C6 — Keyword detector hook failures are swallowed without diagnostics

Verdict: CONFIRMED

Source evidence:

- `hooks/keyword-detector.ts:128-163` registers a `before_agent_start` hook.
- `hooks/keyword-detector.ts:132-157` wraps the full hook body in `try`, including calls to `ctx.getSystemPrompt()`, keyword detection/filtering, and successful prompt mutation.
- `hooks/keyword-detector.ts:156-157` returns `{ systemPrompt: event.systemPrompt + injection }` on successful injection.
- `hooks/keyword-detector.ts:158-159` catches all errors with `catch { return undefined; }`.

Minimal trigger/rationale:

Any synchronous exception thrown inside the hook body, for example from `ctx.getSystemPrompt()` or prompt/detection processing, is caught and converted to `undefined`. The catch block does not bind the error and has no log, UI warning, notification, or other diagnostic call, making the local failure indistinguishable from normal no-injection paths that also return `undefined`.

## R3-C7 — Tool output truncator failures are swallowed without diagnostics

Verdict: CONFIRMED

Source evidence:

- `hooks/tool-output-truncator.ts:18-59` registers a `tool_result` hook.
- `hooks/tool-output-truncator.ts:20-53` wraps total-size calculation and truncation in `try`.
- `hooks/tool-output-truncator.ts:53` returns `{ content: truncated }` on successful truncation.
- `hooks/tool-output-truncator.ts:54-56` catches all errors with `catch { // Hooks must never throw; return undefined; }`.

Minimal trigger/rationale:

Any exception during local content traversal or truncation, for example from unexpected `event.content` shape or text access, is caught and converted to `undefined`. The catch block intentionally prevents host crash, but it also emits no observable diagnostic, so truncation failure is indistinguishable from the valid below-limit path that returns `undefined`.

## R3-C8 — Rules injector discovery/injection failures are silent or indistinguishable from no-match paths

Verdict: CONFIRMED

Source evidence:

- `hooks/rules-injector.ts:77-88` has `matchesGlob()` catch invalid glob errors and return `false` without diagnostics.
- `hooks/rules-injector.ts:120-135` has `parseFrontmatter()` catch parsing failures and return `{ metadata: {}, body: raw }` without diagnostics.
- `hooks/rules-injector.ts:231-267` has `scanRuleDir()` catch unreadable files and skip them, and catch missing/unreadable directories by returning `[]`, without diagnostics.
- `hooks/rules-injector.ts:324-389` registers the `before_agent_start` rules hook.
- `hooks/rules-injector.ts:346` returns `undefined` when no rules are found.
- `hooks/rules-injector.ts:364` returns `undefined` when no applicable rules remain.
- `hooks/rules-injector.ts:381-383` returns a modified `systemPrompt` on successful rule injection.
- `hooks/rules-injector.ts:384-386` catches all hook-level errors with `catch { // Hooks must never throw; return undefined; }`.

Minimal trigger/rationale:

Invalid glob syntax, malformed frontmatter, unreadable rule files/directories, or exceptions in the hook-level scan/filter/format/injection path are all collapsed to fallback values (`false`, `{ metadata: {}, body: raw }`, `[]`, or `undefined`) without logging or UI diagnostics. Because ordinary no-rule and no-applicable-rule paths also return `undefined`, the current source makes these local failures silent or indistinguishable from normal no-match behavior.
