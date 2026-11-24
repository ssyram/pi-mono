# 细化：ManagedRenderer

## State

- mutable `[top,bottom)` area；
- ledger reconciler；
- protected finalized rows与stable top rows；
- native-seeded previous frame；
- committed snapshots、drain flag和displacement provenance。

## Render

```text
preflight width/stop/force/overlay
reconcile and prepare finalized prefix
render transcript + trailing intrinsic rows
rebase terminal height
plan downward-first / upward-on-overflow growth
preview protected spill and stable rows
render variable-area frame diff + cursor
one synchronized terminal.write
commit/accept previews
```

Width mismatch返回`width-changed`，由runtime patch执行一次mandatory native full redraw和recapture。Gate期间dirty update在失败/stop返回native前catch up；该render是否incremental由Pi native条件决定。Height mismatch在renderer内部rebase。

Finalized rows在capacity允许时保持visible；只有pending/UI真实压力使其不可见时才spill。相同absolute row bytes不重复paint。Editor/footer始终优先。

Write前失败取消prepared；write失败不accept、不重发并转native。Direct stdout writer不在保证边界内。
