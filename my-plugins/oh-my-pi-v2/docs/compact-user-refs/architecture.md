# Architecture

**Status:** Active with renewed approval, 49 passing offline tests and the user's successful three-case live self-test. D1–D5 retain their original core audit. The active integration also received one bounded independent Hoare crash-path review; this is not an unconditional no-failure proof.

Spec source: APPROVED-SCOPE.md and principles.md. The active handler uses D6 before and after its existing model call.

## D1 — source state

buildCompactionReferenceState(messages, previousSummary = "") accepts the already-filtered original AgentMessage list. It returns a frozen state containing frozen sources ({ordinal, document, text}), summarySourceCount, fileSuffix and a frozen userOrdinals array aligned with INPUT OCCURRENCES. No message objects are retained. Document 0 is the summary body; each current user occurrence uses its list index + 1. Repeated references to the same message object in the input remain distinct occurrences.

Requires: typed Pi messages, no mutation during synchronous preparation; caller has applied the existing resume filter. Ensures: exactly the approved sources, dense ordinals, source strings never escaped/trimmed, no shared mutable state.

### Terminal file suffix

Read backward in canonical order: attempt terminal modified-files, then terminal read-files. A recognized section ends exactly in LF + closing tag, begins at the rightmost preceding two-LF + opening tag + LF delimiter, and has nonempty payload. The suffix includes its leading two LF. No trailing whitespace is accepted as formatter output; no CRLF normalization is attempted. Body and suffix concatenate exactly to input.

This deterministic terminal-layout policy cannot prove provenance. Identical terminal prose is also excluded; pathological paths containing tag delimiters are inherently ambiguous. No speculative metadata/migration is added. Ordinary file mentions and nonterminal blocks remain body text.

### Summary chunks

Scan original physical lines, including CR, LF or CRLF terminators. Accumulate whole lines and Unicode code-point length. Flush when accumulated length first reaches 33 × current marker length. Recompute target after each emitted ordinal. 66× is not a branch or hard bound. Flush a nonempty final remainder. Never split a line or invent separators.

### Current users

Before conversion, require role=user and either a nonempty string, or only text blocks with a nonempty concatenation using no separator. Whitespace-only strings qualify. Empty/mixed/image/non-user messages remain unindexed. Append one source per eligible occurrence, regardless of length. Array and records are frozen before returning.

## D2 — existing-position display

renderCompactionReferenceSummary(state) emits each summary label immediately before escaped chunk text, one final @!@ boundary, then escaped fileSuffix. Empty body gets no boundary. Source text is not copied elsewhere.

serializeCompactionReferenceConversation(messages, state, serialize) takes the SAME original ordered messages used to build state and a native serialization callback. Serialize each singleton using serializeConversation(convertToLlm([message])); skip empty results and join remaining strings with two LF. This equals native batch serialization because both functions are message-local.

For an eligible occurrence, require its singleton native string to equal "[User]: " + stored source text. Escape that native string, insert label after its known user prefix and terminator immediately after its body. Noneligible output is merely escaped. There is no global search for user text or role headers. Internal mismatch throws a caller-contract error; malformed LLM output is handled separately without throws. No source/message mutation occurs.

This late escape is necessary: escaping tool JSON or raw tool result before native serialization can change quoting/truncation. The serializer itself remains official, not reimplemented. The callback must be the native composition (or a behavior-equivalent pure test double).

## D3 — exact minimal grammar

Supported forms (ID is canonical positive decimal without leading zeros):

- @!ID@
- @!ID[START:END]@
- @!A~B@ (inclusive chunk endpoints)
- @!(A~B)[START:END]@ (slice the joined range)

A slice may omit either endpoint; .. is an alias for :. Signed decimal endpoints use Python-style negative, clamped, half-open Unicode code-point indexing. Large endpoints clamp without BigInt allocation. Reversed slices return empty text. Ranges require A <= B, all sources exist, and every source belongs to the SAME document. No endpoint transforms, operation chains, trim methods or pos() are introduced. Separate adjacent references concatenate naturally. Parenthesized ranges require a slice; ungrouped range-followed-by-slice is rejected rather than inventing precedence.

The emitted @!@ boundary is display-only; if copied in the draft it is discarded. It never selects text.

## D4 — one-pass output codec

escapeCompactionReferenceLiterals adds one pipe to each @ + zero-or-more pipes + ! prefix. Ordinary text outside this family is unchanged. The output scanner recognizes escapes BEFORE active references. An escaped prefix loses exactly one pipe layer and is appended without rescanning.

