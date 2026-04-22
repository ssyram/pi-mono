# Hoare-Style Audit — steering-flow (2026-04-21)

Baseline: `docs/correctness-audit.md` (15 rounds, converged to 0 issues after round 13).
This report audits the **current state** of the codebase and documentation against the
parser/runtime invariants declared in that prior audit. It is additive — only new findings
are listed.

---

## Validated Invariants

These contracts hold end-to-end across parser → registry → engine and carry no open issues.

| # | Invariant | Evidence |
|---|-----------|----------|
| I-1 | Every builtin expansion lowers to canonical `{ cmd, args?, needs_tape? }` and re-enters `validateCondition`. | `builtin-registry.ts:expandBuiltinCondition` → `parser.ts:validateCondition` recursive call at line 197. |
| I-2 | `needs_tape` default-true semantics: engine uses `needs_tape !== false`, so `undefined` → tape IS injected. | `engine.ts:runCondition` (needsTape check). Matches `types.ts` comment and README. |
| I-3 | Epsilon rules fully enforced: `default:true` only as last action, no args in epsilon actions, non-epsilon cannot use `default:true`. | `parser.ts:validateCondition` checks `isLast`, `isEpsilon` flags. |
| I-4 | FSM structural rules enforced in two phases: parse-time (id uniqueness, IDENT_RE, reserved JS names, no self-loops) then `buildFSM` (forward BFS reachability + reverse BFS dead-end detection). | `parser.ts:buildFSM` lines 281–360. |
| I-5 | Tape limits (64 KiB/value, 1024 keys) are enforced in `index.ts:saveCall` before any disk write. | `index.ts` constants + saveCall. `storage.ts` intentionally has no enforcement. |
| I-6 | `sweepTmpFiles` is called on `session_start` — orphan `.tmp.*` files are cleaned. | `index.ts` session_start handler; confirmed by README claim. |
| I-7 | `soft-review/*` stubs are explicitly documented as non-production in README, builtin-procedures.md, SKILL.md, and the `.mjs` source files. | All four locations carry consistent warnings. |
| I-8 | `submit/required-fields` argv contract: tape path is last arg, field names precede it. | `builtins/submit-required-fields.mjs:12-20` matches `builtin-registry.ts` expansion (needs_tape:true → tape injected after configArgs). |
| I-9 | Condition path-like rule: paths containing `/` or `\` must start with `./`, `../`, or be absolute. | `parser.ts:validateCondition` lines 220–235. |
| I-10 | `$START`/`$END` sentinels: `$END` must have no actions and cannot be epsilon; `$START` is valid non-epsilon or epsilon. | `parser.ts:buildFSM` sentinel checks. |

---

## Open Issues

### Issue 1 — Block scalar chomp variants silently ignored (MEDIUM)

**File:** `parser.ts:515-516, 537`

**Pre-condition:** User writes `|-` or `>-` in YAML expecting strip-trailing-newline behavior.

**Actual behavior:**
```typescript
if (rest === "|" || rest === "|-" || rest === "|+") return { key, val: undefined, blockScalar: "|" };
if (rest === ">" || rest === ">-" || rest === ">+") return { key, val: undefined, blockScalar: ">" };
```
All three variants collapse to `"|"` (or `">"`). `readBlockScalar` always appends `"\n"`:
```typescript
return { value: collected.join("\n") + "\n", nextLine: i };
```

**Post-condition violation:** `|-` is documented (YAML 1.2) to strip the trailing newline. The parser
treats it identically to `|`, so `action_desc: |-\n  text\n` yields `"text\n"` instead of `"text"`.

**Impact:** Silent semantic drift — no parse error, wrong string value. Could corrupt condition
`args` strings that rely on strip behavior (e.g., multi-line prompts passed to soft-review scripts).

**Severity:** MEDIUM — no crash, but string values deviate from author intent without warning.

**Fix:** Either implement strip/keep/clip chomp in `readBlockScalar`, or emit a parse warning
(or hard error) when `|-`/`|+`/`>-`/`>+` are encountered, directing authors to use `|`/`>`.

---

### Issue 2 — `validate/non-empty-args` tape-path heuristic is fragile (LOW-MEDIUM)

**File:** `builtins/validate-non-empty-args.mjs:23-26`

**Pre-condition:** `validate/non-empty-args` declares `needs_tape: false`; engine does NOT inject a
tape path. The script nonetheless attempts to detect and strip an absolute-path tape argument:

```javascript
const tapeIndex = rawArgs.findIndex(a => a.startsWith("/"));
const dataArgs = tapeIndex === -1
  ? rawArgs
  : rawArgs.filter((_, i) => i !== tapeIndex);
