# Parallel Sub-agent Exit 143 Investigation Handoff

## Context

This note captures observations from reproducing a `subagent({ tasks: [...] })` foreground parallel run that previously reported exit code `143` for each child while still showing partial child output and intercom completion traffic.

It has been updated after a later successful re-test (`3/3 succeeded`) following an intercom-related fix. The suspected areas below should still be treated as investigation guidance rather than proof of a single-file root cause.

## Reproduction observed

Two separate foreground parallel runs were previously attempted from the main session with three `explore` sub-agent tasks.

Observed behavior in both failure reproductions:

- Aggregate result: `0/3 succeeded`
- Each task reported: `FAILED (exit code 143)`
- Some task output still appeared in the aggregate response body
- At least one child session also sent an intercom `DONE: ...` message back to the main session
- User stated they did not press abort during the second reproduction

A later re-test after an intercom-related fix showed:

- Aggregate result: `3/3 succeeded`
- All three parallel `explore` branches returned concrete file results
- No `exit code 143` failure was observed in that run

This narrows the problem space. The issue appears to have been tied to an intercom-adjacent coordination/teardown path rather than a generic inability to run parallel sub-agents.

## Current interpretation

A cautious working theory is:

1. Foreground parallel sub-agent child processes start successfully.
2. At least one child may emit results through stdout/intercom before the run fully settles.
3. An upstream cancellation signal may fire during a narrow coordination window.
4. The execution layer receives the aborted signal and terminates the child process with SIGTERM.
5. The parallel aggregator then reports the child step as failed with exit code 143.

After the later successful re-test, the most likely shape is not a generic parallel execution bug. It more likely involved an intercom-related lifecycle race, such as:

- intercom prompt/tool injection being active,
- but runtime detach not yet being eligible,
- while an upstream cancel/shutdown path still fires,
- causing the run to fall through to ordinary abort -> SIGTERM.

This remains a hypothesis until the exact triggering call path is instrumented.

## Evidence gathered so far

### Direct process kill location

Likely direct SIGTERM issuer:

- `third-party-plugins/pi-subagents/execution.ts`

Relevant area:

- Around lines `288-301`
- The execution layer registers a kill handler on `options.signal`
- On abort, it calls `proc.kill("SIGTERM")`
- It schedules a fallback `proc.kill("SIGKILL")` after a short delay
- If intercom detach is active and allowed, abort may detach instead of killing

Recommended verification:

- Add temporary logging around this kill handler to record:
  - run id / step id / agent
  - whether `processClosed` is already true
  - whether `detached` is true
  - whether `intercomStarted` is true
  - stack trace or caller context at the moment the signal fires

### Intercom lifecycle and detach gating

Files of interest:

- `third-party-plugins/pi-subagents/intercom-bridge.ts`
- `third-party-plugins/pi-subagents/execution.ts`
- `third-party-plugins/pi-subagents/subagent-executor.ts`

Observed behavior:

- `intercom-bridge.ts` is the injection point that appends the `Intercom orchestration channel:` marker and injects the `intercom` tool
- `subagent-executor.ts` enables `allowIntercomDetach` when the agent system prompt contains that marker
- `execution.ts` does **not** detach simply because intercom was injected
- `execution.ts` only flips `intercomStarted = true` after runtime output shows `tool_execution_start` for the `intercom` tool
- Until `intercomStarted` becomes true, an abort cannot use the intercom detach path and instead falls through to ordinary SIGTERM handling

Why this matters:

- This makes a coordination race plausible: intercom may be configured, but not yet runtime-confirmed, at the moment an upstream cancel/shutdown path fires
- That would fit the earlier symptom pattern of intercom-related traffic appearing while the foreground run still ends with exit 143

Recommended verification:

- Add temporary logging to record:
  - when the intercom marker is injected
  - when `allowIntercomDetach` is true for a run
  - when `intercomStarted` flips true in `execution.ts`
  - whether an abort arrives before or after that transition

### Upstream AbortController owner candidates

Potential upstream abort sources:

- `third-party-plugins/pi-subagents/prompt-template-bridge.ts`
- `third-party-plugins/pi-subagents/slash-bridge.ts`

Relevant areas:

- Both own request-scoped `AbortController`s
- Both pass `controller.signal` into delegated execution
- Both call `controller.abort()` on cancel events
- Both expose `cancelAll()` that aborts all live controllers
- Their `dispose()` methods appear to unsubscribe and clear pending cancels, but do not appear to abort live controllers on their own in the inspected excerpts

Recommended verification:

- Add temporary logging to every `controller.abort()` site in both files
- Include request id, whether it was a single cancel or `cancelAll()`, and active controller count
- Confirm which bridge path is actually active for the reproducer

### Top-level cancelAll caller

Relevant file:

- `third-party-plugins/pi-subagents/index.ts`

Relevant area:

- Around lines `473, 483-486`
- Search results showed `session_shutdown` cleanup calling:
  - `slashBridge.cancelAll()`
  - `promptTemplateBridge.cancelAll()`

Why it is interesting:

- If `session_shutdown` or another lifecycle cleanup occurs while a foreground parallel run is still active, this would abort all bridge-owned controllers at once
- Because the foreground parallel path fans a single upstream signal out to all children, one upstream abort would affect the entire batch

Recommended verification:

