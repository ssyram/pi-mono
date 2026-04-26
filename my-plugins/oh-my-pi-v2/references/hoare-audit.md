# HoarePrompt Audit Loop — Iterative Correctness Verification

Run a continuous correctness audit using the HoarePrompt methodology (see `/hoare-prompt` for method reference). The loop automatically isolates root causes, auto-fixes non-decisional findings, and accumulates decisional architectural trade-offs for a human gate.

## Target

$ARGUMENTS

If no target specified, audit the current working directory.

## Step 0 — Design Specification Gate (MANDATORY)

**No audit without a spec. Period.** An audit without a spec generates confident-sounding findings that may contradict intentional design decisions.

**Do NOT start Step 1 until Step 0 is complete.**

### 0a. Check for explicit design documents

Search for design docs: `docs/design/`, `DESIGN.md`, `docs/architecture.md`, `docs/detailed-design.md`, or similar. Also check `CLAUDE.md` for design-relevant sections (known limitations, design decisions, invariants).

### 0b. If design docs exist → extract contracts as ground truth

For each target function, extract:
- **Signature** (infallible vs fallible — if design says `-> Self`, code returning `Result` is a violation)
- **Listed errors** (only these, not more — additions are deviations)
- **"Caller guarantees"** / Pre-condition assignments (who is responsible for what)
- **"Intentionally NOT done"** decisions and their rationale (NOT bugs — trade-offs)
- **Availability/correctness trade-offs** ("fire-and-forget", "best-effort", "defensive only")

These are the **ground truth**. Code that matches the design is CORRECT, even if the auditor's intuition says "missing something".

### 0c. If NO design docs exist → run `/hoare-design` first

**Do NOT proceed to Step 1.** Instead:
1. Inform the user: "No design document found for [target]. Running `/hoare-design` to derive a descriptive spec."
2. Run `/hoare-design`. Apply Phase 5 categorization:
   - **Non-Decisional specs** (unanimous caller behavior): Auto-adopt immediately.
   - **Decisional conflicts** (caller contradictions): Mark for human review. Do not block. Assume weakest contract for this round.
3. Present the derived spec to the user for review before proceeding.

### 0d. Record the spec source

At the top of each round's output, state:
```
Spec source: docs/design/detailed-design.md (explicit design document)
— or —
Spec source: /hoare-design output (reverse-engineered from ALL call sites)
— or —
Spec source: user-provided verbal description
```

**Never proceed with "Spec source: NONE".** If no spec can be obtained, stop.

## Procedure

### Round N (repeat until both queues empty):

**Step 1 — Deployment context declaration + pick audit dimensions.**

**1a. Declare deployment context.** Write a deployment profile that calibrates what "realistic threat" means:

```
Deployment context:
  - Execution model: <CLI tool / long-running server / library / plugin / ...>
  - Trust boundary: <who provides input — user, LLM, network, internal module>
  - Persistence model: <ephemeral / in-memory / disk-backed / database>
  - Concurrency model: <single-threaded / async-single / multi-threaded / multi-process>
  - Threat model: <local-user-only / multi-tenant / internet-facing / ...>
```

This profile scopes ALL subsequent analysis.

**1b. Pick audit dimensions.** Pick 3–6 dimensions that matter for THIS target. Do NOT default to a fixed list — different projects need different angles.

Candidate angles to *consider* (non-exhaustive — pick, extend, or invent as appropriate):