```

**Contract violation (two directions):**

1. *False positive strip:* A legitimate `config.arg` that is an absolute path (e.g., a config file
   `/etc/foo.conf`) is silently removed from validation, making the check a no-op for that slot.
2. *Dead code path:* Since the engine never injects a tape path when `needs_tape: false`, the
   `tapeIndex !== -1` branch can only fire if the user passes an absolute-path literal in YAML
   `args`. The comment implies it guards against an engine bug that no longer exists (or never existed
   for this builtin).

**Severity:** LOW-MEDIUM — the defensive code masks potential usage errors. A user with an absolute
arg silently loses validation coverage.

**Fix:** Remove the tape-detection heuristic. Because `needs_tape: false` is a compile-time
invariant for this builtin, the heuristic is dead code in the normal contract. If callers pass
raw absolute paths as config args, that is a usage error and should fail loudly.

---

### Issue 3 — `examples/submit-self-check.yaml` — `soft_review` state is permanently stuck (MEDIUM)

**File:** `examples/submit-self-check.yaml:60-72`

**State graph:**
```
soft_review (is_epsilon: false)
  └── action: review
        condition: builtin soft-review/pi  → always returns false (stub)
        next_state_id: submit_gate         ← only reachable if condition passes
```

**Invariant violated:** A non-epsilon state with a single action whose condition never passes has no
exit path. The engine's `executeAction` returns `ok: false`; the LLM is shown a failure reason but
there is no alternative action to call, and no loop-back action to revise-and-retry within this
state.

**Cascading effect:** `REVIEW_OK` tape key (required by `submit_gate`) can never be written, since
the action_desc instructs "set REVIEW_OK if approved" but approval never occurs. The `submit/required-fields`
gate at `submit_gate` will therefore always return false on that key as well.

**Severity:** MEDIUM — the example flow is unusable as written whenever the soft-review stub is
active (i.e., always in the default distribution).

**Fix:** Either (a) add a `revise_after_review` fallback action that loops back to `self_check`
or a dedicated revise state, or (b) restructure `soft_review` as an epsilon router that uses
`default: true` as the last action (per the SKILL.md prose recommendation).

---

### Issue 4 — `examples/submit-self-check.yaml` — `validate/non-empty-args` gate is vacuous (MEDIUM)

**File:** `examples/submit-self-check.yaml:27-30`

```yaml
condition:
  builtin: validate/non-empty-args
  args: [TASK_DESCRIPTION]
```

**What happens at runtime:**
- `TASK_DESCRIPTION` is a YAML string literal (not a tape reference). The builtin receives
  `process.argv = [node, script, "TASK_DESCRIPTION"]`.
- `rawArgs = ["TASK_DESCRIPTION"]` — the literal 12-character string, always non-empty → always
  returns `true`.
- The `draft` action also has no `arguments:` field, so the LLM supplies zero positional args.
  There is no LLM-provided value being validated at all.

**Intent vs. behavior:** The author likely intended to guard that the user-supplied task description
is non-empty. The actual guard is a no-op constant-true condition.

**Severity:** MEDIUM — example teaches incorrect usage of `validate/non-empty-args`. Readers who
copy this pattern will write flows with silent vacuous guards.

**Fix:** Either (a) add `arguments: [{arg_name: TASK_DESCRIPTION, arg_desc: ...}]` to the `draft`
action (so the LLM supplies the value as a positional arg) and keep `args: []` on the builtin, or
(b) use `submit/required-fields` on the tape after the user has saved the task description.

---

### Issue 5 — `docs/builtin-procedures.md` overstates `self-check/basic` rubric enforcement (LOW)

**File:** `docs/builtin-procedures.md` (self-check/basic description section)

**Claim:** "asks the current agent to verify its own last output against a short rubric"

**Actual behavior (`builtins/self-check-basic.mjs:~35-50`):**
- Rubric strings are passed as `config.args` and echoed in the output reason line.
- They are **never evaluated** against the assessment text.
- Pass/fail is decided solely by keyword matching on the LLM-supplied assessment argument
  (`done`, `complete`, `pass`, `approved`, `ok`, `yes`, `true`, `satisfied`).
- A response of "approved" passes regardless of whether any rubric criterion is met.
- The script comment itself says "For a real self-check … replace the body."

**Severity:** LOW — stubs are flagged; doc inaccuracy is about degree of enforcement, not
wrong-direction behavior. Still misleads authors about what safety guarantee the builtin provides.

**Fix:** Reword to: "passes a keyword-matched self-assessment through a keyword gate; rubric strings
are displayed as context in the reason line but are not evaluated. Replace with an LLM-backed
implementation for production use."

---

### Issue 6 — `SKILL.md` soft-reviewer pattern shows stuck state contradicting its own prose (LOW)

**File:** `skills/steering-flow-author/SKILL.md:109-121`

**Code snippet:**
```yaml
- state_id: review
  is_epsilon: false
  actions:
    - action_id: review
      condition:
        builtin: soft-review/pi
        args: ["Verify OUTPUT_KEY meets acceptance criteria."]
      next_state_id: submit_gate
