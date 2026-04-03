# manage-extensions Repair Log

## Cycle 1

### Scan Results

#### Confirmed major+critical issues to fix (no fixes applied yet)
- **UX: Shift+Tab during list focus appears to fall through into search input**
  - **Report**: `my-plugins/manage-extensions/_scan_ux_report.md`
  - **Issue**: In `extension-list.ts` `handleInput`, the list-focused input path does not handle `shiftTab`; unhandled Shift+Tab falls through to `searchInput.handleInput(data)` and triggers `applyFilter`.

- **UX: Applying when “Apply” is disabled provides no feedback / silent return**
  - **Report**: `my-plugins/manage-extensions/_scan_ux_report.md`
  - **Issue**: In `extension-list.ts`, `activateCurrentAction` returns silently when `action === "apply"` and `canApply()` is false, resulting in no acknowledgement for an invalid apply attempt.

- **Logic/UX: “No changes applied.” message shown even when apply actually failed to apply**
  - **Report**: `my-plugins/manage-extensions/_scan_ux_report.md`
  - **Issue**: In `index.ts`, `post-applyChanges` notifies `"No changes applied."` when `applied.length === 0`, even if `apply` encountered errors/warnings during the attempt.

- **UX/Recovery: Name conflicts abort entirely with no in-plugin recovery path**
  - **Report**: `my-plugins/manage-extensions/_scan_ux_report.md`
  - **Issue**: In `index.ts`, conflicts are notified and the flow returns immediately; there is no resolution/recovery guidance or in-plugin reroute to resolve duplicates.

- **Code Quality: `extension-list.ts` exceeds the critical LOC hard limit**
  - **Report**: `my-plugins/manage-extensions/_scan_quality_report.md`
  - **Issue**: The scan flagged a hard threshold violation (360 total lines; 324 code lines vs hard limit 200).

- **Code Quality: `extension-list.ts` SRP violation (multiple unrelated responsibilities bundled)**
  - **Report**: `my-plugins/manage-extensions/_scan_quality_report.md`
  - **Issue**: `buildListComponent` and related utilities bundle multiple concepts (type defs, key mapping, state accessors, full TUI component factory, `renderScopeToken`, search utilities).

- **Code Quality: Hardcoded key literals appear in key handling**
  - **Report**: `my-plugins/manage-extensions/_scan_quality_report.md`
  - **Issue**: The scanner flagged hardcoded key literals in `createKeyMap` (e.g., left/right/shiftTab/space), indicating bypass of the configurable keybinding system.

- **Architecture: `index.ts` contains substantial business logic (not just re-exports)**
  - **Report**: `my-plugins/manage-extensions/_scan_quality_report.md`
  - **Issue**: Scan flagged `index.ts` as containing business logic (e.g., buildChanges, build scan progress component, and command handler logic), rather than being a thin orchestration/re-export module.
