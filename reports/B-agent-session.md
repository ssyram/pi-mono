# B - 编排层（Agent Session）

## 概述

`AgentSession` 是 coding-agent 的**核心编排中枢**，位于底层 `Agent`（pi-agent-core 包）与上层运行模式（interactive/print/rpc）之间。它封装了完整的 Session 生命周期管理，包括：

- **Agent 状态代理**：消息列表、模型、thinking level 的读写
- **事件总线**：订阅/分发 Agent 事件，同时驱动 Session 持久化和扩展系统
- **压缩引擎**：自动/手动上下文压缩，含 overflow 恢复和阈值触发两条路径
- **自动重试**：可重试错误（429/5xx/overloaded）的指数退避重试
- **分支/树导航**：fork 创建新 Session 文件、navigateTree 在同一文件内切换分支
- **扩展系统集成**：ExtensionRunner 的创建、绑定、事件转发
- **Bash 执行**：独立的 bash 命令执行管道，支持流式输出
- **SDK 工厂**：`createAgentSession()` 提供一站式创建入口

全部代码约 2865 行（agent-session.ts），加上 sdk.ts（367 行）和 messages.ts（195 行）。

## 文件树

```
packages/coding-agent/src/core/
  agent-session.ts   (2865 行) - AgentSession 类 + 事件类型 + Skill 解析
  sdk.ts             (367 行)  - createAgentSession() 工厂 + re-exports
  messages.ts        (195 行)  - 自定义消息类型 + convertToLlm() 转换器

  # 依赖模块
  compaction/
    index.ts         - re-exports
    compaction.ts    - prepareCompaction(), compact(), shouldCompact()
    utils.ts         - 文件操作追踪、序列化
    branch-summarization.ts - generateBranchSummary()
  tools/
    index.ts         - 7 个内置工具 + createAllTools()
  extensions/
    index.ts         - ExtensionRunner, wrapRegisteredTools, wrapToolsWithExtensions
  session-manager.ts - 持久化层（Session 文件读写、分支管理）
  settings-manager.ts - 配置管理
  system-prompt.ts   - buildSystemPrompt()

  # 上游核心
  packages/agent/src/
    agent.ts         (559 行)  - Agent 类：prompt/continue/steer/followUp/_runLoop
    agent-loop.ts    - agentLoop/agentLoopContinue 生成器
    types.ts         - AgentState/AgentMessage/AgentEvent/AgentTool 类型
```

## 核心流程

### Session 初始化

入口为 `createAgentSession()` @ `sdk.ts:165`，完整调用链：

```
createAgentSession(options)
  1. 解析 cwd/agentDir/authStorage/modelRegistry/settingsManager/sessionManager
  2. 初始化 ResourceLoader（若未提供则 new DefaultResourceLoader + reload）
  3. 检查已有 Session（sessionManager.buildSessionContext()）
  4. 模型解析三级 fallback：
     a. options.model（直接指定）
     b. 已有 Session 中恢复 (modelRegistry.find)
     c. findInitialModel（settings 默认 -> provider 默认）
  5. thinkingLevel 解析：options -> Session 恢复 -> settings 默认 -> "medium"
  6. 构建 convertToLlmWithBlockImages 包装器（动态检查 blockImages 设置）
  7. new Agent({
       initialState: { systemPrompt: "", model, thinkingLevel, tools: [] },
       convertToLlm: convertToLlmWithBlockImages,
       transformContext: runner.emitContext,
       getApiKey: modelRegistry.getApiKeyForProvider,
       ...settings
     })
  8. 恢复消息：agent.replaceMessages(existingSession.messages)
  9. new AgentSession({ agent, sessionManager, ... })
  10. return { session, extensionsResult, modelFallbackMessage }
```

`AgentSession` 构造函数 @ `agent-session.ts:274`：
- 保存所有依赖引用
- 订阅 Agent 事件：`this.agent.subscribe(this._handleAgentEvent)`
- 调用 `_buildRuntime()` 构建工具集 + 扩展 + 系统提示词

### 主循环（prompt/continue）

**`prompt(text, options?)`** @ `agent-session.ts:706` 是主要入口：

