# HoareDesign — Reverse-Engineer Design Spec from Code

Given a codebase (or specific functions) WITHOUT an explicit design document, reverse-engineer a **descriptive design specification** by systematically examining **all usages** (call sites) of each target function. The output captures what the code IS doing — not what it SHOULD do.

## When to Use

- **No design document exists** for the target code — `/hoare-audit` cannot proceed without one.
- An existing design document may be **stale** and you need a fresh baseline.
- `/hoare-prompt` needs a spec to anchor its Requires/Ensures derivation.

## Core Principle

**The current code is the oracle. Derive Pre/Post from ALL usages, not from intuition.**

A function that doesn't check X is not "missing a check" — if every caller checks X, then "caller guarantees X" IS the Pre-condition.

## Procedure

### Phase 1 — Per-function: Extract spec from implementation

Read ONLY the implementation. Extract:

```
Function: <module>::<function_name>
Signature: <actual signature>

Internal guards (what the code validates / asserts / early-returns on):
  - <list each guard>

Return behavior:
  - Success: <what is returned / what state is mutated>
  - Error: <each error variant and when it fires>
  - Panic: <each expect!/unwrap! and what assumption it encodes>

Side effects: <I/O, spawns, state mutation, logging — or "none / pure">
```

**Do NOT write "missing checks" here.** Only describe what the code DOES.

### Phase 2 — Per-function: Examine ALL call sites to derive Pre/Post

For each function, **grep all call sites** and trace:

```
Call site: <caller_module>::<caller_function>, line N

What caller establishes before calling:
  - <validation / state setup the caller does before this call>

What caller uses from the return value:
  - <how the return value is consumed — what the caller NEEDS to be true about it>

Caller's error handling:
  - <does caller handle Err? propagate? ignore?>
```

**Aggregate across ALL call sites** to derive:

```
Pre-conditions (intersection of what ALL callers guarantee):
  - <only what EVERY caller establishes — the weakest common guarantee>

Post-conditions (union of what ANY caller relies on):
  - <everything any caller depends on from the return>

Caller contract (Pre-conditions enforced by callers, not by the function itself):
  - <derived from function's unwrap/expect that would panic if caller didn't ensure X>
  - <derived from absence of validation — if function doesn't check X but no caller breaks on X>
```

### Phase 3 — Module-level: Derive responsibility boundaries

```
Module: <module_name>

Responsibility: <what this module owns>
Invariants: <properties maintained across all public method calls>
Side-effect scope: <what I/O this module does / doesn't do>
Responsibility assignments: <who checks what — "caller guarantees X for callee Y">
Error philosophy: <fail-fast vs fail-soft vs fire-and-forget — derived from actual patterns>
```

### Phase 4 — Identify intentional omissions

Scan for patterns revealing **intentional design decisions**:

- Function could validate X but doesn't, AND all callers validate X → "caller's responsibility by design"
- `let _ =` or `.ok()` on a Result → intentional error suppression (fire-and-forget)
- Function returning `T` (infallible) despite sub-operations that could fail → caller guarantees success conditions
- Function with a simpler contract than it "could" have → intentional simplicity trade-off

Document as: "Does NOT do X — all callers do X instead → responsibility assigned to caller"

### Phase 5 — Categorize Intent (Decisional vs Non-Decisional)

This is the critical handoff to the Audit Loop. Intent derivation must prioritize autonomous progress.

- **Non-Decisional (Unanimous Intent)**: All call sites align perfectly (e.g., every caller validates the ID before passing it). Intent is unambiguous. **Auto-adopt** the derived spec as ground truth.
- **Decisional (Conflicting Intent)**: Callers contradict each other (e.g., caller A checks null, caller B passes unchecked), or the caller contract explicitly violates the implementation's implicit assumptions. This is a design conflict.
  - **Action**: Mark as Decisional. **Do not block the process.**
  - **Audit Behavior**: Fall back to the weakest common denominator for the current round, log as "Decisional Conflict," accumulate for human gate.

## Output Format

Write to `docs/design/hoare-derived-spec.md` (or a path specified by the caller):

1. **Module Overview** — one-paragraph summary per module
2. **Per-Function Specs** — Phase 1 + Phase 2 merged: implementation behavior + call-site-derived Pre/Post
3. **Responsibility Chains** — who guarantees what to whom (the call-site evidence)
4. **Module Contracts** — Phase 3 aggregate
5. **Intentional Omissions** — Phase 4 "NOT done by design" list
6. **Categorized Intent Log** — Non-Decisional specs adopted, Decisional conflicts deferred
7. **Unvalidated Assumptions** — Pre-conditions that NO caller establishes (⚠ markers) — candidates for real bugs

## Rules

- **Descriptive, not normative.** "Code does X" not "code should do X".
- **ALL call sites, not representative ones.** A Pre-condition derived from 3 of 5 callers is wrong — you need ALL 5.
- **Absence is data about responsibility, not about bugs.** A missing check means the responsibility is elsewhere until proven otherwise by examining all callers.
- **Current code is correct until proven otherwise.** The spec assumes the code is right. `/hoare-audit` is where you challenge that.
- **Quote code, don't paraphrase.** Cite exact lines for each Pre-condition source. Paraphrasing introduces semantic drift.
