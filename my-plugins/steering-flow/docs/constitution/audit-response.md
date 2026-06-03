# Layered Audit Response

This file records the response to the first full read-only layered audit of the Level 0-2 draft.

## Audit Inputs

- `docs/constitution/level-0-2-draft.md`
- `docs/constitution/derivation-map.md`
- `docs/constitution/level-3-extraction.md`
- Existing Level 3 documents and selected code baseline files.

## Audit Outcome

The audit found no required code change if the constitution draft is narrowed to match the current baseline.

The main issues were overstatement, level placement, and observation-surface wording, not implementation contradiction.

## Findings and Responses

| Finding | Response |
|---|---|
| P3 overstates closure if read as post-interpolation executable revalidation. | Clarified that current behavior interpolates placeholders before command resolution/spawn and that this remains a documented lower-layer limitation. |
| P5 overstates explicit evidence access if read as key-level provenance or manual-only tape passing. | Renamed P5 to `Explicit evidence capability`. Clarified that the principle is about declared capability access, not key-level read/write provenance. |
| P8/P9 implied observation is only notify-only or command-only. | Clarified that observation surfaces may notify, return model-visible text, or write contained artifacts, so long as they do not mutate control state. |
| P10 overstates failure visibility because stop-hook errors, temp cleanup, and ENOSPC reminder metadata failures can be best-effort or swallowed. | Renamed P10 to `Serialized authority with scoped failure visibility`. Scoped visibility to core flow execution and documented best-effort exceptions. |
| P11 under-lists stop-hook pause/suppression paths. | Renamed P11 to `Ordinary-state liveness with declared pause exceptions`. Added user abort, compaction cooldown, stagnation, corrupted state, empty stack, and `$END` as operational exceptions. |
| P13 risks importing OMPv2 or review/self-check methods into substrate law. | Added protective wording that P13 is not prescriptive and must not require any particular workflow method. |
| P14 risks claiming stronger auditability than the code provides. | Reworded P14 as a documented design pressure/current limitation, not an append-only audit guarantee. |

## Files Updated

- `my-plugins/steering-flow/docs/constitution/level-0-2-draft.md`
- `my-plugins/steering-flow/docs/constitution/derivation-map.md`

## Code Baseline Decision

No code changes are made in this response.

Reason: the audit findings are resolved by narrowing the constitutional claims. They do not show that current code clearly violates existing Level 3 design principles.

## Next Step

Run a final verification pass on the revised docs and then update the work log.
