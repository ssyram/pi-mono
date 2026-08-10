# OMP Task List v0.2.0

## Status

Implemented and independently reviewed. Automated verification passes; environmental/manual limitations are recorded below.

- Package version: `0.2.0`
- Scope: `oh-my-pi-v2` task list, task widget, `/task`, Boulder continuation, and task-to-model context
- Non-goal: changing task lifecycle statuses, dependency semantics, or the task tool's public actions

## 1. Intent and boundaries

### Pursue

- Make task state glanceable without wrapping or noisy countdown updates.
- Give a user explicit control over whether the task widget is shown and a complete on-demand inspection command.
- Continue unfinished work automatically only when no newer external information supersedes the previous agent run.
- Keep normal model requests stable by removing per-turn task system-prompt mutation.
- Preserve enough task context for an explicitly triggered continuation to make progress.

### Protect

- A human or RPC submission during a waiting period always wins over automatic continuation.
- Persisted session history remains auditable, while stale automatic-resume messages do not continue to affect normal model context.
- Only task state changes reset a retry episode; a successfully delivered resume message does not.
- Existing task status and dependency invariants remain unchanged.

### Do not accept

- A task row that consumes multiple visual lines in the status widget.
- Retry metadata or countdown text sent to the model.
- Treating an extension-owned message as a genuine user message in session/UI semantics.
- Accumulating up to ten historic resume prompts in subsequent model requests.
- Relying on a system-prompt suffix or final user hint as a provider-independent prompt-cache optimization.

## 2. Research facts and decisions

| Topic | Current behavior | v0.2.0 decision |
| --- | --- | --- |
| Task widget | String rows wrap through TUI `Text`; all groups sort by ascending ID. | Render width-aware single rows; keep unfinished ordering; reverse terminal groups. |
| Task visibility | Widget clears when no active task; no manual override. | Add session-scoped `/task show on` and `/task show off`. |
| Task inspection | Task tool list can expand, but no slash command. | Add `/task info` for complete, untruncated task records. |
| Normal task prompt | `before_agent_start` appends actionable tasks to `systemPrompt` each turn. | Remove this injection entirely. |
| Resume prompt | Boulder uses `sendUserMessage`, which is a user message at every layer. | Use one live `CustomMessage` of type `omp-boulder-resume`. |
| Resume history | Every sent user resume remains in session/model context. | Retain session entries for audit, but context-filter every stale resume entry. |
| Retry | 10s exponential cooldown from send failures, max five failures, plus a three-stagnation stop. | One ten-attempt episode with a fixed specified delay sequence. |
| Waiting UI | A per-second dynamic countdown. | Append a stable AI-invisible schedule entry and retain a per-second status countdown. |

`CustomMessage` is intentionally not described as a provider-level third-party role. Pi stores it as `role: "custom"`, with `customType`, `display`, and `details`, but converts it to provider `role: "user"`. Its value is Pi-level identity, rendering, auditability, and filtering. It does not improve provider cache semantics by itself.

## 3. Data and state contracts

### 3.1 Task data

The persisted `Task` schema and its statuses remain unchanged:

- actionable task = `in_progress` or unblocked `pending`
- terminal task = `done` or `expired`
- `updatedAt` is updated by lifecycle and dependency changes and is the task-progress signal for a retry episode

No task text is normalized or truncated in persistence. Presentation-only code performs normalization.

Runtime task state is keyed by the owning `sessionManager`. `session_start` and `session_tree` load only the latest valid `omp-task-state` entry on the current branch; a branch with no valid task entry installs an explicit empty state. Tool execution, widget updates, `/task info`, Boulder, and compaction always read the event or tool context's owning state.

### 3.2 Task-widget visibility

Add a session-log custom entry, `omp-task-widget-state`:

```ts
interface TaskWidgetStateData {
  visible: boolean;
  changedAt: string;
}
```

The latest valid entry on the current session branch determines visibility. Absence means `visible: true`. This state is session-owned; it is neither a package-global toggle nor a change to task persistence.

### 3.3 Boulder runtime state

Keep non-persistent timer state keyed by session-owned identity, never in an unkeyed extension global:

```ts
interface BoulderSessionState {
  externalInputEpoch: number;
  activeWait?: { episodeKey: string; attempt: number; cancel(): void };
  episode?: { key: string; attemptsSent: number };
  liveResumeId?: string;
}
```

`episodeKey` is a deterministic fingerprint of actionable task IDs, statuses, and `updatedAt` values. A task state change therefore starts a new episode; an unchanged task set does not.

`liveResumeId` is generated for each resume and stored in `CustomMessage.details`. `details` is available to Pi renderers/context hooks but is not sent to the LLM.

## 4. User-visible task list

