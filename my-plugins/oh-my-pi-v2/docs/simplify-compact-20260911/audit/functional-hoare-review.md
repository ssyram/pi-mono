# Functional Hoare Review — compact file-list candidate

## Verdict

**PASS.** No BLOCK finding: the dormant implementations A/C satisfy the explicitly written design P/Q, and the future-only `candidate.patch` preserves the documented integration boundary. No finding below relies on a stronger, invented contract.

## Scope and evidence read

Fully read:

- No `AGENTS` / `AGENTS.md` exists under the repository search scope.
- `docs/simplify-compact-20260911/{README,design,code-plan,correctness,verification}.md`.
- `docs/simplify-compact-20260911/candidate.patch` (future-only, unapplied).
- Dormant hooks A/C: `hooks/format-compaction-path-list.ts`, `hooks/compact-compaction-file-suffix.ts`.
- Existing boundary files: `hooks/compaction-file-operations.ts`, `hooks/prepare-compaction-request.ts`, `hooks/custom-compaction.ts`, `hooks/compaction-reference-state.ts`, `hooks/annotate-compaction-references.ts`, `hooks/compaction-reference-codec.ts`.
- Direct tests: `test/format-compaction-path-list.test.ts`, `test/compact-compaction-file-suffix.test.ts`.

No other audit report was read. The requested `/hoare-prompt` is not installed as a loadable prompt; the review follows the supplied `correctness.md` proof skeleton and the task's requested WP/SP obligations.

## Contract sources and notation

The normative sources are `design.md` §§2–4, constrained by `README.md`, `code-plan.md`, `correctness.md`, and `verification.md`; implementation intuition was not elevated into a requirement.

Let `L0` be the input array and `B = L0.join("\n")`.

### A — `formatCompactionPathList`

**P-A** (`design.md` §2): caller supplies a `readonly string[]` from the existing internal set-to-array flow and the existing baseline `join` completes. No existence/platform-path property is required.

**Q-A** (`design.md` §2): result is exactly `B`, or a display representation whose raw/group lines expand in order to exactly `L0`; `L0` is not mutated and `result.length <= B.length`. Recoverable formatting exceptions return already-built `B`.

### C — `compactCompactionFileSuffix`

**P-C** (`design.md` §3): input is the pre-separated `CompactionReferenceState.fileSuffix`; that is a syntax/terminal-boundary convention, not a provenance certificate and not a path-validity assertion.

**Q-C** (`design.md` §3): result is unchanged suffix, or a strictly shorter suffix comprising the same valid, ordered `read-files` then `modified-files` sections, each section either original or A-formatted. A valid C input has zero to two nonempty sections, exact delimiters, and complete consumption. Structural failure, no overall benefit, or recoverable C exception returns the original suffix.

## A CFG, SP, and WP proof

Source: `hooks/format-compaction-path-list.ts:6-53`.

### Entry, branches, and catch boundary

1. `baseline = paths.join("\n")` occurs before `try`. Under P-A it completes and establishes `baseline = B`; it is the only value used by every fallback.
2. `paths.length < 2` returns `B`, directly Q-A.
3. In the parse-loop branch, `parseSafePath(path) === undefined` returns `B`, directly Q-A. Its checks reject a one-component path, empty/dot components, non-ASCII-safe bytes, braces, commas, XML, whitespace, CR/LF, backslash/UNC, drive colon, repeated and trailing slash. A successful entry has `parent + "/" + leaf === path` and safe nonempty components.
4. Post-loop run construction yields only raw path runs or a same-parent `parent/{leaf,...}` group. The latter is selected only if shorter than the raw run.
5. The final conditional is `compacted.length < baseline.length ? compacted : baseline`.
6. Any ordinary exception inside `try` returns the already-established `baseline`. This is deliberately not claimed for baseline `join`, OOM, module loading, VM termination, or adversarial non-P-A runtime objects.

### Parse loop: `for (const path of paths)`

**Initialization SP.** Before iteration `i=0`, `entries=[]`; no array element was written. Thus `entries` is the exact parsed prefix for `L0[0:0)`.

**Inductive invariant/SP at the head of iteration `i`.** `0 <= i <= L0.length`; `entries.length===i`; for every `j<i`, `entries[j]` is the unique safe `{parent,leaf}` decomposition of `L0[j]`; if any earlier element was unsafe, the function has already returned `B`; `L0` is unchanged.

**Three unroll patterns.**

1. At `i=0`, an unsafe first path takes the immediate baseline-return branch; a safe first path appends precisely its decomposition and establishes the invariant for `i=1`.
2. At an interior `0<i<n-1`, an unsafe path likewise immediately preserves Q-A by fallback; a safe path appends exactly once, retaining correspondence/order for `i+1`.
3. At `i=n-1`, safe parsing gives `entries.length=n` with pointwise correspondence; unsafe parsing returns `B`. No branch can skip, sort, deduplicate, or write an input element.

**Maintenance.** `parseSafePath` is pure and `push` adds one local element after a successful parse, so the invariant advances by one. No mutation of `paths` is performed.

