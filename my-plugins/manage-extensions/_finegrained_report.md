# manage-extensions /finegrained-check report

## Scope

Inspected:
- `my-plugins/manage-extensions/command.ts`
- `my-plugins/manage-extensions/extension-list.ts`
- `my-plugins/manage-extensions/key-map.ts`
- `my-plugins/manage-extensions/types.ts`
- `my-plugins/manage-extensions/README.md`
- `packages/tui/src/tui.ts`
- `packages/tui/src/keybindings.ts`
- selector references:
  - `packages/coding-agent/src/modes/interactive/components/model-selector.ts`
  - `packages/coding-agent/src/modes/interactive/components/extension-selector.ts`
  - `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
  - `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

---

## Original user-visible problems (baseline)

### P1. Search input and L/G selection conflicted
Old design overloaded `list` with both:
- text editing / cursor semantics
- scope editing semantics

This created a design-level non-determinism:
- `Left/Right` belonged to both search editing and `L/G` selection
- `Enter/Space` were also overloaded conceptually

### P2. List viewport was unstable and easy to obscure
Old rendering used a long, growing page layout with large footer/details blocks.
Because TUI rendering is width-driven and effectively bottom-cropped, tall content caused the top of the list to disappear or jump.

### P3. No dedicated scope-editing submode
Without a distinct `scope` state, there was no clean place to assign `Left/Right`, `Space`, `Enter`, and `Esc` unambiguously.

---

## First-round fix direction

Implemented design split:
- `list` = search/browse
- `scope` = edit L/G
- `actions` = bottom action bar

Implemented compact selector-like layout:
- title
- search
- single-line context/status
- bounded list window
- action bar
- help line

This removed the biggest conceptual conflict and made the UI much closer to `/model`-style selector behavior while staying on the existing `ctx.ui.custom(...)` host.

---

## Second-round model-check findings

After extracting the state machine and doing a design-level determinism/ownership/coverage pass, the following remaining issues were identified.

### F4. Running against standard pi requires plugin-local handling for non-standard keys
Severity: **high**

Symptoms:
- a previous iteration assumed custom app-level keybinding ids existed for:
  - left
  - right
  - shift+tab
  - space
- but in the user's actual setup, only the standard pi build is used and only extensions are compiled
- therefore those app-level ids would never exist at runtime

Impact:
- `left/right/shift+tab/space` in `scope/actions` could become inert
- help/conflict logic could refer to bindings that are not actually registered

Fix:
- reverted plugin behavior to rely only on:
  - standard TUI ids where available (`cancel/confirm/up/down/tab`)
  - plugin-local direct physical-key matching for `left/right/shift+tab/space`
- removed dependency on patching pi source for manage-extensions runtime behavior

### F5. `ListResult["back"]` was a dead state-model branch
Severity: **medium**

Symptoms:
- `types.ts` still exposed `{ action: "back" }`
- `command.ts` still had a reopen loop waiting for `uiResult.action === "back"`
- component code no longer emitted `back`

Impact:
- stale conceptual model
- dead control-flow branch
- misleading command-layer logic

Fix:
- removed `back` from `ListResult`
- removed command-layer reopen loop
- simplified cancel path to reflect real outputs: `apply | cancel`

### F6. List-mode help understated the two-step cancel contract
Severity: **medium**

Symptoms:
- plain list help only said roughly “cancel”
- actual behavior was: first press arms cancel, second press exits

Impact:
- help coverage mismatch
- user cannot infer exact cancel semantics from help alone

Fix:
- help now distinguishes:
  - `clear` when search is non-empty
  - `arm cancel` on first plain-list cancel press
  - `exit` after cancel is armed
- context line also shows `Press Esc again to cancel and exit`

### F7. Panel height was bounded but not strictly stable
Severity: **medium**

Symptoms:
- list area previously rendered a variable number of lines depending on result count
- filtering to a short or empty result set could shrink the whole panel

