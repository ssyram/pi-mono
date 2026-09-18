# Loop 2.0 remediation audit report

## Scope

This report re-checks the four findings from the independent contract review against `detailed-design.md`, the Loop 2.0 source, and the regression tests. The remediation remains confined to `src/v2/`, `test/v2-*.test.ts`, and `docs/ver-2.0/`; it does not wire Loop 2.0 into the existing extension, scheduler, command parser, or tool registration.

## Finding disposition

| Finding | Verdict | Evidence and remediation |
| --- | --- | --- |
| P1: a shared store can materialize a definition from the other scope | Confirmed and fixed | Invariant P.4 requires each store to contain only its own scope. `SharedDefinitionStore.load()` now receives the expected scope and treats a mixed-scope document as unavailable. `v2-core.test.ts` writes a workspace document containing both a valid workspace definition and a misplaced global definition, then proves both `list("workspace")` and `get("workspace", ...)` return no materialized definition. |
| P1: `listActive()` omits an active registration when its definition cannot resolve | Confirmed and fixed | `/loop list` is defined as all active local tasks plus active registrations. `ActiveTask` now represents a registration with `definition: SharedDefinition | undefined`, and `listActive()` always includes active registrations. The corrupt-document regression test proves the registration remains visible with `definition === undefined`; execution still resolves separately and returns `unavailable` without advancing progress. |
| P1: cancellation can throw on state-lock contention instead of returning `busy` | Confirmed and fixed | The cancellation result contract is `cancelled | missing | busy`, while the former shared state-lock helper threw on contention. Cancellation now acquires the resource lock first as before, then uses a non-throwing state-lock attempt and maps only contention to `busy`. A nested-delivery regression test covers local cancellation, registration unregistration, and `AiSessionActions.cancel` while another task holds the state lock. |
| P2: no-copy regression checks `prompt` but not `schedule` | Confirmed and fixed | The persisted-registration assertion now checks that neither `prompt` nor `schedule` is an own property, matching invariant P.3. |

## Contract and boundary review

- The shared-store remediation rejects the entire mixed-scope document rather than silently filtering it. A wrong embedded scope makes the document corrupt for that store, consistent with the documented empty-list recovery behavior.
- The unresolved-registration representation is read-only. It neither synthesizes a shared definition nor changes registration progress, so `listActive()` and `available` retain their query semantics.
- Cancellation retains the required resource-lock-then-state-lock order and keeps the resource lock through the cancellation decision. It does not broadly convert persistence or programming errors into `busy`.
- Static scans found no `src/v2` import of the existing Loop 1.x extension, scheduler, job store, parser, or tool-registration modules. No v2 module registers a command, tool, lifecycle hook, or timer.
- All `src/v2/*.ts` files remain at or below 200 lines (maximum: `loop-core.ts`, 188 lines). The source scan found no `any` or dynamic import.

## Verification

| Command | Result |
| --- | --- |
| `node --import tsx --test my-plugins/scheduled-wakeup/test/v2-core.test.ts my-plugins/scheduled-wakeup/test/v2-execution.test.ts my-plugins/scheduled-wakeup/test/v2-session-state.test.ts` | Pass: 10 tests, 3 suites. |
| `npm test --prefix my-plugins/scheduled-wakeup` | Pass: 29 tests, 8 suites. |
| `npx tsc -p my-plugins/scheduled-wakeup/tsconfig.json` | Pass (exit 0). |
| `npm run check` | Failed (exit 2) in the root `tsgo --noEmit` phase with 326 diagnostics under `packages/ai` and `packages/coding-agent`; no `scheduled-wakeup` path appeared in the diagnostics. |

## Remaining verification limits

- The root Biome configuration only includes selected `packages/**` paths. A direct Biome invocation for the Loop 2.0 plugin reported that its paths were ignored, so plugin formatting is not independently certified by that root configuration.
- The plugin directory is untracked, so Git cannot establish a file-level historical diff proving the target-only boundary. Static inspection supports the boundary.
- The repository already has 22 staged paths outside `scheduled-wakeup`; no scheduled-wakeup path is staged and this remediation did not stage or commit files. The global “staged set is empty” audit condition therefore cannot be certified in this workspace.
- `npm run check` cannot be certified green until the unrelated root model-catalog typing failures are resolved.
