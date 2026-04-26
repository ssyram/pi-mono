# Comparative Analysis: mcp-server-fsm vs steering-flow

## Canonical references

- `docs/ARCHITECTURE.md` — canonical steering-flow design
- `docs/configuration-tutorial.md` — steering-flow config syntax
- `docs/execution-behavior.md` — steering-flow runtime behavior
- `docs/correctness-audit.md` — implementation verification history

Two independently developed FSM-based workflow enforcement systems for LLM coding agents. mcp-server-fsm targets Claude Code via the MCP protocol and Claude Code hook infrastructure; steering-flow targets the pi coding-agent plugin system.

---

## A. Architecture

| Aspect | mcp-server-fsm | steering-flow |
|--------|---------------|---------------|
| **Runtime** | Separate Rust process (daemon), communicates via Unix socket HTTP | In-process TypeScript, loaded as a pi plugin extension |
| **Language** | Rust (edition 2024) | TypeScript (ESM) |
| **Binary count** | 3 binaries: `mcp-server-fsm` (server daemon), `mcp-server-fsm-client` (MCP stdio server), `mcp-server-fsm-hook` (Claude Code hook binary) | Single `index.ts` entry point, no separate processes |
| **Transport** | MCP stdio (client <-> Claude Code), Unix socket HTTP (client/hook <-> server) | Direct function calls within the pi agent loop |
| **State ownership** | Server daemon owns all state; client and hook are stateless proxies | Plugin owns state in-process; disk is persistence layer only |

### Architectural implications

**Latency**: mcp-server-fsm pays per-operation overhead: every tool call requires the MCP client to make an HTTP request over a Unix socket to the server daemon. The hook binary (`mcp-server-fsm-hook`) is a fresh process spawn for every Claude Code hook event. steering-flow has zero IPC overhead; all operations are in-process function calls.

**Crash recovery**: mcp-server-fsm's daemon model means if the server crashes, all in-flight FSM operations fail. The hook binary auto-starts the daemon on `session-start` (`@mcp-server-fsm/crates/hook/src/main.rs:116-153`), but there is a window where tool calls fail if the daemon is not running. steering-flow's in-process model means a crash kills the entire agent session, and the next session restores from disk atomically.

**State sharing**: mcp-server-fsm's centralized daemon can serve multiple concurrent Claude Code sessions (keyed by `(session_id, agent_id)`). steering-flow is per-agent-process, with disk-level session isolation via `.pi/steering-flow/<SESSION-ID>/`.

**Debugging**: mcp-server-fsm has rich tracing (`tracing` crate with env-filter), but the three-process architecture (Claude Code -> MCP client -> hook/daemon) makes following a single operation across logs difficult. steering-flow logs are inline with the pi agent's own output.

---

## B. FSM Config Format

### Side-by-side schema

#### mcp-server-fsm (YAML)

```yaml
# @mcp-server-fsm/experiments/eval/skills/TDD.yaml
name: "TDD"
description: "..."
initial_state: "S0_red"
exit_state: "S_exit"
states:
  S0_red:
    description: "Phase 1: Write failing tests"
    liveness_properties:
      - "Test file exists in tests/"
      - "cargo test runs and FAILS"
    instructions: |
      Write test cases for the required functionality...
    tool_permissions:
      mode: "blacklist"
      list: []
    transitions:
      - target: "S1_green"
        guard:
          hard:
            - run: "test -d tests && find tests -name '*.rs' | grep -q '.'"
            - run: "! cargo test 2>&1 | grep -q '^test result: ok'"
          soft:
            - type: "llm_review"
              reviewer_model: "claude-sonnet-4-20250514"
              strategy: "single"
              criteria: "..."
              review_artifacts: ["src/lib.rs"]
  S_exit:
    description: "TDD workflow complete."
```

#### steering-flow (YAML)

