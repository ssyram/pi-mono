# Exception-safety repair delta — implementer reasoning, NOT a second audit

Status: approved dormant repairs implemented and directly tested. Runtime registration/integration remains NOT authorized. The independent original analysis is archived unchanged (apart from an explicit archive banner) in [HOARE-EXCEPTION-SAFETY.md](HOARE-EXCEPTION-SAFETY.md). It describes the BEFORE-FIX 85 bodies. This document supplies the implementation delta and final 87-body inventory, not an independent post-fix endorsement or machine proof.

## Disposition selected by the parent

- C1 accepted: contain all three completion callback boundaries, including awaited delegated rejection. Preserve caller editor arrays by giving delegates a separate working copy; on failure return null/no-op/false without a second reader/delegate/report attempt.
- M1 accepted: return honest session mutation errors, typed restore outcomes, and a constant unknown-outcome result from an exceptional outer tool callback. Keep the synchronous run/persist contract; no native isError property is invented.
- M2 accepted: exact task exemption remains first; reader/classifier failure produces explicit refusal.
- Stale integration propagation instructions replaced. O1 owner/history evaluation and O3 post-commit notification/output remain FUTURE caller obligations, with guarded recipes and revised estimates in integration-plan.md.
- Do not infer that ordinary session/tool Errors already crash Pi or gate Errors cause fail-open: the independent native trace showed catches. C1 additionally has an actual editor-chain availability counterexample.
- N4 built executionMode forwarding remains a deployment prerequisite; no SDK build/repair or scheduling workaround. No new audit round.

## Shared Requires and evidence

Retain the independent report's V(S): valid detached ordinary task records/arrays, complete graph, safe allocation/closure metadata, actual-session ownership. The controller constructor receives V(S), normally its default empty state or validated restoration; it is not an arbitrary unknown-object ingestion boundary. Basic copying/allocation must work; an engine/allocation/process catastrophe cannot reliably allocate even an error result. Synchronous persist/run must return or throw and must not re-enter the controller. No new asynchronous persistence/run API is supported. Native editor lines are ordinary string arrays and cursor coordinates; delegates may throw/reject or mutate their passed working arrays, but these callbacks are not a sandbox against unrelated global/captured-state mutation.

Ordinary task readers, persist callbacks and supported completion delegates may fail. Recovery never reads the caught value's message/toString, never reuses rich taskRow/formatTaskRows and never calls the failed dependency again. It may clone the controller's still-valid private state under V(S); that clone does not invoke a reader or rich formatter. Snapshot/initialization and low-level pure helpers retain their explicit contracts; not every exported function is a harness callback.

Direct evidence: `test/task-system-exceptions.test.ts` (8 cases), `test/task-system-completion-exceptions.test.ts` (5 cases), four updated prior fault expectations, full 90-test suite including 4,000 generated transitions, scoped strict types/Biome. Fault injection of Date.now/String.trim/exceptional getters tests recovery exits; it is not a claim those primitives naturally throw under every ordinary request. The actual built Editor queue method is exercised on an isolated receiver, not a live terminal. See verification.md for commands, logs and limits.

## Per-changed/new-function derivations

### D1 — failure.ts / taskBoundaryFailure (new)

Requires: enough resources to construct fixed strings/objects. No task state or thrown value is accepted. Sequence NSP: create constant diagnostic explicitly saying state/persistence outcome unavailable; create one text block and error details containing action=error and stateUnavailable=true. Ensures a native-shaped error value, no fabricated tasks/nextId/rollback assertion, no callback or state mutation. This is the outer tool and future human-owner failure result, not a known-state snapshot. No loops or normal fallible dependency calls. Regression: outer run commits then throws an unstringifiable value; result preserves uncertainty and lacks an invented isError field.

### D2 — failure.ts / taskOperationFailure (new)

Requires: V(previous) belonging to the controller and a locally supplied constant diagnostic string. Clone previous via the independently derived cloneTaskState; after clone, state/tasks/edge arrays are detached, same records/floor. Construct changed=false, error action/text, full known copied tasks and nextId, empty rows/outcomes and partial=false. Ensures no candidate publication, no graph reclassification/formatter retry and no false batch-partial success. Rows are intentionally absent on this error view, not a normal list selection. The only implicit iteration is cloneTaskState's existing proved finite map; no new loop. Recovery cannot overcome allocation failure or a corrupted private V(S), neither of which is concealed as a successful empty state. Regression: failed rich formatter called exactly once, persistence argument/result mutation isolation, error snapshot/floor checks.

