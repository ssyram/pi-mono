# Round 005 Crash/Resource Proof: Snapshot and Recapture

## Review

- Correct: Normal snapshot ownership, diagnostic rendering, ordered blocked-write replay, one coalesced catch-up request, abort-based recapture invalidation, successful permission modes, and shutdown phase finalization are implemented and covered by focused tests.
- Blocker: Snapshot artifact paths follow pre-existing symbolic links. A project can redirect artifact writes and `chmod` to another file (`snapshot-artifacts.ts:9-12`, `snapshot-artifacts.ts:18-27`, `snapshot-artifacts.ts:57-59`).
- Blocker: `executeSnapshot` acquires the terminal/render lease before entering the guarded release region. Journal startup or initial clock failure permanently leaves the snapshot gate acquired (`execute-snapshot.ts:21-33`).
- Blocker: `queryTerminalCursor` leaks its input subscription when registration invokes the handler synchronously. It also installs a DSR write, abort listener, and timeout after the query has already resolved (`query-terminal-cursor.ts:20-22`, `query-terminal-cursor.ts:42-81`).
- Blocker: `captureTerminalApp` and `resolveControllingTty` have no timeout or abort path. A hung `osascript` or `ps` leaves a snapshot lease frozen indefinitely and permits blocked terminal output to grow without bound (`terminal-app-capture.ts:28-36`, `resolve-controlling-tty.ts:14-17`).
- Blocker: Artifact completion is not durable in the crash-consistency sense promised by the README. There is no temporary-file/rename protocol and no file or directory synchronization; `latest.json` is overwritten in place (`snapshot-artifacts.ts:9-12`, `snapshot-artifacts.ts:57-59`).
- Note: `/Users/ssyram/workspace/ai-tools/pi-mono/plan.md` did not exist. The requested `progress.md` existed but contained no tasks or technical notes. No prior audit report was read.

## Method and verdict vocabulary

The proof obligation used here is:

`{owner is eligible; no snapshot resources held}` operation `{all acquired hooks, timers, subscriptions, child processes, and artifact handles are released on every exit; terminal byte order and runtime ownership are exact}`.

- **PROVEN**: all represented exits preserve the stated postcondition under the function's typed/internal preconditions.
- **PARTIAL**: normal and specified failures are safe, but an external callback, child process, write failure, or missing contract prevents a total proof.
- **DISPROVEN**: a concrete counterexample violates the postcondition.

Verification command:

```text
node --import tsx --test \
  my-plugins/codex-viewport/native-tui-snapshot.test.ts \
  my-plugins/codex-viewport/query-terminal-cursor.test.ts \
  my-plugins/codex-viewport/resolve-controlling-tty.test.ts \
  my-plugins/codex-viewport/runtime-coordinator.test.ts \
  my-plugins/codex-viewport/snapshot-artifacts.test.ts \
  my-plugins/codex-viewport/tui-snapshot.test.ts
```

Result: **21 passed, 0 failed**. The counterexamples below are outside current test coverage.

## Concrete defects and reproductions

### S1 — Acquired lease escapes release during snapshot startup

**DISPROVEN** — `executeSnapshot`, `execute-snapshot.ts:21-33`.

Acquisition occurs at line 21. `journal.begin()`, the initial `journal.record`, and `dependencies.now().toISOString()` occur before the `try/finally` that releases the lease. Any of those throws with the terminal write interceptor and render gate still installed.

Executed reproduction using the real `executeSnapshot` and `SnapshotJournal`: pre-activate the journal, provide a lease whose `release` toggles a flag, then call `executeSnapshot`.

Observed:

```json
{"error":"snapshot journal is already active","released":false}
```

Exact failure post-state:

- `executeSnapshot` rejects.
- `lease.release()` was never called.
- For a managed target, `RuntimeSnapshotOwner.active` remains true and `terminal.write` remains intercepted.
- For a native target, the own blocked `doRender` remains installed and `terminal.write` remains intercepted.
- No blocked writes are replayed, no catch-up render is requested, no journal finish occurs, and no artifacts are attempted.

The same leak is reachable with a throwing `dependencies.now()` after a successful `journal.begin()`.

