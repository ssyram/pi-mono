# Steering Flow Constitution Work Log

## Purpose

This directory records the retrofit constitution work for `my-plugins/steering-flow`.

The current task is not initial top-down constitution drafting. Steering Flow already has running code, Level 3 design documents, examples, and audits. The task is retrofit constitution work: extract the implicit higher-level commitments already used by the project, make them explicit, and verify that lower layers can cite them.

## Scope

- Target project: `my-plugins/steering-flow`.
- Baseline: current code and existing Level 3 documents.
- Code policy: do not change code unless a clear contradiction with existing Level 3 design principles is found.
- Documentation policy: documents may be reorganized and amended to separate Level 0 through Level 2 material from Level 3 implementation/design descriptions.

## Layer Model

- Level 0: root problem consciousness. This is the problem that necessarily exists before any design answer.
- Level 1: extracted essential commitments. These are the non-trivial judgments lower layers depend on but cannot derive by themselves.
- Level 1.5: empirical observations and experience-derived axioms. These are grounded in existing project behavior, MCP FSM precedent, audits, and LLM workflow failure modes.
- Level 2: design principles. These must be argued from Level 1 plus Level 1.5, and must explain or constrain Level 3 design.
- Level 3: existing architecture, execution behavior, configuration, examples, and code-level design documents.

## Retrofit Method

1. Extract Level 2 candidates upward from existing Level 3 documents.
2. Identify the Level 1 commitments required by those Level 2 candidates.
3. Identify Level 1.5 observations that support each Level 2 principle.
4. Check Level 2 to Level 3 consistency against current code and documents.
5. Run a comprehensive layer-style legal audit modeled on the existing audit style.
6. Revise documents based on audit findings.

## Trace Discipline

Every material step must update this directory before moving on. Each entry should record:

- Input material used.
- Operation performed.
- Output produced.
- Next step enabled.

## Work Entries

### 2026-05-17 Entry 1 — Work log created

Input material:

- User instruction to begin Level 0 through Level 2 supplementation.
- User instruction that every step must leave trace records.
- Current repository status showing unrelated existing changes outside `my-plugins/steering-flow`.

Operation:

- Created this work log directory and entry file.
- Established the layer model and retrofit method.

Output:

- `my-plugins/steering-flow/docs/constitution/work-log.md`

Next step enabled:

- Read existing Level 3 documents and extract Level 2 candidates into a separate trace document.

### 2026-05-17 Entry 2 — Level 3 material reviewed and Level 2 candidates extracted