### D3 — session.ts / createTaskSession (changed factory body)

Requires: V(initial), distinct owner for each actual session identity. Initial clone still establishes private V(state). Returned operations now compose the containing helpers below. No registration, reporting or persistence occurs during construction. Snapshot remains a plain detached read. Initial cloning is not wrapped in a fake empty-state fallback; future owner construction is inside the O1 caller envelope. Ensures one private owner, no cross-session allocator/cache. Regression: unchanged session/fork/isolation tests and all generated transitions remain passing.

### D4 — session.ts / publish (replaces commit)

Requires: V(state), a completed disposable TaskOperation from a validated local transform, synchronous non-reentrant persist. Branch changed=false returns the same operation, no append or floor update. Changed=true first reserves max(old floor,candidate floor) while retaining old records. Within try, clone candidate into installed and clone installed for the persist argument. NSP before callback: old private records plus reserved H, two detached copies. Call persist exactly once. If it returns, assign installed to private state and return the original successful operation; there is no post-persist formatting or cloning that could ordinarily fail before installation. If it throws, assignment was not reached: old records/reserved H remain; taskOperationFailure reports native-log/disk uncertainty. No native rollback or retry is performed. Ensures either one successful publication or honest failure with no record publication; external append may already be observable. No loop. Regression: append-before-error, mutated persistence argument, isolated failure result, next ID skipping, human combined mutation and clear faults. Sequence trace (not loop proof): failed add reserves2/keeps no tasks; successful next add assigns2/reserves3; clear retains3.

### D5 — session.ts / executeHuman (was a returned method; now a local function)

Requires: V(private state), human command string and supported persist. Try produces the full human candidate operation before publication. Parser/business errors remain ordinary no-effect operations. Unexpected transform/formatting E jumps to taskOperationFailure with unchanged private state and explicit before-persistence wording. Normal branch calls publish; its failure is already a value, not thrown. Ensures scalar/combined human atomicity, one append only for a successful changed operation, and contained supported faults. No loop. Regression: Date.now fault after candidate text edit, human persistence faults retaining original records, all prior human grammar/state tests.

### D6 — session.ts / returned restore

Requires: already-evaluated finite history arrays and valid private owner/floor. In try, evaluate restoreTaskState completely before assignment. Success assigns requested branch tasks/folded floor then returns ok=true. E skips assignment and returns ok=false with constant requested-branch-not-restored text, old records/H unchanged. Invalid ordinary historical snapshots still use the accepted latest-valid semantics; they are not reclassified as exceptions. Ensures explicit result, not automatic caller readiness. Cannot catch a context/history getter that throws BEFORE entry: O1 is still future wiring, not claimed fixed by this helper. No new loops; the unchanged restoration loops remain independently covered. Regression: exceptional history data getter after a failed ID reservation, old state/floor retained; subsequent valid restore returns ok=true and preserves H.

### D7 — session.ts / returned execute

Requires: V(private state), unknown request, supported persist. Try evaluates complete pure model transform. On E, no controller records/floor were changed, return known-state error without reusing the failed formatter/stringifier. On success pass operation to publish; unchanged business rejection/list does not append. Ensures normal batch best effort/scalar atomicity is unchanged and ordinary transform/persistence failure is contained. No new loop. Regressions: Date.now fault, exceptional unknown action getter/unstringifiable thrown value, rich formatter fault, adapter persistence error, 4,000 generated transitions.

### D8 — session.ts / returned clear

Requires supported synchronous persist and valid controller. Delegates exactly once to executeHuman("clear", persist); now returns TaskOperation rather than TaskState. All paths inherit D5/D4; success has empty task records with the same floor; failure returns old records/floor and explicit error. This is still human/internal-only, absent from model schema. No loop. Direct clear success/failure test and unchanged clear/branch ID tests cover both branches.

### D9 — admission.ts / taskAdmission

Requires tool name plus potentially failing actual-session reader. Exact task branch returns undefined before any read. Non-task try reads once and uses the existing existential classifier against the full array. A successful witness admits; no witness falls through to the existing no-active-task refusal. Any read/classification E returns block=true with a constant independent diagnostic. Ensures neither throw nor fail-open on the accepted ordinary fault paths. The existing some callback remains pure under valid data; its exceptions are now contained by this enclosing try. Prefix invariant and three-task trace remain independent §10.2; no new iteration. Regression: task exemption calls reader zero times; non-task fault exactly once; classifier getter fault also blocks.