### S2 — Artifact writer follows symlinks and overwrites/chmods the target

**DISPROVEN** — `secureWrite` and `writeSnapshotArtifacts`, `snapshot-artifacts.ts:9-12`, `snapshot-artifacts.ts:18-27`, `snapshot-artifacts.ts:57-59`.

`writeFile(path, ...)` and `chmod(path, ...)` both follow a pre-existing symlink. The directory walk likewise does not reject symlink components.

Executed reproduction:

1. Create the expected snapshot directory.
2. Create a victim file containing `ORIGINAL` with mode `0644`.
3. Symlink `terminal-output.ansi` to the victim.
4. Call the real `writeSnapshotArtifacts` with terminal output `OWNED`.

Observed:

```json
{"content":"OWNED","mode":384}
```

`384` is octal `0600`. Thus a repository-controlled `.pi/tui-snapshots` tree can redirect both content replacement and permission mutation. The call returns success and can trigger the normal success notification.

Exact failure/security post-state: external target content is replaced, its mode is changed to `0600`, all ordinary artifacts and `latest.json` may also exist, and the caller receives the snapshot directory as if the write were safe.

### S3 — Synchronous input registration leaks the cursor-query subscription

**DISPROVEN** — `queryTerminalCursor`, `query-terminal-cursor.ts:20-22`, `query-terminal-cursor.ts:42-81`.

`unsubscribe` starts as a no-op. If `registerInput` invokes the handler before returning its real unsubscribe callback, the success path calls the no-op cleanup. Control then returns to registration, stores the real unsubscribe callback, installs an abort listener and timeout, and writes DSR even though the promise is settled.

Executed reproduction with a synchronous register callback:

```json
{"result":{"row":0,"column":0},"unsubscribed":0,"writes":1}
```

Exact post-state without a supplied abort signal:

- The promise is resolved.
- The real subscription remains installed indefinitely.
- DSR was sent after resolution.
- The ordinary timeout is installed; when it fires it sees `settled` and returns without cleanup.
- Future input continues through the stale handler. Because `settled` is true, it is returned unchanged, but the subscription and closure remain retained.

### S4 — Unbounded child-process wait freezes snapshot ownership indefinitely

**DISPROVEN** — `captureTerminalApp` and `resolveControllingTty`, `terminal-app-capture.ts:28-36`, `resolve-controlling-tty.ts:14-17`.

Both use `execFile` without `timeout`, `killSignal`, or `AbortSignal`. `MAX_CAPTURE_BYTES` bounds captured child output but does not bound time. `executeSnapshot` calls physical capture only after acquiring the lease.

Deterministic reproduction:

1. Put an executable `osascript` shim first in `PATH` whose body is `sleep 3600`.
2. Call `captureTerminalApp("/dev/ttys001")`, or run a snapshot with that dependency.
3. Attempt terminal writes and renders while the promise is pending.

After any bounded observation interval, the promise remains pending, the child remains alive, renders remain coalesced behind the gate, `terminal.write` remains intercepted, and `blockedOutput` continues growing. A similar `ps` shim reproduces the controlling-TTY path.

There is no internal transition to failure, release, replay, or artifact output.

### S5 — Artifact success is not crash-durable or atomic

**DISPROVEN** — `secureWrite` and `writeSnapshotArtifacts`, `snapshot-artifacts.ts:9-12`, `snapshot-artifacts.ts:57-59`.

The success contract says artifacts are durable before notification. The implementation awaits `writeFile` and `chmod`, but never syncs file data, file metadata, or containing directories. `latest.json` is overwritten directly rather than written to a private temporary file and atomically renamed.

Concrete verification procedure: trace a successful artifact test with the platform filesystem syscall tracer and filter for `fsync`, `fdatasync`, or macOS `F_FULLFSYNC`. None can originate from this implementation. Kill the process or fault the filesystem after `writeFile` resolution but before writeback; after recovery, files or `latest.json` may be empty, stale, or absent despite the function having resolved.