### 4.1 Widget rows

The widget remains limited to ten task rows plus its existing overflow summary. For every displayed row:

1. Convert every whitespace run in task text and expiration reason to one space.
2. Build the icon, ID, normalized text, status/dependency suffix, and terminal reason as applicable.
3. For a blocked task, include at most the first three unresolved blocker IDs as ` ← #1,#2,#3`; append `,…` when additional unresolved blockers exist.
4. Measure the final row with terminal display width, not JavaScript string length.
5. Reserve width for the complete blocker suffix before allocating width to task text. When the row is too long, truncate task text first; only an extremely narrow terminal that cannot fit the suffix itself may truncate the suffix.
6. Add a terminal ellipsis (`…`) when truncation is required and render exactly one physical visual line.

The full persisted task text is never changed. `/task info` is the escape hatch for text that cannot fit in the widget.

### 4.2 Ordering

Keep the current unfinished groups and their ascending-ID order:

1. `in_progress`
2. ready/unblocked `pending`
3. blocked `pending`

Then retain the existing terminal group placement but reverse each terminal group:

4. `done`, descending ID
5. `expired`, descending ID

This shows recent completed/expired work first without moving unfinished work away from its current execution order.

### 4.3 `/task` command

Add `/task` with these forms:

| Command | Effect |
| --- | --- |
| `/task show on` | Persist `visible: true` and render the widget when task content is available. |
| `/task show off` | Persist `visible: false` and clear only the `omp-tasks` widget. |
| `/task info` | Print all task records with IDs, status, dependencies, timestamps, text, and expiration reason, without row-count or width truncation. |
| `/task help` | Print command grammar and concise descriptions. |
| `/task` | Alias for `/task help`. |

Unknown or incomplete argument sequences print a warning followed by the same help text; they do not change state. Command output and state-change confirmations must be TUI-only `CustomEntry` renderings, not user or custom messages included in model context. `/task info` may use multi-line detail blocks because it is the explicit complete-inspection view; the one-line requirement applies to compact task-row renderers.

Match `/impression`'s prompted-completion pattern: on `session_start`, register an autocomplete provider through `ctx.ui.addAutocompleteProvider(createCommandArgumentProvider(...))`. The first argument level offers `show`, `info`, and `help`; the second level under `show` offers `on` and `off`. Candidate filtering is case-insensitive subsequence matching, applies only after whitespace follows `/task`, replaces the active token, preserves text after the cursor, and supports explicit Tab completion.

## 5. Context and automatic continuation

### 5.1 Normal turns and compaction

Remove the `before_agent_start` task `systemPrompt` mutation. A normal user/RPC turn receives no automatic task list and no task retry metadata.

The task tool remains queryable by the model. Compaction retains only the current actionable task list so that an intentional compaction does not erase unfinished-work knowledge. It contains neither terminal tasks nor retry attempt/delay metadata.

### 5.2 One live resume message

When Boulder is permitted to continue, send one `CustomMessage`:

```text
<omp-boulder-resume>
Continue the actionable tasks below. Complete or expire them before stopping.
If continuation is impossible, output <CONFIRM-TO-STOP/> to stop automatic continuation.
1. [in_progress] #<id>: <text>
2. [ready] #<id>: <text>
</omp-boulder-resume>
```

Its Pi metadata is conceptually:

```ts
{
  customType: "omp-boulder-resume",
  display: true,
  details: { resumeId, attempt, maxAttempts: 10, nextDelayMs },
}
```

The model receives only the XML-wrapped instruction, the `<CONFIRM-TO-STOP/>` escape protocol, and the actionable task list. It receives no `resumeId`, attempt number, maximum-attempt count, delay, countdown, terminal task, or blocked task.

Use `triggerTurn: true` while idle and `deliverAs: "followUp"` while a run is already active. The collapsed custom renderer displays `↻ Automatic Boulder resume`, identifying the session entry without repeating schedule metadata after the wait has completed. Expanded rendering appends the exact model-visible resume content.

### 5.3 Context filtering

Register a `context` hook with the following invariant:

- In a normal turn, remove every `role: "custom"`, `customType: "omp-boulder-resume"` message.
- In the currently executing Boulder resume turn, retain only the message whose `details.resumeId` equals `liveResumeId`; remove all older resume messages.
- Clear `liveResumeId` when that agent run ends **or immediately when external input supersedes the resume**. Its session entry remains for audit and renderer display, but no later ordinary turn receives it.

This is logical replacement, not destructive session rewriting. Pi has no suitable custom-message deletion API, and preserving the entry protects auditability.

## 6. Boulder retry protocol

### 6.1 Preconditions

At `agent_end`, Boulder may schedule the next attempt only when all are true:

