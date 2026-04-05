# Manage Extensions

Interactively enable or disable discovered Pi extensions for the current project (`local`) or your global agent profile (`global`).

## What it does

`/manage-extensions` scans all configured extension repositories, shows a compact selector-style panel, and lets you toggle each extension in:

- **Local scope** → `.pi/extensions/`
- **Global scope** → `~/.pi/agent/extensions/`

Activating an extension creates a symlink into the target scope; deactivating removes the symlink if it points to that extension.

After applying changes, Pi reloads automatically.

## Repository configuration

Repositories are configured in `extension-repos.json` either in:

- project: `.pi/extension-repos.json`
- global: `~/.pi/agent/extension-repos.json`

Example:

```json
[
  {
    "name": "my-plugins",
    "path": "/absolute/path/to/my-plugins"
  }
]
```

Each entry must have:

- `name`: label shown in the UI
- `path`: absolute path to the repository root

Repos from local and global config are merged and deduplicated by resolved path.

## What counts as an extension

Within a configured repo, the scanner accepts:

- `*.ts` or `*.js` files
- directories containing `index.ts` or `index.js`
- directories whose `package.json` declares `pi.extensions`

If a repo cannot be read, the scan reports it explicitly.

## Discovery and conflicts

When launched, the command starts a background scan.

- If a cached scan result is available, the list opens immediately.
- Otherwise, a small live scan progress screen is shown first.

If two extensions across repos share the same exported extension name, Pi warns about the conflict. Conflicting names must be resolved by selection before a clean apply is possible.

## UI layout

The panel is intentionally compact and selector-like:

- title row
- search row
- one-line status/context row
- fixed-height list window with internal scrolling
- one-line action bar
- one-line help row

The list window keeps a stable height inside the current terminal budget, even when the filtered result set becomes short or empty.

Each row looks like:

```text
L  G  repoName/extensionName
```

Where:

- `L` = local scope
- `G` = global scope
- filled token = enabled
- dim token = disabled
- highlighted token = currently selected scope column in scope-picker mode
- pending edits are shown inline by changed token styling

## Interaction model

The panel has three modes:

- **List** → search and browse
- **Scope** → edit `L/G` for the selected extension
- **Actions** → bottom action bar (`Apply / List / Cancel`)

### List mode

- Type to search/filter extensions
- `Up/Down` moves the selected row
- `Enter` enters the scope picker for the selected row
- `Tab` or `Shift+Tab` moves to the action bar
- `Esc` / `Ctrl+C`:
  - clears search first if search is non-empty
  - otherwise arms cancel on the first press
  - exits on the second press

### Scope mode

- `Left/Right` chooses `L` or `G`
- `Space` toggles the currently selected scope
- `Up/Down` keeps moving between rows while staying in scope mode
- `Enter` or `Esc` / `Ctrl+C` returns to list mode
- `Tab` or `Shift+Tab` moves to the action bar

This split avoids the old conflict where search-input cursor movement and scope editing competed for the same keys.

### Actions mode

Actions are:

- `Apply`
- `List`
- `Cancel`

Keys:

- `Left/Right` moves between actions
- `Enter` or `Space` activates the current action
- `Tab`, `Shift+Tab`, `Esc`, or `Ctrl+C` returns to list mode

Notes:

- `Apply` is disabled if there are no pending changes or preflight blocking issues exist.
- `List` just returns focus to the list; it does not reopen the component.
- `Cancel` exits the panel without applying changes.

## Apply behavior

Before apply, the command runs a preflight check over the pending changes.

Typical checks include:

- duplicate-name conflicts
- filesystem issues
- other blocking activation problems

If changes are applied successfully:

1. symlinks are created/removed as needed
2. the extension scan cache is cleared
3. Pi reloads

If nothing changed, the command reports that explicitly.

## Notes

- Local and global toggles are independent.
- Deactivation only removes the symlink in the selected scope.
- The command uses relative symlinks where possible.
- The panel now derives its help text from real standard TUI keybinding ids where available, and uses direct physical-key matching for `left/right/shift+tab/space` so it works on standard pi builds without patching pi source.
