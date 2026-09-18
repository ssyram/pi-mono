# Task-system integration plan — APPLIED 2026-09-18

The plan below was user-approved and wired into the live runtime; this document now records the shipped interfaces and caller obligations. The agent-profile `tools:` additions are applied in the working tree but remain uncommitted pending unrelated interleaved staged work in those files.

## Actual available APIs

All paths below are under `tools/task-system/`.

- `execute.ts`: `executeTaskRequest(previous: TaskState, input: unknown): TaskOperation`. Returns a cloned complete candidate, `changed`, and the native-shaped result. Business/request errors return `details.error`; batch skips return structured outcomes rather than whole-call failure. This pure transform is still fallible; harness callers use the containing session methods, not this low-level export directly.
- `session.ts`: `createTaskSession(initial?)` owns one session's state. Methods: `snapshot()`, `restore(branch, history)`, `execute(input, persist)`, `executeHuman(args, persist)`, `clear(persist)`. Human and model entry points share this same controller and commit boundary. `execute`, `executeHuman` and `clear` return TaskOperation, containing ordinary transformation/persistence faults as error operations. `restore` returns TaskRestoreResult (`ok: true` or `ok: false` plus error); the caller MUST inspect it. `persist(snapshot)` remains synchronous/non-reentrant and signals failure by throwing, which the controller contains. Successful mutations persist exactly once; lists/rejections do not persist. The caller notifies once after successful mutation, containing that separate phase.
- `human-command.ts`: `parseHumanTaskCommand(args: string): HumanTaskCommand` parses only add/modify/list/clear arguments (without `/task`), throwing on malformed syntax. `human-execute.ts`: `executeHumanTaskCommand(previous: TaskState, args: string): TaskOperation` returns a cloned complete candidate or no-effect error. `owner.executeHuman(args, persist)` is the preferred future command adapter because it commits once. Human result details may say action=modify/clear, but the MODEL request and tool schemas still reject both actions.
- `human-completion.ts`: `createHumanTaskCompletionProvider(current: AutocompleteProvider, readTasks: () => readonly TaskRecord[]): TaskAutocompleteProvider`. Unregistered provider, including contextual new/legacy roots, flags, values and live ID choices. It calls the reader afresh for ID suggestions AND application; no snapshot/cache or persistence. Its two lexer/context modules are implementation support, not separate registration APIs.
- `state.ts`: `parseTaskState(data)`, `restoreTaskState(branch, history, highWater?)`, `clearTaskState(state)`, `TASK_STATE_ENTRY_TYPE = "omp-task-state"`.
- `tool-definition.ts`: `createTaskToolDefinition(run)` returns an UNREGISTERED `task` definition, its flat object parameter schema, and `executionMode: "sequential"`. `run(input, context)` remains synchronous and returns a `TaskOperation` after persistence. The returned execute callback catches run/property-access failures and resolves a constant `TaskBoundaryErrorDetails` result with stateUnavailable=true; it does not assert that an earlier commit was undone. `failure.ts` exports `taskBoundaryFailure()` for this unknown-outcome error and `taskOperationFailure(state, message)` for known valid controller-state errors. Result details are the union of TaskResultDetails and TaskBoundaryErrorDetails; use `details.error`/text, not an invented native isError field.
- `admission.ts`: `taskAdmission(toolName, readTasks)` returns `undefined` or `{ block: true, reason }`; `taskAvailabilityProblem(availableNames)` returns a configuration diagnostic or undefined. Neither registers a hook or alters tool availability.
- `list.ts`: `selectTaskRows(fullTasks, type?, limit?)`, `formatTaskRows(rows)`. Rows contain a copied task, derived status and unresolved blocker IDs computed from FULL state. `TaskOperation.state` is never the filtered list.

## 1. Replace the task adapter, not the task graph algorithms

File: `tools/task.ts`, original line anchors 28–41, 56–156.