**Termination.** The implicit counter has variant `L0.length-i`, decreasing by one per successful iteration; an unsafe exit already proves Q-A. Normal exit establishes `entries.length===L0.length` and safe, position-preserving entries.

### Run loop: `while (start < entries.length)`

**Initialization SP.** After parse-loop normal exit, `start=0`, `lines=[]`, and `entries` corresponds pointwise to `L0`; the required prefix is empty.

**Head invariant/SP.** `0 <= start <= entries.length`; expanding `lines` equals exactly `L0[0:start)` in order including duplicates; every line represents either one raw input element or a contiguous same-parent run; `L0` and `entries` are unchanged.

**Three unroll patterns.**

1. First run (`start=0`): inner scan locates the first maximal same-parent segment; a singleton remains raw, and a longer segment is grouped only if strictly shorter. The represented prefix becomes `L0[0:end)`.
2. A following run with a different parent starts exactly at the prior `end`; no cross-parent merge is possible because the scan equality is against `first.parent`. Its raw/group decision advances the prefix without reordering.
3. A later run with the same parent as an earlier nonadjacent run is still separate: `start` begins after an intervening parent, so the scan cannot reach back. Repeated leaves in one run remain repeated in `leaves.map`, hence expansion preserves multiplicity.

**Maintenance and termination.** After `lines.push(line)`, assigning `start=end` preserves the invariant. The inner scan starts at `start+1`, hence `end>old(start)` and variant `entries.length-start` strictly decreases. Exit has `start=entries.length`, so `lines` expands to all `L0`.

### Inner same-parent scan: `while (end < entries.length && entries[end].parent === first.parent)`

**Initialization SP.** `end=start+1`; `[start,end)` contains `first` and every element in it has `first.parent`.

**Three unroll patterns.**

1. Immediate mismatch/boundary: the loop executes zero times and `[start,start+1)` is the maximal singleton run.
2. One matching successor: increment produces a two-entry prefix of the same-parent run.
3. Two or more matching successors: each increment extends that prefix by exactly one adjacent element; the first mismatch or bound stops it. This is exactly the maximal contiguous run, not a global parent group.

**Maintenance/termination.** Each iteration increments `end` by one while the equality premise holds. Variant `entries.length-end` strictly decreases; at exit either `end===entries.length` or the next parent differs. Thus the outer loop's raw slice and optional grouped leaves denote exactly `[start,end)`.

### Final conditional WP substitution

At this point the strongest postcondition is: `compacted = lines.join("\n")` expands to `L0`, preserves order and duplicates, and is built from safe raw/group lines. For

`return compacted.length < baseline.length ? compacted : baseline`,

substitution gives:

- true branch WP: `compacted` has the stated expansion property and `compacted.length < B.length`; therefore Q-A;
- false branch WP: `baseline=B`, so Q-A and length equality;
- the ternary covers all boolean outcomes, hence `result.length<=B.length`.

The grouped-per-run strict check is compatible with, but not needed to strengthen, final Q-A; the final strict check prevents a non-growing overall result from being emitted.

## C CFG, SP, and fixed two-iteration proof

Source: `hooks/compact-compaction-file-suffix.ts:1-31`.

**Initialization SP.** Before `for (const tag of suffixTags)`, `offset=0`, `sections=[]`; the consumed prefix is empty and no input character has been rewritten.

The loop has exactly two iterations in fixed order: `read-files`, then `modified-files`. At the head for tag index `k`, `sections` is the exact reassembly of a fully parsed optional prefix of the first `k` tags, `offset` is its first unconsumed index, and the remaining suffix has not been inspected/reordered into output.

### Iteration 1: `read-files`

- **No opening delimiter at offset:** `continue`; `offset` and `sections` remain the valid empty parsed prefix. A later `modified-files` may be accepted.
- **Opening delimiter but no nonempty close:** `closeIndex <= contentStart`, so return original `suffix`; Q-C fallback.
- **Valid nonempty read section:** `content.split("\n")` is sent to A. A returns baseline or valid shorter section; C reassembles exactly `open + formatted + close`, appends it, and moves `offset` to immediately after close. Tags and position are preserved.

### Iteration 2: `modified-files`

- **No opening delimiter at current offset:** `continue`. If read was accepted, final complete-consumption test detects leftover/nonmatching text unless it was exactly consumed; if neither was accepted, `sections.length===0` falls back.
- **Opening delimiter but empty/missing close:** immediate original-suffix fallback.
- **Valid nonempty modified section:** identical local proof; it can coexist after read only at the current `offset`. A duplicate read, reversed order, unknown tag, extra trailing bytes, or arbitrary text cannot be consumed and fails later `offset !== suffix.length`.

**After the fixed loop.** The loop terminates by fixed cardinality two, not by input-dependent iteration. `sections.length===0`, incomplete consumption, or non-strict `compacted.length` returns original input. Otherwise `sections.join("")` preserves section order/tags and returns only when strictly shorter. This proves Q-C's all-or-nothing C choice while retaining A's per-section fallback: an unsafe/nonbeneficial read is emitted raw by A while a safe modified sibling can create whole-suffix benefit.

