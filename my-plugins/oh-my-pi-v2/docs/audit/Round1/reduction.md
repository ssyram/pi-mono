# Round 1 Reduction

Spec source: user-provided decisions on top of /hoare-design-style reverse-engineered source spec.

## Confirmed candidates

All R1-C1 through R1-C12 were independently confirmed. R1-C1 through R1-C11 were confirmed triggering; R1-C12 was confirmed solid rationale with limited runtime impact.

## Reduction: root causes kept

### R1-RC1: Removed `/omp-stop` command-level stop mechanism

- Source candidates: R1-C1.
- Classification: Non-Decisional.
- Fix: removed `continuationStopped`, `/omp-stop` registration, stop reset, and Boulder stop callback wiring.
- Verification: `verify-stop-actionability.md`, `verify-final-pass.md` PASS.

### R1-RC2: Unified active work as `in_progress + ready`

- Source candidates: R1-C2, R1-C3, plus consumer mismatch from `verify-regression-sweep.md`.
- Classification: Non-Decisional.
- Fix: added `actionableCount`; Boulder, prompt injection, widget counts, context recovery, and custom compaction now use `in_progress + readyTasks` where they mean active/actionable work.
- Verification: initial regression sweep found context recovery/custom compaction mismatch; rerun `verify-regression-sweep-rerun.md` PASS.

### R1-RC3: Prevent terminal task resurrection

- Source candidates: R1-C4.
- Classification: Non-Decisional.
- Fix: `task.start` now only accepts `pending` tasks, then still applies blocker checks.
- Verification: `verify-task-state.md`, `verify-final-pass.md` PASS.

### R1-RC4: Observable non-throwing Boulder failure handling with disablement

- Source candidates: R1-C5, R1-C6, R1-C8, R1-C12.
- Classification: Non-Decisional.
- Fix: Boulder logs caught failures, increments shared failure accounting, disables after five failures, cancels active countdown, and warns UI where possible. Countdown handle clears on natural fire.
- Verification: `verify-boulder-observability.md`, `verify-final-pass.md` PASS for synchronous/locally observable failures.

### R1-RC5: Observable task callback/persistence/reload boundaries

- Source candidates: R1-C9, R1-C10, R1-C11.
- Classification: Non-Decisional.
- Fix: task callback failures are logged and non-throwing; widget callback failures are logged; reload assigns loaded state only after successful session iteration; persistence runs before notification and logs/rethrows persistence failures.
- Verification: `verify-task-state.md`, `verify-final-pass.md` PASS.

## Remaining limitation

### R1-L1: Async `sendUserMessage` delivery failures are host-observed, not Boulder-observed

- Source candidates: R1-C7.
- Classification: Remaining limitation / host API boundary.
- Reason: extension-facing `sendUserMessage` returns `void`, while host prompt failures are emitted asynchronously by the runner. Boulder can observe synchronous API failures, but cannot await or attach to async delivery outcome through the current extension API.
- Verification: `verify-boulder-observability.md` marks this as a limitation.
- Follow-up: requires host API design change or extension error-subscription mechanism; not auto-fixed as a local non-decisional patch.

## Rejected / inconclusive

None in Round 1 confirmation.
