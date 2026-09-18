# Infrastructure implementation

**Status:** Core and facade are active after renewed approval. Both extra estimate gates are removed; the original model generation maxTokens remains. All 49 focused tests and the user's three-case live self-test passed. A subsequent bounded Hoare crash-path review found no code defect requiring a fix, subject to the empty-summary and allocation limits in architecture.md.

The original dormant build order and core footprint below are retained as implementation history.

## Files and concrete APIs

Replace the four old user-reference modules/tests with source-named compaction-reference modules. No legacy exported aliases remain.

| File under hooks/ | API / responsibility | Estimated nonblank LOC |
|---|---|---:|
| compaction-reference-state.ts | CompactionReferenceSource/State; buildCompactionReferenceState(messages, previousSummary?); physical-line chunks, suffix partition, source snapshots | 110–160 |
| compaction-reference-codec.ts | formatCompactionReference, escapeCompactionReferenceLiterals, expandCompactionReferences(state,draft); small fixed grammar and scanner | 130–190 |
| annotate-compaction-references.ts | renderCompactionReferenceSummary(state), serializeCompactionReferenceConversation(messages,state,serialize) | 45–80 |
| compaction-reference-prompt.ts | buildCompactionReferenceInstructions() | 15–30 |

Every source stays <=200 nonblank/noncomment LOC. Plain loops, frozen snapshots and fixed local grammar replace maps of historical entries, generic parsers, and metadata migrations.

## Build order

1. Archive old results/proof and rewrite current QPDI docs; parent reviews before code.
2. Implement state: terminal suffix, complete lines, whole users and occurrence-index mapping.
3. Implement codec: formatting/escape, direct/range/slice resolution, one forward scanner with ID-free diagnostics.
4. Implement display adapter using official serialization callback; no official/source dependency is imported by production core.
5. Implement instruction-only text.
6. Replace old four tests; add generated/native composition test and OMP-scoped strict TS/Biome config.
7. Run focused tests, types, format, diff/protected/staged checks and required root check.
8. Report actual LOC and limits; parent independently audits afterward. Do not self-certify audit completion.

## Direct test ownership

- state.test: terminal suffix cases and ambiguity policy; exact line reconstruction; threshold/digit-width; Unicode/CRLF; long lines and short tail; eligibility; occurrence identity; immutable snapshots.
- codec.test: each grammar form, Unicode negative/clamped slices, same-document range, cross-document rejection, escapes, malformed/huge recovery, terminator, nonrecursive insertion.
- annotation.test: original positions, no duplication, suffix and non-source escaping, native callback contract, no mutation.
- prompt.test: optional language, all actual syntax forms, literal layers and exclusions; no catalog.
- composition.test: actual official convertToLlm/serializeConversation parity across every original message role, long tool truncation and JSON; two synthetic rounds, generated reconstruction/literal tests.

The initial Gate B wiring was withdrawn after a failed live trial. The no-extra-estimation version was subsequently approved, reconnected and tested. Offline tests use controlled completion, not live providers. Superseded historical proofs do not establish replacement correctness.

## Actual implementation footprint

The four source files contain respectively 99, 119, 45 and 10 nonblank/noncomment lines (273 total), all below 200. Five test suites contain 25 passing tests, with separate fixture and source-type re-export support files. Two scoped configs keep repository-source parity tests fully typechecked. The later handler boundary additionally uses its actual existing built completion/options declarations; see verification.md. No public legacy alias or old source/test file remains.

## Small-call-site follow-up

The parent-selected D6 facade lives in `hooks/prepare-compaction-request.ts`. Its current API is `prepareCompactionRequest(event, context, getTaskState)`, with no model argument or estimator calls. It constructs only the source-presence-selected native prompt and returns nonblank finalized text intact, including expanded text beyond the generation allowance and the original suffix, subject to available resources. It owns complete request preparation and summary finalization, while provider calls and handler side effects remain outside. Existing filter/task formatter/prompt builders/native APIs are reused; the four audited core files are byte-identical.

Build order for this follow-up: update architecture/integration contracts, implement facade, add source-named preparation/finalization/loader tests, extend scoped configs, run direct gates and preserve hashes. No new audit/reviewer loop is authorized. Twelve new tests plus 25 core and one existing context test pass. Test-only API bridge/hook loads the real unchanged native functions and fails if the unrelated provider function is reached. Exact current boundaries are documented in verification.md.

## Active integration

The 11 handler cases are included in the current 49-test gate. Two obsolete budget expectations were changed to assert always-annotated eligible input and intact expanded output; the other nine cases remain unchanged.

Only hooks/custom-compaction.ts changes in production: two preparation lines, one finalization line, import/log cleanup and deletion of duplicate suffix handling. Three source-named runtime test files plus completion/fixture/loader support exercise the actual registered handler. Eleven new cases plus the prior 38 pass; no DI surface, provider execution or new audit was added. Every new test/support file remains below 200 nonblank/noncomment lines.