### D10 — tool-definition.ts / createTaskToolDefinition

Requires synchronous run returning TaskOperation on normal completion, possibly throwing during owner lookup, operation or presentation. Metadata/schema remain unchanged; returned details type now explicitly permits TaskBoundaryErrorDetails. Factory still only creates unregistered data/callback. Its conditional execution guarantee is D11, not runtime scheduler proof. No loop. Success/metadata/schema regression remains; no model clear/modify/error action was added.

### D11 — tool-definition.ts / returned async execute

Try calls supported synchronous run and reads result. Normal returns its native-shaped result. Sync E in run/result access returns taskBoundaryFailure; async method therefore resolves the constant error value rather than rejecting. No awaitable run/persist contract is invented. A run may already have committed before E, so generic fallback deliberately does not claim no changes or return a guessed state. No loop/callback retry. Regression: actual callback commits then throws poison, task remains committed, one write, error details mark state unavailable, no unsupported isError. Native task execution previously caught such Errors too; this closes the local plugin contract, not evidence of a prior harness crash.

### D12 — human-completion.ts / createHumanTaskCompletionProvider

Requires actual current provider, same-session reader and native editor inputs. Still no eager read/cache/registration. Returns the three containing methods D13–D15; accepted matching/choice/lexer helpers remain unchanged. Resource and callback contracts above are necessary; construction is not a live TUI integration check.

### D13 — returned getSuggestions

Try parses input/context. Unowned branch calls delegate once with a COPY of lines and original cursor/options, then **awaits inside try**. Thus synchronous throw and rejected promise both enter catch; asynchronous delegate line mutation cannot affect caller array. Owned aborted branch returns null without read; otherwise existing choices reads only when required and returns suggestions/nonempty or null. Any ordinary E returns null without retry/stringification. Ensures promise fulfillment with correct normal suggestions or no completion; no claim of authoritative empty task state. Existing helper loop invariants unchanged. Regressions: sync/async faults, mutation before rejection, signal/force forwarding and all 16 original cases. Actual built editor queue after first failed delegate now sees a fulfilled null task and runs the second provider: 2 requests/2 calls, compared to independent before-fix 2 rejections/1 call.

### D14 — returned applyCompletion

Requires native ordinary lines/cursor. First take detached unchanged lines/cursor (allocation assumption explicit). Within try, parse/context; unowned branch delegates with ANOTHER independent working copy, not the original nor the retained fallback. Normal delegation is honored. Owned branch recomputes current choices, checks prefix/membership, then inserts verified canonical choice; stale branch returns unchanged. Any E in read/context/choice/insertion/delegation returns the saved unchanged object, without touching failed dependency. Ensures caller array unmodified even if delegate mutates its working copy before throw; on failure returned content/cursor are pre-call values. The existing membership predicate is unchanged, its E now contained. Regressions: reader/selection property faults, splice-then-throw delegate, frozen inputs, stale IDs/prefixes and quote/comma/multiline cases. Snapshotting does not prevent a malicious callback mutating unrelated captured globals; no sandbox claim.

### D15 — returned shouldTriggerFileCompletion

Try parses/context; owned slot still returns true without a reader. Otherwise invoke optional synchronous delegate once with copied lines, preserving its normal boolean/nullish-default behavior. Ordinary E returns false. Ensures no trigger on failure, no editor-array corruption from a throwing delegate, no retry. No async trigger contract or artificial completion policy added. Regression: mutate-then-throw trigger, old owned/unowned trigger behavior.

### Type-only and unchanged-body effects

model.ts adds "error" only to RESULT action metadata; request/schema remains unchanged. Its clone functions retain independent §1. The module failure.ts is the only new source. Nine unchanged source files still match their initial full-file hashes. Unchanged graph/parser/list/restore/lexer/context and predicate logic retains the independent normal/exception derivations and loop traces under the same Requires; formatting/line shifts inside edited factories are not claimed as byte-identical function bodies. The unchanged callback predicates inside edited factories are explicitly included below. Internal throws are not erased: their containing session/tool/provider exit is now established where required. The callback-independent taskAvailabilityProblem remains a pure helper requiring actual name arrays; future registry access/reporting is inside the O1/O3 lifecycle envelope.

## Final function inventory