A non-crash failure also leaves non-transactional state: `Promise.all` can create a subset of artifact files before one write rejects. `latest.json` is not written by that invocation, but a previous `latest.json` remains and points to an older snapshot. No cleanup occurs.

### S6 — Drain initiation has no failure transition

**DISPROVEN** — `RuntimeCoordinator.finishRun`, `runtime-coordinator.ts:118-123`.

`phase` changes to `draining-handoff` before `patch.beginDrain()`, with no catch/finally around that call. A throwing renderer `beginDrain()` or render request leaves the coordinator permanently in a transitional phase.

Deterministic unit reproduction: arrange a coordinator in `active-managed` with a current patch whose `beginDrain()` throws, call `finishRun()`, catch the exception, and inspect `phase()`. It remains `draining-handoff`, the patch remains owned, no abort or recovery runs, and `selectSnapshotTarget` subsequently refuses snapshots.

## Acquisition/release and exact ordering

### Snapshot lease

`createSnapshotLease` acquires by replacing `internals.terminal.write` (`snapshot-lease.ts:27`). Diagnostic writes are appended to `terminalOutput`, journaled, then forwarded to the original terminal write. Non-diagnostic writes are appended to `blockedOutput` and not forwarded (`snapshot-lease.ts:13-25`).

Release order is exact (`snapshot-lease.ts:42-52`):

1. Set `released = true`.
2. Restore `terminal.write` if the lease still owns it.
3. Replay every blocked chunk in insertion order through `originalWrite`.
4. Record `blocked-writes-replayed` only if the full loop completes.
5. Always invoke the owner `onRelease` in `finally`.
6. The owner then removes the render gate, records `snapshot-released`, and requests at most one catch-up render.

This means terminal writes are restored before replay, while the render gate remains active until replay finishes. That ordering prevents a render from interleaving with replay and matches the event order asserted by `tui-snapshot.test.ts`. It is more precise than the README wording that suggests both hooks are restored before replay.

If replay chunk `k` throws, chunks `< k` have reached `originalWrite`, chunk `k` has an unknown terminal-level partial state, chunks `> k` are not attempted, and owner release still runs. `executeSnapshot` records phase `release` only when there was no prior failure; otherwise it suppresses the release error in favor of the earlier failure (`execute-snapshot.ts:46-53`). Artifacts still report the entire buffered string, not the successfully replayed prefix.

### Render ownership

- Native acquisition rejects stopped TUIs and any TUI with an own `doRender`, installs one own blocked `doRender`, and restores it on lease-construction failure (`native-snapshot-target.ts:15-43`). **PROVEN**.
- Native blocked renders set one boolean, so any number of requests produces at most one `requestRender()` on release. Stopped TUIs receive no catch-up (`native-snapshot-target.ts:20-38`). **PROVEN**.
- Managed ownership rejects a second lease through `active`, resets pending state at acquisition, and clears `active` before requesting catch-up (`runtime-snapshot-owner.ts:19-46`). **PROVEN** for normal journal callbacks.
- If an owner `recordEvent("snapshot-released")` callback throws, ownership is already inactive/restored, but catch-up is skipped. In `RuntimeSnapshotOwner`, the retained `recordEvent` field is not cleared because clearing follows the callback. **PARTIAL** under an arbitrary event callback; the actual `SnapshotJournal.record` does not throw for ordinary internal details.

### Cursor query timers and input subscription

`queryTerminalCursor` is otherwise disciplined (`query-terminal-cursor.ts:20-81`):

- Success removes the report, forwards adjacent input, clears timers/listener, and unsubscribes.
- Abort immediately clears and replays any buffered incomplete DSR prefix.
- Timeout and DSR-write failure deliberately retain the filter for 1000 ms so a late report cannot leak into normal input.
- A late report consumes the report, cancels the late timer, and unsubscribes.
- The 1000 ms timer is `unref()`'d.

The synchronous-registration counterexample prevents a total proof. Also, if the unsubscribe callback itself throws, timers and the abort listener have already been cleared, but buffered input replay is skipped because replay follows `unsubscribe()` (`query-terminal-cursor.ts:22-31`).

No other audited file installs an input subscription or timer.

## Function-by-function proof ledger

