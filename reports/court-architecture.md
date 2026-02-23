# 朝廷架构 - 基于 pi Extension 的多层 Agent 系统

## 1. 概述

朝廷架构是一个基于 pi-mono Extension 系统构建的多层 Agent 委托框架。它将 pi 主进程的 Agent 改造为只读的"丞相"角色（仅拥有 `read` + `delegate` 工具），负责任务分析与分配；通过 `delegate` 工具 spawn 独立 pi 子进程作为"九卿"（中间管理层，可继续委托）或"执行层"（最底层 worker，只有执行工具）；同时在每轮结束后自动 spawn 无状态的"史官"子进程，对丞相的输出进行审查和记录。整个系统通过一个 Extension（`court`）实现，利用环境变量 `PI_COURT_ROLE` 区分角色，通过事件钩子（`before_agent_start`、`agent_end`、`context`）控制行为注入和上下文过滤，通过 `appendEntry` 实现持久化但不占用 LLM 上下文的记录存储。

## 2. 角色定义

### 2.1 丞相（Chancellor）

**身份**：pi 主进程的主 Agent，用户直接交互的对象。

**职责**：
- 接收用户输入，分析任务需求
- 制定执行计划，决定任务拆分策略
- 通过 `delegate` 工具将子任务分配给九卿或执行层
- 汇总下级返回的结果，生成面向用户的总结

**工具限制**：
- 仅拥有 `read` 和 `delegate` 两个工具
- 通过 `session_start` 事件中调用 `pi.setActiveTools(["read", "delegate"])` 实现
- 不能直接执行代码（无 `bash`/`write`/`edit`）

**行为约束**：
- 分配完任务后生成总结即停止，等待用户下一条指令
- 角色系统提示词通过 `before_agent_start` 事件注入

**角色判定**：`process.env.PI_COURT_ROLE` 未设置或值为 `"chancellor"` 时激活。

### 2.2 史官（Historian）

**身份**：由 `agent_end` 事件钩子触发的临时子进程，非常驻进程。

**职责**：
- 对丞相本轮输出进行审查和检查
- 输出检查建议（注入丞相下一轮上下文）和记录摘要（持久化存储）

**生命周期**：
- 由丞相每次完成后（`agent_end` 事件）自动 spawn
- 每次都是全新进程，零上下文残留
- 执行完毕后进程退出

**输入**：
- 丞相本轮输出（从 `agent_end` 事件的 `messages` 提取）
- 史官的 prompt 文件（`~/.pi/agent/prompts/historian.md`，用户可编辑）
- 之前的记录摘要（从 `appendEntry` 持久化数据中读取最近几条）

**输出**：
- 检查建议 → 通过 `pi.sendMessage({ deliverAs: "nextTurn" })` 注入丞相下一轮对话
- 记录摘要 → 通过 `pi.appendEntry("historian-record", data)` 持久化，不进入 LLM 上下文

**spawn 命令**：
```
spawn("pi", [
  "--mode", "json",
  "--no-session",
  "--tools", "read",
  "-p", task
])
```

**用户交互**：用户可通过 `/historian` 命令查看记录、编辑 prompt、与史官对话。

### 2.3 九卿（Ministers）

**身份**：由丞相调用 `delegate` 工具时 spawn 的中间管理层子进程。

**职责**：
- 执行丞相分配的复合子任务
- 可继续调用 `delegate` 工具向下委托（拥有完整工具 + delegate）
- 有自己的角色定义（通过 `.md` 文件中的系统提示词定义专长）

**工具集**：完整工具（`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`）+ `delegate` 工具。

**角色判定**：环境变量 `PI_COURT_ROLE=minister`。

**spawn 命令**：
```
spawn("pi", [
  "--mode", "json",
  "--no-session",
  "--append-system-prompt", agentFile,
  "-p", task
], { env: { PI_COURT_ROLE: "minister" } })
```

