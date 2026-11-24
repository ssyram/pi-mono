# Round 005 Fix Verifier A — Render/Lifecycle

## Review

- Correct: the per-transaction component render cache is implemented and shared by commit preparation and managed paint.
- Correct: duplicate finish during drain does not restart drain, and a successor synchronously recovers the old patch before beginning its asynchronous managed entry.
- Correct: width-redraw, native-commit, and dirty-gate native failures invalidate Pi's baseline even if cleanup output also fails.
- Blocker: the unqualified claim that `disposed` is absorbing is false. `RuntimeCoordinator.capture()` can transition `disposed` back to `idle-native` or `active-native-fallback` (`runtime-coordinator.ts:23-43`).
- Note: focused tests could not execute in this checkout because the root Vitest runtime is absent and direct Node execution cannot resolve the TypeScript sources' `.js` specifiers.
- Note: `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` was absent (`ENOENT`). The requested `progress.md` existed but contained only an empty in-progress template.

## Verdict summary

| Claimed fix | Verdict | Basis |
|---|---|---|
| Per-transaction render observation | **PASS (source)** | One transaction-local cache feeds prepare and paint; committed preview is published from that same observation. |
| Duplicate finish / drain successor / disposed behavior | **FAIL** | Duplicate finish and drain successor pass, but `capture()` revives a disposed coordinator. |
| Native-transition baseline fencing | **PASS (source)** | All three scoped native-failure paths fence before completing fallback; cleanup failure cannot skip invalidation. |

Because one claimed lifecycle invariant has a concrete source counterexample, the combined Round 005 scope is **FAIL**.

## 1. Per-transaction render cache

### Claimed PRE

A component could be rendered independently during commit preparation and managed paint. Stateful or opaque components could therefore produce observation A for the prepared snapshot and observation B for terminal output in one transaction.

### Required POST

For one `ManagedRenderer.render()` transaction, each component is rendered at most once; commit preparation, managed paint, and the snapshot accepted after a successful write use that same observed line array. A later transaction may render again.

### Source proof

- `managed-renderer.ts:72-82` constructs `renderCache` inside `render()` and defines the sole cached callback. Cache lifetime is exactly one transaction.
- `managed-renderer.ts:89-90` passes that same callback to both `prepareCommit(...)` and `renderManagedContent(...)`.
- `managed-render-content.ts:11-28` renders all live/trailing sections exclusively through the supplied callback; it no longer invokes component rendering itself.
- `managed-renderer.ts:141-158` normalizes the cached observation into `snapshotPreview`, then publishes that preview to committed snapshots only through `acceptPrepared(...)`.
- `managed-renderer.ts:122-138` cancels prepared ledger state on terminal-write failure and on outer preparation/paint/diff failure. Acceptance occurs only after terminal output succeeds.
- Width-change and preflight-rejection returns occur before commit preparation, so they cannot publish a partial observation.
- `managed-renderer.ts:168-179` still renders directly in committed-snapshot assertion/initial capture. Those are validation/initialization observations outside the current prepare/paint transaction and do not create an intra-transaction split.

### Failure-branch inspection

- Reconciliation, preparation, content rendering, diff construction, or other outer exceptions: prepared state is canceled; no snapshot preview is accepted.
- Terminal write exception: prepared state is canceled and a write-failure outcome is returned.
- Prepared cancellation itself may throw, but `cancelPrepared` suppresses that cleanup failure. It cannot cause the uncommitted preview to be accepted.
- Successful terminal write: prepared state and the snapshot derived from the same cached render are accepted together.

### Counterexample attempt: empty arrays

Construct a component whose first call returns `[]` and whose second call returns `['unexpected']`, then place it where prepare and paint both observe it. The attempted counterexample does not work: JavaScript arrays, including `[]`, are truthy, so `renderCache.get(component)` at `managed-renderer.ts:77-78` returns the cached empty array and prevents the second call. Source therefore proves one observation even for empty output.

The existing regression at `managed-runtime.test.ts:93-106` uses a divergent component (`prepared-A` then `painted-B`) and asserts only the first observation is painted. It does not directly pin `[]`, but the cache branch covers it.

### Verdict

**PASS (source).** Residual risk: the focused suite was not executable in this checkout, and there is no explicit empty-array regression test. The direct cache semantics are nevertheless conclusive for the claimed behavior.

## 2. Duplicate finish, drain successor, and disposed behavior

### Claimed PRE

- A duplicate `finishRun()` while handoff was draining could repeat drain/return work or prematurely relinquish the patch.
- A successor could enter managed rendering while the prior draining patch still owned native transition state.
- A disposed coordinator could be resurrected by later lifecycle calls.