Impact:
- weaker selector feel
- visual instability inconsistent with the intended compact fixed-window design

Fix:
- list window now renders a fixed number of list rows within the current visible budget
- short result sets are padded with blank lines
- indicator row is always reserved
- this makes panel height stable within its height budget

### F8. User keybinding remaps could reintroduce conceptual non-det
Severity: **medium**

Symptoms:
- even with good default bindings, user remapping could bind two distinct same-state concepts to one physical key
- framework conflict detection does not fully cover default-vs-user semantic collisions

Impact:
- conceptual determinism could be broken by configuration

Fix:
- added a state-local binding conflict scan at component startup
- if same-state concept collisions are found, the panel shows a warning summary in its context/status line

Example detected class:
- if `tui.select.confirm = space`, then in `scope` mode:
  - `space = back to list`
  - `space = toggle scope`
  This is now surfaced as a warning.

### F9. README lagged behind the refined state machine
Severity: **low**

Symptoms:
- missing `Shift+Tab`
- missing scope-to-actions transition docs
- missing action-bar key docs
- overstated “fixed visible window” while implementation was only bounded

Fix:
- README updated to match:
  - three-mode model
  - `Tab/Shift+Tab`
  - action-bar keys
  - two-step cancel semantics
  - stable fixed-height list window within terminal budget
  - warning note for remapped-key conflicts

### F10. UI preflight state could become stale after toggles
Severity: **medium**

Symptoms:
- preflight issues were originally passed in as a snapshot before entering the panel
- after toggling pending changes, `canApply()` / blocking summary could become stale

Fix:
- component now recomputes preflight issues from current `buildChanges(states, pending)` when directory context is available

### F11. Deactivation could remove a symlink pointing to a different extension
Severity: **high**

Symptoms:
- disable preflight previously treated “existing symlink points elsewhere” as only a warning
- apply path would still unlink any symlink at that location

Impact:
- could remove a foreign symlink unexpectedly

Fix:
- preflight now upgrades this case to an error
- apply path now re-checks the symlink target and refuses to remove if it points elsewhere

---

## Current interaction contract

### Modes
- `list`
- `scope`
- `actions`

### Ownership split
- `list`
  - search input owns text-edit behavior
  - outer state machine owns navigation/mode-switch keys
- `scope`
  - outer state machine owns `Left/Right`, `Space`, `Enter`, `Esc`, `Tab`
  - search input is unfocused
- `actions`
  - outer state machine owns action navigation/activation keys
  - search input is unfocused

### Key consequences
- `Left/Right` no longer compete with search editing in `list`
- `Space` only toggles in `scope` and only activates in `actions`
- `Enter` is state-specific and no longer conceptually overloaded inside one state

---

## Remaining residual risks

### R1. Hard warning instead of hard prevention for remap conflicts
Current behavior surfaces same-state key conflicts in-panel, but still allows the session to continue.
This is acceptable for now, but future tightening could block interaction or apply when a same-state conceptual conflict is detected.

### R2. Height still depends on estimated terminal rows
The component still uses `process.stdout.rows || 24` rather than being passed a precise height budget from the host.
A future TUI API with explicit height would allow even more robust selector-style rendering.

---

## Final assessment

For the user-requested scope, the major usability and design-level determinism issues have now been addressed:

- search vs scope-edit conceptual conflict: **fixed**
- unstable long-page rendering: **fixed into compact stable windowed layout**
- missing explicit scope submode: **fixed**
- help/behavior mismatch: **fixed**
- stale dead `back` state-model branch: **fixed**
- remap-induced same-state semantic collision detection: **added warning coverage**
- stale preflight gating: **fixed**
- unsafe foreign-symlink removal: **fixed**

The result is now materially closer to a true selector-style interaction model, even though it still runs inside the existing `ctx.ui.custom(...)` host rather than a full `/model`-style selector host lifecycle.
