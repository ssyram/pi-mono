# 朝廷架构 -- 项目设计规格

## 1. 项目愿景

在 pi-mono Coding Agent 之上构建多层委托系统，将单一 Agent 拆分为"分析-审查-管理-执行"四层角色，解决单 Agent 架构下上下文膨胀、职责混杂、无法自审的问题。系统以一个 Extension 实现，无需 fork 或修改 pi-mono 核心代码。

## 2. 架构概览

```
用户
 │
 ▼
┌─────────────────────────────────────────────────┐
│  丞相 (Chancellor)  ── pi 主进程                  │
│  [read, delegate]                               │
│                                                 │
│  ┌──── delegate ────┐   ┌──── delegate ────┐    │
│  ▼                  ▼   ▼                  ▼    │
│  九卿 (Minister)    九卿  执行层 (Worker)   执行层 │
│  [全部+delegate]    ...  [全部,无delegate]   ...  │
│  │                                              │
│  └── delegate ──▶ 执行层                         │
└─────────────────────────────────────────────────┘
         │ agent_end
         ▼
      史官 (Historian)  ── 临时子进程, 零状态
      [read]
      输出: advice → 丞相下一轮 | record → 持久化
```

信息流向：用户 -> 丞相 -> (delegate) -> 九卿/执行层 -> 结果回传丞相 -> 用户。史官在每轮结束后异步审查丞相输出，建议注入下一轮。

所有子进程通过 `spawn("pi", [...])` 创建，以 `--no-session --mode json` 运行，与主进程完全隔离。

## 3. 角色规格

### 3.1 丞相 (Chancellor)

- **身份**: pi 主进程的主 Agent，用户直接交互对象
- **职责**: 接收用户输入、分析任务、制定拆分策略、delegate 给下级、汇总结果
- **工具集**: `read` + `delegate`（通过 `setActiveTools` 从源头限制，LLM 看不到其他工具 schema）
- **上下文**: 持久 session，跨轮保留
- **触发**: 用户输入
- **角色注入**: `before_agent_start` 事件返回 systemPrompt

### 3.2 史官 (Historian)

- **身份**: `agent_end` 事件自动 spawn 的临时子进程
- **职责**: 审查丞相本轮输出，输出检查建议 + 记录摘要
- **工具集**: 仅 `read`（可验证文件，不可修改）
- **上下文**: 零残留（`--no-session`，每次全新进程）
- **触发**: 丞相 Agent 循环结束时的 `agent_end` 事件
- **输出双通道**: advice 通过 `sendMessage({ deliverAs: "nextTurn" })` 注入丞相下一轮；record 通过 `appendEntry` 持久化但不进 LLM 上下文
- **行为定义**: 用户可编辑的 prompt 文件 `~/.pi/agent/prompts/historian.md`

### 3.3 九卿 (Ministers)

- **身份**: 丞相通过 `delegate(role: "minister")` spawn 的中间管理层
- **职责**: 执行复合子任务，可继续向下 delegate
- **工具集**: 完整内置工具 + `delegate`
- **上下文**: 隔离（`--no-session`）
- **角色定义**: `~/.pi/agent/agents/*.md` 外部文件，通过 `--append-system-prompt` 注入

### 3.4 执行层 (Workers)

- **身份**: 丞相或九卿通过 `delegate(role: "worker")` spawn 的最底层
- **职责**: 执行原子任务（读写文件、运行命令等），不可继续委托
- **工具集**: `read/write/edit/bash/grep/find/ls`（通过 `--tools` 显式限定，无 delegate）
- **上下文**: 隔离（`--no-session`）

### 3.5 角色对比总表

| 属性 | 丞相 | 史官 | 九卿 | 执行层 |
|------|------|------|------|--------|
| 进程 | 主进程 | 临时子进程 | 子进程 | 子进程 |
| 触发 | 用户输入 | `agent_end` | `delegate` | `delegate` |
| 工具 | read + delegate | read | 全部 + delegate | 全部 (无 delegate) |
| 可委托 | 是 | 否 | 是 | 否 |
| 上下文 | 持久 session | 零残留 | 隔离 | 隔离 |
| 环境变量 | 无/`chancellor` | N/A | `minister` | `worker` |
| 用户可见 | 直接交互 | `/historian` 命令 | 不可见 | 不可见 |

