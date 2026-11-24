# Round 006 Clean-Room Plan

Spec source: current `README.md`, `docs/design/`, user invariants, and official Pi source.

Audit object: all 56 top-level non-test TS files; 18 test files as evidence.

Fresh reviewers must not read any `docs/audit/viewport-2-active-renderer/round-00*` directory. Focus:

1. functional transaction and ledger correctness after render-cache/FSM/fencing changes;
2. snapshot ownership, process lifetime, and filesystem publication after lifecycle/security changes;
3. DSR/frame/cross-boundary correctness and current spec alignment.

Every code finding requires PRE/Post/Invariant, reachable counterexample, and pinning test. Existing open design gates are recorded but not silently resolved. Optimization is mandatory. Overall PROVEN is forbidden while any open design gate or partial boundary remains.
