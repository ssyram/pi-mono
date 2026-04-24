# revision

A pi plugin that replaces previous assistant responses by generating a new response on the original context, then restructuring the session tree.

## Usage

```
/revise [--upto N] [--no-summary | --visible-summary] prompt
```

- `--upto N` — how many user turns back to target (default: 1, the most recent)
- `--no-summary` — skip recap generation
- `--visible-summary` — make the recap visible to the LLM
- `prompt` — your revision instructions

## How it works

1. **Generate on original branch**: The plugin sends a revise instruction (`"Revise the above N assistant response(s) with these instructions: {prompt}"`) via `sendUserMessage`. The LLM sees the full original context — including the assistant content being replaced — naturally.

2. **Restructure tree**: After generation completes, the plugin:
   - Branches from the target user turn's parent
   - Duplicates the target user turn onto the new branch
   - Inserts a revision box (with async recap)
   - Copies the new assistant response(s) onto the clean branch

3. **Recap**: A background LLM call summarizes the replaced content. The recap appears in the revision box (collapsed by default, expandable via Ctrl+O).

## Result

The active branch shows: `history → duplicated user turn → revision box → new assistant response`.

The old branch (with original answers + revise instruction) remains accessible in the session tree.

## Summary modes

| Mode | LLM sees | UI shows |
|---|---|---|
| `hidden-summary` (default) | Continuity stub | Recap in collapsible box |
| `--visible-summary` | Recap content | Recap in collapsible box |
| `--no-summary` | No-summary stub | Short selection message |

## Known limitations

- **Plugin-only tree semantics**: The target user turn is duplicated (not shared with the original node). This is an inherent limitation of the plugin API.
- **Recap persistence**: Recap text is ephemeral (in-memory). After session reload, the revision box shows the state at creation time.
- **Dead branch storage**: The revise instruction and generated response remain on the old dead branch. Redundant but harmless.
- **Concurrent revisions**: Only one `/revise` can run at a time. A second attempt is rejected.
