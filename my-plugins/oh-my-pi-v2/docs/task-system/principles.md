# Task-system patch — principles

Status: INTEGRATED 2026-09-18 and live-accepted; shipped in commits cdbf3369 and 4c561626b. Evidence: [verification.md](verification.md); shipped interfaces: [integration-plan.md](integration-plan.md).
Owner: oh-my-pi-v2. Existing `docs/task-list-v0.2.0.md` describes the live system and is not replaced in this gate.

## Q.I — accepted intentions

- Require an actually in-progress, unblocked task before admitting any non-task model tool call in an OMP-owning session. Only the exact `task` tool is exempt.
- Reduce tool round trips with batch creation, call-local aliases, optional creation-time dependencies/start, and an explicit `done` handoff. A common handoff is `startNext: ID`; an ordered fan-out is `startNext: ID[]`. The handoff never selects ready tasks that the caller did not name.
- Batch creation is best effort, NOT all-or-nothing: create valid items, accept valid edges in deterministic order, skip invalid edges, then attempt starts. Report actual effects and every rejected request.
- A legal dependency on done/expired is accepted and explicitly reported as already satisfied, with no additional blocking effect.
- Permit a valid dependency update to move an in-progress task back to pending/blocked; when unblocked it becomes ready, not automatically in-progress.
- Keep existing single-action rejection behavior rather than applying batch tolerance to `start` or `update_deps`.
- Remove clear from the model tool. Offer human `/task add`, `/task modify`, `/task list`, and `/task clear` sharing the model's actual-session controller. Human commands are not model-tool calls and do not use the admission gate. Clearing requires the explicit all-caps `--CONFIRMED` flag and must not reset task IDs.
- Human modify is one all-or-error operation, even with several options: text, dependencies, then lifecycle validation on a cloned candidate, with one successful persistence. No model-facing modify action, reopening, pause, or assignment of derived statuses is added. Keep existing bare-command help, show, and info behavior during future wiring.
- Keep stable numeric IDs in the owning session; prevent new reuse after clear/branch navigation, without global shared task state or a distributed task registry.
- Default list is fixed: every open task plus the most recent at most ten closed tasks. Explicit queries select one type with an optional limit.
- Preserve the complete task state for dependencies, persistence, Boulder and compaction; filtering is presentation only.
- Human autocomplete covers new and legacy roots, contextual unused flags, fixed status/list values, and current-session numeric task IDs (including terminal prerequisites); ID slots also match task text case-insensitively while still inserting the numeric ID. Quote/escape-aware insertion must preserve surrounding input. Completion reads current state without mutation; it does not replace execution validation.
- Infrastructure first. Direct tests and a concrete interface plan must be delivered before the user separately authorizes behavior changes.

## Q.A — verified environment

- Current model actions are list/add/start/done/expire/update_deps; clear is rejected at the model boundary. `add` already has scalar and batch forms with creation-time dependencies/start. Existing `executeStart` alone owns target-existence, pending-status and unresolved-blocker checks on the candidate state.
- IDs are record IDs, not list positions. Current clear resets nextId, and branch restoration restores an old nextId.
- Existing dependencies reject missing IDs, duplicate IDs, self-edges and cycles. Terminal prerequisites are allowed and treated as satisfied.
- Stored statuses are pending/in_progress/done/expired. Ready/blocked are derived from pending and dependency satisfaction.
- Existing dependency updates can leave an in-progress task with unsatisfied prerequisites. updatedAt changes on dependency rewiring and is not a closure order.
- State is owned by a WeakMap keyed by the session manager. The native task execution body is synchronous despite its async signature.
- Pi tool_call refusal skips execution and yields isError:true; it is an admission boundary, not cancellation of work already running or a global sandbox.
- Current Pi source forwards and honors per-tool executionMode: sequential; the inspected workspace built wrapper/scheduler do not. The active host must be verified before gate activation. The live task tool currently does not request it.
- Some native child profiles can load OMP while a hard tool allowlist excludes task. setActiveTools cannot bypass that filtered registry.
- Native appendEntry is not a full memory/disk transaction; plugin-local rollback does not imply native-log rollback.

Source map: tools/task.ts, task-actions.ts, task-dependencies.ts, task-state-entry.ts, task-types.ts; commands/task.ts; extension.ts; packages/agent/src/agent-loop.ts; the three read-only reports from workflow 167fc6ae-0832-40db-b8ca-1aee45f79139.

## Q.E — corrections retained

- The initial atomic-batch proposal was explicitly rejected. A cycle-closing edge must not undo successfully created tasks or previously accepted edges.
- The initial prohibition on terminal dependencies was rejected in favor of current satisfied-edge behavior.
- The initial prohibition on adding blockers to running tasks was replaced with an explicit transition to blocked.
- Batch start and blockedBy are not schema-exclusive: apply accepted dependencies before attempting start.
- The initial configurable closedLimit was replaced by a fixed default overview and explicit type/limit queries.
- Enabling the feature while building its infrastructure is explicitly prohibited.
- An earlier `startNext` sketch imposed non-empty or unique arrays, separate start validation, and transaction/precheck behavior. The user rejected those additions: the optional scalar/array only dispatches to existing `executeStart`; empty and duplicate arrays retain their natural behavior, and each failed start remains visible.

## P — observable properties

1. The handoff uses the existing task execution/registration path only; it adds no tool name, runtime registration, prompt, profile, or agent-policy path.
2. State transforms have no cross-session mutable state and do not mutate caller inputs before returning their result.
3. Successful states retain unique safe-positive IDs, reciprocal dependency edges and an acyclic graph; source keys are never persisted as IDs.
4. A batch reports the actual created IDs, accepted/skipped dependencies and actual start/state outcomes. Semantic partial success is not reported as total failure.
5. Invalid syntax/parameter-shape and underlying persistence failures are not disguised as successful partial application.
6. Defaults and explicit list queries have separate deterministic meanings; neither may delete hidden tasks from state.
7. No guarantee claims perfect historical closure order where old records lack that data, retroactive repair of already-reused IDs, multi-process same-file coordination, or rollback of native I/O failures.
8. The user subsequently authorized one bounded function-by-function Hoare exception-safety analysis and necessary dormant fixes/direct tests under [exception-safety-scope.md](exception-safety-scope.md). Runtime integration, live reload, provider execution, staging, commit and push remain unauthorized.
9. Dormant session/model/human operations, tool execution, admission and autocomplete now contain ordinary boundary failures with honest error/refusal/no-op results. The independent before-fix analysis and separate implementer repair derivations are in [HOARE-EXCEPTION-SAFETY.md](HOARE-EXCEPTION-SAFETY.md) and [EXCEPTION-SAFETY-DELTA.md](EXCEPTION-SAFETY-DELTA.md). Future owner/history/lifecycle and post-commit presentation envelopes remain caller obligations, not already deployed guarantees.
10. Errors use the existing text plus details.error convention, not an invented native isError field. Restoration reports a typed outcome; persistence failure retains old controller records and reserved IDs while explicitly leaving native-log/disk outcome uncertain. UI fallback does not retry failed dependencies. Internal fallible helpers remain valid under established caller preconditions.
11. A successful `done` handoff closes and orders its named starts on one cloned candidate. A failed close attempts no handoff; every later start retains the existing `started` or `start_skipped` outcome, so a completed close with any skipped start is partial success rather than a false whole-call error.
12. Scalar and array `startNext` inputs are read without mutation. Empty arrays cause no handoff, and duplicate IDs are attempted in input order against the state produced by earlier attempts.