**角色定义文件**：`~/.pi/agent/agents/*.md`，每个文件定义一个九卿的专长领域和行为规范。

### 2.4 执行层（Workers）

**身份**：由丞相或九卿调用 `delegate` 工具时 spawn 的最底层子进程。

**职责**：
- 执行具体的原子任务（读写文件、运行命令、搜索代码等）
- 不可继续委托（无 `delegate` 工具）

**工具集**：`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`（仅执行工具）。

**角色判定**：环境变量 `PI_COURT_ROLE=worker`。

**spawn 命令**：
```
spawn("pi", [
  "--mode", "json",
  "--no-session",
  "--tools", "read,write,edit,bash,grep,find,ls",
  "--append-system-prompt", agentFile,
  "-p", task
], { env: { PI_COURT_ROLE: "worker" } })
```

### 2.5 角色对比表

| 属性 | 丞相 | 史官 | 九卿 | 执行层 |
|------|------|------|------|--------|
| 进程类型 | 主进程 | 临时子进程 | 子进程 | 子进程 |
| 触发方式 | 用户输入 | `agent_end` 事件 | `delegate` 工具 | `delegate` 工具 |
| 工具集 | `read` + `delegate` | `read` | 完整 + `delegate` | 完整（无 delegate） |
| 可委托 | 是 | 否 | 是 | 否 |
| 上下文 | 持久（session） | 零残留（每次新进程） | 隔离（`--no-session`） | 隔离（`--no-session`） |
| 环境变量 | 未设置/`chancellor` | N/A | `minister` | `worker` |
| 用户可见 | 直接交互 | 通过 `/historian` 命令 | 不可见（结果返回丞相） | 不可见 |

## 3. 文件结构

### 3.1 Extension 目录

```
.pi/extensions/court/
├── index.ts              ← Extension 入口（角色判断 + 事件/工具/命令注册）
├── historian.ts          ← 史官逻辑（spawn 子进程 + 解析 JSON 输出）
├── delegate.ts           ← delegate 工具定义（spawn 九卿/执行层）
├── state.ts              ← 内存状态管理（任务追踪、史官建议缓存）
└── types.ts              ← 类型定义（角色、任务、记录等）
```

### 3.2 用户配置目录

```
~/.pi/agent/
├── prompts/
│   └── historian.md      ← 史官 prompt（用户可编辑，定义审查规则和记录格式）
└── agents/
    ├── architect.md      ← 九卿角色定义示例：架构师
    ├── coder.md          ← 九卿角色定义示例：编码者
    ├── reviewer.md       ← 九卿角色定义示例：审查者
    └── researcher.md     ← 执行层角色定义示例：调研员
```

### 3.3 文件职责说明

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `index.ts` | 根据 `PI_COURT_ROLE` 判断角色，注册对应的事件钩子、工具和命令 | `default` (ExtensionFactory) |
| `historian.ts` | 封装史官 spawn 逻辑：构建 prompt、启动子进程、解析 JSON 输出、分离建议与记录 | `runHistorian(messages, ctx, pi)` |
| `delegate.ts` | 定义 `delegate` 工具的 ToolDefinition：参数 schema、spawn 逻辑、结果解析、渲染 | `delegateTool: ToolDefinition` |
| `state.ts` | 管理运行时状态：当前任务列表、史官最近建议、上下文过滤规则 | `CourtState` class |
| `types.ts` | 角色枚举、任务描述接口、史官记录接口、delegate 参数/结果接口 | 类型定义 |

## 4. 核心实现

### 4.1 Extension 入口逻辑（index.ts）

Extension 入口是整个架构的路由中枢。根据 `PI_COURT_ROLE` 环境变量判断当前进程角色，注册不同的功能集：

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { delegateTool } from "./delegate.js"
import { runHistorian } from "./historian.js"
import { CourtState } from "./state.js"
import type { CourtRole } from "./types.js"