1. Replace the old `TaskParams`, `stateFromEntry`, old action imports, and switch/rollback block with imports of `createTaskSession`, `TaskSession`, `createTaskToolDefinition`, and `TASK_STATE_ENTRY_TYPE`.
2. Keep the owning WeakMap and callback purpose, but contain notification/logging faults rather than relying on logging being infallible. Store a session controller and current-branch readiness marker per actual session identity. Use the session manager plus `getSessionId()`; if a manager object is reused for a different session ID, create a new controller rather than retaining the previous session's allocation floor. Never share a controller among sessions or forks.
3. On first access and existing session_start/session_tree paths, guard the ENTIRE owner/context/history evaluation and inspect the restore result (see §1a). Set the owner's current-branch readiness false BEFORE attempting restoration, true only on ok. Retain its old records/floor on failure but do not expose them as successfully restored current-branch state. Every mutation entry (tool execute, human command) that finds an unready owner retries restoration ONCE inline: on success it proceeds normally; on failure it returns the explicit not-restored error — never a fabricated empty-state success and never a permanent wedge. Read-only summarizers (`getTaskState` for Boulder/compaction/widget) keep receiving the retained last-known snapshot; admission on an unready owner refuses non-task tools with the constant failure message; a failing completion reader yields no suggestions (`null`). Do not silently reset or reuse another session's owner. Reuse the same controller on same-session branch navigation; delete on shutdown as today.
4. Replace `reloadState` (73–84) with guarded restore followed by a separately guarded notification only on success. Do not scan all session history on each add or list. Lifecycle errors must be reported best effort without letting a failed reporter escape.
5. Keep `pi.appendEntry` as the sole persistence boundary: pass `snapshot => pi.appendEntry(TASK_STATE_ENTRY_TYPE, snapshot)` into the controller. The snapshot includes `closedOrder` automatically. Do NOT run the old fixed-field parser on the restored new state: it drops `closedOrder`. The new parser already reuses that validator for legacy fields and then preserves the new field.
6. Construct createTaskToolDefinition with a synchronous callback: acquire a ready owner, call owner.execute, then notify once only when operation.changed. Contain notification/snapshot/logging failures in a SEPARATE post-commit try and append a constant presentation warning to the already committed result; never convert that success into 'no changes applied'. Return the operation. The tool facade contains failures before an operation is available with an unknown-outcome error. Never rethrow persistence errors or restore an old nextId: the controller already returns an honest error and retains issued reservations.
7. Keep `getTaskState` returning the FULL controller snapshot summarized by the existing `summarizeTaskState` contract. Boulder/compaction/widget readers must not consume `result.details.tasks`, which is filtered for list calls. Preserve the existing counts for their existing consumers; admission independently checks status AND blockers.
8. Extend TaskToolHandle with `runHumanTaskCommand(args, context): AgentToolResult<TaskResultDetails | TaskBoundaryErrorDetails>` (future interface, not yet registered). Guard owner acquisition and owner.executeHuman in a try; return taskBoundaryFailure() on an unexpected failure before a usable operation is obtained. Notify separately only if changed, retaining the committed result with a constant warning if presentation fails; return operation.result, not a fabricated TaskOperation with empty state. The same owner/persistence boundary is used. No model modify/clear, admission call, second WeakMap or counter.

Revised approximate edit size after the approved safety obligation (including readiness marker and the one inline restore retry per entry): replace about 100 old adapter lines with about 75–105 ordinary lines, plus imports/human handle. The earlier 45–65 estimate excluded explicit restore readiness and post-commit containment and is superseded. This is a replacement, not a three-line insertion. Existing `task-actions.ts`, `task-dependencies.ts`, `task-state-entry.ts`, and task widget code can remain unchanged; the infrastructure reuses their algorithms.

### Persistence obligations and limits

Use synchronous append, serialize calls within the native task tool, and do not re-enter a controller from its persistence callback. Notify only after success. On persistence failure the controller returns changed=false plus details.error, old tasks and the higher ID floor. This is not a batch-partial success and not native-log rollback. Native session append may already have changed its in-memory entry log before disk I/O fails; the controller does not claim to undo it. Reload can therefore observe an entry from an unsuccessful native append. A process crash that loses all durable evidence of an issued ID cannot be repaired by an in-memory reservation. Fork namespaces are independent; historical already-reused IDs are not retroactively repaired.

### 1a. Required future envelopes (NOT implemented in active adapters)

Owner acquisition, context access and both history reads must be inside the enclosing tool/human/lifecycle try, not evaluated before it. Within restoration, the existing per-session owner record follows this sequence:

```ts
owner.ready = false;
try {
    const manager = context.sessionManager;
    const restored = owner.controller.restore(manager.getBranch(), manager.getEntries());
    if (!restored.ok) return restored;
    owner.ready = true;
    return { ok: true };
} catch {
    return { ok: false, error: "Task owner/history unavailable; requested branch not restored." };
}
```

