# HoarePrompt Code Audit — Methodology Reference

Reference: Bouras, Dai, Wang, Xiong, Mechtaev, "HoarePrompt: Structural Reasoning About Program Correctness in Natural Language" (arXiv 2503.19599, 2025)

## Design Document Primacy (CRITICAL — read before anything else)

**The correctness of a Hoare derivation depends entirely on the correctness of its Requires/Ensures/Invariants.** These must come from a **design specification**, not from the auditor's intuition about what the code "should" do.

### Rule 1: Spec comes from design docs, not from intuition

- ✅ Extract from the project's design documents.
- ✅ If no design doc exists, use `/hoare-design` to reverse-engineer a descriptive spec first.
- ❌ Do NOT write specs based on "this function should obviously check X" or "good practice requires Y".

A function that doesn't check X is not "missing a check" — it may be **delegating that responsibility to its caller by design**.

### What is HoarePrompt?

HoarePrompt adapts classical Hoare logic to LLM-driven code analysis. Instead of formal proofs, it uses **Natural Strongest Postconditions (NSP)** — natural-language descriptions of reachable program states at each code point. The LLM acts as the state transformer: given a precondition and a code block, it produces the most specific true description of the state after execution.

Core insight: LLMs are unreliable at holistic "is this code correct?" judgments, but much better at **local, structural reasoning** — describing each statement's state transition, then chaining them compositionally.

### Rule 2: "Caller guarantees" is a valid Pre-condition source

Check the call graph. If the caller validates before calling, the Pre-condition is transitively established — not a bug.

```
# Example (pseudo-code — adapt to the target language):
# WRONG: "commit_transition doesn't validate token → bug"
# RIGHT: "prepare_transition validates token before commit is called →
#          commit's Pre 'token validated' is established by the caller chain"
```

### Rule 3: Specs can be challenged, but challenges must be validated against ALL usages

Propose spec additions as **hypotheses**, then validate against every call site:
- ALL callers establish it → implicit contract, already enforced. Redundant but harmless.
- SOME callers don't → those callers are the bug, not the callee.
- NO callers establish it and function works fine → not a real requirement. Drop it.

**Every proposed spec addition costs a full call-site sweep.** This is intentionally expensive.

### Rule 4: "Stronger spec ≠ better spec"

Designs often intentionally choose weaker guarantees (fire-and-forget logs, one-time tokens consumed at prepare, pure-memory lookups). If your derived spec is stronger, the discrepancy is a design trade-off, not a bug.

### Rule 5: Requires IS the contract — don't duplicate it inside the function

In Hoare logic, `{P} S {Q}` assumes P. If Requires says "caller guarantees X", the proof does NOT need to re-verify X inside S. Pulling the caller's guarantee into the callee is not "defense in depth" — it is **rewriting the contract**.

When you see a function that doesn't validate something:
- ❌ "Function F doesn't check X → add check to F" (changes contract)
- ✅ "Function F's Requires says caller checks X → verify ALL callers actually check X" (validates existing contract)

If a caller DOESN'T establish the Pre → that's a bug in the **caller**, not the callee.

### Rule 6: Lesson/spec citations must verify their preconditions

Lessons and spec constraints are conditional rules, not universal laws. Before citing one as evidence, verify its preconditions hold in the current context.

```
# Example (pseudo-code):
# WRONG: "Lesson says 'tolerant parsers hide mistakes' → this lenient parse is a bug"
#   (Lesson's precondition is 'human-authored config' — this code parses
#    machine-generated internal data where leniency is intentional)
# RIGHT: "Lesson applies to human-authored config. This parser handles
#          trusted machine-generated data. Precondition unmet — not a finding."
```

Design-doc constraints are scoped too: "external input" doesn't apply to internal calls; "persistent state" doesn't apply to ephemeral buffers. **Always check the scope.**

### Rule 7: When no design doc exists, ask before proceeding