export default function court(pi: ExtensionAPI): void {
  const role: CourtRole = (process.env.PI_COURT_ROLE as CourtRole) || "chancellor"

  // ── 执行层：不注册任何东西 ──
  // worker 子进程只需要内置工具，court extension 对其透明
  if (role === "worker") return

  // ── 九卿：只注册 delegate 工具 ──
  // 允许九卿继续向下委托，但不注册丞相特有的事件钩子
  if (role === "minister") {
    pi.registerTool(delegateTool)
    return
  }

  // ── 丞相：完整逻辑 ──
  const state = new CourtState()

  // 1. 会话启动时限制工具集
  pi.on("session_start", async (_event, _ctx) => {
    pi.setActiveTools(["read", "delegate"])
  })

  // 2. Agent 循环开始前注入丞相角色 + 史官上次进言
  pi.on("before_agent_start", async (_event, _ctx) => {
    const lastAdvice = state.getLastHistorianAdvice()
    let systemPrompt = CHANCELLOR_SYSTEM_PROMPT
    if (lastAdvice) {
      systemPrompt += `\n\n## 史官进言\n${lastAdvice}`
    }
    return { systemPrompt }
  })

  // 3. Agent 循环结束后触发史官
  pi.on("agent_end", async (event, ctx) => {
    const result = await runHistorian(event.messages, ctx, pi)
    if (result.advice) {
      state.setLastHistorianAdvice(result.advice)
      // 将建议注入丞相下一轮（用户发送下一条消息时生效）
      pi.sendMessage(
        {
          customType: "historian-advice",
          content: result.advice,
          display: false,
        },
        { deliverAs: "nextTurn" }
      )
    }
    if (result.record) {
      // 持久化记录（不进 LLM 上下文）
      pi.appendEntry("historian-record", result.record)
    }
  })

  // 4. 上下文过滤：已完成任务替换为摘要、史官原始记录不进上下文
  pi.on("context", async (event, _ctx) => {
    return {
      messages: state.filterContext(event.messages),
    }
  })

  // 5. 注册 delegate 工具
  pi.registerTool(delegateTool)

  // 6. 注册用户命令
  pi.registerCommand("historian", {
    description: "查看史官记录、编辑 prompt、与史官对话",
    handler: async (args, ctx) => {
      // 子命令：view / edit / chat
      // 实现略
    },
  })

  pi.registerCommand("status", {
    description: "查看当前朝廷状态（进行中的任务、角色信息）",
    handler: async (_args, ctx) => {
      // 显示当前任务列表和状态
      // 实现略
    },
  })
}
```

**设计要点**：

- `worker` 角色完全跳过注册，court extension 对其透明。这保证了执行层的轻量性——它只使用 pi 内置工具，不加载任何额外逻辑。
- `minister` 角色只注册 `delegate` 工具。九卿的角色定义通过 `--append-system-prompt` 参数从 `.md` 文件注入，不需要 Extension 的 `before_agent_start` 事件。
- `chancellor` 注册完整的事件链、工具和命令。

### 4.2 事件钩子详解

#### 4.2.1 `session_start` — 工具集限制

```typescript
pi.on("session_start", async () => {
  pi.setActiveTools(["read", "delegate"])
})
```

利用 `ExtensionAPI.setActiveTools()` 将丞相的可用工具限制为只读 + 委托。这确保丞相无法直接执行代码修改操作。

**API 基础**：`setActiveTools(names)` 是 pi Extension 系统的运行时 action，设置后立即生效。LLM 只能看到并调用活动工具列表中的工具。

#### 4.2.2 `before_agent_start` — 角色注入

```typescript
pi.on("before_agent_start", async () => {
  return {
    systemPrompt: CHANCELLOR_SYSTEM_PROMPT + historianAdvice,
  }
})
```

每次用户提交 prompt 后、Agent 循环启动前触发。返回的 `systemPrompt` 会链式替换当前系统提示词（如果有多个 Extension 返回 `systemPrompt`，后一个收到前一个修改后的值）。

此处注入丞相的角色定义（"你是丞相，只负责分析和委托..."）以及史官上一轮的建议。

#### 4.2.3 `agent_end` — 触发史官

```typescript
pi.on("agent_end", async (event, ctx) => {
  const result = await runHistorian(event.messages, ctx, pi)
  // ... 处理建议和记录
})
```

丞相的 Agent 循环结束后触发。`event.messages` 包含本轮的完整消息列表。此处调用 `runHistorian()` spawn 史官子进程。

**注意**：`agent_end` 是同步阻塞的——在史官完成前，用户看不到丞相的最终输出。如果史官执行时间过长，可以考虑在后台运行并在下一轮开始时检查结果。

#### 4.2.4 `context` — 上下文过滤

```typescript
pi.on("context", async (event) => {
  return { messages: state.filterContext(event.messages) }
})
```

每次 LLM 调用前触发。接收 `structuredClone` 后的消息列表副本，返回修改后的版本。过滤逻辑包括：

- 已完成任务的详细 delegate 结果替换为简短摘要
- 史官注入的原始建议消息（`customType: "historian-advice"`）在过了一定轮次后移除
- 确保只保留对当前决策有用的上下文

### 4.3 delegate 工具（delegate.ts）

delegate 工具是丞相和九卿向下委托任务的核心机制。设计参考了 pi-mono 自带的 `subagent` 示例扩展的 spawn 模式。

```typescript
import { spawn } from "node:child_process"
import { Type } from "@sinclair/typebox"
import type { ToolDefinition, ExtensionContext } from "@mariozechner/pi-coding-agent"