- `actionableCount > 0`
- the assistant did not emit `CONFIRM-TO-STOP`
- the run was not aborted or abort-like
- the assistant is not asking a question
- compaction and background-task guards permit continuation
- no active Boulder wait already exists

Existing suppression rules remain unless they contradict this document.

### 6.2 Episode and cancellation

When a wait starts, snapshot `externalInputEpoch` and the current `episodeKey`.

For every committed `input` event with source `interactive` or `rpc`, increment `externalInputEpoch`, cancel the active wait, and clear `liveResumeId`. This applies even when a Boulder resume is currently streaming: a queued human/RPC follow-up must not inherit the resume instruction.

For every non-Boulder custom message delivered while a Boulder wait exists, increment `externalInputEpoch` and cancel the active wait. Boulder-owned `omp-boulder-resume` messages and other internal lifecycle work do not increment it. A raw terminal keystroke alone is not a submitted external message. Escape remains an explicit cancellation control.

Before dispatching a timer callback, re-read task state and verify the same epoch and episode key. Any mismatch cancels rather than resumes. A later human/RPC request may form a new episode only after its own agent run ends.

### 6.3 Attempt schedule

An episode has at most three sent attempts when `ctx.ui.mode === "print"` (the `-p` CLI mode), and at most ten sent attempts in every other mode. The delay before attempt `n` is:

```text
n = 1, 2, 3: 10s
n >= 4: min(10s × 2^(n - 3), 1h)
```

The schedules are:

```text
print (`-p`): 10s, 10s, 10s
other modes: 10s, 10s, 10s, 20s, 40s, 80s, 160s, 320s, 640s, 1280s
```

The one-hour cap does not occur within the ten-attempt schedule but is still mandatory for future extension. Consume an attempt immediately before invoking `pi.sendMessage()`: the public API returns `void` and does not expose a delivery outcome, so the scheduler must not model successful versus failed delivery. Do not reset `attemptsSent` after dispatch. Replace the current five-send-failure disablement and three-unchanged-task stagnation stop with this mode-specific episode budget.

When the applicable mode limit is exhausted, clear the wait UI when present and stop automatically resuming until a material task-state change or a later external-input-driven run starts a new episode.

### 6.4 Scheduled entry and dynamic countdown

As soon as each wait is scheduled, append an AI-invisible `CustomEntry` with a renderer label such as:

```text
↻ Automatic Boulder 4/10 resume scheduled, restarting in 20s
```

This is a durable user-visible audit entry, not a model message; cancellation does not delete it. In parallel, the status line shows the countdown and refreshes every second until cancellation or dispatch. Attempt and delay metadata exist only for the entry, schedule/status logic, and `CustomMessage.details`. The later custom-message renderer displays `↻ Automatic Boulder resume`; expanded rendering appends the model-visible resume content without schedule metadata.

## 7. File-level implementation plan

All new or changed source files must remain at or below 200 LOC excluding blank lines/comments, have one responsibility, and use no generic `utils`/`helpers` bucket.

| Area | Planned responsibility |
| --- | --- |
| `commands/task.ts` | Parse `/task show on`, `/task show off`, `/task info`, and `/task help`; write widget state and emit TUI-only entries. |
| `commands/task-completion.ts` | Provide `/impression`-style hierarchical prompted completion for `show|info|help` and `show on|off`. |
| `tools/task-widget-state.ts` | Read/validate/write the session-log widget-visibility entry. |
| `tools/task-display.ts` | Task ordering, whitespace normalization, terminal-width truncation, and compact-row construction. |
| `tools/task-info-entry.ts` | TUI-only full task-info entry type and renderer. |
| `hooks/boulder-session-state.ts` | Session-keyed runtime episode/timer/input state. |
| `hooks/boulder-scheduler.ts` | Preconditions, delay schedule, cancellation, and at-most-ten dispatches. |
| `hooks/boulder-resume-message.ts` | Custom-message construction, renderer, and `context` filtering. |
| `hooks/boulder-countdown.ts` | Maintain the refreshable wait-status countdown and its lifecycle. |
| `hooks/boulder-schedule-entry.ts` | Append and render the AI-invisible scheduled-resume audit entry. |
| extension bootstrap module | Register the command, task display callback, Boulder handlers, and renderers. |
| `index.ts` | Barrel re-exports only; move current bootstrap logic out before adding registrations. |

The existing oversized Boulder/bootstrap implementation must be decomposed as above rather than expanded in place.

## 8. Correctness argument

### Goal-to-module mapping

