# Task-system verification

Status: the task-system runtime was integrated and live-accepted on 2026-09-18. The later explicit `done.startNext` handoff passed independent Hoare reasoning, independent functional verification, and the user-triggered reload/live test on 2026-09-22. Latest full scoped run: 112/112 tests across 19 suites. See [HOARE-EXCEPTION-SAFETY.md](HOARE-EXCEPTION-SAFETY.md) for the independent handoff reasoning and prior exception-safety evidence, and [EXCEPTION-SAFETY-DELTA.md](EXCEPTION-SAFETY-DELTA.md) for the separate implementer evidence. Root checks are not claimed green; historical failures and scoped-check boundaries are recorded below.

## Delivered surface

Sixteen task-system files (including the task-specific failure module and explicit-handoff adapter): model, schema, batch, execute, start-next, state, session, list, admission, tool-definition, human-command, human-execute, human-completion-input, human-completion-context, human-completion, failure. The public request/controller boundaries clone state; existing graph and lifecycle helpers operate only on the cloned candidate. The handoff is reached only through the existing task execution path; it adds no registration, tool name, or runtime entry point.

New tests: `test/task-system-{adapter,batch,completion-exceptions,exceptions,generated,handoff,human-command,human-completion,human-session,list,state,transitions}.test.ts`; support: `task-system-fixtures.ts`, `task-system-ai-api.ts`, `task-system-source-api.ts`. New isolated configs: `tsconfig.task-system.json`, `biome.task-system.json`.

## Reproducible checks

From the repository root:

```sh
TSX_TSCONFIG_PATH=my-plugins/oh-my-pi-v2/tsconfig.task-system.json \
node --import tsx --test \
  my-plugins/oh-my-pi-v2/test/task-system-*.test.ts \
  my-plugins/oh-my-pi-v2/test/task-session-state.test.ts \
  my-plugins/oh-my-pi-v2/test/task-command.test.ts \
  my-plugins/oh-my-pi-v2/test/task-display.test.ts

node node_modules/typescript/bin/tsc \
  -p my-plugins/oh-my-pi-v2/tsconfig.task-system.json

node node_modules/@biomejs/biome/bin/biome check \
  --config-path my-plugins/oh-my-pi-v2/biome.task-system.json \
  my-plugins/oh-my-pi-v2/tools/task-system/*.ts \
  my-plugins/oh-my-pi-v2/tools/task-renderers.ts \
  my-plugins/oh-my-pi-v2/test/task-system-*.ts \
  my-plugins/oh-my-pi-v2/tsconfig.task-system.json \
  my-plugins/oh-my-pi-v2/biome.task-system.json

git diff --check -- my-plugins/oh-my-pi-v2
npm run check
```

Results:

- **112/112 tests**, 19 suites, no failures/skips/cancellations: the complete command above passed after the post-v0.2 `done.startNext` change. Strict scoped TypeScript exited 0 with zero diagnostics; scoped Biome checked 35 files with no fixes/errors; `git diff --check -- my-plugins/oh-my-pi-v2` exited 0. Root `npm run check` was intentionally not run because it begins with repository-wide `biome check --write` in the shared dirty worktree.
- **90/90 tests**, 14 suites, no failures/skips/cancellations: prior 77 plus 13 exception fault tests. Final full run after source/test formatting passed, then strict scoped TypeScript and Biome passed. Output: `.pi/task-exception-tests-270c6baa.log`. No code changed after these checks. Prior 77/61 gates remain historical at `.pi/task-completion-tests.log` and `.pi/human-task-tests.log`.
- Strict scoped TypeScript: exit 0, zero diagnostics. No emission/build artifact changes.
- Scoped Biome: 31 files, no outstanding changes/errors. Initial write-formatting was restricted to the 12 changed/new source/test files.
- Generated test: 100 deterministic sequences of 40 mixed operations (4,000 transitions), input immutability, safe monotone allocation, reciprocal edges, snapshot validity, and an independent topological DAG oracle. This is bounded direct testing, not an audit or proof of all inputs.
- Root `npm run check`: exit 2, **the same 810 existing TypeScript errors** as the saved baseline. Formatting checked 1,290 files with no fixes. Pinned dependencies, TS imports, entry graphs, shrinkwrap and install-lock checks passed. Browser smoke was not reached. Root check is NOT green.
- Diagnostic block including continuation lines compared equal against `my-plugins/impression/docs/audit/source-references-20260914/root-check-final.log`. Raw run log: `my-plugins/oh-my-pi-v2/.pi/task-system-root-check.aP9Ny1`. A normalized first-diagnostic-to-end block (trimmed and one final newline) has SHA256 `5e25a65e9e90ef835e985df0d56e3f00aed8c018d4161e1aa4384357c11f89da` in both logs.
- Parent root-check rerun: `my-plugins/oh-my-pi-v2/.pi/task-system-root-check-parent.GVAjYy`, exit 2. All 810 diagnostics and continuation lines again match the baseline exactly, with the same normalized hash above.
- Human-command root-check run: `.pi/human-task-root-check.log`, exit 2. All 810 diagnostic lines INCLUDING continuation lines again equal the saved baseline; normalized SHA256 remains `5e25a65e9e90ef835e985df0d56e3f00aed8c018d4161e1aa4384357c11f89da`. Root check is NOT green; browser smoke is not reached.
- Autocomplete root-check run: `.pi/task-completion-root.dkASHF`, exit 2. All 810 diagnostics INCLUDING continuation lines again equal the saved baseline; normalized SHA256 remains `5e25a65e9e90ef835e985df0d56e3f00aed8c018d4161e1aa4384357c11f89da`. Root check is NOT green; browser smoke is not reached.
- Exception-repair root check: `.pi/task-exception-root-270c6baa.log`, exit 2. All 810 diagnostics and continuation lines equal the same baseline, normalized SHA256 `5e25a65e9e90ef835e985df0d56e3f00aed8c018d4161e1aa4384357c11f89da`. Root remains NOT green; browser smoke was not reached.
- Protected task/command/profile/extension/compaction/config/test file hashes remain unchanged against `.pi/task-system-protected.sha256`; all 46 were checked before and after repairs. HEAD and branch remain unchanged; the source import scan finds no active registration/import of dormant modules.
- Existing staged diff remains SHA256 `98cad3272f6d05411851491e3f90e6e8045a278f70907f9f3773b315922d92e7`. No owned file was staged.

## Covered behavior

Batch forward aliases, call-local keys (including prototype-like names), first valid duplicate-key binding, unknown/skipped keys, pre-call numeric IDs, missing/blank text, wrong field types, unsafe numeric dependencies, self/duplicate/cyclic edges, deterministic cycle-edge choice, deferred starts, partial/no-effect notices, successful satisfied terminal dependencies, safe ID exhaustion, scalar shortcut rollback and input immutability.

Standalone dependency rejection, direct and reciprocal endpoint running-to-blocked transitions, affected legacy blocked-running tasks, unrelated state preservation, explicit restart after unblocking, permissive done/expire semantics, closure order independent of rewiring, and request/result-array isolation.

Post-v0.2 `done.startNext` coverage: scalar close-then-unblock/start ordering; ordered arrays with successful, still-blocked and missing targets; original `executeStart` error text in `start_skipped`; empty and duplicate natural behavior; failed done with zero successor attempts; non-done/malformed shape rejection; input immutability; omitted-field compatibility; one session persistence; public parameter schema/call rendering; and generated 4,000-transition DAG checks that include scalar and duplicate-array handoffs.

Default all-open-plus-ten-closed view, all seven explicit filters, limit handling, combined closure order, legacy unknown-order fallback, hidden-state preservation and full-graph readiness classification.

Branch versus whole-session restoration, clear preserving allocation, independent session/fork owners, exactly one batch persistence, no persistence for lists/rejections, contained persistence errors with reserved IDs and explicit native-log uncertainty, immutable snapshots, exact task admission exception, all sampled non-task names refused without active unblocked work, availability diagnostics and sequential definition metadata.

## Human extension direct coverage

All approved add/modify/list/clear examples; single/double quotes, adjacent pieces, Unicode, spaces, literal shell-looking input and documented escapes; empty dependency replacement; missing/duplicate/unknown flags, malformed quotes, canonical safe integer IDs and limits. Syntax and business rejection leave the complete state unchanged. Combined modify performs text/dependencies/lifecycle on candidates and persists once only on success; bad edges or failed starts discard all candidate changes. Text-only changes preserve graph and closure order; expiry requires reason and uses existing closure ordering. Running-to-blocked, clearing blockers and explicit restart remain intact.

