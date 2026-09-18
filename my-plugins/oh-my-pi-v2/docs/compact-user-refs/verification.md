# Verification

**Current status:** No-extra-estimation version reintegrated with explicit renewed approval. **49/49 tests pass**, scoped strict types pass, both changed runtime tests pass scoped Biome and the handler passes the root formatter/linter through stdin without changes. The user's live compact self-test passed for source expansion, an unknown reference and a restored literal. The original independent audit covers the four core helpers; the subsequent bounded crash-path review also examines the active integration.

The two old runtime budget expectations were replaced by positive regressions: contextWindow does not veto references; a 40,000-character expansion is returned intact with generation maxTokens 8. Other handler cases are unchanged. The current full test command is the first command under Historical integration gates below; it now runs the updated cases against the actual reconnected handler. Root check still has the identical 810-error baseline; current log: `/tmp/compact-no-estimates-reintegration-104-root-check.log`.

## Bounded crash-path review and disposition

The user requested Hoare reasoning before commit. One independent reviewer derived caller preconditions, branch postconditions and loop progress, traced native preparation/projection and the call-local closure across await, and ran 44 selected tests plus bounded native-event and expansion probes. No reachable new syntax/projection exception was found with valid native inputs and sufficient resources. Internal formatting/alignment assertions are excluded by the actual builder/caller invariants, not by treating TypeScript declarations as runtime guards.

A native preparation with user source text and draft @!1[0:0]@, @!1[4:1]@, @!1[999:]@ or @!@ reaches empty-body fallback. This disproves unconditional no-new-fallback, but is not a thrown exception or a violation of the existing slice semantics. Preserve the empty-summary protection: replacing it with a success notice would save no useful summary. No code fix was warranted.

A 4,096-character source and a 256-character repeated-reference draft produced 262,144 output characters. This establishes allocation amplification, not an observed crash. Slices also allocate the full selected source/range as code points. No OOM test was attempted; no unapproved cap, estimate or truncation was added. The review found obsolete disabled/dormant claims in the design docs; those were corrected to the active state. Full review transcripts and raw execution logs remain local, outside the distributable feature.

## No-extra-estimation core/facade gate

The facade has no estimator imports/calls or model/contextWindow argument. Source presence selects the annotated prompt; absence selects the byte-identical native ordinary prompt. It constructs only that selected candidate, filters once and reads tasks once. The original `Math.floor(0.8 * reserveTokens)` is solely a model generation option, not an expanded-text budget.

Finalization expands/decodes once, checks only the resulting body for blankness before metadata, and appends the suffix once. No input-fit veto, output-estimate veto, alternate cap/truncation/retry/fallback or new diagnostic system is added. A reserve of 10 still annotates large input, returns maxTokens 8, and preserves long free prose and short references expanding far beyond that number, including whitespace and suffix literals. Unknown `@!999999@` retains the nonempty neutral diagnostic. No-source OFF, empty-body handling, two rounds, independent snapshots and native ordering/literal behavior remain covered.

Current targeted tests: **38/38 pass** (25 unchanged core, 12 updated facade/loader, one unchanged original-context regression). The 11 runtime integration tests now join these 38 cases in the 49-test reactivation gate. Scoped strict TypeScript passes with the existing approved source/built API boundaries; no type/config migration or new fixture cast was needed. The narrowly scoped test-only loader and native bridge are unchanged: the bridge still exports the real estimator for historical runtime tests, but the current facade neither imports nor invokes it. No fake estimator exists.

Run from repository root:

```bash
node --import tsx --import ./my-plugins/oh-my-pi-v2/test/prepare-compaction-request-loader.mjs --test my-plugins/oh-my-pi-v2/test/compaction-reference-*.test.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.test.ts my-plugins/oh-my-pi-v2/test/custom-compaction.test.ts
node node_modules/typescript/bin/tsc -p my-plugins/oh-my-pi-v2/tsconfig.compaction-references.json
node node_modules/@biomejs/biome/bin/biome check --config-path my-plugins/oh-my-pi-v2/biome.compaction-references.json my-plugins/oh-my-pi-v2/hooks/compaction-reference-*.ts my-plugins/oh-my-pi-v2/hooks/annotate-compaction-references.ts my-plugins/oh-my-pi-v2/hooks/prepare-compaction-request.ts my-plugins/oh-my-pi-v2/test/compaction-reference-*.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.mjs my-plugins/oh-my-pi-v2/test/custom-compaction*.ts my-plugins/oh-my-pi-v2/test/custom-compaction-runtime-loader.mjs my-plugins/oh-my-pi-v2/tsconfig.compaction-references.json my-plugins/oh-my-pi-v2/biome.compaction-references.json
npm run check
git diff --check -- my-plugins/oh-my-pi-v2
```