const DelegateParams = Type.Object({
  role: Type.Union([Type.Literal("minister"), Type.Literal("worker")], {
    description: "目标角色：minister（可继续委托）或 worker（只执行）",
  }),
  agent: Type.String({
    description: "Agent 名称，对应 ~/.pi/agent/agents/ 下的 .md 文件",
  }),
  task: Type.String({
    description: "分配给该 Agent 的具体任务描述",
  }),
  cwd: Type.Optional(Type.String({
    description: "工作目录（默认继承当前目录）",
  })),
})

export const delegateTool: ToolDefinition = {
  name: "delegate",
  label: "Delegate",
  description: "将任务委托给下级 Agent（minister 可继续委托，worker 只执行）",
  parameters: DelegateParams,

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const agentFile = resolveAgentFile(params.agent)  // ~/.pi/agent/agents/{name}.md

    const args: string[] = [
      "--mode", "json",
      "--no-session",
    ]

    if (params.role === "worker") {
      args.push("--tools", "read,write,edit,bash,grep,find,ls")
    }

    if (agentFile) {
      args.push("--append-system-prompt", agentFile)
    }

    args.push("-p", `Task: ${params.task}`)

    const env = {
      ...process.env,
      PI_COURT_ROLE: params.role,
    }

    // spawn pi 子进程，解析 JSON 流式输出
    const result = await spawnPiProcess(args, {
      cwd: params.cwd ?? ctx.cwd,
      env,
      signal,
      onUpdate,
    })

    return {
      content: [{ type: "text", text: result.output || "(no output)" }],
      details: result,
      isError: result.exitCode !== 0,
    }
  },
}
```

**关键设计**：

- `--mode json`：子进程以 JSON 模式输出，便于父进程解析结构化结果
- `--no-session`：子进程不持久化 session，每次调用都是干净的上下文
- `--tools`：仅 worker 角色显式限制工具集；minister 使用默认工具集（由 court extension 在子进程中注册 delegate）
- `--append-system-prompt`：从 `.md` 文件注入角色定义，不需要在 Extension 中硬编码
- 环境变量 `PI_COURT_ROLE`：传递给子进程，子进程加载 court extension 时据此判断自身角色

### 4.4 史官逻辑（historian.ts）

史官是一个零状态的审查者。每次运行都是全新进程，通过 prompt 文件定义行为。

```typescript
import { spawn } from "node:child_process"
import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent"

