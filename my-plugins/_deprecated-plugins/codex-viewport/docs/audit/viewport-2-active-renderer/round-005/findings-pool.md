# Round 005 Candidate Findings Pool

状态：未裁决。以下只做跨报告去重和根因聚类；任何候选必须经过两次独立 disprove-first challenge、必要时 counter-challenge 和 Judge 核查后才算有效。

## F01 — Geometry spec/code contradiction

`architecture.md`同时声明bottom饱和后向上增长和只裁pending；`detailed-design.md`仍描述upward/scroll-region，而`live-region-growth.ts`只向下增长并保留不可达`viewport-expansion` channel。需裁决真实D层契约，再证明实现。来源：prover-renderer、challenger-spec、challenger-optimization。

## F02 — Entry/handoff viewport proof uses incompatible coordinates

Observed warnings: `stable screen rows are not fully attested` and `native visible frame differs`. Candidate subclaims:

1. `native-entry-baseline.ts` computes `naturalTop = originRow + stableEnd - previousViewportTop` but `availableStableRows = stableEnd - previousViewportTop`, omitting `originRow`.
2. `native-handoff.ts` forces `viewportTop = nativeLines.length - terminalHeight`, while Pi incrementally preserves `previousViewportTop` and the adopted frame grammar permits Footer-following bottom slack.
3. Handoff compares row strings/cursor coordinates but not cursor visibility or terminal modes.

These may make proof rejection normal in supported sessions, violating availability and native-equivalence contracts. Source: real `/tsnapshot`, source trace, prover-boundary partial handoff, challenger-optimization R6.

## F03 — Repeated render and heuristic finality lack positive evidence

Entry, commit preparation, managed content, and committed snapshots rerender components multiple times; Pi does not enforce render purity. Opaque non-tail items and structural constructor/property heuristics may be finalized/bound to the wrong lifecycle item. Source: prover-renderer, prover-boundary A5/A14, challenger-adversarial A6/A7/A14, challenger-optimization R1.

## F04 — Coordinator lifecycle is not total/idempotent

Duplicate/out-of-order `startRun`/`finishRun`, repeated finish during drain, or finish after shutdown may create a native phase while a managed patch remains installed or resurrect `disposed`. Source: prover-lifecycle, challenger-adversarial A1.

## F05 — Native transition failure does not restore a proven native frame

Native width redraw failure, native commit failure after baseline priming, and dirty recapture catch-up failure restore/discard ownership without canonical invalidation/recovery; some errors are swallowed. Source: prover-lifecycle partial paths, challenger-adversarial A4/A5, challenger-lifecycle L2/L3/L5.

## F06 — Snapshot lease is not coordinator-lifecycle-owned

Lease startup can escape release; shutdown/stop/session replacement can occur while a lease buffers recovery bytes; release may replay stale/post-stop bytes; direct blocked writes can replay after diagnostic mutation without guaranteed catch-up. Source: prover-snapshot-resource S1, challenger-adversarial A2/A3/A12, challenger-lifecycle L1.

## F07 — Snapshot publication is not path-safe or durable

Artifact writes follow symlinks, are non-exclusive/non-transactional, do not sync files/directories, overwrite `latest.json` in place, and can silently leave partial directories. Source: prover-snapshot-resource S2/S5, challenger-spec C005, challenger-lifecycle L6.

## F08 — Terminal row bytes and support detection are under-attested

`normalizeLines` allows cursor movement/modes/OSC/DCS/Sixel; image detection covers only Kitty/iTerm markers; environment allowlist proves neither TTY nor synchronized-update/CUP/EL capabilities. Source: prover-boundary A6/A11/A12/A19/A20, challenger-adversarial A10, challenger-spec C004.

## F09 — DSR input ownership/exactly-once is unproven

Earlier Pi input listeners may consume/transform DSR; replay can invoke earlier listeners twice; synchronous registration can leak subscription and send DSR after settlement; a retained late filter may race a new query. Source: prover-boundary A9/A10, prover-snapshot-resource S3, challenger-adversarial A11.

## F10 — Snapshot child processes can freeze the TUI indefinitely

`ps`/`osascript` lack timeout/abort while the snapshot lease owns render and terminal writes; blocked output is unbounded. Source: prover-snapshot-resource S4.

## F11 — Frame constructors/diff omit admitted physical states

Cursor column/integer bounds are incomplete; `diffInlineViewport` does not erase previous-only rows when area shrinks; rows below short `naturalBottom` may be assumed blank rather than attested. Source: prover-renderer, prover-boundary A7/A18, challenger-adversarial A13.

## F12 — Partial terminal writes exceed current recovery guarantees

`Terminal.write(): void` has no delivery/atomicity acknowledgment; a prefix can mutate visible screen/scrollback before throw. Current docs alternately promise fail-open/native equivalence and admit no rollback. Source: prover-boundary A20/A21, challenger-adversarial A15, challenger-optimization spec conflict 4.

## F13 — Temporary supported UI states permanently disable managed mode

Tool expansion, visible overlay, temporary insufficient height, or transient image sends the entire run to `active-native-fallback` with no recapture when cleared. Determine which are normal supported states versus genuine unsupported boundaries. Source: challenger-adversarial A8, challenger-optimization R6.

## F14 — Session capture suppresses old-owner recovery failure

Repeated `session_start`/capture swallows previous patch recovery errors and may admit a new managed epoch over an unproven terminal. Source: prover-lifecycle `capture` PARTIAL, challenger-lifecycle L4.

## F15 — Dead/duplicated transaction machinery weakens proof

Mutable `prepared` state may be replaceable by immutable candidate commit; `StableScreenRows` revision/append API is unused; viewport-expansion/history input is dead under current growth code; native commit semantic naming precedes Pi commit. Source: prover-renderer partial aliases/cancel, challenger-optimization R2/R3/R4/R7.

## F16 — Spec and evidence records are stale/incomplete

Docs omit `native-commit-gate`, retain superseded upward/history proofs, report stale test counts/global evidence, and blur allowlisted versus verified terminals. Hard-death and IME guarantees are delegated/unverified. Source: challenger-spec contradictions/C002/C003/C004; prover-renderer proof dependencies.