Current validation: scoped Biome checks **28 files**, no fixes or diagnostics. The facade is **99 nonblank/noncomment lines**; changed test/support files are 151, 138, 59 and 25 lines, all below 200. `npm run check` ran with full output: root Biome checked 1,290 files without fixes; dependency/import/entry/shrinkwrap/install-lock gates passed. It stopped at the same **810** official model-catalog diagnostics, not a green root check; browser smoke was not reached. Diagnostic and continuation lines match `my-plugins/impression/docs/audit/source-references-20260914/root-check-final.log` byte-for-byte (joined with LF, no final LF), SHA-256 `dd71178d9f960ed017b808b054b3b3869299b6b4c9fbc74f3ea42470eb8a7b02`.

The preceding 38-test correction changed only the facade and its four directly affected test/fixture files. This reactivation additionally changes the handler and two obsolete budget tests; core helpers/tests, original-context regression and loaders remain unchanged. `git diff --check` and direct untracked whitespace/final-newline checks pass. HEAD remains `c7c2fe27617b369e3eed9360cb540f5ed0265cb9` on main; staged diff SHA-256 remains `98cad3272f6d05411851491e3f90e6e8045a278f70907f9f3773b315922d92e7`. Only the approved handler wiring was applied in production. No official/dependency/root-config change, automatic reload, provider call, audit, staging or commit occurred.

## Historical investigation and integration record

Everything below describes the withdrawn estimated-budget implementation, not current facade semantics or activation authority. Historical proposals for additional diagnostics are not part of this correction. See integration-plan.md for the current active API and applied two-line preparation / one-line finalization boundary.

### Live failure investigation

The parent session's user failure report is entry `0b6a26a7` at `2026-09-17T10:59:28.288Z`. The inspected session/capture locations did not contain the failed request/raw response or a subsequent persisted built-in compaction. The earlier compaction entry `e247fb8e` at `10:20:52.532Z` is not the failed response or a following fallback. Therefore no exact rejection branch or deterministic replay is established.

`finalizeSummary` merged blank extracted draft, blank expanded body and ON expanded-output overflow into the same empty-string result/log. Unknown IDs instead yield a nonempty diagnostic. Synthetic rejection tests verify those mechanics, not which condition occurred in the live call. A minimal future diagnostic change should distinguish rejection reason and safe lengths/budget/stop reason; it is not yet implemented or permission to reactivate the feature.

## Historical integration gates

Run from repository root:

```bash
node --import tsx --import ./my-plugins/oh-my-pi-v2/test/prepare-compaction-request-loader.mjs --import ./my-plugins/oh-my-pi-v2/test/custom-compaction-runtime-loader.mjs --test my-plugins/oh-my-pi-v2/test/custom-compaction*.test.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.test.ts my-plugins/oh-my-pi-v2/test/compaction-reference-*.test.ts
node node_modules/typescript/bin/tsc -p my-plugins/oh-my-pi-v2/tsconfig.compaction-references.json
node node_modules/@biomejs/biome/bin/biome check --config-path my-plugins/oh-my-pi-v2/biome.compaction-references.json my-plugins/oh-my-pi-v2/hooks/compaction-reference-*.ts my-plugins/oh-my-pi-v2/hooks/annotate-compaction-references.ts my-plugins/oh-my-pi-v2/hooks/prepare-compaction-request.ts my-plugins/oh-my-pi-v2/test/compaction-reference-*.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.mjs my-plugins/oh-my-pi-v2/test/custom-compaction*.ts my-plugins/oh-my-pi-v2/test/custom-compaction-runtime-loader.mjs my-plugins/oh-my-pi-v2/tsconfig.compaction-references.json my-plugins/oh-my-pi-v2/biome.compaction-references.json
set -o pipefail
node node_modules/@biomejs/biome/bin/biome check --write --stdin-file-path=packages/coding-agent/src/custom-compaction.ts < my-plugins/oh-my-pi-v2/hooks/custom-compaction.ts | cmp - my-plugins/oh-my-pi-v2/hooks/custom-compaction.ts
npm run check
git diff --check -- my-plugins/oh-my-pi-v2
```

The scoped formatter checks 28 files. The handler additionally passes the real root formatter/linter through stdin with byte-identical output (120 columns, tab width 3); `--write` here emits to stdout, never writes an official file. This avoids reformatting the old handler or audited core under a different scoped formatter configuration. Its preparation/finalization remain two/one lines. Every new test/support file is under 200 nonblank/noncomment lines.

The original 38 tests also pass with the original facade loader alone, without the new handler completion redirect. Generated reconstruction, slice and native serializer parity tests remain unchanged. The existing context regression now asserts that its known input message has `content` before serialization, so its source-backed AgentMessage union is checked rather than narrowed by a cast.

