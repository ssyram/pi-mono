# Round 005 Counter-Challenge: F13/F14

## Review

- Correct: the specified repository-root `plan.md` is absent. The available Round 005 plan is `my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/plan.md`; repository-root `progress.md` contains only an empty in-progress template. This verdict therefore uses the Round 005 plan, current source, current tests, and official Pi lifecycle source.
- Correct: F13 survives only as a same-run managed-availability defect. It does not establish extension-lifetime or even next-run permanence.
- Correct: F14 contains two separable claims: recovery-error suppression inside a direct repeated `capture()`, and reachability of that call pattern from official repeated `session_start` lifecycle.
- Note: no files were edited and no tests were run. The deterministic tests below are pinning specifications derived from the current executable fixtures.

## Verdict matrix

| Finding scope | Verdict | Evidence |
|---|---|---|
| F13: a temporary image, visible overlay, tool-expansion change, or insufficient inline height can force the current run from managed rendering to `active-native-fallback` | **CONFIRMED** | `ManagedRenderer.preflight()` and render construction produce `native-fallback` for tool-expansion changes, visible overlays, and fit failure (`managed-renderer.ts:72-109`); image, overlay, and tool-expansion transitions are already asserted in `managed-runtime.test.ts:129-174`. `runtime-patch.ts:193-197` performs synchronous recovery for `native-fallback`, and `RuntimeCoordinator.handleReturned()` installs `active-native-fallback` (`runtime-coordinator.ts:205-213`). |
| F13: clearing the temporary state restores managed rendering later in the same run | **REJECTED** | `RuntimePhase` has a terminal-for-the-run `active-native-fallback` state (`runtime-phase.ts:1-9`). `startRun()` accepts only `idle-native` (`runtime-coordinator.ts:49-55`), and no transition takes `active-native-fallback` to an entry or recapture gate. Width and native-commit recapture are separate guarded paths (`runtime-coordinator.ts:155-181`), not generic fallback recovery. |
| F13: the fallback is permanent for the extension lifetime or later runs | **REJECTED** | `finishRun()` changes fallback to `idle-native` (`runtime-coordinator.ts:113-131`). A later `agent_start` may therefore call `startRun()` and establish a fresh managed epoch. The one coordinator exists for one extension factory invocation (`codex-viewport.ts:28-49`), but its fallback phase is not lifetime-permanent. |
| F14: if `capture()` is directly invoked again while an old managed patch is active, failure of old native recovery is suppressed | **CONFIRMED** | `capture()` first clears coordinator ownership through `cancelCurrentEntry()`, calls old-patch recovery, and catches every thrown error with an empty `catch` (`runtime-coordinator.ts:22-30`, `runtime-coordinator.ts:196-203`). Recovery can retain and throw terminal-reset or native-render failure (`runtime-patch.ts:69-79`; `recover-native-renderer.ts:4-18`). |
| F14: that direct repeated `capture()` can admit a new managed epoch despite unproven physical recovery | **CONFIRMED as a function-level counterexample** | After suppressing the failure, `capture()` binds the new context and sets `idle-native` when it is idle (`runtime-coordinator.ts:31-46`). A later `startRun()` can create a new patch and reach `active-managed` (`runtime-coordinator.ts:49-92`). There is no retained recovery-failure bit. This is stronger than “partial” for the direct-call state trace. |
| F14: official repeated `session_start` drives the same coordinator through that second `capture()` | **REJECTED** | Pi defines repeated reasons `startup`, `reload`, `new`, `resume`, and `fork` (`packages/coding-agent/src/core/extensions/types.ts:550-556`), but reload constructs a new `ExtensionRunner` before emitting `session_start("reload")` (`packages/coding-agent/src/core/agent-session.ts:2530-2572`, `2584-2605`). New/resume/fork tear down the current runtime and call `createRuntime(...)` for the next start (`packages/coding-agent/src/core/agent-session-runtime.ts:195-348`). Extension loading invokes the factory against a newly created extension/API, so `const runtime = new RuntimeCoordinator()` is recreated. Official tests confirm shutdown-before-start replacement and stale old contexts (`packages/coding-agent/test/agent-session-runtime-events.test.ts:115-249`). |
| F14 as an externally reachable production defect caused by official repeated `session_start` | **DISPUTED / NOT ESTABLISHED** | The unsafe direct-call trace is real, but the required official reachability edge—two `session_start` callbacks delivered to one factory-local coordinator—is absent from the traced lifecycle. F14 should not be promoted as a confirmed production lifecycle defect without another official emitter or re-entrant callback path. |

## Official lifecycle trace

### Startup

1. The extension factory runs and creates coordinator `C0` (`codex-viewport.ts:28-32`).
2. `session_start("startup")` invokes `C0.capture(ctx0)` (`codex-viewport.ts:45-47`).
3. With an idle UI, `C0.phase = idle-native`, `C0.patch = undefined` (`runtime-coordinator.ts:31-46`).
4. `agent_start` creates `P0`, passes through `entering-managed`, and may reach `active-managed` (`runtime-coordinator.ts:49-92`).

### Reload

