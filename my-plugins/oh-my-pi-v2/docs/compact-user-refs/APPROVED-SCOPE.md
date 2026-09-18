# Approved compact-reference replacement scope

Status: no-extra-estimation version active with renewed approval. The user's three-case live compact self-test passed; a subsequent single Hoare crash-path review is complete. The historical authorization sections below retain their original stage boundaries.

## Current delivery authorization and review disposition

After the live test, the user authorized commit/push, then requested another check for new failure paths using /hoare-prompt, and authorized suitable minimal fixes before commit/push. One independent reviewer found no reachable new syntax/projection exception under valid native inputs and sufficient resources. Empty reference results still cause empty-summary fallback; replacing that with a success notice would not preserve a useful summary, so the existing protection is retained. Expansion memory amplification remains an explicit limit, not grounds to restore the rejected estimates or caps. Obsolete disabled-state documentation is corrected; no production/test change is required. The existing repository check failure remains a commit gate, not permission to bypass hooks.

## Reactivation approval

Latest instruction: “接入，然后我尝试 compact ，你给我一条 compact 指令让我测试里面的东西是否正确”. This authorizes the existing two preparation lines and one finalization line in custom-compaction.ts, plus corresponding direct regression updates. No estimator or extra rejection gate is reinstated. The two old budget-test expectations now assert annotated input and intact expanded output. The updated 49 tests pass. The user performed the live call; the three reference checks appeared correctly in the resumed context. The later delivery authorization above additionally permits the bounded crash-path review, not functionality expansion.

## No-extra-estimation correction (previously dormant)

Latest user instruction: “不要估算了，就原来咋整就咋整，干掉这些可能出问题的”. Remove the facade’s additional input-fit selection and expanded-output rejection. Keep `maxTokens = Math.floor(0.8 * reserveTokens)` solely as the original model generation option, not an expanded-text budget. Use references whenever call-local referenceable sources exist; otherwise preserve the native ordinary prompt byte-for-byte. Preserve one-pass expansion/literal decoding and one suffix append. Check only the final body for blankness before appending metadata; unknown references remain nonempty neutral diagnostics. No replacement heuristic, character cap, truncation, retry, fallback or diagnostic system.

This revision changes only the dormant facade and necessary direct tests/docs. The active handler, other protected runtime files and four audited core helpers remain byte-identical. No reactivation, reload, provider calls or new audit. The 11 withdrawn-wiring integration tests remain historical and unchanged; their two budget expectations are superseded and must be updated only at future authorized integration.

## Historical rollback instruction — superseded only by the current reactivation above

Previous instructions: “报错了：unusable summary; using built-in 直接回退，不允许用这个先，然后排查问题”, followed by “已经 reload”. The active handler was restored exactly to the original hash below. The dormant correction above does not authorize activation; do not re-enable references or run another live canary. Available records did not preserve the failed request/raw response, so the concrete rejection branch remains undetermined. See verification.md for the evidence boundary. Earlier integration/test statements below are historical, not current activation authority.

## Historical integration authorization addendum

Earlier user instruction: “可以，批准了，搞定了让我 reload 我来试试”. This supersedes the dormant-only gate below solely for the one-file integration in integration-plan.md: hooks/custom-compaction.ts may import/call the completed facade before/after its existing model call and remove replaced code. Necessary offline handler tests/configs and current status docs are allowed. The facade, four core helpers, compaction-conversation.ts, compaction-prompt.ts and extension.ts remain protected. No live calls, self-reload, new audit, official/dependency edits, staging, commit or push. The original gate's authorization, baseline and audit record below remain historical; its required source/protocol behavior still applies.

## Authority

This is the parent-recorded contract from the user's approval of the latest discussion. It supersedes the old entry-ID/carry-over-catalog design. Implementation reports and audit findings cannot silently redefine it.

The user requested QPDI implementation and integration plans first, dormant implementation second, then `/hoare-audit`. Keep code direct and easy to reason about. Report actual changes, deviations, learned principles, and a final integration plan for separate approval.

## Required behavior

1. Only two source classes are referenceable: the previous compact summary body, and actual user messages in the existing current compaction loss region.
2. The loss region is the `messagesToSummarize` conversation OMP currently consumes, after its existing resume-message filter. Do not widen it to retained history, all branch messages, `turnPrefixMessages`, assistant messages, tool calls/results, task context, or additional instructions.
3. The previous summary body includes its already-present user quotes, principles, conclusions, task state, and other prose. Referenceability does not certify human authorship or factual truth.
4. Exclude the existing terminal `<read-files>` / `<modified-files>` generated suffix from indexing. Preserve that text in its original prompt position without reference labels. Ordinary mentions of files inside prose remain body text. Document the exact terminal-format boundary and ambiguity rather than interpreting arbitrary file-looking prose.
5. Split the summary body using complete original lines and Unicode code-point character counts. Accumulate complete lines; flush at the first length at least 33 times the actual current label's character length. Never split a physical line; 66 times is guidance only, not a hard maximum. Preserve CR/LF/CRLF, whitespace, and the short final remainder. No trimming or newline normalization.
6. Each nonempty, purely textual current user message is ONE reference block, regardless of length. Do not split it or combine different messages. Multiple text blocks concatenate in original order with no added separator, consistent with Pi's existing text projection. Empty and mixed-media messages remain unnumbered but visible through existing composition.
7. Use one call-local dense reference namespace such as `@!1@`. Labels occur ONLY at the sources' original positions. Never append a duplicate source catalog or add an outer LLM message/context wrapper.
8. Each independent source document (the previous-summary body, or one user message) has an explicit display terminator `@!@`. It is not source content. Ranges may join chunks of that same summary document, but cannot cross messages, excluded gaps, or source-document boundaries.
9. Support direct references, contiguous summary ranges, and character slices for partial text. Maintain the already-discussed Python-style half-open/negative slicing semantics and `..` alias if reusing that grammar. Operations beyond the approved use need not be newly invented. Specify the exact grammar before implementing it.
10. References are optional. Free prose, verbatim self-written text, and references can coexist in the existing compact summary format.
11. Preserve raw source strings in the source map. Escape reference-shaped literals in model-visible ordinary text using one extra pipe layer; add active labels after escaping. This includes unindexed prompt text: unindexed does not mean unescaped. Do not create fake active markers from tool output or assistant prose.
12. Expand model output and decode literals in one pass. Do not rescan inserted source text. Invalid/unknown/cross-boundary references must not throw; emit a neutral diagnostic without internal reference IDs. Original source text that literally contains marker-like strings is legitimate text, not leaked generated metadata.
13. Save only the expanded summary and existing file suffix. Number tables live only in that compact invocation and are discarded. Do not persist selected entry IDs, scan historical messages for matches, or maintain module-level mutable session state.
14. Normal post-compaction operation sees actual text, not the temporary labeling view. Next round labels the resulting current summary afresh, regardless of whether the previous compact used references.
15. Keep existing runtime untouched now. Future integration must preserve native filtering/conversion/serialization and the one-system/one-user summarizer composition. Do not replace official serialization with an invented history format.
16. Preserve the original model generation allowance only; do not estimate input fit or expanded output. Build only the selected prompt: annotated when sources exist, otherwise ordinary. Expand/decode once before appending file operations once. A nonblank body is returned intact regardless of size; a blank body returns the original empty-summary sentinel before metadata. Existing provider/auth/UI/error behavior stays in the unchanged original handler.

