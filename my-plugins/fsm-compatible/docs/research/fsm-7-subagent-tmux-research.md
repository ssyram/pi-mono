# fsm-7 重新调研：tmux 子会话架构（替代嵌入式 viewer）

触发：owner 实测 overlay viewer 滚动受限，调研 session `01a162a3`（Mario 立场 + badlogic/pi-subagent），授权按 /workflow 重开调研。本报告为修订依据，未动实现。

## 1. 关键事实（全部一手核实）

### Mario 本人维护 `badlogic/pi-subagent`（即"官方做了一个类似的"）

- 独立仓库（非 pi core）：extension + CLI (`subagent.ts`) + skill；child 是**独立交互式 pi 进程跑在 detached tmux 会话里**。
- spawn：`tmux new-session -d -s <ses> -x 120 -y 40 -c <cwd> -- pi --session <file> --provider P --model M --thinking T [flags]`。
- **不合并进主界面渲染**：#830 明确无计划（建议 tmux）；#7058 `setRenderedSession` PR 未合并；pi-subagents #1790 focused-child 也被作者自己否掉。三条路都指向：**子会话=另一个真 TUI，tmux 承载**。

### 回报与控制契约（shared.ts + index.ts 逐行核实）

三件套，全部文件化，**零终端抓取**：

| 通道 | 机制 |
| --- | --- |
| 状态 | `metadata.json`（RunState: starting/busy/idle/exited/error）原子写；child 扩展在 `agent_start`/`agent_settled`/`session_shutdown` 时更新；liveness 真相源 = `tmux has-session`（metadata 说活着但 session 没了 → exited） |
| 下发（steering） | `inbox/*.json` 文件队列；child 扩展 **250ms 轮询**，经 **`pi.sendUserMessage(msg, {deliverAs: "steer"|"followUp"})`** 投递——官方消息 API，**不是 tmux send-keys 模拟打字**；idle 时直接开新 run |
| 结果 | `wait` 轮询 metadata 到终态，从 `session.jsonl` 按 parentId 链取**活动分支最后一条 assistant**（容忍末行半写） |

### 挂起/恢复语义（比我们的 PID 活性检查更干净）

- 父会话干净退出（session_shutdown）→ **主动 suspend**：`tmux kill-session` + metadata 标 suspended，transcript 保留；resume 父会话 → 以完整历史重启 child（idle 态）。
- 父崩溃（没走到 shutdown）→ child 活在 tmux 里；恢复时 `has-session` 判活 → **重新收养**，不重启不杀。
- 自行退出的 child 在 shutdown 清理时直接删除 run 目录。

### 其他实现细节

- 嵌套 subagent 禁用；child 不装 skill；`--tools/-ne/-ns` 等隔离 flag 随 relaunch 保留（launchArgs 存 metadata）。
- `pi.setSessionName("subagent <name>")` 便于 attach 后辨认。
- 父侧 widget 1s 刷新显示 name/handle + state——与我们 7 行 selector 同型。
- `/subagent` 命令 = 选择 + attach；CLI `spawn/status/send/wait/stop/list` 由父模型经 **bash+skill** 驱动（不是 registerTool）。

## 2. TUI 卡死/异常风险清单（owner 提问）

| 风险 | 评估 | 处置 |
| --- | --- | --- |
| 阻塞对话框（select/confirm/AskUserQuestion） | 真风险：child 无人应答会永久等待 | child 只加载 bundle 必载扩展（受控）；**须修**：AskUserQuestion 目前 `hasUI` 即注册，child 现在也有 UI——改为 bootstrap 存在时不注册 |
| not-ready 门禁 | daemon 不可达时 child TUI 静默 gated | fail-closed 设计使然；inbox 轮询在 session_start 即启动，恢复后自动续 |
| Stop-gate 续跑循环 | FSM 契约行为，非死锁 | 剧本必须 exit_fsm（本轮已实证）；`no_progress_count` 可观测 |
| detached pane 无读者 | tmux 自缓冲，无反压问题 | 设 history-limit；无操作 |
| attach/detach 竞态、全屏切换 | tmux 成熟处理 | 人为介入按 Mario 立场是特性（可观察可干预） |
| tmux server 死亡 | 全部 child 随之消亡 | 等价于今天的进程死亡；恢复路径同（session file 重生） |
| 双进程同一 session file | 恢复时重复 spawn | `has-session` 判活收养，取代 previous-PID 探测 |
| 终端模拟输入 | **规避**：不用 tmux send-keys 传消息 | 全走 sendUserMessage 消息 API |

## 3. 对我们重设计的映射（保留 FSM 层，换骨架）

