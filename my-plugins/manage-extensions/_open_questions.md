# Open Questions — manage-extensions

## Cycle 1

### Q1: `while(true)` loop in `index.ts` — dead code or future extension point?
- **Issue description**: The main `while(true)` loop in `index.ts` appears to never iterate: `uiResult.action` is described as always being either `"apply"` or `"cancel"`, and the loop body returns immediately.
- **Came from report**: `my-plugins/manage-extensions/_scan_ux_report.md`
- **Why it’s uncertain**: It may be intentional scaffolding for a future `"back"`/re-scan flow (e.g., a future action that would break the immediate return behavior). Without the rest of the UI state machine, it’s unclear whether this is a bug or planned extension.

### Q2: `moveColumn()` resets `cancelArmed` on column switch — intentional?
- **Issue description**: Esc double-tap cancellation state (`cancelArmed`) is reset when moving between columns.
- **Came from report**: `my-plugins/manage-extensions/_scan_ux_report.md`
- **Why it’s uncertain**: Resetting the cancel arming could be deliberate to prevent accidental cancellation after navigating contexts/columns. It might also be an oversight that unnecessarily burdens the user.

### Q3: `buildChanges` silently drops entries not found in `states` — intended filtering vs missing warning?
- **Issue description**: `buildChanges` skips pending entries whose `absolutePath` cannot be found in the `states` map (a `continue`), without notifying the user.
- **Came from report**: `my-plugins/manage-extensions/_scan_robustness_report.md`
- **Why it’s uncertain**: This could be intentional (e.g., stale pending entries from a previous scan, or a safety filter to avoid acting on unknown paths). It may also represent a real bug where scan/apply state diverges and the user should be informed.

### Q4: Missing source existence checks may create dangling symlinks — intended tradeoff vs bug?
- **Issue description**: In the “create” branch during apply, symlinks are created via `symlinkSync(relative(dir, ext.absolutePath), linkPath)` without verifying the source (`ext.absolutePath`) still exists at apply time. Preflight collection also doesn’t check `existsSync(ext.absolutePath)`.
- **Came from report**: `my-plugins/manage-extensions/_scan_robustness_report.md`
- **Why it’s uncertain**: The design may intentionally assume the filesystem state won’t change between scan and apply (favoring simplicity/performance). However, if the repository folder can change (e.g., user deletes/moves directories), dangling symlinks would be a user-visible bug.

### Q5: `discover-extensions` ignores symlinked extensions — intentional omission vs missing support?
- **Issue description**: `discover-extensions.ts` uses `Dirent.isFile()` / `Dirent.isDirectory()` without handling symlinks, so symlinked extensions inside repo directories may be silently skipped.
- **Came from report**: `my-plugins/manage-extensions/_scan_robustness_report.md`
- **Why it’s uncertain**: It’s unclear whether symlinked extensions are intentionally unsupported (e.g., to avoid circular paths or unexpected resolution). Alternatively, it may be an accidental limitation that should at least warn or be configurable.

### Q6: `index.ts` reload failure handling — should errors be surfaced to user?
- **Issue description**: `index.ts` uses `ctx.reload()` with an apparent absence of `try/catch`. If it rejects, it may become an unhandled rejection, and the user may not receive a clear “reload failed” notification.
- **Came from report**: `my-plugins/manage-extensions/_scan_robustness_report.md`
- **Why it’s uncertain**: Some applications intentionally rely on a global error boundary/handler for reload failures. Without observing the surrounding runtime (how `ctx.reload()` is handled elsewhere), it’s uncertain whether this should be treated as a definite bug.

### Q7: UX “helped up” via hardcoded key literals — must it be configurable?
- **Issue description**: Hardcoded key literals appear in `createKeyMap` (e.g., left/right/shiftTab/space), suggesting parts of key handling may bypass the configurable keybinding system.
- **Came from report**: `my-plugins/manage-extensions/_scan_quality_report.md`
- **Why it’s uncertain**: The scanner flagged it as “hardcoded key literals/bypass” but it’s unclear if these keys are intentionally meant to be fixed regardless of user config (e.g., navigation semantics that must remain stable).
