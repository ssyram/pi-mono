# viewport-1-runtime-isolation Audit Report

## Status

The round-001/002 approval was invalidated by observed physical duplication and repeated process exits during user input. Those records remain as historical evidence, not as acceptance of the current implementation.

The safety-first revision passes automated and tmux committed-input verification. Real IME composition candidate behavior still requires manual terminal verification.

## Safety-first revision

- Removed the custom active differential/viewport renderer.
- Removed direct terminal writes and Pi renderer baseline access.
- Preserved native `requestRender`, force semantics, `start`, `stop`, and hardware cursor ownership.
- Retained LiveRegion clipping, source-order completion, component identity, and AI/session isolation.
- Kept ordinary text assistant streaming on the native path while containing tools, thinking, and unknown assistant dynamics.
- Added visible runtime fallback reasons for unsupported layouts and foreign renderer owners.

## Automated verification

- `node --test --import tsx my-plugins/codex-viewport/*.test.ts`: 30/30 pass.
- `npx tsc -p my-plugins/codex-viewport/tsconfig.json`: pass.
- `npm run check`: pass, 815 files, no fixes.
- Production source scan: no terminal writes, renderer baseline access, forbidden message/session/tool APIs, timers, watchers, child processes, or dynamic imports.
- Every TypeScript file remains at or below 200 nonblank, non-comment lines.

## Real TUI verification

Global Pi `0.83.0`, isolated extension load, tmux terminal:

- Run 1: 100 streaming row markers; physical scrollback contained exactly 100 rows with no duplicate marker.
- Run 2: 60 streaming row markers; physical scrollback contained exactly 60 rows with no duplicate marker.
- During streaming, committed Chinese text and ASCII input remained editable; rapid input, backspace, and cursor movement did not terminate the process.
- Both normal runs produced `2J=0`, `3J=0`.
- Active resize followed by Escape abort kept the process alive and displayed one `Operation aborted`.
- Resize produced one native `2J/3J` pair, accepted by the safety-first contract.
- Graceful `/quit` exited with status 0.
- Global Pi `0.83.0` managed probe confirmed `ownDoRender=true` and the runtime marker after replacing cross-package `instanceof` with structural container detection.
- Ten parallel 8-second bash tools updated `Elapsed` while active: only `SLOW_08..10` appeared in active physical scrollback at the sampled viewport; hidden `SLOW_01..07` did not enter history.
- After completion, all ten tools appeared once in source order with `Took 8.0s`; no `Elapsed` intermediate rows remained and the run produced `2J=0`, `3J=0`.
- Native text-path verification streamed `TEXT_NATIVE_01..80`; all 80 rows appeared exactly once with `2J=0`, `3J=0`.
- Mixed-path verification ran ten parallel 15-second tools after native text output. At the active sample only `LONG_08..10` and their `Elapsed` rows existed in physical scrollback; after completion all ten appeared once with `Took 15.0s`, no intermediate `Elapsed`, and `2J=0`, `3J=0`.

## Residual verification

Tmux can paste committed CJK text but cannot reproduce a platform IME composition session or candidate window. Chinese Pinyin composition, candidate movement, commit, and cancellation must be tested manually in the user's real terminal before claiming the IME edge fully resolved.

## Review limitation

User prohibited subagents, so independent-review paths remain N/A.
