# Round 3 Candidate R3-C11 Confirmation

## Verdict: CONFIRMED

R3-C11 is confirmed against the current source.

Candidate claim: `hooks/context-recovery.ts` starts context auto-compaction with `ctx.compact()` and immediately records the session in `compactedSessions`. If that compaction later fails or is canceled before `session_compact`, the session remains latched and the hook will not retry auto-compaction for that session.

## Evidence

### Plugin hook behavior

In `my-plugins/oh-my-pi-v2/hooks/context-recovery.ts`, the `before_agent_start` handler checks context usage and, once usage is at least 78%, calls `ctx.compact()` and then immediately adds the session id to `compactedSessions`.

The latch is therefore set after the fire-and-forget start call returns synchronously, not after confirmed compaction success. The only synchronous failure protected here is a direct throw from `ctx.compact()`; in that case the surrounding catch logs the failure and the latch add is skipped.

The `session_compact` handler restores task context after compaction, but it does not clear or adjust `compactedSessions`. The only observed cleanup for `compactedSessions` is `session_shutdown`.

### Framework compaction contract

Current framework source defines `ExtensionContext.compact(options?: CompactOptions): void`, with `CompactOptions` including:

- `customInstructions?: string`
- `onComplete?: (result: CompactionResult) => void`
- `onError?: (error: Error) => void`

The framework binding for extension `compact(options)` runs compaction in a fire-and-forget async task. On success it calls `options?.onComplete?.(result)`. On failure it normalizes the thrown value to an `Error` and calls `options?.onError?.(err)`.

Framework docs also describe `ctx.compact()` as non-awaitable and instruct extensions to use `onComplete` and `onError` for follow-up behavior.

### Failed/canceled completion behavior

In `packages/coding-agent/src/core/agent-session.ts`, manual compaction emits `session_compact` only after compaction content has been appended and a saved compaction entry has been found. Cancellation or failure paths do not emit `session_compact`; they emit `compaction_end` and throw.

For extension-triggered manual compaction, that thrown failure is caught by the extension compact binding and delivered to `CompactOptions.onError` when provided.

## Local fixability / API classification

This is locally fixable with current host API callbacks.

It is not a decisional API limitation, because the current `ExtensionContext.compact` API already exposes supported completion and error callbacks. The plugin can defer setting `compactedSessions` until `onComplete`, or clear/not set the latch in `onError`, depending on the intended retry policy. The current code simply does not use those callbacks.

## Notes

`ctx.compact()` still returns `void`, so the plugin cannot await it directly. However, callback support is sufficient for this candidate: the hook can observe asynchronous success and failure through the existing `onComplete` and `onError` options.
