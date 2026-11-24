# Round 005 Bundle B — Disprove-first review

## Review

- Correct: the candidate bundle identifies real failure surfaces in native ownership transfer, snapshot lifetime, artifact publication, and terminal-row validation.
- Correct: ordinary managed fallback is stronger than F05's pooled wording implies: it restores methods, invalidates Pi's baseline, and invokes the saved native renderer (`runtime-patch.ts:69-80`; `recover-native-renderer.ts:4-18`).
- Correct: Kitty graphics (`ESC_G`) and iTerm2 inline images (`OSC 1337;File=`) are explicitly rejected, so F08 must not be reported as if no image detection exists (`kitty-image-block.ts:1-3`; `render-pi-lines.ts:15-22`).
- Blocker: F05, F06, F07, and the narrowed F08 all survive disproof. They prevent a Round 005 `PROVEN` result under the convergence gate in `docs/audit/viewport-2-active-renderer/round-005/plan.md`.
- Note: the requested repository-root `plan.md` does not exist. Repository-root `progress.md` contains only empty status/task/file/note headings. This review therefore used the explicit Round 005 plan and design documents under `my-plugins/codex-viewport/docs/`.
- Note: the reviewed implementation is an uncommitted candidate tree; several relevant source and design files are untracked.

## Verdict table

| ID | Strict verdict | Scope correction |
|---|---|---|
| F05 | **UPHELD** | Existentially true for width-redraw failure, native-commit failure, and a throwing dirty-gate catch-up. False as a blanket description of ordinary fallback/recovery. |
| F06 | **UPHELD** | Startup lease escape and unconditional replay are directly established. Coordinator replacement/stop does not cancel or fence an existing lease. |
| F07 | **UPHELD** | Session-ID validation defeats simple traversal, but not symlink following, partial bundle publication, non-atomic `latest.json`, or lack of durability barriers. |
| F08 | **UPHELD, NARROWED** | General controls and capability attestation remain unmodeled. The claim is overstated only insofar as Kitty and iTerm2 image markers are detected and rejected. |

## F05 — native ownership can be restored without a proven native frame

### Attempted disprovals

1. **Ordinary recovery is canonical.** `recoverSynchronously()` restores patch methods and calls `recoverNativeRenderer()` (`runtime-patch.ts:69-80`). That helper emits cleanup controls, invalidates `previousLines`, width, height, viewport top, and image IDs, and invokes saved Pi rendering (`recover-native-renderer.ts:4-18`; `invalidate-native-baseline.ts:3-10`). This disproves any claim that every fallback skips baseline invalidation or native redraw.
2. **A successful clean width gate has a proven native frame.** The architecture requires one mandatory Pi native width redraw before entering `width-recapture-gate`; if no later render is consumed, restoring methods is valid (`docs/design/architecture.md`, sections 8–9; `docs/design/detail/lifecycle-failure.md`, Resize/Stop).
3. **Native commit checks equivalence before transition.** `commitNatively()` first calls `prepareNativeHandoff()` and rejects a non-seamless baseline (`native-commit.ts:12-16`). `prepareNativeHandoff()` compares visible bytes, cursor, geometry, stable-row provenance, and image absence before priming Pi fields (`native-handoff.ts:18-85`). This rules out an unproved *precondition* on the normal commit path.

These defenses do not cover the exception paths below.

### Exact source evidence

