# fsm-7 v2（修订）：tmux 子会话架构 + 软停门

v1（嵌入式 viewer）已废弃：owner 实测滚动受限 + 调研（`docs/research/fsm-7-subagent-tmux-research.md`）后整体重设计。v1 中仍然成立的裁决（7 行滚轮、belowEditor、右列指标、/subagent 命令、extraArgs 穿透）继承；本文件只写变更。

## 1. 架构（badlogic/pi-subagent 骨架 × FSM 强管理层）

child = **detached tmux 会话里的交互式 pi**：`tmux new-session -d -s fsm-<shortid> -x 120 -y 40 -c <cwd> -- pi -ne -e <bundle> --session <file> --model M --thinking T [extraArgs]`。

三律法分层：tmux 管存亡；FSM（child 内 stop-gate，含软门）管何时可停；coordinator 管生养报杀。

### 1.1 生命周期（定稿）

```
spawn(parent独占) → starting →(握手)→ busy ⇄busy(软硬门裁决期，非settled)
                                        ├─ settled+FSM可停 → idle（会话保留）
                                        │    └─ inbox 到 → busy
                                        ├─ exited（自然终/崩溃：parent 对账 has-session）
                                        │    FSM非终态 = aborted✗ 如实上报
                                        ├─ stopped（显式：级联 kill + 标记；不删目录）
                                        └─ suspended（parent 干净退出：kill+保留，resume 重启全历史）
parent 崩溃恢复：has-session 活→收养；死→exited 处理
```

不变量：settled 永不杀会话；liveness 唯一真相=tmux has-session；状态唯一真相=文件三件套；**任何目录永不删除**（transcript=证据）。

### 1.2 通信矩阵（定稿）

| 方向 | 通道 | 机制 |
| --- | --- | --- |
| parent→child | 文件 inbox | `<childDir>/inbox/<seq>.json` `{message,delivery}`；child 250ms 轮询 → `pi.sendUserMessage(deliverAs:steer\|followUp)`；初始 prompt=inbox 第 1 条 |
| child→parent 事件 | HTTP（token 私有路由，现有） | busy/idle 迁移、ready、settled |
| child→parent 结果 | session.jsonl（parent 拉） | settled 只当铃铛；活动分支末条 assistant |
| child↔FSM daemon | HTTP→parent 代理（现有） | root 唯一 source 持有者；父崩溃窗口内 FSM 调用暂败，恢复自愈 |
| 孙辈发射 | HTTP→parent 准入 | 名单/深度/bundle 集中 |
| 兄弟互发 | parent 中转→目标 inbox | |
| 人→child | tmux attach | 原生输入（busy 时打字=steer） |

红线：文件=持久事实，HTTP=时效通知；parent 唯一发射者/唯一 source。

### 1.3 插件双模式（同一份代码）

child 模式（`FSM_CHILD_BOOTSTRAP` 存在）：FSM 工具投影、permission/stop 门禁（含软门）、agent 别名（孙辈经准入）、**inbox 轮询器、metadata 写入器**。无：selector、/subagent、AskUserQuestion（**修：现 hasUI 即注册，改 bootstrap 存在不注册**）、judge 会话。

### 1.4 metadata 状态文件

`<childDir>/metadata.json`（原子写 0600）：`{version, sessionId, parentSessionId, tmuxSession, cwd, model, thinking, launchArgs, extraArgs, state: starting|busy|idle|exited|stopped|suspended|error, hasStarted, outcome, summary, createdAt, updatedAt, error?}`。child 写状态；parent 只在收养/对账/挂起/停止时写。

## 2. 软停门（Stop-Gate v2，硬性 parity 项）

照抄上游 hook 语义（`crates/hook/src/main.rs`，不自创）：

```
plan_stop_route:
  is_terminal(=can_user_interact) → 机械放行（零模型）
  state 缺失 → BlockMalformed
  FSM_STOP_ANALYSIS=0（config，默认开、opt-out、非法值fail-safe开） → 确定性回退（exit 态→教退法文案；否则 block）
  其余 → Analyze:
    /evidence/collect + /evidence/live-work + recent_stop_plans + last_assistant_message
    → JudgeSessions 结构化 verdict {action: WaitForAsyncWork|HumanIntervention|ArrangeObservation, reason}
    → reduce：WaitForAsyncWork→Allow；HumanIntervention∧recent_plans佐证→Allow(带计数)；
      无佐证/ArrangeObservation/空/错/judge失败→Block（一律 fail-closed）
    Allow → best-effort /stop-reset 清防螺旋
```

- 模型：宿主当前模型（与 OC 后端"忽略 model 字段"语义一致）；config `stopJudgeModel` 可覆盖。
- **我们的增强**：`live_work = daemon live-work ∪ 本 root busy native children`（否则"等子代理"判不出）。
- 续跑提示注入 recent_plans；selector 行显示 no_progress_count。
- 时序：全部在 agent_before_settle 内完成，Analyze 期间未 settled。

## 3. UI 与命令族

- ↓ selector（保留）：行 `name shortId [FSM:State] 状态 ctx% tok no_prog tmux:fsm-xxx`；FSM state 来自 daemon `/actors` 映射。Enter → 打印 `tmux attach -t <ses>`（不弹窗）。
- `/subagent send "prompt" --fsm X [--model p/m:t] [--name N] [-- flags]`（继承）。
- `/subagent find <ID>|--all`：全量情报表（含历史；metadata+actors+tmux）。
- `/subagent tmux-attach <ID>`：打印 attach 命令。
- 子侧 `/subagent send-to-main <msg>`：人在 pane 里用。

## 4. 删除清单

fleet-viewer.ts、fleet-measure.ts、输入重定向（input 事件 handler）、PgUp/PgDn、NativeChildProcess（RPC 管道）及其传输续跑测试、旧 detached agent-tool.ts、parent-model-arg.ts、previous-PID liveness。

## 5. 测试

- 单测：metadata 状态机迁移、inbox 投递/坏消息处理、tmux 命令行构造、reduce 规则全分支（fail-closed）、route 规划（开关/非法值）。
- native 集成改写：child 驱动=写 inbox+断言 metadata/session；tmux 环境必需。
- parity：增加判别性场景——软门仅一侧存在时必须分歧（stuck-loop：OC 侧 judge 放行、Pi 侧同判）。
- tmux 实测：全生命周期手操（spawn→steer→软门→suspend/收养→stop）。

## 6. 边界

tmux 硬依赖（缺失=发射失败明确报错）；父崩溃窗口 FSM 调用暂败（结构性，记录）；child 交互模式门禁/软门行为以实测为准。

## 后续改进（backlog，不阻塞当前）

- **skill playbook 共享**：把子 FSM（analyze-batch 等）的产物约定摘要写入父 FSM 的 dispatch 指令或独立 playbook 文件，避免主 agent 空闲时翻 YAML/design docs 确认 worker 输出格式。上游 CCV YAML 改动或插件侧 `fsm_skill_info` 工具均可。
