# external-withFileMutationQueue.md

Backfilled by main agent per Batch B report (reference-passed at extension.ts:61; invoked at settings-files.ts:51). Native evidence: packages/coding-agent/src/core/tools/file-mutation-queue.ts. Write-once.

## `withFileMutationQueue<T>(path, action): Promise<T>` (host ExtensionAPI export)

Sites: passed as the `queue` parameter of registerMySettingsService (extension.ts:61 → settings-service.ts:18 → settings-save.ts:34 → settings-files.ts:43); the actual invocation is settings-files.ts:51 (`return await queue(target, action)`).

- Pre: `path` absolute string (here: realpath-derived target, settings-files.ts:50); `action` a `() => Promise<T>` closure.
- Post: returns a promise settling with the action's outcome. Per extern-model.md and the native file-mutation-queue implementation, it serializes same-file read-modify-write sequences per process: actions for the same path run one-at-a-time in submission order; different paths do not block each other.
- Failure behavior: if `action` never rejects, the chain never rejects (Batch C observation); action rejections propagate to the caller of `queue(...)`. In writeSettingsFile the action is the L51 closure that returns structured outcomes only (its whole body is try/caught), so the queue-level rejection path is unreachable for in-repo actions. Unbounded queue growth / action-never-invoked (host stall) is outside the JS exception contract; a never-settling queue promise would hang writeSettingsFile's await — listed as async obligation in fn-settings_files-writeSettingsFile-L40.md.
- Caller obligations: keep per-target consistency between the path used for enqueueing and the paths read/written inside the action (discharged: target computed once at settings-files.ts:50 and reused for read/write/rename inside the action).