Input material:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/execution-behavior.md`
- `docs/configuration-tutorial.md`
- `docs/builtin-procedures.md`
- `docs/comparison-with-mcp-server-fsm.md`
- `docs/correctness-audit.md`
- `docs/hoare-audit-2026-04-21.md`
- `docs/ultra-work-instance.md`
- `skills/steering-flow-author/SKILL.md`

Operation:

- Reviewed existing Level 3 architecture, runtime, configuration, comparison, audit, instance, and authoring documents.
- Extracted principle-like content already mixed into Level 3 material.
- Separated Level 3 details from candidate Level 2 principles.

Output:

- `my-plugins/steering-flow/docs/constitution/level-3-extraction.md`

Next step enabled:

- Draft Level 0, Level 1, Level 1.5, and argued Level 2 materials using the extracted candidates as input.

### 2026-05-17 Entry 3 — First audit delegation attempt failed

Input material:

- Candidate Level 2 extraction.
- User requirement to send a comprehensive layer-style legal audit.

Operation:

- Attempted to delegate audits to `functional-correctness-auditor`, `spec-impl-auditor`, `cross-boundary-auditor`, and `workflow-auditor`.

Output:

- All four delegations failed before execution because the subagent default provider attempted `anthropic`, while this environment requires `yunwu`.

Next step enabled:

- Produce the Level 0-2 draft first, then retry audit delegation with explicit `yunwu/*` model overrides.

### 2026-05-17 Entry 4 — Level 0-2 draft and derivation map created

Input material:

- Level 3 extraction table.
- Existing `README.md`, architecture, runtime, config, builtin, comparison, audit, instance, and authoring documents.
- Current code baseline in `engine.ts`, `storage.ts`, `parser.ts`, and `builtin-registry.ts`.

Operation:

- Wrote the first retrofit constitution draft for Level 0 through Level 2.
- Wrote the Level 1 / Level 1.5 / Level 2 derivation map.

Output:

- `my-plugins/steering-flow/docs/constitution/level-0-2-draft.md`
- `my-plugins/steering-flow/docs/constitution/derivation-map.md`

Next step enabled:

- Run a fresh audit pass against the new draft and the current code baseline, using explicit `yunwu/*` model overrides.

### 2026-05-17 Entry 5 — Worktree audit retry failed due dirty repository

Input material:

- Level 0-2 draft.
- Derivation map.
- Level 3 extraction table.
- Current Level 3 docs and code baseline.

Operation:

- Retried parallel audit with explicit `yunwu/gpt-5.5` model overrides and `worktree: true` isolation.

Output:

- Delegation did not start because worktree isolation requires a clean git tree.
- Current repository contains unrelated pre-existing dirty files outside `my-plugins/steering-flow` and new constitution docs from this task.

Next step enabled:

- Rerun the same audit without worktree isolation. The audit tasks are read-only by instruction.

### 2026-05-17 Entry 6 — Read-only layered audit completed

Input material:

- `docs/constitution/level-0-2-draft.md`
- `docs/constitution/derivation-map.md`
- `docs/constitution/level-3-extraction.md`
- Existing Level 3 documents and selected code baseline files.

Operation:

- Ran read-only parallel audits with explicit `yunwu/gpt-5.5` model overrides.
- Auditors: functional correctness, spec/implementation, cross-boundary, workflow.

Output:

- Audit completed successfully for all four tasks, though the cross-boundary auditor returned no substantive findings.
- Main confirmed issues:
  - P10 overstates failure visibility because stop-hook errors, ENOSPC reminder counter updates, and temp cleanup have intentional best-effort or swallowed paths.
  - P11 under-lists non-interactive liveness exceptions such as abort, compaction cooldown, stagnation pause, corrupted state, empty stack, and `$END`.
  - P5 overstates explicit evidence access if read as key-level attribution or manual-only tape passing; current builtins can receive tape by `needs_tape` convention and scripts with tape path can access arbitrary tape keys.
  - P13 is safe only if OMPv2, self-check, review, and authoring checklists stay optional flow-level projections.
  - P14 is a design pressure/current weakness, not an existing append-only auditability guarantee.
- No required code change was identified if the draft is narrowed appropriately.

Next step enabled:

- Revise the draft and derivation map to narrow P5, split/qualify P10, expand P11 exceptions, localize P13, and downgrade P14 to known design pressure.

### 2026-05-17 Entry 7 — Draft revised after audit

Input material:

- Layered audit findings from Entry 6.
- Current Level 3 code/doc baseline.

Operation:

- Revised the Level 0-2 draft and derivation map to answer confirmed audit issues.
- Added an audit response record.
- Preserved the code baseline unchanged.

Output:

- Updated `my-plugins/steering-flow/docs/constitution/level-0-2-draft.md`
- Updated `my-plugins/steering-flow/docs/constitution/derivation-map.md`
- Added `my-plugins/steering-flow/docs/constitution/audit-response.md`

Next step enabled:

- Verify changed documentation for consistency and record the final state of this phase.

### 2026-05-17 Entry 8 — Targeted cross-boundary audit completed

Input material:

- Revised Level 0-2 draft.
- Revised derivation map.
- Audit response.
- Existing Level 3 docs and code baseline.

Operation:

- Re-ran the cross-boundary audit as read-only with explicit `yunwu/gpt-5.5` model.

Output:

- Audit found the revised draft mostly correctly placed.
- Remaining issues:
  - Observation-surface wording still risked implying observation is only notify-only or command-only, while `context-info` and model-visible info surfaces can report state without mutating control state.
  - P3 needed a caveat that placeholder interpolation occurs before command resolution/spawn, and post-interpolation executable revalidation is not an existing guarantee.
- Updated `level-0-2-draft.md`, `derivation-map.md`, and `audit-response.md` accordingly.
- No code change required.

Next step enabled:

- Final verification of docs and close the phase.

### 2026-05-17 Entry 9 — Final consistency pass completed

Input material:

- Revised constitution docs after the first audit and cross-boundary audit.

Operation:

- Grepped constitution docs for stale pre-audit terminology and missing caveats.
- Updated `level-3-extraction.md` to match revised terminology for P5, P10, and P11.

Output:

- Final doc set is internally consistent for the current phase:
  - `work-log.md`
  - `level-3-extraction.md`
  - `level-0-2-draft.md`
  - `derivation-map.md`
  - `audit-response.md`

Next step enabled:

- Future work can continue from this trace set without re-deriving the completed phase from conversation history.
