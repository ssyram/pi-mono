# Round 005 counter-challenge: F11/F12

## Review

- Note: repository-root `plan.md` was absent. `progress.md` contained only an empty in-progress template, so neither supplied additional requirements or evidence.
- Note: this was review-only. No production or test files were changed, and no tests were run.

## Verdict summary

| Subclaim | Verdict | Production reachability / specification scope | Action |
|---|---|---|---|
| F11.1a accepts `cursor.column === area.width` | **CONFIRMED** | Reachable through Pi cursor-marker extraction on a width-filled line; the resulting terminal column is outside the zero-based cell range | **Code fix** |
| F11.1b accepts fractional or non-finite cursor coordinates | **REJECTED** as a production defect | The internal constructor is weak, but the inspected production source is Pi's extracted row/visible-column position; no production producer of fractional/`NaN` coordinates was shown | **Nit** |
| F11.2 `diffInlineViewport` omits previous-only rows | **CONFIRMED** at helper/spec level; **REJECTED** as a demonstrated normal-path screen corruption | The helper and its written contract allow changing top/bottom, but the normal same-height renderer only grows downward. Height shrink removes the omitted absolute rows from the terminal | **Code fix** to honor the helper contract, or explicitly narrow the helper contract; not a current release blocker on reachability evidence |
| F11.3 short-bottom handoff can falsely attest an arbitrary stale row below `bottom` | **DISPUTED** | The code assumes rather than reads the bottom tail, but no invariant-preserving production path to the proposed stale `SENTINEL` was established. Such a path must satisfy native-entry provenance and exclusive-writer assumptions | **Spec boundary** until reachability is demonstrated; fallback-on-short-bottom would be defensive hardening |
| F12.1 `Terminal.write(): void` cannot acknowledge atomic physical delivery | **CONFIRMED** | Directly reachable on every render and replay write | **Spec boundary** |
| F12.2 a thrown/failed write may leave a physical prefix while logical state is not accepted | **CONFIRMED** | Synchronous throw cancels logical preparation, but emitted terminal bytes cannot be rolled back | **Spec boundary**, not a routine rollback code fix |
| F12.3 current specifications promise physical rollback or unconditional native equivalence | **REJECTED** | The inspected design explicitly excludes rollback and physical atomic-commit confirmation | No action beyond keeping the boundary explicit |

## F11.1 — cursor bounds

### F11.1a: horizontal upper bound

**CONFIRMED.** `createInlineViewportFrame` rejects a negative column but has no `cursor.column >= area.width` check (`inline-viewport-frame.ts:15-25`). The frame contract says the cursor is area-relative and in bounds (`docs/design/detail/physical-frame.md`, “InlineViewportFrame”), so valid zero-based columns are `0..area.width - 1`.

This is not only a hostile direct-helper input. `normalizeViewportLines` forwards Pi's extracted cursor column into the frame (`render-pi-lines.ts:24-34`), and Pi extracts the marker after counting the visible prefix (`packages/tui/src/tui.ts:1236-1252`). A marker after exactly `width` visible cells therefore yields `column === width`; line normalization permits a line whose visible width equals `width`. `buildCursorPlacement` then converts that to a one-based CUP column of `width + 1` (`cursor-placement.ts:4-9`).

**Test:** add a production-path case whose width is `10`, whose cursor marker follows ten visible cells, and assert frame construction/fallback rejects column `10`. Also retain direct constructor boundary cases for columns `9` and `10`.

**Action:** code fix. Enforce an integer row/column and `cursor.column < area.width` at frame construction or reject the extracted cursor before constructing the frame.

### F11.1b: fractional and `NaN` coordinates

**REJECTED as a production defect.** The constructor indeed accepts them, but all inspected production callers obtain the cursor from Pi's line/marker extraction, not arbitrary external numeric input. No fractional or non-finite producer was identified. This is a defensive invariant weakness, not demonstrated screen corruption.

**Test:** optional direct unit cases for fractional and non-finite row/column values.

**Action:** nit, naturally fixed if frame validation is tightened for F11.1a.

## F11.2 — previous-only rows in frame diffs

### Helper contract

**CONFIRMED.** `diffInlineViewport` iterates only `next.rows` (`screen-frame-diff.ts:7-16`). For example, previous area `[1,4)` with rows `A,B,C` and next area `[2,4)` with rows `B,C` compares only absolute rows 2 and 3 and emits no erasure for old absolute row 1. A shrinking-bottom example similarly leaves the old last row untouched.

That contradicts the written helper contract: top, bottom, and terminal height may change at equal width, and the diff is described as comparing the old and new areas by absolute row (`docs/design/detail/physical-frame.md`, “InlineViewportFrame”; `docs/design/proofs/hoare-render-transaction.md`, Frame lemma).

### Production reachability

**REJECTED as a demonstrated normal-path screen-corruption claim.** In a same-height epoch, `planLiveRegionGrowth` preserves `top` and only increases `bottom` (`live-region-growth.ts:10-16`). `rebaseManagedHeight` can lower `top` or reduce `bottom` only in response to a terminal-height reduction (`managed-height-rebase.ts:3-8`); previous-only bottom rows then lie outside the new terminal height. The inspected production path does not raise `top`, nor does it shrink `bottom` while those old rows remain addressable in an unchanged-height terminal.

This distinction matters: the helper is wrong for its documented general contract, but the supplied counterexample is not yet a reachable managed-render transition. A terminal-emulator-specific claim that rows removed by height shrink reappear stale after later growth would need its own portability contract and reproduction.

**Tests:**