### Required POST

- Duplicate finish in `draining-handoff` is a state/ownership no-op.
- A successor arriving during drain synchronously returns the old patch to native before beginning successor entry.
- `disposed` is absorbing: no public lifecycle transition exits it.

### Source proof: passing portions

- `runtime-coordinator.ts:126-129` returns immediately for `draining-handoff`; `beginDrain()` is not called twice. The call still cancels an already coordinated snapshot and journals another `agent-end`, so idempotence is specifically state/renderer ownership idempotence rather than literal absence of all side effects.
- `runtime-coordinator.ts:130-139` sets `draining-handoff` before calling `beginDrain()`. A thrown drain request synchronously recovers and ends in `idle-native`.
- `runtime-coordinator.ts:46-65` handles every non-idle successor before patch installation. It cancels the old entry and invokes `returnRuntimePatch(...)` synchronously. Only after that returns does execution reach patch installation and the first asynchronous wait (`runtime-coordinator.ts:67-110`).
- `return-runtime-patch.ts:4-10` calls active-patch `recoverSynchronously(...)`; that restores native methods and performs native recovery before returning.
- If predecessor recovery throws, `startRun()` enters fallback and returns instead of installing the successor patch (`runtime-coordinator.ts:54-61`).
- `runtime-coordinator.test.ts:39-51` pins duplicate finish during drain.
- `runtime-coordinator.test.ts:53-65` pins successor start during drain and observes exactly one native render before the successor becomes `active-managed`.
- `runtime-coordinator.ts:46-47` and `runtime-coordinator.ts:126-129` make later `startRun()` and `finishRun()` no-ops after disposal; `runtime-coordinator.test.ts:67-77` covers those two methods.

### Counterexample: `capture()` revives `disposed`

1. Call `capture(ctx)` and `startRun()`.
2. Call `shutdown()`. Its `finally` sets `phase = 'disposed'` (`runtime-coordinator.ts:147-159`).
3. Call `capture(ctx)` again.
4. `capture()` has no disposed guard and assigns `idle-native` or `active-native-fallback` (`runtime-coordinator.ts:23-43`). A subsequent `startRun()` may enter managed mode.

This is not merely an unreachable private call. `codex-viewport.ts:45-49` wires public session lifecycle to the same coordinator: `session_start` calls `capture(ctx)`, while session shutdown calls `shutdown()`. Pi's session event types include reload/new/resume/fork transitions, and reload emits a later `session_start` through an existing extension runner. The caller contains no guard preventing capture after shutdown.

Thus the tests prove only the narrower invariant named by `runtime-coordinator.test.ts:67-77`: disposed is absorbing for later **finish and start calls**. They do not prove the fix-record's unqualified state-machine claim.

### Counterexample attempt: successor start during drain

The attempted ordering counterexample does not succeed. `startRun()` contains no `await` before `returnRuntimePatch(...)`; therefore successor installation/entry cannot overtake old-patch synchronous recovery. If that recovery fails, the successor is not started.

### Verdict

**FAIL.** Duplicate finish and successor ordering are correct, but `disposed` is not absorbing across all public lifecycle transitions. Either guard `capture()` while disposed or narrow/document the invariant as applying only to run-level calls and explicitly define session recapture as a legal reinitialization transition.

Residual risk: duplicate finish still produces duplicate journal/cancellation side effects. They appear harmless, but the implementation is not mathematically idempotent outside renderer state and ownership.

## 3. Baseline fencing after native transition failures

### Claimed PRE

A native width redraw, native commit, or dirty-gate catch-up could emit unknown partial bytes and then fail while Pi retained its old `previous*` baseline. Continuing native ownership could cause a later differential render to trust stale state and blindly retry against an unknown screen.

### Required POST

On each scoped native failure:

1. Attempt synchronized-update/reset/cursor cleanup.
2. Invalidate Pi's native baseline even if cleanup output throws.
3. Restore/continue native ownership only with the invalid baseline, forcing future rendering to rebuild rather than trust partial bytes.
4. Do not immediately retry the failed partial transition.

### Shared fence proof

- `fence-native-transition-failure.ts:4-12` catches cleanup-write failure, then unconditionally calls `invalidateNativeBaseline(...)`.
- `invalidate-native-baseline.ts:3-9` clears `previousLines`, sets `previousWidth` and `previousHeight` to `-1`, resets viewport top, and clears prior Kitty image IDs.
- The fence returns cleanup failure rather than throwing it. Scoped callers ignore that returned value, so cleanup failure cannot prevent baseline invalidation or replace the native transition error.