```
prompt(text, options?)
  1. 扩展命令检查：text.startsWith("/") -> _tryExecuteExtensionCommand()
  2. 扩展 input 事件：extensionRunner.emitInput()（可拦截/转换）
  3. Skill/模板展开：_expandSkillCommand() + expandPromptTemplate()
  4. 流式中处理：若 isStreaming，按 streamingBehavior 分发到 steer/followUp 队列
  5. 刷新 bash 缓冲：_flushPendingBashMessages()
  6. 模型/API Key 验证
  7. 预检压缩：_checkCompaction(lastAssistant, false)
  8. 构建消息数组：
     - user message（含 images）
     - pendingNextTurnMessages（上一轮 nextTurn 消息）
     - before_agent_start 扩展注入的 custom messages
  9. 设置 system prompt（扩展可修改）
  10. agent.prompt(messages) -> Agent._runLoop() -> agentLoop()
  11. waitForRetry()（等待可能的自动重试完成）
```

Agent 的实际循环在 `packages/agent/src/agent.ts:405`：
```
_runLoop(messages?)
  -> agentLoop(messages, context, config, signal, streamFn)
  -> for await (event of stream): 更新内部状态 + emit 给 listeners
  -> finally: isStreaming = false, resolve runningPrompt
```

**消息队列系统**：
- `steer(text)` @ `:916` - 中断队列，工具执行间隙插入
- `followUp(text)` @ `:936` - 后续队列，Agent 空闲时处理
- `sendCustomMessage(message, options)` @ `:1010` - 扩展消息注入，支持 steer/followUp/nextTurn 三种模式
- `sendUserMessage(content, options)` @ `:1052` - 扩展触发的用户消息，跳过模板展开

### 工具注册与执行

**`_buildRuntime(options)`** @ `agent-session.ts:1961` 负责完整的工具注册流程：

```
_buildRuntime()
  1. createAllTools(cwd, opts) -> 7 个 base tools (read/bash/edit/write/grep/find/ls)
  2. _baseToolRegistry = Map<name, AgentTool>
  3. 创建 ExtensionRunner（如有扩展或 customTools）
  4. _bindExtensionCore(runner) - 绑定 sendMessage/setModel/getTools 等核心方法
  5. 收集扩展注册的工具 + SDK customTools
  6. wrapRegisteredTools() -> wrapToolsWithExtensions() 包装
  7. 合并为完整 _toolRegistry
  8. 确定 active tools（默认 read/bash/edit/write + 所有扩展工具）
  9. agent.setTools(wrappedActiveTools)
  10. _rebuildSystemPrompt() -> buildSystemPrompt() -> agent.setSystemPrompt()
```

**动态工具管理**：
- `setActiveToolsByName(names)` @ `:607` - 按名称激活工具子集，重建 system prompt
- `getActiveToolNames()` @ `:586` - 返回当前激活的工具名
- `getAllTools()` @ `:593` - 返回完整注册表中所有工具的 info

### 压缩触发

压缩有两个入口：手动 `compact()` 和自动 `_checkCompaction()`。

**自动压缩触发点** @ `agent-session.ts:1565`：
```
_checkCompaction(assistantMessage)
  # 在 agent_end 事件和 prompt() 预检时调用

  Case 1: Overflow（优先级高）
    条件：isContextOverflow(msg, contextWindow) && 同模型 && 非压缩后残留
    处理：移除错误消息 -> _runAutoCompaction("overflow", willRetry=true)
    后续：压缩完成后自动 agent.continue() 重试

  Case 2: Threshold
    条件：shouldCompact(contextTokens, contextWindow, settings)
    处理：_runAutoCompaction("threshold", willRetry=false)
    后续：不自动重试，等用户下一条消息
```

**手动压缩** `compact(customInstructions?)` @ `:1429`：
```
compact()
  1. _disconnectFromAgent() + abort()（暂停事件处理）
  2. prepareCompaction(pathEntries, settings) -> 确定压缩范围
  3. 扩展拦截：session_before_compact 事件（可取消/替换）
  4. 调用 compact() 或使用扩展提供的结果
  5. sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore)
  6. sessionManager.buildSessionContext() -> agent.replaceMessages()
  7. session_compact 扩展事件
  8. _reconnectToAgent()
```