1. Pi emits `session_shutdown("reload")` to the old runner.
2. `C0.shutdown()` cancels `P0`, attempts recovery, clears captured context, and ends `disposed` (`runtime-coordinator.ts:134-153`).
3. Pi reloads resources and calls `_buildRuntime()`, which assigns a new `ExtensionRunner`.
4. The extension factory runs again and creates `C1`.
5. `session_start("reload")` invokes `C1.capture(ctx1)`, not `C0.capture(ctx1)` (`packages/coding-agent/src/core/agent-session.ts:2584-2605`).

### New, resume, fork, and JSONL import

1. Pi emits the corresponding before-event, then tears down the current runtime.
2. Pi calls `createRuntime(...)` with a new `session_start` event and applies the replacement runtime (`packages/coding-agent/src/core/agent-session-runtime.ts:195-392`).
3. The replacement extension factory creates a new coordinator. The old captured context is invalidated; official tests assert the shutdown/start order and stale-context rejection (`packages/coding-agent/test/agent-session-runtime-events.test.ts:115-249`).

Therefore, `session_start` is officially repeatable process-wide, but the inspected official paths provide one start capture per factory-local coordinator.

## Direct repeated-capture counterexample

This trace is deterministic but is not shown reachable from the official lifecycle above:

1. State is `C0.phase = active-managed`, `C0.patch = P0`.
2. A direct second `C0.capture(ctx1)` calls `cancelCurrentEntry()`: generation increments, pending entry aborts, and `C0.patch` becomes `undefined` (`runtime-coordinator.ts:196-203`).
3. `P0.recoverSynchronously("session context replaced")` restores method ownership, attempts terminal sanitation/native redraw, and throws the retained recovery error (`runtime-patch.ts:69-79`).
4. `onReturned` cannot mutate the coordinator because generation/patch identity no longer matches (`runtime-coordinator.ts:205-207`).
5. `capture()` suppresses the thrown recovery error (`runtime-coordinator.ts:25-30`).
6. For idle `ctx1`, capture sets `C0.phase = idle-native` with no patch (`runtime-coordinator.ts:31-46`). Physical terminal recovery remains unproven.
7. A later `C0.startRun()` installs `P1` and may set `active-managed` (`runtime-coordinator.ts:49-92`).

Generation and identity checks prevent stale asynchronous activation, but they do not preserve the old recovery failure or prohibit `P1`. Thus the unsafe epoch admission is **confirmed for direct repeated capture**, while its official-event reachability is **disputed/not established**.

## Deterministic tests

### T-F13-1: temporary fallback remains native only for the rest of the current run

Parameterize four fresh fixtures: image-bearing content, visible overlay, changed tool-expansion state, and insufficient editor/footer height.

1. Capture an idle UI and await `startRun()`; assert `active-managed` and own patched `doRender`.
2. Activate one trigger and render; assert `active-native-fallback`, no own `doRender`, and one native recovery render.
3. Remove the image/overlay, restore the original tools-expanded value, or restore sufficient height.
4. Request/render again and settle queued turns; assert the phase is still `active-native-fallback` and no patch was reinstalled.
5. Call `finishRun()`; assert `idle-native`.
6. Start a later run with the cleared state; assert it can reach `active-managed` again.

This pins the exact confirmed scope and rejects extension-lifetime permanence.

### T-F14-1: direct repeated capture exposes current suppression and epoch admission

1. Create old and new TUI contexts; capture the old idle context and await managed activation.
2. Configure the old native renderer to throw deterministically (`failNativeRender = true`).
3. Call `runtime.capture(newIdleCtx)` directly.
4. Assert the call does not throw or notify about the old recovery failure, the old TUI has no owned patch, and coordinator phase is `idle-native` for the new context.
5. Await `runtime.startRun()` and assert the new TUI reaches `active-managed` with a new owned patch.

This is a current-behavior proof, not proof of official lifecycle reachability.

### T-F14-2: official starts use distinct extension instances

Instrument an inline extension factory with a monotonically assigned factory/coordinator ID and log each `session_start` reason and `session_shutdown`.

1. Exercise startup, reload, new, resume, and fork through `AgentSessionRuntime`/reload APIs.
2. Assert each replacement orders old `session_shutdown` before the next `session_start`.
3. Assert each `session_start` is associated with a newly invoked factory/coordinator ID.
4. Assert no coordinator ID receives two `session_start` events.

This is the decisive reachability test. If it passes against the official runtime, F14 cannot be promoted on repeated-`session_start` evidence alone.

### T-F14-3: desired safety pin if nonofficial repeated capture must be supported

If `RuntimeCoordinator.capture()` is intended as a generally repeatable API, inject old native-recovery failure and require all of the following: the failure is reported or propagated, the coordinator enters a non-reenterable recovery/fallback state, no new patch can activate, and the original recovery error remains the primary error. This test should fail against the current implementation and is only required if direct repeated capture is declared supported/reachable.

## Final scope

- **F13 CONFIRMED:** temporary states can remove managed availability for the remainder of the current run.
- **F13 REJECTED:** the loss is permanent across later runs, sessions, or the extension lifetime.
- **F14 CONFIRMED:** direct repeated `capture()` suppresses old recovery failure and can admit a fresh patch over an unproven physical terminal state.
- **F14 REJECTED:** official repeated `session_start` has been shown to call `capture()` twice on one coordinator.
- **F14 DISPUTED / NOT ESTABLISHED:** production reachability of the unsafe new-epoch trace through official lifecycle events.