```yaml
# @steering-flow/examples/code-review.yaml
task_description: "Implement a small feature end-to-end..."
states:
  - state_id: "$START"
    state_desc: "..."
    is_epsilon: false
    actions:
      - action_id: "plan"
        action_desc: "Submit a written plan"
        arguments:
          - { arg_name: "PLAN_TEXT", arg_desc: "..." }
        condition:
          cmd: "node"
          args: ["./scripts/save-plan.mjs", "${$TAPE_FILE}", "${PLAN_TEXT}"]
        next_state_id: "implement"
  - state_id: "test_router"
    state_desc: "Automatic router"
    is_epsilon: true
    actions:
      - action_id: "tests_ok"
        condition:
          cmd: "node"
          args: ["./scripts/require-key.mjs", "TESTS_PASSED", "1"]
        next_state_id: "review"
      - action_id: "tests_fail"
        condition: { default: true }
        next_state_id: "implement"
  - state_id: "$END"
    state_desc: "Feature shipped."
    actions: []
```

### Key differences

| Aspect | mcp-server-fsm | steering-flow |
|--------|---------------|---------------|
| **States container** | `HashMap<String, StateDefinition>` (keys are state names) | `Array<State>` with `state_id` field (order matters for BFS) |
| **Initial/exit markers** | Top-level `initial_state` / `exit_state` fields | Sentinel states `$START` / `$END` (must exist literally) |
| **Transitions** | `transitions` array on each state; target-only (LLM sees targets as "available actions") | `actions` array on each state; each action has `action_id`, `action_desc`, `arguments`, `condition`, `next_state_id` |
| **Action identity** | No named actions; transitions identified by target state name | Named `action_id` per transition; LLM invokes by `action_id` |
| **LLM-supplied args** | None; the LLM has no way to pass arguments to a transition | Each action can declare `arguments: [{arg_name, arg_desc}]`; LLM passes positional args |
| **Condition guards** | `guard.hard` (shell commands) + `guard.soft` (LLM reviewer) | `condition: {cmd, args?}` with `${$TAPE_FILE}` / `${arg-name}` tokens (subprocess, no shell) or `{default: true}` |
| **Liveness properties** | Per-state `liveness_properties` array; LLM must self-check against these before transitioning | Not present; conditions serve as the quality gate |
| **Instructions** | Per-state `instructions` field (freeform text for the LLM) | Per-state `state_desc`; no separate instructions field |
| **Tool permissions** | Per-state `tool_permissions: {mode: whitelist/blacklist, list: [...]}` (`@mcp-server-fsm/crates/server/src/automaton.rs:75-91`) | Not present |
| **FSM description** | Top-level `description` field | Top-level `task_description` field |

### What mcp-server-fsm has that steering-flow lacks in config

1. **Liveness properties + self-check protocol**: Each state declares properties the LLM must confirm before requesting a transition. The LLM calls `fsm_submit_self_check` with a structured report (`{property, satisfied, evidence}[]`), which must all pass before a transition token is issued (`@mcp-server-fsm/crates/server/src/automaton.rs:501-541`). steering-flow has no equivalent; conditions are the only gate.

2. **Soft checks (LLM-as-reviewer)**: Transitions can require an independent LLM review via `claude -p` with configurable strategies (`single`, `vote` with N reviewers and pass threshold, `escalate`). The reviewer gets the git diff + artifacts + criteria and returns structured pass/fail (`@mcp-server-fsm/crates/client/src/review.rs:57-108`). steering-flow has no reviewer concept.

3. **Per-state tool permissions**: States can whitelist or blacklist specific tools (e.g., block `Edit` during a review-only phase) (`@mcp-server-fsm/crates/server/src/automaton.rs:659-692`). steering-flow does not restrict tool usage.

4. **Per-state instructions**: Separate from description, allowing longer operational guidance per state. steering-flow merges this into `state_desc`.

### What steering-flow has that mcp-server-fsm lacks in config

1. **Named actions with arguments**: steering-flow's actions are first-class objects with `action_id`, `action_desc`, and typed positional `arguments`. The LLM explicitly chooses which action to invoke and supplies arguments. mcp-server-fsm transitions are identified only by target state, and the LLM cannot pass data at transition time.

2. **Epsilon / auto-routing states**: steering-flow's `is_epsilon: true` states are automatically evaluated at transition time with no LLM involvement. Actions are tried in order; first `true` wins; `{default: true}` is a guaranteed fallback (`@steering-flow/engine.ts:286-328`). mcp-server-fsm has no epsilon state concept.

3. **`{default: true}` fallback conditions**: Only valid as the last action of an epsilon state. Provides a guaranteed catch-all path, enabling routing patterns like "if tests pass go to review, otherwise go back to implement." mcp-server-fsm has no equivalent.