- On width mismatch, the patch drops its managed renderer and calls saved Pi `originalDoRender`. If that call throws, it disables the patch, emits only best-effort cleanup controls, restores methods, calls `onWidthRedrawFailed`, and returns. It does not invalidate the native baseline and does not retry or attest a completed native frame (`runtime-patch.ts:153-168`). The coordinator then only clears the patch and enters `active-native-fallback` (`runtime-coordinator.ts:187-193`).
- On native commit, rejection enters canonical recovery, but an exception from saved Pi `doRender` instead disables the patch, restores methods, reports return, and rethrows without `recoverNativeRenderer` (`runtime-patch.ts:180-191`). Because `prepareNativeHandoff()` primes Pi fields before the call, an exception can leave a primed baseline even though the native render did not complete.
- Gate return invokes saved native rendering only when `gateRenderPending` is set (`runtime-patch.ts:82-87`). A recapture failure calls this via a helper that swallows all exceptions (`runtime-coordinator.ts:169-183`; `runtime-failure.ts:13-17`). Thus a throwing dirty catch-up can leave original methods restored with no proof that catch-up completed.
- Official Pi rendering performs substantial stateful terminal work, including synchronized-update controls, clears, cursor movement, image operations, and terminal writes (`packages/tui/src/tui.ts:1256-1311,1435-1442`). Therefore a thrown native render cannot be treated as an atomic completed frame.

### Reachability

- **Width failure:** any managed render after `terminal.columns` changes reaches `width-changed`, then saved Pi rendering. A component `render()` exception or synchronous terminal-write exception reaches the uncovered branch.
- **Commit failure:** a seamless prepared handoff followed by a component/terminal exception inside saved Pi rendering reaches the commit-failure branch.
- **Dirty gate:** after successful mandatory width redraw, any render request during asynchronous DSR recapture sets the gate dirty. Recapture failure then attempts catch-up; a throwing saved renderer is swallowed by `returnWidthGateSafely`.
- This is locally reachable in an interactive plugin because Pi's official interactive mode constructs `TUI(new ProcessTerminal(), ...)` (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:445-458`), and Pi component rendering remains extensible.

### Concrete regression tests

1. Add a width-redraw exception test to `native-handoff.test.ts` or `runtime-patch.test.ts`: enter managed mode, change terminal width, make saved `doRender` throw before its terminal write, invoke patched rendering, and assert (a) original methods are restored, (b) phase is native fallback, (c) no canonical invalidation/recovery render occurred, and (d) no native-frame attestation exists. The current implementation should fail the desired invariant.
2. Add a seamless native-commit exception test: arrange matching managed/native lines, inject a throw from saved `doRender`, and assert that ownership is not released until a successful recovery or explicit stopped-state transition. Also assert that primed Pi baseline fields are invalidated if commit fails.
3. Add a dirty-gate catch-up exception test: complete width redraw, issue a render while DSR is pending, fail recapture, make catch-up throw, and assert the failure is observable and ownership is not silently declared native.

## F06 — snapshot leases can outlive coordinator lifecycle and replay stale/post-stop bytes

### Attempted disprovals

1. `RuntimeSnapshotOwner.begin()` resets its own `active` flag if lease construction throws (`runtime-snapshot-owner.ts:19-40`). This protects only construction-time failure inside `createSnapshotLease`, not later startup failure in `executeSnapshot`.
2. Normal `executeSnapshot` completion releases in `finally` (`execute-snapshot.ts:48-55`), and lease release is idempotent (`snapshot-lease.ts:43-45`). This protects failures after entry into that `try`, not the startup gap.
3. Owner callbacks suppress catch-up rendering when the runtime is disabled or the TUI is stopped (`runtime-snapshot-owner.ts:29-36`; `native-snapshot-target.ts:33-39`). This suppresses only `requestRender`; it does not suppress buffered-byte replay.
4. Entry/width recapture have generation and abort fencing, but snapshot execution does not use those mechanisms (`runtime-coordinator.ts:154-183`).

### Exact source evidence

