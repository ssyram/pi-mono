# Impression — Architecture

> Single-file architecture document for the `impression` pi-coding-agent extension. Captures module boundaries, runtime data flow, persistence contracts, and key design decisions. Intended as the entry point for anyone reasoning about correctness or extending the plugin.

## 1. Purpose

`impression` watches the agent's `tool_result` stream. When a tool result is "long" (per `minLength`) it asks the **same** active LLM to produce a compact distilled note, replaces the tool result with a placeholder text referencing an opaque `id`, and stores the full original content in the session JSONL log. The agent can later `recall_impression(id)` to retrieve a (re-distilled or full) view, `skip_impression(...)` to opt out of distillation for the next N tool results, or `save_impression(id)` to dump the full original to a sandboxed cache file for inspection.

Goal: **let the agent stay productive on long tool outputs without paying full token cost on every turn**, while keeping the original content recoverable.

## 2. Module map

```
impression/
├── index.ts                          # Extension entry — events, tools, command, all factory state
└── src/
    ├── types.ts                      # Custom-entry constants, ImpressionConfig / ResolvedConfig / ImpressionEntry shapes, type guards
    ├── config.ts                     # File load + parse-error reporting + resolveConfig + saveLocalConfig + skip-pattern matcher
    ├── distill.ts                    # Single-shot LLM call: build prompts, stream, detect <passthrough/> sentinel
    ├── prompt-loader.ts              # Lazy-cached load of prompts/*.md + {{var}} template substitution
    ├── result-builders.ts            # Build the AgentToolResult payloads returned to the framework
    ├── format-call.ts                # UI rendering for the recall_impression tool call display
    └── serialize.ts                  # Tool content (text + image blocks) → flat string for length / hashing / display
```

External coupling:
- `pi.appendEntry(customType, data)` — append to session JSONL.
- `ctx.sessionManager.{getBranch, getEntries, getLeafId}` — replay history on the active branch.
- `ctx.ui.notify` / `ctx.ui.setStatus` — user-visible warnings / status line.
- `convertToLlm` (re-exported by `pi-coding-agent`) — project `AgentMessage[]` to provider-format `Message[]` for the distiller's `visibleHistory` input.
- `globalThis["$__docker_available__"]` — read-only flag set by the optional `docker` plugin to switch the data-status display from the footer status line to the docker sidebar.

## 3. Runtime data flow

```
┌───────────────────────┐
│ user prompt / tool    │
└──────────┬────────────┘
           ▼
┌──────────────────────────────────────┐
│ tool_result (event hook)             │
│   if recall/skip self-call → return  │
│   if !cfg.enabled         → return   │
│   if passthroughRemaining > 0:       │
│     overEstimate || overMax →        │
│       store impression (full),       │
│       decrement passthrough,         │
│       return rejection text          │
│     else → pass through              │
│   if shouldSkipDistillation → return │
│   if isError                → return │
│   if fullText < minLength   → return │
│   else → distillWithSameModel:       │
│     • visibleHistory = convertToLlm( │
│         buildSessionContext(         │
│           getEntries(), getLeafId()) │
│       )                              │
│     • on <passthrough/>: pass through│
│     • else: store impression,        │
│       return placeholder text        │
└──────────────────────────────────────┘
                      ⋮ JSONL append
                      ▼
        custom-type entries on the active branch
        (impression-v1 / impression-passthrough-mode /
         impression-session-stats / impression-config-v1)
                      ▲
                      │ session_start replay (getBranch)
┌──────────────────────────────────────┐
│ recall_impression(id)                │
│   if delivered → throw (already in   │
│     LLM context)                     │
│   if passthroughRemaining: deliver   │
│     full content                     │
│   if recallCount ≥ maxRecall:        │
│     deliver full content             │
│   else: re-distill + return note,    │
│     bump recallCount, persist        │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ save_impression(id)                  │
│   if delivered → throw               │
│   write fullText to                  │
│     <cwd>/.pi/impression-cache/      │
│         <id>.txt                     │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ skip_impression(count, justification,│
│   estimatedChars)                    │
│   count = 0 → cancel passthrough     │
│   else: validate, set                │
│     passthroughRemaining = min(N,    │
│       cfg.maxPassthroughCount)       │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ /impression command                  │
│   config / print / read / (bare)     │
│   on / off / load / set [--persist]  │
│   help / -h / --help / ?             │
│   tool1,tool2,... shorthand          │
└──────────────────────────────────────┘
```

