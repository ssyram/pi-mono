# CS-2 Independent Confirmation: Crash window between persistRuntime and popFsm on $END

## Verdict: CONFIRMED-solid rationale

## Evidence

The crash window exists in two distinct code paths in `index.ts`:

1. **`actionCall`** (line ~244/249-250): `persistRuntime(sessionDir, rt)` writes `state.json` with `current_state_id: "$END"`, then separately `popFsm(sessionDir)` removes the FSM from the stack and deletes its directory.
2. **`loadAndPush`** (line ~197/199-200): Identical pattern — `persistRuntime` followed by conditional `popFsm` when `entry.reached_end` is true.

`persistRuntime` (line ~104) writes tape first, then state. The inline comment explicitly acknowledges the crash-between-writes risk for tape vs state, but the gap between `persistRuntime` completing and `popFsm` executing is unaddressed. These are two separate async filesystem operations with no transactional grouping.

## Recovery analysis

On next load after a crash in this window, the FSM remains on the stack with `state.json` recording `$END`. The `agent_end` stop hook (line ~679) checks `if (rt.current_state_id === "$END") return;` — it silently exits without performing cleanup or popping the stuck FSM. The `session_start` hook (line ~730) only clears the compaction map and calls `sweepTmpFiles`, which exclusively handles orphan `.tmp.*` files from crashed `atomicWriteJson` calls. `loadRuntime` in `storage.ts` will happily reconstruct the FSM at `$END` with no special handling. There is zero automated recovery anywhere in the codebase that detects or resolves an FSM stuck at `$END` on the stack. The only escape is the manual user `pop` command.

## Practical likelihood

The window is narrow — two sequential awaits on local filesystem writes — so the probability per-transition is low. However, the consequence is permanent: the stuck FSM silently blocks the `agent_end` hook from ever re-prompting the parent flow (the `$END` early-return), effectively deadlocking the flow stack for that session until manual intervention. The severity is proportional to how critical unattended session recovery is. For interactive use with a human operator who can run `pop`, this is a minor annoyance. For any unattended or long-running deployment, it is a silent liveness failure with no self-healing path.