4. **Explicit `${$TAPE_FILE}` placeholder**: Conditions receive the tape path only when the author includes `${$TAPE_FILE}` in `cmd` or `args`, so tape access stays explicit and local to the command shape.

5. **`task_description` as a first-class field**: Always surfaced to the LLM alongside state info. mcp-server-fsm has `description` at the FSM level but it is less prominently surfaced.

---

## C. Flow Enforcement Mechanism

### How each prevents the LLM from exiting mid-flow

#### mcp-server-fsm: Claude Code Stop hook

The hook binary (`mcp-server-fsm-hook stop`) queries the server's `/is_terminal` endpoint. If the FSM is not at the default automaton's exit state, it outputs a Chinese-language message describing the current state and exits with code 2 (`@mcp-server-fsm/crates/hook/src/main.rs:210-256`):

```rust
if resp.is_terminal {
    ExitCode::SUCCESS
} else {
    // Output state info to stdout
    println!("FSM 门禁：当前工作流 {} 在状态 {} 未完成。...", ...);
    ExitCode::from(2)
}
```

**How this works in Claude Code**: Claude Code's hook system invokes hook commands at specific lifecycle points. The `Stop` hook is invoked when the model decides to stop responding. If the hook exits with code 2, Claude Code blocks the stop and injects the hook's stdout into the conversation as a system message. Exit code 0 allows the stop. Exit code 1 is a hook error (different from "block").

**Correctness assessment**: The exit code 2 protocol is correct for Claude Code hooks. The stdout content is injected into the model's context, which is the right mechanism for "you haven't finished yet" messages. The fail-open policy (connection failure -> allow stop) is a reasonable safety choice. However, there is no stagnation detection: if the LLM repeatedly tries to stop and the hook keeps blocking, this loops forever with no circuit breaker.

#### steering-flow: pi `agent_end` event

The plugin listens to `agent_end` events (`@steering-flow/index.ts:551-641`). When fired with a non-empty stack and non-`$END` top state, it calls `pi.sendUserMessage(...)` to inject a reminder. This simulates a "user message" that re-prompts the LLM.

**Guards** (in order of evaluation):
1. `ctx.signal?.aborted` — user abort
2. `wasAborted(event.messages)` — `stopReason === "aborted"`
3. `isAskingQuestion(event.messages)` — last assistant message ends with `?`
4. `CONFIRM_STOP_TAG` — `<STEERING-FLOW-CONFIRM-STOP/>` in last assistant message
5. Compaction cooldown — 60s after `session_compact`
6. **Stagnation detection**: SHA1 hash of `(current_state_id, sorted_tape)`. If the same hash appears 3 times consecutively, reminders pause and a warning is shown to the user (`@steering-flow/index.ts:597-619`).

| Guard | mcp-server-fsm | steering-flow |
|-------|---------------|---------------|
| User abort | Not checked | Yes (`wasAborted`, `ctx.signal.aborted`) |
| Question detection | Not present | Yes (`isAskingQuestion`) |
| Confirm-to-stop tag | Not present | Yes (`<STEERING-FLOW-CONFIRM-STOP/>`) |
| Compaction cooldown | Not present | Yes (60s after `session_compact`) |
| Stagnation limit | Not present | Yes (3 identical reminders -> pause) |
| Subagent support | Yes (separate `subagent-stop` command) | Not applicable (pi has a different agent model) |

### Assessment

mcp-server-fsm's stop hook is structurally correct for Claude Code but minimal: it has no stagnation detection, no abort detection, no question detection, and no escape hatch for the LLM. If the model gets stuck, it will loop indefinitely with the hook blocking every stop attempt.

steering-flow's approach is more robust: the stagnation detector prevents infinite loops, question detection avoids suppressing legitimate user interaction, and the confirm-to-stop tag gives the LLM an explicit escape valve (which the user can also trigger via `/pop-steering-flow`).

---

## D. State Machine Semantics

### Epsilon / auto-routing states

| | mcp-server-fsm | steering-flow |
|--|---------------|---------------|
| **Supported** | No | Yes |
| **Implementation** | N/A | `chainEpsilon()` in `@steering-flow/engine.ts:286-328`; max depth 64 |
| **Routing logic** | N/A | Actions tried in declared order; first `true` wins; `{default: true}` as guaranteed fallback |
| **Rollback on failure** | N/A | If epsilon chain fails after the initial action passed, state is rolled back to pre-transition (`@steering-flow/engine.ts:257-268`) |