## 4. State machine — `ImpressionEntry.delivered`

```
       creation                         recall_impression
   (tool_result distill OR             passthrough deliver
   passthrough rejection)               (any branch that
           │                            returns full content)
           ▼                                  ▼
   delivered = undefined          delivered = true
   fullContent populated  ─────►  fullContent = []
   fullText populated             fullText = ""
                                  (LLM has the content now)

After delivered=true:
  - recall_impression(id): throws, content already in LLM context
  - save_impression(id):    throws, content discarded
```

The `delivered` flag is appended to JSONL via the next `pi.appendEntry("impression-v1", impression)`. On `session_start` replay, `Map.set(id, data)` keeps the LAST entry per id, so the stripped/delivered version wins.

## 5. Module specs (functional)

### 5.1 `index.ts` — factory closure

**State** (module-scope `let` only inside the `export default function`):

| Variable | Invariant |
|---|---|
| `currentRaw: ImpressionConfig` | Result of `loadConfig()` overlaid by all `impression-config-v1` patches replayed from the active branch, with out-of-range numerics clamped. |
| `cfg: ResolvedConfig` | `cfg === resolveConfig(currentRaw)` after any handler completes. |
| `cumulativeOriginalChars`, `cumulativeImpressionChars: number` | Mirror the most recent `impression-session-stats` entry on the active branch. |
| `passthroughRemaining: number` | `0 ≤ passthroughRemaining ≤ cfg.maxPassthroughCount` after every transition. |
| `lastEstimatedChars: number` | Most recent `skip_impression.estimatedChars`, or `0`. Read only when `passthroughRemaining > 0`. |
| `impressions: Map<string, ImpressionEntry>` | For every entry in the map, the JSONL log on the active branch contains an `impression-v1` entry with the same id; the map holds the latest version. |

**Disk-first invariant for state mutations**:

> For every observable user-visible state change (cfg patch, impression creation, passthrough state shift, delivered transition), `pi.appendEntry(...)` precedes the in-memory mutation OR is the only persistence step. If `appendEntry` throws, in-memory state is unchanged → next session_start replays the same observable state.

Applies to:
- `applyConfigPatch` (line ~290) — `appendEntry` first, then mutate `currentRaw` / `cfg` / re-register `skip_impression` tool.
- `tool_result` passthrough-rejected branch — `appendEntry(impression-v1)` before `passthroughRemaining--` + `persistPassthroughRemaining`.
- `deliverFullContent` — capture result reference, then mutate `fullContent`/`fullText`/`delivered`, then `appendEntry`.

### 5.2 `src/config.ts`

