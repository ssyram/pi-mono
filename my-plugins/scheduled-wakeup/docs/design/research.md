# Scheduled Wakeup Research

## Local Pi capabilities

- Extension modules register lifecycle handlers through `pi.on(...)` and commands through `pi.registerCommand(...)`.
- Long-lived resources must start after `session_start`, not at module load time.
- Long-lived timers must call `.unref?.()` and must be cleared in `session_shutdown`.
- `pi.sendUserMessage(content)` injects a real user message and triggers a turn when idle.
- If Pi is already streaming, `pi.sendUserMessage(content, { deliverAs: "followUp" })` queues a follow-up instead of interrupting the current turn.
- `ctx.isIdle()` and `ctx.hasPendingMessages()` are available for delivery decisions.

## External options

- A directly relevant community idea is a `/loop [interval] <prompt>` style extension, often described around "loop engineering". It is useful as a UX reference.
- The practical limitation of the known loop-style approach is in-memory state: scheduled loops disappear on process exit or reload unless persisted.
- Pi's own subagent scheduled runs are plugin-specific, not a general extension API for scheduling arbitrary user prompts.

## Recommended approach

Implement a local extension in `my-plugins/scheduled-wakeup/` with:

- `/loop <interval> <prompt>` for recurring prompts.
- `/loop once <delay> <prompt>` for one-shot prompts.
- `/loop list`, `/loop stop <id|all>`, `/loop run <id>`, and `/loop help` for management.
- JSON persistence under `.pi/scheduled-wakeup/jobs.json` in the active project cwd.
- In-process timers only; document that this is not an OS daemon and cannot wake a stopped Pi process.
