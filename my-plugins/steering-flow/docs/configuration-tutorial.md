# Steering-Flow Configuration Tutorial

> **Line references** (`@file:line`) are approximate — they track the function/block, not exact lines. Use the function name to locate in source if a line has drifted after edits.

> **Canonical design**: see `docs/ARCHITECTURE.md` first. This file is the syntax-and-invocation companion to the architecture summary.

This is the primary reference for writing `.yaml` (or `.json` / `.md`) flow config files consumed by the `steering-flow` pi plugin. Every claim is backed by a code citation in the form `@file:line-range` so you can click through to the implementation.

---

## Table of Contents

1. [Flow Config File Format](#1-flow-config-file-format)
2. [State Definition](#2-state-definition)
3. [Action Definition](#3-action-definition)
4. [Condition Invocation Model](#4-condition-invocation-model)
5. [Epsilon States](#5-epsilon-states)
6. [Turing Tape (tape.json)](#6-turing-tape)
7. [Parser Validation Rules](#7-parser-validation-rules)
8. [Reachability Check](#8-reachability-check)
9. [On-Disk Layout](#9-on-disk-layout)
10. [Stack Semantics](#10-stack-semantics)
11. [Stop Hook Behavior](#11-stop-hook-behavior)
12. [Commands and Tools Reference](#12-commands-and-tools-reference)
13. [Complete Worked Example](#13-complete-worked-example)
14. [Common Pitfalls](#14-common-pitfalls)
15. [Writing Portable Conditions](#15-writing-portable-conditions)

---

## 1. Flow Config File Format

### Supported file types

The parser dispatches on the file extension extracted from the filename (`@parser.ts:21`):

| Extension | Parsing strategy |
|---|---|
| `.json` | `JSON.parse` directly (`@parser.ts:24-29`) |
| `.yaml`, `.yml` | Built-in YAML parser (`@parser.ts:30-31`) |
| `.md` | Extract YAML front-matter between `---` fences, then YAML-parse it (`@parser.ts:32-35`) |
| Anything else | Try `JSON.parse` first; on failure, fall back to YAML (`@parser.ts:37-43`) |

For `.md` files, the content must start with exactly `---\n`, followed by YAML, followed by `\n---\n`. If the fences are missing, parsing fails with `"No YAML front matter found in .md file"` (`@parser.ts:34`).

### Top-level schema

Every flow config, regardless of file format, must validate as this structure (`@parser.ts:48-66`):

```yaml
task_description: "A required, non-empty string describing the overall task"
states:
  - # ... at least one state object
```

- **`task_description`** (string, required): Shown to the LLM as the overall task. Must be non-empty (`@parser.ts:53-55`).
- **`states`** (array, required): A non-empty array of state objects. The parser rejects empty arrays (`@parser.ts:56-58`).

### Pre-parse normalization

Before dispatching to a format-specific parser, the raw content goes through several normalization steps:

1. **Size limit: 2 MiB.** If `Buffer.byteLength(content, "utf-8") > 2 * 1024 * 1024`, the parser refuses with `"Flow config exceeds 2097152 bytes; refusing to parse"` (`@parser.ts:4,14-16`).

2. **CRLF handling.** All `\r\n` sequences are replaced with `\n`, then any remaining bare `\r` is also replaced. This means Windows-authored files parse correctly (`@parser.ts:17-18`).

3. **BOM stripping.** If the first character is U+FEFF (UTF-8 byte-order mark), it is removed. Without this, the BOM would leak into the first YAML key name and cause silent misparsing (`@parser.ts:19-20`).

4. **Tab rejection.** The YAML parser rejects tab indentation. Any line with a leading tab triggers `"YAML input contains tab indentation; use spaces only"` (`@parser.ts:312-314`). Use spaces for all indentation.

---

## 2. State Definition

Each element of the `states` array is validated by `validateState` (`@parser.ts:68-105`).

### `state_id` (string, required)

The identifier for this state. Naming rules (`@parser.ts:73-79`):

- Must be a non-empty string.
- The two sentinel values `$START` and `$END` are accepted as-is.
- All other state IDs must match the regex `/^[A-Za-z_][A-Za-z0-9_]*$/` -- that is, start with a letter or underscore, followed by letters, digits, or underscores.
- State IDs must be unique across the entire flow. Duplicates are rejected at FSM build time with `"Duplicate state_id: '<id>'"` (`@parser.ts:239-240`).

Examples of valid state IDs: `$START`, `$END`, `implement`, `test_router`, `Phase2`.
Examples of invalid state IDs: `my-state` (hyphen), `2fast` (starts with digit), `$MIDDLE` (dollar sign but not a sentinel).

### `state_desc` (string, required)

A human-readable description of the state's purpose. This string is shown to the LLM as the current-state description in the state view (`@engine.ts:367`).

For the `$END` state specifically, `state_desc` becomes the flow-completion result message shown when the flow finishes (`@engine.ts:250-251`, `@engine.ts:412`).

### `is_epsilon` (boolean, optional, default `false`)

Marks this state as an automatic routing state. When the engine enters an epsilon state, it does not prompt the LLM for a choice -- it evaluates conditions in order and auto-transitions (`@engine.ts:286-328`). See [Section 5: Epsilon States](#5-epsilon-states) for full details.

Constraints:
- `$END` cannot be epsilon: `"$END state cannot be epsilon"` (`@parser.ts:91-92`).
- Defaults to `false` if omitted (`@parser.ts:84`).

### `actions` (array, required for non-$END states)

The list of actions available in this state.

- For `$END`: must be empty (or absent). If actions are present, the parser rejects with `"$END state must not have actions (got N)"` (`@parser.ts:87-90`).
- For all other states: must be a non-empty array. The parser rejects with `"State '<id>' must have at least one action (only $END can have none)"` (`@parser.ts:95-97`).
- **Must be an array, not a mapping.** If you accidentally use YAML mapping syntax instead of an array, the `Array.isArray` check fails and the error fires.

### Complete state example

```yaml
- state_id: "implement"
  state_desc: "Write the code. When done, call mark_done."
  is_epsilon: false
  actions:
    - action_id: "mark_done"
      action_desc: "Signal that implementation is complete."
      condition:
        cmd: "node"
        args: ["./scripts/require-key.mjs", "CODE_WRITTEN", "1"]
      next_state_id: "test"
```

---

## 3. Action Definition

Each action within a state is validated by `validateAction` (`@parser.ts:107-161`).

### `action_id` (string, required)

The identifier the LLM (or user) uses to invoke this action.

- Must be non-empty (`@parser.ts:112-113`).
- Must match `/^[A-Za-z_][A-Za-z0-9_]*$/` (`@parser.ts:115-117`).
- Must be unique within the same state. Duplicates within a state are caught at build time: `"Duplicate action_id '<id>' in state '<state>'"` (`@parser.ts:254-256`).

### `action_desc` (string, required)

Description shown to the LLM so it understands what the action does and when to invoke it (`@parser.ts:118-120`). This text appears in the state view alongside the action ID (`@engine.ts:383-386`).

### `arguments` (array of `{arg_name, arg_desc}`, optional)

Declares the positional arguments the LLM must supply when invoking this action.

```yaml
arguments:
  - arg_name: "PLAN_TEXT"
    arg_desc: "A plain-text plan (2-10 lines) describing the intended changes."
```

Rules (`@parser.ts:129-152`):
- Must be an array if present (not a mapping, not a scalar). Error: `"'arguments' must be an array (got <type>)"`.
- Each element must be an object with `arg_name` (string) and `arg_desc` (string).
- `arg_name` must match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Error: `"arg_name '<name>' ... must match /^[A-Za-z0-9_-]+$/ (letters, digits, underscore, hyphen; must not start with '$')"` (`@parser.ts:142-144`).
- No duplicate `arg_name` within one action: `"Duplicate arg_name '<name>' in action '<id>'"` (`@parser.ts:145-148`).
- **Epsilon actions must have zero arguments.** If an epsilon state's action declares arguments, the parser rejects: `"Epsilon state '<state>' action '<id>' must have no arguments"` (`@parser.ts:134-136`).

At runtime, the engine enforces strict positional count matching. If the LLM supplies a different number of arguments than declared, the action is rejected: `"action '<id>' expects N arg(s) (<sig>) but got M"` (`@engine.ts:206-215`).

### `condition` (object, required)

The condition that gates whether this action's transition succeeds. Two forms exist:

**Form 1: Default transition**
```yaml
condition: { default: true }
```
Only valid as the last action of an epsilon state. Cannot coexist with `cmd`/`args`. See the validation rules in [Section 5](#5-epsilon-states) and `@parser.ts:163-231`.

**Form 2: Command invocation**
```yaml
condition:
  cmd: "node"
  args: ["./scripts/require-key.mjs", "CODE_WRITTEN", "1", "${$TAPE_FILE}"]
```

Full details in [Section 4: Condition Invocation Model](#4-condition-invocation-model).

### `next_state_id` (string, required)

The target state if this action's condition passes (`@parser.ts:122-124`).

- Must reference a state that exists in the flow: `"Action '<id>' in state '<state>' references unknown state '<next>'"` (`@parser.ts:258-260`).
- Must not equal the current `state_id` (no self-loops): `"Action '<id>' in state '<state>' has self-loop (next_state_id = self)"` (`@parser.ts:125-127`).

---

## 4. Condition Invocation Model

This is the most important section for flow authors. Understanding how conditions are spawned, how they receive data, and what they must print is essential for writing working flows.

### No shell

Conditions are spawned via Node.js `spawn(cmd, argv)` directly -- **not** through a shell (`@engine.ts:63-69`). This means:

- No bash, no `sh -c`.
- No environment variable expansion (`$VAR` is literal).
- No glob expansion (`*.js` is literal).
- No piping (`|`), redirection (`>`), or command chaining (`&&`).
- No quoting puzzles -- each argv element is passed as-is.

This design eliminates shell injection from LLM-supplied arguments.

### argv construction

Args are built by interpolating placeholder tokens in the YAML `args` array (`@engine.ts:53-58`):

- **`${$TAPE_FILE}`** — replaced with the absolute path to the current FSM's `tape.json`.
- **`${arg-name}`** — replaced with the LLM-supplied value for the action argument named `arg-name`.

The resolved list of interpolated strings is passed directly to the OS (no shell involved).

**Concrete example.** Given this config:

```yaml
condition:
  cmd: "node"
  args: ["./scripts/save-plan.mjs", "${$TAPE_FILE}", "${PLAN_TEXT}"]
```

And the LLM calls `steering-flow-action plan "my plan text"`, the actual spawn is:

```
spawn("node", ["/abs/path/to/scripts/save-plan.mjs", "/abs/path/to/tape.json", "my plan text"])
```

If you don't need the tape, simply omit `${$TAPE_FILE}` from `args`.

### Command resolution (`resolveTokenRelToFlow`)

The function `resolveTokenRelToFlow` in `@engine.ts:20-26` resolves the `cmd` and each element of `args`:

| Pattern | Resolution | Example |
|---|---|---|
| Bare name (no `/` or `\`) | PATH lookup by the OS | `node`, `python3` |
| `./` or `../` prefix | Resolved against the **flow file's directory** (not the session cwd) | `./scripts/check.mjs` becomes `/path/to/flow-dir/scripts/check.mjs` |
| Absolute path | Used as-is | `/usr/bin/python3` |
| Ambiguous relative (contains `/` but no `./` prefix) | **Rejected at parse time** | `scripts/foo.mjs` -- ERROR |

The ambiguous-relative rejection is enforced by `validateCondition` in `@parser.ts:203-209`:

```
condition.cmd 'scripts/foo.mjs' is path-like but neither absolute nor prefixed with './' or '../'
  -- prefix with './' to resolve relative to the flow file
```

This prevents a subtle bug: without the `./` prefix, a path like `scripts/foo.mjs` would resolve against the session's current working directory instead of the flow file's directory.

**`args` resolution:** Each element of `config.args` also goes through `resolveTokenRelToFlow` (`@engine.ts:55`). So `./data/reference.json` in `args` resolves against the flow file's directory too.

### Stdout contract

The child process communicates its result via stdout (`@engine.ts:131-149`):

1. **First line** must be literally `true` or `false` (case-insensitive, leading/trailing whitespace trimmed).
2. **Remaining lines** are the human-readable reason, returned to the LLM verbatim.
3. On `false`, a reason is expected. If no reason is provided on stdout, stderr is used as a fallback, and if that is also empty, the engine produces `"condition false (no reason provided)"`.
4. On `true` with no reason text, the engine uses `"condition true"`.
5. If the first line is neither `true` nor `false`, the condition is treated as failed with a `"condition kind=malformed"` error that includes the unexpected first-line value, exit status, and stderr.

**Example stdout for success:**
```
true
plan saved (42 chars)
```

**Example stdout for failure:**
```
false
Set CODE_WRITTEN=1 on the tape via save-to-steering-flow. Current value: undefined
```

### Exit code is ignored

The child's exit code does not affect the outcome (`@engine.ts:130`). Only stdout determines whether the condition passed or failed. This means your script can `process.exit(1)` after printing `true` and the condition still passes. However, best practice is to always exit 0 for clarity.

### Timeout

The condition has a 30-second wall-clock timeout (`@engine.ts:8`). If the timer fires:

- The **entire process group** is killed via `SIGKILL` on the negative PID (`@engine.ts:83-89`). This works because the child is spawned with `detached: true` (`@engine.ts:67`), which places it in its own process group on POSIX.
- The result is `{ ok: false, reason: "condition timed out after 30000ms (killed)" }` (`@engine.ts:100-102`).

### Output caps

- **Stdout**: 64 KiB (`@engine.ts:7`). Bytes beyond this limit are discarded and `[stdout truncated]` is appended to the reason (`@engine.ts:138`).
- **Stderr**: 16 KiB (`@engine.ts:8`). Same truncation behavior (`@engine.ts:117-128`).

### Process isolation

Each condition child runs in its own process group (`detached: true` at `@engine.ts:67`). On timeout, the kill signal is sent to `-child.pid` (the process group), which kills the entry-point process and all its descendants (`@engine.ts:83-89`). If the group kill fails (e.g., on Windows), a fallback kills the direct child only (`@engine.ts:88`).

---

## 5. Epsilon States

Epsilon states enable automatic, data-driven routing without LLM involvement. When the engine enters an epsilon state, it evaluates conditions in order and transitions automatically.

### Declaration

Set `is_epsilon: true` on the state:

```yaml
- state_id: "test_router"
  state_desc: "Automatic router -- branches on TESTS_PASSED."
  is_epsilon: true
  actions:
    - action_id: "tests_ok"
      action_desc: "Tests passed -> review"
      condition:
        cmd: "node"
        args: ["./scripts/require-key.mjs", "TESTS_PASSED", "1"]
      next_state_id: "review"
    - action_id: "tests_fail"
      action_desc: "Default -> go back to implement"
      condition: { default: true }
      next_state_id: "implement"
```

### Rules

1. **No arguments.** All actions in an epsilon state must have zero arguments. The LLM does not participate in epsilon transitions, so there is no one to supply argument values (`@parser.ts:134-136`).

2. **Actions are tried in declared order.** The engine iterates `state.actions` from first to last. The first action whose condition returns `true` wins (`@engine.ts:302-309`).

3. **Last action MUST be `{ default: true }`.** This is the unconditional fallback. Without it, the epsilon chain could fail to match anything. The parser enforces: `"Epsilon state '<state>' last action '<id>' must have condition { default: true }"` (`@parser.ts:187-189`).

4. **Earlier actions MUST NOT be `{ default: true }`.** A default that is not last would shadow all subsequent actions, making them unreachable: `"Epsilon state '<state>' action '<id>' uses { default: true } but is not the last action (would make later actions unreachable)"` (`@parser.ts:190-192`).

5. **Non-epsilon states cannot use `{ default: true }` at all.** `"Non-epsilon state '<state>' action '<id>' cannot use { default: true }"` (`@parser.ts:193-195`).

### Epsilon chain depth limit

The engine caps epsilon chaining at 64 consecutive epsilon transitions (`@engine.ts:5`). If exceeded: `"epsilon chain exceeded max depth 64"` (`@engine.ts:327`). This prevents infinite loops in flows that accidentally chain epsilon states cyclically.

### Auto-routing after a non-epsilon transition

When a non-epsilon action successfully transitions into an epsilon state, the engine automatically continues the epsilon chain without returning to the LLM (`@engine.ts:255-256`). The LLM only sees the final (non-epsilon) state after all chaining is complete.

### Rollback on epsilon chain failure

If the initial (non-epsilon) action's condition passes but the subsequent epsilon chain fails (all conditions return `false` and there is no default -- which should not happen if the parser rules are followed), the engine rolls back to the state before the action was invoked. Nothing is persisted (`@engine.ts:257-270`). Note: tape side-effects from conditions that did run are **not** rolled back (conditions write directly to the tape file).

---

## 6. Turing Tape

The tape is a per-FSM JSON key-value store that conditions read and write. It is the primary mechanism for passing data between states and between the LLM and conditions.

### Storage

The tape is stored at `.pi/steering-flow/<SESSION-ID>/<FSM-ID>/tape.json` (`@storage.ts:131-133`). It is a flat JSON object at the top level (`@storage.ts:237-245`), but values can be any JSON-serializable type (`@types.ts:68`):

```json
{
  "PLAN_TEXT": "implement the frobnicate endpoint",
  "CODE_WRITTEN": "1",
  "metrics": { "lines_changed": 42, "files_touched": 3 }
}
```

### How conditions access the tape

When `${$TAPE_FILE}` is present in `args`, the engine substitutes its absolute path at spawn time. The condition script receives it as a positional argv element and:

1. Reads the file: `JSON.parse(readFileSync(tapePath, "utf-8"))`
2. Inspects or modifies the object
3. (Optionally) writes it back: `writeFileSync(tapePath, JSON.stringify(tape, null, 2))`

Conditions can write **any JSON type** as values -- strings, numbers, booleans, arrays, objects, null.

### How the LLM writes to the tape

The LLM uses the `save-to-steering-flow` tool (`@index.ts:406-428`):

```
save-to-steering-flow(id="CODE_WRITTEN", value="1")
```

Via this tool path, values are always **strings** (the tool parameter type is `Type.String`). If you need non-string values in the tape, a condition script must write them.

### Tape key naming rules

Tape IDs must match `/^[A-Za-z_][A-Za-z0-9_]*$/` (`@index.ts:418`). This is the same identifier regex used for state IDs, action IDs, and argument names.

### Limits

- **Per-value size**: 64 KiB (`@index.ts:41`). Enforced in the `save-to-steering-flow` tool: `"Tape value for '<id>' exceeds 65536 bytes."` (`@index.ts:269-271`).
- **Maximum keys**: 1024 (`@index.ts:42`). Enforced when adding a new key (not when updating existing): `"Tape is full (1024 keys max)."` (`@index.ts:276-278`).

Note: These limits apply to the LLM's `save-to-steering-flow` tool. Condition scripts writing directly to `tape.json` are not subject to these limits (but should be reasonable to avoid bloating the file).

### Re-sync after condition invocation

After every condition invocation, the plugin re-reads `tape.json` from disk so that any writes the condition made are immediately visible to the in-memory runtime (`@index.ts:176-177`, `@index.ts:236`). This means a condition can modify the tape, and the next condition in an epsilon chain (or the next action invocation) will see those changes.

---

## 7. Parser Validation Rules -- Complete List

All rules are enforced at parse time (before the FSM is loaded into the runtime). Each rule lists the validation function, the error message pattern, and what triggers it.

### From `parseFlowConfig` (`@parser.ts:13-46`)

| Rule | Error message | Trigger |
|---|---|---|
| File too large | `"Flow config exceeds 2097152 bytes; refusing to parse"` | Content > 2 MiB |
| Tabs in YAML | `"YAML input contains tab indentation; use spaces only"` | Any line with leading tab character |
| Invalid JSON | `"Invalid JSON: <detail>"` | `.json` file with syntax error |
| No front-matter | `"No YAML front matter found in .md file"` | `.md` file missing `---` fences |

### From `validateFlowConfig` (`@parser.ts:48-66`)

| Rule | Error message | Trigger |
|---|---|---|
| Not an object | `"Flow config must be an object"` | Top-level value is array, string, null, etc. |
| Missing task_description | `"Missing or empty 'task_description'"` | `task_description` absent, empty, or non-string |
| Missing states | `"'states' must be a non-empty array"` | `states` absent, empty, or not an array |

### From `validateState` (`@parser.ts:68-105`)

| Rule | Error message | Trigger |
|---|---|---|
| Not an object | `"Each state must be an object"` | State element is not an object |
| Missing state_id | `"State missing 'state_id'"` | `state_id` absent or empty |
| Invalid state_id | `"state_id '<id>' must match /^[A-Za-z_][A-Za-z0-9_]*$/ (or be '$START' / '$END')"` | Non-sentinel ID fails regex |
| Missing state_desc | `"State '<id>' missing 'state_desc'"` | `state_desc` absent or non-string |
| $END has actions | `"$END state must not have actions (got N)"` | `$END` with non-empty actions array |
| $END is epsilon | `"$END state cannot be epsilon"` | `$END` with `is_epsilon: true` |
| Non-$END no actions | `"State '<id>' must have at least one action (only $END can have none)"` | Non-$END state with empty or missing actions array |

### From `validateAction` (`@parser.ts:107-161`)

| Rule | Error message | Trigger |
|---|---|---|
| Not an object | `"Action in state '<state>' must be an object"` | Action element is not an object |
| Missing action_id | `"Action in state '<state>' missing 'action_id'"` | `action_id` absent or empty |
| Invalid action_id | `"action_id '<id>' must match /^[A-Za-z_][A-Za-z0-9_]*$/"` | ID fails regex |
| Missing action_desc | `"Action '<id>' in state '<state>' missing 'action_desc'"` | `action_desc` absent or non-string |
| Missing next_state_id | `"Action '<id>' in state '<state>' missing 'next_state_id'"` | `next_state_id` absent or empty |
| Self-loop | `"Action '<id>' in state '<state>' has self-loop (next_state_id = self)"` | `next_state_id === state_id` |
| arguments not array | `"Action '<id>' in state '<state>': 'arguments' must be an array (got <type>)"` | `arguments` is a non-array, non-null value |
| Epsilon with args | `"Epsilon state '<state>' action '<id>' must have no arguments"` | Epsilon state action has arguments |
| Invalid arg | `"Invalid argument in action '<id>'"` | Argument element is not an object |
| Missing arg_name | `"Argument missing 'arg_name' in action '<id>'"` | `arg_name` absent or non-string |
| Invalid arg_name | `"arg_name '<name>' in action '<id>' must match /^[A-Za-z0-9_-]+$/ (letters, digits, underscore, hyphen; must not start with '$')"` | Name fails regex |
| Duplicate arg_name | `"Duplicate arg_name '<name>' in action '<id>'"` | Same name used twice in one action |
| Missing arg_desc | `"Argument missing 'arg_desc' in action '<id>'"` | `arg_desc` absent or non-string |

### From `validateCondition` (`@parser.ts:163-231`)

| Rule | Error message | Trigger |
|---|---|---|
| Not an object | `"'condition' must be an object (either { default: true }, { builtin, args? }, or { cmd, args? })"` | Condition is null, array, scalar, etc. |
| Mixed default+cmd | `"condition cannot mix 'default: true' with 'cmd'/'args' (pick one form)"` | Both `default:true` and `cmd` present |
| Bad default value | `"condition.default must be omitted or equal to true (got <value>)"` | `default` is present but not `true` |
| Epsilon last not default | `"Epsilon state '<state>' last action '<id>' must have condition { default: true }"` | Last action of epsilon state lacks default |
| Epsilon non-last default | `"... uses { default: true } but is not the last action (would make later actions unreachable)"` | Non-last action of epsilon state uses default |
| Non-epsilon default | `"Non-epsilon state '<state>' action '<id>' cannot use { default: true }"` | Default condition on a non-epsilon state |
| Empty cmd | `"condition.cmd must be a non-empty string"` | `cmd` is empty or non-string |
| Ambiguous relative cmd | `"condition.cmd '<cmd>' is path-like but neither absolute nor prefixed with './' or '../'"` | `cmd` contains `/` but no `./` or `../` prefix |
| args not array | `"condition.args must be an array of strings"` | `args` is not an array |
| args element not string | `"condition.args[N] must be a string (got <type>)"` | Non-string element in args array |

### From `buildFSM` (`@parser.ts:233-287`)

| Rule | Error message | Trigger |
|---|---|---|
| Duplicate state_id | `"Duplicate state_id: '<id>'"` | Two states with the same ID |
| Missing $START | `"Missing $START state"` | No state with `state_id: "$START"` |
| Missing $END | `"Missing $END state"` | No state with `state_id: "$END"` |
| Duplicate action_id | `"Duplicate action_id '<id>' in state '<state>'"` | Two actions with the same ID within one state |
| Unknown next_state | `"Action '<id>' in state '<state>' references unknown state '<next>'"` | `next_state_id` points to nonexistent state |
| Unreachable $END | `"$END is not reachable from $START -- flow would deadlock"` | Forward BFS from $START cannot reach $END |
| Dead-end states | `"Dead-end states detected (reachable from $START but cannot reach $END): X, Y"` | Reverse BFS from $END: states reachable from $START but with no path to $END |

---

## 8. Reachability Check

After all states, actions, and conditions pass individual validation, `buildFSM` performs a **bidirectional BFS** (`@parser.ts:267-315`):

### Forward BFS (from $START)

1. Start with `$START` in the queue.
2. For each visited state, enqueue all states reachable via any action's `next_state_id`.
3. After exhausting the queue, check if `$END` was visited.

If `$END` is not reachable, the parser rejects with `"$END is not reachable from $START -- flow would deadlock"`.

### Reverse BFS (from $END)

1. Build a reverse adjacency graph: if state A has an action with `next_state_id: B`, add a reverse edge B → A.
2. BFS from `$END` following reverse edges.
3. For every state that was forward-reachable from `$START`, check if it's also reverse-reachable from `$END`.
4. Any state that is forward-reachable but NOT reverse-reachable is a **dead-end** — it can be entered but can never progress to `$END`.

If dead-end states are found, the parser rejects with `"Dead-end states detected (reachable from $START but cannot reach $END): state_a, state_b. Every state must have a path to $END — no dead loops allowed."`.

### What this proves

There exists a structural path from `$START` to `$END`, **and** from every intermediate state reachable from `$START` there also exists a structural path to `$END`. No state is a dead-end.

### What this does NOT prove

The flow will actually reach `$END` at runtime. Conditions might always return `false`, tape values might never be set, or epsilon routing might fail at runtime. The reachability check is purely structural — it cannot decide whether conditions will pass.

---

## 9. On-Disk Layout

All steering-flow state lives under `.pi/steering-flow/` in the project root (`@storage.ts:1-17`):

```
.pi/steering-flow/<SESSION-ID>/
  stack.json                     # ordered list of FSM-IDs (last = top)
  <FSM-ID>/
    fsm.json                     # full parsed FSM structure + flow_dir
    state.json                   # current_state_id, entered_at, transition log, stagnation bookkeeping
    tape.json                    # { key: value, ... }
```

### Files

**`stack.json`** (`@storage.ts:87-98`): A JSON array of FSM-ID strings. The last element is the top of the stack (the active flow). Lives at the session level, not per-FSM.

**`fsm.json`** (`@storage.ts:166-199`): Contains the complete parsed FSM structure: `fsm_id`, `flow_name`, `flow_dir`, `task_description`, and `states` (the full state/action/condition graph). The `flow_dir` field records the directory of the original flow config file so that relative `cmd`/`args` paths continue to resolve correctly even if the session's cwd changes.

**`state.json`** (`@storage.ts:210-235`): Contains `current_state_id`, `entered_at` (ISO timestamp), `last_transition_chain` (array of transition records), and stagnation bookkeeping fields (`reminder_count`, `last_reminder_hash`).

**`tape.json`** (`@storage.ts:237-251`): A flat JSON object mapping string keys to arbitrary JSON values.

### Atomicity

All writes use atomic tmp+rename: a temporary file is written first, then renamed into place (`@storage.ts:37-43`). This prevents truncation on crash. Orphan `.tmp.*` files from crashed writes are swept on `session_start` (`@storage.ts:142-162`).

### Concurrency

A per-session async mutex serializes all read-modify-write operations (`@storage.ts:64-83`). This prevents race conditions when the framework runs multiple tool calls in parallel.

---

## 10. Stack Semantics

### Push on load

When a flow config is loaded (via `/load-steering-flow` or the `load-steering-flow` tool), a new FSM is created and pushed onto the stack (`@index.ts:159`). The FSM ID is generated from a timestamp, slugified flow name, and random bytes (`@storage.ts:275-279`).

### Pop on $END

When a transition reaches `$END`, the FSM is automatically popped from the stack and its directory is deleted (`@index.ts:249-250`). If there is a parent flow underneath, its state view is rendered so the LLM knows to resume it (`@index.ts:252-257`).

### Pop on user command

The user can force-pop the top FSM at any time with `/pop-steering-flow` (`@index.ts:469-482`). This is a user-only operation -- the LLM cannot pop flows.

### Nested flows

Loading a flow while another flow is active simply pushes a new FSM on top (`@index.ts:114-117`). The previous flow is suspended. Only the top of the stack is actively driven by the stop hook and action calls (`@index.ts:586`).

When the nested flow reaches `$END` and is popped, the parent flow's state view is displayed and the parent becomes the active flow again (`@index.ts:199-207`).

---

## 11. Stop Hook Behavior

The stop hook is the mechanism that prevents the LLM from silently abandoning a flow mid-progress. It fires on the `agent_end` event (`@index.ts:551`).

### Trigger condition

The hook fires when ALL of these are true:
- The `agent_end` event occurs (the LLM has finished generating).
- The flow stack is non-empty (`@index.ts:583`).
- The top FSM's current state is not `$END` (`@index.ts:594`).

When triggered, the hook injects the current state view (including task description, current state, and available actions) as a user message via `pi.sendUserMessage(...)`, effectively re-prompting the LLM to continue driving the flow (`@index.ts:628-636`).

### Guards that suppress the reminder

Several guards prevent the reminder from firing even when the trigger conditions are met:

1. **User abort.** If `ctx.signal.aborted` or the last assistant message has `stopReason === "aborted"` (`@index.ts:558-559`, `@stop-guards.ts:18-24`).

2. **Question detection.** If the last assistant message ends with `?` or contains a `question` tool call, the LLM is asking the user something and should not be re-prompted (`@index.ts:562`, `@stop-guards.ts:27-42`).

3. **Compaction cooldown.** For 60 seconds after a `session_compact` event, reminders are suppressed to avoid re-prompting the LLM while it is still processing the compacted context (`@index.ts:43,568-569`). The compaction timestamp is tracked per session (`@index.ts:545-547`).

4. **Stagnation limit.** If the same `(current_state_id, tape)` hash has been seen for 3 consecutive reminders, the hook stops re-prompting and instead notifies the user via `ctx.ui.notify` with a warning (`@index.ts:44,605-619`). The hash is computed over `current_state_id + "\0" + stableStringify(tape)` using SHA-1 (`@index.ts:597-599`). When the state or tape changes (e.g., the LLM saves a tape value or transitions), the counter resets (`@index.ts:603`).

5. **Confirm-stop tag.** If the last assistant message contains the literal string `<STEERING-FLOW-CONFIRM-STOP/>`, the hook does not fire (`@index.ts:45,564-565`). The LLM is instructed to output this tag when the user explicitly wants to abandon the flow.

### What happens when stagnation fires

When `nextCount > STOP_HOOK_STAGNATION_LIMIT` (i.e., more than 3 identical reminders):
- A warning notification is sent to the user: `"steering-flow: stagnation detected in '<flow>' at state '<state>' (N identical reminders). Re-prompt paused."` (`@index.ts:608-611`).
- The reminder counter is persisted but no `sendUserMessage` is issued (`@index.ts:614-619`).
- The reminder automatically re-enables when the state or tape changes (the hash changes, so `nextCount` resets to 1 at `@index.ts:603`).

---

## 12. Commands and Tools Reference

### Slash Commands (user)

| Command | Usage | Notes |
|---|---|---|
| `/load-steering-flow <FILE>` | Load a flow config file and push it onto the stack | File path relative to cwd or absolute. Parses, validates, creates on-disk state, runs initial epsilon chain from $START (`@index.ts:452-467`). |
| `/pop-steering-flow` | Pop the top FSM from the stack | **User-only.** Not available as an LLM tool. Force-removes the active flow. If a parent exists, it is resumed (`@index.ts:469-482`). |
| `/save-to-steering-flow <ID> <VALUE>` | Write a key-value pair to the top FSM's tape | ID is the first whitespace-delimited token; VALUE is the remainder. ID must match the identifier regex (`@index.ts:484-504`). |
| `/get-steering-flow-info` | Print the full stack with states and tape contents | Shows all FSMs in the stack, not just the top. Includes tape key/value dump (`@index.ts:506-518`). |
| `/steering-flow-action <ACTION-ID> [ARGS...]` | Invoke an action on the top FSM | Supports shell-style quoting for args with spaces. Uses a tokenizer that handles single/double quotes and backslash escapes (`@index.ts:520-541`). |

### LLM Tools

| Tool | Parameters | Description |
|---|---|---|
| `load-steering-flow` | `file` (string) | Load a flow config file. Path relative to cwd or absolute (`@index.ts:362-381`). |
| `steering-flow-action` | `action_id` (string), `args` (string[], optional) | Invoke an action. Args are positional, matching the action's declared arguments (`@index.ts:383-404`). |
| `save-to-steering-flow` | `id` (string), `value` (string) | Write to tape. ID must match identifier regex. Value max 64 KiB (`@index.ts:406-428`). |
| `get-steering-flow-info` | (none) | Inspect the full stack (`@index.ts:430-446`). |

**`pop-steering-flow` is intentionally NOT registered as a tool** (`@index.ts:448`). The LLM cannot pop flows -- only the user can.

---

## 13. Complete Worked Example

This section walks through the example flow at `examples/code-review.yaml` and its helper scripts.

### The flow file

**`examples/code-review.yaml`** (`@examples/code-review.yaml:1-81`)

```yaml
task_description: "Implement a small feature end-to-end: plan -> implement -> test -> review -> done. Do not skip steps."
```

This is the top-level task description shown to the LLM throughout the flow.

**States:**

```
$START --[plan]--> implement --[mark_done]--> test --[tests_run]--> test_router
                                                                       |
                                                          (epsilon)    |
                                                   tests_ok? ---------> review --[approve]--> $END
                                                   tests_fail? -------> implement  (loop back)
```

#### State: `$START` (line 14-27)

```yaml
- state_id: "$START"
  state_desc: "Beginning of the feature workflow. You must first produce a plan via the `plan` action before implementing anything."
  is_epsilon: false
  actions:
    - action_id: "plan"
      action_desc: "Submit a written plan for the feature. Writes PLAN_TEXT to tape.json."
      arguments:
        - arg_name: "PLAN_TEXT"
          arg_desc: "A plain-text plan (2-10 lines) describing the intended changes."
      condition:
        cmd: "node"
        args: ["./scripts/save-plan.mjs"]
      next_state_id: "implement"
```

One action: `plan`. Takes one argument `PLAN_TEXT`. The condition invokes `node ./scripts/save-plan.mjs` with `${$TAPE_FILE}` and `${PLAN_TEXT}` in `args`, so argv is: `[node, /abs/scripts/save-plan.mjs, /abs/tape.json, <PLAN_TEXT>]`.

#### State: `implement` (line 29-38)

```yaml
- state_id: "implement"
  state_desc: "Write the code. When you believe the implementation is complete, call `mark_done`."
  is_epsilon: false
  actions:
    - action_id: "mark_done"
      action_desc: "Signal that implementation is complete. Requires tape key CODE_WRITTEN=1."
      condition:
        cmd: "node"
        args: ["./scripts/require-key.mjs", "CODE_WRITTEN", "1"]
      next_state_id: "test"
```

One action: `mark_done`. No arguments (the LLM doesn't pass anything). The condition checks that `tape["CODE_WRITTEN"] === "1"`. The argv is: `[node, /abs/scripts/require-key.mjs, CODE_WRITTEN, 1, /abs/tape.json]` -- `CODE_WRITTEN` and `1` are literal config args, and `${$TAPE_FILE}` is the last `args` entry.

#### State: `test` (line 40-49)

```yaml
- state_id: "test"
  state_desc: "Run the tests. Save TESTS_PASSED=1 (or 0) to the tape; the router will branch automatically."
  is_epsilon: false
  actions:
    - action_id: "tests_run"
      action_desc: "Signal that tests have been executed."
      condition:
        cmd: "node"
        args: ["./scripts/require-key-any.mjs", "TESTS_PASSED"]
      next_state_id: "test_router"
```

One action: `tests_run`. Condition checks that `TESTS_PASSED` exists and is non-empty. Transitions to the epsilon router.

#### State: `test_router` (line 51-64) -- EPSILON

```yaml
- state_id: "test_router"
  state_desc: "Automatic router -- branches on TESTS_PASSED."
  is_epsilon: true
  actions:
    - action_id: "tests_ok"
      action_desc: "Tests passed -> review"
      condition:
        cmd: "node"
        args: ["./scripts/require-key.mjs", "TESTS_PASSED", "1"]
      next_state_id: "review"
    - action_id: "tests_fail"
      action_desc: "Default -> go back to implement"
      condition: { default: true }
      next_state_id: "implement"
```

This is an epsilon state with two actions:
1. `tests_ok`: checks `TESTS_PASSED === "1"`. If true, goes to `review`.
2. `tests_fail`: `{ default: true }` -- the unconditional fallback. Goes back to `implement`.

The engine tries them in order. If `TESTS_PASSED` is `"1"`, the first action matches and we go to `review`. Otherwise, the default fires and we loop back to `implement`. The LLM is never asked to choose -- this happens automatically.

#### State: `review` (line 66-76)

```yaml
- state_id: "review"
  state_desc: "Final self-review. Call `approve` to finish."
  is_epsilon: false
  actions:
    - action_id: "approve"
      action_desc: "Approve and finish the flow."
      condition:
        cmd: "node"
        args: ["./scripts/always-true.mjs", "approved"]
      next_state_id: "$END"
```

One action: `approve`. No `${$TAPE_FILE}` in `args`, so the tape path is not passed. The argv is: `[node, /abs/scripts/always-true.mjs, approved]`. The script always prints `true`.

#### State: `$END` (line 78-81)

```yaml
- state_id: "$END"
  state_desc: "Feature shipped: plan documented, code written, tests passed, and self-review approved."
  is_epsilon: false
  actions: []
```

No actions. The `state_desc` becomes the completion message.

### Helper scripts

All scripts live in `examples/scripts/` and are referenced via `./scripts/<name>.mjs` (resolved relative to the flow file's directory).

#### `save-plan.mjs` (`@examples/scripts/save-plan.mjs:1-14`)

```javascript
#!/usr/bin/env node
// argv: [tape_path, PLAN_TEXT]
import { readFileSync, writeFileSync } from "node:fs";
const [tape, plan] = process.argv.slice(2);
if (!plan || !plan.trim()) {
    console.log("false");
    console.log("PLAN_TEXT argument is empty");
    process.exit(0);
}
const t = JSON.parse(readFileSync(tape, "utf-8"));
t.PLAN_TEXT = plan;
writeFileSync(tape, JSON.stringify(t, null, 2));
console.log("true");
console.log(`plan saved (${plan.length} chars)`);
```

Receives tape path and the LLM-supplied plan text. Validates that the plan is non-empty, writes it into the tape as `PLAN_TEXT`, and prints `true`. This demonstrates a condition that both checks a precondition and writes tape state in one operation.

#### `require-key.mjs` (`@examples/scripts/require-key.mjs:1-12`)

```javascript
#!/usr/bin/env node
// argv: [KEY, EXPECTED_VALUE, tape_path]
import { readFileSync } from "node:fs";
const [key, expected, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
if (t[key] === expected) {
    console.log("true");
    console.log(`${key} matches '${expected}'`);
} else {
    console.log("false");
    console.log(`Set ${key}=${expected} on the tape via save-to-steering-flow. Current value: ${JSON.stringify(t[key])}`);
}
```

Checks that a specific tape key equals an expected value. `KEY` and `EXPECTED_VALUE` are literal `args` entries; `${$TAPE_FILE}` is the last `args` entry. So `process.argv.slice(2)` gives `[KEY, EXPECTED_VALUE, tape_path]`.

#### `require-key-any.mjs` (`@examples/scripts/require-key-any.mjs:1-11`)

```javascript
#!/usr/bin/env node
// argv: [KEY, tape_path]
import { readFileSync } from "node:fs";
const [key, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
if (typeof t[key] === "string" && t[key].length > 0) {
    console.log("true");
    console.log(`${key} is set: ${t[key]}`);
} else {
    console.log("false");
    console.log(`Save ${key}=<something> to the tape via save-to-steering-flow.`);
}
```

Checks that a tape key exists and has a non-empty string value. Less strict than `require-key.mjs` -- any non-empty string passes.

#### `always-true.mjs` (`@examples/scripts/always-true.mjs:1-5`)

```javascript
#!/usr/bin/env node
// argv: [MESSAGE, ...extra_llm_args]  (no ${$TAPE_FILE} in args)
const [msg] = process.argv.slice(2);
console.log("true");
console.log(msg || "ok");
```

Always succeeds. Prints the first arg as the reason. No `${$TAPE_FILE}` in `args`, so it receives only the config args.

### Happy path walkthrough

```
User: /load-steering-flow examples/code-review.yaml
```

1. Parser validates the YAML. `buildFSM` confirms $START/$END exist, all references resolve, $END is reachable.
2. FSM is pushed onto the stack. State is set to `$START`.
3. `enterStart` checks if `$START` is epsilon. It is not, so no chaining occurs.
4. The LLM sees:
   - **Current state**: `$START`
   - **Available actions**: `plan` (with arg `PLAN_TEXT`)

```
LLM: steering-flow-action(action_id="plan", args=["Implement frobnicate endpoint:\n1. Add route\n2. Write handler\n3. Add tests"])
```

5. Engine spawns: `node /abs/scripts/save-plan.mjs /abs/tape.json "Implement frobnicate..."`
6. `save-plan.mjs` writes `PLAN_TEXT` to tape, prints `true`.
7. Transition: `$START` -> `implement`. Tape now has `PLAN_TEXT`.
8. LLM sees state `implement` with action `mark_done`.

```
LLM: (writes code, then)
     save-to-steering-flow(id="CODE_WRITTEN", value="1")
     steering-flow-action(action_id="mark_done", args=[])
```

9. Engine spawns: `node /abs/scripts/require-key.mjs CODE_WRITTEN 1 /abs/tape.json`
10. `require-key.mjs` reads tape, finds `CODE_WRITTEN === "1"`, prints `true`.
11. Transition: `implement` -> `test`.

```
LLM: (runs tests, then)
     save-to-steering-flow(id="TESTS_PASSED", value="1")
     steering-flow-action(action_id="tests_run", args=[])
```

12. Engine spawns `require-key-any.mjs` -- `TESTS_PASSED` exists and is non-empty. Prints `true`.
13. Transition: `test` -> `test_router`.
14. `test_router` is epsilon! Engine auto-routes:
    - Tries `tests_ok`: spawns `require-key.mjs TESTS_PASSED 1 /abs/tape.json`. `TESTS_PASSED === "1"` -- `true`!
    - Transitions to `review`. (Does not try `tests_fail`.)
15. LLM sees state `review` with action `approve`.

```
LLM: steering-flow-action(action_id="approve", args=[])
```

16. Engine spawns: `node /abs/scripts/always-true.mjs approved` (no tape path -- `${$TAPE_FILE}` not in `args`). Prints `true approved`.
17. Transition: `review` -> `$END`.
18. Flow complete! FSM popped from stack. Completion message: "Feature shipped: plan documented, code written, tests passed, and self-review approved."

### Unhappy path: calling `mark_done` before `CODE_WRITTEN` is set

```
LLM: steering-flow-action(action_id="mark_done", args=[])
```

1. Engine spawns `require-key.mjs CODE_WRITTEN 1 /abs/tape.json`.
2. `require-key.mjs` reads tape. `tape["CODE_WRITTEN"]` is `undefined`.
3. Prints:
   ```
   false
   Set CODE_WRITTEN=1 on the tape via save-to-steering-flow. Current value: undefined
   ```
4. Engine returns failure. State stays at `implement`.
5. The LLM sees the rejection reason and knows it must save `CODE_WRITTEN=1` first.

### Unhappy path: tests fail

```
LLM: save-to-steering-flow(id="TESTS_PASSED", value="0")
     steering-flow-action(action_id="tests_run", args=[])
```

1. `require-key-any.mjs` checks `TESTS_PASSED` -- it is `"0"`, which is a non-empty string. Prints `true`.
2. Transition: `test` -> `test_router` (epsilon).
3. Engine tries `tests_ok`: `require-key.mjs TESTS_PASSED 1 /abs/tape.json`. `tape["TESTS_PASSED"]` is `"0"`, not `"1"`. Prints `false`.
4. Engine tries `tests_fail`: `{ default: true }`. Matches unconditionally.
5. Transition: `test_router` -> `implement`.
6. LLM is back at `implement` and must fix the code, re-run tests, and set `TESTS_PASSED=1`.

---

## 14. Common Pitfalls

### 1. Using `scripts/foo.mjs` instead of `./scripts/foo.mjs`

**Wrong:**
```yaml
condition:
  cmd: "scripts/check.mjs"
```

**Error at parse time:**
```
condition.cmd 'scripts/check.mjs' is path-like but neither absolute nor prefixed
with './' or '../' -- prefix with './' to resolve relative to the flow file
```

The fix is to always prefix relative paths with `./`:

```yaml
condition:
  cmd: "./scripts/check.mjs"
```

This applies to `cmd` values. For `args` elements, the same prefix rule applies for path resolution (but the parser does not reject ambiguous args -- they just will not resolve as expected).

### 2. Forgetting `is_epsilon: true` on a routing state

If you intend a state to auto-route but forget `is_epsilon: true`, the engine will present the actions to the LLM as manual choices. Worse, the parser will reject `{ default: true }` conditions because they are only valid on epsilon states:

```
Non-epsilon state 'test_router' action 'tests_fail' cannot use { default: true }
```

### 3. Putting `{ default: true }` as a non-last action

```yaml
# WRONG -- default shadows the second action
actions:
  - action_id: "fallback"
    condition: { default: true }
    next_state_id: "A"
  - action_id: "check_something"
    condition: { cmd: "node", args: ["./check.mjs"] }
    next_state_id: "B"
```

**Error:**
```
Epsilon state '<state>' action 'fallback' uses { default: true } but is not the last action
(would make later actions unreachable)
```

Always put `{ default: true }` last.

### 4. Not making conditions idempotent

If a condition writes to `tape.json` (e.g., `save-plan.mjs` writing `PLAN_TEXT`), that write persists even if a subsequent epsilon chain fails and the engine rolls back the state transition. The rollback only restores `current_state_id` -- it does not revert tape changes (`@engine.ts:257-270`).

Design conditions so that re-running them after a rollback produces the same (or harmless) result.

### 5. Expecting environment variables

There are no special environment variables injected by the engine. The child process inherits the parent's `process.env` (`@engine.ts:65`), but there are no `SF_*` variables or similar. All flow-specific data comes through:
- The tape file path (argv)
- LLM-supplied positional arguments (argv)
- Config args from the YAML (argv)

If you need data from the environment, read `process.env` directly in your condition script, but do not rely on the engine setting any variables.

### 6. Self-loops

```yaml
actions:
  - action_id: "retry"
    next_state_id: "implement"  # same as current state_id!
```

**Error:** `"Action 'retry' in state 'implement' has self-loop (next_state_id = self)"`

If you need retry behavior, route through an intermediate epsilon state and back.

### 7. Declaring arguments on epsilon actions

Epsilon actions cannot have arguments because there is no LLM to supply them:

```
Epsilon state '<state>' action '<id>' must have no arguments
```

If your epsilon condition needs data, read it from the tape.

### 8. Exceeding the 30-second timeout

Long-running conditions (network calls, heavy computation) will be killed after 30 seconds. Design conditions to be fast checks against tape state or local files. If you need to wait for an external process, have the LLM do the waiting and save the result to the tape.

---

## 15. Writing Portable Conditions

### Use `node` or `python3`, not bash

Conditions are spawned without a shell, so bash scripts will not work unless you set `cmd: "bash"` and pass the script path as an arg. For portability (especially across macOS, Linux, and CI), prefer `node` or `python3`:

```yaml
condition:
  cmd: "node"
  args: ["./scripts/my-check.mjs"]
```

### Read tape via `process.argv[N]`, not env vars

The tape file path is passed as an argv element, not an environment variable. Place `${$TAPE_FILE}` in `args` where you want it; the engine substitutes it before spawning. In a Node.js script:

```javascript
// argv = [node, /abs/script.mjs, ...interpolated_args]
// process.argv[0] = node binary path
// process.argv[1] = script path
// process.argv[2..] = args after ${$TAPE_FILE} and ${arg-name} substitution
const args = process.argv.slice(2);
// Positions are exactly what you declared in YAML args[]; use named tokens to avoid positional arithmetic
```

Plan your argv parsing based on how many `config.args` your YAML declares.

### Always print `true` or `false` on the first line

This is the stdout contract (`@engine.ts:131-149`). If the first line is anything else (including empty), the condition is treated as a malformed failure:

```
condition kind=malformed: expected first stdout line to be 'true' or 'false', got '<unexpected>'.
```

**Do:**
```javascript
console.log("true");
console.log("check passed: value is 42");
```

**Don't:**
```javascript
console.log("Check passed!");  // "Check passed!" is not "true" or "false"
```

### Put the reason on subsequent lines (required on `false`)

When printing `false`, always include a reason on subsequent lines. This reason is shown to the LLM verbatim and helps it understand what to do next:

```javascript
console.log("false");
console.log("Set CODE_WRITTEN=1 on the tape via save-to-steering-flow.");
console.log("The implementation step is not yet complete.");
```

If you print `false` with no reason, the engine uses `"condition false (no reason provided)"` which is not helpful to the LLM.

### Exit code does not matter

The engine ignores the exit code entirely (`@engine.ts:130`). Only stdout determines the outcome. You can `process.exit(0)` or `process.exit(1)` or not exit at all (let the script end naturally) -- it makes no difference. However, for clarity and debugging, exiting 0 on success and 0 on expected failure is conventional.

### Keep conditions fast (<30s) and deterministic

- The timeout is 30 seconds (`@engine.ts:8`). Conditions that exceed this are killed.
- Epsilon chains try conditions sequentially. Slow conditions compound: a chain of 5 conditions each taking 6 seconds would take 30 seconds total and risk the last one being killed.
- Deterministic conditions (same tape state = same result) make flows easier to reason about and debug. Non-deterministic conditions (e.g., checking external APIs) may cause the LLM to see different results on retry, leading to confusion.

### Template: minimal Node.js condition

```javascript
#!/usr/bin/env node
import { readFileSync } from "node:fs";

// Parse argv based on your config.args count.
// Example: args: ["KEY_NAME", "${$TAPE_FILE}"]
//   argv = [node, script, "KEY_NAME", tape_path]
const [keyName, tapePath] = process.argv.slice(2);

const tape = JSON.parse(readFileSync(tapePath, "utf-8"));

if (tape[keyName]) {
    console.log("true");
    console.log(`${keyName} is set to: ${tape[keyName]}`);
} else {
    console.log("false");
    console.log(`Required tape key '${keyName}' is not set. Use save-to-steering-flow to set it.`);
}
```

### Template: minimal Python condition

```python
#!/usr/bin/env python3
import json, sys

# Same argv convention
key_name = sys.argv[1]
tape_path = sys.argv[2]

with open(tape_path) as f:
    tape = json.load(f)

if tape.get(key_name):
    print("true")
    print(f"{key_name} is set to: {tape[key_name]}")
else:
    print("false")
    print(f"Required tape key '{key_name}' is not set. Use save-to-steering-flow to set it.")
```

---

## Builtin conditions

Instead of writing a condition script from scratch, you can reference a builtin:

```yaml
condition:
  builtin: validate/non-empty-args
  args: [TASK_DESCRIPTION]
```

The parser expands `builtin:` into an ordinary `cmd`-based condition at load time.
Builtins are authoring-time helpers only; they lower to normal node-script conditions
before the engine sees them.

Available builtins: `validate/non-empty-args`, `self-check/basic`,
`submit/required-fields`, `soft-review/claude`, `soft-review/pi`. The
`soft-review/*` builtins are placeholder stubs and fail closed until you replace
their helper scripts with real reviewer implementations.

Full registry and argument contracts: [`docs/builtin-procedures.md`](builtin-procedures.md).

---

## Quick Reference: Flow Config Skeleton

```yaml
task_description: "Describe the overall task here."

states:
  - state_id: "$START"
    state_desc: "Initial state. Describe what the LLM should do first."
    is_epsilon: false
    actions:
      - action_id: "first_action"
        action_desc: "What this action does."
        arguments:
          - arg_name: "ARG1"
            arg_desc: "What this argument is for."
        condition:
          cmd: "node"
          args: ["./scripts/my-check.mjs"]
        next_state_id: "next_state"

  - state_id: "next_state"
    state_desc: "Description of this state."
    is_epsilon: false
    actions:
      - action_id: "finish"
        action_desc: "Complete the flow."
        condition:
          cmd: "node"
          args: ["./scripts/always-true.mjs"]
        next_state_id: "$END"

  - state_id: "$END"
    state_desc: "Completion message shown when the flow finishes."
    is_epsilon: false
    actions: []
```