```
loadConfig(): { config: ImpressionConfig; warnings: string[] }
  Pre:  none
  Ensures: config = merge(global file, local file) with parse failures replaced by {}
           warnings includes one entry per file that parsed-but-failed
           (file-missing is silent; file-existed-but-bad-JSON is a warning)
  Side:  none

saveLocalConfig(patch): Promise<void>
  Pre: patch is a partial ImpressionConfig
  Ensures: .pi/impression.json reflects merge(existing on disk, patch)
           OR the operation rejected and .pi is left clean
           (atomic: writeFile(tmp) + rename(tmp, target); on rename failure tmp is unlinked)
  Concurrency: read-modify-write is NOT serialized — concurrent calls each
               read their own baseline + atomic-rename independently; the
               LATER rename overwrites the EARLIER, and the earlier writer's
               patch is lost ENTIRELY (not just reordered). Atomic rename
               guarantees no half-written state observable. See §7 for the
               full Rely-Guarantee statement.
  Side:  filesystem write to <cwd>/.pi/impression.json

shouldSkipDistillation(toolName, config): boolean
  Pre:  toolName is a string; config.skipDistillation is string[]
  Ensures: returns true iff some pattern matches by exact / trailing-* glob /
           /regex/ wrapped pattern; never throws (invalid regex caught)
  Side:  none

resolveConfig(raw): ResolvedConfig
  Pre:  raw is a partial ImpressionConfig (caller may have unvalidated values)
  Ensures: every field of ResolvedConfig is set (default substituted for missing)
           NOTE: does NOT clamp out-of-range numerics — caller is expected to
           clamp via index.ts:clampNumeric BEFORE resolveConfig
  Side:  none
```

### 5.3 `src/distill.ts`

```
distillWithSameModel(model, mode, auth, toolName, content, visibleHistory,
                     originalSystemPrompt, maxTokens, signal, onPromptVersion?)
  Pre: model is the active model with auth available
       maxTokens > 0
  Ensures: returns { passthrough: bool, note: string, thinking?: string }
           passthrough=true iff <passthrough/> sentinel detected in note
           note is the LLM's response after sentinel/thinking-block stripping
  Side: one streaming LLM call billed to the user
```

### 5.4 `src/result-builders.ts`

```
createPassthroughToolResult(content, details?)
  Ensures: returns { content, details: details ?? {} }
           CALLER is responsible for any subsequent mutation of `content` via
           reassignment (NOT splice) so the captured array reference still
           points at the original populated array
           (deliverFullContent in index.ts relies on this)

createRecallToolResult(id, note, details?)
  Ensures: returns { content: [{type:"text", text: buildImpressionText(id, note)}],
                     details: details ?? {} }

buildImpressionText(id, note)
  Ensures: returns a string built from impression-text.md template
           with {{id}} and {{note}} substituted
```

### 5.5 Custom-entry types (declared in `src/types.ts`)

| customType | Purpose | Replay behavior |
|---|---|---|
| `impression-v1` | Per-impression record (id, toolName, fullContent, fullText, recallCount, delivered, ...) | Map.set(id, data) — last writer wins per id |
| `impression-passthrough-mode` | `{ remaining, lastEstimatedChars }` | Last entry on branch overwrites |
| `impression-session-stats` | `{ originalChars, impressionChars }` cumulative | Last entry on branch overwrites |
| `impression-config-v1` | Per-mutation partial `ImpressionConfig` patch | Spread-merged in append order over `loadConfig()` baseline |

All four are stored as pi `custom` entries (not `custom_message`), so `buildSessionContext.appendMessage` filters them out — they never reach the LLM.

### 5.6 `index.ts` — additional function specs

Specs for the index-level helpers that mediate between event handlers and persistence. Each block follows §3.1 of `prompts/current/workflow.md` (Pre / Ensures / Invariants / Side effects).

