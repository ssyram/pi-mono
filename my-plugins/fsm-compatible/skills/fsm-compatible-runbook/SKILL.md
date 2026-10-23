---
name: fsm-compatible-runbook
description: 运行 fsm-compatible（官方 Pi 的 FSM Server 插件）会话的操作注意事项：哪些扩展不能同时加载及特征判据、必需配套、subagent 派发归属与常见故障。启动或调试 FSM 自动化会话前必读。
---

# fsm-compatible 运行注意事项

## 定位：谁在开车

FSM 会话是**纯自动执行**：FSM 状态的 `instructions` 是每一步的唯一指令源，权限由状态白/黑名单裁决，Stop hook 决定是否续跑。人只提供初始输入，不参与中途交互。

这与人机协作式工作台（task 纪律、idle 拉起、规则注入、交互组件）是两种工作模式。**不要在同一会话里让两者同时开车。**

## 与其他扩展互斥的特征判据

不是点名禁某个插件，而是具备以下任一特征的扩展都不应与 fsm-compatible 同会话加载：

### 1. 工具准入门禁类：要求先满足自家协议才放行其他工具

例：omp-v2 的 no-task-no-tool（`tool_call` 钩子拦截除 `task` 外一切工具，默认开启）。

与 FSM 的冲突是**结构性死锁**：
- 不建 task → `enter_fsm` / `fsm_*` 全被拦，永远进不了 FSM；
- 先建 task 再 `enter_fsm` → 进入状态后任务关不掉（见下条），Boulder 又因未完任务持续拉起。

### 2. 工具名占位与 FSM 语义冲突类：占用了 FSM 会归一化的名字

例：核心/第三方 `task` 工具。fsm-compatible 把发往 FSM 的 `agent/task/subagent` 统一归一为 `Agent`（CC 语义，`requires_dispatch`）。后果：

- FSM 状态内调用 `task`（哪怕只是 action=done 关任务）会被 FSM 当作**派发子代理**检查：空 dispatch 队列 → 拒绝；非空 → 误当启动请求。
- fsm-compatible 自己也注册 `task` 作为 Agent 启动别名，与任何已有 task 工具直接撞名。

### 3. 自动续跑/调度类：idle 时注入消息或强制拉起

例：omp-v2 的 Boulder（未完任务时自动 resume，交互模式最多 10 次、10s→1280s 退避）、loop 类调度。

FSM 的 Stop hook 已经拥有续跑裁决权（非终态强制 continue）。第二个续跑者会在状态指令之外注入消息，把流程拉回 task list，与状态 `instructions` 抢方向盘。

### 4. 系统提示/规则注入类：改写 system prompt

FSM 状态 `instructions` 就是完整指令面。额外的 rules 注入、角色设定会稀释或冲突状态指令，且无法被 FSM 门禁审计。

### 结论：omp-v2 与 fsm-compatible 互斥

omp-v2 是给人用的交互工作台；fsm-compatible 是纯自动执行器。两者同时加载 = 开局死锁 + 名字对撞 + 双重续跑。FSM 会话不要带 omp-v2；反过来普通开发会话也不需要 fsm-compatible（除非那个会话本身要跑 FSM 流程）。

## FSM 会话的必需配套

**不需要任何其他插件。** fsm-compatible 自带：

- `Agent`/`agent`/`task`/`subagent` 启动别名 + `agent_list`/`agent_send`/`agent_stop`（原生子会话协调器）；
- Pi/OC/CC 工具名与参数映射（write→Write+file_path、edit→Edit/MultiEdit、bash/shell→Bash、grep/find/glob/ls 等）；
- permission/Stop 门禁、FSM 状态投影工具（`fsm_*`）、Watcher、AskUserQuestion（仅 UI 可用时注册）。

**必需的非插件前置**：

- 运行中的 FSM daemon（`/capabilities` 自检 wire≥2/schema≥2 及所需 features，不能凭二进制文件名判断）；
- 配套 client 二进制；
- 插件目录下的 `fsm-compatible.config.json`（dataDir/client/cwd/名单/必载扩展/深度）。

## 启动方式

```sh
# 干净的纯 FSM 会话（推荐）
pi -ne -e /absolute/path/to/fsm-compatible/src/index.ts

# root 确需额外扩展时逐个显式 -e（会被规范化并入 child 必载 bundle）
```

`-ne` 禁用一切被发现/配置/内置扩展，显式 `-e` 仍加载——这是 FSM 会话与全局插件环境（如 omp-v2）隔离的正确方式。

**子会话天然干净**：child 由协调器以 `-ne -e <bundle>` 启动，bundle = fsm-compatible + 配置的 requiredExtensions（FSM factory 最后加载），父进程是 CLI `-e` 还是项目安装不影响 child 必载。child 不会继承 omp-v2 之类的东西。

## subagent 归谁管（现状）

**fsm-compatible 自己的原生协调器**（`src/children/native-*`）：冻结名单准入、真实 Pi RPC 持久子会话、深度/血缘、必载扩展、消息/停止/崩溃恢复。

- **不再依赖** `third-party-plugins/pi-subagents`；旧的 detached `agent-tool.ts` 已不在运行路径。
- omp-v2 自己的 subagent 执行要求 pi-subagents——那是 omp 的依赖链，与 FSM 无关，也是两套系统不该混跑的又一例证。

派发要点（老坑）：

- 第一次新 actor 会消费 root session 的 **dispatch FIFO**；空队列时 Agent 直接拒绝（`requires_dispatch` 查的是队列计数）。
- 宿主名单默认 `["general"]`（配置 `allowedAgentNames`），与 dispatch 写的 FSM skill 名**不是同一个名字**。
- 持久化会话的策略只能收窄：改配置文件不能扩大已建会话的名单或删必载扩展。

## 快速故障排查

| 症状 | 原因 → 处置 |
| --- | --- |
| 开局所有工具被拒，提示建 task | 加载了门禁类扩展（如 omp-v2）→ `-ne -e` 重启 FSM 会话 |
| FSM 状态内 task 工具行为怪异/被拒 | `task` 被归一为 `Agent`，属预期；FSM 会话内不要用外部 task 系统 |
| Agent 派发被拒 | 依次查：dispatch 队列是否为空、`subagent_type` 是否在冻结名单、是否超深度上限 |
| 进不了 FSM / 提示 not-ready | daemon 未跑、capabilities 不符、或缺 config——插件 fail-closed，不会无门禁降级 |

## 边界

本 SKILL 只覆盖运行注意事项。插件能力边界、测试证据与已知缺口见插件 `README.md` 与 `docs/test-reports/`。
