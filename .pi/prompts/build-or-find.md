---
description: "Evaluate whether a feature exists in local plugins/packages or needs to be built as a new extension"
---

I have a feature request: **$ARGUMENTS**

## Workflow

### Step 1: Search Existing Capabilities

Search these locations exhaustively for anything that already provides or can be composed to provide this feature:

1. **`my-plugins/`** — all local plugin directories and standalone `.ts` files
2. **`.pi/extensions/`** — project-level extensions
3. **`packages/coding-agent/examples/extensions/`** — official example extensions
4. **`packages/coding-agent/src/core/extensions/`** — extension API surface (check if built-in features cover it)
5. **`packages/agent/`** — core agent capabilities that might already expose this

For each match found, report:
- File path
- What it does
- How close it is to the requested feature (exact match / partial / composable)

### Step 2: Evaluate Composition

If no exact match exists, check whether the feature can be achieved by:
- Simple configuration changes (settings, flags, env vars)
- Combining 2-3 existing extensions/hooks without writing new code
- Minor modification of an existing extension (< 20 lines changed)

### Step 3: Recommend

Based on findings, recommend ONE of:
1. **Already exists** — point to it, explain how to enable/use it
2. **Composable** — describe the exact configuration/composition needed
3. **Build new** — specify which extension hooks/APIs to use, outline the implementation approach, and suggest placement (`my-plugins/` for personal, `.pi/extensions/` for project-level)

Do NOT implement unless I explicitly ask. Report findings and recommendation only.