This is a future adapter fragment, not an existing export or proof of the unimplemented caller. Do not register or announce a newly created empty controller as ready before this succeeds. Normal state readers must reject an unready owner; `taskAdmission` then returns its explicit refusal and completion returns no suggestions. Lifecycle callers consume the outcome and do not notify success after failure. Preserve a prior same-session controller/floor for recovery, not its claim to represent the new branch. Failure reporting uses a constant notice in its own try/catch and must not read history again.

After `owner.execute`/`executeHuman` yields a changed operation, contain `notifyChange(context, owner.snapshot())` separately. On failure append a constant warning such as `Task changes were committed, but task notification failed.` to that operation's text, then return its original changed/state/result metadata. Do not throw a presentation fault into the generic unknown-outcome tool fallback deliberately. For the human command, `appendOutput` is separately contained; a final UI notice can also fail, in which case return without another reporter attempt. These envelopes are required future integration tests, not new runtime code in this gate.

## 2. Rendering: reuse result text, do not classify a filtered subgraph

At the new `pi.registerTool` call in `tools/task.ts`, retain `renderTaskCall` if desired but omit the old `renderTaskResult` callback. The native default result renderer displays the already-computed result text, including partial application and satisfied-terminal-edge notices. No edit to `tools/task-renderers.ts` is required for this minimal integration.

Why: its existing `renderListResult` (58–81) recomputes readiness from the selected tasks, which is wrong when an omitted prerequisite is outside the explicit list view. Its mutation branch also hides every success/partial notice. The new model-facing text and `details.rows` already agree. Do not pass filtered `details.tasks` to the old classifier. A later custom styled renderer must consume `rows.status`/`rows.blockers`, never re-derive them from the visible subset. Existing widget ordering/ten-row display is a separate feature and stays unchanged.

The retained call renderer displays `task add` for a batch; detailed actual effects are in the result. Enhancing that call header is optional, not required to activate this patch.

## 3. Human add / modify / list / clear commands

- `commands/task.ts`: extend TaskCommandOptions with the safe native-result-returning runHumanTaskCommand described in §1 step8 (not the former TaskOperation-returning handle). Before existing `parseTaskCommand(args)`, recognize an exact first whitespace-delimited root in add/modify/list/clear and pass the ENTIRE original args string to this callback. Do not lowercase or split the payload: that would corrupt quoted text. All other inputs, including bare `/task`, retain the existing parser and help/show/info flow. No new registration or second command name is needed.
- In that new handler branch, render the returned text blocks through existing `appendOutput`/`TASK_INFO_ENTRY_TYPE`; tone is warning for `result.details.error`, otherwise info. Never call `formatTaskInfo` with a filtered list: use the already-computed result text. Do not send a model message or call admission. The callback's persistence error is explicit in result.details.error; never print success for it. Wrap appendOutput separately: it is another fallible native log append, not part of task-state publication. If it fails, attempt a constant UI presentation-error notice in its own catch and contain even that notice's failure. Do not rerun the command or imply the task operation was rolled back. The command output log entry is separate from the single task-state persistence.
- Extend `TASK_HELP_TEXT` with the grammar/examples below and a short quoting rule. Full contextual completion is now implemented separately; wire its factory as described in section 3a. Leave `commands/task-completion.ts` unchanged: its legacy candidate definitions are reused by the dormant provider, not extended in place.
- `extension.ts`: destructure `runHumanTaskCommand` from the task handle near 70 and pass it into `registerTaskCommand` near 93–96. Both model and command callbacks resolve the same actual-session owner.

```text
/task add "调查问题" --start
/task add "实现修改" --blocked-by 12
/task modify 13 --text "实现并测试" --blocked-by 12,14
/task modify 13 --blocked-by "" --status in_progress
/task modify 13 --status expired --reason "不再需要"
/task list
/task list --type blocked --limit 10
/task clear --CONFIRMED
```

Modify dependencies run before lifecycle transitions regardless of option order, and the complete combined operation is all-or-error. Status accepts only in_progress/done/expired; reason is required only for expired. Quoting, canonical IDs and rejected forms are specified in architecture D7. Human commands do not expose modify/clear in the model schema.

Revised estimate: approximately 35–55 added/replacement lines across the three active files, including help, imports, safe human handle and separate output containment; not applied now. The earlier 30–45 estimate is superseded by the newly approved exception boundary. Existing command/completion regressions are unchanged in this gate. After separate integration approval, add real-handler tests for the routing, output tone, help/completion and same-owner callback.

