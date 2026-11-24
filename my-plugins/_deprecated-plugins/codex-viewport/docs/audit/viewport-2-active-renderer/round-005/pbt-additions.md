# Round 005 Finding-to-Test Map

Status: deterministic regressions added for fixed non-decisional findings. Universal properties and unresolved design findings remain incomplete.

| Finding/root | Pinning test | Status |
|---|---|---|
| F03 one render observation | `managed-runtime.test.ts` — `uses one component observation for prepare and paint` | passing |
| F04 drain/idempotence/successor/disposed | `runtime-coordinator.test.ts` — three lifecycle regressions | passing |
| F05 width/native-commit/dirty-gate baseline fencing | `managed-runtime.test.ts`, `resize-epoch.test.ts` | passing |
| F06 stop/shutdown stale snapshot replay | `snapshot-lifecycle.test.ts` | passing |
| F07 artifact/latest symlink safety | `snapshot-artifacts.test.ts` — `does not follow artifact or latest symlinks` | passing |
| F09 stale late-filter/new-query overlap | `query-terminal-cursor.test.ts` — `removes an old late filter before the next query` | passing |
| F10 hung `ps`/`osascript` | `resolve-controlling-tty.test.ts`, `terminal-app-capture.test.ts` | passing |
| F11 cursor upper bound / previous-only rows | `fixed-frame.test.ts` | passing |
| F12 unknown partial native width prefix | `resize-epoch.test.ts` — no synchronous blind retry | characterization passing |
| Snapshot blocked-output memory cap | implementation constant and overflow cancellation | test still required |
| F01 overflow policy | no single valid test until user selects crop vs upward displacement | blocked by decision |
| F02 full handoff physical state | nonzero-origin, cursor visibility, modes, trailing physical rows | blocked by design |
| F03 positive opaque/custom finality | state-machine/property test | blocked by design |
| F08 accepted ANSI/control grammar and terminal matrix | VT-model PBT | blocked by design |
| F13 same-run transient fallback policy | parameterized recovery model | blocked by decision |

Round 005 is incomplete under `/hoare-audit` Step 5.5 until every confirmed surviving code finding has a failing-then-passing deterministic or property test.