1. Direct helper test: raised top must erase the previous-only top row.
2. Direct helper test: reduced bottom at unchanged terminal height must erase the previous-only bottom row.
3. Production renderer test: enumerate height rebase plus subsequent growth and assert no addressable stale row survives. This is the reachability guard; helper-only tests do not prove a production bug.

**Action:** code fix to make the helper satisfy its documented contract, or narrow the contract and reject unsupported transitions. Given the helper is small and already documented generally, erasing addressable previous-only rows is the cleaner hardening. Severity remains non-blocking absent a production transition.

## F11.3 — short-bottom physical attestation

**DISPUTED.** The strongest version of the finding is correct about observation but incomplete about reachability:

- `captureNativeEntryBaseline` constructs `visibleRows` from Pi's logical `previousLines`, substitutes `""` outside that range, and seeds only `[area.top, area.bottom)`; it does not read terminal cells below `naturalBottom` (`native-entry-baseline.ts:53-75`).
- `prepareNativeHandoff` compares through terminal height, but its `physicalVisible` value pads rows below `frame.area.bottom` with `""` (`native-handoff.ts:25-36`). Thus “full-height comparison” is not physical attestation of those rows.

However, a `SENTINEL` below `bottom` is not by itself a production counterexample. The entry proof assumes Pi's baseline describes terminal state (`docs/design/proofs/hoare-entry-baseline.md`), native differential rendering clears deleted rows tracked in `previousLines` (`packages/tui/src/tui.ts:1553-1569`), managed rendering grows the owned bottom rather than contracting it, and direct out-of-band stdout writers are outside the guarantee boundary (`docs/design/detail/managed-renderer.md`). The proposed stale row must therefore be produced while those ownership/provenance premises remain true. No such production sequence was established.

There is still a specification tension: `docs/design/detail/native-handoff.md` says a variable-bottom short frame is normally insufficient to prove the complete native tail and may require native recovery, while the implementation can return seamless by comparing two synthesized empty tails. That is a proof/precondition gap, not yet a confirmed user-visible defect.

**Tests:**

1. Keep the existing full-height bytes/cursor equality test (`native-handoff.test.ts`, “primes Pi only after full visible bytes and cursor match”).
2. A valid counterexample test must drive the real entry/render path and a VT emulator from a state allowed by the native-entry and exclusive-owner contracts, place a nonblank row below short `bottom` without an excluded direct writer, and then show `{ seamless: true }` while that row remains. Merely mutating emulator cells before calling `prepareNativeHandoff` does not establish production reachability.
3. If the intended contract is “short bottom is never attested,” add a test requiring non-seamless recovery whenever `frame.area.bottom < terminalHeight`.

**Action:** specification boundary. State explicitly whether blank rows below native `previousLines` are a required Pi-entry invariant. If they are not guaranteed, enforce native recovery for short-bottom handoff; if they are guaranteed, add the invariant to the entry/handoff proof and test it at the integration boundary.

## F12 — partial writes and rollback

### Delivery and logical commit

**CONFIRMED.** `ProcessTerminal.write(data: string): void` calls `process.stdout.write(data)` and discards its boolean result (`packages/tui/src/terminal.ts:454-458`). That API supplies neither an applied-byte count nor terminal atomic-commit acknowledgment. `ManagedRenderer.render` performs the single synchronized write before accepting ledger/frame/geometry state and cancels preparation on a synchronous throw (`managed-renderer.ts:112-124`), so the logical transaction boundary is ordered correctly. It cannot infer or undo a prefix already accepted by the stream or terminal.

Synchronized-update escape sequences do not provide an acknowledged transaction protocol. A partial sequence, asynchronous stream error, terminal application failure, or process death can therefore leave physical state uncertain even when logical state was not accepted.

### Specification status

**REJECTED** that this is a new rollback bug or unresolved promise conflict. The boundary is explicit:

- `docs/design/proofs/hoare-render-transaction.md:13` says write failure does not accept or resend state and does not claim rollback of partial physical bytes.
- `docs/design/known-state.md:81-85` lists partial terminal writes and hard death as non-rollback risks.
- `docs/design/research.md:107,115` says failure after writing begins enters poisoned/native recovery and that `terminal.write()` has no physical atomic-commit confirmation.

Accordingly, “fail open” means relinquishing managed ownership and recovering through native rendering where possible; it does not mean byte-atomic rollback, exactly-once delivery, or guaranteed native-equivalent physical state after an interrupted write.

Snapshot replay has the same boundary: chunks completed before a later throwing chunk remain delivered, the throwing chunk's delivered prefix is unknown, and subsequent chunks are skipped. Treating this as a multi-chunk rollback transaction would require a different terminal protocol, not a local retry.

**Tests:**

1. Existing evidence: `resize-epoch.test.ts`, “does not synchronously retry a partial native width redraw,” verifies fallback and no blind resend after a partial native redraw. It does not prove rollback or byte-level equivalence.
2. Add a fault terminal that emits a configurable prefix and throws. Assert prepared logical state is canceled, no immediate resend occurs, and recovery is selected. The assertion should explicitly leave the physical prefix as unknown rather than demand rollback.
3. For replay, fail each chunk boundary and assert strict control flow: completed earlier chunks remain completed, no later chunk is written, and the failure is surfaced.
4. An every-byte VT-emulator comparison against uninterrupted native output is useful as a characterization test. Differences should document the residual boundary, not fail a contract that explicitly excludes rollback.
5. Add an asynchronous stream-error characterization if supported by the terminal abstraction: a return from `write()` can precede an error event, so logical acceptance cannot constitute physical acknowledgment.

**Action:** spec boundary. No ordinary code fix can manufacture terminal rollback from `write(): void`. Do not retry unknown prefixes blindly. A stronger guarantee would require an acknowledged transport/terminal protocol or process isolation, which is outside the current renderer contract.
