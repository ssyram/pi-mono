# Contract Expectations — viewport-1-runtime-isolation

## Status

The original custom active renderer contract was invalidated by observed physical duplication and repeated process exits during user input. The safety-first contract below supersedes it.

## Runtime contract

- `session_start`: capture only.
- `agent_start`: validate and install a run-scoped `doRender` pre-hook or fall back.
- active render: reconcile component ownership, then call the original renderer exactly once.
- `agent_end`: restore tree and native method identity before the core final render.
- `session_shutdown`: idempotent dispose without render or session write.

## Terminal ownership

- Pi owns all terminal writes, render scheduling, force semantics, viewport baselines, geometry, terminal lifecycle, and hardware cursor positioning.
- The plugin must not call `terminal.write` or read/write Pi renderer baseline fields.
- The plugin must not patch `requestRender`, `start`, or `stop`.
- Native full redraw is allowed when selected by Pi; stability and IME correctness take priority.

## Transcript contract

- Live hidden rows do not enter the component frame before commit.
- Completion frontier follows assistant source order.
- Every detached component is restored at most once with object identity preserved.
- Plugin failure restores the native tree before native rendering.

## Isolation contract

- No event replacement, message mutation, provider/tool/session call, abort, timer, watcher, or child process.
- Hard death leaves no plugin state for the next process.
- Idle method identity and component ownership are native.

## Verification gates

- Generated completion permutations pass.
- Live suffix capacity properties pass.
- Active ownership test proves only `doRender` is wrapped.
- Tests prove force render and terminal lifecycle remain native.
- Source scan finds no `terminal.write` or renderer baseline access.
- Real TUI input/output testing checks physical duplication, rapid typing, CJK commit, abort, resize, shutdown, and exit status.

The previous `2J/3J=0` gate is retained as an observation, not as a higher-priority requirement than process stability or input correctness.
