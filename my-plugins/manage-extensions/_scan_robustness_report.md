# Robustness Scan Report — `manage-extensions`

## Methodology Application

**Phase 0 — Scope**: Six files examined:
- `index.ts` — plugin entry, orchestration flow
- `extension-list.ts` — TUI list component, pending-changes map
- `apply-changes.ts` — symlink create/remove, preflight checks
- `resolve-state.ts` — symlink state resolution
- `discover-extensions.ts` — repo scanning, extension discovery
- `scan-cache.ts` — background scan caching

**Phase 1 — Atomic propositions extracted**: error handling contracts, null-safety assumptions, FS operation guards, state consistency invariants, async gaps.

**Phase 2 — Cross-checked** propositions against actual code paths to find contradictions and gaps.

**Phase 3 — Design-point matrix** covered: async error propagation, symlink lifecycle, cache consistency, discovery completeness, UI state, preflight/apply alignment.

---

## Issues Found

---

### ISSUE-1 — `ctx.reload()` rejection is unhandled

**Severity: major**
**File: `index.ts`, line ~117**

```ts
clearCache();
ctx.ui.notify(`Applied ${applied.length} change(s). Reloading...`, "info");
await ctx.reload();
```

`ctx.reload()` is awaited inside an `async` command handler with no surrounding `try/catch`. If it rejects, the error propagates as an unhandled promise rejection. The cache has already been cleared at this point, so the next invocation will trigger a fresh scan — but the user receives no notification of the reload failure and the plugin exits silently.

---

### ISSUE-2 — Dangling symlink created without warning when source path no longer exists

**Severity: major**
**File: `apply-changes.ts`, lines ~155–166 (`applyOne` create branch)**

```ts
} else if (!change.from && change.to) {
    try {
        mkdirSync(dir, { recursive: true });
        symlinkSync(relative(dir, ext.absolutePath), linkPath);
        applied.push(`${ext.name}: ${scope} ON`);
    } catch (err) {
        warnings.push(`${ext.name}: failed to create symlink — ${err}`);
    }
}
```

`symlinkSync` is called with `ext.absolutePath` as the target without first verifying that path exists on disk. If the extension's source directory has been deleted or moved between the scan and the apply step, a dangling symlink is silently created and reported as a success in `applied`.

The preflight pass (`collectPreflightIssues`) also does not check `existsSync(ext.absolutePath)`, so the issue passes through preflight undetected too.

**Impact**: The symlink appears as "ON" in a subsequent resolve pass because `isSymlinkedIn` only checks that a symlink exists and its resolved target matches `ext.absolutePath` — which would still match even for a dangling symlink, as long as the path string matches.

---

### ISSUE-3 — EEXIST from `symlinkSync` silently demoted to warning

**Severity: minor**
**File: `apply-changes.ts`, lines ~155–166 (`applyOne` create branch)**

There is no `existsSync(linkPath)` guard before `symlinkSync`. If a stale or unrelated file/symlink already exists at `linkPath` (e.g. from a partially completed prior run, a file not caught by preflight because it was created after preflight ran), `symlinkSync` throws `EEXIST`. This exception is caught and pushed to `warnings`, not `applied`, so the operation silently fails.

The preflight `collectPreflightIssues` does check for a pre-existing `linkPath` when `change.from === false && change.to === true` (lines ~68–96 of apply-changes.ts), but that check only runs before the UI is shown. There is a window between preflight and apply where the path could be created externally.

**Impact**: The user sees a warning message but no explanation that the symlink was not created. A subsequent re-run would show the extension still as OFF and try again.

---

### ISSUE-4 — Symlinked extension entries in repo directories are silently skipped

**Severity: major**
**File: `discover-extensions.ts`, lines ~89–93**

```ts
if (entry.isFile() && /\.[tj]s$/.test(entry.name)) {
    results.push(...);
} else if (entry.isDirectory() && isExtensionDir(fullPath)) {
    results.push(...);
}
```

`readdirSync` is called with `{ withFileTypes: true }`, returning `Dirent` objects. `Dirent.isFile()` and `Dirent.isDirectory()` **do not follow symlinks** — they return `false` for symbolic links even if the link target is a file or directory. `Dirent.isSymbolicLink()` would return `true` instead.

As a result, any extension that is itself a symlink inside a repo directory (a common pattern when developers symlink a local extension into a repo for testing) is silently ignored. No warning or log entry is emitted.

**Impact**: User adds an extension via a symlink in the repo dir; it never appears in the extension list with no explanation.