**自动压缩** `_runAutoCompaction(reason, willRetry)` @ `:1615`：
```
与手动压缩逻辑相同，但：
- 不断开 Agent 事件连接
- 使用独立的 _autoCompactionAbortController
- 发出 auto_compaction_start/end 事件
- willRetry=true 时压缩后自动 setTimeout(() => agent.continue(), 100)
- 有排队消息时也会踢动 agent.continue()
```

### 分支管理

分支系统支持两种模式：

**1. Fork（创建新 Session 文件）** `fork(entryId)` @ `:2415`：
```
fork(entryId)
  1. 验证 entry 为 user message
  2. session_before_fork 扩展事件（可取消）
  3. 两种分支方式：
     - 无 parentId：sessionManager.newSession({ parentSession })
     - 有 parentId：sessionManager.createBranchedSession(parentId)
  4. 重建 agent 消息：buildSessionContext() -> replaceMessages()
  5. session_fork 扩展事件
  6. 返回 { selectedText, cancelled }
```

**2. Tree Navigation（同文件内切换）** `navigateTree(targetId, options)` @ `:2485`：
```
navigateTree(targetId, options)
  1. 收集需要总结的条目：collectEntriesForBranchSummary()
  2. session_before_tree 扩展事件（可取消/提供摘要/覆盖参数）
  3. 可选分支摘要：generateBranchSummary() 或扩展提供
  4. 确定新叶子位置：
     - user message -> 叶子 = parent，文本返回编辑器
     - 其他 -> 叶子 = targetId
  5. 写入 Session：branchWithSummary() 或 branch() 或 resetLeaf()
  6. 重建 agent 消息
  7. session_tree 扩展事件
```

**新 Session** `newSession(options?)` @ `:1135`：
```
newSession()
  1. session_before_switch 扩展事件（可取消）
  2. abort + reset + sessionManager.newSession()
  3. 可选 setup 回调（注入初始消息）
  4. session_switch 扩展事件
```

**切换 Session** `switchSession(sessionPath)` @ `:2325`：
```
switchSession(path)
  1. session_before_switch 扩展事件
  2. abort + 清空队列
  3. sessionManager.setSessionFile() + buildSessionContext()
  4. 恢复模型和 thinkingLevel
  5. _reconnectToAgent()
```

### SDK 工厂 createAgentSession()

**签名**：
```typescript
async function createAgentSession(
  options: CreateAgentSessionOptions = {}
): Promise<CreateAgentSessionResult>
```