**Catch boundary.** All parsing, splitting, A calls, joins, and comparison are inside `try`; recoverable exceptions return original suffix. As specified, this does not establish provenance, protect against baseline-join failure inside A's pre-try code, or cover OOM/module/VM failure.

## Required property checks

| Property | Result and evidence |
|---|---|
| Input immutability | PASS. A only reads `paths`, allocates locals, and direct test freezes input. C only slices/splits a primitive string. |
| Order and duplicates | PASS. A run slices and leaf-maps in index order; no set/sort in A. Test includes duplicate `delta-file.ts` and nonadjacent repeated parent. |
| Adjacent same-parent only | PASS. Inner scan stops on first unequal parent; separate later runs cannot merge. |
| Strict non-growth | PASS. A emits `compacted` only under `< baseline.length`; C emits only under `< suffix.length`. |
| Unsafe all-list fallback in A | PASS. Any failed parse immediately returns entire prebuilt baseline, rather than mixed formatting. |
| Per-section fallback / overall benefit in C | PASS. A may leave one section raw; C returns reconstructed suffix only if the total is strictly shorter. |
| Complete C consumption | PASS. `offset !== suffix.length` rejects unknown, duplicate, reversed, nonterminal, and trailing data. |
| Catch boundary | PASS within stated scope. Both catch only recoverable work after their respective baseline/original input is available. |

## Cross-boundary result

- Current `hooks/` has **no import** from either dormant module; their only live imports are direct tests. Thus first-stage A/C do not alter current compaction behavior.
- `hooks/custom-compaction.ts` SHA-256 was `52569010d97ebfeb21fa6b32ff7d6a8e7f1359886e5633e0c0f34927cf6d7619` before and after review commands: entry unchanged.
- `candidate.patch` is unapplied and `git apply --check --whitespace=error-all` succeeds. Its verified numstat is exactly `+13/-3` (`+8/-2` in `compaction-file-operations.ts`, `+5/-1` in `prepare-compaction-request.ts`).
- Candidate B changes only the two already sorted list renderings after existing extraction, `read - modified` classification, and tags. Candidate D computes a display-only spread state only for `referencesEnabled && previousSummary`; serializer, codec, original state passed to `expandCompactionReferences`, and closure-captured current `fileSuffix` for one final append remain unchanged. OFF prompt receives the original parameters unchanged.

## Findings

No blocker finding. The following are residual boundaries, explicitly permitted by the design and therefore not defects:

1. **Brace collision/model ambiguity:** a raw unsafe brace filename can textually collide with a safe group representation. It is rejected by A and causes baseline fallback, but the contract does not promise globally unique decoding or model-semantic equivalence.
2. **Syntax-only provenance:** `summaryBodyEnd()` identifies a terminal grammar boundary; it does not authenticate OMP origin. C's full-suffix consumption does not extend to full-summary provenance, nested/forged terminal material, or history migration.
3. **Baseline and process failures:** P-A requires baseline `join`; no claim covers OOM, module loading, VM termination, or arbitrary hostile Proxy behavior outside the documented boundary.
4. **Unapplied behavior:** direct A/C verification does not prove future facade behavior, provider/token/cache/latency effects, or model interpretation. The documented post-approval integration regressions remain necessary.
5. **Strict TypeScript gate:** attempted strict typecheck fails in unrelated monorepo files/packages; its diagnostic output contains no reviewed A/C/candidate target path. This is environmental/baseline evidence, not a contract violation in the unapplied candidate.
6. **Existing staging:** the repository already has staged unrelated paths and additional workspace changes. This review did not stage, unstage, commit, reload, or modify project source files.

## Commands and results

| Command | Result |
|---|---|
| `node --import tsx --test my-plugins/oh-my-pi-v2/test/format-compaction-path-list.test.ts` | PASS: 4/4 tests. |
| `node --import tsx --test my-plugins/oh-my-pi-v2/test/compact-compaction-file-suffix.test.ts` | PASS: 4/4 tests. |
| `cd my-plugins/oh-my-pi-v2 && npx tsc --noEmit --strict` | FAIL: exit 2 from existing unrelated monorepo diagnostics (including `packages/ai/test`, `packages/coding-agent`, and `packages/tui/src/utils.ts`); no reviewed target path reported. |
| `git apply --check --whitespace=error-all my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch` | PASS. |
| `git apply --numstat my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch` | PASS: `8 2` and `5 1`; total `+13/-3`. |
| `git grep -nE 'from "\\./(format-compaction-path-list|compact-compaction-file-suffix)\\.js"' -- hooks` | PASS (no output): no current hooks runtime import. |
| `sha256sum hooks/custom-compaction.ts` (before/after) | PASS: identical hash listed above. |

No full-repository write check was run. No patch was applied.

## Uncovered items

- The candidate remains future-only/unapplied; real integration behavior cannot be claimed until renewed approval and a separate post-application review.
- Provider/model execution, token economics, caches, latency, and model disambiguation are explicitly outside the design contract and were not exercised.
- Repository-wide strict typecheck is not green for unrelated baseline errors, so it cannot furnish a clean full-workspace gate in this shared state.
