# oh-my-pi v2

A thin Sisyphus runtime for pi that defines agent personalities, behavioral hooks, and task management.

## Architecture

- **Sisyphus persona** — core orchestration identity
- **16 sub-agent `.md` files** — installed as individual agents
- **Boulder loop** — auto-restarts the agent when actionable tasks remain (`in_progress` or ready/unblocked `pending`)
- **Quality hooks** — comment checker, edit error recovery, tool output truncator, rules injector, custom compaction
- **Task management** — task tool with dependencies, blocking, and TUI widget
- **Commands** — `/omp-start` (two-stage workflow), `/omp-ultrawork` (4-stage execution), `/omp-consult` (Oracle consultation), `/omp-review-plan` (plan review)
- **Skills** — pre-publish-review, github-triage

oh-my-pi v2 does NOT provide delegation execution. It assumes the `subagent` tool exists (provided by pi-subagents).

For detailed architecture documentation, see `docs/ARCHITECTURE.md`.

## Required Extension

- `pi-subagents` — required for subagent execution

## Recommended Extensions

- `pi-web-access` — web search, fetch, GitHub cloning
- `pi-intercom` — runtime communication between agents

## Optional MCP Support

- `pi-mcp-adapter` — optional MCP integration

## Configuration

```jsonc
{
  "disabled_agents": ["momus"],
  "boulder_enabled": true,
  "sisyphus_rules_enabled": true,
  "categories": {
    "ultrabrain": ["atlas", "prometheus"]
  },
  "default_model": "claude-3.5-sonnet"
}
```

User config: `~/.pi/oh-my-pi.jsonc`
Project config: `.pi/oh-my-pi.jsonc`

Project config overrides user config.

## Default Categories

1. `visual-engineering`
2. `ultrabrain`
3. `deep`
4. `artistry`
5. `quick`
6. `unspecified-low`
7. `unspecified-high`
8. `writing`

Categories are advisory. Sisyphus makes the final routing decision.

## Configuration Merging

- `disabled_agents` values are unioned between user and project config
- `categories` are shallow-merged per key
- All other keys are project-overrides-user

## Uninstallation

Remove symlinks from `~/.pi/agent/agents/` manually.

## Directory Structure

```text
oh-my-pi-v2/
├── agents/
├── hooks/
├── tools/
├── commands/
├── skills/
├── config.ts
├── index.ts
└── package.json
```
