# 细化：Lifecycle 与 Failure

## Normal

`agent_start`安装gate并等待DSR；同一high-level run里的continuation `agent_start`幂等。Assistant/tool lifecycle只更新ledger，不替换event或内容。低层`agent_end`只记journal；官方`agent_settled`才进入drain，handoff equality成功则无重画交权，否则native recovery。

## Resize

Height/footer/widget变化留在managed mode。Width变化调用一次saved native renderer完成mandatory full reflow，然后进入`width-recapture-gate`；第二次DSR成功后建立新managed epoch。失败、agent end、shutdown或direct stop返回native时，clean gate只恢复methods；dirty gate先执行native catch-up。Catch-up通常incremental，但Pi自身full-render条件仍然优先。

## Native transition

Visible overlay、image、Ctrl+O、force sentinel、committed mutation和write failure结束managed ownership。Persistent hidden overlay不触发。

## Stop

Active managed frame上的`TUI.stop()`先同步native recovery再调用original stop。Width recapture gate上的frame已经native，只恢复methods后调用original stop。

## Failure

Pre-write异常取消prepared。Write error不accept ledger/protected/stable/frame、不重发batch；先best-effort关闭sync/reset scroll region/show cursor，再native recovery。Partial terminal bytes无法rollback。

Async entry/recapture由generation、AbortController、phase和patch identity共同防止shutdown后复活。Hard death仅由Pi session JSONL恢复已持久化messages。