**采纳**：出生即 detached tmux（`-x 120 -y 40 -c cwd`，`pi --session file` 交互式）；metadata/快照文件化（已有 registry 快照≈metadata）；**文件 inbox + sendUserMessage(deliverAs)** 做下发；挂起/收养语义替换 PID liveness；结果读活动分支（records 层已有等价）；setSessionName。

**保留（我们独有，pi-subagent 没有）**：FSM 准入/dispatch/名单/深度；必载扩展 bundle；permission/Stop 门禁；judge/Evidence 桥；7 行 selector（行内容加 FSM state + tmux 位置）；`/subagent` 命令族。

**删除**：fleet-viewer、fleet-measure、输入重定向、NativeChildProcess(RPC 管道)、tmux send-keys 方案（调研后弃）。

**与 HTTP 通道的关系**：child→parent 事件上报保留现有 HTTP（快、带鉴权）；parent→child 下发改走文件 inbox（父死后仍可投递，天然匹配挂起语义）。transport 双轨但各司其职：文件=持久事实，HTTP=实时通知。

**测试影响**：21 项 native 测试的 child 驱动改写为 inbox 投递 + metadata/session 断言；RPC promptAndWait 路径删除。

## 4. 边界

- 本报告只调研不改码；badlogic/pi-subagent 全局安装方式（~/.pi/agent/extensions）不适用我们（项目级约束不变）。
- Mario 对 subagent 的立场：认可可观察/可干预的独立子任务，反对黑盒编排与主界面切换——与 FSM 强管理模型不冲突。
- 1.3.0 已含 `pi.sendUserMessage` 与 `deliverAs`（child 侧投递所需 API 已在宿主内，待类型核对）。

## 5. 补录（同日）：hook 全命令面审计 + 软停门更正

owner 质疑后核实：此前"Soft Stop Reviewer 不存在"为错误结论。真相：**软停门存在、默认开（opt-out）**，位于 hook 二进制而非 daemon；且 transition soft reviewer 与 stop reviewer 共享同一 `agent_cli` judge 库（server 驱动 vs hook 驱动，模型执行都在宿主）。`FSM_STOP_HAIKU`（set 才启用）已退役，被 `FSM_STOP_ANALYSIS`（默认开、judge 化）取代（#152→#159→#173）。

### hook 命令面 vs 我们插件的覆盖对照（crates/hook/src/main.rs:105-133）

| hook 命令 | 职责 | 我们 | 状态 |
| --- | --- | --- | --- |
| SessionStart | 注册会话+acquire main FSM | prepareBrokerChannel+root绑定 | ✓ |
| SubagentStart | child acquire FSM（消费 dispatch，best-effort） | child bootstrap /actor/acquire | ✓（更严：阻塞 ready） |
| IdentityAcquire | fsm_* 工具身份桥 | broker source读回+identity consume | ✓ |
| CheckPermission | 非 fsm 工具门禁 | permission-gate | ✓ |
| **Stop** | main 停机判定 | stop-gate 仅硬法+transport soft-pass | **缺 Analyze 软门** |
| **SubagentStop** | child 停机判定 | 同上（agent_id 区分） | **缺同层** |
| AskEnd | 问题工具收尾释放门 | gate-moves/ask-tool | ✓ |
| GateSuppress/Release | OC 交付门 | AdvisoryQueue/gate | ✓ |

结论：除 Stop/SubagentStop 的软门层外无其他缺口；重设计补齐项见 §3 增补。

### 软门实现规格（上游照抄，不自创）

- 路由：is_terminal→机械放行 / state缺失→BlockMalformed / ANALYSIS=0→确定性回退（exit 态教退法）/ 否则→Analyze。
- Analyze：/evidence/collect + /evidence/live-work + recent_stop_plans + last_assistant_message → judge（结构化 verdict：WaitForAsyncWork|HumanIntervention|ArrangeObservation+reason）→ reduce：WaitForAsyncWork→Allow；HumanIntervention 须 recent_plans 佐证→Allow+计数；无佐证/ArrangeObservation/错/空→**Block（fail-closed）**；Allow 后 /stop-reset 清防螺旋。
- 模型：OpenCode 后端**忽略 model 字段用宿主默认**（agent_cli 源码明示）——与我们 host-model-source 天然对齐；`stopJudgeModel` 仅宿主侧可选覆盖。
- 我们的增强：live_work = daemon live-work ∪ 本 root busy native children。
- 开关：config `FSM_STOP_ANALYSIS` 同语义（默认开、opt-out、非法值 fail-safe 开）。
