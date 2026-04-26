# SKILL: Authoring steering-flow flows

Use this skill when asked to design, write, or review a `.yaml` flow for the
`steering-flow` plugin.

## Canonical references

- `docs/ARCHITECTURE.md` — overall runtime model
- `docs/configuration-tutorial.md` — full schema and invocation semantics
- `docs/builtin-procedures.md` — builtin expansion rules

## Core model (read first)

A flow is a finite-state machine. The engine drives transitions by evaluating
**conditions** — external processes whose stdout's first line must be `true` or
`false`. The engine sees only canonical condition objects:

```
{ cmd: string, args?: string[] }
```

Args support two placeholder tokens interpolated at spawn time:
- `${$TAPE_FILE}` — absolute path to `tape.json`
- `${arg-name}` — LLM-supplied value for action argument `arg-name`
- user-defined `arg_name` values may use `[A-Za-z0-9_-]+` but must not start with `$`

**Builtins** are parser-level shortcuts that expand to the canonical form before
the engine loads the flow. Authors write `builtin: <name>` instead of wiring up
a raw script path. Full builtin reference: `docs/builtin-procedures.md`.

Full schema and invocation semantics: `docs/configuration-tutorial.md`.

---

## Quick authoring checklist

1. **Identify states** — one per logical phase (`$START` and `$END` are mandatory).
2. **Identify branching points** — use epsilon states (`is_epsilon: true`) for
   zero-cost routers and automatic branch selection. Keep normal work in
   non-epsilon states.
3. **Choose conditions** — prefer builtins for common patterns; fall back to a
   custom `node` / `python` script only if no builtin fits.
4. **Add a submit gate** — use `submit/required-fields` on the last transition to
   `$END` to ensure all expected tape keys exist.
5. **Add quality gates** — use `self-check/basic` or `soft-review/pi` before
   high-stakes transitions. If you need automatic fallback routing, put the
   check in an epsilon router and make `{ default: true }` the last action.
6. **Validate non-empty user input** — if the flow depends on required action
   arguments, gate the first action with `validate/non-empty-args`.
   If you pass fixed `args:` literals, remember they are just config strings and
   will not validate user input by themselves.

---

## Builtin cheat sheet

| Builtin | When to use |
|---|---|
| `submit/required-fields` | Terminal gate before `$END` |
| `self-check/basic` | Agent verifies its own output |
| `validate/non-empty-args` | Guard against missing user input |
| `soft-review/pi` | Lightweight pi-agent review placeholder |
| `soft-review/claude` | Direct Claude review (outside pi) |

Usage syntax:

```yaml
condition:
  builtin: <name>
  args: [...]
```

---

## Patterns

### Submit + self-check pattern

```yaml
states:
  - state_id: work
    is_epsilon: false
    actions:
      - action_id: self_check
        action_desc: Produce OUTPUT_KEY, save it to tape, then pass a short assessment such as "done".
        arguments:
          - arg_name: assessment
            arg_desc: Short self-assessment text such as "done" or "approved"
        condition:
          builtin: self-check/basic
          args: ["OUTPUT_KEY is non-empty", "no placeholder text"]
        next_state_id: gate
      - action_id: revise
        action_desc: Fix the issues identified above, then retry self_check.
        condition:
          cmd: "node"
          args: ["./scripts/always-true.mjs", "revise"]
        next_state_id: work

  - state_id: gate
    is_epsilon: true
    actions:
      - action_id: pass
        action_desc: Required output exists.
        condition:
          builtin: submit/required-fields
          args: [OUTPUT_KEY]
        next_state_id: $END
      - action_id: fail
        action_desc: Required output is missing.
        condition:
          default: true
        next_state_id: work
```

### Soft-reviewer gate pattern

```yaml
  - state_id: review
    is_epsilon: false
    actions:
      - action_id: review
        action_desc: Run the soft reviewer.
        condition:
          builtin: soft-review/pi
          args: ["Verify OUTPUT_KEY meets acceptance criteria."]
        next_state_id: submit_gate
```

The shipped `soft-review/*` builtins are placeholder stubs that fail closed.
Use this pattern only after replacing the helper script with a real reviewer.
For automatic fallback routing, put the reviewer check in an epsilon router and
use `{ default: true }` as the last fallback action.

---

## What NOT to do

- **Do not skip `$START` / `$END`** — the engine requires both.
- **Do not put `default: true` outside epsilon routers** — it is valid only as
  the last action of an `is_epsilon: true` state. Ordinary work states need
  explicit actions and conditions.
- **Do not rely on engine magic for builtins** — builtins are expanded at parse
  time. If you write raw `cmd:` conditions, the engine evaluates them directly;
  if you write `builtin:`, the parser expands them before the engine runs.
- **Do not create unbounded loops** — the engine caps depth at 64 transitions and
  stagnation at 3 consecutive identical states. Design revision loops to make
  measurable progress each iteration (write to tape, not just retry).

---

## References

- `docs/builtin-procedures.md` — all builtins with expansion details
- `docs/configuration-tutorial.md` — full schema, epsilon states, tape, stop hook
- `docs/execution-behavior.md` — runtime transition model
- `examples/submit-self-check.yaml` — builtin-heavy worked example
- `examples/code-review.yaml` — raw-script worked example