All seven list types, default overview and limits match model results with full-state preservation; lists do not persist. Human/model calls share one controller; independent controllers remain independent. Clear preserves high-water; model schemas/dispatch still reject clear/modify. Persistence failures now return error operations without replacing old task records, and failed creation reserves issued IDs. No tool-admission call occurs in the human entry point.

The initial 15 human tests passed at runtime; scoped tsc found two Node `assert.throws` calls using an unsupported undefined predicate overload. They were corrected to the actual `Error` constructor predicate, then the full 61-test/type/format gate above passed. No production behavior was changed to accommodate a test. Existing configs, SDK/source seams and all prior tests remained unchanged.

## Human autocomplete direct coverage

Sixteen real-provider callback tests cover all roots and legacy descriptions/loose matching, applicable and already-used flags (including later flags), quoted/escaped flag-looking text, all status/type values, terminal IDs, numeric prefix matching, comma-neighbor preservation, self/duplicate exclusion, dynamic ID changes and stale application, independent readers and frozen state/input, contained reader faults (the old propagation expectation was explicitly superseded by the authorized exception-safety requirement), non-task/free-text delegation, native signal/force forwarding, cancellation, middle-token edits, complete/incomplete/adjacent quotes, trailing escapes, Unicode and multiline cursor coordinates. Applied complete examples are parsed by the actual `parseHumanTaskCommand`, not a duplicated grammar oracle. Grammar/config/seams remain unchanged; the one prior autocomplete fault expectation was later updated from rejection/throw to null/no-op under the authorized safety contract.

Factory/adapter contract was checked against the actual installed `@earendil-works/pi-tui` declarations and current native source. Read the complete applicable installed `docs/extensions.md`, `docs/tui.md`, TUI README and linked autocomplete example. The built interface lacks newer optional provider fields but contains the required callback signatures; the existing actual `TaskAutocompleteProvider` extension supplies the optional Tab hook. No copied SDK interface, custom loader, dependency or config change was needed. This verifies pure/provider behavior, not interactive Tab rendering, registration, session replacement, or a live host.

## Exact environment failures and narrow resolution

Initial scoped command `node node_modules/typescript/bin/tsc -p my-plugins/oh-my-pi-v2/tsconfig.task-system.json` against repository built declarations reported:

- `TS2353: ... 'executionMode' does not exist in type 'ToolDefinition<...>'`.
- Local union-narrowing errors in the first facade draft; fixed by separate discriminated start/done variants and a direct `"tasks" in request` check.

Initial unchanged-regression command (the first command above, before the source-helper path seam existed) failed loading `test/task-session-state.test.ts`:

```text
ERR_MODULE_NOT_FOUND: Cannot find package '@sinclair/typebox'
imported from .../packages/ai/dist/index.js
```

Command/display and initial new tests passed. The existing session test was not edited. Mapping only its actual needed Pi AI runtime helper (`StringEnum`) to the unchanged source helper fixed startup under the scoped config; the final unchanged regression passes there.

An attempted re-export of current native `coding-agent/src/core/extensions/types.ts` and `session-manager.ts` pulled unrelated source dependencies. The same scoped tsc command then produced missing AI exports (`ModelsRefreshResult`, `Provider`, auth/model-runtime types), TS5097 `.ts` import-resolution errors, and TUI/source dependency diagnostics. This approach was not expanded into package fixes or declarations invented for missing APIs. Its raw tool output was saved by the runner at `/var/folders/1l/l_1h2vvn60q808n3fg_x3j880000gn/T/pi-bash-90d9367448603530.log`.

Final narrow boundary:

- `task-system-source-api.ts` re-exports the actual existing **built** SDK `ExtensionContext`, `ToolCallEventResult`, `ToolDefinition`, and `SessionEntry` declarations.
- The tool definition combines that built `ToolDefinition` with `Pick<AgentTool, "executionMode">`; the scoped config resolves `AgentTool` to the actual current native `packages/agent/src/types.ts`. No SDK field/signature is copied or invented.
- `task-system-ai-api.ts` re-exports the actual published AI type surface and locally mirrors only the current source-agent `JsonValue` and branded `TranscriptContext` definitions. This avoids an unused source provider type traversal that currently fails at `packages/ai/src/api/google-shared.ts` because installed `FinishReason` lacks `TOO_MANY_TOOL_CALLS`; no runtime shim, provider behavior, dependency, or root configuration changes are introduced. `allowImportingTsExtensions` remains enabled only in this noEmit scoped config for the other native source seams.
- A test now checks absence of the `terminate` property structurally, rather than assuming the older built result declaration includes it.
- One state test fixture was corrected for the existing parser's explicit `expireReason: undefined` normalization. Parser behavior was not changed to satisfy the test.