- Inspect the surrounding event handler for these calls
- Determine what event triggers them in the failing scenario
- Log when these calls happen and whether any foreground parallel request is still active

### Signal propagation path

Files that appear to forward abort signals rather than directly kill processes:

- `third-party-plugins/pi-subagents/index.ts`
- `third-party-plugins/pi-subagents/subagent-executor.ts`
- `third-party-plugins/pi-subagents/execution.ts`

Observed pattern:

- Entry points receive a `signal`
- Foreground parallel execution fans the same upstream `signal` into every `runSync(...)` child
- The final execution layer turns the aborted signal into `SIGTERM`

Recommended verification:

- Trace the exact `AbortSignal` instance used by the parallel run
- Confirm whether it comes from:
  - the main tool-call context
  - prompt-template bridge controller
  - slash bridge controller
  - an internal executor-created controller

## Cmd+Tab / focus-loss hypothesis

Current evidence does not support Cmd+Tab or focus loss as the direct cause.

Searches did not find a clear path from:

- focus loss
- blur
- visibility change
- Cmd+Tab
- app switching

into sub-agent cancellation.

Visible cancellation paths were explicit interrupt/cancel/abort paths rather than focus-related lifecycle hooks.

This should still be treated cautiously: terminal or TUI behavior could indirectly affect input handling, but no code evidence currently points to Cmd+Tab itself as the trigger.

## Test coverage findings

Relevant existing tests:

- `third-party-plugins/pi-subagents/test/integration/parallel-execution.test.ts`
  - Covers happy-path foreground parallel execution via `mapConcurrent + runSync`
  - Does not cover abort propagation, exit `143`, intercom, or partial-output-then-fail behavior
- `third-party-plugins/pi-subagents/test/integration/error-handling.test.ts`
  - Covers single-run abort timing through `runSync(...)`
  - Does not cover foreground parallel shared-signal fanout or bridge shutdown behavior
- `third-party-plugins/pi-subagents/test/unit/prompt-template-bridge.test.ts`
  - Covers pending cancel, in-flight cancel, tasks payload shaping, and missing parallel results
  - Does not cover `session_shutdown` -> `cancelAll()` during active foreground parallel execution

Recommended follow-up tests:

1. A foreground parallel integration test where a shared signal aborts after one child emits progress/output.
2. A bridge-level test that simulates `cancelAll()` while a parallel delegated request is active.
3. A test that exercises intercom-enabled runs where abort occurs before vs after `intercomStarted` becomes true.

## Suggested next tracing steps

Recommended minimal instrumentation:

1. In `third-party-plugins/pi-subagents/execution.ts`, log when the abort listener fires before `proc.kill("SIGTERM")`.
2. In `third-party-plugins/pi-subagents/prompt-template-bridge.ts`, log every `controller.abort()` call and `cancelAll()` call.
3. In `third-party-plugins/pi-subagents/slash-bridge.ts`, log every `controller.abort()` call and `cancelAll()` call.
4. In `third-party-plugins/pi-subagents/index.ts`, log the event or lifecycle hook that calls both bridge `cancelAll()` methods.
5. In `third-party-plugins/pi-subagents/execution.ts`, log when `intercomStarted` becomes true and when detach requests are accepted/rejected.
6. Re-run a three-task foreground parallel `explore` call without pressing abort.
7. Compare timestamps:
   - child result emitted
   - intercom marker applied
   - intercom tool start observed
   - bridge cancel/abort emitted
   - execution SIGTERM emitted
   - aggregate failure recorded

## Expected root-cause shape

The issue may be one of these patterns:

- A bridge-level cleanup path cancels live foreground requests too early
- A prompt-template/slash cancel event is emitted unexpectedly
- The main tool-call `AbortSignal` is being aborted by the host after partial response handling
- Intercom is enabled for the run, but abort arrives before runtime intercom start makes detach eligible
- Intercom detach/result return and foreground process lifecycle are racing

## Files to inspect first

Primary:

- `third-party-plugins/pi-subagents/execution.ts`
- `third-party-plugins/pi-subagents/intercom-bridge.ts`
- `third-party-plugins/pi-subagents/index.ts`
- `third-party-plugins/pi-subagents/subagent-executor.ts`
- `third-party-plugins/pi-subagents/prompt-template-bridge.ts`

Secondary:

- `third-party-plugins/pi-subagents/slash-bridge.ts`
- `third-party-plugins/pi-subagents/parallel-utils.ts`
- `third-party-plugins/pi-subagents/result-watcher.ts`
- `third-party-plugins/pi-subagents/intercom-bridge.ts`

## Workspace change note

At the time of this update, the main repo did not show direct local source edits under `third-party-plugins/pi-subagents/`. A nested repo status check showed a local modification in `third-party-plugins/pi-intercom/package-lock.json`, which is not enough by itself to explain the behavioral change. The successful re-test should therefore be correlated with the actual fix location before declaring the exact component at fault.

## Notes

The key distinctions are:

- the component that sends SIGTERM: likely `execution.ts`
- the components that can trigger the abort signal: the bridge/controller layers and any session-shutdown lifecycle that calls `cancelAll()`
- the intercom-specific nuance: injection and detach eligibility are not the same event

The investigation should focus on identifying the upstream abort source and the timing of intercom detach eligibility, rather than only the final kill site.