- `target.beginSnapshot()` installs the lease before `journal.begin()`, initial journal recording, and the first `dependencies.now()`. All three run before the release-protected `try/finally` (`execute-snapshot.ts:21-33`). If any throws, the lease is never released.
- Non-diagnostic terminal writes are appended to `blockedOutput` (`snapshot-lease.ts:17-27`). `release()` restores the saved writer and unconditionally replays every blocked chunk before calling the owner-release callback (`snapshot-lease.ts:43-52`). It does not check generation, coordinator phase, TUI identity, or `internals.stopped`.
- `RuntimeCoordinator.snapshot()` returns the asynchronous operation without storing its promise, lease, abort controller, generation, or TUI identity (`runtime-coordinator.ts:41-47`). `capture`, `finishRun`, and `shutdown` recover/replace renderer state but never cancel, await, or release snapshots (`runtime-coordinator.ts:22-40,116-152`).
- Active-patch `stop()` has no snapshot-owner release (`runtime-patch.ts:106-123`). While the lease is active, patched render requests are blocked (`runtime-patch.ts:193-197`).
- Native snapshot ownership similarly replaces `doRender` until lease release (`native-snapshot-target.ts:15-43`). Its stopped check applies after unconditional byte replay.
- Official `ProcessTerminal.write` forwards to process-global `process.stdout.write` (`packages/tui/src/terminal.ts:454-466`). Consequently an old TUI's delayed replay is still visible after coordinator session/TUI replacement.

### Reachability

- **Startup leak:** call `/tsnapshot` while the shared `SnapshotJournal` is already active, or inject a throwing clock. The lease has already replaced `terminal.write`; the exception bypasses release.
- **Post-stop replay:** begin a snapshot, pause it at an awaited physical capture, then stop/shutdown the TUI. Stop/recovery bytes that use the intercepted `terminal.write` are buffered. When capture resumes, `lease.release()` writes them after stop.
- **Session replacement:** pause snapshot A, call `capture()` for session/TUI B, generate a blocked direct write on A, then resume A. Its saved `ProcessTerminal` writes to the same stdout after B owns the terminal.
- **Direct-write staleness:** any Pi/extension write made while `diagnostic === false` is buffered independently of whether its logical state is later superseded. Release replays the original bytes, then merely requests catch-up if `renderPending`; it does not prove replay is still valid.
- A hung `captureTerminalApp` further makes this lifetime unbounded because the coordinator has no cancellation path.

### Concrete PoCs/tests

1. **Startup leak:** create a target whose lease sets `released = true` only in `release`; pre-activate `SnapshotJournal`; call `executeSnapshot`; assert rejection `snapshot journal is already active`, `released === false`, and subsequent terminal writes remain intercepted. The previously recorded reproduction result was `{"error":"snapshot journal is already active","released":false}`.
2. **Post-stop replay:** use a deferred physical-capture promise. Start snapshot, call patched `stop()`, record the terminal log length after stop returns, resolve capture, and assert the log grows afterward with the buffered stop/recovery bytes. The required fixed behavior is no post-stop replay.
3. **Session replacement:** start snapshot against fake TUI A, call `coordinator.capture()` with TUI B, queue `"OLD"` through A's intercepted writer, finish A's snapshot, and assert `"OLD"` is not written to the shared sink after B activation.
4. **Direct-write ordering:** during the diagnostic lease, queue an ordinary write, cause a blocked render request and a state mutation, release, and assert stale bytes are not replayed ahead of catch-up. Current ordering necessarily replays first (`snapshot-lease.ts:43-52`).

## F07 — artifact publication follows symlinks and is non-atomic/non-durable

### Attempted disprovals

1. `sessionId` is restricted to `[A-Za-z0-9._-]+`, defeating direct slash traversal (`snapshot-artifacts.ts:29-31`).
2. Directories and files are chmodded to `0700` and `0600` respectively (`snapshot-artifacts.ts:9-12,18-27`). This limits later access under ordinary ownership.
3. `latest.json` is written only after `Promise.all` completes for the artifact files (`snapshot-artifacts.ts:57-59`). This avoids intentionally publishing a manifest before successful artifact promises.

None provides no-follow semantics, a transaction, atomic replacement, or a durability barrier.

### Exact source evidence

