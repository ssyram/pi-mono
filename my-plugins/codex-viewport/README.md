# codex-viewport

Safety-first Codex-style live transcript clipping for Pi.

## Behavior

While an agent is running, unfinished tool components and non-text assistant dynamics are grouped into a `LiveRegion`. The region returns only the suffix that fits above Pi's trailing status, editor, and footer. Ordinary text assistant streaming stays on Pi's native path. Completed contained components move back into the transcript only through the source-order contiguous completion frontier.

Pi's native renderer remains the sole owner of terminal writes, force renders, viewport baselines, terminal lifecycle, and hardware cursor positioning. The plugin never writes ANSI output or changes Pi renderer state.

When the agent is idle, the component tree and `doRender` method are restored to their native state.

## Guarantees

- Does not modify AI messages, provider requests, tool arguments/results, abort signals, or session persistence.
- Does not call `terminal.write` or modify cursor/viewport baselines.
- Does not patch `requestRender`, `start`, or `stop`.
- Restores each detached component exactly once.
- Commits parallel tool components in assistant source order.
- Restores native component and method ownership on agent end, shutdown, or plugin failure.
- Recognizes Pi containers structurally, so workspace-loaded extensions work with a separately installed global Pi package.
- Shows a runtime warning instead of silently disabling itself when the TUI layout or renderer owner is unsupported.

## Safety trade-off

The plugin no longer overrides Pi's native redraw decisions. Live clipping removes the normal cause of offscreen transient updates, but Pi may still perform a native full redraw for resize, shrink, overlay, expansion, or another renderer condition. Stability, input correctness, and IME cursor ownership take priority over an absolute zero-redraw guarantee.

## Loading

```bash
pi --no-extensions -e ./my-plugins/codex-viewport/index.ts
```

Do not load it with another extension that owns the TUI instance `doRender` method.

## Verification

```bash
node --test --import tsx my-plugins/codex-viewport/*.test.ts
npx tsc -p my-plugins/codex-viewport/tsconfig.json
```

Design documents are under `docs/design/`; audit records are under `docs/audit/`.