---

### ISSUE-5 — `done` callback in `buildListComponent` can be called more than once

**Severity: minor**
**File: `extension-list.ts`, `activateCurrentAction` and `handleInput`**

The `done` callback (called with `{ action: "apply" }`, `{ action: "cancel" }`, or `{ action: "back" }`) has no guard against being invoked multiple times. A user could theoretically trigger it twice if input events are processed in quick succession (e.g. a debounced key that fires twice before the component unmounts). `done` is not idempotent — calling it twice would resolve the outer `Promise<ListResult>` twice (harmless for the Promise itself, since subsequent resolves are no-ops) but would call the TUI `done()` callback twice, potentially corrupting TUI state.

The scan UI in `index.ts` (line ~37–49) shows the correct pattern: a `closed` boolean guard prevents double-invocation of `done`. The list component does not apply the same guard.

---

### ISSUE-6 — `onProgress` callback invocations in `discoverExtensions` are unguarded

**Severity: minor**
**File: `discover-extensions.ts`, multiple call sites (lines ~49, ~63, ~79, ~87, ~101)**

```ts
onProgress?.({ phase: "scanning-entries", ... });
```

These optional-chain calls invoke the caller-supplied callback without a `try/catch`. If any `onProgress` handler throws (e.g. a UI render error, a programming mistake in the callback), the exception propagates out of `discoverExtensions` and unwinds the scan mid-pass with partial results. The error would surface as a scan failure in `scan-cache.ts`'s catch block and be reported as `result.error`, but the cause (a callback throw vs. a genuine discovery error) would be indistinguishable to the user.

---

### ISSUE-7 — `isSymlinkedIn` uses `existsSync` + `lstatSync` with a TOCTOU gap

**Severity: minor**
**File: `resolve-state.ts`, lines ~28–36**

```ts
const linkPath = join(targetDir, ext.name);
if (!existsSync(linkPath)) return false;
try {
    const stat = lstatSync(linkPath);
    ...
}
```

`existsSync` is called, then `lstatSync` on the same path. Between the two calls, the path could be removed (e.g. by a concurrent terminal session or another process). `lstatSync` would then throw `ENOENT`. The `catch` block catches this and returns `false`, so there is no crash — but this is a silent TOCTOU. The code is correct by accident: the catch-all handles it, but the intent is not documented and the `existsSync` pre-check gives a false sense of safety.

This is low-impact in practice (single-user CLI, unlikely concurrent mutation), but the pattern is inherently fragile.

---

### ISSUE-8 — `buildChanges` silently drops pending entries whose state is no longer found

**Severity: minor**
**File: `index.ts`, `buildChanges` function (~lines 123–148)**

```ts
for (const [absolutePath, p] of pending) {
    const st = states.find((s) => s.extension.absolutePath === absolutePath);
    if (!st) continue;  // silently skipped
    ...
}
```

If `pending` contains an entry whose `absolutePath` no longer appears in `states` (e.g. because `states` was constructed from a stale scan result), the pending change is silently discarded. The user selected an action for that extension; it is never applied and never mentioned in warnings or notifications.

This can happen if `states` is built from an old cached scan and a new extension was added between scans — though in practice the cache is cleared on apply and states are built fresh each run, so the window is narrow. Still, the silent drop is a robustness gap.

---

## Overall Assessment

The plugin is generally well-structured. The most significant gaps are:

| # | Severity | Area |
|---|----------|------|
| ISSUE-1 | major | `ctx.reload()` unhandled rejection |
| ISSUE-2 | major | Dangling symlinks created silently |
| ISSUE-4 | major | Symlinked extensions in repos silently ignored |
| ISSUE-3 | minor | EEXIST silent failure in apply |
| ISSUE-5 | minor | Double-invocation of `done` callback possible |
| ISSUE-6 | minor | `onProgress` throws propagate as scan errors |
| ISSUE-7 | minor | TOCTOU in `isSymlinkedIn` (benign catch) |
| ISSUE-8 | minor | Silent pending-entry drop in `buildChanges` |

**Critical issues**: none.

**Top priority fixes**:
1. **ISSUE-2**: Add `existsSync(ext.absolutePath)` check in both preflight and `applyOne` before creating a symlink.
2. **ISSUE-4**: Use `entry.isSymbolicLink()` branch in `discoverExtensions` with `statSync` follow to determine whether the symlink target is a file or directory, and include it if valid.
3. **ISSUE-1**: Wrap `ctx.reload()` in `try/catch` and notify the user on failure.