- `secureWrite` accepts a pathname, calls `writeFile(path, ...)`, then `chmod(path, ...)` (`snapshot-artifacts.ts:9-12`). There is no exclusive create, `lstat`, `O_NOFOLLOW`, descriptor identity check, or confined directory descriptor. Existing symlinks are followed by the path-based operations.
- Directory setup uses recursive pathname `mkdir` and pathname `chmod` (`snapshot-artifacts.ts:18-27`), so validation is not anchored to already-open parent directory descriptors.
- Artifact files are launched concurrently with `Promise.all` (`snapshot-artifacts.ts:57`). One rejection cannot roll back siblings that already completed.
- `latest.json` is overwritten directly at its public pathname (`snapshot-artifacts.ts:58-59`), with no same-directory temporary file plus rename.
- The only imported filesystem operations are `chmod`, `mkdir`, and `writeFile`; there is no `open`, `rename`, `fsync`, `fdatasync`, directory sync, or macOS full-sync operation (`snapshot-artifacts.ts:1-2`). Therefore neither file contents nor publication-directory metadata are crash-durable by construction.
- Existing coverage uses a fresh private temporary directory and checks contents/modes only; it does not test symlinks, interruption, atomic readers, or synchronization (`snapshot-artifacts.test.ts`).

### Reachability

The deployment is local-user, not hostile multi-tenant, but the path remains reachable through stale files, interrupted prior runs, manual diagnostic-directory manipulation, or another local process under the same account. A pre-existing symlink at any artifact pathname or `latest.json` is sufficient. Process termination or filesystem failure during `Promise.all` can leave a partial timestamp directory while the previous `latest.json` remains. A crash after direct `latest.json` truncation can expose malformed or empty JSON.

### Concrete PoCs/tests

1. Precreate the chosen timestamp directory, create a victim file, symlink `terminal-output.ansi` to it, run `writeSnapshotArtifacts`, and assert the victim remains unchanged and the operation rejects. Current behavior overwrites the victim and chmods it to `0600`; the prior executed reproduction observed `{"content":"OWNED","mode":384}`.
2. Precreate `latest.json` as a symlink to a victim and repeat the same assertion.
3. Inject filesystem operations and fail one artifact after another has completed; assert no public timestamp directory and no changed `latest.json` remain. Current `Promise.all` leaves completed siblings.
4. Repeatedly read/parse `latest.json` while publishing a large replacement; require every observation to be either the complete old JSON or complete new JSON. Implement publication with same-directory temp creation, file sync, rename, and parent-directory sync, then pin those calls with an injected filesystem adapter.

## F08 — terminal rows admit unmodeled controls and support detection does not attest capabilities

### Attempted disprovals

1. Kitty and iTerm2 image markers are rejected (`kitty-image-block.ts:1-3`; `render-pi-lines.ts:15-22`). Therefore F08's image portion is not true for Pi's two officially modeled image protocols.
2. Lines wider than the terminal are rejected after `applyLineResets` (`render-pi-lines.ts:17-21`).
3. Zellij and `TERM=dumb` are rejected, and unknown terminal names fail closed (`detect-supported-terminal.ts:3-8`).
4. Official Pi itself emits synchronized update, CUP/erase/cursor, image, and other ANSI operations (`packages/tui/src/tui.ts:1256-1311,1435-1442`), so use of those controls is not uniquely introduced by this plugin.

These checks do not validate controls embedded inside component row strings and do not attest output capabilities.

### Exact source evidence