## Exact runtime test boundary

Unisolated repository tsx startup resolves the public coding-agent aggregate to source and reaches missing `packages/ai/src/providers/data/amazon-bedrock.json` before tests execute. No official artifacts were repaired; this is not evidence of a separately installed package failure.

The existing `prepare-compaction-request-loader.mjs` retains exactly two redirects:

1. Bare coding-agent package to a bridge re-exporting actual source convertToLlm, serializeConversation and estimateTokens. The complete real estimator module is unchanged, not extracted or copied.
2. ai/compat only from that exact native compaction.ts URL to a fail-fast completeSimple guard. Core/facade/handler operations assert zero guard calls; a separate deliberate test proves it throws.

The additional `custom-compaction-runtime-loader.mjs` redirects bare pi-ai ONLY from the exact custom-compaction.ts parent URL to a controlled completion stub. Tests capture the callback registered by the real registerCustomCompaction and call it with offline context/auth/UI fixtures. The real facade, formatter, filter, converter, serializer, estimator and codec execute; no rewritten handler or production DI was introduced. The fake completion is not live provider success and uses no real key/network.

## Exact type-check boundary

The existing scoped paths still resolve actual source ai message/model types, contentText/StringEnum, agent types and telemetry. The unchanged handler imports completeSimple from the public built API; current repository source has moved it to /compat. With supervisor approval, the type-only bridge additionally re-exports the actual existing `packages/ai/dist/stream.js` completeSimple declaration and its matching `dist/types.js` SimpleStreamOptions. Pairing them avoids mixing the newer source `reasoning: "max"` union into the older built call signature. Remaining source types are unchanged.

The completion stub uses that actual built function type and naturally successful `stopReason: "stop"` fixtures, not arbitrary casts. The fixture's result type comes directly from the actual existing coding-agent dist extension declaration because it is not re-exported at the package root. No signatures are copied, diagnostics ignored or production imports migrated. Validation therefore covers source-backed core/facade plus the handler's existing built call boundary, NOT current source-root completion exports, arbitrary releases, aggregate startup or deployed compatibility.

## Handler coverage

- One system prompt plus one user message; current model, auth headers/key, signal, maxTokens and reasoning pass unchanged.
- Actual source scope/filtering, one task read, no duplicate catalog, turn-prefix exclusion, unindexed assistant/tool/custom/mixed content retained.
- First/update ON; native no-source and complete-input-overflow OFF parity.
- Expanded returned text and boundary/token fields, no reference details; file suffix once after expansion and never rescanned.
- Unknown/malformed diagnostics, literal restoration, blank/non-text/terminator/empty-slice/output-overflow fallback.
- No model, auth denial/auth throw, completion throw/abort, task-preparation throw, status start/cleanup failure; existing cleanup and undefined fallback.
- Two rounds use only previously expanded summary/current messages, no IDs or historical lookup.

## Core invariants and limits

Summary chunks reconstruct the body; body+suffix reconstructs the previous summary. Dense labels occupy original positions with per-document terminators. Eligible user text matches native projection; ranges stay in one document. Escaping/decoding is single-pass, raw insertions are not scanned, and arbitrary invalid model syntax yields fixed ID-free diagnostics. State stays call-local.

Malformed scanning is linear in draft size. Resolution/slicing also visits all selected raw text, including text later discarded by slices; cost is not bounded by final output length alone. Allocation failure, terminal suffix provenance ambiguity, model-selection quality and exact provider token counts remain outside guarantees.

## Root and safety evidence

`npm run check` ran with full output: root formatting checked 1,290 files without fixes; dependency/import/entry/shrinkwrap/install-lock gates pass. It exits at tsgo with the same **810** existing official model-catalog diagnostics; browser smoke is not reached. Diagnostic plus continuation lines are byte-identical to the recorded baseline, SHA-256 `dd71178d9f960ed017b808b054b3b3869299b6b4c9fbc74f3ea42470eb8a7b02`. This is not a green full-repository check.

Only custom-compaction.ts changed in production. Three other protected runtime files, four audited core files and the facade match pre-integration hashes. Root staged SHA-256 remains `98cad3272f6d05411851491e3f90e6e8045a278f70907f9f3773b315922d92e7`; owned staged paths are empty. Direct scans cover untracked file whitespace/final newlines. No commit, push, dependency/official source change, self-reload or real provider call.

Historical integration evidence: `.pi/compact-reference-integration-evidence.json` and `.pi/compact-reference-integration-root-check.log`. Audit reports are untouched. That live trial did not pass, the wiring was withdrawn and the user confirmed reload of the original handler. The precise failed response remains unavailable; offline agreement did not establish live acceptance.