**`CreateAgentSessionOptions`** @ `sdk.ts:41`：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cwd` | `string` | `process.cwd()` | 工作目录 |
| `agentDir` | `string` | `~/.pi/agent` | 全局配置目录 |
| `authStorage` | `AuthStorage` | `AuthStorage.create(...)` | 认证存储 |
| `modelRegistry` | `ModelRegistry` | `new ModelRegistry(...)` | 模型注册表 |
| `model` | `Model<any>` | 自动解析 | 指定模型 |
| `thinkingLevel` | `ThinkingLevel` | settings / "medium" | 思考等级 |
| `scopedModels` | `Array<{model, thinkingLevel}>` | `[]` | Ctrl+P 循环模型列表 |
| `tools` | `Tool[]` | `codingTools` | 启用的内置工具 |
| `customTools` | `ToolDefinition[]` | `[]` | 自定义工具 |
| `resourceLoader` | `ResourceLoader` | `DefaultResourceLoader` | 资源加载器 |
| `sessionManager` | `SessionManager` | `SessionManager.create(cwd)` | Session 管理器 |
| `settingsManager` | `SettingsManager` | `SettingsManager.create(cwd, agentDir)` | 设置管理器 |

**`CreateAgentSessionResult`** @ `sdk.ts:74`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `session` | `AgentSession` | 创建的 Session 实例 |
| `extensionsResult` | `LoadExtensionsResult` | 扩展加载结果（UI 上下文设置用） |
| `modelFallbackMessage` | `string?` | 模型回退警告 |

**SDK 模式与 TUI 模式的差异**：
- SDK 模式不需要调用 `bindExtensions()`（无 UI 上下文）
- SDK 模式可用 `SessionManager.inMemory()` 避免文件 I/O
- SDK 模式通过 `customTools` 注册自定义工具，而非扩展系统
- 两者共享相同的 `AgentSession` 实例和完整的压缩/重试/分支能力

## 关键类型/接口

### AgentSession 类

**公开属性**（只读）：
- `agent: Agent` - 底层 Agent 实例
- `sessionManager: SessionManager` - Session 持久化管理
- `settingsManager: SettingsManager` - 配置管理
- `state: AgentState` - 完整 Agent 状态
- `model: Model<any> | undefined` - 当前模型
- `thinkingLevel: ThinkingLevel` - 当前思考等级
- `isStreaming: boolean` - 是否正在流式响应
- `isCompacting: boolean` - 是否正在压缩
- `isRetrying: boolean` - 是否正在重试
- `isBashRunning: boolean` - 是否有 bash 命令运行中
- `messages: AgentMessage[]` - 完整消息列表
- `sessionFile: string | undefined` - Session 文件路径
- `sessionId: string` - Session ID
- `sessionName: string | undefined` - 显示名称
- `modelRegistry: ModelRegistry` - 模型注册表
- `resourceLoader: ResourceLoader` - 资源加载器
- `extensionRunner: ExtensionRunner | undefined` - 扩展运行器

**核心方法**：

| 方法 | 行号 | 说明 |
|------|------|------|
| `prompt(text, options?)` | :706 | 主入口：发送提示词 |
| `steer(text, images?)` | :916 | 中断队列消息 |
| `followUp(text, images?)` | :936 | 后续队列消息 |
| `sendCustomMessage(msg, opts?)` | :1010 | 扩展自定义消息 |
| `sendUserMessage(content, opts?)` | :1052 | 扩展触发用户消息 |
| `abort()` | :1121 | 中止当前操作 |
| `compact(instructions?)` | :1429 | 手动压缩 |
| `abortCompaction()` | :1542 | 取消压缩 |
| `setModel(model)` | :1211 | 设置模型 |
| `cycleModel(direction?)` | :1234 | 切换模型 |
| `setThinkingLevel(level)` | :1326 | 设置思考等级 |
| `cycleThinkingLevel()` | :1345 | 循环思考等级 |
| `setActiveToolsByName(names)` | :607 | 设置激活工具 |
| `executeBash(cmd, onChunk?, opts?)` | :2221 | 执行 bash 命令 |
| `newSession(options?)` | :1135 | 创建新 Session |
| `switchSession(path)` | :2325 | 切换 Session |
| `fork(entryId)` | :2415 | Fork 分支 |
| `navigateTree(targetId, opts)` | :2485 | 树导航 |
| `subscribe(listener)` | :506 | 订阅事件 |
| `dispose()` | :543 | 销毁实例 |
| `reload()` | :2052 | 重载配置和扩展 |
| `bindExtensions(bindings)` | :1767 | 绑定扩展 UI 上下文 |
| `getSessionStats()` | :2701 | 获取统计信息 |
| `getContextUsage()` | :2745 | 获取上下文用量 |
| `exportToHtml(outputPath?)` | :2796 | 导出 HTML |

### AgentSessionEvent 类型

```typescript
type AgentSessionEvent =
  | AgentEvent  // 来自 pi-agent-core 的所有事件
  | { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
  | { type: "auto_compaction_end"; result: CompactionResult | undefined;
      aborted: boolean; willRetry: boolean; errorMessage?: string }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number;
      delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
```

### 消息类型系统（messages.ts）

通过 declaration merging 扩展 `CustomAgentMessages`：

| 角色 | 接口 | 转换为 LLM 消息 |
|------|------|-----------------|
| `bashExecution` | `BashExecutionMessage` | `user`（含代码块），`excludeFromContext` 时跳过 |
| `custom` | `CustomMessage<T>` | `user`（直接传递 content） |
| `branchSummary` | `BranchSummaryMessage` | `user`（`<summary>` 包裹） |
| `compactionSummary` | `CompactionSummaryMessage` | `user`（`<summary>` 包裹） |
| `user`/`assistant`/`toolResult` | LLM 原生 | 直接透传 |

`convertToLlm()` @ `messages.ts:148` 是消息转换的核心函数，被以下位置使用：
- Agent 的 `convertToLlm` 选项（每次 LLM 调用前）
- 压缩的 `generateSummary()`（总结时）
- SDK 中的 `convertToLlmWithBlockImages` 包装器（额外过滤图片）

## 上下文控制点

以下是所有可以介入控制上下文内容的位置：

### 1. 消息进入前

| 控制点 | 位置 | 说明 |
|--------|------|------|
| **input 事件拦截** | `prompt()` @ `:722` | 扩展可拦截（`handled`）或转换（`transform`）用户输入 |
| **Skill/模板展开** | `prompt()` @ `:738` | 将 `/skill:name` 和模板引用展开为完整内容 |
| **扩展命令拦截** | `prompt()` @ `:711` | `/command` 形式的扩展命令，不进入 LLM 上下文 |
| **before_agent_start** | `prompt()` @ `:815` | 扩展可注入 custom messages 和修改 system prompt |
| **pendingNextTurnMessages** | `prompt()` @ `:809` | 上一轮 `sendCustomMessage(deliverAs:"nextTurn")` 的消息 |
| **blockImages** | `convertToLlmWithBlockImages` @ `sdk.ts:249` | 动态过滤图片内容 |

### 2. 消息转换时

| 控制点 | 位置 | 说明 |
|--------|------|------|
| **transformContext** | Agent 构造 @ `sdk.ts:296` | `extensionRunner.emitContext()` - 扩展可修改消息列表 |
| **convertToLlm** | `messages.ts:148` | AgentMessage -> Message 转换，过滤自定义类型 |
| **excludeFromContext** | `convertToLlm` @ `messages.ts:154` | `!!` 前缀的 bash 命令跳过 LLM 上下文 |

### 3. 消息存在后

| 控制点 | 位置 | 说明 |
|--------|------|------|
| **手动压缩** | `compact()` @ `:1429` | 用户触发，可带自定义指令 |
| **自动压缩（阈值）** | `_checkCompaction()` @ `:1602` | 上下文超过阈值自动触发 |
| **自动压缩（溢出）** | `_checkCompaction()` @ `:1591` | LLM 返回溢出错误时自动触发 |
| **session_before_compact** | compact 内 @ `:1460` | 扩展可取消压缩或提供替代摘要 |
| **replaceMessages** | 多处 | 压缩/分支/Session 切换后完全替换消息列表 |
| **分支/Fork** | `fork()` / `navigateTree()` | 切换到不同的消息路径 |
| **错误消息移除** | `_checkCompaction` @ `:1596`、`_handleRetryableError` @ `:2139` | 溢出/重试错误从 agent state 中移除 |

### 4. System Prompt 控制

| 控制点 | 位置 | 说明 |
|--------|------|------|
| **_rebuildSystemPrompt** | `:674` | 基于工具集、skills、context files、自定义 prompt 构建 |
| **before_agent_start** | `prompt()` @ `:835` | 扩展可每轮修改 system prompt |
| **setActiveToolsByName** | `:607` | 改变工具集触发 system prompt 重建 |
| **extendResourcesFromExtensions** | `:1788` | 扩展可注册额外的 skills/prompts/themes |

### 5. 工具集控制

| 控制点 | 位置 | 说明 |
|--------|------|------|
| **_buildRuntime** | `:1961` | 初始化时合并 base tools + 扩展工具 |
| **setActiveToolsByName** | `:607` | 运行时切换激活工具 |
| **wrapToolsWithExtensions** | `_buildRuntime` @ `:2037` | 扩展可包装工具（before/after 钩子） |
| **customTools** | SDK 参数 | 在扩展系统外注册自定义工具 |

## 与其他 Domain 的接口

### 与 Domain A（AI/LLM 层）的接口
- `Agent.prompt(messages)` / `Agent.continue()` - 触发 LLM 调用
- `Agent.steer()` / `Agent.followUp()` - 消息队列注入
- `Agent.replaceMessages()` - 完全替换消息列表
- `convertToLlm()` - 自定义消息到 LLM 消息的转换桥梁
- `streamSimple` / `streamFn` - LLM 流式接口

### 与 Domain C（持久化层）的接口
- `SessionManager.appendMessage()` / `appendCompaction()` / `appendCustomMessageEntry()` - 写入
- `SessionManager.buildSessionContext()` - 重建消息列表
- `SessionManager.getBranch()` / `getEntries()` / `getEntry()` - 读取
- `SessionManager.newSession()` / `setSessionFile()` / `createBranchedSession()` - Session 管理
- `SessionManager.branch()` / `branchWithSummary()` / `resetLeaf()` - 分支操作

### 与 Domain D（扩展系统）的接口
- `ExtensionRunner.emit(event)` - 发送事件（session_start/end/switch/fork/tree/compact 等）
- `ExtensionRunner.emitInput()` - 输入拦截
- `ExtensionRunner.emitBeforeAgentStart()` - Agent 启动前钩子
- `ExtensionRunner.emitContext()` - 上下文转换钩子
- `ExtensionRunner.emitResourcesDiscover()` - 资源发现
- `ExtensionRunner.getCommand()` / `getRegisteredCommandsWithPaths()` - 命令查询
- `ExtensionRunner.getAllRegisteredTools()` - 工具查询
- `wrapRegisteredTools()` / `wrapToolsWithExtensions()` - 工具包装

### 与 Domain E（UI 层）的接口
- `subscribe(listener)` - 事件订阅（TUI/RPC 通过此获取更新）
- `bindExtensions({ uiContext, commandContextActions, shutdownHandler, onError })` - UI 绑定
- `PromptOptions.streamingBehavior` - 流式中消息排队策略
- `getSteeringMessages()` / `getFollowUpMessages()` - 队列状态查询
- `clearQueue()` - 中止时恢复编辑器内容

### 与 Domain F（工具层）的接口
- `createAllTools(cwd, options)` - 工具工厂
- `executeBash(command, onChunk, options)` - bash 独立执行管道
- `recordBashResult()` - bash 结果记录
- `_baseToolRegistry` / `_toolRegistry` - 工具注册表

## 开发指南：SDK 模式开发

### 最小示例

```typescript
import { createAgentSession, codingTools } from "@mariozechner/pi-coding-agent/sdk";
import { getModel } from "@mariozechner/pi-ai";

const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-opus-4-5"),
  thinkingLevel: "medium",
  tools: codingTools, // [read, bash, edit, write]
});