## Required direct evidence

- Exact reconstruction / escaping for Unicode, line endings, pipes, trailing whitespace, and marker-looking literal text.
- Complete-line chunking, changing label digit widths, long indivisible lines, empty/tail cases.
- One entire pure-text user per source; mixed media/empty/non-user sources excluded without removal from the conversation.
- No duplicate source presentation, no cross-source range, explicit end boundaries.
- Valid/invalid/sliced/ranged references, forward progress, no recursive expansion, no generated IDs in diagnostics.
- Two-round synthetic compaction with no historical lookup, metadata selection record, or cross-session global state.
- Offline native serializer parity / composition tests. No paid model/provider tests or live reload before integration approval.
- Strict scoped TypeScript, focused tests, targeted formatting, and required repository check with pre-existing diagnostics distinguished.
- Protected runtime hashes and staged-state preservation.

## Original dormant-gate authorized paths / safety

Owner: `my-plugins/oh-my-pi-v2/`.
Docs: `docs/compact-user-refs/` (reuse and rewrite obsolete current docs; archive old proof/results clearly as superseded).
Code: only dormant compact-reference helpers and their focused tests/configs. Replace the previous four dormant helpers/tests rather than preserving deprecated entry-ID functionality merely for compatibility. Read existing files fully before modifying/removing them.

Do NOT modify:
- `hooks/custom-compaction.ts`
- `hooks/compaction-conversation.ts`
- `hooks/compaction-prompt.ts`
- `extension.ts`
- Impression source/runtime, official `packages/`, other sessions' work, dependency metadata, or root configuration.

No staging, commits, pushes, real provider calls, runtime imports/wiring, or reload/live acceptance in this gate.

Baseline: root `main`, HEAD `c7c2fe27617b369e3eed9360cb540f5ed0265cb9`.
Staged diff SHA-256: `98cad3272f6d05411851491e3f90e6e8045a278f70907f9f3773b315922d92e7`.

Protected SHA-256:

```text
6a79fe89ce9b379c3d292dc9e0ec6b812c211f6ba2eed5d5b05db43da894e89b hooks/custom-compaction.ts
b55ce3ec98eebdf53fd20fca0d4f9adb7d417d7d651e48fc9cbf6d237d3646e3 hooks/compaction-conversation.ts
2c44b6ee7681d2b33080eb9e44f0e08305dfc814099e3b9d3270533b6c366c5f hooks/compaction-prompt.ts
bb884555eeda471cbbf931c9a4d4bd30179846d4ed6eb6fef43f868bb041ad43 extension.ts
```

## Audit deployment profile and process

Execution: dormant synchronous pure helpers for a local CLI plugin; the future handler is async, but all mutable reference tables remain call-local. Inputs: typed Pi preparation plus arbitrary user/source/model strings. No network/IO/resources in core algorithms. Threat model: malformed LLM syntax, literal collisions, Unicode boundaries, accidental cross-source references; allocation failure is outside the ordinary model-syntax guarantee. Persistence: only future final expanded summary; none for reference indices.

Ground truth: this accepted scope and the updated QPDI contracts derived from it, not legacy docs or implementer self-assessment.

Three independent audit dimensions after implementation:
1. Functional correctness: contracts, branch NSPs, loop initialization/maintenance/termination, chunking/slicing/ranges/exact restoration.
2. Cross-boundary correctness: actual Pi serializer/type/source contracts, eligibility, suffix boundaries, session ownership, dormant safety, future caller obligations.
3. Adversarial/protocol correctness: malformed and oversized syntax, literal escaping, output metadata leakage, cross-source boundaries, deterministic runtime termination.

Follow `/hoare-audit`: evidence-backed findings require violated contracts and executable counterexamples; each candidate receives two fresh disprove-first challenges and survivors one fresh counter-challenge. Parent lead verifies evidence and authorizes fixes. No fix of disputed requirements by majority vote. Confirmed code issues get regression/property tests and an independent fix verification. Repeat only for unresolved/new concrete issues; use the method's three-round circuit breaker. Preserve reports, explicit proof limits, and rejection reasons.
