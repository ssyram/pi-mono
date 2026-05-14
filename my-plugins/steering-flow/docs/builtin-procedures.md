# Builtin Procedures

Builtins are **authoring-time shortcuts** compiled by the parser into ordinary
`{ cmd, args? }` condition objects. The engine never sees the builtin
name — it only receives the expanded canonical form. This means builtins add zero
runtime overhead and require no engine changes to support.

## Canonical references

- `docs/ARCHITECTURE.md` — system model and document map
- `docs/configuration-tutorial.md` — full schema and invocation semantics
- `docs/execution-behavior.md` — load/parse/storage runtime behavior

## How expansion works

In your YAML you write:

```yaml
condition:
  builtin: submit/required-fields
  args: [CODE_WRITTEN, TESTS_PASSED, "${$TAPE_FILE}"]
```

The parser rewrites this before the engine loads the flow:

```yaml
condition:
  cmd: node
  args: [<plugin-dir>/builtins/submit-required-fields.mjs, CODE_WRITTEN, TESTS_PASSED, "${$TAPE_FILE}"]
```

Builtins do not receive the tape path implicitly. Always pass `${$TAPE_FILE}` as
the last element of `args` for any builtin that reads the tape.

Every builtin listed below follows the same stdout contract as hand-written
conditions: first line `true` or `false`, optional remaining lines as human-readable
reason.

---

## Builtin reference

### `submit/required-fields`

Checks that every listed tape key is present and non-empty. Use this as the gate
condition on a terminal action that moves the flow to `$END`.

```yaml
condition:
  builtin: submit/required-fields
  args: [PLAN_TEXT, CODE_WRITTEN, TESTS_PASSED, "${$TAPE_FILE}"]
```

Expands to a node script that reads the tape JSON and fails if any key is absent or
has a falsy value. `${$TAPE_FILE}` must be the last argument — the script reads it
as the tape path.

**Requires tape**: yes; pass `${$TAPE_FILE}` explicitly as the final arg.

---

### `self-check/basic`

Expands at parse time into a `cmd`-based condition that asks the **current agent**
to verify its own last output against a short rubric. The rubric items are passed as
`args`. Returns `true` if the agent's self-assessment passes every rubric item.

```yaml
condition:
  builtin: self-check/basic
  args: ["output is non-empty", "no placeholder text remains"]
```

Use this as a lightweight quality gate inside a state before advancing.

**Requires tape**: no (does not read tape; the LLM response is the verification target). The LLM must pass a short assessment as the action's positional argument.

---

### `validate/non-empty-args`

Fails immediately if any fixed `args` value or any LLM-supplied positional arg is
empty or whitespace-only. Use as a sanity check on actions that expect required
user-supplied context.

```yaml
condition:
  builtin: validate/non-empty-args
  args: [TASK_DESCRIPTION]
```

**Requires tape**: no.

---

### `soft-review/claude`

Expands to a Claude-oriented helper script that receives the review prompt in
`args`. If you want the helper to read tape state, pass `${$TAPE_FILE}`
explicitly in your builtin `args`.

```yaml
condition:
  builtin: soft-review/claude
  args: ["Check that the plan is complete and has no obvious gaps."]
```

The shipped helper is a conservative placeholder stub: it returns `false` with a
reason until you replace it with a real Claude-backed reviewer.

**Tape access**: optional — include `${$TAPE_FILE}` in builtin `args` only when
your reviewer helper needs it.

---

### `soft-review/pi`

Same shape as `soft-review/claude`, but intended for a pi-backed reviewer helper.
If you want the helper to read tape state, pass `${$TAPE_FILE}` explicitly in
builtin `args`.

```yaml
condition:
  builtin: soft-review/pi
  args: ["Verify the implementation matches the plan stored in PLAN_TEXT."]
```

The shipped helper is also a conservative placeholder stub. Replace it with a
real pi-backed reviewer before relying on it in production.

**Tape access**: optional — include `${$TAPE_FILE}` in builtin `args` only when
your reviewer helper needs it.

---

## Using builtins with epsilon routers

A common pattern is to place a builtin condition inside an **epsilon state** (a
zero-cost router) so that multiple downstream branches share a single check:

```yaml
states:
  - state_id: quality_gate
    is_epsilon: true
    actions:
      - action_id: gate_pass
        condition:
          builtin: submit/required-fields
          args: [PLAN_TEXT, CODE_WRITTEN, "${$TAPE_FILE}"]
        next_state_id: $END
      - action_id: gate_fail
        condition:
          default: true
        next_state_id: revise
```

See `configuration-tutorial.md` for the full epsilon-state semantics.
