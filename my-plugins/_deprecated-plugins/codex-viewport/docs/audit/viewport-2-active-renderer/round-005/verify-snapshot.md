## Review

Overall result: **FAIL**. The focused suite passes, and the main epoch/cancellation, child timeout, blocked-output cap, and no-follow mechanisms work. Two uncovered failure paths remain: partial native ownership installation leaks `doRender`, and publication cleanup can delete a pre-existing snapshot directory after an exclusive-create collision.

### Claim results

| Claim | Result | Evidence |
|---|---|---|
| `CoordinatedSnapshot` epoch/single-flight behavior | **PASS** | One controller is installed per execution, concurrent execution is rejected, cancellation clears the current epoch before aborting it, and an old completion only clears its matching controller (`coordinated-snapshot.ts:6-29`). |
| `executeSnapshot` release/cancel/throw coverage | **PASS** | Journal startup, initial clock access, capture phases, and abort checks are inside the lease cleanup boundary; the abort listener is removed and `lease.release()` is called in `finally` (`execute-snapshot.ts:22-60`). Capture and publication failures are represented without retaining the lease. |
| `SnapshotLease` idempotent release/cancel | **PASS** | Completion is guarded by `released`; terminal ownership is restored, blocked writes are replayed or dropped, and the owner callback runs from the completion `finally` (`snapshot-lease.ts:20-50`). Abort plus later `release()` is therefore idempotent. |
| `RuntimeSnapshotOwner` resource ownership | **PASS** | `active`, `lease`, event recorder, and pending-render state are cleared on release and on lease-construction failure; catch-up is requested only while the runtime remains enabled (`runtime-snapshot-owner.ts:14-63`). |
| `NativeSnapshotTarget` acquisition/release/stop safety | **FAIL** | `doRender` and `stop` are installed before the guarded `try`. If installation of `stop` throws, the first `doRender` override remains owned (`native-snapshot-target.ts:31-35`, cleanup only at `native-snapshot-target.ts:49-53`). Probe result: `{"error":"injected stop install failure","ownsDoRender":true,"ownsStop":false}`. This violates rollback on every throw path. Ordinary native lease release and ordinary native stop cancellation are otherwise coherent. |
| Runtime direct stop / run finish / session shutdown integration | **PASS** | Context replacement, `finishRun()`, and `shutdown()` cancel the coordinated snapshot before renderer transition (`runtime-coordinator.ts:23-44`, `runtime-coordinator.ts:124-159`). Managed `stop()` cancels its snapshot owner before native recovery, while the original stop runs in `finally` (`runtime-patch.ts:100-127`). Public lifecycle wiring reaches these methods (`codex-viewport.ts:45-49`, `codex-viewport.ts:77-83`). Pending-capture shutdown and direct-stop regressions pass (`snapshot-lifecycle.test.ts:18-62`). |
| Child process abort/timeout | **PASS** | Both `ps` and `osascript` receive the snapshot signal and a timeout; `osascript` output is bounded to 64 MiB (`resolve-controlling-tty.ts:14-17`, `terminal-app-capture.ts:28-36`). The hung-`ps` and hung-`osascript` tests pass. |
| Blocked-output cap crossing | **PASS** | The strict crossing check triggers at `MAX_BLOCKED_OUTPUT_BYTES + 1`, drops replay output, forces catch-up, restores pass-through, and forwards the crossing write (`snapshot-lease.ts:20-50`). Probe at 67,108,865 bytes observed `writes:["X"]`, `release:{force:true,replayed:false}`, and `blocked-output-limit.bytes:67108865`; retained diagnostic blocked output remained bounded at exactly 67,108,864 bytes. |
| Artifact exclusive/no-follow file creation | **PASS** | Artifact and temporary pointer files use `O_CREAT | O_EXCL | O_NOFOLLOW`, mode `0600`, per-file sync, and close in `finally`; directory handles use `O_DIRECTORY | O_NOFOLLOW`, mode `0700` (`snapshot-artifacts.ts:7-50`). Existing artifact and `latest.json` symlink regressions pass. A `.pi` symlink-component probe rejected with `ENOTDIR` and created nothing under the target. |
| Artifact synchronized atomic publication | **FAIL** | The normal path syncs artifact files and the snapshot directory, writes/syncs an exclusive temporary pointer, atomically renames it to `latest.json`, and syncs the parent (`snapshot-artifacts.ts:89-116`). However, the timestamp directory is accepted when it already exists, while the catch path recursively removes `directory` whenever publication has not completed. An `EEXIST` from exclusive artifact creation can therefore delete a pre-existing valid snapshot directory. Exclusive creation must extend to directory ownership, or cleanup must be conditioned on this invocation having created the directory. |

### Commands and observed results

```text
node --import tsx --test my-plugins/codex-viewport/tui-snapshot.test.ts my-plugins/codex-viewport/native-tui-snapshot.test.ts my-plugins/codex-viewport/snapshot-lifecycle.test.ts my-plugins/codex-viewport/snapshot-artifacts.test.ts my-plugins/codex-viewport/terminal-app-capture.test.ts my-plugins/codex-viewport/resolve-controlling-tty.test.ts my-plugins/codex-viewport/runtime-patch.test.ts my-plugins/codex-viewport/runtime-coordinator.test.ts my-plugins/codex-viewport/managed-runtime.test.ts my-plugins/codex-viewport/resize-epoch.test.ts
```

Result: **45 passed, 0 failed**, 0 cancelled/skipped/todo.

Additional isolated probes, run with `node --import tsx --input-type=module -e`:

- Native partial-install failure: reproduced leaked own `doRender` after injected `stop` definition failure.
- Output-cap crossing: passed at 64 MiB + 1 byte; prior output was not replayed and the crossing byte passed through.
- Symlinked `.pi` directory component: rejected with `ENOTDIR`; the symlink target remained empty.

### Blockers

- **Blocker:** Make `NativeSnapshotTarget.beginSnapshot()` installation transactional. The guard must include both `Object.defineProperty` calls so failure of the second restores the first (`native-snapshot-target.ts:31-35`).
- **Blocker:** Do not recursively remove a timestamp directory unless this invocation created and owns it. Prefer exclusive timestamp-directory creation and reject collisions without touching existing contents (`snapshot-artifacts.ts:80-116`).

### Exact residual risks

- Node `execFile` timeout/abort uses termination signaling but has no explicit SIGKILL escalation in this code. A hostile child that ignores the default termination signal or leaves inherited stdio open may outlive the nominal timeout even though ordinary hung-child tests pass.
- There is no focused fault-injection test for `rename` or directory `sync`. Static post-state is coherent for ordinary rename failure (temporary pointer and newly owned snapshot are cleaned; old `latest.json` remains). A failure syncing the root after successful rename necessarily returns an error with `latest.json` already replaced and durability uncertain; the code intentionally leaves that coherent published state.
- Native stop while an idle-native capture is pending lacks a dedicated regression test. The ordinary path cancels before calling the original stop, but the partial-install rollback defect above prevents a full safety claim.
- The blocked-output cap bounds retained diagnostic data at 64 MiB, which is still a substantial per-snapshot memory allocation; there is no lower adaptive bound.
- The requested root `plan.md` was absent. Root `progress.md` contained only an empty in-progress template, so verification used the named implementation and tests directly.
