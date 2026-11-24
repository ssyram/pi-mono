# Round 005 final counter-challenge — F01/F02

## Review

- Note: The requested root `plan.md` does not exist. The requested root `progress.md` only says `Status: In Progress` and contains no finding text. Per instruction, I did not read any file under `docs/audit`; verdicts below use the finding summaries in the task plus production code, non-audit design documents, and tests.
- Correct: Focused verification passed: `node --test --import tsx my-plugins/codex-viewport/inline-entry.test.ts my-plugins/codex-viewport/demand-driven-runtime.test.ts my-plugins/codex-viewport/native-handoff.test.ts` — 10 tests, 3 suites, 0 failures.

## F01 — CONFIRMED

The implementation fact could not be disproved: ordinary content overflow grows only downward and then crops the live tail. The stronger claim that upward-on-overflow behavior is unambiguously required is not proven because the non-audit specifications conflict.

### Source proof

- `live-region-growth.ts:9-15` computes only `downwardGrowth = min(overflowRows, terminalHeight - bottom)`, increases `bottom`, and calls `buildViewportExpansion(area.top, area.top)`. It never decreases `top`.
- `managed-renderer.ts:95-123` routes ordinary desired-height overflow exclusively through `planLiveRegionGrowth(...)` and persists `growth.area`.
- `volatile-region.ts:26-43` takes `sections.live` with `takeTail(...)`, so content beyond the fixed capacity loses its oldest visible pending rows rather than expanding the area upward.
- `managed-height-rebase.ts:3-8` can decrease `top` only while rebasing terminal height/mandatory rows. That is a resize/pressure path, not ordinary live-content overflow.
- `viewport-expansion.ts:7-17` still implements upward expansion bytes, but the live-growth caller always supplies identical current/next tops, making that branch unreachable from ordinary growth.

### Specification result

- `README.md:19-26` and `docs/design/known-state.md` §KS-3 specify downward growth followed by cropping the pending-view top at terminal bottom. Current code matches these.
- `docs/design/detail/managed-renderer.md` §Render says `plan downward-first / upward-on-overflow growth`.
- `docs/design/fixes/demand-driven-live-region.md` §4 likewise says overflow first raises `bottom`, then lowers `top` after reaching terminal bottom.

Therefore F01 is confirmed as implementation/specification drift, but not as an unqualified runtime defect until the conflicting growth contract is resolved. The final counterexample attempt fails because no ordinary-overflow call site can request `nextTop < currentTop`.

### Concrete test

The existing tests directly exercise the reachable behavior:

- `inline-entry.test.ts:15-22`: starting at `[top=10,bottom=20)` in a 24-row terminal with six overflow rows yields `[10,24)`, zero expansion bytes, and zero displaced stable rows.
- `demand-driven-runtime.test.ts`, test `grows downward then crops live overflow without scrolling stable rows`: verifies runtime overflow emits neither scroll-region bytes nor CRLF scrolling.

Both passed in the focused run. A decisive contract regression should additionally assert the intended post-bottom behavior: either `top` decreases by one (upward-growth contract) or `top` remains fixed while the oldest live row disappears (crop contract). Both cannot be authoritative.

## F02 — DISPUTED

The broad finding is not valid as a general origin-arithmetic bug. Entry does use physical origin consistently, and immediate re-entry after a successful plugin handoff has `originRow = 0` by construction. A narrower seamless-handoff liveness limitation is confirmed for positive inline origins, preserved native viewport tops that do not match the logical-tail projection, and displaced-entry-tail clearance.

### Exact entry arithmetic

Let:

- `H = terminal height`
- `O = originRow`
- `P = previousViewportTop`
- `S = stableEnd`
- `d = S - P`

`native-entry-baseline.ts:36-65` computes:

```text
naturalTop         = clamp(O + d, 0, H - 1)
availableStableRows = max(0, d)
stableRowsKnown     = naturalTop == 0 || availableStableRows >= naturalTop
```

Thus stable rows are unknown exactly when:

```text
clamp(O + d, 0, H - 1) > max(0, d)
```

Reachable subcases:

- If `0 < O + d < H - 1`, the predicate fails exactly when `O > 0`.
- If `O + d <= 0`, `naturalTop = 0` and it passes.
- If `O + d >= H - 1`, it passes exactly when `d >= H - 1`; otherwise it fails.
- With the ordinary `O = 0`, `d >= 0` case, `naturalTop` and available stable rows agree (up to the terminal clamp). There is no general missing-origin error.

A positive origin is reachable on initial/native inline entry: `O` is recovered from the DSR physical cursor and Pi’s logical hardware-cursor projection. Rows above Pi’s inline origin are not represented in `previousLines`, so treating them as unattested and refusing seamless handoff is conservative. It causes fallback/repaint liveness loss, not unsafe handoff.

### Preserved Pi top versus handoff tail projection

`native-handoff.ts:26-30` chooses:

```text
Q = viewportTop = max(0, nativeLines.length - H)
```

and `native-handoff.ts:46-52` stores `Q` as Pi’s new `previousViewportTop`.

For a native logical cursor row `C`, managed physical cursor row is `O + C - P`; the handoff’s projected native cursor row is `C - Q`. The cursor predicate can pass only when:

```text
C - Q = O + C - P
Q = P - O
```

Visible-row equality and stable-row attestation must also pass. Consequently:

- A nonzero projected top is reachable exactly when `nativeLines.length > H`.
- Pi may preserve an older `P` during incremental rendering rather than recomputing the tail.
- Reprojection is seamless only if the new logical tail `Q` equals `P - O` and the projected bytes match the physical frame. Otherwise handoff rejects and native recovery redraws.
- Synthetic/short-tail slack (`nativeLines.length <= H`, hence `Q = 0`) can pass cursor alignment only when `P = O`, again subject to full byte equality and stable-row attestation.

After a successful plugin handoff, the code stores `P = Q` and `hardwareCursorRow = Q + managedCursorRow` (`native-handoff.ts:46-52`). The next DSR reports `managedCursorRow`, so immediate re-entry computes:

```text
O = managedCursorRow - ((Q + managedCursorRow) - Q) = 0
```

That directly disproves a claim that plugin handoff itself generically creates a positive-origin arithmetic mismatch.

### Displaced-tail liveness

`native-handoff.ts:18-25` rejects only when all of these are true:

```text
displacedEntryRows > 0
finalizedRowsSinceEntry < displacedEntryRows + H
```

Ordinary live growth cannot create displacement because it never lowers `top`. Displacement remains reachable through terminal-height/mandatory-row rebasing (`managed-height-rebase.ts:3-8`, with accumulation in `managed-renderer.ts:95-123`). For `D = 1` and `H = 24`, `F = 24` rejects and the first arithmetically eligible value is `F = 25`. Eligibility still does not imply success; stable-row, visible-byte, image, and cursor predicates remain mandatory.

### Concrete tests

Existing boundary coverage passed:

- `native-handoff.test.ts:42-49` uses `D=1`, `H=24`, `F=24` and confirms rejection for possible entry-row provenance.
- `native-handoff.test.ts:35-39` confirms a successful zero-top handoff, but does not cover nonzero `Q`.

The missing focused regressions should use these exact fixtures:

1. Entry origin boundary: `H=24, P=0, S=2`. Assert `O=0 => naturalTop=2, available=2, known=true`; assert `O=3 => naturalTop=5, available=2, known=false`.
2. Nonzero logical-tail handoff: `H=4`, six native lines, matching four-row physical tail and matching cursor. Assert seamless handoff stores `previousViewportTop=2`.
3. Preserved-top mismatch: construct physical state from `P,O` but native tail `Q != P-O`; assert rejection by cursor or visible-byte mismatch, not silent priming.
4. Displacement boundary: hold all other predicates equal and compare `D=1,H=24,F=24` (reject) with `F=25` (tail-liveness guard clears).

### Final disposition

F02 is **DISPUTED** as a general correctness defect: origin participates in entry projection, successful plugin handoff makes immediate re-entry origin zero, and mismatched preserved-top/tail projections are guarded. The narrower claim is **CONFIRMED** as liveness risk: positive-origin native entry generally cannot attest the entire stable prefix, and displaced rows require the exact `D + H` finalized-row threshold before seamless handoff is even eligible.