// 订阅事件
const unsub = session.subscribe((event) => {
  if (event.type === "message_end" && event.message.role === "assistant") {
    console.log("Assistant:", event.message.content);
  }
});

// 发送消息
await session.prompt("Read the README.md file");

// 获取统计
console.log(session.getSessionStats());
```

### 无文件模式（纯内存 Session）

```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent/core/session-manager";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});
```

### 自定义工具

```typescript
const { session } = await createAgentSession({
  tools: [readTool, bashTool], // 仅启用 read + bash
  customTools: [{
    name: "myTool",
    description: "My custom tool",
    parameters: mySchema,
    execute: async (toolCallId, params, signal) => {
      return { content: [{ type: "text", text: "result" }], details: {} };
    },
  }],
});
```

### 上下文控制最佳实践

1. **注入上下文**：使用 `sendCustomMessage({ deliverAs: "nextTurn" })` 在下一轮附加信息
2. **拦截输入**：通过扩展的 `input` 事件处理器转换用户消息
3. **修改 System Prompt**：通过 `before_agent_start` 事件每轮动态调整
4. **控制工具集**：`setActiveToolsByName()` 动态启用/禁用工具
5. **自定义压缩**：通过 `session_before_compact` 事件提供替代压缩策略
6. **上下文转换**：通过 Agent 的 `transformContext` 选项（在 SDK 中通过 `extensionRunner.emitContext`）

### 关键注意事项

- `prompt()` 在 `isStreaming` 时**必须**指定 `streamingBehavior`，否则抛异常
- 压缩是**异步**的，overflow 压缩后会自动 `continue()`，阈值压缩不会
- `fork()` 创建新 Session 文件，`navigateTree()` 在同一文件内操作
- `_disconnectFromAgent()` / `_reconnectToAgent()` 用于暂停事件处理（压缩/Session 切换时）
- 所有扩展 `before_*` 事件都支持 `cancel` 返回值
- bash 命令结果在 `isStreaming` 时**延迟写入**，由 `_flushPendingBashMessages()` 在下一次 prompt 前刷新