```

**Prose (line 118):** "For automatic pass/fail routing, put `soft-review/pi` in an epsilon router
and use `{ default: true }` as the last fallback action."

**Contradiction:** The code snippet shows a non-epsilon state with a single action. If the stub
returns false (always), there is no exit. The prose gives the right advice; the code example
contradicts it — same structural bug as Issue 3.

**Severity:** LOW — the stub warning is present; a careful reader will notice. Still a trap for
copy-paste.

**Fix:** Update the code snippet to either wrap `soft-review/pi` in an epsilon router with
`default: true` fallback, or show the revise-loop pattern.

---

### Issue 7 — `engine.ts` failure hint omits `needs_tape` caveat (LOW)

**File:** `engine.ts` (`renderTransitionResult` function)

**Hint text (paraphrased):** "condition process receives tape.json's path as its first argument
after the config args"

**Actual contract:** Tape path is only injected when `needs_tape !== false`. For conditions with
`needs_tape: false` (including `validate/non-empty-args`, `self-check/basic`), no tape path is
passed and `process.argv[2 + config.args.length]` is an LLM arg, not a tape path.

**Impact:** Authors debugging a failing condition with `needs_tape: false` will miscalculate argv
offsets.

**Severity:** LOW — hint is supplementary text, not a spec. The README and tutorial both document
the caveat correctly.

**Fix:** Append: "(only when `needs_tape !== false`; omitted for conditions that set `needs_tape: false`)"

---

### Issue 8 — `storage.ts` `flow_dir ?? ""` creates silent regression for migrated sessions (LOW)

**File:** `storage.ts` (`loadRuntime` function)

```typescript
flow_dir: struct.flow_dir ?? ""
```

**Pre-condition:** An on-disk session written before `flow_dir` was introduced has no `flow_dir`
field.

**Post-condition violation:** `resolveTokenRelToFlow(token, "")` in `engine.ts` resolves
`./`-prefixed condition paths against CWD instead of the flow's directory. The condition script
will not be found if the user is not in the original flow directory at execution time.

**Severity:** LOW — only affects sessions created before the field was added; silent failure
(process-not-found error, not a parse error).

**Fix:** Document the migration note in CHANGELOG. Consider writing `flow_dir` to disk during any
`persistRuntime` call so old sessions self-heal on next run.

---

## Helper-Script Contract Summary

| Script | needs_tape | Tape arg position | Verified |
|--------|-----------|-------------------|---------|
| `submit-required-fields.mjs` | `true` | `argv.slice(2)` last element | ✅ matches engine argv order |
| `self-check-basic.mjs` | `false` | not received | ✅ engine omits tape |
| `validate-non-empty-args.mjs` | `false` | not received (heuristic present — Issue 2) | ⚠️ |
| `soft-review-pi.mjs` | `true` | `process.argv[3]` (index 1 of slice(2)) | ✅ when args contains prompt |
| `soft-review-claude.mjs` | `true` | same | ✅ when args contains prompt |

All five builtin scripts adhere to the stdout protocol (first line `true`/`false`, remaining lines
are the reason). No script exits with a non-zero code on condition-false (correct per engine
`ok:false` handling in `runCondition`).

---

## Summary Table

| # | Severity | File | Finding |
|---|----------|------|---------|
| 1 | MEDIUM | `parser.ts:515-516,537` | `|-` / `>-` chomp silently ignored; always appends `\n` |
| 2 | LOW-MEDIUM | `builtins/validate-non-empty-args.mjs:23-26` | Tape-path heuristic is fragile dead code under correct `needs_tape:false` contract |
| 3 | MEDIUM | `examples/submit-self-check.yaml:60-72` | `soft_review` state permanently stuck; REVIEW_OK can never be written |
| 4 | MEDIUM | `examples/submit-self-check.yaml:27-30` | `validate/non-empty-args` receives a literal string constant — vacuous always-true gate |
| 5 | LOW | `docs/builtin-procedures.md` | `self-check/basic` rubric claim overstated; rubric strings are decorative not enforced |
| 6 | LOW | `skills/steering-flow-author/SKILL.md:109-116` | Soft-reviewer code snippet shows stuck non-epsilon state, contradicting same-file prose |
| 7 | LOW | `engine.ts` (renderTransitionResult) | Failure hint unconditionally claims tape path is injected; missing `needs_tape !== false` caveat |
| 8 | LOW | `storage.ts` (loadRuntime) | `flow_dir ?? ""` fallback causes relative paths to resolve against CWD on migrated sessions |

**Actionable priority:**
1. Fix Issues 3 and 4 (example is unusable / teaches wrong usage pattern).
2. Fix Issue 1 (silent parser semantic bug; no warning issued).
3. Fix Issues 5 and 6 (doc/skill accuracy).
4. Issues 2, 7, 8 are low-risk cleanup.

## Fix loop update

Applied after this audit report was generated:

- Issue 3: fixed `examples/submit-self-check.yaml` so the shipped fail-closed soft-review stub is not the only transition out of `soft_review`; the example now uses an explicit manual-review placeholder action and documents the stub caveat.
- Issue 4: fixed `examples/submit-self-check.yaml` so `validate/non-empty-args` validates a declared action argument instead of the literal config string `TASK_DESCRIPTION`.
- Issue 5: updated `docs/builtin-procedures.md` so `self-check/basic` is described as lightweight marker-based self-assessment, not semantic rubric enforcement.
- Issue 6: updated `skills/steering-flow-author/SKILL.md` so the soft-review pattern calls out fail-closed placeholder behavior and avoids implying automatic fallback without an epsilon router.
- Related cleanup: aligned `validate/non-empty-args` docs, registry, README, and tutorial around `needs_tape: false`; added `submit/required-fields` to the tutorial builtin list; updated parser condition-shape error text to mention `{ builtin, args? }`.

Still open and intentionally deferred:

- Issue 1: YAML block-scalar chomp modifiers remain unsupported.
- Issue 2: `validate-non-empty-args.mjs` still tolerates and strips a first absolute-path tape arg for robustness; this can skip absolute-path data values.
- Issue 7: `engine.ts` failure hint still omits the `needs_tape !== false` caveat.
- Issue 8: migrated-session `flow_dir ?? ""` fallback remains unchanged.

Validation:

- `npm run check` from `my-plugins/steering-flow/` failed because that package has no local `check` script.
- `npm run check` from the repo root failed on unrelated pre-existing errors outside `my-plugins/steering-flow`:
  - `my-plugins/finegrained-agent/src/phase-runner.ts` tool array type mismatch
  - multiple `my-plugins/oh-my-pi*` imports of missing `@mariozechner/pi-coding-agent` exports
  - `packages/ai/src/providers/anthropic.ts` invalid `display` properties
  - `packages/ai/src/providers/mistral.ts` missing module / implicit anys
  - `packages/coding-agent/src/core/session-manager.ts` missing `uuid` types

## Second fix loop update

Additional fixes after the first update:

- Updated `docs/configuration-tutorial.md` validation table so the condition-object error text includes `{ builtin, args? }`.
- Re-ran helper smoke checks directly with `node`:
  - `validate-non-empty-args.mjs` passes non-empty args and fails whitespace args.
  - `self-check-basic.mjs` passes `done` and fails `not yet`.
  - `submit-required-fields.mjs` fails safely when the tape file is missing.
- Re-ran repo-root `npm run check`; it still fails only on the unrelated pre-existing errors listed in the previous validation note.