- `normalizeLines` checks only the two image substrings and visible width, then returns `tui.applyLineResets(lines)` output (`render-pi-lines.ts:15-22`). It contains no parser or allowlist for CSI cursor movement/erase/modes, OSC, DCS, APC, PM, SOS, C0 controls, or Sixel.
- `normalizeViewportLines` extracts Pi's cursor marker, then delegates to the same normalization (`render-pi-lines.ts:25-36`). Extraction is not general control-sequence validation.
- Accepted row bytes flow through viewport diff/paint and one synchronized-update wrapper to `terminal.write` (`managed-renderer.ts:106-119`; `screen-frame-diff.ts:7-28`; `terminal-render-plan.ts:7-10`). An embedded CUP, erase, OSC, DCS, or mode sequence can therefore escape the modeled row/cursor geometry.
- `containsTerminalImage` recognizes only `ESC_G` and `OSC 1337;File=` (`kitty-image-block.ts:1-3`). Official Pi's image capability type likewise models Kitty and iTerm2, not Sixel (`packages/tui/src/terminal-image.ts:3-8,445-460`). A Sixel DCS is outside both models.
- `detectSupportedTerminal` decides solely from `ZELLIJ`, `TMUX`, `TERM_PROGRAM`, and `TERM` strings (`detect-supported-terminal.ts:3-8`). Preflight labels that result the `standard-ANSI allowlist` but performs no terminal-object probe (`runtime-patch-preflight.ts:11-24`).
- Official `Terminal` exposes `write`, dimensions, and Kitty keyboard state, but no `isTTY`, synchronized-update, CUP, or EL capability (`packages/tui/src/terminal.ts:52-75`). `ProcessTerminal.write` forwards to stdout, and dimensions can fall back to environment/default values (`packages/tui/src/terminal.ts:454-470`).
- Official interactive Pi constructs a `ProcessTerminal`-backed TUI (`packages/coding-agent/src/modes/interactive/interactive-mode.ts:445-458`), but the cited construction supplies no capability attestation. Thus `TERM=vt100`, `TERM=xterm-*`, or `TMUX` is treated as proof even when stdout is redirected or synchronized update is unsupported.

### Reachability

- Pi components legitimately emit ANSI styling and hyperlinks, so component row strings are already control-bearing. A third-party component or future Pi component can emit OSC/DCS/cursor controls without owning `doRender` or `stop`; runtime preflight does not reject that coexistence.
- A Sixel-producing component bypasses the two image markers. A cursor/erase sequence can make terminal reality diverge from `InlineViewportFrame` while the renderer accepts its logical transaction.
- Capability false positives are reachable by launching local interactive Pi with an allowlisted environment but redirected/non-TTY stdout, or with `TERM=vt100`/a terminal that lacks DEC synchronized update. Unsupported private modes may be harmlessly ignored, but that is not an attested invariant.

### Concrete PoCs/tests

1. Feed normalization a component row such as `"A\x1b[2J\x1b[HB"` or `"A\x1b]0;changed\x07B"` using the real test TUI. Assert the current function accepts it and the managed terminal log contains the embedded control. The desired test should require rejection or explicit modeled semantics.
2. Feed a Sixel DCS such as `"\x1bPq...\x1b\\"`; assert `containsTerminalImage` returns false. If `visibleWidth` accepts the payload, assert it reaches the terminal; otherwise use a control-only DCS payload that the width routine treats as zero-width.
3. Call `detectSupportedTerminal({ TERM: "vt100" })` and `detectSupportedTerminal({ TMUX: "1" })`; both currently return `"standard"` without any terminal instance or capability input. Add a preflight test with `stdout.isTTY === false` or a fake terminal declaring no required features and require rejection.
4. Add a property test over CSI/OSC/DCS/control-byte classes: every accepted normalized row must preserve the renderer's modeled cursor and row confinement after terminal interpretation; otherwise normalization must reject it.

## Final assessment

The strongest attempted disproofs narrow F05 and F08 but do not eliminate them. F05 is not an ordinary-recovery defect; it is an exception-transaction defect in three ownership-transfer paths. F06 is a missing lifecycle owner/fence around snapshot leases and unconditional buffered replay. F07 requires descriptor-safe and transactional publication, not additional chmod calls. F08 requires an explicit accepted-control grammar and honest capability contract, or a documented restriction to trusted Pi output plus tests proving that all current official component sequences stay within that grammar.