## 3a. Autocomplete wiring: four existing lines replaced, not a new command framework

Only `commands/task.ts` needs completion-specific integration, at current anchors 1, 3, 32 and 90–92:

1. Add `ExtensionContext` to the existing SDK type import (replace one line).
2. Replace the old `createTaskCompletionProvider` import with `createHumanTaskCompletionProvider` from `../tools/task-system/human-completion.js` (replace one line).
3. Change `TaskCommandOptions.getTasks(context: ExtensionCommandContext)` to `getTasks(context: ExtensionContext)` (replace one line). `session_start` supplies an ExtensionContext, not a command-only context; the existing extension callback already calls `getTaskState(context)` and needs no completion-specific change. Command contexts remain accepted.
4. Replace only the provider factory argument in the existing `session_start` handler:

```ts
(ctx.ui as typeof ctx.ui & PromptCompletionUI).addAutocompleteProvider((current) =>
    createHumanTaskCompletionProvider(current, () => options.getTasks(ctx)),
);
```

This is approximately **6 inserted lines / 4 removed lines, net +2**, with ordinary formatting; three are one-for-one line replacements and the existing one-line provider call becomes three. No change to `commands/task-completion.ts`, no new command registration, no extension-level cache, and no new wrapper merely to reduce line counts. Exact formatting can change these physical counts, not the four insertion points.

The getter reads the same actual-session task controller as command/model calls each time. Do not write `const tasks = options.getTasks(ctx)` at startup and close over that array. Native replacement/reload creates a fresh extension instance and session_start context; do not reuse the prior session's provider/context after shutdown. Reader/delegate faults are contained by the provider as no suggestions, unchanged application or false trigger; this is not an empty authoritative task state. The factory/getter call itself is unchanged, but the surrounding session_start must contain registration/context/UI failures as part of its lifecycle envelope (about 4–8 additional lines, not included in the net +2 factory delta). Completion performs no persistence and does not bypass validation: excluded self/duplicate suggestions are assistance, while cycles, expiry reasons and list-limit rules remain executor checks.

Examples: `/task mo<Tab>`, `/task modify 13 --st<Tab>`, `/task list --type cl<Tab>`, `/task modify <Tab>`, `/task modify 13 --blocked-by 12,<Tab>`. Quoted values, escapes, middle-of-token edits and following comma components/arguments are handled. Free text and numeric limits delegate to the existing provider. New roots and flags insert canonical lowercase values; old show/info/help and show on/off keep loose matching and descriptions. Actual interactive Tab handling and session lifecycle installation remain future integration tests, not an already-run TUI check.

### Whole-feature line accounting (estimates, separate from autocomplete)

- Task state/dispatch adapter (`tools/task.ts`): replace roughly 100 old lines with 70–100 implementation lines, plus imports/handle additions (section 1); includes restore readiness and post-commit containment. This cannot truthfully be called a few added lines.
- Human command routing/help/handle wiring (`commands/task.ts`, `tools/task.ts`, `extension.ts`): approximately 35–55 inserted/replacement lines beyond the old adapter, including the new handler branch and help (section 3); mostly additive, not another wholesale replacement.
- Autocomplete factory alone: 6 inserted / 4 removed lines as itemized above; another approximately 4–8 lifecycle-containment lines around registration are now required. No edits to the old completion module.
- Gate (`extension.ts`): one import plus roughly 12–22 added registration/diagnostic lines including the newly required registry/reporting envelope (old 8–15 estimate superseded), no existing listener removal.
- Profiles: add task to 12 existing tool-list lines (12 one-for-one replacements) and replace the single skip-task instruction; no new profiles.

These counts exclude tests and live-contract documentation and are not an authorization to integrate. Each item carries a real caller obligation: session ownership/persistence, human routing/output, live ID reading, admission/capability checks, or making task callable in restricted children.

## 4. Gate registration, independent of Boulder

In `extension.ts`, immediately after task registration at 70 (outside `boulder_enabled`):

