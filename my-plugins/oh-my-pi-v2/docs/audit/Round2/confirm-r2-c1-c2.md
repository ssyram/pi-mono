# Round 2 confirmation: R2-C1 / R2-C2

## R2-C1 — CONFIRMED

Verdict: confirmed.

Runtime path:
1. `hooks/boulder.ts` tracks repeated unchanged actionable task IDs with `stagnationCount`.
2. On `agent_end`, when `stagnationCount >= 3`, it calls `handleStagnation(pi, ctx, actionableCount)` and returns before the normal countdown/restart path.
3. `handleStagnation()` sends a user message saying Boulder is stopping auto-continuation.
4. That same path is still a `pi.sendUserMessage(...)` injection, using `deliverAs: "followUp"` when not idle.
5. After delivery/attempt, it resets `stagnationCount = 0`.
6. It does not set `disabled = true`, cancel a persistent Boulder latch, or otherwise record a durable halt.

Strict rationale: the stagnation threshold suppresses the normal restart for that one `agent_end`, but implements the “stop” as another prompt injection plus counter reset. Later eligible `agent_end` events can build stagnation again and continue Boulder behavior.

## R2-C2 — CONFIRMED

Verdict: confirmed.

Runtime path:
1. `hooks/context-recovery.ts` declares `compactedSessions = new Set<string>()` as the “once per session” auto-compaction latch.
2. In `before_agent_start`, if context usage is at/above 78% and the session is not in `compactedSessions`, it adds the session ID and calls `ctx.compact()`.
3. In the `session_compact` handler, the code executes `compactedSessions.delete(sessionId)`.
4. The same handler may then send a context-restoration continuation if actionable tasks remain.
5. Because the latch was deleted, a later `before_agent_start` in the same session can again satisfy `!compactedSessions.has(sessionId)` and trigger another automatic compaction.

Strict rationale: the code comment/shape says auto-compaction is once per session, but successful compaction clears the exact latch that enforces it, permitting repeated auto-compaction in the same session.
