<results>
<files>
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.ts -- capture, fallback, recapture, shutdown, and phase transitions.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-patch.ts -- synchronous recovery, native commit, handoff, and width-redraw failure paths.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/managed-renderer.ts -- active prepared-commit, stable-row, growth, and terminal-write transaction path.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/transcript-ledger.ts -- prepared/commit/cancel ledger mechanism.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/stable-screen-rows.ts -- stable-row preview and acceptance.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/runtime-coordinator.test.ts -- recovery-failure and fallback assertions.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/tui-snapshot.test.ts -- capture, restoration, and snapshot-failure tests.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/transcript-ledger.test.ts -- prepared commit lifecycle tests.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/native-handoff.test.ts -- native handoff tests.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/architecture.md -- active renderer ownership and transaction specification.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/known-state.md -- terminal support and evidence limitations.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/design/detail/lifecycle-failure.md -- lifecycle and recovery contract.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/audit-report.md -- reported test/global evidence and stated limitations.
- /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/codex-viewport/docs/audit/viewport-2-active-renderer/round-005/findings-pool.md -- definitions of F13–F16.
</files>

<answer>
F13 — PARTIALLY CONFIRMED, but “permanent fallback” is overstated. `runtime-coordinator.ts:49-54` can report `active-native-fallback` while an active patch remains installed; `:185-193` also clears the patch and enters fallback after recapture/width-redraw failures. These paths do not establish successful native recovery or automatic re-entry. However, fallback is retried on later lifecycle activation, so permanence across future runs is not proven. Existing coverage: `runtime-coordinator.test.ts:66-73` verifies recovery failure, surfaced `/native render failure/`, fallback phase, and absent `doRender`. Missing tests: fallback followed by a supported new run; fallback with a still-owned patch; width-redraw cleanup failure.

F14 — CONFIRMED for error suppression in `capture()`, PARTIAL for the stronger “unsafe new epoch” claim. `runtime-coordinator.ts:22-30` catches prior-owner cleanup/recovery exceptions, including `recoverSynchronously("session context replaced")`, and then derives a new phase from the replacement context. This can hide old-owner recovery failure before new ownership is admitted. Suppression is not universal: `runtime-patch.ts:69-79` preserves/rethrows recovery errors, and `runtime-coordinator.test.ts:66-73` observes them. `tui-snapshot.test.ts:116-161` verifies terminal restoration and before/after-capture failures, but does not interleave pending capture with shutdown or assert rejection after prior-owner recovery failure. Required regression: make old-owner recovery throw during `session_start`, assert the new epoch is rejected or remains isolated until native recovery succeeds.

F15 — DISPROVEN as a dead-machinery claim; PARTIALLY VALID only as a duplication/design-risk observation. `managed-renderer.ts:72-147` actively performs reconciliation, `prepareCommit`, growth planning, terminal write, cancellation on write failure, `acceptPrepared`, and stable-row updates. `transcript-ledger.ts:97-169` implements prepared/commit/cancel validation. `runtime-patch.ts:171-197` actively validates native handoff and executes native commit/fallback paths. Direct tests exist in `transcript-ledger.test.ts:15-110` and `native-handoff.test.ts:35-50`. Separate recovery paths are not evidence of dead code: width redraw, native commit rejection, handoff mismatch, managed render failure, and terminal-write failure have different ownership/baseline obligations. Any optimization that removes prepared history, stable rows, native idle equivalence, or native-only history ownership is rejected. A narrower concern remains: `live-region-growth.ts:13-15` only preserves the existing top and does not implement upward growth; this is a correctness gap, not proof that the transaction machinery is dead.

F16 — CONFIRMED as a documentation/evidence-consistency defect, not as proof that the implementation is wholly invalid. `runtime-phase.ts:1-9` and `runtime-coordinator.ts:165-166` include/use `native-commit-gate`, while the detailed state specification omits it. `docs/design/known-state.md:79-85` marks iTerm2, Kitty, and WezTerm validation unfinished while terminal detection allowlists them. Current `audit-report.md:39-43,74-85` reports 59 tests/12 suites and conditional coverage, while earlier audit material makes broader hard-death/terminal claims. The current architecture correctly documents boundaries: native Pi owns finalized history, the plugin owns only the pending suffix, and hard process death/IME/direct-stdout guarantees are limited. Needed tests/evidence: synchronize the phase-state specification, separate allowlisted from verified terminals, and add explicit hard-kill/reopen, IME, and snapshot-shutdown interleaving cases. No tests were executed during this read-only challenge.
</answer>

<next_steps>
Treat F13/F14 as lifecycle hardening items, retain F15 machinery, and repair F16 specification/evidence alignment before claiming unconditional guarantees. Findings are provided here; no repository files were modified.
</next_steps>
</results>