- **Crash safety / null-safety** — null derefs, uncaught throws, shape mismatches at dynamic boundaries
- **Functional correctness** — contracts, invariants, branch exhaustiveness, loop termination (NSP-style)
- **External-API contracts** — assumptions about framework/library behavior, verified against source
- **Resource lifecycle** — timers, handles, subscriptions, file descriptors, release on all paths
- **Concurrency / persistence integrity** — races, partial-write recovery, atomicity, fsync ordering
- **Security / input validation** — injection, path traversal, SSRF, untrusted data reaching sensitive sinks
- **Error propagation & observability** — silent failures, swallowed errors, misleading return values
- **Protocol / state-machine correctness** — unreachable states, deadlocks, invariant violations across transitions
- **Performance / DoS** — unbounded loops/allocation, pathological inputs, quadratic behavior
- **Backward/forward compatibility** — schema migrations, on-disk formats, wire protocols
- **Privacy / data handling** — PII flow, retention, redaction in logs/telemetry
- **Determinism & reproducibility** — time, randomness, iteration order, floating point
- **Portability** — platform assumptions (paths, shells, line endings, encoding)
- **Idempotency** — retry safety, exactly-once vs at-least-once semantics
- **Permission / authorization** — privilege escalation, tool-exposure boundaries
- **Upgrade / rollback** — state survives restart, versioned artifacts, migration reversibility
- **Numerical / boundary correctness** — off-by-one, overflow, underflow, integer vs float
- **Concurrency beyond races** — starvation, priority inversion, deadlock cycles
- **Connection / session lifecycle** — connect/disconnect timing, disconnect side-effects, PID/session mapping lifetime assumptions, reconnection strategy
- **Testability / observability** — can we tell when it breaks in prod?

State your chosen dimensions and *why each is relevant* before proceeding.

**Step 2 — Launch one agent per dimension in parallel.** Each reads source code from scratch. No agent sees another's findings. Each writes to `docs/audit/RoundN/audit-<dimension>.md`. Agents MUST consult framework/library source as their source of truth, not docs or assumptions.

**Step 3 — Compile findings.** Read all reports. Apply:

**3a. Hoare finding vs code review nit.** A Hoare finding must have:
- A specific Pre/Post/Invariant that is violated, AND
- A concrete counterexample (input, state, or execution path) that triggers the violation

Observations lacking both are **code review nits** — log separately in `docs/audit/RoundN/nits.md` if desired.

Exception: dead code / stale comments / unused params remain valid findings (maintainability signal-to-noise).

**3b. Runtime impact trace.** For each candidate, trace whether the issue is **observable at runtime** given the deployment context:
- Does the violating input actually reach the affected code path?
- Is the path reachable from actual entry points, or only from dead callers?
- If reachable only under a non-matching threat model → downgrade to **hardening suggestion**.

**3c. Classify surviving issues:**
- VULNERABLE / DISPROVEN / REFUTED / LEAK → **candidate** for fix (must pass Step 4)
- GUARDED / PARTIAL / UNVERIFIABLE → evaluate case-by-case
- SAFE / PROVEN / CONFIRMED / NONE → no action

**Step 4 — Independent confirmation.** Every candidate must be independently confirmed by a fresh agent that did not produce it. Fresh eyes only — do NOT give the agent the original report.

Give each confirmation agent:
- The specific claim (file, function, description, proposed severity) and relevant source files.
- The deployment context from Step 1.

Require one of these verdicts in `docs/audit/RoundN/confirm-<finding-id>.md`:
- **CONFIRMED — triggering**: concrete input/scenario/path that demonstrates the bug fires at runtime within the deployment context.
- **CONFIRMED — solid rationale**: issue is real but not directly triggerable (defense-in-depth gap, API contract drift, stale comment, dead code). State rationale in maintainer-evaluable terms.
- **REJECTED — deployment context mismatch**: claim assumes a threat model that doesn't match.
- **REJECTED — not reachable**: claim assumes a state that invariant Y prevents; cite invariant.
- **REJECTED — misreading**: reviewer misread the code; explain what it actually does.
- **REJECTED — lesson precondition unmet**: finding cites a lesson whose preconditions don't hold here.
- **INCONCLUSIVE**: cannot decide; state what would be needed.

Batch up to 6 confirmations in parallel. Discard REJECTED and INCONCLUSIVE. Only CONFIRMED proceeds.

**Step 4.5 — Reduction and Classification ("只诛首恶" / Isolate Root Cause).**

*This step is executed EVERY round, not just the final one.*

Apply the reduction pipeline to all confirmed findings:
1. **Deduplicate**: Merge multiple findings flagging the same logic flaw from different angles.
2. **Isolate Root Cause (只诛首恶)**: If Finding B only exists because Finding A exists, drop B and keep A. Only the root cause survives.
3. **Filter Resolved**: Drop findings already eliminated by fixes in prior rounds.

