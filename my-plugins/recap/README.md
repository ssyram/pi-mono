# pi-recap

A [pi](https://github.com/badlogic/pi-mono) extension that generates automatic session recaps using a lightweight LLM call. While an agent run is active, a brief timestamped status summary appears above the editor on the configured cadence. When the agent run ends, the cadence stops.

Similar in spirit to Claude Code's session summary, recaps follow a structured past/present/future format so you always know what's done, what's happening now, and what's coming next.

## What it does

- Starts the periodic recap countdown on `agent_start` and stops it on `agent_end`
- Calls a small model (default: `gpt-5.4-nano`) to produce an objective, 1–3 sentence status summary
- Displays each recap as `Recap (YYYY-MM-DD HH:mm:ss): ...` in a widget above the input editor for 30 seconds
- Clears pre-`agent_end` recap widgets without converting them into `ui.notify` notifications
- When `onAgentEnd` is enabled, fires one final recap request that overwrites any existing recap widget when it returns, then turns into `ui.notify` after the widget timeout
- Adapts to the language used in the conversation

**Example output:**

```
Recap (2026-05-04 14:32:09): Fixed the provider prefix issue in agent .md — subagent now runs correctly. Just completed all four modules of the recap plugin; next step is to reload and verify the results.
```

## Install

```bash
pi install <path-to-this-directory>
# or add to .pi/extension-repos.json
```

## Configuration

Create `~/.pi/recap.jsonc` (user-level) or `<project>/.pi/recap.jsonc` (project-level). Project config overrides user config.

```jsonc
{
  // Periodic recap interval in minutes while an agent run is active. 0 = disable timer.
  "intervalMinutes": 5,

  // Model to use (bare name, no provider prefix).
  "model": "gpt-5.4-nano",

  // Trigger one final fire-and-forget recap when agent finishes a turn, then stop the countdown.
  "onAgentEnd": true,

  // How long the widget stays visible (seconds). 0 = never auto-dismiss.
  "displaySeconds": 30,

  // Enable/disable the plugin entirely.
  "enabled": true
}
```

All fields are optional — defaults are shown above.

## How it works

1. **Trigger** — `agent_start` starts the periodic countdown; `agent_end` stops the countdown and may trigger one final fire-and-forget recap when `onAgentEnd` is enabled
2. **Collect** — reads the current session branch via `ctx.sessionManager.getBranch()`, extracts recent messages since the last recap
3. **Summarize** — sends the collected context to a small model via `completeSimple()` with a prompt that asks for a factual standup-style recap
4. **Display** — `setWidget("recap", ...)` renders `Recap (YYYY-MM-DD HH:mm:ss): ...` above the editor; because the widget key is stable, the final recap overwrites any older visible recap when generation returns. `setTimeout` clears active-run recaps without forwarding them to `ui.notify`; final recaps use the same timeout and then become an `info` notification.

The recap content never enters the LLM context — it is display-only.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Barrel entry point for pi extension loading |
| `extension.ts` | Event listeners, timer, widget lifecycle |
| `config.ts` | JSONC config loader with user/project merge |
| `collect.ts` | Extracts messages from session entries |
| `summarize.ts` | LLM call to generate recap text |

## License

MIT
