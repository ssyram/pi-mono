# codex-viewport 架构

## 1. 目标映射

| 原则目标 | 负责模块 |
|---|---|
| 工具与非纯文字动态区只保留可见尾部 | LiveRegion |
| 普通纯文字 streaming 原生等价 | assistant containment policy |
| finalized history 单份且 source-order | CompletionTracker + ComponentBridge |
| 原生终端与 IME ownership | NativeRenderBridge |
| AI/session 零影响 | RuntimeCoordinator 的 observer-only 边界 |
| 静态 100% 原生 | run-scoped restore barrier |
| 插件错误不影响 agent | fail-open rollback |

稳定性优先级：输入正确性、进程存活和单份历史高于绝对零 redraw。

## 2. 核心状态

`RuntimePhase = idle-native | active-managed | active-native-fallback | disposed`。

- `idle-native`：无 patch、无 LiveRegion、tracker 为空。
- `active-managed`：只安装 `doRender` 前置 bridge；原 renderer 执行全部终端操作。
- `active-native-fallback`：本轮 bridge 失败并完整恢复，之后只用原 TUI。
- `disposed`：runtime 已关闭，无 transient state。

`TrackedUnit` 按 assistant source order 排列。assistant 默认 `contained=false`，thinking/未知动态块可切换为 contained；tool 始终 contained。每个 unit 最多注册一次；只有连续满足 `completed && component attached` 的队首前缀可以释放。

## 3. Ownership 边界

### 插件拥有

- 当前 run 的 `CompletionTracker`。
- 临时 `LiveRegion`。
- 当前 TUI instance 的 run-scoped `doRender` wrapper。
- detached component 的位置关系。

### Pi 原生拥有

- `requestRender` 调度与 force 语义。
- `doRender` 的实际 frame 计算和 differential/full redraw 选择。
- 所有 `terminal.write`。
- `previousLines`、viewport、geometry 和 cursor baseline。
- hardware cursor、IME candidate positioning、input、start/stop。
- message/tool component 内容和 session 数据。

插件源码不得读取或写入 renderer baseline，也不得发送 ANSI sequence。

## 4. NativeRenderBridge

安装时只检查：

1. TUI layout 可通过结构契约识别；不得用 `instanceof` 跨 package identity 判断。
2. TUI 可扩展。
3. instance 没有已有 `doRender` owner。
4. 没有本插件 marker。

wrapper 的唯一流程：

```text
try ComponentBridge.reconcile()
catch plugin fault -> restore tree + restore method + mark fallback
call original doRender exactly once
```

原 `doRender` 抛出的异常不由插件吞并或重试，避免重复 terminal write。插件不包装 `requestRender`、`start` 或 `stop`。workspace extension 与 global Pi 使用不同 `pi-tui` module identity 时，container 仍按 `children`、`removeChild`、`render`、`invalidate` 结构识别。

## 5. 动态流程

1. `agent_start` 清空 tracker 并安装 bridge。
2. assistant/tool lifecycle events 只更新 tracker；普通 text 与 tool-call metadata 不 containment，thinking/未知块启用 assistant containment，tool component 始终 containment。
3. 下一次原生 render 前，bridge 只把 contained components 移入 `LiveRegion`；普通文字 assistant 保持原位置。
4. `LiveRegion` 渲染全部 contained components 后，只返回 terminal 可容纳的尾部。
5. completion frontier 前进时，完整 component 在同一 anchor 前恢复一次。
6. 原生 renderer 根据新 component tree 自行绘制并定位输入光标。

该设计降低 offscreen transient rows 触发历史重画的概率，但不改写原生 redraw 策略。

## 6. 静态与异常收敛

| 入口 | 动作 | 结果 |
|---|---|---|
| successful/error/aborted `agent_end` | restore tree、删除 wrapper、清空 tracker | `idle-native` |
| active shutdown | 幂等 restore，不主动 render | 进程结束；下次原生恢复 |
| idle shutdown | 清空引用 | 原行为 |
| bridge fault | restore 后调用原 `doRender` | `active-native-fallback` |
| unsupported layout/foreign patch | 不安装并显示 warning | `active-native-fallback` |
| hard crash/SIGKILL/OOM | 无 transient persistence | 新进程从原 session 数据恢复 |
| active forced reload | old runtime restore；new runtime 因 non-idle 拒绝接管 | 本轮原生 |

所有正常动态→静态路径经 `agent_end` 或 `session_shutdown`；无 cleanup 的进程死亡不会留下持久化插件状态。

## 7. AI 与持久化隔离

- handlers 不返回 event replacement。
- 不调用 send、append、abort、provider、tool 或 session API。
- component 引用迁移不进入 Agent state 或 SessionManager。
- shutdown 不补写 tool result 或 transient UI state。
- restart 不读取插件状态文件。

因此插件不能改变当前或后续模型可见的 messages、tool 调度与 session 内容。

## 8. 展开、resize 与输入

- `app.tools.expand` 由原生 `requestRender` 和原生 renderer 完整处理。
- resize、theme、overlay、image、shrink 和 terminal restart 均由原生 renderer 处理。
- 用户打字和流式输出共享 Pi 原生 render scheduler。
- IME hardware cursor 只依据 Pi 自己维护的 baseline 定位。
- 插件不保证这些场景绝不出现原生 full redraw。

## 9. 正确性结论

LiveRegion 隔离 transient rows，CompletionTracker 保证有序单份提交，NativeRenderBridge 保证 Pi 独占 terminal/cursor，restore barrier 保证静态原生，observer-only 边界保证 AI/session 零影响。该组合优先消除插件导致的重复和闪退，同时保留不全面接管 TUI 的约束。
