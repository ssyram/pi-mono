# oh-my-pi v2

Current package version: `0.2.0`.

A thin Sisyphus runtime for pi that defines agent personalities, behavioral hooks, and task management.

## Architecture

- **Sisyphus persona** — core orchestration identity
- **16 sub-agent `.md` files** — installed as individual agents
- **Boulder loop** — auto-restarts the agent when actionable tasks remain (`in_progress` or ready/unblocked `pending`)
- **Quality hooks** — comment checker, edit error recovery, tool output truncator, rules injector, custom compaction
- **Task management** — task tool with dependencies, blocking, a compact TUI widget, and bounded Boulder continuation
- **Commands** — `/task`, `/omp-start` (two-stage workflow), `/omp-ultrawork` (4-stage execution), `/omp-consult` (Oracle consultation), `/omp-review-plan` (plan review)
- **Skills** — pre-publish-review, github-triage

oh-my-pi v2 does NOT provide delegation execution. It assumes the `subagent` tool exists (provided by pi-subagents).

For detailed architecture documentation, see `docs/ARCHITECTURE.md`. The Task List v0.2.0 contract and correctness argument are in `docs/task-list-v0.2.0.md`.

## Task List v0.2.0

### Widget and inspection

- Every compact task row occupies one terminal line. Long or multi-line text is whitespace-normalized and display-width truncated with `…`.
- Unfinished groups keep execution order. `done` and `expired` groups display newest IDs first.
- Blocked rows reserve space for up to three unresolved blocker IDs (`← #1,#2,#3,…`) before truncating task text.
- `/task show on` and `/task show off` control the widget for the current session branch without disabling task tracking.
- `/task info` prints every task field and full text without compact-row truncation.
- `/task help` and bare `/task` show command help.
- `/task` arguments use prompted, hierarchical completion matching `/impression`: `show|info|help`, then `show on|off`.

### Model context and continuation

- Normal user/RPC turns do not receive a dynamic task-list system-prompt suffix. The model can query the task tool explicitly.
- Boulder continuation uses a labelled `omp-boulder-resume` custom message containing actionable tasks plus the `<CONFIRM-TO-STOP/>` escape protocol. Its collapsed renderer displays `↻ Automatic Boulder resume`; expanded rendering shows the exact model-visible content.
- Historic resume messages remain auditable in the session log but are filtered from later model context and custom compaction.
- Interactive/RPC input and non-Boulder custom information cancel a pending continuation. Queued external follow-ups finish before a new episode may start.
- Print mode (`-p`) allows at most three attempts at `10s` each. Other modes allow ten attempts at `10s, 10s, 10s, 20s, 40s, 80s, 160s, 320s, 640s, 1280s`.
- Scheduling immediately appends the AI-invisible entry `↻ Automatic Boulder n/N resume scheduled, restarting in XXs`; the status line refreshes the live countdown. Escape cancels the current wait.

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
├── docs/
├── test/
├── config.ts
├── extension.ts
├── index.ts
└── package.json
```