Epsilon states are a significant architectural feature of steering-flow. They enable data-dependent routing without LLM involvement, e.g., "if TESTS_PASSED=1, go to review; otherwise go back to implement." mcp-server-fsm has no equivalent; all routing decisions must be made by the LLM choosing a target state.

### Nested FSMs / stack

Both systems support nested FSMs, but with different semantics:

| Aspect | mcp-server-fsm | steering-flow |
|--------|---------------|---------------|
| **Stack model** | In-memory `Vec<FsmStackEntry>` with persisted `stack.json` | On-disk `stack.json` (array of FSM-IDs) + per-FSM directory |
| **Push** | `enter_fsm` tool: looks up pre-registered skill by name, pushes onto stack (`@mcp-server-fsm/crates/server/src/automaton.rs:312-349`) | `load-steering-flow` tool/command: parses a file, pushes a new FSM-ID |
| **Pop** | `exit_fsm` tool: requires being at `exit_state` (`@mcp-server-fsm/crates/server/src/automaton.rs:352-384`) | Automatic on reaching `$END`; also `/pop-steering-flow` (user-only) |
| **FSM source** | Pre-registered YAML "skills" in `~/.mcp_server_fsm/skills/` | Arbitrary file path at runtime |
| **Minimum stack** | Always >= 1 (default automaton at bottom) (`@mcp-server-fsm/crates/server/src/automaton.rs:364-381`) | Can be 0 (no flow active) |
| **Cross-stack back** | `fsm_back(fsm, state)`: searches stack top-down, pops everything above target (`@mcp-server-fsm/crates/server/src/automaton.rs:412-468`) | Not supported (can only pop top) |
| **Resume from state** | `enter_fsm(name, resume_from)`: can enter a skill at an arbitrary state (`@mcp-server-fsm/crates/server/src/automaton.rs:317-328`) | Not supported |

mcp-server-fsm's stack is more powerful: it supports cross-stack rollback and resume-from-state. steering-flow's stack is simpler (push/pop only) but auto-pops on `$END`.

### Tape / context variables

| Aspect | mcp-server-fsm | steering-flow |
|--------|---------------|---------------|
| **Runtime data store** | Git commit hashes as checkpoints (`checkpoint` field); `CheckContext` struct with diff/changed_files/evidence (`@mcp-server-fsm/crates/client/src/guards.rs:23-35`) | `tape.json` per FSM: arbitrary JSON key-value store (`@steering-flow/storage.ts:237-251`) |
| **Who can write** | System only (checkpoint set at enter/transition); evidence passed in `fsm_try_transition` | Condition processes (via file I/O), LLM (`save-to-steering-flow` tool), user (`/save-to-steering-flow`) |
| **Passed to conditions** | Via `FSM_CONTEXT` env var pointing to a temp JSON file with selected fields (`@mcp-server-fsm/crates/client/src/guards.rs:93-96`) | Via argv: tape.json path is appended to the child's argv (`@steering-flow/engine.ts:57-58`) |
| **Re-sync** | No re-sync (context is computed per transition) | Re-synced from disk after every condition execution (`@steering-flow/index.ts:177, 237`) |
| **Caps** | No explicit caps | 64 KiB per value, 1024 keys max |

steering-flow's tape is a general-purpose data store that enables condition-to-condition communication, routing decisions, and LLM data injection. mcp-server-fsm's "context" is narrower: it is computed at transition time from git state and the LLM's evidence string. There is no persistent per-FSM data store that conditions can write to.

### Condition evaluation

