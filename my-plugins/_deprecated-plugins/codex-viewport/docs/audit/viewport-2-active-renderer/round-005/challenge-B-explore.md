<results>
<files>
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-patch.ts -- native recovery, stop, fallback, and snapshot gating.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/recover-native-renderer.ts -- baseline invalidation and retry recovery.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/snapshot-lease.ts -- write interception, replay, and release.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-snapshot-owner.ts -- lease exclusivity and catch-up scheduling.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-snapshot-target.ts -- native lease release and catch-up.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/execute-snapshot.ts -- `try/finally` lease release.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/snapshot-artifacts.ts -- snapshot publication and filesystem permissions.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.ts -- frame, cursor, attestation, and terminal-image rejection.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/select-snapshot-target.ts -- phase-based snapshot reachability.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.test.ts -- native recovery and fallback tests.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.test.ts -- native handoff rejection tests.
</files>

<answer>
**F05 — DISPROVEN AS STATED; narrow dual-failure residual survives.**

- `recoverNativeRenderer()` writes terminal reset sequences, invalidates the native baseline, and retries `originalDoRender()` (`recover-native-renderer.ts:4-21`).
- `runtime-patch.ts:74-98` restores original runtime methods before recovery and reports recovery errors.
- Recovery is reached for managed-render exceptions, stop without a current native frame, rejected handoff, native fallback, terminal-write failure, and native commit failure (`runtime-patch.ts:126-219`).
- `stop()` invokes `originalStop()` in `finally`, so stop is not abandoned after recovery failure.
- Existing coverage includes native recovery, render failure, and `active-native-fallback` (`runtime-coordinator.test.ts:8-37,66-110`).

Runtime reachability: all listed failure branches are reachable through the patched render/stop methods. The claim that native transition recovery is absent or categorically incomplete is disproven. A narrower claim survives: if both the reset write and retry render fail, recovery returns an error rather than guaranteeing a restored renderer.

Pinning test: inject failures into terminal reset output and `originalDoRender`; assert baseline invalidation, original-method restoration, `onReturned`, propagated error, and eventual `originalStop()`.

**F06 — DISPROVEN / SESSION-REPLACEMENT ANGLE UNREACHABLE.**

- `RuntimeSnapshotOwner.begin()` rejects concurrent leases (`runtime-snapshot-owner.ts`, `begin`).
- `createSnapshotLease.release()` is idempotent, restores the original terminal writer, replays blocked writes in order, and always calls `onRelease` (`snapshot-lease.ts`, `release`).
- `executeSnapshot()` releases the lease in `finally`, including capture/render failures.
- Render requests during a lease set `renderPending`; release requests catch-up when the runtime remains enabled (`runtime-snapshot-owner.ts`, `blockRender`/`onRelease`).
- Native leases independently request catch-up only when pending and not stopped (`native-snapshot-target.ts:14-47`).
- Snapshot targets are phase-gated: managed mode uses the patch; native snapshots are reachable only in `idle-native` or `active-native-fallback` (`select-snapshot-target.ts:5-13`).
- The codex viewport source has no session/lease replacement abstraction; “session replacement” is not a reachable runtime operation here.

The direct-write replay is intentional and paired with pending-render catch-up, not an untracked replay. Narrow residual: if the runtime is disabled/stopped, catch-up is intentionally suppressed while blocked writes are still replayed.

Pinning test: hold a lease, issue `requestRender()` and terminal writes, release it, and assert exactly one ordered write replay plus one catch-up render; repeat with stop/disable and assert no post-stop render.

**F07 — SURVIVES FOR ATOMICITY, SYMLINK SAFETY, AND DURABILITY; PARTIALLY MITIGATED.**

- `writeSnapshotArtifacts()` validates session IDs and uses `.pi/tui-snapshots/<sessionId>/<timestamp>`.
- Directories are created with `0o700`; files use `0o600` and `chmod`.
- Artifact files are written with direct `writeFile` calls, followed by direct `latest.json` publication (`snapshot-artifacts.ts`, `writeSnapshotArtifacts`/`secureWrite`).
- No temporary-file-plus-rename publication exists.
- No `lstat`/`realpath`/symlink rejection exists.
- No `fsync` or directory synchronization exists.
- Publication is runtime-reachable through snapshot execution and artifact writing; it is not merely dead code.

Path validation and permissions mitigate traversal and ordinary access, but do not disprove torn publication, symlink-following, or crash durability defects.

Pinning tests: pre-create `latest.json` as a symlink and assert publication rejects without modifying the target; inject an artifact-write interruption and assert `latest.json` is not published partially; mock filesystem sync and require file plus directory sync before publication.

**F08 — PARTIALLY DISPROVEN; IMAGE ANGLE MITIGATED, ANSI/CAPABILITY-ALLOWLIST ANGLES SURVIVE.**

- `prepareNativeHandoff()` rejects unattested rows, native-owned tail displacement, terminal images, missing/different cursors, visible-frame differences, and cursor differences (`native-handoff.ts`, `prepareNativeHandoff`).
- Native baseline fields are updated only after every handoff check succeeds.
- Thus terminal-image handoff is not accepted silently; it falls back through the recovery path.
- The inspected handoff checks do not establish a general ANSI/control-sequence sanitizer or a complete terminal-capability allowlist. `containsTerminalImage` is narrower than an ANSI safety policy.
- Capability detection is not shown to constrain all emitted native output in the handoff path.

Runtime reachability: image-containing frames reach `prepareNativeHandoff()` during native handoff and are rejected; arbitrary ANSI/capability cases remain reachable unless separately filtered before that function.

Pinning tests: feed native handoff rows containing unsupported OSC/CSI sequences and unsupported terminal capabilities; assert rejection or sanitization and no native commit. Existing image/frame/cursor rejection tests should be extended to cover these cases.
</answer>

<next_steps>
The artifact path could not be written because this subagent is read-only; the complete source-only findings are provided above. No documentation or audit files were read, and no follow-up browsing is needed.
</next_steps>
</results>