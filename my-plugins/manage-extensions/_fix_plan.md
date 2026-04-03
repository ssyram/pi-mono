# Consolidated Fix Plan (manage-extensions)

## 1) MAJOR / CRITICAL issues found (grouped by theme)

### A. Input/interaction: broken or missing key handling & feedback
1. **[CRITICAL/MAJOR] Shift+Tab in list focus corrupts search filtering**
   - Root: `extension-list.ts` key handling in `createKeyMap()` lacks a `shiftTab` branch for list focus, so the key gets forwarded into `searchInput` and mutates `searchInput`.
2. **[MAJOR] Apply action has no user feedback when disabled**
   - Root: `extension-list.ts` `activateCurrentAction()` returns early on `action === "apply"` when `canApply()` is false (no `done(...)`, no notification).
3. **[MAJOR] Misleading final apply notification**
   - Root: `index.ts` decides success solely via `applied.length > 0`; when all operations fail into warnings, the UI can still end with **“No changes applied.”**
4. **[MAJOR] Name-conflict handling exits immediately with no recovery path**
   - Root: `index.ts` on duplicate extension names notifies conflicts and then returns; there is no in-TUI “resolve” workflow or actionable next-step guidance besides editing `extension-repos.json`.
5. **[MAJOR] Scan progress “Esc closes view” but scan cannot be cancelled**
   - Root: `index.ts` scan progress component calls `done()` to close the component, while background scan continues because `scan-cache.ts` has no cancellation mechanism.

### B. Correctness: filesystem/symlink handling gaps
6. **[MAJOR/CRITICAL] Symlink creation can produce dangling links**
   - Root: `apply-changes.ts` create path attempts `symlinkSync(...)` without validating `ext.absolutePath` exists.
7. **[MAJOR/CRITICAL] Extension discovery ignores symlinked extension directories**
   - Root: `discover-extensions.ts` uses `readdirSync(..., { withFileTypes: true })` and only handles `entry.isFile()` / `entry.isDirectory()`; symlinked extension dirs are not considered.

### C. Robustness: error handling / state integrity issues
8. **[MAJOR] Unhandled rejection risk around `ctx.reload()`**
   - Root: `index.ts` clears cache then does `await ctx.reload()` without a `try/catch` guard.
9. **[MAJOR] `discover-extensions.ts` silently swallows repo/config errors**
   - Root: `loadRepos()` and repo directory reads have broad try/catch with “continue silently”; users get “no extensions found” with no indication of partial failures.
10. **[MAJOR] Pending change entries can be silently dropped**
   - Root: `index.ts` `buildChanges(...)` loops `for (const [absolutePath, p] of pending)` and does `if (!st) continue;`, which drops pending toggles that have no matching `ExtensionState`.

### D. Code quality / maintainability (structural refactor triggers)
11. **[CRITICAL] `extension-list.ts` exceeds LOC limit and violates SRP**
   - Root: `extension-list.ts` is ~360 total lines / ~324 code lines; combines key map factory, state accessors, list rendering, tokens rendering, search utilities, etc.
12. **[CRITICAL] Hardcoded key literals bypass keybinding system**
   - Root: `extension-list.ts` `createKeyMap()` uses non-configurable literals (e.g., confirm newline/carriage-return, space `