interface HistorianResult {
  advice: string | null   // 注入丞相下一轮的建议
  record: unknown | null  // 持久化记录数据
}

export async function runHistorian(
  messages: AgentMessage[],
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Promise<HistorianResult> {
  // 1. 构建 prompt
  const chancellorOutput = extractLastAssistantText(messages)
  const historianPromptFile = resolveHistorianPrompt()  // ~/.pi/agent/prompts/historian.md
  const recentRecords = getRecentRecords(ctx, 5)        // 最近 5 条 appendEntry 记录

  const task = buildHistorianTask(chancellorOutput, recentRecords)

  // 2. spawn 史官子进程
  const args: string[] = [
    "--mode", "json",
    "--no-session",
    "--tools", "read",
    "-p", task,
  ]

  if (historianPromptFile) {
    args.push("--append-system-prompt", historianPromptFile)
  }

  const result = await spawnPiProcess(args, {
    cwd: ctx.cwd,
    signal: undefined,
  })

  // 3. 解析输出（约定 JSON 格式：{ advice, record }）
  return parseHistorianOutput(result.output)
}
```

**零状态设计**：

- `--no-session`：不创建 session 文件
- 不设置 `PI_COURT_ROLE`（史官不加载 court extension 的任何角色逻辑，也可以显式设为 worker 跳过注册）
- 每次 spawn 新进程，无上下文残留
- 只有 `read` 工具——史官可以读取文件以验证丞相的分析，但不能修改任何内容

### 4.5 命令注册

#### `/historian` 命令

提供三个子命令：

| 子命令 | 功能 |
|--------|------|
| `/historian` 或 `/historian view` | 显示最近的史官记录（从 `appendEntry` 读取） |
| `/historian edit` | 打开史官 prompt 文件编辑器（`~/.pi/agent/prompts/historian.md`） |
| `/historian chat <message>` | 启动一次性史官对话（spawn 临时子进程，传入用户消息） |

实现时使用 `ExtensionCommandContext` 的 `waitForIdle()` 确保在 Agent 空闲时执行。

#### `/status` 命令

显示当前朝廷状态：

- 当前角色（始终是 chancellor）
- 可用 Agent 列表（扫描 `~/.pi/agent/agents/` 目录）
- 最近的史官建议摘要
- 进行中的任务（如果有）

### 4.6 上下文控制策略

上下文控制通过 `context` 事件和 `appendEntry` 的组合实现：

| 机制 | 用途 | 进入 LLM 上下文 |
|------|------|-----------------|
| `context` 事件过滤 | 替换已完成任务的详细结果为摘要 | 是（过滤后的版本） |
| `context` 事件过滤 | 移除过期的史官建议消息 | 否（被过滤掉） |
| `appendEntry` | 持久化史官记录 | 否 |
| `sendMessage({ deliverAs: "nextTurn" })` | 注入史官建议到下一轮 | 是（作为下一轮的注入消息） |
| `before_agent_start` 返回 `systemPrompt` | 注入丞相角色和史官建议 | 是（作为系统提示词） |

**过滤规则示例**（`state.ts` 中的 `filterContext` 方法）：

```typescript
filterContext(messages: AgentMessage[]): AgentMessage[] {
  return messages.map(msg => {
    // 1. delegate 工具结果如果已有摘要，替换为摘要
    if (isToolResult(msg) && msg.toolName === "delegate" && this.hasSummary(msg.toolCallId)) {
      return this.createSummaryMessage(msg)
    }
    // 2. 史官原始记录（customType: "historian-advice"）超过 2 轮后移除
    if (isCustomMessage(msg) && msg.customType === "historian-advice") {
      return this.isRecent(msg, 2) ? msg : null
    }
    return msg
  }).filter(Boolean)
}
```

## 5. 事件时序

### 5.1 标准流程

```
用户输入
  │
  ▼
[input 事件] ─── 记录用户输入到状态
  │
  ▼
[before_agent_start 事件]
  ├── 注入丞相角色系统提示词
  └── 附加史官上次进言（如有）
  │
  ▼
丞相 Agent 循环开始
  │
  ├── [context 事件] ─── 过滤上下文（每次 LLM 调用前）
  │     ├── 已完成任务结果 → 替换为摘要
  │     └── 过期史官建议 → 移除
  │
  ├── 丞相思考，调用 delegate 工具（可并行多个）
  │     │
  │     ├── spawn 九卿子进程（PI_COURT_ROLE=minister）
  │     │     ├── 九卿加载 court extension → 只注册 delegate 工具
  │     │     ├── 九卿执行任务，可能继续 delegate → spawn worker
  │     │     └── 九卿完成 → JSON 输出返回
  │     │
  │     └── spawn 执行层子进程（PI_COURT_ROLE=worker）
  │           ├── worker 加载 court extension → 跳过所有注册
  │           ├── worker 使用内置工具执行任务
  │           └── worker 完成 → JSON 输出返回
  │
  ├── delegate 工具结果返回丞相
  │
  └── 丞相生成总结 → Agent 循环结束
  │
  ▼
[agent_end 事件] ─── 触发史官
  │
  ├── spawn 史官子进程（独立进程，--no-session，仅 read 工具）
  │     ├── 读取丞相本轮输出
  │     ├── 读取史官 prompt 文件
  │     ├── 读取最近记录摘要
  │     ├── 输出 JSON: { advice, record }
  │     └── 进程退出
  │
  ├── advice → sendMessage({ deliverAs: "nextTurn" })
  │     └── 丞相下一轮开始时收到
  │
  └── record → appendEntry("historian-record", data)
        └── 持久化到 session 文件，不进 LLM 上下文
  │
  ▼
用户看到丞相回复
  ├── 可用 /historian 查看记录
  ├── 可用 /status 查看状态
  └── 输入下一条指令 → 回到顶部
```

### 5.2 九卿递归委托流程

```
丞相 delegate(role: "minister", agent: "architect", task: "...")
  │
  ▼
九卿子进程启动
  ├── court extension 加载 → 检测 PI_COURT_ROLE=minister
  ├── 只注册 delegate 工具
  ├── --append-system-prompt architect.md → 角色定义注入
  │
  ├── 九卿分析任务，调用 delegate(role: "worker", ...)
  │     │
  │     ▼
  │   worker 子进程启动
  │     ├── court extension 加载 → 检测 PI_COURT_ROLE=worker → return
  │     ├── 使用 --tools 限定的工具集执行
  │     └── 完成 → JSON 输出返回九卿
  │
  ├── 九卿汇总 worker 结果
  └── 完成 → JSON 输出返回丞相
```

## 6. 关键设计决策

| # | 决策 | 选项 | 选择 | 理由 |
|---|------|------|------|------|
| 1 | 角色区分机制 | A. 环境变量<br>B. CLI flag<br>C. 配置文件 | A. 环境变量 `PI_COURT_ROLE` | 最简单且可通过 `spawn` 直接传递；子进程无需解析额外配置 |
| 2 | 丞相工具限制方式 | A. `setActiveTools`<br>B. `tool_call` 拦截 | A. `setActiveTools(["read", "delegate"])` | 从源头限制，LLM 根本看不到其他工具的 schema，比拦截更可靠 |
| 3 | 史官进程模型 | A. 常驻后台进程<br>B. 每次新 spawn | B. 每次新 spawn | 零上下文残留确保独立性；史官是审查者，不应携带累积偏见 |
| 4 | 史官建议注入方式 | A. `before_agent_start` systemPrompt<br>B. `sendMessage({ deliverAs: "nextTurn" })` | B. `sendMessage` + `before_agent_start` 双路 | `sendMessage` 作为对话消息出现，`systemPrompt` 作为角色级指导；双路确保不同粒度的建议都能生效 |
| 5 | 史官记录持久化 | A. 文件系统<br>B. `appendEntry` | B. `appendEntry("historian-record", data)` | 利用 pi 内置的 session 持久化机制；`appendEntry` 写入 session 文件但不进 LLM 上下文，天然隔离 |
| 6 | 子进程通信协议 | A. stdin/stdout JSON<br>B. RPC<br>C. `--mode json` | C. `--mode json` | pi 原生支持 JSON 模式输出，直接复用已有基础设施；与 subagent 示例一致 |
| 7 | 九卿角色定义方式 | A. Extension 内硬编码<br>B. `--append-system-prompt` 外部文件 | B. 外部 `.md` 文件 | 用户可编辑、可版本控制、可动态添加；不需要修改代码即可新增角色 |
| 8 | worker 是否加载 court extension | A. 加载但跳过<br>B. 不加载 | A. 加载但 `return` 跳过 | court extension 在 `.pi/extensions/` 目录中会被自动发现和加载；通过 `if (role === "worker") return` 实现零开销跳过 |
| 9 | 上下文过滤策略 | A. 仅 `context` 事件<br>B. `context` + `appendEntry` 组合 | B. 组合方案 | `context` 过滤活跃消息，`appendEntry` 隔离持久化记录；两者配合实现精确的上下文控制 |
| 10 | delegate 支持并行 | A. 单次调用<br>B. 支持并行 tasks | B. 支持并行（参考 subagent） | LLM 可以并行调用多个 delegate tool_use，pi 的 Agent 循环原生支持并行工具调用 |

## 7. 扩展点

### 7.1 新增九卿角色

在 `~/.pi/agent/agents/` 目录下新建 `.md` 文件即可。文件内容为角色的系统提示词，定义其专长和行为规范。无需修改代码。

### 7.2 自定义史官行为

编辑 `~/.pi/agent/prompts/historian.md` 可以自定义史官的审查规则、记录格式和建议风格。也可以通过 `/historian edit` 命令在运行时编辑。

### 7.3 任务优先级与调度

`state.ts` 可扩展为支持任务队列和优先级排序。例如：丞相可以标记某些 delegate 任务为"高优先级"，优先分配给性能更强的模型。

### 7.4 多模型支持

delegate 工具可扩展 `model` 参数，允许丞相为不同任务指定不同模型。例如：简单的文件搜索任务使用轻量模型，复杂的架构设计任务使用推理模型。实现方式是在 spawn 时添加 `--model` 参数。

### 7.5 结果缓存

对于重复或相似的 delegate 任务，可在 `state.ts` 中实现基于任务描述哈希的缓存层，避免重复 spawn 子进程。

### 7.6 自定义压缩策略

通过 `session_before_compact` 事件，可以实现朝廷架构感知的压缩策略。例如：压缩时保留所有九卿角色定义、保留最近 N 轮的 delegate 结果摘要、保留史官最近的关键建议。

### 7.7 监控与可观测性

扩展 `/status` 命令或新增 `/dashboard` 命令，展示：
- 历史任务的成功/失败率
- 各角色的 token 消耗统计
- 史官建议的采纳率（通过对比丞相行为变化判断）

### 7.8 动态角色发现

当前 delegate 工具需要指定 `agent` 名称。可扩展为支持动态发现：丞相调用 delegate 时，工具自动扫描可用 agents 目录，将角色列表提供给 LLM 选择。实现方式类似 subagent 示例中的 `discoverAgents()` 函数。

### 7.9 安全增强

- 通过 `tool_call` 事件拦截 worker 的危险操作（类似 `permission-gate.ts` 示例）
- 为 delegate 工具添加 `confirm` 参数，在 spawn 前通过 `ui.confirm()` 请求用户确认
- 限制递归深度（九卿继续 delegate 的最大层级）
