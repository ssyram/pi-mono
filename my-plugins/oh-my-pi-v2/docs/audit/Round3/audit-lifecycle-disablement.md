# Round 3 Audit: Lifecycle / Disablement Correctness

## FINDING: Context auto-compaction latch is set before compaction succeeds and is not cleared on compaction failure/cancellation

**Hoare triple**

`{ session context usage >= AUTO_COMPACT_THRESHOLD ∧ sessionId ∉ compactedSessions ∧ ctx.compact() does not complete with session_compact }`

`before_agent_start` in `hooks/context-recovery.ts` calls `ctx.compact()` and immediately executes `compactedSessions.add(sessionId)`.

`{ sessionId ∈ compactedSessions ∧ no session_compact restoration occurred ∧ future before_agent_start calls in the same session will not retry auto-compaction }`

**Evidence**

- `hooks/context-recovery.ts:41-48` triggers auto-compaction, calls `ctx.compact()`, then immediately adds the session id to `compactedSessions`.
- `packages/coding-agent/src/core/extensions/types.ts:286-315` documents `ExtensionContext.compact(options?)` as a void action that triggers compaction without awaiting completion.
- `packages/coding-agent/src/core/agent-session.ts:2203-2212` shows the supported lifecycle callbacks: `compact` accepts `onComplete` / `onError`, but the hook does not pass either callback.
- `hooks/context-recovery.ts:83-105` handles successful `session_compact` but only clears `warnedSessions`; it does not clear `compactedSessions`.
- `hooks/context-recovery.ts:108-120` clears `compactedSessions` only on `session_shutdown`.

**Impact**

A failed, canceled, or otherwise non-completing auto-compaction permanently consumes the per-session compaction latch until shutdown. That leaves the current session above the threshold with no retry path, despite no successful compaction lifecycle event and no context-restoration continuation.

**Expected postcondition**

`compactedSessions` should represent “auto-compaction completed or is deliberately still in-flight,” not “the trigger was attempted once.” A failed/canceled auto-compaction should clear the latch via the supported `onError` path, or the latch should be set only from a successful completion/session-compaction path.
