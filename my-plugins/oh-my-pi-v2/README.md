# oh-my-pi v2

Thin Sisyphus runtime for [pi](https://github.com/badlogic/pi-mono). Defines agent personalities, behavioral hooks, and task management. Delegates all execution to external extensions.

## Architecture

oh-my-pi v2 provides:

- **Sisyphus persona** — system prompt injection with intent detection, delegation routing, code enforcement rules
- **Agent definitions** — 10 sub-agent `.md` files (oracle, explore, librarian, metis, momus, hephaestus, atlas, sisyphus-junior, multimodal-looker, prometheus)
- **Boulder loop** — auto-restarts the agent when actionable tasks remain (`in_progress` or ready/unblocked `pending`)
- **Quality hooks** — comment checker, edit error recovery, tool output truncator, rules injector, keyword detector, custom compaction, context recovery
- **Task management** — task tool with dependencies, blocking, and TUI widget
- **Commands** — `/omp-start` (Prometheus planning), `/omp-consult` (Oracle consultation), `/omp-review` (Momus plan review)
- **Skills** — pre-publish-review, github-triage

oh-my-pi v2 does NOT provide delegation execution. It assumes the `subagent` tool exists (provided by pi-subagents).

## Required Extension

```bash
pi install npm:pi-subagents
```

[pi-subagents](https://github.com/nicobailon/pi-subagents) (681★) provides the `subagent` tool for single/parallel/chain agent execution, async background jobs, and agent management TUI.

## Recommended Extensions

```bash
# Web search + content extraction + GitHub cloning + video understanding
pi install npm:pi-web-access

# Session bridge used by pi-subagents for inter-session communication
pi install npm:pi-intercom
```

Optional MCP support:

```bash
# MCP server proxy (~200 token overhead, lazy lifecycle, OAuth)
pi install npm:pi-mcp-adapter
```

| Extension | Author | Stars | Role |
|---|---|---|---|
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | nicobailon | 681 | Required delegation tools (single/parallel/chain/background agents) |
| [pi-web-access](https://github.com/nicobailon/pi-web-access) | nicobailon | 314 | Recommended web search, content fetch, research kit |
| [pi-intercom](https://github.com/nicobailon/pi-intercom) | nicobailon | — | Recommended inter-session bridge for pi-subagents |
| [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) | nicobailon | 325 | Optional MCP proxy |

## Configuration

`~/.pi/oh-my-pi.jsonc` (user) and `.pi/oh-my-pi.jsonc` (project, overrides user):

```jsonc
{
  // Disable specific agents (they won't appear in prompt)
  "disabled_agents": ["prometheus"],

  // Toggle Boulder auto-restart loop
  "boulder_enabled": true,

  // Toggle rules injection from .cursor/rules/, .claude/rules/, etc.
  "sisyphus_rules_enabled": true,

  // Override category → agent/model mapping
  "categories": {
    "visual-engineering": {
      "model": "anthropic/claude-sonnet-4-6",
      "agent": "sisyphus-junior"
    }
  }
}
```

## Directory Structure

```
oh-my-pi-v2/
├── agents/              # .md files → installed to ~/.pi/agent/agents/
│   ├── oracle.md        #   Read by pi-subagents for execution
│   ├── explore.md
│   ├── librarian.md
│   ├── metis.md
│   ├── momus.md
│   ├── hephaestus.md
│   ├── atlas.md
│   ├── sisyphus-junior.md
│   ├── multimodal-looker.md
│   └── prometheus.md
├── hooks/               # Behavioral hooks
│   ├── sisyphus-prompt.ts    # Core: persona + agent list + category guidance
│   ├── boulder.ts            # Auto-restart on actionable tasks
│   ├── context-recovery.ts   # Restore tasks after compaction
│   ├── custom-compaction.ts  # Structured compaction summaries
│   ├── keyword-detector.ts   # ultrawork/search/analyze injection
│   ├── comment-checker.ts    # Detect lazy placeholder comments
│   ├── edit-error-recovery.ts # Edit failure hints
│   ├── tool-output-truncator.ts # Prevent context blowup
│   └── rules-injector.ts     # .cursor/rules, .claude/rules injection
├── tools/
│   └── task.ts              # Task management (boulder dependency)
├── commands/
│   ├── start-work.ts        # /omp-start — Prometheus interview + Momus review
│   ├── consult.ts           # /omp-consult — Oracle consultation
│   └── review-plan.ts       # /omp-review — Momus plan review
├── skills/
│   ├── pre-publish-review/
│   └── github-triage/
├── config.ts            # Category mapping + JSONC config loading
├── index.ts             # Extension entry point
└── package.json
```

## vs v1

v1 implemented everything in-house: delegation tools, concurrency manager, session runner, streaming stack, background task management (~7700 lines). v2 delegates execution to pi-subagents and focuses on what makes Sisyphus unique: the persona, behavioral hooks, and quality enforcement (~3300 lines).