Generated from TypeScript AST after final source formatting: **87 bodies in 15 files**, plus the explicitly referenced built-in Boolean filter in human-completion/choices. Types/signatures and data-only TypeBox construction are not function bodies. Each final body below has either a delta derivation D1–D15 or an unchanged derivation in the indicated section of the archived independent analysis. The original inventory is not mislabeled as a new independent review.

| # | File | Final body (line) | Derivation |
|---:|---|---|---|
| 1 | `admission.ts` | `taskAdmission` (5) | D9 |
| 2 | `admission.ts` | `taskAdmission/callback@14` (14) | Before §10 (unchanged body) |
| 3 | `admission.ts` | `taskAvailabilityProblem` (33) | Before §10 (unchanged body) |
| 4 | `batch.ts` | `terminalEdgeNotice` (4) | Before §4 (unchanged body) |
| 5 | `batch.ts` | `terminalEdgeNotice/callback@9` (9) | Before §4 (unchanged body) |
| 6 | `batch.ts` | `createTaskBatch` (13) | Before §4 (unchanged body) |
| 7 | `batch.ts` | `createTaskBatch/callback@18` (18) | Before §4 (unchanged body) |
| 8 | `batch.ts` | `createTaskBatch/callback@67` (67) | Before §4 (unchanged body) |
| 9 | `execute.ts` | `finish` (18) | Before §5 (unchanged body) |
| 10 | `execute.ts` | `finish/callback@27` (27) | Before §5 (unchanged body) |
| 11 | `execute.ts` | `finish/callback@29` (29) | Before §5 (unchanged body) |
| 12 | `execute.ts` | `finish/callback@38` (38) | Before §5 (unchanged body) |
| 13 | `execute.ts` | `finish/callback@46` (46) | Before §5 (unchanged body) |
| 14 | `execute.ts` | `executeTaskRequest` (56) | Before §5 (unchanged body) |
| 15 | `execute.ts` | `executeTaskRequest/callback@89` (89) | Before §5 (unchanged body) |
| 16 | `execute.ts` | `executeTaskRequest/callback@150` (150) | Before §5 (unchanged body) |
| 17 | `execute.ts` | `executeTaskRequest/callback@172` (172) | Before §5 (unchanged body) |
| 18 | `execute.ts` | `executeTaskRequest/callback@184` (184) | Before §5 (unchanged body) |
| 19 | `failure.ts` | `taskBoundaryFailure` (11) | D1 |
| 20 | `failure.ts` | `taskOperationFailure` (20) | D2 |
| 21 | `human-command.ts` | `tokenize` (19) | Before §6 (unchanged body) |
| 22 | `human-command.ts` | `number` (50) | Before §6 (unchanged body) |
| 23 | `human-command.ts` | `text` (57) | Before §6 (unchanged body) |
| 24 | `human-command.ts` | `parseHumanTaskCommand` (61) | Before §6 (unchanged body) |
| 25 | `human-command.ts` | `parseHumanTaskCommand/callback@102` (102) | Before §6 (unchanged body) |
| 26 | `human-completion-context.ts` | `legacySlot` (20) | Before §13 (unchanged body) |
| 27 | `human-completion-context.ts` | `legacySlot/callback@25` (25) | Before §13 (unchanged body) |
| 28 | `human-completion-context.ts` | `legacySlot/callback@27` (27) | Before §13 (unchanged body) |
| 29 | `human-completion-context.ts` | `valueSlot` (32) | Before §13 (unchanged body) |
| 30 | `human-completion-context.ts` | `taskCompletionSlot` (61) | Before §13 (unchanged body) |
| 31 | `human-completion-context.ts` | `taskCompletionSlot/callback@99` (99) | Before §13 (unchanged body) |
| 32 | `human-completion-input.ts` | `tokens` (10) | Before §12 (unchanged body) |
| 33 | `human-completion-input.ts` | `taskCompletionInput` (65) | Before §12 (unchanged body) |
| 34 | `human-completion-input.ts` | `taskCompletionInput/callback@80` (80) | Before §12 (unchanged body) |
| 35 | `human-completion-input.ts` | `taskCompletionInput/callback@85` (85) | Before §12 (unchanged body) |
| 36 | `human-completion-input.ts` | `taskCompletionInput/callback@88` (88) | Before §12 (unchanged body) |
| 37 | `human-completion-input.ts` | `taskCompletionInput/callback@99` (99) | Before §12 (unchanged body) |
| 38 | `human-completion-input.ts` | `insertTaskCompletion` (105) | Before §12 (unchanged body) |
| 39 | `human-completion.ts` | `looseMatch` (17) | Before §14 (unchanged body) |
| 40 | `human-completion.ts` | `choices` (27) | Before §14 (unchanged body) |
| 41 | `human-completion.ts` | `choices/callback@35` (35) | Before §14 (unchanged body) |
| 42 | `human-completion.ts` | `choices/callback@38` (38) | Before §14 (unchanged body) |
| 43 | `human-completion.ts` | `choices/callback@39` (39) | Before §14 (unchanged body) |
| 44 | `human-completion.ts` | `choices/callback@59` (59) | Before §14 (unchanged body) |
| 45 | `human-completion.ts` | `choices/callback@64` (64) | Before §14 (unchanged body) |
| 46 | `human-completion.ts` | `createHumanTaskCompletionProvider` (71) | D12 |
| 47 | `human-completion.ts` | `createHumanTaskCompletionProvider/getSuggestions` (76) | D13 |
| 48 | `human-completion.ts` | `createHumanTaskCompletionProvider/applyCompletion` (94) | D14 |
| 49 | `human-completion.ts` | `createHumanTaskCompletionProvider/applyCompletion/callback@110` (110) | Before §14 (unchanged body) |
| 50 | `human-completion.ts` | `createHumanTaskCompletionProvider/shouldTriggerFileCompletion` (118) | D15 |
| 51 | `human-execute.ts` | `finish` (15) | Before §7 (unchanged body) |
| 52 | `human-execute.ts` | `finish/callback@22` (22) | Before §7 (unchanged body) |
| 53 | `human-execute.ts` | `finish/callback@35` (35) | Before §7 (unchanged body) |
| 54 | `human-execute.ts` | `executeHumanTaskCommand` (45) | Before §7 (unchanged body) |
| 55 | `human-execute.ts` | `executeHumanTaskCommand/callback@69` (69) | Before §7 (unchanged body) |
| 56 | `list.ts` | `taskRow` (4) | Before §3 (unchanged body) |
| 57 | `list.ts` | `taskRow/callback@5` (5) | Before §3 (unchanged body) |
| 58 | `list.ts` | `taskRow/callback@5/callback@6` (6) | Before §3 (unchanged body) |
| 59 | `list.ts` | `closed` (24) | Before §3 (unchanged body) |
| 60 | `list.ts` | `closedOrder` (27) | Before §3 (unchanged body) |
| 61 | `list.ts` | `selectTaskRows` (32) | Before §3 (unchanged body) |
| 62 | `list.ts` | `selectTaskRows/callback@45` (45) | Before §3 (unchanged body) |
| 63 | `list.ts` | `selectTaskRows/callback@54` (54) | Before §3 (unchanged body) |
| 64 | `list.ts` | `selectTaskRows/callback@56` (56) | Before §3 (unchanged body) |
| 65 | `list.ts` | `selectTaskRows/callback@60` (60) | Before §3 (unchanged body) |
| 66 | `list.ts` | `selectTaskRows/callback@61` (61) | Before §3 (unchanged body) |
| 67 | `list.ts` | `selectTaskRows/callback@68` (68) | Before §3 (unchanged body) |
| 68 | `list.ts` | `formatTaskRows` (71) | Before §3 (unchanged body) |
| 69 | `list.ts` | `formatTaskRows/callback@74` (74) | Before §3 (unchanged body) |
| 70 | `list.ts` | `formatTaskRows/callback@74/callback@76` (76) | Before §3 (unchanged body) |
| 71 | `model.ts` | `cloneTaskState` (71) | Before §1 (unchanged body) |
| 72 | `model.ts` | `cloneTaskState/callback@74` (74) | Before §1 (unchanged body) |
| 73 | `schema.ts` | `callback@17` (17) | Before §2 (unchanged body) |
| 74 | `schema.ts` | `parseTaskRequest` (79) | Before §2 (unchanged body) |
| 75 | `session.ts` | `createTaskSession` (10) | D3 |
| 76 | `session.ts` | `createTaskSession/publish` (14) | D4 |
| 77 | `session.ts` | `createTaskSession/executeHuman` (33) | D5 |
| 78 | `session.ts` | `createTaskSession/snapshot` (49) | Before §9 (unchanged body) |
| 79 | `session.ts` | `createTaskSession/restore` (50) | D6 |
| 80 | `session.ts` | `createTaskSession/execute` (65) | D7 |
| 81 | `session.ts` | `createTaskSession/clear` (81) | D8 |
| 82 | `state.ts` | `parseTaskState` (6) | Before §8 (unchanged body) |
| 83 | `state.ts` | `parseTaskState/callback@22` (22) | Before §8 (unchanged body) |
| 84 | `state.ts` | `restoreTaskState` (40) | Before §8 (unchanged body) |
| 85 | `state.ts` | `clearTaskState` (63) | Before §8 (unchanged body) |
| 86 | `tool-definition.ts` | `createTaskToolDefinition` (40) | D10 |
| 87 | `tool-definition.ts` | `createTaskToolDefinition/execute` (54) | D11 |

