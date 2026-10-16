# oh-my-pi v2

Current package version: `0.2.0`.

A thin Sisyphus runtime for pi that defines agent personalities, behavioral hooks, and task management.

## Architecture

- **Sisyphus persona** — core orchestration identity
- **16 sub-agent `.md` files** — installed as individual agents
- **Boulder loop** — auto-restarts the agent when actionable tasks remain (`in_progress` or ready/unblocked `pending`)
- **Quality hooks** — comment checker, edit error recovery, tool output truncator, rules injector, custom compaction. Each newly generated read/modified path array uses an iterative prefix trie, e.g. `A/{B/{C,D},E/F}`; previous summaries are not recompressed. Opaque elements, including existing brace expressions, remain raw and do not block safe branches. Details and confirmed QPDI design are in [`docs/simplify-compact-20260911/`](docs/simplify-compact-20260911/README.md).
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
- `/task show on|off [--persistent] [--global]` controls the widget without disabling task tracking. It uses my-settings key `omp-task:show` (default true); by default only the current session branch is saved.
- `/task info` prints every task field and full text without compact-row truncation.
- `/task help` and bare `/task` show command help.
- `/task` arguments use prompted, hierarchical completion for task operations, widget controls, and gate settings.

### Tool gate

- `/task no-task-no-tool on|off [--persistent] [--global]` uses my-settings key `omp-task:no-task-no-tool` (default true). Default saves only the session; `--persistent` additionally saves project `.pi/settings.json`, and `--global` additionally saves global `settings.json`. Flags can be combined; `--global` does not imply local.
- Both task settings use defaults < global < local < current-branch session values. OMP directly imports and awaits `../my-settings/index.ts`; configuration calls use its client. There is no second task setting cache or store.
- `off` only disables the requirement for an unblocked in-progress task before non-task tools. Task tracking, widget controls, Boulder, and prompt rules are unchanged. Exact `task` remains exempt even when the settings service is unavailable.
- Requested file failures are reported without overwriting corrupt files; the session save is still attempted once. Session failure reports uncertainty, never false success or rollback. Missing service returns an explicit installation/unavailable error, not defaults. Old `task.json` and `omp-task-widget-state` entries are no longer read or written; no automatic data migration is performed. Details and current evidence: [`docs/task-system/settings.md`](docs/task-system/settings.md).

### Model context and continuation

- Normal user/RPC turns do not receive a dynamic task-list system-prompt suffix. The model can query the task tool explicitly.
- Boulder continuation uses a labelled `omp-boulder-resume` custom message containing actionable tasks plus the `<CONFIRM-TO-STOP/>` escape protocol. Its collapsed renderer displays `↻ Automatic Boulder resume`; expanded rendering shows the exact model-visible content.
- Historic resume messages remain auditable in the session log but are filtered from later model context and custom compaction.
- Interactive/RPC input and non-Boulder custom information cancel a pending continuation. Queued external follow-ups finish before a new episode may start.
- Print mode (`-p`) allows at most three attempts at `10s` each. Other modes allow ten attempts at `10s, 10s, 10s, 20s, 40s, 80s, 160s, 320s, 640s, 1280s`.
- Scheduling immediately appends the AI-invisible entry `↻ Automatic Boulder n/N resume scheduled, restarting in XXs`; the status line refreshes the live countdown. Escape cancels the current wait.

## Boulder inhibition

- `/task boulder set <type> <true|false|t|f>` writes a branch-local signal. Boulder takes the latest valid value per type; any true blocks scheduling and sending.
- Completion offers `boulder`, `set`, `loop|user`, and `true|false|t|f`; other source names remain valid manual input.
- A loop scheduled with `--no-boulder` (or tool `inhibitBoulder: true`) holds the `loop` signal while active. Clearing it manually lasts only until loop next synchronizes.
- These are AI-invisible custom entries, not model messages or background-work registrations. Signal changes cancel waits, not running agents or the task gate.
- Runtime failures are handled inside the plugin boundary, not justified by Pi catching them. Current QPDI contracts, test/run evidence and remaining live acceptance are in [`docs/boulder-inhibition/`](docs/boulder-inhibition/delivery.md).

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
