# Round 005 Plan — SCCO + HoarePrompt Full Proof

## Audit object

All 52 non-test TypeScript files in `my-plugins/codex-viewport/`, with tests and `/tsnapshot` artifacts as executable evidence. Official Pi source under `packages/tui/src/tui.ts` and `packages/coding-agent/src/modes/interactive/` is read-only cross-boundary authority.

## Spec source

- `docs/design/principles.md`
- `docs/design/architecture.md`
- `docs/design/detailed-design.md`
- `docs/design/known-state.md`
- `docs/design/fixes/atomic-block-native-commit.md`
- `README.md`
- user invariants recorded in the current task, especially single renderer ownership, native static equivalence, AI/session isolation, atomic visual blocks, and “no stable row moves without real occupying output”.

Spec conflicts are findings at D/Q trace level; auditors may not silently choose a convenient clause.

## Deployment context

- Execution model: Pi extension inside an interactive long-running CLI/TUI process.
- Trust boundary: Pi component tree and lifecycle are internal; terminal input/DSR, terminal dimensions, component render bytes, OS/Terminal.app capture, and extension coexistence cross boundaries.
- Persistence: plugin runtime state is ephemeral; Pi JSONL is authoritative; snapshot artifacts are disk-backed diagnostics.
- Concurrency: JavaScript single-threaded event loop with asynchronous DSR/snapshot operations, synchronous reentrant renders, and lifecycle events between async boundaries.
- Threat model: local user correctness and crash safety, not hostile multi-tenant execution.

## Round focus

Every round includes Optimization. Round 005 covers:

1. Sound + O: line-by-line NSP proof of entry, managed render transaction, native commit/handoff, resize, and recovery.
2. Complete + O: spec-to-implementation matrix across all 52 source files and all user invariants.
3. Cross-boundary + O: Pi private TUI fields, viewport math, cursor/DSR, terminal ANSI and method ownership.
4. Crash/resource + O: every throw/cancel/stop/snapshot/re-entry path and resource release.
5. Adversarial/state-machine + O: reentrant render, long history, bottom slack, height/width change, transient components, commit ordering, and owner uniqueness.
6. Concise + O: stale row-history code/docs, duplicated state, and avoidable proof mechanisms.

## Roles and artifacts

- `prover-functional.md`: function-by-function Hoare triples and NSP chains.
- `challenger-spec.md`: spec contradictions and missing traceability.
- `challenger-boundary.md`: Pi/terminal cross-boundary counterexamples.
- `challenger-lifecycle.md`: crash/resource/state-machine counterexamples.
- `challenger-adversarial.md`: generated/boundary scenarios and reproduction tests.
- `challenger-optimization.md`: simpler valid architecture and dependency reduction.
- `findings-pool.md`: parent aggregation only; no verdicts.
- `challenge-*.md`: two independent disprove-first reports per candidate.
- `counter-*.md`: final counter-challenge for survivors.
- `judge.md`: independent fact-checked verdicts.
- `pbt-additions.md`: confirmed finding → deterministic/PBT pinning test.
- `verify.md`: independent PASS/FAIL after fixes.
- `scco-report.md`: cumulative SCCO coverage and decision gate.

All subagents run fresh context and read-only. The parent is the sole repository writer and copies accepted reports into this directory. No fork is permitted.

## Convergence gate

Round 005 cannot claim PROVEN while any source path is untraced, any cross-boundary assumption lacks official-source evidence, any confirmed code finding lacks a failing-then-passing test, any non-decisional finding remains unfixed, or any SCCO dimension is not `done`. A later clean-room full re-review is mandatory after fixes.