For an active @!, scan to the next @ or line boundary/end. A syntactically complete candidate owns its closing @ even if the following character is ! (ordinary punctuation), whether lookup succeeds or yields a semantic error. Only a grammatically malformed candidate may resynchronize when that @ begins another active/escaped prefix: diagnose it and leave the next prefix for the following iteration. Otherwise consume the closing @. CR/LF ends an unterminated candidate without consuming the line break. This recovery intentionally consumes malformed same-line candidate text, not guesses at prose embedded inside it.

Candidate expressions longer than 256 UTF-16 units are rejected before parsing. The scanner still consumes the whole candidate, so huge ID fragments are not exposed in diagnostics. All failures emit exactly (unresolved compaction reference). Valid candidates append raw selected source or its code-point slice directly. Insertions are never input to the scanner.

Requires: finite draft string and state produced by D1. Ensures: exact ordinary/literal/reference semantics, no model-syntax throw, every loop advances. Allocation exhaustion is outside the guarantee. Output growth is proportional to requested expanded content. Neither codec nor facade imposes an expanded-output size check or truncation.

## D5 — instructions and composition

buildCompactionReferenceInstructions() returns protocol instructions only, never source text or a new context. It describes both source types, optional free prose, exact grammar, code-point slices, same-document ranges, terminator, literal escape depth, no final IDs and no claim of human authorship for summary text.

The request facade escapes task context/custom instructions before composing the ON prompt. Existing static prompt strings contain no reference prefixes and are reused unchanged. It never blanket-escapes an already annotated prompt. All source lookup/display/expansion share one state instance for that invocation.

## D6 — request facade (not covered by the four-core audit)

Preparation/finalization lives in the infrastructure so active wiring has at most three readable added/replacement lines per behavioral insertion point. `prepareCompactionRequest(event, context, getTaskState)` returns `{ prompt, maxTokens, finalizeSummary(draft) }`. It performs no provider call, UI operation, persistence or handler registration.

Requires: the existing typed event/context and synchronous non-mutating task reader. The facade calls the existing resume filter once and samples task state once using its existing formatter. It snapshots the native file suffix from the original loss-region messages and computes the existing `floor(0.8 * reserveTokens)` solely for the model generation option, not as a final-text budget.

One call-local reference state uses the same filtered occurrences and previous summary. If sources exist, the facade builds only the annotated prompt, escapes task/custom text, and APPENDS the instruction-only suffix after the existing composed prompt. This placement replaces the earlier proposal to insert it before seven-section instructions: existing prompt builders need no changes, no static prompt is copied, and the complete request still consists of one user prompt with the existing system prompt.

ON requires only a nonempty source table. With no sources, OFF builds only the byte-identical ordinary prompt using the native serializer and existing first/update builder. There is no model/contextWindow argument, input estimate, fit veto or alternate size heuristic; both serialized candidates are never constructed for selection.

The returned `finalizeSummary` closure captures only that invocation's state, mode and suffix. ON expands references and decodes literals exactly once; OFF uses the untouched draft. A single post-expansion blank-body check returns the original empty-summary sentinel before metadata. Otherwise return the entire body plus the snapshotted suffix, regardless of length. Long prose and short references expanding far beyond maxTokens remain intact; unknown IDs remain nonempty neutral diagnostics. Empty checks never trim accepted output. The suffix is appended once AFTER expansion and is never scanned. Repeated/interleaved calls use immutable snapshots; finalization is not a mutating stream or a global cache.

Direct facade tests establish these composition contracts; the historical core audit still applies only to the unchanged four core modules. The later bounded Hoare review traces the active caller, immutable snapshot across await, syntax branches and blank-result fallback. Active auth, options, response text collection, model call, status cleanup, result fields and fallback remain handler responsibilities.

## Composition and limits

D1 establishes source membership and immutable text; D2 preserves native placement/projection while giving those exact strings labels; D3/D4 resolve only that table without crossing a document or reinterpreting inserted text; D5 explains precisely this language. No ID persistence is needed because the saved expanded text itself is next round's input. D6 owns ordinary/ON prompt selection and finalization. The registered handler calls D6; its 11 controlled-completion cases are part of the current 49-test gate. The live self-test additionally confirms one observed source/unknown/literal round, not arbitrary deployed-version compatibility or all persistence paths.

A nonblank draft such as @!1[0:0]@ or @!@ can expand to a blank body and trigger the handler's existing fallback. This is deliberate empty-summary protection, not an exception; a neutral notice would not supply the missing summary. Repeated references amplify output allocation, and slicing currently allocates code points for the entire selected source/range before slicing. Sufficient resources remain a precondition; no output cap, truncation or allocation-failure guarantee is added.
