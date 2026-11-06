# Mock-server E2E 剧本套件（mock-with-pi + tmux）

与 `e2e-tui.test.ts`（plain TUI 机制套件）的分工：机制套件不涉及模型；本套件用
`../mock-with-pi/` 的脚本化 mock 模型（无状态 transcript 状态机）驱动**模型在环**行为——
投递物进入真实对话、mock 按标记反应、tmux 断言 TUI 可见结果。全部离线、确定性、无真实 API。

## 基础设施

- `test/e2e-mock-server.ts`：共享 helper——起 mock-llm-server（专属端口 + 临时 mounts 文件）、
  挂载剧本、临时 HOME（`.pi/agent/models.json` 指向 mock + extensions 符号链接）、会话文件播种。
  e2e-tui 的 urgency 场景与本套件共用。
- mock 剧本：`test/e2e/mock-scripts/*.mjs`，可执行、无状态、按 transcript 标记推进状态机
  （与 `mock-loop-urgency.mjs` 同范式，含 oh-my-pi task-gate 首轮 task 调用）。

## 场景矩阵

| # | 契约 | 剧本状态机 | tmux 断言 |
|---|---|---|---|
| M1 | **忙时 followUp 边界投递**：wake 结果挂起至 `agent_before_settle`，以 continuation 进入同一 turn | A: task-gate + `scheduled_wakeup`(once 15s, prompt `FOLLOWUP-HIT`) + `bash sleep 25`；B(见 FOLLOWUP-HIT): "边界投递收到" 收尾 | widget 运行计时可见；turn 未被打断（无中途新 turn 头）；终态行出现 |
| M2 | **no-wake 静默追加**：结果仅作为 entries 追加，不触发新 turn | A: `scheduled_wakeup`(script echo `QUIET-HIT`, wake never, once 3s) + `bash sleep 12`；B(用户说 check 且 transcript 含 QUIET-HIT): "看到 QUIET-HIT" | 追加后无新 turn；`/loop list` runs=1；check 后确认行 |
| M4 | **分离存活 + 回归投递**（loop-2 旗舰）：pi 退出不杀 wrapper；同 session id 重启 → bootScan 重连 → 投递 | 单态：见 `DETACHED-HIT`（wake 内容）→ "跨重启投递成功" | kill tmux 会话 → 等 wrapper 落盘 → 重启 `pi -c` → 确认行；runs 目录 delivered 标记 |
| M5 | **lost wrapper 修复**：wrapper 被 SIGKILL → 探活失败 → owner 合成 failed → on-error wake | 单态：见 `LOST-HIT` 且内容含失败标记 → "lost 合成被唤醒" | kill -9 wrapper.pid → ≤2 tick 内确认行；result.json cancelled=false + 失败内容 |
| M6 | **超时强杀 + on-error wake**：timeoutSeconds 到期 → wrapper 杀脚本组 → failed → wake | 单态：见 `TIMEOUT-HIT` 且失败标记 → "timeout 处理正确" | 确认行；result.json 内 exit-code/超时痕迹 |
| M7 | **AI 工具往返**：模型经 `scheduled_wakeup` 工具 add(onceReady→警告行)/list/cancel | A: task-gate + tool add(prompt, onceReady) + 收到含 "⚠️" 的 toolResult → tool list(见 id) → tool cancel → "工具往返成功" | 面板出现 ⚠️ 警告行；`/loop list` 空 |

不重复覆盖（留在机制套件）：steering/onceReady 时序（urgency 场景）、stop/去重/wedged、
跨会话归属、GC、调度语义、widget 交互。

## worker 生命周期可观察性（附带验证）

M4/M6 完成后（watchlist 清空）worker 空退：`ps -M -p <pi-pid>` 线程数在
有任务时 +1、清空后回落（lost 非 terminal 不出队——上轮 8→8 的探针即此因）。
在 M6 断言后做一次线程数回落检查作为 spawn-on-demand/empty-exit 的实机证明。


## 实施结论（2026-11-06）

6/6 全绿。剧本范式的三条硬约定（踩坑记录）：
1. mock 必须有"已调度→收尾 stop"分支——tool 循环不结束则 turn 永不 settle，边界永不投递（堆积极易伪装成投递 bug）。
2. 统一 transcript 的 toolResult **不带 toolName**，状态机只能按内容匹配（"Added session task"/"⚠️"/"Cancelled"）。
3. 面板断言区分 widget 折叠态（`· 1 running`）与展开态（`Running (0/0/1)`）；⚠️ 警告行进模型 toolResult 但 TUI 自定义渲染不一定显示——由 mock 状态推进证明。