### `execute-snapshot.ts`

- `errorDetails` — **PROVEN** (`execute-snapshot.ts:9-13`). It is total for `unknown`: `Error` uses `.message`; other values use `String`.
- `executeSnapshot` — **DISPROVEN** (`execute-snapshot.ts:15-77`). Startup acquisition leak S1. Once execution reaches the main `try`, all capture/render exceptions reach release; physical/state captures remain sequential; artifact failure occurs after release and returns `undefined`. `journal.finish()` remains outside a guard, but with ordinary journal-owned events it is non-throwing.

### `native-snapshot-target.ts`

- `NativeSnapshotTarget.constructor` — **PROVEN** (`native-snapshot-target.ts:9-12`). Stores one session-owned TUI reference.
- `beginSnapshot` — **PROVEN** for its ownership obligation (`native-snapshot-target.ts:15-43`). Eligibility is checked before mutation, failed lease construction removes the own render gate, and normal/failing replay always reaches owner release.
- `blockedDoRender` and release callback — **PROVEN** (`native-snapshot-target.ts:20-38`). Requests coalesce to one boolean; gate removal precedes event/catch-up, and catch-up is omitted after stop.

### `runtime-snapshot-owner.ts`

- `begin` — **PARTIAL** (`runtime-snapshot-owner.ts:19-43`). Lease-construction failure clears active owner state. Release clears `active` and pending state before catch-up. A throwing release event callback retains `recordEvent` and skips catch-up, although it does not retain active ownership.
- `blockRender` — **PROVEN** (`runtime-snapshot-owner.ts:45-51`). No mutation while inactive; while active it records one coalesced pending state.

### `snapshot-artifacts.ts`

- `secureWrite` — **DISPROVEN** (`snapshot-artifacts.ts:9-12`). S2 and S5: follows symlinks, overwrites in place, exposes a broader-mode window for pre-existing regular files, and performs no durability sync.
- `writeSnapshotArtifacts` — **DISPROVEN** (`snapshot-artifacts.ts:18-62`). Session ID traversal is correctly rejected and successful modes are `0700`/`0600`, but directory components are not symlink-safe, artifact writes are non-transactional, and `latest.json` is neither atomic nor durable.

### `snapshot-journal.ts`

- `begin` — **PROVEN** (`snapshot-journal.ts:7-11`). Rejects overlapping activation and resets sequence only on successful acquisition.
- `record` — **PROVEN** for internal details (`snapshot-journal.ts:13-15`). It is a no-op while inactive and monotonically sequences active events.
- `finish` — **PARTIAL** (`snapshot-journal.ts:17-22`). It releases journal ownership before cloning details. If a caller supplied detail properties whose getters throw during spread, events are lost and the exception propagates, though the journal is reusable. Internal callers supply plain records.

### `snapshot-lease.ts`

- `createSnapshotLease` — **PARTIAL** (`snapshot-lease.ts:6-56`). It provides idempotent ownership release and `finally`-protected owner release, but cannot prove complete replay after an original write failure.
- `interceptedWrite` — **PARTIAL** (`snapshot-lease.ts:16-26`). Blocked writes are exactly buffered. Diagnostic bytes are recorded before `originalWrite`; if that write throws, artifacts describe attempted bytes rather than a proven emitted byte sequence.
- Lease `renderDiagnostic` — **PROVEN** (`snapshot-lease.ts:30-40`). Released leases reject; `diagnostic` always resets and the end event runs in `finally`.
- Lease `terminalOutput` / `blockedOutput` — **PROVEN** (`snapshot-lease.ts:41-42`). Deterministic ordered joins.
- Lease `release` — **PARTIAL** (`snapshot-lease.ts:43-52`). Idempotent and owner cleanup is `finally`-protected; replay can end at a strict prefix as described above.

### `snapshot-state.ts`

