# steering-flow — Correctness Audit Summary

**Convergence reached after 13 rounds.** Rounds 11, 12, and 13 all produced zero HIGH/MEDIUM findings, with Rounds 12 and 13 finding zero issues total — three consecutive clean rounds confirm the audit loop has fully saturated.

## Round-by-round history

| Round | Dimensions audited | HIGH/MEDIUM found | Fixed in round |
|---|---|---|---|
| 1 | Crash-safety, functional, contracts, resources | 10+ | All |
| 2 | Regressions, lifecycle, observability, portability | 12 (incl. major refactor: argv-only conditions) | All |
| 3 | Condition/parser, invariants, fresh-eyes | 6 HIGH/MEDIUM | All |
| 4 | Two convergence agents | 2 MEDIUM (`loadAndPush` ignored enterStart failure; cwd-relative script paths) | All |
| 5 | Two convergence agents | 2 MEDIUM (`loadAndPush` didn't catch enterStart throw; ambiguous relative cmd paths) | All |
| 6 | Two convergence agents | **0 HIGH/MEDIUM** (only 3 LOW polish items; 2 applied) | Applied 2 LOW items |
| 7 (post reverse-BFS) | Two convergence agents (parser+engine, storage+stophook) | **0 HIGH/MEDIUM** | — |
| 8 | Adversarial inputs + doc-code consistency | 1 bug (`__proto__` tape injection) + 7 drifted line refs | Fixed: reject reserved JS names in tape IDs; added line-drift caveat to docs |
| 9 | Convergence check on R8 fixes | **0 HIGH/MEDIUM** (2 dead code LOW → cleaned) | Removed unused `hasConfirmStop`, `readReminderMeta` |
| 10 | Fresh eyes on R9 state | 1 MEDIUM (`__proto__` as state_id/action_id/arg_name) + 1 LOW (killTree race after close) | Fixed: RESERVED_JS_NAMES in parser; `closed` flag in engine |
| 11 | Convergence check on R10 fixes | **0 HIGH/MEDIUM** (1 LOW: duplicate reserved-name list) | Exported `isReservedJsName` for DRY |
| 12 | Final convergence check | **0 HIGH/MEDIUM**, no LOW | — |
| 13 | Skeptical re-check | **0 issues** (all files clean) | — |
| 14 | Ultra-skeptical (stylistic + dead code) | 4 polish items (dup helper, unused param, unreachable guard, stale string) | All cleaned |
| 15 | Post-R14 convergence check | **0 issues** | — |

Total cumulative fixes: ~31 (including the reverse-BFS dead-end detection added in round 7).

## Final shape of the plugin

### Condition model (post-Round-2)

Conditions are program invocations, not shell strings:

```yaml
condition:
  cmd: "node"                    # PATH lookup, absolute path, or './'/'../' (flow-dir-relative)
  args: ["./script.mjs", "FOO"]  # fixed positional args
  needs_tape: true               # optional, default true
# or:
condition: { default: true }     # sentinel; only last action of an epsilon state
```

Spawn argv:
- `needs_tape !== false`: `[cmd, ...config.args, <tape.json abs path>, ...llm_args]`
- `needs_tape === false`: `[cmd, ...config.args, ...llm_args]`

No shell. `detached: true` + `process.kill(-pid)` for subtree SIGKILL. 30 s timeout. 64 KiB stdout / 16 KiB stderr caps (tracked in bytes via Buffer). Stdout contract: first line literally `true` / `false` (case-insensitive); remainder = reason.

### Parser (`parser.ts`) — all rules enforced at parse time

- Unique `$START` / `$END`; `$END` has no actions and is non-epsilon
- `action_id` / `arg_name` / non-sentinel `state_id` match `/^[A-Za-z_][A-Za-z0-9_]*$/`
- No duplicate ids; no self-loops; all `next_state_id` resolve
- Epsilon: last action `{default:true}`, earlier ones not `{default:true}`, no arguments; non-epsilon rejects `{default:true}`
- `{default:true}` cannot be mixed with `cmd`/`args`/`needs_tape`
- `arguments` must be an array; duplicate `arg_name` rejected
- Path-like `cmd` without absolute or `./`/`../` prefix rejected (prevents silent cwd-relative surprises)
- `$END` reachable from `$START` (forward BFS), and every forward-reachable state can reach `$END` (reverse BFS — no dead-end states)
- 2 MiB file size cap; CRLF normalized; BOM stripped; tabs rejected; YAML nesting ≤ 64

### Engine (`engine.ts`)

- `executeAction` snapshots + rolls back on epsilon-chain failure; strict arg-count check
- `chainEpsilon` bounded at 64; guaranteed to exit by parser's `{default:true}` last-action rule
- `runCondition` spawns argv, enforces timeout/caps, settles once, kills process group
- `./` / `../` in cmd or args resolve against `rt.flow_dir`

### Storage (`storage.ts`)

- `atomicWriteJson` (tmp + rename)
- `readJsonStrict` distinguishes ENOENT (undefined) from corruption (`CorruptedStateError`)
- `withSessionLock` (per-sessionId in-process mutex) with correct Map cleanup
- `popFsm` removes orphan dir
- `sweepTmpFiles` on session_start (skips own-pid tmps for concurrency safety)
- `writeState` optional `preserve_entered_at` so Stop-hook reminders don't reset timestamp
- Tape accepts arbitrary JSON values (not just strings)

### Index (`index.ts`)

- All ops under `withSessionLock`
- `loadAndPush` rolls back on any failure of `enterStart` (both returned-false and thrown)
- Immediate-$END load renders resumed parent flow
- Per-FSM try/catch in `infoCall` — one corrupted FSM no longer aborts the whole view
- `tokenizeArgs` (quote-aware shell-style) for slash-command parsing
- Stop hook guards: user abort (signal+stopReason), question detection, compaction 60s cooldown, `<STEERING-FLOW-CONFIRM-STOP/>` escape tag, stagnation limit 3 (stable hash with sorted keys, preserves entered_at)
- Corrupted state surfaces via `ctx.ui.notify` in the Stop hook (no silent swallow)

### Types (`types.ts`)

- `Condition = {default:true} | {cmd, args?, needs_tape?}`
- `FSMRuntime.flow_dir` persisted
- `TapeValue` = any JSON value

## Cross-boundary contracts verified

| Contract | Source | Verdict |
|---|---|---|
| `ctx.sessionManager.getSessionId()` / `getCwd()` non-null | `packages/coding-agent/src/core/session-manager.ts:780-790` | CONFIRMED |
| Hook handler throws caught by framework | `packages/coding-agent/src/core/extensions/runner.ts:586-604` | CONFIRMED |
| `tool.execute` throws → `isError` results | `packages/agent/src/agent-loop.ts:531-558` | CONFIRMED |
| Tool params TypeBox-validated before `execute` | `agent-loop.ts:490` | CONFIRMED |
| Tool calls run in parallel within a turn | `agent-loop.ts:390-438` | CONFIRMED (⇒ mutex) |
| `pi.sendUserMessage` from `agent_end` queues a follow-up | boulder.ts pattern | CONFIRMED |
| `AssistantMessage.stopReason === "aborted"` = user abort | boulder-helpers.ts | CONFIRMED |
| `agent_end` fires strictly after `executeToolCalls` resolves | `agent-loop.ts:205-214` | CONFIRMED |
| POSIX `detached:true` → new pgrp; `kill(-pid)` reaches tree | POSIX | CONFIRMED |
| `fs.rename` atomic same-fs (tmp is in target dir) | POSIX | CONFIRMED |

## Proven properties

- FSM parse produces a valid state machine with all declared invariants
- Transitions are atomic with respect to the model-visible state (snapshot + rollback + persist-on-success-only; tape first, state second = commit marker)
- Per-session serialization of RMW ops (empirical: 20-way concurrent pushFsm → 20 entries with lock, 1 without)
- Crash-safe file writes; orphan tmp sweep on session_start
- Condition sandbox bounds: 30 s timeout, subtree SIGKILL, byte-counted stdout/stderr caps
- No shell injection surface (argv-only spawn)
- Parser depth-bound 64 prevents stack overflow
- Load rollback: any failure in `enterStart` (throw or ok:false) pops the stack and removes the FSM directory

## Remaining limitations (by design / low risk, explicitly accepted)

- **Structural BFS reachability** — bidirectional BFS proves every reachable state has a structural path to $END, but can't decide whether conditions will pass at runtime (flow-author responsibility)
- **Conditions must be idempotent** — on rollback, state reverts but tape side-effects don't. Documented.
- **Cross-process concurrency** — in-process mutex only. Atomic writes prevent corruption, but cross-process push-races are possible.
- **Windows flow-relative paths** — `.\script.mjs` not special-cased (use `./`); process-group kill uses POSIX semantics
- **LLM tape jitter can keep stagnation counter resetting** — user can `/pop-steering-flow` to abandon
- **Conditions determine runtime termination** — bidirectional BFS eliminates structural dead-ends, but runtime termination depends on conditions passing (flow-author's responsibility to write conditions that eventually succeed)

## Assumptions Registry (re-verify if any of these change)

- pi framework: tool.execute → isError; hooks try/catch-wrapped; sessionId/cwd non-null; stopReason="aborted"; sendUserMessage queues turn; session_compact event; agent_end after all tools; tools may run in parallel
- Node.js / POSIX: `fs.rename` atomic same-fs; spawn argv doesn't shell-interpret; `detached:true` + `kill(-pid)` reaches subtree; `fs.rm({recursive,force})` doesn't follow symlinks
- Condition contract: first stdout line `true`/`false`; exit code ignored; optional tape.json at argv[N] when `needs_tape !== false`; 30 s wall-clock

## Files

- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/types.ts`
- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/parser.ts`
- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/engine.ts`
- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/storage.ts`
- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/stop-guards.ts`
- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/index.ts`
- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/examples/code-review.yaml`
- `@/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/steering-flow/examples/scripts/{save-plan,require-key,require-key-any,always-true}.mjs`

## Verification performed throughout

- `tsc --noEmit` clean after every round
- End-to-end walkthrough of `examples/code-review.yaml` passes from arbitrary cwd (flow-dir resolution for scripts)
- 20-way concurrent push test: lock → 20, no lock → 1
- Parser rejection matrix (bad ids, bad conditions, mixed defaults, arguments-as-map, oversized, tabs, CRLF, deep nesting) all give clean error messages
- Arg-count enforcement verified with under-supply and over-supply
- Rollback verified by forcing epsilon failure post-condition-pass
- Quote-aware tokenizer verified with multi-word quoted args
- `needs_tape: false` verified (tape path not appended)
- Side-channel tape writes by condition re-synced on next turn