Split remaining reduced findings into two buckets:
- **Non-Decisional (Autonomous)**: Trivial fixes, local logic errors, off-by-one, null derefs, explicit undisputed spec violations — unambiguous bugs with a clear correct fix.
- **Decisional (Human-in-the-loop)**: Architectural trade-offs, API contract redefinitions, module boundary changes, conflicting specs (from Step 0), design philosophy choices.

**Step 5 — Auto-fix Non-Decisional findings.** Automatically implement fixes for all Non-Decisional findings. No human permission needed. Apply minimal patches targeting root causes from Step 4.5. For non-trivial fixes, document root cause and fix rationale (what was wrong, why this fix, expected behavior after fix).

**Step 6 — Verification sweep.** Launch an agent to verify each fix (PASS/FAIL per fix point). Write to `docs/audit/RoundN/verify.md`. Add regression tests where applicable. If any FAIL, go back to Step 5.

**Step 7 — Convergence check.**
- If ANY Non-Decisional findings remain (or Step 5 fixes generated new issues) → increment Round N, loop back to Step 1.
- If Non-Decisional == 0 → proceed to Step 8.

**Step 8 — Human Decision Gate.** Present all accumulated Decisional findings to the human:
- Summarize each architectural trade-off with pros/cons.
- Include the spec conflict context from Step 0 if applicable.
- Wait for human decisions.

**Step 9 — Apply decisions & restart.** Execute human decisions. Because these alter the system's specification/architecture, **restart the loop** (Round M, from Step 0) to re-evaluate under the new specs. Continue until BOTH Non-Decisional and Decisional queues are empty.

### Final Output

Write `docs/correctness-audit.md` containing:

1. **Executive Summary** — table of dimension → result counts (raised / confirmed / fixed)
2. **Proven Objects** — strict scope: what exactly is proven, what assumptions it depends on
3. **Cross-boundary Contracts** — table of all verified assumptions
4. **Issues Found and Fixed** — table per round: what was raised, what survived confirmation, what was done
5. **Rejected / Inconclusive Findings** — log of discarded candidates with reasons (prevents re-raising in later rounds)
6. **Decisional Findings Log** — all decisional items, human decisions made, and rationale
7. **Remaining Limitations** — anything that couldn't be fully proven (PARTIAL/UNVERIFIABLE)
8. **Assumptions Registry** — every external dependency, for re-verification if APIs change

## Rules

- **Preserve the trail**: Every round's reports, confirmations, and verifications live under `docs/audit/RoundN/`. Never delete.
- **Fresh eyes each round**: New agents must NOT read prior `docs/audit/RoundN-k/` directories. Explicitly instruct: "do not read any subdirectory of `docs/audit/`".
- **Framework = source of truth**: "The docs say X" is not evidence. `module.rs:line_N` is evidence.
- **Fix before re-prove**: Never accept a "known limitation" if the code can be changed to eliminate it.
- **Strict verdicts**: PROVEN means every path was traced. If you skipped an edge case, it's PARTIAL.
- **No annotations in source**: Proofs live in `docs/`, not as inline comments.
- **Independent confirmation is mandatory**: No finding becomes a fix without Step 4 confirmation. Speculatives without a trigger or solid rationale are rejected and logged.
- **Rejected findings are logged, not forgotten**: Prevents re-raising the same false alarm.
- **Dead code / stale comments / unused params are valid findings**: They don't need a runtime trigger — rationale is signal-to-noise.
- **Non-Decisional first**: Always prioritize autonomous fixes. Only escalate to human when the decision fundamentally alters system design.
- **Isolate root cause**: Step 4.5 pruning is mandatory every round. Never patch symptoms.
- **Continuous spec refinement**: If a fix changes behavior boundaries, update the spec.
- **Circuit breaker**: If the same module has confirmed findings in 3+ consecutive rounds, stop patching. Do a root cause analysis of why fixes keep generating new issues in that module.
