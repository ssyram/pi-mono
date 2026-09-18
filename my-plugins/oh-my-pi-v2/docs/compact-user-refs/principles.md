# Principles

**Status:** Active after renewed user approval and a successful three-case live reference self-test. Extra token-estimate policies are removed. The core audit is supplemented by a bounded independent Hoare crash-path review of the active integration; its conditional guarantees and residual limits are recorded in verification.md.

## Q.I — user intentions

1. Reuse existing exact text through optional references while retaining free-form summaries.
2. Index only previous-summary body and actual current-loss pure-text user messages.
3. Preserve each source at its original prompt position, without a duplicate catalog.
4. Normal post-compaction operation sees expanded text, never temporary generated labels.
5. Keep complete original lines in summary chunks; current users remain whole-message blocks.
6. Keep state call-local and maintain existing native model composition/fallback.
7. Implement and audit infrastructure before separately approved integration; both stages are now complete.
8. Encapsulate request preparation/finalization so each behavioral insertion point needs at most three readable lines. Keep direct tests and reviews bounded by their authorization.
9. Remove additional input/output estimates; retain the original model generation maxTokens and blank-summary behavior. Reactivation, the user's live trial and a subsequent single crash-path review were separately authorized.

## Q.A — source-verified facts

- OMP filters Boulder resume messages before official convertToLlm/serializeConversation.
- convertToLlm also projects custom/bash/summary roles to LLM user messages. Eligibility must use original role, not converted role.
- Official serialization is message-local, omits empty projections, and joins emitted parts with two LF characters. User text blocks concatenate without separators.
- Tool results truncate at 2000 UTF-16 units BEFORE this feature; escaping before serialization would change that boundary.
- File-operation lists are appended with exact LF tag delimiters and no provenance metadata or escaping. Terminal prose can be indistinguishable from a generated list.
- Ordinary user role does not prove human authorship.

Sources: packages/coding-agent/src/core/messages.ts (convertToLlm); core/compaction/utils.ts (serializeConversation); hooks/compaction-conversation.ts; hooks/compaction-file-operations.ts.

## Q.E — accepted corrections

The old additional-source catalog repeated text already in previousSummary. Recovering historical authorship/IDs was unnecessary for the actual text-retention goal. The replacement does not preserve those abandoned mechanisms for compatibility.

## Root design properties

P1: Reference source membership follows Q.I.2; unindexed text is not removed.
P2: Summary source concatenation exactly reconstructs its recognized body; each eligible user occurrence contributes exactly one unchanged text string.
P3: Dense labels have one invocation-wide namespace and explicit per-document terminators. A range cannot cross document boundaries.
P4: Model-visible ordinary text gains one literal-escape layer; generated labels are added afterward. Expansion decodes once and never scans inserted originals.
P5: Malformed/unknown/cross-document references yield a fixed ID-free diagnostic, not syntax exceptions.
P6: No reference persistence, branch lookup, selection metadata, or module-global mutable state.
P7: Production integration changes only custom-compaction.ts. The native converter/serializer, prompt builders, other protected runtime files and four audited core helpers remain unchanged by wiring.
P8: Keep native composition and exact no-source OFF behavior. Source presence alone enables references; maxTokens is solely a generation option. Never veto input or expanded output using an extra size estimate, cap or truncation.
P9: The request facade owns deterministic request preparation and finalization; the handler still owns auth, provider call, UI cleanup and persistence. A short call site must not hide cross-session state or duplicate the handler. The four-core audit is not a verdict on the newly added facade.

Rationale: local immutable source snapshots make exact restoration independent of message identity/provenance; native singleton serialization supplies original projection semantics without inventing a transcript format. These components together satisfy the source, display, expansion and isolation obligations. Model judgment/selection quality remains outside this deterministic mechanism. No-syntax-throw is not a no-fallback or unlimited-resource guarantee: a draft selecting only empty/blank text still triggers the original empty-summary fallback, and repeated references can expand far beyond the generated draft.