The built-in `Boolean` predicate in choices still removes empty comma components (before §14.B); it has no local AST body. No new loops were introduced. Existing per-loop initialization/maintenance/termination and representative k=3 traces remain in the archived analysis. The human combined-operation loop has at most two iterations, as explicitly recorded there.

### Final source fingerprints

| File | SHA256 |
|---|---|
| `admission.ts` | `8966b21787b2049e5a9c6d57a1c7e2d96849508b90d6dd113d2e7e111194fd45` |
| `batch.ts` | `e7181ad4c56b7159084cd5027e5dec6bc683bac85595d3af5eb720548bdeaddc` |
| `execute.ts` | `4d8ac51d6542dd26234575d54a4d94870b45033c6c80c735f92e57d4fc270aeb` |
| `failure.ts` | `0ba9b6d32025080482276256b92f265b37ffc097f4bdff77e361bef51b2af36b` |
| `human-command.ts` | `ab4ec34e7fd8278aa6a615fd3df569bb168b6c7af5e968d6b0de3ecee732e36d` |
| `human-completion-context.ts` | `e0113600a6f54ad21244a1ef5df2d4d061ab34edc36a8bd9e2cd9c82313a13c5` |
| `human-completion-input.ts` | `cecfbd7bbdc30886672a6f6dbbf6dc510088cead72b3b416cef9ca22fb1ad202` |
| `human-completion.ts` | `7d92dd6588d505d54b8b209f7f7e0dc2f6e73dfdb1a7e3bfe4cc865b20d2db5c` |
| `human-execute.ts` | `f8fe25d4e785d667e86e3101bae4f210e8c5eb4eb054eaf6e32547127ae2c96f` |
| `list.ts` | `af63d3cddffe799d7016a95d5b88d8d8ba3eee30e9112454a3d70b4a1ef566b9` |
| `model.ts` | `d549d78601188096de10fe7fe587ad5b1f096ec9bf0fda36d8e3a4764b36b129` |
| `schema.ts` | `7f1fb83d9f7eb71ab233ef5877a8f086c4da900709d771d0228e702690fb673e` |
| `session.ts` | `b542baa8fa27d316beb0b9e76080063f5da5169103fc1112f1fcf97ca068434d` |
| `state.ts` | `959037f8b8af14095259f8f0ef26767c633d4c51016026eb88fb89b0340c8b5d` |
| `tool-definition.ts` | `08403fdea37afc1ced835836ef0a64e2ab3b4a2b74501d5b5239465be2a5df87` |


## Remaining unintegrated obligations and limits

- Future owner/context/history evaluation, restore readiness, registration/registry reporting, post-commit notification, human output append and final UI reporting must follow integration-plan §1a/§3/§3a/§4. These adapters have NOT been changed or tested live. Retained pre-restore records must not be represented as current-branch-ready after failure; no silent empty-state reset.
- Normal task results use text/details.error. The native AgentToolResult contract has no returned isError field; the outer native engine currently marks caught throws differently. No new hook was added to synthesize native error flags.
- Source supports sequential metadata; inspected workspace built wrapper/agent loop does not forward/honor this per-tool path. Actual loaded-host compatibility and child task capability remain pre-activation prerequisites, not solved by scoped typing.
- Enough resources, valid private/editor shapes, ordinary runtime primitives, synchronous non-reentrant persist/run and correct owner identity remain Requires. Engine/process/allocation catastrophe, arbitrary callback global mutation and native journal/disk rollback are not guaranteed. Persistence uncertainty and lost durable ID evidence after process failure remain explicit.
- Current runtime entry graph, all 46 protected files, original tests, profiles, SDK/dependencies and staged work are untouched. No provider call, registration, reload, commit, push or extra audit round.
