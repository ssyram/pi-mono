# Round 8 Audit — storage.ts & parser.ts

**Scope**: Persistence layer (`storage.ts`) and YAML parsing (`parser.ts`)  
**Date**: 2026-04-24  
**Auditor**: Sisyphus-Junior

---

## storage.ts

### R8-SP-001 — Implicit lock contract on read-modify-write operations

**Dimension**: Race conditions  
**Severity**: Medium

`pushFsm`, `popFsm`, and `writeState` (when `preserve_entered_at=true`) each perform a read-then-write sequence with no internal synchronisation. They are safe only because callers in `index.ts` wrap them in `withSessionLock`. Nothing inside `storage.ts` enforces or documents this requirement.

**Scenario**: A future caller (e.g. a new tool handler, a test helper) calls `pushFsm` directly without holding the session lock. Two concurrent calls race on `stack.json`: both read `["fsm-a"]`, both append their new ID, both write — one write is lost.

**Counterexample**:
```ts
// Both run concurrently, no withSessionLock wrapper
await pushFsm(sessionDir, "fsm-b");
await pushFsm(sessionDir, "fsm-c");
// stack.json ends up as ["fsm-a","fsm-c"] — fsm-b silently dropped
```

**Recommendation**: Add a JSDoc `@remarks Caller must hold the session lock via withSessionLock` on each affected function, or add a runtime assertion that a lock token is active.

---

### R8-SP-002 — `readPendingPop` has zero shape validation

**Dimension**: Data validation / Error handling  
**Severity**: Medium

`readPendingPop` reads `pending-pop.json`, parses it with `readJsonStrict`, and returns the result with a direct cast to `PendingPop`. No field presence or type checks are performed.

**Scenario**: A manually edited or partially-written `pending-pop.json` (e.g. `{}` or `{"fsm_id": 42}`) passes through silently. The first downstream consumer that dereferences `result.fsm_id` as a string gets `undefined` or `42`, producing a confusing runtime error far from the read site.

**Counterexample**:
```json
{ "fsm_id": null, "return_value": "ok" }
```
`readPendingPop` returns this without complaint; caller later does `fsmDir(sessionDir, pendingPop.fsm_id)` → `fsmDir(sessionDir, null)` → wrong path.

**Recommendation**: Add the same guard pattern used in `readState` — check that `fsm_id` is a non-empty string before returning.

---

### R8-SP-003 — `readState` does not validate `last_transition_chain`

**Dimension**: Data validation  
**Severity**: Low

`readState` validates `current_state_id` and `entered_at` but performs no check on `last_transition_chain`. The field could be absent, `null`, or contain elements of the wrong shape.

**Scenario**: A state file written by an older version of the plugin (before `last_transition_chain` was introduced) is read back. `last_transition_chain` is `undefined`. Code that iterates over it without a null-guard throws `TypeError: Cannot read properties of undefined (reading 'map')`.

**Recommendation**: Validate that `last_transition_chain` is either absent/`undefined` or an `Array`; coerce missing to `[]` at read time.

---

### R8-SP-004 — `readFsmStructure` validates container shape but not element shapes

**Dimension**: Data validation  
**Severity**: Low

`readFsmStructure` checks that `data.states` is a non-null object, but does not validate the shape of individual `State` entries within it. A corrupted or hand-edited `struct.json` with malformed state objects passes validation and is returned as a typed `FsmStructure`.

**Scenario**: A state entry is missing its `actions` array. The FSM runtime later iterates `state.actions` and throws `TypeError: Cannot read properties of undefined (reading 'forEach')`.

**Recommendation**: Iterate `Object.values(data.states)` and verify each entry has at minimum an `id` string and an `actions` array.

---

### R8-SP-005 — `newFsmId` has a negligible but non-zero collision window

**Dimension**: Correctness  
**Severity**: Info

`newFsmId` is `Date.now() + slug + randomBytes(4).toString("hex")`. Two concurrent `push` calls in the same millisecond for the same flow produce IDs that differ only in the 4-byte random suffix — collision probability ≈ 1/4 billion per pair. Not a practical concern, but worth noting for completeness.

**No action required** unless the system is expected to handle extremely high-frequency push bursts.

---

## parser.ts

### R8-SP-006 — Double-quoted strings: escape sequences not processed

**Dimension**: Parser correctness  
**Severity**: High

`parseScalar` handles double-quoted strings with `s.slice(1, -1)` — a raw substring with no escape processing. YAML 1.2 requires that double-quoted scalars interpret `\n`, `\t`, `\\`, `\"`, `\uXXXX`, etc.

**Counterexample**:
```yaml
description: "Line one\nLine two"
```
Parsed value: `"Line one\\nLine two"` (literal backslash-n), not a newline. Any flow config that uses `\n` in a double-quoted description or action argument silently gets the wrong value with no error.

**Recommendation**: Implement a minimal escape-sequence pass over double-quoted string content, covering at least `\\`, `\"`, `\n`, `\t`, `\r`, `\uXXXX`.

---

### R8-SP-007 — Single-quoted strings: `''` escape not handled

**Dimension**: Parser correctness  
**Severity**: Medium

YAML single-quoted scalars represent a literal single-quote as `''` (two consecutive single-quotes). `parseScalar` returns the raw content between the outer quotes without replacing `''` → `'`.