```
applyConfigPatch(patch)                     (index.ts ~line 337)
  Pre:  patch is a Partial<ImpressionConfig>.
  Ensures:
    On normal return:
      1. appendEntry(IMPRESSION_CONFIG_ENTRY_TYPE, safe) is appended FIRST (disk-first).
      2. THEN currentRaw = { ...currentRaw, ...safe }.
      3. THEN cfg = resolveConfig(currentRaw).
      4. THEN registerSkipImpressionTool() is called (the LLM-visible tool
         description re-embeds the new cfg.maxPassthroughCount /
         getPassthroughHardLimit(cfg)).
    `safe` is `patch` with `skipDistillation` (if present) defensively
    shallow-copied so subsequent caller mutations of the array do not
    leak into the JSONL entry / currentRaw.
    On appendEntry throw: currentRaw / cfg are unchanged AND the
    skip_impression tool registration is unchanged. The caller observes
    the throw; in-memory state stays consistent with the JSONL log.
  Invariants:
    After any normal return: cfg === resolveConfig(currentRaw)
    AND the latest config patch has been written to JSONL.
  Side effects:
    One pi.appendEntry write (custom entry on the active branch);
    up to one re-registration of the skip_impression tool.

deliverFullContent(impression)              (index.ts ~line 307)
  Pre:  impression is an ImpressionEntry with delivered !== true.
        (Caller's responsibility — recall_impression.execute and
         save_impression.execute early-throw on delivered === true.)
  Ensures:
    Returns the AgentToolResult whose `content` is a reference to the
    ORIGINAL (still-populated) impression.fullContent array — so the LLM
    caller actually receives the content. After return:
        impression.fullContent === []     (property reassigned, not spliced)
        impression.fullText    === ""
        impression.delivered   === true
    AND a fresh impression-v1 entry has been re-appended to JSONL via
    pi.appendEntry, so the next session_start replay sees the
    delivered=true (stripped) version.
  Critical implementation note (matches §5.4):
    The order is "createPassthroughToolResult BEFORE mutate". `result.content`
    aliases the original array; reassigning impression.fullContent = []
    SWAPS THE PROPERTY without mutating the array, so the captured
    reference stays valid.
  Side effects:
    One pi.appendEntry write; in-memory mutation of `impression`.

clampNumeric(def, value)                    (index.ts ~line 225)
  Pre:  def is a ConfigKeyDef; value is unknown.
  Ensures:
    Returns { value, warning? }.
    Passthrough { value } iff ANY of:
      - def.type !== "number"
      - def.min === undefined
      - typeof value !== "number" || !Number.isFinite(value)
      - value >= def.min
    Otherwise returns { value: def.min, warning: <human-readable string> }.
  Invariant: pure function — no side effects, no I/O, no mutation.
  Side effects: none.
```

### 5.7 Host-coupling interface specs

Plugin → host boundaries. Each block follows §3.2 of `prompts/current/workflow.md` (接口 / 输入数据 / 输出数据 / 协议约定).

```
接口：impression plugin → pi.appendEntry(customType: string, data: unknown)

输入数据：
  customType — one of the four constants declared in src/types.ts:
    IMPRESSION_ENTRY_TYPE         = "impression-v1"
    PASSTHROUGH_MODE_ENTRY_TYPE   = "impression-passthrough-mode"
    SESSION_STATS_ENTRY_TYPE      = "impression-session-stats"
    IMPRESSION_CONFIG_ENTRY_TYPE  = "impression-config-v1"
  data — payload whose shape matches the type (per §5.5 above).

输出数据：
  void. Entry is durable in the session JSONL on return (synchronous
  append per pi-coding-agent's session-manager contract).

协议约定：
  - 调用方：MUST use one of the four declared customType strings;
    payload shape MUST match the corresponding type guard in
    src/types.ts (so replay round-trips cleanly).
  - 被调用方：guarantees the entry is on the ACTIVE branch and is
    reflected in subsequent getEntries() / getBranch() calls.
    On framework error (e.g. disk-write failure) the call THROWS;
    the plugin's disk-first ordering means in-memory state has not
    yet been mutated, so a throw is recoverable on next session_start.
```

```
接口：impression plugin → convertToLlm(messages: AgentMessage[]): Message[]
       (re-exported by @mariozechner/pi-coding-agent — src/index.ts:150)

输入数据：
  AgentMessage[] — taken from buildSessionContext(getEntries(), getLeafId()).messages.

输出数据：
  Provider-bound Message[] shape: the same projection pi itself uses
  before each LLM call. Drops timestamp / provider / model / usage /
  stopReason metadata; folds tool_use and tool_result roles per
  provider format.

协议约定：
  - 调用方：passes the result of buildSessionContext (with leafId
    honored, so fork siblings don't leak in).
  - 被调用方：is the canonical projection used by pi itself before
    each LLM call. Output shape matches what the active model receives.
  - 已知 Gap：the transformContext mutator chain (sibling extensions'
    "context" event hooks) is NOT applied by convertToLlm — see Known
    Gap 1 in §8 and upstream issue badlogic/pi-mono#3953.
```