## 4. 核心机制

### 4.1 角色区分

单一 Extension（`court`）通过环境变量 `PI_COURT_ROLE` 判断当前进程角色，注册不同功能集：

- `worker`: 跳过所有注册（Extension 对其透明，零开销）
- `minister`: 仅注册 `delegate` 工具
- `chancellor`/未设置: 注册完整事件链、工具、用户命令

子进程启动时父进程通过 `spawn` 的 `env` 参数传递角色值。

### 4.2 工具限制

丞相在 `session_start` 事件中调用 `setActiveTools(["read", "delegate"])`。这是源头级限制——LLM 的工具 schema 中根本不包含被排除的工具，比拦截 `tool_call` 更可靠。

Worker 通过 CLI `--tools` 参数限制，不依赖 Extension。

### 4.3 任务委托 (delegate)

`delegate` 是一个自定义 ToolDefinition，参数包括 `role`（minister/worker）、`agent`（角色名，对应 `.md` 文件）、`task`（任务描述）。

执行时 spawn 独立 pi 子进程，关键 flags：
- `--mode json`: 结构化输出，便于父进程解析
- `--no-session`: 不持久化，每次干净上下文
- `--append-system-prompt <file>`: 从外部 `.md` 注入角色定义

LLM 可并行调用多个 delegate（pi Agent 循环原生支持并行 tool_use）。

### 4.4 史官审查

每轮 `agent_end` 触发，提取丞相本轮输出 + 最近几条历史记录作为 prompt，spawn 史官子进程。史官输出 JSON `{ advice, record }`：

- **advice**: 通过 `sendMessage({ deliverAs: "nextTurn" })` 注入丞相下一轮对话；同时通过 `before_agent_start` 的 systemPrompt 作为角色级指导。双路注入确保不同粒度都生效。
- **record**: 通过 `appendEntry("historian-record", data)` 写入 session 文件，不进 LLM 上下文。

每次新 spawn 确保史官不携带累积偏见。

### 4.5 上下文控制

通过 `context` 事件（每次 LLM 调用前触发）和 `appendEntry` 的组合：

| 机制 | 用途 | 进 LLM 上下文 |
|------|------|:---:|
| `context` 过滤 | 已完成 delegate 结果替换为摘要 | 是 (精简版) |
| `context` 过滤 | 过期史官建议移除 | 否 |
| `appendEntry` | 史官记录持久化 | 否 |
| `sendMessage(nextTurn)` | 史官建议注入 | 是 |
| `before_agent_start` | 角色 + 史官建议 | 是 (systemPrompt) |

`context` 事件接收的是 `structuredClone` 深拷贝，修改不影响持久化数据。

### 4.6 用户命令

- `/historian [view|edit|chat]`: 查看记录、编辑 prompt、与史官临时对话
- `/status`: 查看角色信息、可用 Agent 列表、进行中任务、最近史官建议

## 5. 技术选型

### 为什么选 Extension 路线而非 SDK

| 考量 | Extension | SDK |
|------|-----------|-----|
| 开发成本 | `.ts` 文件放目录即自动加载，零配置 | 需管理 TUI、Session、初始化步骤 |
| 运行时修改 | 30+ 事件钩子覆盖完整生命周期 | 事件钩子同样可用但需额外代码 |
| TUI 复用 | 完整复用 pi 原生 TUI | 需自行实现或通过 RPC 驱动 |
| 热重载 | `/reload` 即时生效 | 需重启应用 |
| 子 Agent | spawn 独立 pi 进程，Extension 自动加载 | 需手动配置 Extension 加载 |

核心结论：朝廷系统的所有功能（角色区分、工具限制、上下文过滤、史官触发、命令注册）均可通过 Extension 事件钩子和 API 实现，无需控制 Agent 创建过程，因此无需引入 SDK 的额外复杂度。

### 平台依赖

- **运行时**: pi-mono（`@mariozechner/pi-coding-agent`），Node.js 18+ 或 Bun
- **子进程通信**: `--mode json` 的 JSON stdout 输出
- **持久化**: pi 内置 `appendEntry`（session 文件级）
- **类型**: `@sinclair/typebox`（工具参数 schema）