| Aspect | mcp-server-fsm | steering-flow |
|--------|---------------|---------------|
| **Hard checks** | Shell command via `sh -c "<run string>"` (`@mcp-server-fsm/crates/client/src/guards.rs:92-93`) | Direct subprocess spawn, no shell (`@steering-flow/engine.ts:63-69`) |
| **Shell injection** | **Possible**: `run` strings are passed to `sh -c`, so a malicious YAML author could inject shell commands. However, the YAML is pre-registered by the user (admin), not by the LLM. | **Not possible by design**: `cmd` and `args` are passed as argv; LLM-supplied args are positional, never shell-interpreted (`@steering-flow/engine.ts:63`) |
| **Soft checks** | Independent LLM review via `claude -p` subprocess with structured JSON output | Not present |
| **Condition output** | Exit code 0 = pass, non-zero = fail (`@mcp-server-fsm/crates/client/src/guards.rs:100-101`) | Stdout first line: `true` or `false`; remainder is reason (`@steering-flow/engine.ts:131-148`) |
| **Timeout** | None (no timeout on hard checks or soft checks) | 30s wall-clock timeout with process-group SIGKILL (`@steering-flow/engine.ts:100-102`) |
| **Output caps** | None | 64 KiB stdout, 16 KiB stderr (`@steering-flow/engine.ts:8-9`) |
| **Process group isolation** | No (`sh -c` inherits the client's process group) | Yes (`detached: true` + negative PID kill on timeout; `@steering-flow/engine.ts:67-68, 83-89`) |

---

## E. Persistence

### On-disk layout

#### mcp-server-fsm

```
~/.mcp_server_fsm/
  server.sock                    # Unix socket
  skills/
    TDD.yaml                     # Pre-registered FSM definitions
  sessions/
    <SESSION-ID>/
      <AGENT-ID>/
        stack.json               # Vec<FsmStackEntry> (full stack + history)
        transitions.jsonl        # Append-only transition log
        reviews.jsonl            # Append-only soft check review log
```

#### steering-flow

```
<CWD>/.pi/steering-flow/<SESSION-ID>/
  stack.json                     # string[] of FSM-IDs
  <FSM-ID>/
    fsm.json                     # Parsed FSM structure (snapshot at load time)
    state.json                   # Current state + transition chain + reminder bookkeeping
    tape.json                    # Key-value tape
```

### Comparison

| Aspect | mcp-server-fsm | steering-flow |
|--------|---------------|---------------|
| **Location** | Global `~/.mcp_server_fsm/` | Per-project `<CWD>/.pi/steering-flow/` |
| **Atomicity** | Write to `.tmp` then rename (`@mcp-server-fsm/crates/server/src/session.rs:387-403`) | Write to `.tmp.<pid>.<rand>` then rename (`@steering-flow/storage.ts:37-43`) |
| **Crash recovery** | Rename is atomic on POSIX. Self-check tokens are in-memory only (not persisted) and regenerated on restore. Write-ahead pattern: clone, mutate, persist, swap (`@mcp-server-fsm/crates/server/src/session.rs:224-249`). | Rename is atomic. Tape is written before state (tape is the "data", state.json is the "commit marker"). Orphan tmp files swept on `session_start` (`@steering-flow/storage.ts:142-162`). |
| **FSM definition persistence** | Skills are files in `skills/`; not persisted per-session. Stack entries reference skill names; on restore, definitions are re-read from `skills/`. | FSM definition is snapshot into `fsm.json` at load time. Independent of the original file. |
| **Session isolation** | By `(session_id, agent_id)` tuple in the server's actor map | By `<CWD>/<SESSION-ID>` filesystem path |
| **Concurrency control** | Single-threaded actor per `(session_id, agent_id)` via tokio mpsc channel (`@mcp-server-fsm/crates/server/src/session.rs:209-380`) | Per-session async mutex (`withSessionLock` in `@steering-flow/storage.ts:66-83`) |
| **Audit trail** | `transitions.jsonl` + `reviews.jsonl` (append-only) | `state.json.last_transition_chain` (replaced each transition, not cumulative) |

mcp-server-fsm's audit trail is strictly superior: append-only JSONL logs are never overwritten. steering-flow's `last_transition_chain` only captures the most recent transition's chain (including epsilon hops), losing history.

---

## F. LLM Interaction Model

### Tools exposed

#### mcp-server-fsm MCP tools

| Tool | Purpose | Source |
|------|---------|--------|
| `enter_fsm(name, resume_from?)` | Push a pre-registered skill | `@mcp-server-fsm/crates/client/src/tools.rs:336-357` |
| `exit_fsm()` | Pop (requires being at exit_state) | `@mcp-server-fsm/crates/client/src/tools.rs:359-366` |
| `fsm_back(steps? \| fsm+state?)` | Roll back within or across FSMs | `@mcp-server-fsm/crates/client/src/tools.rs:368-386` |
| `fsm_get_state()` | Query current state | `@mcp-server-fsm/crates/client/src/tools.rs:388-394` |
| `fsm_submit_self_check(target, checks[])` | Submit liveness self-check | `@mcp-server-fsm/crates/client/src/tools.rs:396-414` |
| `fsm_try_transition(target, evidence?)` | Request transition (runs hard+soft checks) | `@mcp-server-fsm/crates/client/src/tools.rs:416-507` |
| `fsm_get_history(limit?)` | Query transition history | `@mcp-server-fsm/crates/client/src/tools.rs:509-527` |

#### steering-flow pi tools

| Tool | Purpose | Source |
|------|---------|--------|
| `load-steering-flow(file)` | Parse + push a flow config | `@steering-flow/index.ts:362-380` |
| `steering-flow-action(action_id, args[]?)` | Invoke a named action | `@steering-flow/index.ts:383-404` |
| `save-to-steering-flow(id, value)` | Write to tape | `@steering-flow/index.ts:406-428` |
| `get-steering-flow-info()` | Inspect full stack | `@steering-flow/index.ts:430-446` |

### How the LLM knows what actions are available

**mcp-server-fsm**: `fsm_get_state()` returns `available_transitions: Vec<String>` (target state names). The LLM sees these as potential targets for `fsm_try_transition(target)`. There are no action names or descriptions; the LLM must infer the meaning of each target state from the state description and instructions.

**steering-flow**: `renderStateView()` outputs a markdown block listing each action with its `action_id`, `action_desc`, and argument signature (`@steering-flow/engine.ts:380-393`). The LLM sees named, described actions with typed arguments. This is surfaced after every transition, on load, and in stop-hook reminders.

### Transition protocol

**mcp-server-fsm** (multi-step):
1. LLM calls `fsm_get_state()` to see current state + liveness properties
2. LLM works on the task
3. LLM calls `fsm_submit_self_check(target, checks[])` with evidence for each liveness property
4. Server validates: returns `Ready`, `InvalidTarget`, or `SelfCheckFailed`
5. If `Ready`, LLM calls `fsm_try_transition(target, evidence?)`
6. Client executes hard checks (shell) and soft checks (LLM reviewer)
7. If all pass, client calls server's `/transition/commit`
8. Server validates self-check token (target match + TTL) and commits

This is a 3-step protocol: self-check -> prepare -> commit. The self-check token has a 300-second TTL and is invalidated by any state change (`@mcp-server-fsm/crates/server/src/automaton.rs:20`).

**steering-flow** (single-step):
1. LLM calls `steering-flow-action(action_id, args[])`
2. Engine finds action, validates arg count
3. Engine spawns condition process
4. If `true`, transitions; if epsilon target, chains automatically
5. Result (success or failure with reason) returned immediately

This is a 1-step protocol. No self-check is required; the condition process is the sole gate.

### Handling invalid actions

**mcp-server-fsm**: Returns HTTP 400/409 errors with descriptive messages. Invalid targets return `SelfCheckResult::InvalidTarget { valid_targets }`, listing all valid targets.

**steering-flow**: Returns a text message listing available action_ids: `"unknown action 'X' in state 'Y'. Available: a, b, c"` (`@steering-flow/engine.ts:194-200`). Also validates arg count with a signature hint (`@steering-flow/engine.ts:207-213`).

---

## G. Correctness Concerns with mcp-server-fsm

### Does the Stop hook actually work?

**Yes, with caveats**. The hook binary (`mcp-server-fsm-hook stop`) outputs text to stdout and exits with code 2 when the FSM is not terminal. This matches Claude Code's hook contract: exit 2 = block the action and inject stdout. The implementation is correct.

**Missing guards**: No stagnation detection, no abort detection, no question detection. If the model enters a loop where it repeatedly tries to stop and the hook keeps blocking, this will continue indefinitely. The `CLAUDE.md` does not mention this as a known limitation.

### Concurrency issues

**Actor model is sound**: The `FsmActor` processes messages serially via a tokio mpsc channel (`@mcp-server-fsm/crates/server/src/session.rs:209-380`). Parallel MCP tool calls are serialized at the actor level. The write-ahead pattern (clone -> mutate -> persist -> swap) ensures partial writes don't corrupt state.

**TOCTOU in `get_or_create_actor` is fixed**: The CLAUDE.md documents this as a learned lesson. The current code uses a write-lock double-check pattern (`@mcp-server-fsm/crates/server/src/session.rs:656-664`).

**Identity bridge is a potential bottleneck**: The `PendingIdentity` is a single-slot TTL bridge. If two tool calls arrive nearly simultaneously, the second `put()` blocks until the first identity is consumed or expires (10s TTL). This is documented in the code but could cause visible latency.

### Crash / persistence issues

**Self-check token is not persisted**: If the daemon crashes between `fsm_submit_self_check` and `fsm_try_transition`, the token is lost. The LLM must re-submit the self-check. This is by design (CLAUDE.md: "Token is not persisted -- no write-ahead needed").

**Skill YAML evolution**: If a skill YAML is edited between sessions, persisted `stack.json` may reference states that no longer exist. The `restore()` function handles this by falling back to `initial_state` with a warning (`@mcp-server-fsm/crates/server/src/automaton.rs:263-308`). This is a correct degradation path.

### Security concerns

**Shell injection in hard checks**: Hard check `run` strings are passed to `sh -c` (`@mcp-server-fsm/crates/client/src/guards.rs:92`). Since these come from pre-registered YAML skills (authored by the admin), this is a calculated trade-off for convenience. However, if a flow author writes `run: "test ${USER_INPUT}"` where the variable comes from the LLM, injection is possible. The `context` field only controls what data goes into `FSM_CONTEXT` env var, not into the command itself.

**Unix socket authentication**: The server authenticates connecting processes by PID + binary path verification (`@mcp-server-fsm/crates/server/src/auth.rs`). Filename-only matching is gated behind `FSM_ALLOW_FILENAME_AUTH` env var (development only). Socket permissions are 0600. This is adequate for single-user deployment.

**No shell injection in steering-flow**: steering-flow spawns conditions without a shell (`@steering-flow/engine.ts:63`). LLM-supplied arguments are always positional argv entries. The YAML author controls `cmd` and `args`; the LLM controls only the trailing positional arguments. This is inherently safer.

### Silent-failure paths

**Hook fail-open on connection failure**: If the server daemon is not running, the stop hook allows the LLM to stop (`ExitCode::SUCCESS`). This is documented and intentional, but means flow enforcement degrades silently if the daemon crashes.

**Hook fail-close on parse failure**: If the server responds but the response cannot be parsed, the hook exits with code 2 (block). This prevents the LLM from stopping due to a bug, which is the safer direction.

---

## H. Feature Gap Analysis

### What mcp-server-fsm has that steering-flow does not

| Feature | Can be added to steering-flow? | Difficulty |
|---------|-------------------------------|------------|
| **Liveness properties + self-check** | Yes (architectural fit) | Medium — would add a pre-transition self-check step |
| **Soft checks (LLM reviewer)** | Yes (could shell out to `claude -p` or use pi's LLM API) | Medium-High |
| **Per-state tool permissions** | Unlikely — pi's plugin API may not support blocking arbitrary tools | Depends on pi API |
| **Cross-stack rollback** (`fsm_back`) | Yes | Low-Medium |
| **Resume from state** (`enter_fsm(resume_from)`) | Yes | Low |
| **Transition history** (append-only JSONL) | Yes | Low |
| **Binary authentication** (Unix socket peer creds) | Not applicable — in-process model has no IPC to authenticate | Architectural |
| **Multi-session serving** (centralized daemon) | Not applicable — different deployment model | Architectural |

### What steering-flow has that mcp-server-fsm does not

| Feature | Can be added to mcp-server-fsm? | Difficulty |
|---------|-------------------------------|------------|
| **Epsilon / auto-routing states** | Yes (pure state logic addition) | Medium |
| **Named actions with arguments** | Yes (schema change + LLM arg forwarding) | Medium |
| **`{default: true}` fallback conditions** | Yes (tied to epsilon support) | Low (with epsilon) |
| **Tape / general data store** | Yes (add per-FSM key-value store) | Medium |
| **No-shell condition execution** | Yes (switch from `sh -c` to direct spawn) | Low |
| **Condition timeout + process-group kill** | Yes | Low |
| **Stagnation detection in stop hook** | Yes | Low |
| **Abort / question / compaction guards** | Yes | Low |
| **Confirm-to-stop escape valve** | Yes | Low |
| **Condition stdout protocol** (`true`/`false` + reason) | Already has exit-code-based; adding stdout protocol is possible | Low |
| **Orphan tmp file cleanup** | Has no orphan tmp issue (Rust atomic rename) | N/A |

### Architectural differences (cannot be reconciled)

1. **In-process vs out-of-process**: steering-flow's in-process model gives zero-latency state access but ties its lifecycle to the agent process. mcp-server-fsm's daemon model enables multi-session serving and survives agent restarts but adds IPC overhead and daemon management complexity.

2. **Pre-registered skills vs runtime file loading**: mcp-server-fsm requires skills to be placed in `~/.mcp_server_fsm/skills/` before server start. steering-flow loads arbitrary files at runtime. This is a UX choice with trade-offs: pre-registration enables validation at startup; runtime loading enables ad-hoc workflows.

3. **MCP protocol vs direct API**: mcp-server-fsm speaks MCP (JSON-RPC over stdio), which makes it portable to any MCP-compatible host. steering-flow uses pi's plugin API directly, which is more ergonomic but pi-specific.

---

## I. Design Philosophy Differences

### mcp-server-fsm: Formal verification mindset

The project's CLAUDE.md reveals a formal-methods-influenced approach:

- **Invariants are documented and enforced**: I1 (stack >= 1), I2 (current_state in states), I3 (token validity), I4 (history consistency). Each invariant is referenced by ID in code comments.
- **Self-check protocol**: The 3-step transition protocol (self-check -> prepare -> commit) mirrors Hoare-logic-style pre/postcondition verification. The LLM must explicitly assert it has satisfied liveness properties before requesting a transition.
- **Soft checks as independent auditors**: Using a separate LLM instance as a reviewer is a trust-but-verify pattern. The executing agent's claims are cross-checked by an independent reviewer with access to the actual artifacts.
- **Audit trail**: Append-only JSONL logs provide a forensic record of every transition and review decision.
- **Security boundary**: Unix socket peer credentials, binary path verification, and env-gated filename matching reflect a defense-in-depth approach.

**Trade-off**: This formality comes at the cost of complexity. The 3-binary architecture, identity bridging protocol, and multi-step transition flow have a steep learning curve. The CLAUDE.md's "known limitations" section documents 7+ hard-won lessons from bugs found during development.

### steering-flow: Pragmatic robustness

steering-flow prioritizes operational robustness and simplicity:

- **Single-step transitions**: One tool call = one transition attempt. No multi-step ceremony.
- **Epsilon states for automatic routing**: Data-dependent branching happens without LLM involvement, reducing the chance of the LLM making wrong routing decisions.
- **Named actions with arguments**: The LLM sees a menu of named, described actions with typed arguments, reducing ambiguity compared to "choose a target state name."
- **No-shell execution**: Conditions are spawned without a shell, eliminating an entire class of injection risks.
- **Stop hook with multiple guards**: Stagnation detection, abort detection, question detection, and compaction cooldown prevent common failure modes.
- **Tape as a general data store**: Conditions can communicate through tape.json, enabling complex multi-step logic without encoding everything in the FSM structure.

**Trade-off**: No liveness self-check means the LLM can trigger transitions without explicitly confirming its work satisfies quality criteria. No soft checks means there is no independent verification of work quality. The system trusts the condition scripts as the sole quality gate, which is only as good as the scripts themselves.

### Summary

mcp-server-fsm is more thorough about **transition quality assurance** (self-check + hard checks + soft checks) but less thorough about **operational robustness** (no stagnation detection, no escape valve, shell injection surface).

steering-flow is more thorough about **operational robustness** (stagnation detection, multiple stop-hook guards, no-shell execution, timeout enforcement) but less thorough about **transition quality assurance** (no self-check, no independent reviewer).

Both validate FSM definitions at load time (reachability, state references), both persist state atomically, and both support nested FSMs. The fundamental model of "external FSM constraining an LLM agent" is shared; the differences lie in where each system places its trust boundaries and what failure modes each considers most important.
