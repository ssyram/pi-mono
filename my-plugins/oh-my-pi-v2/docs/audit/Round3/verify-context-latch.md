# Round 3 R3-C11 Context Compaction Latch Verification

## Verdict

PASS — R3-C11 is fixed in the current source.

## Candidate under verification

- `docs/audit/Round3/candidates.md` lists **R3-C11: context auto-compaction latch cannot observe failed/canceled compaction completion**.
- `docs/audit/Round3/reduction.md` maps it to **R3-RC4**, classifies it as **Non-Decisional**, and states the expected fix: use the current `ctx.compact` callback API to log completion/failure and clear the latch on failure.

## Source evidence: `hooks/context-recovery.ts`

Current auto-compaction code gates on the latch, calls `ctx.compact` with callbacks, and sets the latch after starting compaction:

```ts
if (
  usage.percent >= AUTO_COMPACT_THRESHOLD &&
  !compactedSessions.has(sessionId)
) {
  ctx.compact({
    onComplete: () => {
      console.error(`[oh-my-pi context] Auto-compaction completed for session ${sessionId}`);
    },
    onError: (error) => {
      compactedSessions.delete(sessionId);
      console.error(`[oh-my-pi context] Auto-compaction failed for session ${sessionId}: ${error.message}`);
    },
  });
  compactedSessions.add(sessionId);
```

This satisfies the R3-C11 fix expectation:

- `ctx.compact` callbacks are used.
- `onComplete` logs successful auto-compaction completion.
- `onError` clears the latch with `compactedSessions.delete(sessionId)`.
- `onError` logs failure with the session id and error message.

Additional lifecycle evidence: `session_shutdown` removes stale latch state:

```ts
compactedSessions.delete(sessionId);
```

## Framework API evidence

`packages/coding-agent/src/core/extensions/types.ts` defines callback-capable compaction options and exposes them through `ExtensionContext.compact`:

```ts
export interface CompactOptions {
	customInstructions?: string;
	onComplete?: (result: CompactionResult) => void;
	onError?: (error: Error) => void;
}

/** Trigger compaction without awaiting completion. */
compact(options?: CompactOptions): void;
```

`packages/coding-agent/src/core/agent-session.ts` invokes those callbacks in the fire-and-forget compaction action:

```ts
const result = await this.compact(options?.customInstructions);
options?.onComplete?.(result);
```

and on failure:

```ts
const err = error instanceof Error ? error : new Error(String(error));
options?.onError?.(err);
```

`packages/coding-agent/src/core/extensions/runner.ts` forwards extension context calls to the framework action:

```ts
compact: (options) => this.compactFn(options),
```

## Conclusion

R3-C11 passes verification. The plugin now uses the framework callback API and clears/logs the auto-compaction latch on error, so failed compactions can be retried later in the same session instead of permanently suppressing auto-compaction.