If the target functions lack explicit design documentation:
1. Ask the user: "No design document found for [target]. Should I run `/hoare-design` to derive a descriptive spec first?"
2. If yes → run `/hoare-design`, use its output as the spec source.
3. If no → the user may provide context verbally, or you proceed with extreme caution, marking every spec as "INFERRED — not design-verified".

## The Method (5 Steps)

### Step 1: Decomposition (CFG Traversal)

Break the program into Control Flow Graph components: sequences, branches, loops. Process each independently, propagating state annotations forward.

### Step 2: State Annotation (Natural Strongest Postcondition)

For each code block, generate an NSP — the most specific description of what IS true AFTER execution. Describe what IS true (postcondition), not what SHOULD be true.

```
# Example (pseudo-code — adapt to the target language):
# { STATE: tasks is non-empty, nextId > max(task.id) }
tasks.append({ id: nextId, ... }); nextId += 1;
# { STATE: tasks has one more element, its id == old(nextId), nextId == old(nextId)+1 }
```

### Step 3: Branch Analysis (Case Splitting)

At every branch point, analyze EACH branch independently:

```
# Example (pseudo-code):
if task.status == "done": return "[done]"
# { STATE(here): task.status != "done" }
if task.status == "expired": return "[expired]"
# { STATE(here): task.status ∉ {"done", "expired"} }
# Verify exhaustiveness: are all possible values covered?
```

### Step 4: Loop Reasoning (Few-Shot Summarization + k-Induction)

1. **Unroll** k iterations (typically k=3), show concrete state after each.
2. Identify the **pattern** — how variables change per iteration.
3. **Generalize** to a natural-language loop summary valid for any iteration count.

Verify via k-induction when rigor is needed:
- **Initialization**: summary holds before the first iteration.
- **Maintenance**: if it holds at iteration k, it holds at k+1.
- **Termination**: the progress measure strictly converges toward the bound.

### Step 5: Correctness Assessment (NSP ⇒ Specification)

Chain local NSP annotations together, then check: **does the final accumulated NSP entail the specification?**

```
# Example (pseudo-code):
function executeAdd(text, tasks, nextId):
  PRE:  text is string|undefined; nextId > max(task.id)
  POST: if !text → error, no mutation; else → tasks has one more element, id unique, nextId incremented
  VERDICT: POST entails spec "add a task with auto-incrementing id" — CORRECT
```

## Extended Method: Cross-boundary Contracts & Concurrency

### Step 6: Assumption Extraction, Verification, and Lifecycle Model

For every call to an external API or separate module:

1. **Extract Assumption**: Explicitly state what you assume about its behavior.
2. **Verify Source**: Read actual source code — never trust docs alone.
3. **Verify Connection Lifecycle**: What is the connection model? (Short-lived per-request / persistent socket / pooled?) What are the exact side-effects of disconnect (e.g., PID cleanup, session invalidation, resource release)? Implicit lifecycle assumptions are a major source of system-level failures.
4. **Verify Concurrency Contract**: Identify shared resources, lock acquisition ordering, and Rely/Guarantee conditions between the module and its environment.

```
# Example (pseudo-code — adapt to the target language and framework):
# ASSUME: framework.appendEntry(type, data) creates an entry that:
#   - Survives compaction (never deleted)
#   - Is never sent to the LLM
#   - Is retrievable via sessionManager.getEntries()
# VERIFIED: session-manager source, line ~90 — "Does NOT participate in LLM context"
```

## What to Annotate (Checklist)

For each function, verify:

| Aspect | Question |
|--------|----------|
| **Null / Type safety** | Can any variable be null/undefined/wrong type? Is it checked? |
| **Exhaustiveness** | Are all cases of a union/enum handled? |
| **Termination** | Do all loops have a progress measure? |
| **Resource cleanup** | Is every allocation paired with a release on ALL paths? |
| **Connection / Lifecycle** | What is the external connection model? Short-lived / persistent? Disconnect side-effects? Are session lifecycle assumptions valid? |
| **Concurrency Contracts** | What are the shared resources? Lock acquisition order? Rely (environment promises) / Guarantee (self promises)? |
| **Exception safety** | If line N throws, what state is left? Are invariants preserved? |