- `componentName` — **PROVEN** (`snapshot-state.ts:8-14`). Pure name selection under the component contract.
- `piState` — **PROVEN** (`snapshot-state.ts:16-29`). Synchronously captures Pi render/cursor/geometry fields; no resource is acquired.
- `renderedState` — **PARTIAL** (`snapshot-state.ts:31-43`). No resource is acquired, but component `render(width)` exceptions propagate. `executeSnapshot` contains them and releases the lease.
- `captureSnapshotState` — **PARTIAL** (`snapshot-state.ts:45-66`). State and ledger mapping are deterministic under renderer/component contracts; renderer snapshot or component rendering can throw and is delegated to the caller's release guard.
- `captureNativeSnapshotState` — **PARTIAL** (`snapshot-state.ts:68-74`). Same render exception boundary; native ownership and empty ledger are represented exactly on success.

### `snapshot-types.ts`

- Type declarations only — **PROVEN** (`snapshot-types.ts:1-48`). No acquisition, release, timer, input, process, or filesystem behavior.

### `select-snapshot-target.ts`

- `selectSnapshotTarget` — **PROVEN** (`select-snapshot-target.ts:6-14`). Managed phase selects the installed patch; idle/fallback native phases select a native wrapper only with a TUI; all transitional/disposed phases reject without mutation.

### `terminal-app-capture.ts`

- Embedded JXA `run` — **PARTIAL** (`terminal-app-capture.ts:7-19`). It either returns the matching Terminal.app tab or throws, but the host supplies no cancellation deadline.
- `isPhysicalSnapshot` — **PARTIAL** (`terminal-app-capture.ts:21-26`). It verifies field types but not finite, integral, or positive rows/columns. JSON excludes `NaN`/Infinity, but negative or fractional values still pass.
- `captureTerminalApp` — **DISPROVEN** (`terminal-app-capture.ts:28-36`). S4: output is bounded to 64 MiB and JSON/type failures reject, but execution time and child lifetime are unbounded.

### `resolve-controlling-tty.ts`

- `parseControllingTty` — **PROVEN** (`resolve-controlling-tty.ts:6-12`). Rejects absent/malformed values and `/dev/fd`; no shell interpolation occurs.
- `resolveControllingTty` — **DISPROVEN** for resource liveness (`resolve-controlling-tty.ts:14-17`). The `ps` child has no timeout/abort. Successful/error child cleanup is delegated correctly to `execFile`.

### `query-terminal-cursor.ts`

- `queryTerminalCursor` — **DISPROVEN** (`query-terminal-cursor.ts:15-83`). S3. Asynchronous registration paths have correct success, abort, timeout, late-filter, buffer-replay, and write-failure cleanup and are covered by five tests.
- Local `cleanup` — **PARTIAL** (`query-terminal-cursor.ts:22-31`). Clears timers/listener before unsubscribe, but a throwing unsubscribe prevents buffered replay.
- Local `retainLateFilter` — **PROVEN** under asynchronous registration (`query-terminal-cursor.ts:33-40`). Rejects once, retains exactly one unref'd late timer, then cleans/replays.
- Registered input handler — **PARTIAL** (`query-terminal-cursor.ts:43-65`). Correctly extracts complete reports and protects split prefixes, but can execute before ownership of the returned unsubscribe callback is established.

### `managed-entry.ts`

- `enterManaged` — **PARTIAL** (`managed-entry.ts:18-38`). Generation checks occur after DSR and before activation; query/baseline/reconciler/renderer/activation errors become failed-or-cancelled results. It inherits the cursor-query subscription counterexample. If `patch.activate` partially mutates then throws, the coordinator's failed-entry recovery is responsible for restoration.

### `begin-width-recapture.ts`

- `beginWidthRecapture` — **PARTIAL** (`begin-width-recapture.ts:14-27`). It returns an abort owner synchronously and stale/cancelled results cannot reactivate the runtime. The ignored `.then(...)` result has no rejection handler: a throwing `isCurrent`, `onActivated`, or `onFailed` callback creates an unhandled rejection. Current coordinator callbacks are mostly non-throwing, but cleanup/recovery callbacks can surface errors.

### `runtime-coordinator.ts`