### Width-redraw failure

- `runtime-patch.ts:160-168` catches the native redraw error, disables the patch, fences the baseline, restores patched methods, and reports the original error to `onWidthRedrawFailed`.
- Because `enabled` is already false, the outer render catch at `runtime-patch.ts:129-146` does not invoke synchronous recovery and cannot retry the failed redraw.
- The concrete callback `RuntimeCoordinator.handleWidthRedrawFailure` clears patch ownership, enters `active-native-fallback`, and uses `notifyRuntimeFailure`, whose notification exception is suppressed (`runtime-coordinator.ts:189-192`; `runtime-failure.ts:7-11`).
- `resize-epoch.test.ts:134-146` pins one native/full redraw only, cleanup bytes, baseline width `-1`, restored method ownership, and failure notification.

### Native-commit failure

- `native-commit.ts:10-24` converts an exception from native rendering/commit completion into `{ kind: 'failed', error }`.
- `runtime-patch.ts:184-192` disables the patch, fences, restores methods, calls the concrete returned callback, and throws the original commit error.
- Disabling before the throw prevents the outer catch from retrying through recovery.
- `RuntimeCoordinator.handleReturned` is generation/identity guarded and performs only state cleanup/notification (`runtime-coordinator.ts:206-213`); it does not throw under the concrete caller.
- `managed-runtime.test.ts:123-135` pins fallback, restored native method, and both baseline dimensions at `-1`.

### Dirty-gate catch-up failure

- `RuntimeCoordinator.failRecapture` calls `returnWidthGateSafely(...)`, drops the patch, and enters native fallback (`runtime-coordinator.ts:182-187`).
- `return-runtime-patch.ts:4-10` routes width/native-commit gates to `returnToNativeFromGate()`.
- `runtime-patch.ts:83-93` performs a pending native catch-up once. If it throws, it invokes the fence and rethrows the original native error.
- `runtime-failure.ts:13-20` catches that error for coordinator state transition and notification. There is no blind retry.
- `resize-epoch.test.ts:82-102` pins fallback, restored method ownership, baseline width `-1`, notification, and subsequent clean run finish.

### Counterexample attempt: native error plus cleanup error

For each scoped branch, assume native rendering throws `E_native` and the cleanup write inside `fenceNativeTransitionFailure` throws `E_cleanup`:

- The fence catches `E_cleanup` and still invalidates every baseline field.
- Dirty-gate return rethrows `E_native`.
- Width redraw reports `E_native` to the concrete coordinator callback.
- Native commit throws `E_native` after the concrete nonthrowing return callback.

Therefore simultaneous native and cleanup errors do not defeat the scoped fencing invariant.

A related residual exists outside the three fence callers: `recover-native-renderer.ts:4-15` attempts cleanup first, stores that cleanup error, invalidates, then attempts native redraw using `recoveryError ??= error`. If both cleanup and native redraw fail, the cleanup error wins and masks the later native error. Baseline safety is preserved, but diagnostics lose the native failure. This does not falsify the claimed no-blind-retry/baseline property.

### Verdict

**PASS (source).** Residual risks:

- No focused test directly combines a native error with a cleanup-write error; the result is proven from straight-line fence control flow.
- `beginRuntimePatch` accepts callbacks that could throw. An arbitrary throwing `onReturned` could mask a native-commit error, and a throwing `onWidthRedrawFailed` could replace a width-redraw error. The actual coordinator callbacks are nonthrowing, so this is a contract-hardening risk rather than a current production counterexample.
- Recovery outside these scoped branches preserves cleanup error over a simultaneous native redraw error.

## Focused test commands

### Attempt 1

```text
node node_modules/vitest/dist/cli.js --run my-plugins/codex-viewport/managed-runtime.test.ts my-plugins/codex-viewport/runtime-coordinator.test.ts my-plugins/codex-viewport/resize-epoch.test.ts
```

Result: **not run**; exit 1. `node_modules/vitest/dist/cli.js` does not exist in this checkout.

### Attempt 2

```text
node --test my-plugins/codex-viewport/managed-runtime.test.ts my-plugins/codex-viewport/runtime-coordinator.test.ts my-plugins/codex-viewport/resize-epoch.test.ts
```

Result: **not run**; exit 1. Node cannot resolve imports such as `./runtime-coordinator.js` to the unbuilt TypeScript source.

No test-pass claim is accepted. The PASS findings above rest on direct source proof; executable regression confirmation remains blocked until the repository dependencies/TypeScript test loader are hydrated.