## 6. 扩展点

| 方向 | 说明 | 实现路径 |
|------|------|---------|
| 新增九卿角色 | 在 `~/.pi/agent/agents/` 下新建 `.md` 文件 | 零代码修改 |
| 自定义史官行为 | 编辑 `~/.pi/agent/prompts/historian.md` | 用户可运行时修改 |
| 多模型分配 | delegate 工具扩展 `model` 参数 | spawn 时添加 `--model` |
| 任务优先级 | state 中实现任务队列和排序 | 扩展 `CourtState` |
| 结果缓存 | 基于任务描述哈希的缓存层 | 扩展 `CourtState` |
| 自定义压缩 | `session_before_compact` 事件保留关键上下文 | 新增事件 handler |
| 监控面板 | 扩展 `/status` 或新增 `/dashboard` | token 统计、成功率、史官采纳率 |
| 动态角色发现 | delegate 时自动扫描可用 agents 目录 | 类似 subagent 示例的 `discoverAgents()` |
| 安全增强 | `tool_call` 拦截危险操作、递归深度限制、确认弹窗 | 事件 handler + `ui.confirm()` |

## 7. 设计决策表

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 角色区分 | 环境变量 `PI_COURT_ROLE` | 最简单，spawn 直接传递，无需解析配置 |
| 2 | 丞相工具限制 | `setActiveTools` | 源头限制，LLM 看不到被排除工具的 schema |
| 3 | 史官进程模型 | 每次新 spawn | 零上下文残留，避免审查者累积偏见 |
| 4 | 史官建议注入 | `sendMessage(nextTurn)` + systemPrompt 双路 | 对话级 + 角色级双粒度 |
| 5 | 史官记录持久化 | `appendEntry` | 复用 pi 内置 session 持久化，天然不进 LLM 上下文 |
| 6 | 子进程通信 | `--mode json` stdout | pi 原生支持，复用已有基础设施 |
| 7 | 九卿角色定义 | 外部 `.md` 文件 + `--append-system-prompt` | 用户可编辑、可版本控制、零代码新增角色 |
| 8 | Worker 加载 Extension | 加载但 `return` 跳过 | Extension 自动发现不可关闭，通过立即返回实现零开销 |
| 9 | 上下文过滤 | `context` 事件 + `appendEntry` 组合 | 分别处理活跃消息过滤和持久化记录隔离 |
| 10 | 并行委托 | 原生支持 | LLM 并行 tool_use + pi Agent 循环原生并行执行 |

## 8. 约束与风险

| 类别 | 描述 | 缓解 |
|------|------|------|
| 同进程执行 | Extension 崩溃影响主进程（pi 无 Extension 沙盒） | 防御性编码；关键逻辑 try-catch |
| `agent_end` 阻塞 | 史官完成前用户看不到丞相输出 | 可改为后台运行，下一轮开始时检查结果 |
| 递归深度 | 九卿可无限 delegate，理论上无终止 | 需实现递归深度计数器（通过环境变量传递层级） |
| 子进程开销 | 每次 delegate 都 spawn 新 pi 进程，启动成本非零 | 简单任务考虑直接执行；复杂任务的 spawn 成本可接受 |
| session 只读 | Extension 事件 handler 中 `sessionManager` 只读 | 写操作限定在 `ExtensionCommandContext`（命令 handler） |
| 无法修改核心循环 | Extension 只能通过事件干预，不能改 Agent 循环逻辑 | 当前设计不需要修改核心循环；若未来需要则评估 SDK 路线 |
| 角色定义质量 | `.md` 文件的 prompt 质量直接影响九卿/史官效果 | 提供模板和最佳实践文档 |

## 9. 文件结构

```
.pi/extensions/court/
  index.ts          -- Extension 入口（角色路由 + 事件/工具/命令注册）
  historian.ts      -- 史官 spawn + 输出解析
  delegate.ts       -- delegate 工具定义
  state.ts          -- 运行时状态（任务追踪、建议缓存、上下文过滤规则）
  types.ts          -- 类型定义

~/.pi/agent/
  prompts/
    historian.md    -- 史官 prompt（用户可编辑）
  agents/
    *.md            -- 九卿/执行层角色定义（每文件一个角色）
```