**Counterexample**:
```yaml
label: 'it''s done'
```
Parsed value: `"it''s done"` instead of `"it's done"`.

**Recommendation**: After slicing the outer quotes, apply `.replace(/''/g, "'")` to the content.

---

### R8-SP-008 — Block scalar chomp indicator silently discarded

**Dimension**: Parser correctness  
**Severity**: Medium

`parseKeyValue` detects `|-`, `|+`, `>-`, `>+` but normalises them to `"|"` or `">"` before passing to `readBlockScalar`. The chomp indicator (`-` = strip trailing newlines, `+` = keep all) is lost. `readBlockScalar` always appends a single `\n` (clip behaviour), so `|-` and `|+` both behave identically to `|`.

**Counterexample**:
```yaml
prompt: |-
  Do something
  without trailing newline
```
Expected: `"Do something\nwithout trailing newline"` (no trailing `\n`).  
Actual: `"Do something\nwithout trailing newline\n"` (trailing `\n` appended).

This matters when the value is used verbatim in a shell command or string comparison.

**Recommendation**: Pass the full indicator string (`"|-"`, `"|+"`, `">-"`, `">+"`) through to `readBlockScalar` and implement strip/keep logic there.

---

### R8-SP-009 — Inline array objects: key with no inline value silently dropped

**Dimension**: Parser correctness  
**Severity**: Medium

In `parseYamlArray`, when a list item begins with `- key:` (key present, value on next line or absent), `parseKeyValue` returns `val: undefined`. The guard `if (val !== undefined)` skips the key entirely — no fallback attempts to parse a nested block value.

**Counterexample**:
```yaml
actions:
  - id: step1
    cmd: echo
```
If the array parser encounters `- id: step1` as an inline object and `cmd:` on the next line as a continuation, `cmd` is dropped. The resulting action object is `{ id: "step1" }` — missing `cmd`, which causes a runtime error when the action is executed.

**Note**: Whether this triggers depends on indentation and how the parser dispatches between inline-object and block-object parsing. The risk is highest for compact list items where the first key has a value but subsequent keys are on separate lines within the same item.

**Recommendation**: When `val === undefined` in the inline-object branch, either fall back to block-object parsing for that item or throw a parse error rather than silently dropping the key.

---

### R8-SP-010 — Markdown front matter: files with no trailing newline after closing `---` fail to parse

**Dimension**: Parser correctness  
**Severity**: Low

The front matter regex is:
```ts
/^---\n([\s\S]*?)\n---\n([\s\S]*)$/
```
The `\n` after the closing `---` is required. A `.md` file that ends exactly at `---` with no trailing newline will not match.

**Counterexample**:
```
---
states: ...
---
```
(no trailing newline after closing `---`) → regex fails → `parseMdFlow` returns `null` → caller receives no FSM config, with no error message explaining why.

**Recommendation**: Change the closing delimiter to `\n---\s*$` to tolerate missing trailing newlines.

---

### R8-SP-011 — `validateFlowConfig` does not reject unknown top-level keys

**Dimension**: Data validation  
**Severity**: Low

`validateFlowConfig` checks for required keys but does not enumerate and reject unrecognised ones. A typo in a top-level key is silently ignored; the required key is then reported as missing, with no hint about the typo.

**Counterexample**:
```yaml
flow_name: my-flow
sates:          # typo for "states"
  - id: $START
```
Error produced: `"Missing required key: states"` — no mention that `sates` was found.

**Recommendation**: After checking required keys, warn or error on any key not in the known set `{flow_name, description, states, epsilon_transitions}`.

---

### R8-SP-012 — Recursive epsilon DFS: deep chains risk stack overflow

**Dimension**: Robustness  
**Severity**: Low

`buildFSM` resolves epsilon transitions with a recursive DFS. Cycle detection prevents infinite loops, but a legitimate epsilon chain of depth ~10 000 would overflow the JS call stack.

**Scenario**: A pathological (or adversarially crafted) flow file with thousands of chained epsilon states causes `RangeError: Maximum call stack size exceeded` during `loadFlow`, crashing the plugin process.

**Recommendation**: Convert the epsilon DFS to an iterative worklist algorithm, or add a depth counter and throw a descriptive `FlowParseError` if depth exceeds `MAX_YAML_DEPTH` (already defined as 64 — reusing this limit would also cap the chain length at parse time).

---

## Summary

| ID | File | Dimension | Severity |
|---|---|---|---|
| R8-SP-001 | storage.ts | Race conditions | Medium |
| R8-SP-002 | storage.ts | Data validation | Medium |
| R8-SP-003 | storage.ts | Data validation | Low |
| R8-SP-004 | storage.ts | Data validation | Low |
| R8-SP-005 | storage.ts | Correctness | Info |
| R8-SP-006 | parser.ts | Parser correctness | **High** |
| R8-SP-007 | parser.ts | Parser correctness | Medium |
| R8-SP-008 | parser.ts | Parser correctness | Medium |
| R8-SP-009 | parser.ts | Parser correctness | Medium |
| R8-SP-010 | parser.ts | Parser correctness | Low |
| R8-SP-011 | parser.ts | Data validation | Low |
| R8-SP-012 | parser.ts | Robustness | Low |

**No atomicity bugs found** — `atomicWriteJson` correctly uses rename-based replacement with tmp-file cleanup on error.  
**No path-handling bugs found** — all paths use `node:path` resolve/join; no platform-specific issues observed.
