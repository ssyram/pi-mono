# Step 0 — Design Specification Gate

## 规约来源

| Source | Path | Role |
|--------|------|------|
| README.md | `./README.md` | Primary user-facing spec: YAML schema, condition model, tape limits, parse-time validation rules, transition semantics, stop hook behavior |
| execution-behavior.md | `docs/execution-behavior.md` | Comprehensive internal spec: pseudocode for every function, invariants table, error propagation matrix, concurrency model, disk layout |
| builtin-procedures.md | `docs/builtin-procedures.md` | Builtin condition contracts: stdout protocol, needs_tape semantics, arg schemas |
| configuration-tutorial.md | `docs/configuration-tutorial.md` | YAML authoring guide with examples |
| correctness-audit.md | `docs/correctness-audit.md` | Prior 15-round audit final report — proven invariants and cross-boundary contracts |
| hoare-audit-2026-04-21.md | `docs/hoare-audit-2026-04-21.md` | Incremental audit — 10 validated invariants, 4 open issues (deferred) |

**规约来源: 已有文档 (README + execution-behavior.md + prior audit reports)**

## Extracted Contracts (Ground Truth)

### Parser Contracts
- YAML file ≤ 2 MiB, CRLF normalized, tabs rejected
- state_id / action_id: `/^[A-Za-z_][A-Za-z0-9_]*$/`
- arg_name: `/^[A-Za-z0-9_-]+$/`
- Exactly one `$START`, exactly one `$END`
- `$END` has no actions, is not epsilon
- Non-$END states must have ≥1 action
- Epsilon states: no arguments, last action must be `{default: true}`, earlier actions must NOT be default
- Non-epsilon states cannot use `{default: true}`
- No self-loops
- All `next_state_id` resolve to declared states
- Bidirectional BFS: every reachable state can reach `$END`
- Reserved JS name rejection for identifiers
- Depth limit: 64 for YAML nesting

### Engine Contracts
- `executeAction`: validates action exists, not epsilon, arg count matches
- Condition spawn: argv-only (no shell), 30s timeout with SIGKILL, 64 KiB stdout cap, 16 KiB stderr cap, detached process group kill
- Condition result: first line of stdout = `"true"` or `"false"`, rest = reason
- Epsilon chain: depth limit 64, tries actions in order, first `true` wins, last action `{default: true}` guarantees no deadlock
- Snapshot + rollback on epsilon chain failure (after initial condition passed)
- Tape re-synced from disk after every condition execution
- `persistRuntime`: tape-first, state-second → at-least-once retry semantics on crash

### Storage Contracts
- Atomic write: tmp file + rename
- Per-session in-process async mutex (`withSessionLock`)
- Orphan `.tmp` files swept on `session_start` hook
- Corrupted state detection with `CorruptedStateError` + user-facing recovery tip
- Tape limits: ≤64 KiB per value, ≤1024 keys
- Tape key regex: `/^[A-Za-z_][A-Za-z0-9_]*$/`

### Index (Plugin) Contracts
- 4 tools (LLM) + 5 commands (user) + 3 hooks registered
- All tool/command ops wrapped in `withSessionLock(sessionId, fn)`
- `pop-steering-flow` is command-only — LLM cannot pop
- `loadAndPush` rollback: any failure → `popFsm` deletes FSM dir
- Stop hook order: signal aborted → user abort → question detection (ends with `?`) → `<STEERING-FLOW-CONFIRM-STOP/>` tag → compaction cooldown (60s)
- Stagnation: SHA1(state_id + "\0" + stableStringify(tape)), count > 3 → pause reminders + notify user
- Stagnation self-heal: successful transition resets reminder_count to 0
- `infoCall`: per-FSM try/catch (single corruption doesn't crash whole command)
- Stop hook errors silently swallowed

### Cross-Boundary Contracts (pi framework)
- 10 contracts verified in prior audit against pi framework source
- Hook lifecycle: `session_start`, `agent_end`, `session_end`
- Tool/command registration via `context.registerTool()` / `context.registerCommand()`

### Intentional Omissions (documented)
- Structural-only reachability (no semantic path analysis)
- Conditions must be idempotent (framework doesn't enforce)
- In-process mutex only (no cross-process locking)
- Windows path caveats acknowledged
- LLM tape jitter accepted

### Deferred Issues from Prior Audit
1. (MEDIUM) `parser.ts:515-516,537` — YAML block-scalar chomp indicators silently collapsed
2. (LOW-MEDIUM) `builtins/validate-non-empty-args.mjs:23-26` — tape-path heuristic strips first absolute-path arg despite needs_tape:false
3. (LOW) `engine.ts` renderTransitionResult — failure hint omits needs_tape caveat
4. (LOW) `storage.ts` loadRuntime — `flow_dir ?? ""` causes relative paths to resolve against CWD for migrated sessions