- Import `taskAdmission` and register `pi.on("tool_call", (event, context) => taskAdmission(event.toolName, () => getTaskState(context).tasks))`.
- Use the exact native tool name `task`, no non-task whitelist, no terminate flag, no fallback that silently admits tools when there is no active work.
- At session start inspect both `pi.getAllTools().map(tool => tool.name)` and `pi.getActiveTools()` inside a lifecycle try. Use taskAvailabilityProblem to report excluded/inactive capability; catch registry/reporting failure separately with a constant best-effort notice. Do not reinterpret registry failure as proof of availability. Do not silently bypass hard allowlists or create a read-only exception. Correct OMP-owned profiles before enabling the gate.

Revised estimate: 1 import and roughly 12–22 registration/diagnostic lines including registry/reporting containment; the core tool_call registration is still only three lines. Other listeners, provider calls, and already-running background work are unchanged. Native refusal yields an error tool result and skips the tool body; this is an admission rule, not a sandbox or continuous cancellation.

## 5. Profile prerequisite: enable task explicitly

The current explicit `tools:` lists in these OMP-owned profiles omit task:

`adversarial-auditor.md`, `confirmation-auditor.md`, `crash-safety-auditor.md`, `cross-boundary-auditor.md`, `explore.md`, `functional-correctness-auditor.md`, `metis.md`, `multimodal-looker.md`, `oracle.md`, `resource-auditor.md`, `spec-impl-auditor.md`, `workflow-auditor.md`.

Add `task` to each explicit list before gate activation. In `agents/sisyphus-junior.md:16`, replace the instruction to skip task tracking with the same task-before-other-tools rule. Profiles without a hard list do not need a list introduced merely for this patch. External user profiles or per-launch allowlists that exclude task remain a reported configuration conflict, not authorization to expand their capabilities.

No profile has been changed in this dormant stage. Capability availability must be checked on the actual child-launch path after approval; metadata unit tests do not establish deployment.

## 6. Native scheduler and compatibility acceptance before release

The local built SDK declarations lack `ToolDefinition.executionMode`; current native AgentTool and extension source do support it. The dormant adapter's type uses actual built `ToolDefinition` plus `Pick<actual native AgentTool, "executionMode">`; no copied SDK signature. This validates metadata against source, not deployment. Independent source inspection found the workspace built tool-definition-wrapper omits executionMode and the built agent loop lacks this per-tool selection, while current source forwards/honors it (before-fix report N4). An actual host matching that built path is not eligible for gate activation. This task does not authorize package builds/repairs or a scheduling workaround; inspect the actually loaded runtime after separate approval.

After approval, test the actual registered handler and actual scheduler path with controlled tool bodies:

1. Empty session: task add/list/start are admitted; every non-task name is refused.
2. Ready alone is insufficient; blocked legacy in_progress is insufficient; an unblocked started task admits tools.
3. Mixed native batches `[task start, read]` and `[task done, write]` observe the sequential boundary and current state. If the installed runtime does not support this boundary, do not activate the hard gate there.
4. A valid dependency update demotes a running dependent; completing/removing its prerequisite yields ready, not automatic start.
5. Batch commits/notifies once, partial reports survive UI rendering, no task IDs repeat after clear/branch navigation, and two session identities/forks remain separate.
6. Filtered lists render blocked status using full-graph-derived rows; hidden tasks remain in persistence/Boulder/compact state.
7. Human add/modify/list/clear work without an active task; model clear/modify fail schema/dispatch. Combined modify persists/notifies once, failed modify preserves all old fields, quoted text survives routing, and bare help/show/info remain unchanged. Inherited legacy snapshots retain honest unknown closure ordering.
8. An OMP-loaded child has an actually callable task tool; an externally restricted child reports the configuration conflict without bypassing it.
9. Verify auth/provider/compaction behavior unchanged; no new estimates, retry policy or SDK build/dependency changes.
10. Fault-inject owner/context/history reads BEFORE restore invocation, explicit restore failure, registry reads, notification and human appendOutput/UI reporting. Verify no ordinary callback failure escapes; failed restore never marks an owner ready; post-commit presentation failure never claims rollback or causes a second state append. Verify completion registration failures are also contained by the future lifecycle handler. A forced restore failure must yield the explicit not-restored error on task/human calls, keep the gate closed for non-task tools, and a later successful inline retry must unblock the owner; persistent failure keeps reporting errors without pretending an empty task state. These caller envelopes remain unimplemented until integration approval.

These are future integration checks, not already performed live checks. Update `docs/task-list-v0.2.0.md` or add a versioned live contract only at that future integration stage. Stop at this plan until the user explicitly approves interfacing.
