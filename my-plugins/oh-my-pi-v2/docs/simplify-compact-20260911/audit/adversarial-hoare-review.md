# Adversarial Hoare review — PASS

## Scope and current state

Read-only review of `docs/simplify-compact-20260911/design.md`, its `candidate.patch`, the actual dormant A/C implementations and direct tests, plus the current B/D/runtime path:

- A: `hooks/format-compaction-path-list.ts` and `test/format-compaction-path-list.test.ts`
- C: `hooks/compact-compaction-file-suffix.ts` and `test/compact-compaction-file-suffix.test.ts`
- B/D/runtime: `hooks/compaction-file-operations.ts`, `hooks/prepare-compaction-request.ts`, `hooks/custom-compaction.ts`, their request/finalization tests, and reference state/codec/render boundary modules.

Current source is intentionally **unwired**: B does not import A and D does not import C. `git diff` for the two candidate target files is empty. The candidate patch applies cleanly (`git apply --check`) and is the only reviewed proposed wiring; no source files were edited.

## Verdict

**PASS — no BLOCK.**

No reproducible violation of a design P→Q contract was found in current infrastructure or in the candidate wiring. In particular, no observed issue is being relabeled from the design’s explicit limitations: suffix provenance / brace ambiguity, and OOM are not reported as implementation failures.

## Hoare checks

### A: `formatCompactionPathList`

- **P:** `readonly string[]` whose existing `join("\n")` completes. The implementation computes that baseline before its recoverable-formatting `try`; therefore a Proxy that throws on `join` throws. This is outside P, not a defect.
- **Q:** all tested successful returns were either the byte-identical baseline or safely expandable adjacent-run brace grouping, never longer than baseline, with input left untouched. Unsafe input causes whole-list fallback. A post-baseline Proxy throw is caught and returns the already-built baseline.
- **Termination/complexity:** finite forward scans over entries and disjoint contiguous runs; no recursion, I/O, await, shared mutable state, provider calls, retries, or logging. At the source level it is linear in paths/characters under ordinary string-operation costs; a 25,000-item safe run completed in 10 ms in the executed test.

### C: `compactCompactionFileSuffix`

- **P:** the state-derived terminal suffix convention. C itself additionally insists on full consumption of zero-to-two ordered non-empty sections.
- **Q:** it accepts read-only, modified-only, and read-then-modified suffixes; it preserves tag order and section boundaries; it applies A per section; it chooses a compacted suffix only if the whole suffix is strictly shorter. Malformed/ambiguous input returns the original suffix byte-for-byte. Its enclosing `try` catches A and string-processing failures and returns the original suffix.
- **Termination/resources:** two fixed tag iterations, no recursion/I/O/await/shared state. It retains only local strings/arrays and does not introduce concurrency or a resource lifetime.

### Candidate wiring and integration boundaries

- Candidate B wiring invokes A only after B has already produced `readOnly = read − modified`, sorted modified/read arrays, and labels. It changes the newly produced B suffix exactly as the design authorizes; it does not alter extraction, classification, ordering, source sets, or labels.
- Candidate D wiring constructs an ephemeral `displayState` only when references are ON and `previousSummary` is present. It sends that object only to `renderCompactionReferenceSummary`.
- `serializeCompactionReferenceConversation(messages, state, ...)`, `expandCompactionReferences(state, draft)`, and `finalizeSummary`’s closed-over current-round `fileSuffix` retain the original `state`/suffix. Thus the candidate does not change source identity, codec expansion, append-once finalization, OFF prompt behavior, or persistence contract.
- The third runtime entry (`custom-compaction.ts`) still has the same registration, provider/auth/UI/error flow and merely consumes `prepareCompactionRequest` as before. Candidate imports are local A/C modules only; no new module-loading boundary beyond those relative imports is introduced.

## Executed adversarial counterexamples

An inline, no-file-write Node/tsx assertion driver executed:

- A: empty, singleton, short/no-gain lists; adjacent, non-adjacent and duplicate paths; safe absolute paths.
- A unsafe values: Unicode, CRLF, NUL, isolated surrogate, space/tab whitespace, braces, comma, XML delimiter, backslash, UNC, drive-colon path, dot/dotdot components, repeated slash and trailing slash. Each returned the full original baseline.
- A Proxy behavior: a `join` throw before baseline was observed to throw (outside P); a `slice` throw after baseline returned the baseline.
- C: read-only, modified-only, and ordered two-section suffixes; empty sections; duplicate/reversed/unknown sections; embedded close-like content; extra tail; whole-summary prefix; already-grouped input; unsafe + safe mixed sections.
- C malformed forms returned exactly their original suffix; the mixed case preserved unsafe read content while grouping the safe modified section.
- A 25,000-item safe input grouped successfully in 10 ms (result length 338,903), supporting termination and the source-level complexity assessment without claiming a general performance bound.

## Commands and results

```text
node --import tsx --test my-plugins/oh-my-pi-v2/test/format-compaction-path-list.test.ts my-plugins/oh-my-pi-v2/test/compact-compaction-file-suffix.test.ts
# PASS: 8 tests, 0 failures

node --import tsx --input-type=module <<'EOF' ... boundary assertions ... EOF
# PASS: {"edgeCases":"passed","longItems":25000,"elapsedMs":10,"resultLength":338903}

git apply --check my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch
# PASS
```

A combined invocation that also included `prepare-compaction-request.test.ts` and `prepare-compaction-request-finalization.test.ts` could not load an existing dependency: `packages/ai/src/providers/data/amazon-bedrock.json` is absent. A/C’s direct tests within that same invocation passed; the two request suites failed before their tests ran. This is an environment/repository fixture limitation, not a candidate-generated failure. The referenced request/finalization source and tests were nevertheless read for the static contract check.

## Evidence limits

- The candidate patch is not applied in the current worktree; candidate integration was verified by exact diff review and `git apply --check`, not a patched runtime execution.
- No provider, model, token accounting, actual compaction generation, UI flow, persistence, or external filesystem behavior was exercised or claimed.
- C’s full-consumption check validates only its supplied suffix grammar. It does not authenticate entire-summary provenance; this is a disclosed design limitation, not a BLOCK.
- Existing worktree state includes 9 pre-existing staged files (8 under `my-plugins/oh-my-pi-v2`), none staged or changed by this review.

## Minimal counterexample status

No minimal counterexample producing a P→Q violation exists from the executed cases. The only throwing input was the deliberate pre-baseline Proxy `join` trap, excluded by A’s explicit sufficient P that existing `join` completes.
