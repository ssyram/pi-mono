# Integration — no extra estimates

**Status:** Reintegrated after explicit renewed user approval. Updated 49 tests, scoped types and changed-file formatting pass. The user's live compact self-test returned expanded source text, the unresolved-reference diagnostic and the literal @!LITERAL@. The assistant did not initiate the live model call.

## Applied points — only hooks/custom-compaction.ts

The existing model/auth checks remain before preparation. The old context/maxTokens/prompt block is replaced by two lines:

```ts
const request = prepareCompactionRequest(event, context, getTaskState);
const { prompt, maxTokens } = request;
```

Keep the original model call, system prompt and one user message, auth headers/key, signal, reasoning setting and generation maxTokens. After collecting response text blocks, before the existing blank-summary check, finalize with one line:

```ts
summary = request.finalizeSummary(summary);
```

One facade import was added and the replaced preparation/suffix blocks and obsolete imports were removed. The whole diff is not claimed to be three lines. Preserve the original blank-summary fallback, provider errors, auth, UI/status cleanup and returned `firstKeptEntryId` / `tokensBefore`. No new rejection diagnostic or fallback system is needed.

These changes are applied. compaction-conversation.ts, compaction-prompt.ts, extension.ts and the four audited helpers remain unchanged.

## Current facade ownership

`prepareCompactionRequest(event, context, getTaskState)` returns a frozen call-local `{ prompt, maxTokens, finalizeSummary }`. It filters once, reads tasks once and snapshots source strings and file suffix. With referenceable sources it builds only the annotated native prompt; without sources it builds only the byte-identical ordinary prompt. There is no model/contextWindow argument or input-size selection.

`maxTokens = Math.floor(0.8 * reserveTokens)` remains only the original generation option. Finalization expands references/decodes literals once when enabled, checks the resulting body for blankness before metadata, then appends the suffix once. No input or output estimator, expanded-text budget, replacement cap, truncation, retry or diagnostic system exists. Long free prose and short references expanding to long text are returned intact; unknown references still produce the nonempty neutral diagnostic.

Provider calls, auth, UI, error handling and persistence remain outside the facade. No reference state is persisted or shared between calls.

## Historical integration evidence — not current acceptance

The prior authorization (“可以，批准了，搞定了让我 reload 我来试试”) led to a one-file integration with 11 controlled-completion runtime tests and 38 core/facade/context tests (49 total). The live trial failed, wiring was withdrawn, and the user confirmed reload of the original handler. That result is historical, not a current green integration claim; see verification.md and the preserved result records.

The 11 runtime tests are now rerun against the actual reconnected handler. The two obsolete budget expectations now assert annotated input regardless of contextWindow and intact 40,000-character expansion despite maxTokens 8. The other nine handler cases are unchanged; all 49 core/facade/context/handler cases pass.

## Live self-test

The user ran the compact self-test and the resumed context contained all three expected results: SOURCE held the first 40 source characters, MISSING held (unresolved compaction reference), and LITERAL held @!LITERAL@ without rescanning. This is one observed successful round, not a guarantee for every model output.

For a repeat, request a real short slice reference, an unknown numeric reference and an escaped literal; do not ask the model to simulate their expected expanded outputs. Spell protocol prefixes as separate characters in custom instructions so input literal escaping does not change the intended probe. No automatic provider call is needed.