This is a mixed existing-built/native-source type boundary and a source-scoped regression environment, **not** a claim that repository built aggregates, arbitrary installed SDK versions, provider startup, or a deployed scheduler were verified. The later live test below covers intra-request handoff ordering, not the host's scheduling of mixed tool calls under `executionMode: "sequential"`. No custom loader, dependency change, root config modification, package repair or build was used.

## Exception-repair direct evidence

The 13 added fault tests cover synchronous delegate throws and asynchronous rejection, editor-array mutation before a throw, reader and selection faults, and the actual built Editor.startAutocompleteRequest queue on an isolated receiver (no terminal): first request resolves null, second reaches the provider; two requests/two provider calls. Prior code's independently observed queue poison was two rejections/one provider call.

Task faults cover a simulated native append-before-failure, old records/ID-floor retention, no retry, error result isolation, direct clear outcome, model/human transformation failure before persistence, a rich formatter failure that is not retried by recovery, unsafe thrown-value stringification, typed restore failure retaining state/floor, explicit reader/classifier admission refusal, and an outer tool callback that commits then throws. The latter reports unknown state/persistence, not rollback; no unsupported native isError field is returned.

Four existing test cases intentionally changed their expected propagation contract: adapter persistence rejection, state/session persistence throw, human-session persistence throw, and autocomplete reader rejection/throw. All original state/floor/publication/isolation assertions remain or are strengthened; these were superseded expectations, not deleted fault coverage. A native result union requires an explicit `tasks in details` narrowing in the adapter success test.

The first 13 new runtime tests passed; scoped tsc then found only an implicitly inferred any[] for the editor probe's collected native results. It was explicitly typed from Awaited<ReturnType<TaskAutocompleteProvider["getSuggestions"]>>; the final full gate above passed. No source fix, SDK seam or config change was used for this test type correction.

The 87-body final AST inventory (plus the referenced Boolean predicate) and per-changed/new-function exceptional-flow derivations are in EXCEPTION-SAFETY-DELTA.md. These are implementer reasoning and direct regression evidence, NOT an independent post-fix audit or machine proof. Internal parsers/transforms may still throw under their established caller contracts; the implemented containment is in the coherent session/tool/gate/provider boundaries.

## Assumptions and remaining boundaries

Low-level state transforms require a valid graph/allocation state produced by restoration or the request executor, not forged/corrupt internal objects. State owners must be unique per actual session identity; persistence must be synchronous and non-reentrant. The controller cannot undo native session-log mutations or guarantee durable ID evidence across failed I/O plus process loss. Legacy closure order is honestly unknown. No global/distributed task registry, already-running tool cancellation, filesystem sandbox or retrospective ID repair is promised.

The pre-integration results above are historical infrastructure evidence, not proof of runtime activation. The approved wiring is recorded in [integration-plan.md](integration-plan.md). The post-v0.2 handoff now has direct automated evidence, an independent Hoare assessment, independent functional verification, and the bounded reload/live evidence below; no broader host-scheduling guarantee is inferred from these results.

## Independent final verification — done.startNext

This section is an independent code/test verification. Its specification source was only `principles.md`, `architecture.md`, and `integration-plan.md`; it did not read or rely on `HOARE-EXCEPTION-SAFETY.md` or any worker report.

Commands run from the repository root:

- `TSX_TSCONFIG_PATH=my-plugins/oh-my-pi-v2/tsconfig.task-system.json node --import tsx --input-type=module` — direct assertion probe passed. It independently checked scalar and ordered-array handoffs, empty/duplicate natural behavior, skipped-start collection order and text/details, failed `done` with zero starts, malformed/non-`done` shape rejection, request/state immutability, one session persistence call, and standalone `start` success behavior.
- `TSX_TSCONFIG_PATH=my-plugins/oh-my-pi-v2/tsconfig.task-system.json node --import tsx --test my-plugins/oh-my-pi-v2/test/task-system-handoff.test.ts` — 7/7 pass, 1 suite, no fail/cancel/skip/todo.
- `TSX_TSCONFIG_PATH=my-plugins/oh-my-pi-v2/tsconfig.task-system.json node --import tsx --test my-plugins/oh-my-pi-v2/test/task-system-*.test.ts my-plugins/oh-my-pi-v2/test/task-session-state.test.ts my-plugins/oh-my-pi-v2/test/task-command.test.ts my-plugins/oh-my-pi-v2/test/task-display.test.ts` — 112/112 pass, 19 suites, no fail/cancel/skip/todo.
- `node node_modules/typescript/bin/tsc -p my-plugins/oh-my-pi-v2/tsconfig.task-system.json` — exit 0, no diagnostics.
- `node node_modules/@biomejs/biome/bin/biome check --config-path my-plugins/oh-my-pi-v2/biome.task-system.json my-plugins/oh-my-pi-v2/tools/task-system/*.ts my-plugins/oh-my-pi-v2/tools/task-renderers.ts my-plugins/oh-my-pi-v2/test/task-system-*.ts my-plugins/oh-my-pi-v2/tsconfig.task-system.json my-plugins/oh-my-pi-v2/biome.task-system.json` — 35 files checked, no fixes/errors.
- `git diff --check -- <task paths>` and separate `git diff --no-index --check /dev/null` checks for untracked `start-next.ts` and `task-system-handoff.test.ts` — clean.
- Effective source LOC: `model.ts` 79, `schema.ts` 110, `execute.ts` 196, `start-next.ts` 25, `tool-definition.ts` 99, `task-renderers.ts` 92; all are at or below 200.
- `git diff --cached --name-only -- <task paths>` — no output: no task-path file is staged. This is intentionally not a claim that the shared repository has no staged files.

Manual spec-to-code reconciliation: `done.startNext` is scalar or ordered array only in the exact `done` request union; `execute.ts` closes/orders first and delegates every successor to `executeStartNext`, which calls existing `executeStart` in order without duplicate validation. `start_skipped` preserves each existing start error; `finish` exposes skipped handoffs as partial without top-level error; `TaskSession` receives one changed operation and therefore makes one persistence call. No unnamed ready task is selected and standalone `start` remains on its existing branch. The scoped compiler seam change is type-only and has no runtime consumer in task-system source.

Boundary: root `npm run check` was deliberately not run because its first command is repository-wide `biome check --write --error-on-warnings .` and the shared working tree is dirty. The independently requested Hoare conclusion remains outside this verifier's evidence by instruction.

## Reload/live handoff verification — 2026-09-22

After the user confirmed `/reload`, the parent session exercised the actual registered `task` tool, not an imported test executor. Evidence is the tool-call/result sequence in session `01a0c6c7-f773-76b5-ad9e-6db287665f2d`. The implementation was subsequently committed and pushed as `f3f7f3522`.

Scalar handoff: task #15 was created with `blockedBy: [14]`. Calling `{"action":"done","id":14,"startNext":15}` returned:

```text
#14 done
#15 started
```

Ordered-array handoff: #16 was an unresolved blocker, #17 depended on #15, and #18 depended on #16. Calling `{"action":"done","id":15,"startNext":[17,18,999999]}` returned:

```text
Partially applied:
#15 done
#17 started
#18 not started: task #18 is blocked by: #16
#999999 not started: task #999999 not found
```

The following `{"action":"list","type":"open"}` showed #17 in progress, #16 ready, and #18 blocked by #16, consistent with the reported effects. Cleanup expired #18 and #16 with reason `live startNext test cleanup`, then completed #17. A final open-list call returned `No tasks` at that point; no test task remained open.

Result: the reloaded host accepted scalar and array inputs, closed the current task before starting its newly unblocked successor, and retained successful effects while reporting blocked and missing targets in input order. This live sequence does not independently establish the number of persistence appends, crash recovery, or mixed-tool scheduling; single-persistence evidence comes from the automated controller tests.

Current scope remains the shipped `task` API, including explicit `done.startNext`. The proposed unified mutation batch was deferred; no whole-list replacement interface or further batch lifecycle extension was implemented.
