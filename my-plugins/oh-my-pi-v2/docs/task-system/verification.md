# Dormant infrastructure verification

Status: INTEGRATED and live-accepted (2026-09-18): user-approved runtime wiring is active with the no-task gate, batched adds, human /task commands, contextual completion, clear --CONFIRMED and text-matched ID completion. Latest full run: 105/105 tests across 18 suites. See [HOARE-EXCEPTION-SAFETY.md](HOARE-EXCEPTION-SAFETY.md) and the separate implementer [EXCEPTION-SAFETY-DELTA.md](EXCEPTION-SAFETY-DELTA.md) for the exception-safety evidence. Root check remains the pre-existing 810-error baseline.

## Delivered surface

Fifteen dormant files under `tools/task-system/` (including the new task-specific failure module): model, schema, batch, execute, state, session, list, admission, tool-definition, human-command, human-execute, human-completion-input, human-completion-context, human-completion, failure. The public request/controller boundaries clone state; existing graph and lifecycle helpers operate only on the cloned candidate. No new production import reaches these modules.

New tests: `test/task-system-{adapter,batch,completion-exceptions,exceptions,generated,human-command,human-completion,human-session,list,state,transitions}.test.ts`; support: `task-system-fixtures.ts`, `task-system-ai-api.ts`, `task-system-source-api.ts`. New isolated configs: `tsconfig.task-system.json`, `biome.task-system.json`.

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
  my-plugins/oh-my-pi-v2/test/task-system-*.ts \
  my-plugins/oh-my-pi-v2/tsconfig.task-system.json \
  my-plugins/oh-my-pi-v2/biome.task-system.json

git diff --check -- my-plugins/oh-my-pi-v2
npm run check
```

Results:

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
- `task-system-ai-api.ts` supplies actual source AI types and source `StringEnum`/`contentText` helpers; telemetry resolves to its actual source. `allowImportingTsExtensions` is enabled only in this new noEmit scoped config for those native source imports.
- A test now checks absence of the `terminate` property structurally, rather than assuming the older built result declaration includes it.
- One state test fixture was corrected for the existing parser's explicit `expireReason: undefined` normalization. Parser behavior was not changed to satisfy the test.

This is a mixed existing-built/native-source type boundary and a source-scoped regression environment, **not** a claim that repository built aggregates, arbitrary installed SDK versions, provider startup, or a deployed scheduler were verified. Sequential metadata must be tested on the actual loaded runtime before future activation. No custom loader, dependency change, root config modification, package repair or build was used.

## Exception-repair direct evidence

The 13 added fault tests cover synchronous delegate throws and asynchronous rejection, editor-array mutation before a throw, reader and selection faults, and the actual built Editor.startAutocompleteRequest queue on an isolated receiver (no terminal): first request resolves null, second reaches the provider; two requests/two provider calls. Prior code's independently observed queue poison was two rejections/one provider call.

Task faults cover a simulated native append-before-failure, old records/ID-floor retention, no retry, error result isolation, direct clear outcome, model/human transformation failure before persistence, a rich formatter failure that is not retried by recovery, unsafe thrown-value stringification, typed restore failure retaining state/floor, explicit reader/classifier admission refusal, and an outer tool callback that commits then throws. The latter reports unknown state/persistence, not rollback; no unsupported native isError field is returned.

Four existing test cases intentionally changed their expected propagation contract: adapter persistence rejection, state/session persistence throw, human-session persistence throw, and autocomplete reader rejection/throw. All original state/floor/publication/isolation assertions remain or are strengthened; these were superseded expectations, not deleted fault coverage. A native result union requires an explicit `tasks in details` narrowing in the adapter success test.

The first 13 new runtime tests passed; scoped tsc then found only an implicitly inferred any[] for the editor probe's collected native results. It was explicitly typed from Awaited<ReturnType<TaskAutocompleteProvider["getSuggestions"]>>; the final full gate above passed. No source fix, SDK seam or config change was used for this test type correction.

The 87-body final AST inventory (plus the referenced Boolean predicate) and per-changed/new-function exceptional-flow derivations are in EXCEPTION-SAFETY-DELTA.md. These are implementer reasoning and direct regression evidence, NOT an independent post-fix audit or machine proof. Internal parsers/transforms may still throw under their established caller contracts; the implemented containment is in the coherent session/tool/gate/provider boundaries.

## Assumptions and remaining boundaries

Low-level state transforms require a valid graph/allocation state produced by restoration or the request executor, not forged/corrupt internal objects. State owners must be unique per actual session identity; persistence must be synchronous and non-reentrant. The controller cannot undo native session-log mutations or guarantee durable ID evidence across failed I/O plus process loss. Legacy closure order is honestly unknown. No global/distributed task registry, already-running tool cancellation, filesystem sandbox or retrospective ID repair is promised.

The old runtime still exposes its old clear/list/action behavior: these tests do not activate the new behavior. The separately approved future wiring must follow [integration-plan.md](integration-plan.md), including native scheduling, child allowlists and rendering checks.