- `capture` — **PARTIAL** (`runtime-coordinator.ts:22-47`). It invalidates/aborts old async work before detaching the patch. It suppresses all prior-patch cleanup exceptions and installs the new session context anyway, so terminal physical state can be unknown even though the new phase is `idle-native`.
- `startRun` — **PARTIAL** (`runtime-coordinator.ts:49-102`). Patch-install and ordinary entry failures fail open with restored patch methods. Patch-install failure leaves the created, non-aborted `entryAbort` retained until a later cancellation. The awaited `enterManaged` has no outer catch if one of its own error-classification callbacks throws.
- Journal forwarding methods (`beginAssistant`, `ensureTool`, `completeAssistant`, `completeTool`, `noteEvent`) — **PROVEN** (`runtime-coordinator.ts:104-114`). They acquire no external resources and delegate synchronously.
- `snapshot` — **DISPROVEN** transitively (`runtime-coordinator.ts:116`). Target phase selection is correct, but it inherits S1, S2, S4, and S5 from execution dependencies.
- `finishRun` — **DISPROVEN** (`runtime-coordinator.ts:118-135`). S6 for active managed drain. Entering/recapture cancellation paths do use `finally` to reach `idle-native` even when cleanup throws.
- `shutdown` — **PROVEN** for coordinator ownership (`runtime-coordinator.ts:138-153`). It always clears TUI/UI/patch references and sets `disposed` in `finally`; cleanup exceptions remain observable rather than being mislabeled as success.
- `phase` — **PROVEN**. Pure phase read.
- `observer` — **PROVEN**. Exposes the current patch observer only in managed ownership phases.
- `isManaged` — **PROVEN**. Includes active-managed, both native gates, and draining handoff consistently.
- `beginRecapture` — **PROVEN** for stale-callback exclusion (`runtime-coordinator.ts:169-180`). Requires generation, phase, and patch identity; records the returned abort owner.
- `failRecapture` — **PARTIAL** (`runtime-coordinator.ts:182-188`). It aims to return the native gate, clears recapture ownership, and selects native fallback; the exact terminal result still depends on patch gate-return/recovery callbacks.
- `returnWidthGateSafely` — **PARTIAL** (`runtime-coordinator.ts:190-195`). It contains the coordinator transition but cannot prove physical native recovery when both direct gate return and recovery throw.
- `cancelCurrentEntry` — **PROVEN** (`runtime-coordinator.ts:197-203`). Generation invalidation, abort, and abort-reference clearing precede patch detachment.
- `handleReturned` — **PROVEN** (`runtime-coordinator.ts:206-214`). Generation and patch identity reject stale returns; current return clears abort/patch ownership before selecting idle or fallback.
- `enterFallback` — **PROVEN** (`runtime-coordinator.ts:216-219`). Records the reason and establishes native fallback without claiming managed provenance.

## Failure post-state matrix

| Failure point | Observable result | Resource/terminal post-state |
|---|---|---|
| Target absent/ineligible | `undefined` | No lease or journal acquisition. |
| Journal startup or initial clock | Rejection | **Lease remains acquired; terminal/render freeze persists.** |
| Before state/physical capture | Artifact path or `undefined` if artifact write fails | Lease released; no diagnostic render if failure precedes it; blocked writes replayed unless replay fails. |
| Diagnostic render | Failure artifact attempted | Diagnostic flag reset; lease released; terminal output may contain attempted bytes preceding a terminal write error. |
| After state/physical capture | Failure artifact attempted | Lease released; all successfully captured prefix fields preserved. |
| Replay write | Failure artifact attempted | Terminal write hook restored; replayed prefix remains; suffix omitted; render owner released in `finally`; catch-up may be requested. |
| Owner release callback | Failure artifact attempted | Hook/gate ownership is already cleared; catch-up can be skipped. |
| Artifact member write | `undefined` | Snapshot already fully released; arbitrary subset of files can remain; previous `latest.json` remains. |
| `latest.json` write | `undefined` | Full timestamp artifact directory may exist; latest may be old, truncated, or partially replaced. |
| Symlinked artifact path | Success possible | External target overwritten/chmodded; success notification possible. |
| Hung `ps`/`osascript` | Promise never settles | Lease, render gate, child process, and growing blocked-output buffer retained indefinitely. |
| Cursor query abort | Cancelled/failed by caller | Timer/listener/subscription cleared; incomplete prefix replayed. |
| Cursor timeout/write failure | Rejected immediately | Filter retained for up to 1000 ms, then unsubscribed and buffered input replayed; late DSR is consumed. |
| Synchronous cursor callback | Resolved | **Subscription retained indefinitely; post-resolution DSR/timer/listener installed.** |
| Managed `beginDrain` throw | Rejection | **Phase remains `draining-handoff`; patch remains owned.** |
| Shutdown cleanup throw | Rejection | UI/TUI/patch references cleared; phase exactly `disposed`. |

