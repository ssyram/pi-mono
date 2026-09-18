# Task-system exception safety — authorized reasoning scope

Status: COMPLETED 2026-09-18. The authorized analysis and repairs were delivered and are archived in [HOARE-EXCEPTION-SAFETY.md](HOARE-EXCEPTION-SAFETY.md) plus [EXCEPTION-SAFETY-DELTA.md](EXCEPTION-SAFETY-DELTA.md); the contained boundaries are now part of the integrated runtime (commit cdbf3369).

## Authority and purpose

The user requires that task-system failures not escape into and disable the agent harness: an explicit error to the AI or human is acceptable. They explicitly requested `/hoare-prompt` reasoning for every function and infrastructure component, with immediate simplification/fixes where justified by that reasoning.

This supplement supersedes the earlier instructions to propagate persistence, task-reader or unexpected callback exceptions **at harness-facing boundaries**. It does not retroactively describe the previous implementation as satisfying this requirement. Existing functional contracts in principles.md and architecture.md remain authoritative unless explicitly superseded here.

The target is recoverable control flow and honest state/results, not universal operation success. Returning an error is allowed; inventing success, silently losing tasks or bypassing admission is not.

## Required postconditions

1. Model task execution and human/session operation boundaries contain ordinary synchronous exceptions and relevant asynchronous rejections. A failure becomes a native-compatible error result or an explicit typed failure consumed by the caller, not an uncaught exception or success-shaped response.
2. Expected malformed requests remain ordinary reported validation errors. Batch semantic partial success remains distinct from whole-operation failure. Scalar operations and human modify retain all-or-error publication.
3. On transformation failure, no partially transformed task records are installed. On persistence failure, old controller task records remain available and reserved ID high-water does not decrease. Report persistence uncertainty honestly: native append may mutate its log before throwing, so disk/native-log rollback is NOT promised.
4. Successful mutations publish/persist once and notify only after successful publication. A subsequent presentation/notification failure must not falsely claim an already committed operation was rolled back. No retries, alternate storage or fallback persistence are introduced.
5. State restoration either establishes the documented branch/allocation state or reports failure without claiming the branch was successfully restored. Follow actual caller evaluation order: reading history before calling a safe function can itself throw. Record and close the required future caller boundary; do not hide it behind a helper-level proof.
6. Admission still exempts exact `task`. If a non-task admission cannot establish a valid active unblocked task because reading/classification fails, return an explicit refusal, not a throw and not fail-open. This is not permission to cancel already-running work or override hard allowlists.
7. Autocomplete callbacks contain ordinary task-reader and delegated-provider failures, including rejection where the actual native interface permits promises. Suggestion failure yields no completion; application failure preserves editor input/cursor. Do not retry a failed delegate or disguise a failed task read as an authoritative empty state. The fallback itself must not require the failed dependency.
8. Error construction/reporting must not rethrow through the same fallible formatting, reader or notification path. Any recovery assumption must be explicit and grounded in actual caller/source contracts.
9. Session ownership, graph invariants, full-state versus filtered-view separation, human-only clear/modify, and all accepted task/list/completion semantics remain intact.

## Proof boundary

Every function in `tools/task-system/` must appear in a coverage inventory, including local helpers and returned callback methods. Trace the reused task graph/state/lifecycle helpers and relevant native caller exception behavior to establish actual preconditions and effects; do not silently assume them. The inventory must distinguish checked helpers, caller-established preconditions, exceptions contained upstream, and unresolved future runtime obligations.

Private parsers/helpers may remain fallible when all relevant callers establish their preconditions or contain their errors. Exported does not automatically mean harness callback. Do not add catch blocks or repeat validation in every helper merely to eliminate the word `throw`.

Use Hoare Requires/Ensures, local strongest postconditions, branch case splitting, and loop initialization/maintenance/termination. Show representative three-iteration traces where applicable; do not fabricate three iterations for a loop with a smaller bound. Exceptions are additional control-flow exits with explicit state postconditions. Verify callbacks and persistence against source, not type names or prior delivery claims alone.

This is natural-language structural reasoning plus direct tests, not a machine-checked proof. Process termination, engine failure and inability to allocate even an error result are outside a credible JavaScript no-throw guarantee. Finite resource assumptions do not excuse ordinary reachable exceptions from routine callbacks. No arbitrary size limits, estimator policies, dependency repairs, new global registries or generalized recovery framework may be added to manufacture a proof.

An exception observed in a helper does not by itself prove the whole harness crashes. Determine the actual native boundary handling and separately assess compliance with the new plugin boundary contract. Distinguish source/built/installed versions and direct callback tests from deployed integration.

## Authorized procedure and changes

- One independent fresh-context reasoner performs the bounded function-by-function analysis under this pre-established contract. The implementation and its reports are evidence, not sources of new requirements.
- Findings require a reachable path/counterexample or an explicit unclosed proof obligation. Unsupported hypothetical strengthening is not a finding.
- The parent decides the repair scope. One implementation worker may make necessary simplifications/fixes and direct regression tests; it must not recruit reviewers or create an audit loop.
- Permitted edits: dormant `tools/task-system/`, `test/task-system-*`, their scoped configs if genuinely needed, and `docs/task-system/`.
- Existing active tool/command/hook/extension/profile files, original protected tests, official packages, dependencies and unrelated work remain unchanged. No registration, reload, provider calls, staging, commit or push.
- Preserve `.pi/task-system-protected.sha256` and unrelated staged state. Run affected/full focused task tests, scoped TypeScript/Biome, and required root check after code changes; report the existing root failure honestly rather than repairing unrelated packages.
- Update the integration plan to use the final safe interfaces and call-site obligations. Do not keep stale promises to rethrow or silently change the few-line estimates if interfaces change.

## Delivery

Provide the complete function inventory and derivations, accepted findings and concrete minimal repairs, fault-injection/direct regression evidence, final API/caller changes, and remaining deployment/resource boundaries. Stop after the authorized pass and direct implementation checks; separate approval is still required for integration.
