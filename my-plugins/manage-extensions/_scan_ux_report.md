# UX Interaction Scan Report — manage-extensions

## 1. Methodology Summary

Applied the four-phase finegrained-check methodology scoped to UX interaction quality:

- **Phase 0 (Scope):** UX interaction — keyboard, navigation, feedback, state changes, edge cases.
- **Phase 1 (Propositions):** Extracted atomic behavioral statements from all six files, anchored to specific code locations.
- **Phase 2 (Cross-check):** Checked each proposition against actual runtime behavior: what the user sees/experiences vs. what the code does.
- **Phase 3 (Coverage matrix):** Mapped focus states × key events × feedback channels to find uncovered pairs.
- **Phase 4 (Summary):** Ranked findings by user impact.

Files read in full: `index.ts`, `extension-list.ts`, `apply-changes.ts`, `resolve-state.ts`, `discover-extensions.ts`, `scan-cache.ts`.

---

## 2. Issues Found

---

### Issue 1 — Shift+Tab in list focus types into search field

**Severity:** Major

**File:** `my-plugins/manage-extensions/extension-list.ts`

**Evidence:**

In the list-focus block of `handleInput`, only `keys.tab(data)` is checked (which calls `focusActions()`). There is no `keys.shiftTab(data)` branch. All unhandled keys fall through to the final two lines:

```ts
searchInput.handleInput(data);
applyFilter();
```

So pressing Shift+Tab while in list mode passes the raw keydata to the search input, which inserts a garbage character into the search field instead of doing something useful (e.g., cycling backward through actions, or at least being a no-op).

In actions mode, both `keys.tab` and `keys.shiftTab` correctly call `focusList()`, so the asymmetry is visible by contrast.

**User impact:** Pressing Shift+Tab from the list corrupts the search string with an invisible/garbage character, causing the extension list to unexpectedly filter. The user cannot tell why the list changed.

---

### Issue 2 — Pressing Apply when disabled gives no feedback

**Severity:** Major

**File:** `my-plugins/manage-extensions/extension-list.ts`

**Evidence:**

`activateCurrentAction()` silently returns when Apply is disabled:

```ts
function activateCurrentAction(): void {
    const action = actions[actionIndex];
    if (action === "apply") {
        if (!canApply()) return;   // silent bail-out
        done({ action: "apply" });
        return;
    }
    ...
}
```

`focusActions()` skips past Apply when nothing is pending (`actionIndex = canApply() ? 0 : 1`), so the user can only land on disabled Apply via left/right navigation in the actions bar. When they do and press Enter, nothing happens — no message, no visual change, no hint.

The render method shows a muted "Apply" label when disabled, which is correct, but pressing Enter on it is a silent no-op with zero feedback.

**User impact:** User presses Enter on the visually-present (though muted) Apply button and receives no acknowledgment — looks broken.

---

### Issue 3 — Enter key toggles items in list mode but help text only shows Space

**Severity:** Minor

**File:** `my-plugins/manage-extensions/extension-list.ts`

**Evidence:**

In the list-focus block, `keys.confirm(data)` (Enter) calls `toggleSelected()`, identical to the Space handler:

```ts
if (keys.up(data)) { moveSelection(-1); return; }
if (keys.down(data)) { moveSelection(1); return; }
if (keys.left(data)) { moveColumn(0); return; }
if (keys.right(data)) { moveColumn(1); return; }
if (keys.space(data)) { toggleSelected(); return; }
if (keys.confirm(data)) { toggleSelected(); return; }   // Enter also toggles
```

The help line reads: `"Type to search · ↑/↓ move · ←/→ Local/Global · Space toggle · Tab actions"`

Enter is not mentioned. This is a discoverability miss: the more natural key (Enter) is unlisted.

**User impact:** Minor — Space still works. But users accustomed to pressing Enter to confirm/toggle will hit an undocumented behavior; users learning from the hint line won't know Enter works.

---

### Issue 4 — "No changes applied" message when apply actually failed

**Severity:** Major

**File:** `my-plugins/manage-extensions/index.ts`

**Evidence:**

After `applyChanges()`, the code notifies each warning individually, then:

```ts
if (applied.length === 0) {
    ctx.ui.notify("No changes applied.", "warning");
    return;
}
```

When every `applyOne` call fails with an fs error (they push to `warnings[]` and return without adding to `applied[]`), the user sees N individual warning notifications followed by "No changes applied." The final message contradicts the reality: changes *were* attempted but all failed. "No changes applied" reads as "nothing to do" rather than "all operations failed."

**User impact:** User cannot distinguish between "nothing was pending" and "every operation errored out" from the final notify alone. The individual warning notifies appear above and may scroll off.

---

### Issue 5 — Name conflicts abort entirely with no path to resolve

**Severity:** Major

**File:** `my-plugins/manage-extensions/index.ts`

**Evidence:**