## Artifact permissions and confidentiality

Successful ordinary-path modes are correct: every created/chmodded directory is `0700` and every file is `0600`. `sessionId` is restricted to `[A-Za-z0-9._-]+`, preventing direct separator traversal. The focused artifact test verifies representative directories and `terminal-output.ansi`.

The permission proof nevertheless fails because:

1. Existing symlinks are followed.
2. Existing regular files are truncated before the final `chmod`, so a pre-existing broader mode remains during content replacement.
3. Recursive `mkdir` plus path-based `chmod` does not prove that each component is a real directory owned by this operation.
4. No exclusive creation prevents collision with attacker-created entries.
5. No sync/atomic publication protocol proves durability.

## Optimization

1. **Make lease acquisition transactional.** Put `journal.begin()`, initial event/time acquisition, the full capture, `journal.finish()`, and artifact-input construction under one outer `try/finally`. Once `beginSnapshot` returns a lease, exactly one idempotent `release()` must be unavoidable. Finish/reset the journal in a nested `finally`.
2. **Use descriptor-relative, no-follow artifact creation.** Reject symlink components with `lstat`; create a fresh timestamp directory exclusively; open files with `O_CREAT | O_EXCL | O_NOFOLLOW` where supported; write/chmod/sync via file descriptors rather than path names.
3. **Publish atomically and durably.** Write each artifact completely, `fsync`/`fdatasync` it, sync the timestamp directory, write `latest.json` to a private temporary file, sync it, rename over `latest.json`, then sync the parent directory. Return success only after these steps.
4. **Serialize artifact writes.** The artifact set is small. Sequential writes simplify exact rollback/partial-state reasoning and avoid `Promise.all` continuing sibling writes after one rejection. On failure, remove only the newly and exclusively created timestamp directory.
5. **Bound physical capture.** Thread an `AbortSignal` and explicit timeout into both `ps` and `osascript`; kill and await the child on timeout/abort. Bound blocked terminal output or fail/release the snapshot when the cap is reached.
6. **Make input registration non-reentrant by construction.** Change the API to register and return ownership before callbacks can run, or add a post-registration settled check that immediately invokes the newly returned unsubscribe and skips installing the listener/timer/DSR write. Wrap unsubscribe so buffered replay runs in `finally`.
7. **Give drain initiation a failure transition.** Wrap `beginDrain()` and synchronously recover or return to native on error; clear patch ownership and choose `active-native-fallback` or `idle-native` explicitly.
8. **Observe recapture promise failures.** End `beginWidthRecapture` with a rejection handler that checks generation/patch identity and routes the error through `onFailed`, avoiding process-level unhandled rejection.
9. **Record replay progress.** Track replayed chunk count/bytes separately from buffered output so release failures do not claim that all blocked output was replayed.

## Required regression coverage

- Journal `begin`, initial `record`, and `now` failure after lease acquisition must each assert terminal/render hook restoration.
- Synchronous input registration must assert immediate invocation of the real unsubscribe and no post-resolution DSR/timer installation.
- Symlinked root, session directory, timestamp directory, artifact file, and `latest.json` must all be rejected without mutating the target.
- Child timeout/abort must assert process termination, lease release, ordered replay, and one catch-up request.
- Replay failure on chunk `k` must assert exact prefix/suffix state and owner release.
- Artifact write and latest-publication fault injection must assert cleanup and previous-latest preservation.
- `beginDrain()` failure must assert a stable native fallback phase and cleared patch ownership.
- Throwing recapture completion callbacks must not produce an unhandled rejection.
