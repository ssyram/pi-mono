# codex-viewport Correctness Audit

Status: **LOCAL CODE CONTRACT PROVEN; PRODUCTION-WIDE NOT PROVEN.** Round 005 exposed unsound design and implementation paths. Round 006 fixed every confirmed repository-local non-decisional defect and completed clean-room re-review. Terminal/IME matrices, foreign stdout, partial physical writes and hard death remain external boundaries.

Detailed artifacts:

- `docs/audit/viewport-2-active-renderer/round-005/`
- `docs/audit/viewport-2-active-renderer/round-006/`

Current executable evidence:

```text
88 tests / 16 suites passed
56 non-test TS files / 20 test files
TypeScript plugin config passed
all TS files <= 200 nonblank noncomment lines
```

## Proven local contracts

- `TranscriptLedger` selects only the maximal finalized source-order prefix and rejects stale/mutated tokens.
- One managed transaction observes each component once, writes one synchronized frame, then accepts ledger/frame state.
- Editor/Footer precede widgets/live cropping; synthetic slack exists only after Footer.
- Ordinary managed diff uses absolute rows and never plugin-owned CRLF history insertion.
- Native commit adopts the already-visible frame as Pi baseline without a second native/component render.
- Commit equality observation occurs before the managed write; a task/status change between observations cancels only that prepared commit and remains managed.
- Handoff models nonzero short-session physical origin, retained viewport beyond logical tail, terminal-bottom slack, cursor column and unattested pre-Pi terminal prefix.
- The adopted `maxLinesRendered` equals the clean current working area, preventing a later native diff from replaying history through clear-on-shrink.
- Low-level `agent_end` continuation does not release ownership; official `agent_settled` is the idle/drain boundary.
- Entry/recapture use generation, patch identity, abort identity and one session-owned DSR query owner.
- Snapshot freeze, direct stop, shutdown and artifact-publication cancellation close transaction ownership; blocked output has a 64 MiB cap.
- Snapshot artifacts use private no-follow/exclusive files, sync ordering and atomic `latest.json` replacement.
- Event handlers do not mutate AI-visible messages, provider/tool state, abort state or session persistence.

## Tribunal decisions

1. **Overflow:** keep downward growth followed by pending-prefix crop. Upward stable displacement and plugin history insertion remain forbidden.
2. **Finality:** unknown/custom components remain pending without positive lifecycle evidence; safety wins over eager history progress.
3. **Fallback:** a genuine transition/ABI/write failure stays native for the current run; the next run retries managed ownership. Unknown partial prefixes are never blindly retried.
4. **Native adoption:** cursor-anchored physical origin plus known-suffix byte equality is the handoff model. Commit does not invoke native `doRender`.
5. **Snapshot durability:** publication commits at atomic `latest.json` rename after file/snapshot-directory sync. Root-sync failure after rename may be committed-but-reported-failed.
6. **Terminal support:** current admission is best-effort, not a verified capability proof. Production-wide status remains conditional until the direct matrix is complete.

## External and partial boundaries

- Direct third-party `process.stdout.write` can invalidate sole-writer provenance.
- `Terminal.write(): void` provides no delivery acknowledgement or rollback after a partial physical write.
- Earlier independent input listeners may compete with DSR despite plugin-owned query single-flight.
- ANSI/control grammar and synchronized-update behavior are not capability-probed on every admitted terminal.
- Apple Terminal Chinese IME composition/candidate behavior, iTerm2/Kitty/WezTerm/Zellij, SIGKILL/reopen and filesystem fault injection remain incomplete.
- Node child-process abort semantics, Terminal.app JXA and filesystem rename/sync durability remain platform contracts.

## Revalidation triggers

Re-run the tribunal when Pi changes root layout, private TUI baseline fields, `agent_settled`, input listener ordering, component lifecycle identity, cursor-marker semantics or terminal renderer behavior.