```
接口：impression plugin → ctx.sessionManager.{getEntries, getBranch, getLeafId}

输入数据：
  none for getEntries() / getLeafId();
  optional fromId for getBranch() (active leaf when omitted).

输出数据：
  SessionEntry[] / id.
  - getEntries() returns ALL entries across ALL branches.
  - getBranch()  returns the active-branch chain via parent-id walk.
  - getLeafId()  returns the active leaf id.

协议约定：
  - 调用方 (replay / state reconstruction): use getBranch() so fork
    siblings don't leak in (round-3 D2).
  - 调用方 (per-distill-call visibleHistory construction): use
    getEntries() + getLeafId() and pass them to the free
    buildSessionContext — pi's free function rebuilds `byId`
    internally and walks from the leaf.
  - 被调用方：read-only view of the JSONL log on the active session;
    no mutation, no I/O on call (all loads happened at session_start
    inside the framework).
```

## 6. Key design decisions

1. **Disk-first for all state mutations.** Round 4 reordered `applyConfigPatch` and the `tool_result` passthrough-rejected branch so that `pi.appendEntry` precedes the in-memory mutation. Rationale: JSONL is the durable single source of truth; on `appendEntry` failure, in-memory state must not lead the log. Two known internal-only races (D-1 / D-2 in the audit log: `recall_impression.execute` non-terminal recall and `recordImpressionData`) deliberately keep memory-first because they are self-healing on the next `session_start` replay and changing them would complicate hot paths for negligible gain.

2. **`delivered` flag as one-shot lifecycle.** Once a recall delivers the full content to the LLM (whether via passthrough mode, recallCount cap, or sentinel), `fullContent` and `fullText` are emptied and `delivered=true` is appended. Subsequent `recall_impression` and `save_impression` throw — the LLM already has the content in its message history, so re-fetching is wasted. This trades "always recoverable" for "memory-bounded long sessions".

3. **Config is session-scoped + branch-aware.** The disk file is a one-shot seed. Mid-session changes via `/impression on|off|set|load` go to the JSONL log only. Effective cfg = file → JSONL replay (active branch only) → defaults. Forking a session does NOT carry passthrough/stats/impressions across branches (round-3 D2: replay walks `getBranch()`, not `getEntries()`).

4. **Sandboxed `save_impression`.** Path is hard-coded to `<cwd>/.pi/impression-cache/<id>.txt`; the LLM cannot pick a destination. Round-3 D1 closed an arbitrary-path-write surface that an earlier upstream version exposed.

