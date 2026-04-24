# Hoare Audit Round 3 — Summary

## Scope
5 dimensions audited in parallel: State-Machine Correctness, Crash Safety, Resource Lifecycle, Error Propagation, Security.

## Confirmed Findings (4 of 6 independently verified)

### Auto-Fixed (Non-Decisional) ✅

| ID | Finding | Fix | Verified |
|----|---------|-----|----------|
| EP-chain (EP-01+02+07) | `readState` had zero shape validation; corrupted state.json returned garbage objects silently. `agent_end` bare `catch {}` swallowed all errors, permanently breaking stagnation tracking. | Added shape validation to `readState` (storage.ts). Changed bare `catch {}` to `catch (e)` with `ctx.ui.notify` in agent_end handler (index.ts). | PASS |
| SM-1.2 | Mutual epsilon cycles passed parser validation. Engine would loop 64 iterations with no progress before failing. | Added DFS epsilon-cycle detection in `buildFSM` (parser.ts). Throws `ParseError` with cycle path at parse time. | PASS |

### Decisional (Needs Human Input) ⚠️

| ID | Severity | Finding | Decision Needed |
|----|----------|---------|-----------------|
| S-05 | Critical | `interpolatePlaceholders()` runs on `condition.cmd` — LLM-controlled values (namedArgs, tape) can become the binary path in `spawn()`. | By design? Options: (a) allowlist for cmd values, (b) sandbox child processes, (c) document trust model and accept. |
| CS-2 | Medium | Crash between `persistRuntime` and `popFsm` on `$END` leaves FSM permanently stuck on stack. No startup recovery. | Options: (a) add `$END` sweep on `session_start` — detect FSMs stuck at `$END` and auto-pop, (b) two-phase pop with intent marker, (c) accept narrow window. |

### Rejected (2)

| ID | Reason |
|----|--------|
| S-04 | `spawn()` uses `shell:false` — shell metachar injection is inert. Real concern (interpolation into argv) is subset of S-05. |
| S-01 | Session ID is framework-generated UUID v7 (hex+hyphens only), not user-controlled. |

## Unconfirmed Findings (from dimension audits, not independently verified)

~60 additional findings at PARTIAL/GUARDED/LEAK severity. Notable ones:

- **RL-1/RL-2**: `atomicWriteJson` missing try/catch cleanup on writeFile/rename failure — tmp file leak
- **RL-6**: Windows process group kill fails (negative PID SIGKILL is POSIX-only) — subtree orphaning
- **EP-09**: Condition exit code partially ignored in some paths
- **S-06**: Full `process.env` inherited by child processes
- **EP-10/EP-11**: Parser blind spots — `is_epsilon: no` silently inverts to true, typos in optional field names vanish

## Files Modified

- `storage.ts` — `readState` shape validation
- `index.ts` — `agent_end` catch block error logging
- `parser.ts` — epsilon cycle detection in `buildFSM`