```ts
for (const [name, extensions] of conflicts) {
    ctx.ui.notify(`Conflict: "${name}" found in ...`, "warning");
}
ctx.ui.notify("Resolve duplicate extension names ...", "warning");
return;   // plugin exits
```

When name conflicts are found, the plugin shows notifications and exits. The user is told to resolve conflicts, but the plugin gives no indication of *how* to do so (which config file to edit, what a conflict means in terms of paths), and there is no way to re-run the scan from within the plugin after fixing the issue.

**User impact:** User sees a warning and is dumped back to whatever they were doing. The only recovery path is to manually edit `extension-repos.json`, then re-invoke the command — neither step is explained in the notification text.

---

### Issue 6 — Silent partial failure when repos are misconfigured

**Severity:** Minor

**File:** `my-plugins/manage-extensions/discover-extensions.ts`

**Evidence:**

`loadRepos` silently `continue`s on:
- Missing repo directory (`!existsSync`)
- `readdirSync` failure (caught exception)
- Malformed `extension-repos.json` (caught exception)

The only user-visible result is that `discoverExtensions` returns a shorter (or empty) list. `index.ts` catches the empty-list case:

```ts
if (result.extensions.length === 0) {
    ctx.ui.notify("No extensions found. Check extension-repos.json...", "warning");
    return;
}
```

But this message fires even when *some* repos loaded fine and others silently failed. A user with 3 repos, where one has a bad path, gets a subtly wrong list with no indication that a repo was skipped.

**User impact:** User can't tell if a missing extension is "not installed" or "scan failed to find its repo." Debugging requires manual inspection.

---

### Issue 7 — Esc cancel-arm resets on left/right column switch

**Severity:** Minor

**File:** `my-plugins/manage-extensions/extension-list.ts`

**Evidence:**

`moveColumn()` calls `cancelArmed = false`. So pressing Esc once (arms cancel), then pressing ← or → to check the other column's state, then pressing Esc again does NOT cancel — the second Esc re-arms. This is inconsistent with the user's mental model: they armed cancel, then looked at something, and expect the second Esc to still cancel.

```ts
function moveColumn(next: number): void {
    column = next;
    cancelArmed = false;   // resets armed state
}
```

The same reset happens in `moveSelection` and `toggleSelected`, which is more defensible (those are forward actions), but column-switching is a view-only read action, not a state-changing action.

**User impact:** Minor — user presses Esc → ← → Esc and nothing happens when they expected to cancel. They need a third Esc.

---

### Issue 8 — Escape from scan progress screen does not cancel the scan

**Severity:** Minor

**File:** `my-plugins/manage-extensions/index.ts`

**Evidence:**

The scan progress screen shows Esc as a dismiss action:
```ts
// Progress component handles only one key: Escape → calls done()
```

The scan continues running in the background after dismissal (it's a background promise). The progress screen communicates this ("Scanning will continue in background" or similar), so it is not a surprise. However, there is no way to *actually cancel* the scan — it always runs to completion even if the user has already decided they don't need it.

This is an intentional design choice but creates a minor UX gap: the user cannot abort a long scan even if they invoked the command by mistake.

**User impact:** Long scan cannot be interrupted. Low impact for fast scans; annoying for large extension repos.

---

### Issue 9 — `while (true)` loop in index.ts is dead code

**Severity:** Minor (code quality → no UX behavior, but indicates a broken "back" navigation design)

**File:** `my-plugins/manage-extensions/index.ts`

**Evidence:**

```ts
while (true) {
    const uiResult = await ctx.ui.select(listComponent);
    if (uiResult.action !== "back") break;
    // recalculate preflightIssues and loop
}
```

`extension-list.ts`'s `actions` array is `["apply", "list", "cancel"]`. The `"list"` action calls `focusList()` internally without calling `done()` — it never produces a `ListResult`. Only `"apply"` and `"cancel"` call `done()`. So `uiResult.action` is always `"apply"` or `"cancel"`, never `"back"`. The loop body never iterates past the first `select` call.

The intended design was presumably to allow the user to go "back" (e.g., after viewing preflight issues) and have them recomputed, but that path is unimplemented. The preflight issues shown on screen are never refreshed.

**User impact:** Preflight issues displayed in the list are stale if they could change during a session (they cannot in current code, but the intent was there). No direct UX breakage today.

---

## 3. Overall Assessment

The core interaction loop (search, toggle, apply) is solid. The fuzzy search, scroll window, column switching, and action bar navigation all function correctly. The visual hierarchy (muted disabled states, preflight warnings) is present.

The most impactful issues are:

1. **Shift+Tab corrupts search** (Issue 1) — observable, reproducible breakage.
2. **Silent Apply failure message** (Issue 4) — misleads user about what happened.
3. **Silent disabled-Apply key press** (Issue 2) — looks broken to user.
4. **Conflict handling exits with no recovery path** (Issue 5) — forces the user out with no actionable guidance.

Issues 3, 6, 7, 8, 9 are minor discoverability and polish gaps. None are showstoppers, but together they create a rough-edged experience in error/edge-case paths.