5. **Distill `max_tokens` budget — three defense lines + a documented unit caveat.**

   **Formula** (`computeDistillMaxTokens` in `index.ts`):

   ```
   clamp(originalLength * cfg.distillRateFloor,  1024,  model.maxTokens || 8192)
   ```

   - Lower floor `1024` ensures the model has room on tiny inputs.
   - `originalLength * distillRateFloor` is the input-scaled allowance (default `distillRateFloor = 0.02`).
   - Upper cap is the active model's per-call output ceiling, with `8192` fallback when `Model.maxTokens` is missing / 0 / NaN (custom-provider misconfig).

   **Unit caveat — explicitly accepted.** The formula mixes units: `originalLength` is in chars, but the result is used as a token budget. For English text `1 token ≈ 4 chars`, so default `0.02` chars-per-char rate corresponds to roughly an 8% output-to-input token ratio. The mismatch only meaningfully affects budgets in the ~50K–400K char input range — outside that range either the 1024 floor or the model cap dominates. We chose to document the mismatch rather than introduce a `CHARS_PER_TOKEN_APPROX` conversion constant: the prompt's length instructions, not this number, are what actually keep the digest concise. The formula is a safety ceiling, not a precision dial.

   **Three defense lines** keep the distillation safe even when the budget is wrong:

   1. **Truncation guard** (`src/distill.ts`): if `response.stopReason === "length"`, the LLM hit `max_tokens` mid-output. The note's tail may be a half sentence or even split inside a `<thinking>` block. Returning `passthrough: true` falls back to the original tool result instead of handing the agent a torn note. Defends against under-sized cap.
   2. **Length blowup guard** (`src/distill.ts`, original upstream behavior): if `strippedText.length >= contentText.length` after sentinel/thinking strip, the digest defeats its own purpose — return `passthrough: true`. Defends against the model writing a digest that is longer than the original.
   3. **Budget formula**: bounds `max_tokens` between 1024 and the model's per-call ceiling.

   **`distillRateFloor` lower-bound clamp.** Like the other numeric config fields, `distillRateFloor` is bounded below by `0` via `clampNumeric`; out-of-range values get a `ctx.ui.notify` warning and are silently coerced.

6. **Numeric range clamping with warning.** Round 6 (this revision): `minLength`, `maxRecallBeforePassthrough`, `maxPassthroughCount` have lower bounds (`1`, `0`, `0`). Out-of-range values from file / replay / `/impression set` are clamped with a `ctx.ui.notify` warning. Type-incompatible values (string where number expected, etc.) are still hard-rejected by `validateConfigValue`.

7. **`visibleHistory` for the distiller uses `convertToLlm` projection.** Round 5: instead of raw `JSON.stringify(AgentMessage)` (which leaks `timestamp`/`provider`/`model`/`usage`/`stopReason` metadata the LLM never sees), the plugin runs `convertToLlm` (re-exported by pi-coding-agent) so the format matches what pi sends to the agent's LLM. **Known gap**: the `transformContext` mutator chain (which lets sibling extensions rewrite messages via the `"context"` event hook) is NOT applied; today no plugin in this monorepo mutates that way, but a future trimming extension would diverge. Tracked as a feature request to badlogic/pi-mono — when upstream exposes `ctx.getLlmContext()` (or `emitContext`), this plugin will switch to it.

## 7. Concurrency

Single-threaded JS event loop. The only concurrent surface is `saveLocalConfig`, where two rapid `--persistent` invocations race on disk:

```
Rely-Guarantee for saveLocalConfig:
  Rely:      OS provides POSIX-atomic rename(2) within the same filesystem;
             no other process truncates .pi/.
  Guarantee: each call emits exactly one atomic visible state transition
             (tmp → target); on rename failure leaves no orphan tmp.
  Race:      concurrent writes are NOT serialized — each call reads its
             own baseline, merges its own patch, atomic-renames. The LATER
             rename overwrites the EARLIER. The earlier writer's patch is
             lost ENTIRELY (not just reordered) because the later writer's
             on-disk result reflects only the later-baseline + later-patch,
             with no awareness of the earlier patch that briefly existed
             between the two reads. Acceptable for a manual user command.
```

## 8. KNOWN GAPS

1. **`transformContext` chain not applied to `visibleHistory`** — see decision 7 above. Tracked upstream: <https://github.com/badlogic/pi-mono/issues/3953>.
2. **No tests.** Sibling pi plugins (e.g. `recap`, `task-tracker`) also lack tests; this matches local convention but does not satisfy `prompts/current/workflow.md` §4.3 testing requirement. Out of scope for this iteration.
3. **`impressions: Map` is unbounded for non-delivered entries.** Long sessions where the LLM never recalls accumulate stripped (post-delivery) entries plus full undelivered entries. Currently considered acceptable; a TTL / LRU eviction policy would be a separate design iteration.