## Multi-Angle Decomposition

For non-trivial codebases, split into independent audit angles. Each angle audited **independently** (different agents, no shared findings) to avoid groupthink.

1. **Crash Safety** — Can it throw/crash? Every function, every path.
2. **Functional Correctness** — Does it do what it claims? Prove each invariant.
3. **Cross-boundary Contracts** — Are API assumptions correct? Verify against source.
4. **Resource Safety** — Are resources (timers, sessions, handles) properly managed?
5. **Spec vs Implementation** — Read the spec line by line; tick each requirement. Self-consistent code can still miss a spec sentence.
6. **Adversarial Inputs** — Construct oversized, malformed, reserved-name, recursion-bomb, boundary-encoding inputs. Surfaces a distinct bug class from correctness-focused rounds.

## Common Pitfalls

- **Overstating coverage**: "PROVEN" means you traced every path. If you skipped an edge case, it's "PARTIAL".
- **Trusting types over runtime**: Type systems can be circumvented at runtime (type casts, external data, serialization boundaries). Verify runtime guards exist.
- **Ignoring framework chaining**: If multiple hooks/plugins modify the same data, the Nth handler sees modified data, not the original.
- **Assuming single-call safety**: A function proven correct for one call may break invariants when called in sequence or concurrently.
- **Missing resource paths**: A try/finally for cleanup is correct ONLY if the allocation is INSIDE the try. If between allocation and try, an exception leaks the resource.
- **Summarizing instead of annotating**: "This function sorts an array" is a summary. "After line 5, arr[0..i) is sorted and arr[i..n) is unchanged" is an NSP. Always write NSPs.

## Recurring Lessons

Brief reminders of patterns seen repeatedly across audit loops. Language-agnostic — concrete manifestations vary by language and runtime.

- **Identity vs equivalence in derived values.** Transformations (promise chaining, mapping, cloning) produce a new identity each call; don't compare by re-deriving. Store once, compare the stored reference.
- **Reserved-name keys from untrusted input.** Any collection keyed by user/LLM strings must reject names the runtime treats specially (`__proto__`, `constructor`, shell builtins, etc.). Enumerate and reject at the boundary.
- **Round-trip filtering is silent data loss.** A narrowing reader paired with a round-trip writer erases out-of-shape data on next persist. Preserve unknown shapes, or reject at write time.
- **Commit ordering across files.** When two files must agree, designate one as the commit marker; write the other first. A crash between leaves a consistent pre-transition view.
- **Subtree cleanup on signal.** Killing a process doesn't kill the subtree it spawned. Use the platform primitive (process groups, job objects) if the child can spawn background work.
- **Multi-source settlement.** When several events can settle a state (timeout, completion, error), use an idempotency flag AND record the source — some side effects should run only for specific sources.
- **Tolerant parsers hide user mistakes.** Skipping unexpected input absorbs the user's error as a silent default. For human-authored config, prefer strict.
- **Forward ≠ reverse reachability.** "Path from start to end exists" doesn't imply "every node can still reach end". Run the reverse traversal when the invariant is "no dead ends".
- **Hook callbacks run in swallow-errors envelopes.** A throw in a framework callback often disables the callback silently. Wrap the body; surface real errors explicitly.
- **Line citations drift.** `file:line` is stale after the next edit. Prefer function-name anchors, unique-string anchors, or a "lines are approximate" caveat.
- **Dead code is a signal.** Unused exports, unreachable branches, stale comments are often remnants of design changes. Before deleting, verify whether an invariant at a distance makes them "unreachable"; if so, keep as defense-in-depth.
- **Disk is authoritative; memory is a cache.** For state that crosses process boundaries, design the persisted form first and treat in-memory as derived.
