# Impression System

Nobody memorizes a full handbook before doing real work; we skim, keep an impression, and move. LLMs should do the same: leave an impression and work without carrying wasteful details. Impression is a plug-and-play extension for [pi](https://github.com/badlogic/pi-mono) that automatically compresses long tool results into compact "impressions" using the active LLM, while storing originals for on-demand recall.

> Tip: if you also load the `docker` plugin, Impression can present cumulative `[impression:data]` stats more clearly in the docker sidebar. Without docker, it falls back to the normal footer status.

## The Problem

In long coding sessions, tool results (file reads, command outputs, search results) accumulate rapidly in the conversation context. Most content is read once, understood, and never referenced again — but it stays in the context window, consuming tokens and degrading model attention. In a typical session that reads 20+ files, the impression system reduces context usage by 40–70%.

## How It Works

1. **Intercept** — hooks every `tool_result` event; if text length exceeds a configurable threshold (default 2 048 chars), distillation kicks in.
2. **Distill** — calls the active model with a specialized prompt that tells it: "you are compressing your own memory". The model produces a short note capturing what matters for the next step.
3. **Replace** — the original tool result is swapped for the compressed impression.
4. **Recall** — a `recall_impression` tool is registered. The agent can call it to retrieve the original content. On the first recall, the model re-distills with updated context. After the configured number of recalls, full content is returned verbatim.

The distillation prompt (in `prompts/`) is designed so the model treats it as self-compression, not third-party summarization. It receives the full visible history and system prompt, so impressions are context-aware.

## Quick Start

### Prerequisites

- **Node.js** ≥ 18 (includes npm)
- **Python 3** ≥ 3.9 (only for the setup script)
- An API key for at least one LLM provider (Anthropic, OpenAI, Google, OpenRouter, etc.)

### Automated Setup

```bash
python3 setup.py
```

The setup script will:
1. Check for / install pi globally via npm
2. Interactively configure your LLM API key (skippable)
3. Register this directory as a pi extension (skippable)

Works on **macOS**, **Linux**, and **Windows** (PowerShell / Git Bash / WSL).

### Manual Setup

#### 1. Install pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

#### 2. Set an API key

```bash
# Pick one:
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="AI..."
export OPENROUTER_API_KEY="sk-or-..."
```

#### 3. Install the extension

```bash
# From this directory:
pi install .

# Or from anywhere:
pi install /path/to/impression
```

**Alternative** — load it per-session without installing:

```bash
pi --extension /path/to/impression/index.ts
```

## Project Structure

```
impression/
├── index.ts                  # Extension entry point (wires events + tool)
├── src/
│   ├── types.ts              # Interfaces, type guards, constants
│   ├── config.ts             # Config loading, resolution, skip-pattern matching
│   ├── serialize.ts          # Content serialization (text + images)
│   ├── prompt-loader.ts      # Loads and templates prompt files
│   ├── distill.ts            # Distillation logic (calls LLM)
│   ├── format-call.ts        # UI: formats tool call display for recall
│   └── result-builders.ts    # Builds impression/passthrough tool results
├── prompts/                                # All prompts are .md
│   ├── distiller-first-person.md           # Distiller system prompt — first-person variant
│   ├── distiller-third-person.md           # Distiller system prompt — third-person variant
│   ├── distiller-user-first-person.md      # Distiller user prompt template — first-person
│   ├── distiller-user-third-person.md      # Distiller user prompt template — third-person
│   ├── impression-system-append.md         # Appended to the agent's system prompt at session start
│   └── impression-text.md                  # Template shown to the agent after distillation
├── setup.py                  # Cross-platform installer
└── README.md
```

## Configuration

Configuration is **session-scoped**. The disk file `.pi/impression.json` is read **once per session start** and seeds the session's effective config. Mid-session changes via `/impression` commands persist to the session JSONL log only — they do **not** rewrite `.pi/impression.json`. The config entries are stored as custom log entries (`customType: "impression-config-v1"`) and are never shown to the LLM.

Effective runtime config = `loadConfig()` from disk → overlaid by all `impression-config-v1` patches in the session log → defaults filled for any unset field.

Create `.pi/impression.json` in your project root (optional — all fields have defaults):

```json
{
  "enabled": true,
  "debug": false,
  "debug:distill-mode": "third-person",
  "skipDistillation": [],
  "minLength": 2048,
  "maxRecallBeforePassthrough": 1,
  "maxPassthroughCount": 2,
  "distillRateFloor": 0.02,
  "showData": false
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch. When `false`, all tool results pass through without distillation. |
| `debug` | `boolean` | `false` | Enables debug notifications and debug-only options. |
| `debug:distill-mode` | `"first-person" \| "third-person"` | unset | Debug override for distiller prompt mode. Works only when `debug: true`; otherwise it is ignored with a warning. |
| `skipDistillation` | `string[]` | `[]` | Tool names to never distill. Each pattern is matched as: (1) exact match (`"bash"`); (2) glob — only **trailing** `*` is supported (`"background_*"` matches anything starting with `background_`); (3) regex — wrap the pattern in `/.../` (e.g. `"/^read.*_file$/"` for full regex semantics). |
| `minLength` | `number` | `2048` | Minimum text length (chars) to trigger distillation. |
| `maxRecallBeforePassthrough` | `number` | `1` | Recalls returning re-distilled notes before switching to full passthrough. **`0` means every recall delivers the full content immediately** — useful when you want the agent to always get exact text after the initial distillation. |
| `maxPassthroughCount` | `number` | `2` | Hard cap on `skip_impression count=N`. |
| `distillRateFloor` | `number` | `0.02` | Per-input-char allowance for the distill output budget. The effective `max_tokens` passed to the distiller is `clamp(originalLength * distillRateFloor, 1024, model.maxTokens \|\| 8192)`. Bigger inputs get proportionally more headroom (so the digest can be substantial), but the digest is always capped by the model's per-call output ceiling (or `8192` fallback). The model's prompt-driven length instructions, not this number, are what keep the digest concise — this is just a safety ceiling. Lower bound on this field: `0`. |
| `showData` | `boolean` | `false` | Shows per-distillation char data as `[impression:data] XXX / YYY = ZZ%`, where the display uses compact `k`/`M` formatting with two decimals, while the ratio is calculated from exact underlying character counts and the footer keeps a cumulative `impression / original` status. |

> **Out-of-range numeric values are clamped with a warning.** Numeric fields have lower bounds: `minLength ≥ 1`, `maxRecallBeforePassthrough ≥ 0`, `maxPassthroughCount ≥ 0`, `distillRateFloor ≥ 0`. A value below the bound (whether from the file, a session log replay, or `/impression set`) is clamped to the bound and the user is notified via `ctx.ui.notify` warning. JSON parse errors in `.pi/impression.json` are also surfaced as warnings at session start (the file is then ignored).

> **Cost note.** Each distillation invokes the same provider/model the agent itself uses, with the agent's system prompt + visible message history + the tool result as input. Recall re-distillation does the same. On long sessions with many large tool results, this roughly doubles the token cost (every long tool result triggers one extra round trip).
>
> The distill request's `max_tokens` budget is `clamp(originalLength * distillRateFloor, 1024, model.maxTokens || 8192)`. The model's per-call output ceiling caps the upper end (8192 fallback if the model doesn't declare it). The per-char allowance scales the budget with input size. A 1024 floor ensures the model has room even on tiny inputs. The model's prompt instructions are what actually keep the digest concise; the formula is just a safety ceiling.
>
> **Unit caveat:** `originalLength * distillRateFloor` mixes chars and tokens (left side is chars, the result is used as a token budget). For English text `1 token ≈ 4 chars`, so the default `distillRateFloor=0.02` corresponds to roughly an 8% output-to-input token ratio. The mismatch only meaningfully affects budgets in the ~50K–400K char input range; outside that range either the floor or the cap dominates.
>
> **Three defense lines** prevent the digest from causing harm:
> 1. **Truncation guard** (`src/distill.ts`): if the LLM API returns `stopReason === "length"`, the plugin auto-falls back to passthrough rather than handing the agent a torn note. Protects against under-sized `max_tokens`.
> 2. **Length blowup guard** (`src/distill.ts`): if `strippedText.length >= contentText.length`, the plugin auto-falls back to passthrough. Protects against the digest being longer than the original (which would defeat the whole point).
> 3. **Budget formula**: the `clamp` above bounds `max_tokens` between 1024 and the model's per-call output ceiling.

> Editing `.pi/impression.json` while a session is running has **no immediate effect** — the file is only re-read by future sessions. To pull the on-disk file into the running session, run `/impression load`.

When `debug:distill-mode` is set (and `debug: true`), Impression always uses that prompt variant and does not switch based on the active model. When unset, it keeps model-based routing.

### `/impression` commands

All subcommands and the `--persistent` flag are case-insensitive.

| Command | Effect |
|---|---|
| `/impression` *(or)* `/impression config` / `print` / `read` | Print the current session's effective resolved config (JSON). |
| `/impression help` / `-h` / `--help` / `?` | Show command help. |
| `/impression on` | Shorthand for `set Enabled true`. |
| `/impression off` | Shorthand for `set Enabled false`. |
| `/impression load` | Re-read `.pi/impression.json` and overlay it into the running session. |
| `/impression set [--persistent] NAME VALUE` | Set one config field. `VALUE` is parsed as JSON; type-checked against the field. With `--persistent`, the patch is also written back to `.pi/impression.json` (in the background; a warning is shown if the write fails). |
| `/impression tool1,tool2,...` | Shorthand: append the listed tools to `SkipDistillation` for this session. **Requires a comma** (or quoting) — single bare words are treated as unknown subcommands. |

**Field naming**: `NAME` is matched case- and separator-insensitively. After lowercasing and stripping all non-alphanumerics, the input is looked up against both the JSON-file keys and the PascalCase display names. All of `MaxRecall`, `maxRecall`, `max-recall`, `max_recall`, `"max recall"`, `max:recall`, `maxrecall`, and `maxRecallBeforePassthrough` resolve to the same field. Display names (used in notifications and help) are PascalCase: `Enabled`, `Debug`, `ShowData`, `MinLength`, `MaxRecall`, `MaxPassthroughCount`, `SkipDistillation`, `DebugDistillMode`.

**Value typing**: `enabled` / `debug` / `showData` → boolean; length / rate fields → finite number; `skipDistillation` → JSON array of strings (e.g. `["read","write"]`); `debug:distill-mode` → `"first-person"` or `"third-person"`. Mismatched values are rejected with an explanation.

> An unknown subcommand prints a warning that includes the command help, so a typo is never silently accepted.

> `/impression load` captures the file's contents as a session patch at the moment of invocation. Editing `.pi/impression.json` afterwards has no effect on the running session — re-run `/impression load` to refresh.

### Agent-facing tools

The plugin registers three tools for the LLM:

| Tool | Use |
|---|---|
| `recall_impression` | Re-fetch a stored impression by id. Returns either re-distilled notes (if `recallCount < maxRecall`) or the full original content (passthrough). After the full content is delivered once, the impression is marked `delivered` and its content is dropped from internal state — subsequent recalls of the same id error out, since the content is already in the LLM's message history. |
| `skip_impression` | Tell the plugin to pass through the next N tool results unchanged (max `maxPassthroughCount`). Requires `count`, `justification`, and `estimatedChars`; if the actual content exceeds the limits, the passthrough is rejected (the impression is still stored under a new id for `save_impression` recovery). `count=0` cancels passthrough. |
| `save_impression` | Save the original content of an impression (by id) to `.pi/impression-cache/<id>.txt` for inspection via `read`/`bash`/`python`. The path is fixed — the agent cannot pick a destination, which keeps the file write inside the project and prevents arbitrary-path writes. |

## What to Expect

### Signs It's Active

- **Status bar** shows `[impression] Distilling N chars with provider/model...` during compression.
- **Notifications** for skipped results (too short, in skip list, errors).
- **Tool results** are replaced with the `🧠 [MY INTERNAL MEMORY | ID: ...]` format.
- A **`recall_impression` tool** appears in the agent's tool list.
- If the **`docker` plugin** is loaded, cumulative **`[impression:data]`** stats are shown there; otherwise they remain in the footer.

### Signs It's Working Well

- The agent continues working fluidly after reading large files.
- Fewer tokens consumed per turn in long sessions.
- The agent calls `recall_impression` when it actually needs exact text (e.g., before editing), and gets the right content back.
- Distilled notes are shorter than the original but capture key information.

### Tuning

- Agent keeps recalling immediately → raise `minLength`.
- Important details lost → lower `maxRecallBeforePassthrough` to `0`, or add the tool to `skipDistillation`.
- Distillation too slow → raise `minLength` to distill less often.

## Customizing Prompts

All prompts are plain Markdown files in `prompts/`. Edit them directly to tune distillation behavior. The distiller has two prompt variants — `first-person` and `third-person` — selected automatically based on the active model (or forced via `debug:distill-mode` when `debug: true`).

**Template variables** (replaced at runtime):

| File | Loaded by | Variables |
|---|---|---|
| `distiller-first-person.md` | `getDistillerSystemPrompt("first-person")` | `{{contentLength}}`, `{{lengthNote}}`, `{{sentinel}}` |
| `distiller-third-person.md` | `getDistillerSystemPrompt("third-person")` | `{{contentLength}}`, `{{lengthNote}}`, `{{sentinel}}` |
| `distiller-user-first-person.md` | `getDistillerUserTemplate("first-person")` | `{{originalSystemPrompt}}`, `{{visibleHistory}}`, `{{toolName}}`, `{{toolResult}}` |
| `distiller-user-third-person.md` | `getDistillerUserTemplate("third-person")` | `{{originalSystemPrompt}}`, `{{visibleHistory}}`, `{{toolName}}`, `{{toolResult}}` |
| `impression-text.md` | `getImpressionTextTemplate()` | `{{id}}`, `{{note}}` |
| `impression-system-append.md` | `getImpressionSystemAppendTemplate()` | _(none — appended verbatim to the agent's system prompt at session start)_ |

## Dependencies

None beyond what pi already bundles:

- `@mariozechner/pi-ai`
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`

## License

MIT
