# manage-extensions model simulation report

Generated from the current code-level transition model plus state-local keybinding ownership checks.

## Summary

- Default same-state conceptual key conflicts: **none detected**
- Enumerated modes: `list`, `scope`, `actions`
- Enumerated key concepts: `cancel`, `confirm`, `tab`, `backTab`, `left`, `right`, `up`, `down`, `space`, text/edit input

## Checked invariants

1. `list` must reserve scope-edit semantics for `scope`, not for search mode
2. `scope` must own `left/right/space` without search-input competition
3. `actions` must own `left/right/confirm/space`
4. Help text must cover all important mode-switch and activation keys
5. No dead result/action states should remain in the command/component contract
6. Preflight/apply safety must not depend on stale UI snapshots

## Findings found by the model-check pass

### M1. Dead `back` result path
Status: **fixed**

Found:
- `ListResult` still included `back`
- `command.ts` still waited for `uiResult.action === "back"`
- component never emitted `back`

Fix:
- removed `back` from `ListResult`
- removed reopen loop in `command.ts`

### M2. Two-step cancel was under-specified in help
Status: **fixed**

Found:
- actual plain-list cancel was `arm -> exit`
- help compressed that to `cancel`

Fix:
- help now distinguishes:
  - `clear`
  - `arm cancel`
  - `exit`
- context line also explains second-press exit

### M3. Panel height was only bounded, not stable
Status: **fixed**

Found:
- list region height shrank when the filtered result set became small or empty
- this weakened the fixed selector-panel behavior

Fix:
- list area now reserves a fixed number of rows within the visible budget
- short result sets are padded with blank lines
- indicator row is always present

### M4. Same-state keybinding remaps could recreate conceptual non-det
Status: **mitigated**

Found:
- framework keybinding conflict detection is not enough to prove state-local semantic uniqueness
- user remapping could collapse two same-state concepts onto one key

Fix:
- component now scans same-state concept overlaps at startup
- status line shows a conflict summary if found

Remaining note:
- current behavior warns but does not hard-block interaction

### M5. UI preflight status was stale after toggles
Status: **fixed**

Found:
- preflight issues were originally passed as a snapshot
- `canApply()` / `blockingIssueCount()` could become stale after in-panel changes

Fix:
- component now recomputes preflight issues from current `buildChanges(states, pending)` when project/global dirs are available
- command passes `projectExtDir` and `globalExtDir` into the component

### M6. Deactivation could remove a symlink pointing to a different extension
Status: **fixed**

Found:
- preflight only warned on foreign symlink targets during disable
- apply path would still unlink any symlink at that path

Fix:
- preflight now treats foreign-target symlink removal as an **error**
- apply path now re-checks symlink target and refuses to remove if it points elsewhere

## Remaining residual risks

### R1. Keybinding remap conflicts are warned, not blocked
The panel surfaces same-state conceptual conflicts but does not abort interaction.

### R2. Height budgeting still relies on terminal-row estimation
The component still uses `process.stdout.rows || 24` rather than an explicit host-supplied height.

## Conclusion

The model-check pass found and closed both state-model issues and safety issues:
- dead result-state residue
- help/behavior mismatch
- unstable panel height
- stale preflight snapshot use
- unsafe unlink behavior

Under default bindings, the current interaction design is now conceptually deterministic across `list / scope / actions`, and the most important runtime safety hole in apply/deactivate has also been corrected.