| Goal | Responsible design element |
| --- | --- |
| One-line, readable task state | `task-display.ts` width-aware compact renderer |
| User-controlled widget and complete inspection | `/task`, widget-state entry, task-info entry |
| No obsolete automatic resume | external epoch + episode-key checks before dispatch |
| Bounded continuation | scheduler attempt budget and delay function |
| No normal per-turn task prompt mutation | removal of `before_agent_start` injection |
| Resume can still act on tasks | one live custom resume message with actionable tasks |
| No resume-history context pollution | `context` hook filters old custom resumes |

### Key invariants and preservation

1. **Compact-row invariant:** a widget row contains no line-break whitespace and has display width no larger than its allocated width. Normalization removes line breaks; truncation is the final operation, so no later suffix can overflow the row.
2. **At-most-one-live-resume invariant:** every context request filters all Boulder resume messages except the one matching `liveResumeId`, and normal turns match none. Therefore historic entries may persist but cannot accumulate in the LLM context.
3. **External-input precedence invariant:** a wait can fire only if its captured `externalInputEpoch` still equals current state. Every relevant external message increments the epoch and cancels the wait, so a message arriving before dispatch prevents automatic continuation.
4. **Mode-bounded-attempt invariant:** `attemptsSent` increases once per dispatch and dispatch requires `attemptsSent < limit`, where `limit` is `3` in print mode and `10` otherwise. Dispatch cannot reset it. Therefore an unchanged episode sends no more than its mode's permitted resumes.
5. **Retry reset requires progress invariant:** an episode key includes task `updatedAt`; task lifecycle/dependency changes alter the key, while message delivery alone does not. Thus retry budget resets only after material task state change or a new externally initiated run.
6. **Model-metadata isolation invariant:** attempt and delay values exist only in `CustomMessage.details` and the schedule status. The resume renderer never reads them—even when expanded—Pi does not pass `details` to the LLM, and the resume prompt builder does not include them.

## 9. Test plan and acceptance criteria

### Unit tests

- Compact display normalizes CRLF/LF/tab whitespace, handles wide Unicode, obeys width, and uses `…` only after truncation.
- Blocked rows preserve a suffix of at most three unresolved blocker IDs plus `,…` for overflow by truncating task text first.
- Ordering preserves unfinished group order and reverses `done` and `expired` separately.
- Widget state defaults on, persists `/task show on|off`, and never changes task state.
- `/task info` includes every task and full text; compact rendering does not.
- `/task` and `/task help` return the same help; unknown/incomplete commands warn without changing state.
- Completion offers `show|info|help` at level one and `on|off` only after `show`, with impression-style fuzzy token completion.
- Delay function produces the exact three print-mode values and the exact ten values in every other mode; values beyond the latter cap at one hour.
- Attempt budget increments before each `sendMessage()` dispatch and never resets merely because dispatch was invoked; print mode stops after three attempts and every other mode after ten.

### Extension/session tests

- A normal turn has no task system-prompt mutation.
- An idle resume sends `CustomMessage` with `omp-boulder-resume`, then starts a turn.
- A live resume context contains its own message only; a normal context contains no historic resume message.
- `details` retains attempt/delay metadata without exposing it to the LLM or collapsed/expanded resume rendering.
- `interactive` and `rpc` input cancel an active wait and clear `liveResumeId`, including when a Boulder resume is streaming and the input is queued as follow-up; Boulder-owned custom messages do not.
- A non-Boulder custom message during a wait cancels it.
- Timer callback rechecks epoch, episode key, and actionable task state.
- Escape, question, abort, compaction, and background-task suppressions continue to work.

### Manual TUI checks

- Narrow terminal, long task, and multi-line task display one row with an ellipsis.
- `/task show off`, `/task show on`, `/task info`, `/task help`, and prompted completion have the defined behavior.
- A scheduled entry immediately displays `↻ Automatic Boulder n/N resume scheduled, restarting in XXs`; the status countdown refreshes every second, and `-p` performs exactly the three 10-second waits.
- Collapsed resume entries show `↻ Automatic Boulder resume`; expanded entries append exactly the model-visible resume content.

## 10. Implementation exit checklist

- [x] Package version changed from `0.1.0` to `0.2.0`.
- [x] README documents `/task` and static Boulder retry behavior.
- [x] Architecture version history links this design.
- [x] Normal `before_agent_start` task injection is absent.
- [x] Focused automated tests, strict TypeScript, and root `tsgo --noEmit` pass.
- [x] Installed-Pi TUI smoke passes for plugin loading, `/task` help/show/info, and both completion levels.
- [ ] Live task-widget/Boulder timer TUI smoke — not run without a model-driven task turn; component and fake-timer tests cover these paths.
- [ ] `npm run check` passes after source changes — not run because it starts with write-mode `biome check --write` in a shared dirty worktree.
- [x] Final independent implementation review reports no unresolved blocker or major issue.
