# C-Detailed: Extension 系统代码级分析

本文档是 `C-extension-system.md` 的**函数级补充**，覆盖 5 个核心文件的每个公开接口、函数签名和关键实现逻辑。

---

## 1. 类型系统（types.ts）

文件路径：`packages/coding-agent/src/core/extensions/types.ts`（1342 行）

### 1.1 事件类型完整清单

共 28 种独立事件接口（加上联合类型 ToolCallEvent 和 ToolResultEvent 各含 8 种变体）。

#### 1.1.1 资源发现事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `ResourcesDiscoverEvent` @ `:365` | `"resources_discover"` | `session_start` 后，允许扩展提供额外资源路径 | `cwd: string`, `reason: "startup" \| "reload"` | `ResourcesDiscoverResult`: `{ skillPaths?: string[]; promptPaths?: string[]; themePaths?: string[] }` |

#### 1.1.2 会话生命周期事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `SessionStartEvent` @ `:383` | `"session_start"` | 初始会话加载 | 无额外字段 | `void` |
| `SessionBeforeSwitchEvent` @ `:389` | `"session_before_switch"` | 切换/新建会话前 | `reason: "new" \| "resume"`, `targetSessionFile?: string` | `SessionBeforeSwitchResult`: `{ cancel?: boolean }` |
| `SessionSwitchEvent` @ `:396` | `"session_switch"` | 切换会话后 | `reason: "new" \| "resume"`, `previousSessionFile: string \| undefined` | `void` |
| `SessionBeforeForkEvent` @ `:403` | `"session_before_fork"` | 分叉会话前 | `entryId: string` | `SessionBeforeForkResult`: `{ cancel?: boolean; skipConversationRestore?: boolean }` |
| `SessionForkEvent` @ `:409` | `"session_fork"` | 分叉会话后 | `previousSessionFile: string \| undefined` | `void` |
| `SessionBeforeCompactEvent` @ `:415` | `"session_before_compact"` | 上下文压缩前 | `preparation: CompactionPreparation`, `branchEntries: SessionEntry[]`, `customInstructions?: string`, `signal: AbortSignal` | `SessionBeforeCompactResult`: `{ cancel?: boolean; compaction?: CompactionResult }` |
| `SessionCompactEvent` @ `:424` | `"session_compact"` | 上下文压缩后 | `compactionEntry: CompactionEntry`, `fromExtension: boolean` | `void` |
| `SessionShutdownEvent` @ `:431` | `"session_shutdown"` | 进程退出 | 无额外字段 | `void` |
| `SessionBeforeTreeEvent` @ `:451` | `"session_before_tree"` | 会话树导航前 | `preparation: TreePreparation`, `signal: AbortSignal` | `SessionBeforeTreeResult`: `{ cancel?: boolean; summary?: { summary: string; details?: unknown }; customInstructions?: string; replaceInstructions?: boolean; label?: string }` |
| `SessionTreeEvent` @ `:458` | `"session_tree"` | 会话树导航后 | `newLeafId: string \| null`, `oldLeafId: string \| null`, `summaryEntry?: BranchSummaryEntry`, `fromExtension?: boolean` | `void` |

联合类型 `SessionEvent` @ `:466` 包含以上 10 种。

辅助类型 `TreePreparation` @ `:436`：
```typescript
interface TreePreparation {
    targetId: string;
    oldLeafId: string | null;
    commonAncestorId: string | null;
    entriesToSummarize: SessionEntry[];
    userWantsSummary: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
}
```

#### 1.1.3 Agent 循环事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `ContextEvent` @ `:483` | `"context"` | 每次 LLM 调用前 | `messages: AgentMessage[]` | `ContextEventResult`: `{ messages?: AgentMessage[] }` |
| `BeforeAgentStartEvent` @ `:489` | `"before_agent_start"` | 用户提交后、Agent 循环前 | `prompt: string`, `images?: ImageContent[]`, `systemPrompt: string` | `BeforeAgentStartEventResult`: `{ message?: Pick<CustomMessage, ...>; systemPrompt?: string }` |
| `AgentStartEvent` @ `:497` | `"agent_start"` | Agent 循环开始 | 无额外字段 | `void` |
| `AgentEndEvent` @ `:502` | `"agent_end"` | Agent 循环结束 | `messages: AgentMessage[]` | `void` |
| `TurnStartEvent` @ `:508` | `"turn_start"` | 每个 turn 开始 | `turnIndex: number`, `timestamp: number` | `void` |
| `TurnEndEvent` @ `:515` | `"turn_end"` | 每个 turn 结束 | `turnIndex: number`, `message: AgentMessage`, `toolResults: ToolResultMessage[]` | `void` |

#### 1.1.4 消息流事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `MessageStartEvent` @ `:523` | `"message_start"` | 消息开始 | `message: AgentMessage` | `void` |
| `MessageUpdateEvent` @ `:529` | `"message_update"` | 流式 token 更新 | `message: AgentMessage`, `assistantMessageEvent: AssistantMessageEvent` | `void` |
| `MessageEndEvent` @ `:536` | `"message_end"` | 消息结束 | `message: AgentMessage` | `void` |

#### 1.1.5 工具执行事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `ToolExecutionStartEvent` @ `:542` | `"tool_execution_start"` | 工具开始执行 | `toolCallId: string`, `toolName: string`, `args: any` | `void` |
| `ToolExecutionUpdateEvent` @ `:550` | `"tool_execution_update"` | 工具流式部分输出 | `toolCallId: string`, `toolName: string`, `args: any`, `partialResult: any` | `void` |
| `ToolExecutionEndEvent` @ `:559` | `"tool_execution_end"` | 工具执行完成 | `toolCallId: string`, `toolName: string`, `result: any`, `isError: boolean` | `void` |

#### 1.1.6 工具调用/结果事件（类型判别联合）

**ToolCallEvent** @ `:670` — 8 种变体，共享基础 `ToolCallEventBase { type: "tool_call"; toolCallId: string }`：

| 变体 | `toolName` | `input` 类型 |
|------|-----------|-------------|
| `BashToolCallEvent` @ `:629` | `"bash"` | `BashToolInput` |
| `ReadToolCallEvent` @ `:634` | `"read"` | `ReadToolInput` |
| `EditToolCallEvent` @ `:639` | `"edit"` | `EditToolInput` |
| `WriteToolCallEvent` @ `:644` | `"write"` | `WriteToolInput` |
| `GrepToolCallEvent` @ `:649` | `"grep"` | `GrepToolInput` |
| `FindToolCallEvent` @ `:654` | `"find"` | `FindToolInput` |
| `LsToolCallEvent` @ `:659` | `"ls"` | `LsToolInput` |
| `CustomToolCallEvent` @ `:664` | `string`（任意） | `Record<string, unknown>` |

**Result 类型** — `ToolCallEventResult` @ `:827`: `{ block?: boolean; reason?: string }`

**ToolResultEvent** @ `:729` — 8 种变体，共享基础 `ToolResultEventBase { type: "tool_result"; toolCallId: string; input: Record<string, unknown>; content: (TextContent | ImageContent)[]; isError: boolean }`：

| 变体 | `toolName` | `details` 类型 |
|------|-----------|---------------|
| `BashToolResultEvent` @ `:688` | `"bash"` | `BashToolDetails \| undefined` |
| `ReadToolResultEvent` @ `:693` | `"read"` | `ReadToolDetails \| undefined` |
| `EditToolResultEvent` @ `:698` | `"edit"` | `EditToolDetails \| undefined` |
| `WriteToolResultEvent` @ `:703` | `"write"` | `undefined` |
| `GrepToolResultEvent` @ `:708` | `"grep"` | `GrepToolDetails \| undefined` |
| `FindToolResultEvent` @ `:713` | `"find"` | `FindToolDetails \| undefined` |
| `LsToolResultEvent` @ `:718` | `"ls"` | `LsToolDetails \| undefined` |
| `CustomToolResultEvent` @ `:723` | `string`（任意） | `unknown` |

**Result 类型** — `ToolResultEventResult` @ `:840`: `{ content?: (TextContent | ImageContent)[]; details?: unknown; isError?: boolean }`

#### 1.1.7 模型事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `ModelSelectEvent` @ `:574` | `"model_select"` | 新模型被选中 | `model: Model<any>`, `previousModel: Model<any> \| undefined`, `source: ModelSelectSource` | `void` |

`ModelSelectSource` @ `:571` = `"set" | "cycle" | "restore"`

#### 1.1.8 用户 Bash 事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `UserBashEvent` @ `:586` | `"user_bash"` | 用户 `!`/`!!` 前缀执行命令 | `command: string`, `excludeFromContext: boolean`, `cwd: string` | `UserBashEventResult`: `{ operations?: BashOperations; result?: BashResult }` |

#### 1.1.9 输入事件

| 事件接口 | `type` 值 | 触发时机 | 字段 | Result 类型 |
|----------|-----------|---------|------|-------------|
| `InputEvent` @ `:604` | `"input"` | 用户输入后、Agent 处理前 | `text: string`, `images?: ImageContent[]`, `source: InputSource` | `InputEventResult` |

`InputSource` @ `:601` = `"interactive" | "rpc" | "extension"`

`InputEventResult` @ `:615`:
```typescript
type InputEventResult =
    | { action: "continue" }
    | { action: "transform"; text: string; images?: ImageContent[] }
    | { action: "handled" };
```

#### 1.1.10 总联合类型

`ExtensionEvent` @ `:798` 是以上所有事件接口的联合类型。

#### 1.1.11 类型守卫函数

**ToolResult 守卫** @ `:740-760`：
- `isBashToolResult(e)` / `isReadToolResult(e)` / `isEditToolResult(e)` / `isWriteToolResult(e)` / `isGrepToolResult(e)` / `isFindToolResult(e)` / `isLsToolResult(e)` — 按 `toolName` 窄化 `ToolResultEvent`

**ToolCall 守卫** `isToolCallEventType()` @ `:782-795`：
- 8 个重载签名覆盖 7 个内置工具 + 泛型自定义工具
- 实现：`return event.toolName === toolName`
- 必须使用此函数而非 `event.toolName === "bash"` 直接比较，因为 `CustomToolCallEvent.toolName` 是 `string` 类型会破坏窄化

### 1.2 ExtensionAPI 完整方法

`ExtensionAPI` @ `:916` — 传入工厂函数的主接口。

#### 1.2.1 事件订阅 — `on()`

共 24 个重载签名 @ `:921-954`，覆盖所有事件类型。签名模式：

```typescript
on(event: "event_name", handler: ExtensionHandler<EventType, ResultType>): void
```

`ExtensionHandler<E, R>` @ `:911`:
```typescript
type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;
```

完整事件列表及 handler 返回类型：

| 事件名 | Handler 第一参数 | 可返回的 Result 类型 |
|--------|-----------------|---------------------|
| `resources_discover` | `ResourcesDiscoverEvent` | `ResourcesDiscoverResult` |
| `session_start` | `SessionStartEvent` | `void` |
| `session_before_switch` | `SessionBeforeSwitchEvent` | `SessionBeforeSwitchResult` |
| `session_switch` | `SessionSwitchEvent` | `void` |
| `session_before_fork` | `SessionBeforeForkEvent` | `SessionBeforeForkResult` |
| `session_fork` | `SessionForkEvent` | `void` |
| `session_before_compact` | `SessionBeforeCompactEvent` | `SessionBeforeCompactResult` |
| `session_compact` | `SessionCompactEvent` | `void` |
| `session_shutdown` | `SessionShutdownEvent` | `void` |
| `session_before_tree` | `SessionBeforeTreeEvent` | `SessionBeforeTreeResult` |
| `session_tree` | `SessionTreeEvent` | `void` |
| `context` | `ContextEvent` | `ContextEventResult` |
| `before_agent_start` | `BeforeAgentStartEvent` | `BeforeAgentStartEventResult` |
| `agent_start` | `AgentStartEvent` | `void` |
| `agent_end` | `AgentEndEvent` | `void` |
| `turn_start` | `TurnStartEvent` | `void` |
| `turn_end` | `TurnEndEvent` | `void` |
| `message_start` | `MessageStartEvent` | `void` |
| `message_update` | `MessageUpdateEvent` | `void` |
| `message_end` | `MessageEndEvent` | `void` |
| `tool_execution_start` | `ToolExecutionStartEvent` | `void` |
| `tool_execution_update` | `ToolExecutionUpdateEvent` | `void` |
| `tool_execution_end` | `ToolExecutionEndEvent` | `void` |
| `model_select` | `ModelSelectEvent` | `void` |
| `tool_call` | `ToolCallEvent` | `ToolCallEventResult` |
| `tool_result` | `ToolResultEvent` | `ToolResultEventResult` |
| `user_bash` | `UserBashEvent` | `UserBashEventResult` |
| `input` | `InputEvent` | `InputEventResult` |

#### 1.2.2 工具注册

```typescript
registerTool<TParams extends TSchema, TDetails>(tool: ToolDefinition<TParams, TDetails>): void  // @ :961
```

#### 1.2.3 命令/快捷键/Flag 注册

```typescript
registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void  // @ :968
registerShortcut(shortcut: KeyId, options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void }): void  // @ :971
registerFlag(name: string, options: { description?: string; type: "boolean" | "string"; default?: boolean | string }): void  // @ :980
getFlag(name: string): boolean | string | undefined  // @ :990
```

#### 1.2.4 消息渲染器

```typescript
registerMessageRenderer<T>(customType: string, renderer: MessageRenderer<T>): void  // @ :997
```

`MessageRenderer<T>` @ `:888`:
```typescript
type MessageRenderer<T> = (message: CustomMessage<T>, options: MessageRenderOptions, theme: Theme) => Component | undefined;
```

`MessageRenderOptions` @ `:884`: `{ expanded: boolean }`

#### 1.2.5 Action 方法

```typescript
sendMessage<T>(message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void  // @ :1004
sendUserMessage(content: string | (TextContent | ImageContent)[], options?: { deliverAs?: "steer" | "followUp" }): void  // @ :1013
appendEntry<T>(customType: string, data?: T): void  // @ :1019
setSessionName(name: string): void  // @ :1026
getSessionName(): string | undefined  // @ :1029
setLabel(entryId: string, label: string | undefined): void  // @ :1032
exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>  // @ :1035
getActiveTools(): string[]  // @ :1038
getAllTools(): ToolInfo[]  // @ :1041
setActiveTools(toolNames: string[]): void  // @ :1044
getCommands(): SlashCommandInfo[]  // @ :1047
setModel(model: Model<any>): Promise<boolean>  // @ :1054
getThinkingLevel(): ThinkingLevel  // @ :1057
setThinkingLevel(level: ThinkingLevel): void  // @ :1060
registerProvider(name: string, config: ProviderConfig): void  // @ :1113
```

#### 1.2.6 EventBus 属性

```typescript
events: EventBus  // @ :1116 — 共享事件总线，用于扩展间通信
```

### 1.3 ExtensionContext / ExtensionCommandContext

#### ExtensionContext @ `:261`

事件 handler 的上下文参数。

| 字段/方法 | 类型 | 说明 |
|-----------|------|------|
| `ui` | `ExtensionUIContext` | UI 交互方法 |
| `hasUI` | `boolean` | 是否有 UI（print/RPC 模式下为 false） |
| `cwd` | `string` | 当前工作目录 |
| `sessionManager` | `ReadonlySessionManager` | 只读 session 管理器 |
| `modelRegistry` | `ModelRegistry` | 模型注册表（用于查找/认证模型） |
| `model` | `Model<any> \| undefined` | 当前模型（动态 getter） |
| `isIdle()` | `() => boolean` | Agent 是否空闲（非 streaming） |
| `abort()` | `() => void` | 中止当前 Agent 操作 |
| `hasPendingMessages()` | `() => boolean` | 是否有排队等待的消息 |
| `shutdown()` | `() => void` | 优雅关闭 pi 并退出 |
| `getContextUsage()` | `() => ContextUsage \| undefined` | 获取当前 context token 使用情况 |
| `compact(options?)` | `(options?: CompactOptions) => void` | 触发压缩（不 await） |
| `getSystemPrompt()` | `() => string` | 获取当前有效系统提示 |

`ContextUsage` @ `:244`: `{ tokens: number | null; contextWindow: number; percent: number | null }`

`CompactOptions` @ `:252`: `{ customInstructions?: string; onComplete?: (result) => void; onError?: (error) => void }`

#### ExtensionCommandContext @ `:294`

继承 `ExtensionContext`，仅在命令 handler 中可用，额外提供 session 控制方法：

| 方法 | 签名 | 说明 |
|------|------|------|
| `waitForIdle()` | `() => Promise<void>` | 等待 Agent 完成 streaming |
| `newSession(options?)` | `(options?: { parentSession?; setup? }) => Promise<{ cancelled: boolean }>` | 创建新 session |
| `fork(entryId)` | `(entryId: string) => Promise<{ cancelled: boolean }>` | 从指定 entry 分叉 |
| `navigateTree(targetId, options?)` | `(targetId: string, options?: { summarize?; customInstructions?; replaceInstructions?; label? }) => Promise<{ cancelled: boolean }>` | 导航到 session 树某节点 |
| `switchSession(sessionPath)` | `(sessionPath: string) => Promise<{ cancelled: boolean }>` | 切换到另一个 session 文件 |
| `reload()` | `() => Promise<void>` | 重新加载扩展、skills、prompts、themes |

### 1.4 ExtensionUIContext

`ExtensionUIContext` @ `:107` — 完整方法列表：

| 方法 | 签名 | 说明 |
|------|------|------|
| `select()` | `(title: string, options: string[], opts?: ExtensionUIDialogOptions) => Promise<string \| undefined>` | 选择器对话框 |
| `confirm()` | `(title: string, message: string, opts?: ExtensionUIDialogOptions) => Promise<boolean>` | 确认对话框 |
| `input()` | `(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) => Promise<string \| undefined>` | 文本输入对话框 |
| `notify()` | `(message: string, type?: "info" \| "warning" \| "error") => void` | 通知消息 |
| `onTerminalInput()` | `(handler: TerminalInputHandler) => () => void` | 监听原始终端输入，返回取消函数 |
| `setStatus()` | `(key: string, text: string \| undefined) => void` | 设置状态栏文本，undefined 清除 |
| `setWorkingMessage()` | `(message?: string) => void` | 设置 streaming 时的等待消息 |
| `setWidget()` | 两个重载：纯文本数组或 Component 工厂 | 编辑器上方/下方 widget |
| `setFooter()` | `(factory: ((tui, theme, footerData) => Component & { dispose?() }) \| undefined) => void` | 替换页脚 |
| `setHeader()` | `(factory: ((tui, theme) => Component & { dispose?() }) \| undefined) => void` | 替换页头 |
| `setTitle()` | `(title: string) => void` | 设置终端窗口标题 |
| `custom<T>()` | `(factory, options?: { overlay?; overlayOptions?; onHandle? }) => Promise<T>` | 全屏自定义组件 |
| `pasteToEditor()` | `(text: string) => void` | 粘贴文本到编辑器 |
| `setEditorText()` | `(text: string) => void` | 设置编辑器文本 |
| `getEditorText()` | `() => string` | 获取编辑器文本 |
| `editor()` | `(title: string, prefill?: string) => Promise<string \| undefined>` | 多行编辑器对话框 |
| `setEditorComponent()` | `(factory: ((tui, theme, keybindings) => EditorComponent) \| undefined) => void` | 替换整个输入编辑器 |
| `theme` | `readonly Theme` | 当前主题 |
| `getAllThemes()` | `() => { name: string; path: string \| undefined }[]` | 获取所有主题 |
| `getTheme()` | `(name: string) => Theme \| undefined` | 按名获取主题 |
| `setTheme()` | `(theme: string \| Theme) => { success: boolean; error?: string }` | 切换主题 |
| `getToolsExpanded()` | `() => boolean` | 获取工具输出展开状态 |
| `setToolsExpanded()` | `(expanded: boolean) => void` | 设置工具输出展开状态 |

辅助类型：
- `ExtensionUIDialogOptions` @ `:84`: `{ signal?: AbortSignal; timeout?: number }` — 对话框支持通过 AbortSignal 或超时自动关闭
- `WidgetPlacement` @ `:92`: `"aboveEditor" | "belowEditor"`
- `ExtensionWidgetOptions` @ `:95`: `{ placement?: WidgetPlacement }`
- `TerminalInputHandler` @ `:101`: `(data: string) => { consume?: boolean; data?: string } | undefined`

### 1.5 ToolDefinition

`ToolDefinition<TParams extends TSchema, TDetails>` @ `:335`

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | LLM 调用时使用的工具名 |
| `label` | `string` | UI 显示的人类可读名称 |
| `description` | `string` | 发送给 LLM 的工具描述 |
| `parameters` | `TParams` | TypeBox schema 定义参数 |
| `execute()` | `(toolCallId: string, params: Static<TParams>, signal: AbortSignal \| undefined, onUpdate: AgentToolUpdateCallback<TDetails> \| undefined, ctx: ExtensionContext) => Promise<AgentToolResult<TDetails>>` | 执行函数 |
| `renderCall?` | `(args: Static<TParams>, theme: Theme) => Component` | 可选：自定义工具调用渲染 |
| `renderResult?` | `(result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme) => Component` | 可选：自定义工具结果渲染 |

`ToolRenderResultOptions` @ `:325`: `{ expanded: boolean; isPartial: boolean }`

### 1.6 其他关键类型

#### RegisteredCommand @ `:898`

```typescript
interface RegisteredCommand {
    name: string;
    description?: string;
    getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}
```

#### ExtensionActions @ `:1256`

Runner 需要绑定的运行时 action 实现接口：

```typescript
interface ExtensionActions {
    sendMessage: SendMessageHandler;
    sendUserMessage: SendUserMessageHandler;
    appendEntry: AppendEntryHandler;
    setSessionName: SetSessionNameHandler;
    getSessionName: GetSessionNameHandler;
    setLabel: SetLabelHandler;
    getActiveTools: GetActiveToolsHandler;
    getAllTools: GetAllToolsHandler;
    setActiveTools: SetActiveToolsHandler;
    getCommands: GetCommandsHandler;
    setModel: SetModelHandler;
    getThinkingLevel: GetThinkingLevelHandler;
    setThinkingLevel: SetThinkingLevelHandler;
}
```

#### ExtensionContextActions @ `:1276`

事件 handler 上下文中的 action 接口：

```typescript
interface ExtensionContextActions {
    getModel: () => Model<any> | undefined;
    isIdle: () => boolean;
    abort: () => void;
    hasPendingMessages: () => boolean;
    shutdown: () => void;
    getContextUsage: () => ContextUsage | undefined;
    compact: (options?: CompactOptions) => void;
    getSystemPrompt: () => string;
}
```

#### ExtensionCommandContextActions @ `:1291`

命令 handler 增强上下文中的 action 接口：

```typescript
interface ExtensionCommandContextActions {
    waitForIdle: () => Promise<void>;
    newSession: (options?) => Promise<{ cancelled: boolean }>;
    fork: (entryId: string) => Promise<{ cancelled: boolean }>;
    navigateTree: (targetId, options?) => Promise<{ cancelled: boolean }>;
    switchSession: (sessionPath: string) => Promise<{ cancelled: boolean }>;
    reload: () => Promise<void>;
}
```

#### Extension（已加载扩展实例） @ `:1313`

```typescript
interface Extension {
    path: string;                                  // 原始路径（可能是相对路径）
    resolvedPath: string;                          // 解析后的绝对路径
    handlers: Map<string, HandlerFn[]>;            // 事件名 -> handler 函数数组
    tools: Map<string, RegisteredTool>;            // 工具名 -> RegisteredTool
    messageRenderers: Map<string, MessageRenderer>; // customType -> 渲染器
    commands: Map<string, RegisteredCommand>;       // 命令名 -> 命令定义
    flags: Map<string, ExtensionFlag>;             // flag 名 -> flag 定义
    shortcuts: Map<KeyId, ExtensionShortcut>;      // 快捷键 -> shortcut 定义
}
```

#### ExtensionRuntime @ `:1310`

```typescript
interface ExtensionRuntime extends ExtensionRuntimeState, ExtensionActions {}
// ExtensionRuntimeState 包含:
//   flagValues: Map<string, boolean | string>
//   pendingProviderRegistrations: Array<{ name: string; config: ProviderConfig }>
```

#### ProviderConfig @ `:1124`

```typescript
interface ProviderConfig {
    baseUrl?: string;
    apiKey?: string;
    api?: Api;
    streamSimple?: (model, context, options?) => AssistantMessageEventStream;
    headers?: Record<string, string>;
    authHeader?: boolean;
    models?: ProviderModelConfig[];
    oauth?: {
        name: string;
        login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
        refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
        getApiKey(credentials: OAuthCredentials): string;
        modifyModels?(models, credentials): Model<Api>[];
    };
}
```

#### ProviderModelConfig @ `:1155`

```typescript
interface ProviderModelConfig {
    id: string;
    name: string;
    api?: Api;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
    headers?: Record<string, string>;
    compat?: Model<Api>["compat"];
}
```

#### ExtensionFactory @ `:1179`

```typescript
type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
```

#### ExtensionError @ `:1336`

```typescript
interface ExtensionError {
    extensionPath: string;
    event: string;
    error: string;
    stack?: string;
}
```

---

## 2. 加载器（loader.ts）

文件路径：`packages/coding-agent/src/core/extensions/loader.ts`（517 行）

### 2.1 发现流程

#### `discoverAndLoadExtensions()` @ `loader.ts:470`

**签名**：
```typescript
async function discoverAndLoadExtensions(
    configuredPaths: string[],
    cwd: string,
    agentDir: string = getAgentDir(),
    eventBus?: EventBus,
): Promise<LoadExtensionsResult>
```

**完整流程**：

1. 初始化 `allPaths: string[]` 和 `seen: Set<string>` 用于去重
2. 定义内部 `addPaths(paths)` 辅助函数：对每个路径调用 `path.resolve()` 后检查 `seen`，未见过则加入
3. **第一步 — 全局扩展**：扫描 `<agentDir>/extensions/` 目录，调用 `discoverExtensionsInDir(globalExtDir)`
4. **第二步 — 项目本地扩展**：扫描 `<cwd>/.pi/extensions/` 目录，调用 `discoverExtensionsInDir(localExtDir)`
5. **第三步 — 显式配置路径**（`configuredPaths`）：
   - 如果是目录：先尝试 `resolveExtensionEntries()`（package.json 或 index.ts），若无则 `discoverExtensionsInDir()`
   - 如果是文件：直接加入
6. 所有路径收集后，调用 `loadExtensions(allPaths, cwd, eventBus)` 串行加载

**关键设计**：去重基于 `path.resolve()` 后的绝对路径。加载顺序严格保证：全局 > 项目本地 > CLI 指定。

#### `discoverExtensionsInDir()` @ `loader.ts:433`

**签名**：`function discoverExtensionsInDir(dir: string): string[]`

**发现规则**：
1. 目录不存在则返回空数组
2. `readdirSync()` 读取一级目录内容
3. **直接文件**：`.ts` 或 `.js` 结尾的文件（含符号链接）直接加入
4. **子目录**（含符号链接）：调用 `resolveExtensionEntries(entryPath)` 解析入口
5. 不递归超过一级

#### `resolveExtensionEntries()` @ `loader.ts:391`

**签名**：`function resolveExtensionEntries(dir: string): string[] | null`

**规则**：
1. 检查 `<dir>/package.json` 是否存在 `pi.extensions` 字段（通过 `readPiManifest()`）
   - 若有：解析每个声明路径为绝对路径，检查存在性，返回有效路径列表
2. 检查 `<dir>/index.ts` 是否存在
3. 检查 `<dir>/index.js` 是否存在
4. 以上都无返回 `null`

#### `readPiManifest()` @ `loader.ts:365`

**签名**：`function readPiManifest(packageJsonPath: string): PiManifest | null`

读取 package.json，提取 `pkg.pi` 字段。`PiManifest` @ `:358`:
```typescript
interface PiManifest {
    extensions?: string[];
    themes?: string[];
    skills?: string[];
    prompts?: string[];
}
```

### 2.2 模块加载

#### `loadExtensionModule()` @ `loader.ts:258`

**签名**：`async function loadExtensionModule(extensionPath: string)`

**核心逻辑**：
1. 创建 `jiti` 实例（`@mariozechner/jiti` fork）：
   - **Bun 二进制模式** (`isBunBinary`): 使用 `virtualModules: VIRTUAL_MODULES` 和 `tryNative: false`
   - **Node.js/开发模式**: 使用 `alias: getAliases()` 解析到 `node_modules`
   - 两种模式都设置 `moduleCache: false`
2. `await jiti.import(extensionPath, { default: true })` 加载模块
3. 检查导出是否为函数，非函数返回 `undefined`

**虚拟模块映射** `VIRTUAL_MODULES` @ `:41-47`:
```
"@sinclair/typebox"            -> 内置 _bundledTypebox
"@mariozechner/pi-agent-core"  -> 内置 _bundledPiAgentCore
"@mariozechner/pi-tui"         -> 内置 _bundledPiTui
"@mariozechner/pi-ai"          -> 内置 _bundledPiAi
"@mariozechner/pi-coding-agent" -> 内置 _bundledPiCodingAgent
```

注意：这些 import 必须是静态的，以确保 Bun 将它们捆绑到编译后的二进制中。

#### `getAliases()` @ `loader.ts:56`

**签名**：`function getAliases(): Record<string, string>`

Node.js/开发模式下的模块路径映射。使用 `createRequire(import.meta.url)` 解析每个包的实际路径。延迟初始化，结果缓存在 `_aliases` 变量中。

#### `loadExtension()` @ `loader.ts:288`

**签名**：
```typescript
async function loadExtension(
    extensionPath: string,
    cwd: string,
    eventBus: EventBus,
    runtime: ExtensionRuntime,
): Promise<{ extension: Extension | null; error: string | null }>
```

**流程**：
1. `resolvePath(extensionPath, cwd)` 解析绝对路径
2. `loadExtensionModule(resolvedPath)` 加载模块获取工厂函数
3. 工厂函数无效则返回错误
4. `createExtension(extensionPath, resolvedPath)` 创建空 Extension 对象
5. `createExtensionAPI(extension, runtime, cwd, eventBus)` 创建 API 实例
6. `await factory(api)` 执行工厂函数
7. 整体被 `try/catch` 包裹，异常转为错误字符串

#### `loadExtensions()` @ `loader.ts:332`

**签名**：
```typescript
async function loadExtensions(paths: string[], cwd: string, eventBus?: EventBus): Promise<LoadExtensionsResult>
```

**核心逻辑**：
1. 创建共享 `runtime = createExtensionRuntime()`（此时 action 方法为 throwing stub）
2. 创建或使用传入的 `eventBus`
3. **串行 `for...of` 循环**加载每个路径
4. 成功则加入 `extensions[]`，失败则加入 `errors[]`
5. 返回 `{ extensions, errors, runtime }`

### 2.3 API 创建

#### `createExtensionAPI()` @ `loader.ts:136`

**签名**：
```typescript
function createExtensionAPI(
    extension: Extension,
    runtime: ExtensionRuntime,
    cwd: string,
    eventBus: EventBus,
): ExtensionAPI
```

**关键设计** — 两类方法的不同实现策略：

**注册方法**（写入 extension 局部状态）：
- `on(event, handler)` @ `:144` — 向 `extension.handlers` Map 追加 handler
- `registerTool(tool)` @ `:150` — 向 `extension.tools` Map 写入
- `registerCommand(name, options)` @ `:157` — 向 `extension.commands` Map 写入
- `registerShortcut(shortcut, options)` @ `:161` — 向 `extension.shortcuts` Map 写入
- `registerFlag(name, options)` @ `:171` — 向 `extension.flags` Map 写入，并在 `runtime.flagValues` 设置默认值
- `registerMessageRenderer(customType, renderer)` @ `:181` — 向 `extension.messageRenderers` Map 写入

**Flag 访问方法**：
- `getFlag(name)` @ `:186` — 先检查 `extension.flags.has(name)`（只能读自己注册的 flag），再从 `runtime.flagValues` 获取值

**Action 方法**（委托给共享 runtime）：
- `sendMessage` / `sendUserMessage` / `appendEntry` / `setSessionName` / `getSessionName` / `setLabel` / `getActiveTools` / `getAllTools` / `setActiveTools` / `getCommands` / `setModel` / `getThinkingLevel` / `setThinkingLevel` — 全部直接调用 `runtime.xxx()`

**特殊方法**：
- `exec(command, args, options?)` @ `:216` — 直接调用 `execCommand()`，不经过 runtime
- `registerProvider(name, config)` @ `:248` — 推入 `runtime.pendingProviderRegistrations` 队列（延迟到 `bindCore()` 处理）
- `events` @ `:252` — 直接引用传入的 `eventBus`

#### `createExtensionRuntime()` @ `loader.ts:107`

**签名**：`function createExtensionRuntime(): ExtensionRuntime`

创建所有 action 方法为 throwing stub 的运行时对象。`notInitialized()` 函数抛出 `"Extension runtime not initialized"` 错误。初始化 `flagValues: new Map()` 和 `pendingProviderRegistrations: []`。

### 2.4 工厂执行

#### `loadExtensionFromFactory()` @ `loader.ts:316`

**签名**：
```typescript
async function loadExtensionFromFactory(
    factory: ExtensionFactory,
    cwd: string,
    eventBus: EventBus,
    runtime: ExtensionRuntime,
    extensionPath = "<inline>",
): Promise<Extension>
```

**用途**：允许不通过文件系统，直接传入工厂函数创建扩展。供 SDK 和测试使用。

**流程**：
1. `createExtension(extensionPath, extensionPath)` — path 和 resolvedPath 都是 `"<inline>"`
2. `createExtensionAPI(extension, runtime, cwd, eventBus)` 创建 API
3. `await factory(api)` 执行工厂
4. 返回 Extension 对象

#### `createExtension()` @ `loader.ts:275`

**签名**：`function createExtension(extensionPath: string, resolvedPath: string): Extension`

创建空的 Extension 对象，所有 Map 为空。

### 2.5 路径工具函数

- `expandPath(p)` @ `:82` — 处理 `~` 开头的路径，替换为 `os.homedir()`
- `resolvePath(extPath, cwd)` @ `:93` — 先 `expandPath`，绝对路径直接返回，相对路径相对 `cwd` 解析
- `normalizeUnicodeSpaces(str)` @ `:78` — 将 Unicode 空格字符统一为 ASCII 空格
- `isExtensionFile(name)` @ `:378` — 检查是否以 `.ts` 或 `.js` 结尾

---

## 3. 运行器（runner.ts）

文件路径：`packages/coding-agent/src/core/extensions/runner.ts`（827 行）

### 3.1 ExtensionRunner 类

`ExtensionRunner` @ `runner.ts:196` — 事件派发引擎。

#### 构造函数

```typescript
constructor(
    extensions: Extension[],
    runtime: ExtensionRuntime,
    cwd: string,
    sessionManager: SessionManager,
    modelRegistry: ModelRegistry,
)
```

初始化所有 handler 函数为默认 no-op 实现（如 `isIdleFn: () => true`，`waitForIdleFn: async () => {}`）。`uiContext` 默认设置为 `noOpUIContext`。

#### 私有状态

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `extensions` | `Extension[]` | 构造时传入 | 已加载扩展数组 |
| `runtime` | `ExtensionRuntime` | 构造时传入 | 共享运行时 |
| `uiContext` | `ExtensionUIContext` | `noOpUIContext` | 当前 UI 上下文 |
| `cwd` | `string` | 构造时传入 | 工作目录 |
| `sessionManager` | `SessionManager` | 构造时传入 | session 管理器 |
| `modelRegistry` | `ModelRegistry` | 构造时传入 | 模型注册表 |
| `errorListeners` | `Set<ExtensionErrorListener>` | 空 | 错误监听器集合 |
| `getModel` | `() => Model \| undefined` | `() => undefined` | 模型获取函数 |
| `isIdleFn` | `() => boolean` | `() => true` | idle 状态检测 |
| `waitForIdleFn` | `() => Promise<void>` | `async () => {}` | 等待 idle |
| `abortFn` | `() => void` | `() => {}` | 中止操作 |
| `hasPendingMessagesFn` | `() => boolean` | `() => false` | 检查排队消息 |
| `getContextUsageFn` | `() => ContextUsage \| undefined` | `() => undefined` | context 使用情况 |
| `compactFn` | `(options?) => void` | `() => {}` | 触发压缩 |
| `getSystemPromptFn` | `() => string` | `() => ""` | 获取系统提示 |
| `newSessionHandler` | `NewSessionHandler` | `async () => ({ cancelled: false })` | 新 session |
| `forkHandler` | `ForkHandler` | `async () => ({ cancelled: false })` | 分叉 |
| `navigateTreeHandler` | `NavigateTreeHandler` | `async () => ({ cancelled: false })` | 树导航 |
| `switchSessionHandler` | `SwitchSessionHandler` | `async () => ({ cancelled: false })` | 切换 session |
| `reloadHandler` | `ReloadHandler` | `async () => {}` | 重载 |
| `shutdownHandler` | `ShutdownHandler` | `() => {}` | 关闭 |
| `shortcutDiagnostics` | `ResourceDiagnostic[]` | `[]` | 快捷键冲突诊断 |
| `commandDiagnostics` | `ResourceDiagnostic[]` | `[]` | 命令冲突诊断 |

#### 完整公开方法列表

| 方法 | 签名（简化） | 说明 |
|------|-------------|------|
| `bindCore()` @ `:236` | `(actions, contextActions) => void` | 注入运行时 action 和上下文 action |
| `bindCommandContext()` @ `:269` | `(actions?) => void` | 注入命令上下文 action |
| `setUIContext()` @ `:288` | `(uiContext?) => void` | 设置 UI 上下文 |
| `getUIContext()` @ `:292` | `() => ExtensionUIContext` | 获取当前 UI 上下文 |
| `hasUI()` @ `:296` | `() => boolean` | 是否有 UI |
| `getExtensionPaths()` @ `:300` | `() => string[]` | 获取所有扩展路径 |
| `getAllRegisteredTools()` @ `:305` | `() => RegisteredTool[]` | 获取所有注册工具 |
| `getToolDefinition()` @ `:316` | `(toolName) => ToolDefinition \| undefined` | 按名查找工具定义 |
| `getFlags()` @ `:326` | `() => Map<string, ExtensionFlag>` | 获取所有 flag |
| `setFlagValue()` @ `:336` | `(name, value) => void` | 设置 flag 值 |
| `getFlagValues()` @ `:340` | `() => Map<string, boolean \| string>` | 获取所有 flag 值的副本 |
| `getShortcuts()` @ `:344` | `(keybindingsConfig) => Map<KeyId, ExtensionShortcut>` | 获取快捷键（含冲突检测） |
| `getShortcutDiagnostics()` @ `:389` | `() => ResourceDiagnostic[]` | 获取快捷键诊断 |
| `onError()` @ `:393` | `(listener) => () => void` | 注册错误监听器 |
| `emitError()` @ `:398` | `(error) => void` | 触发错误事件 |
| `hasHandlers()` @ `:404` | `(eventType) => boolean` | 检查是否有 handler |
| `getMessageRenderer()` @ `:414` | `(customType) => MessageRenderer \| undefined` | 查找消息渲染器 |
| `getRegisteredCommands()` @ `:424` | `(reserved?) => RegisteredCommand[]` | 获取注册命令（跳过与内置冲突的） |
| `getCommandDiagnostics()` @ `:445` | `() => ResourceDiagnostic[]` | 获取命令诊断 |
| `getRegisteredCommandsWithPaths()` @ `:449` | `() => Array<{ command; extensionPath }>` | 获取命令及其扩展路径 |
| `getCommand()` @ `:459` | `(name) => RegisteredCommand \| undefined` | 按名查找命令 |
| `shutdown()` @ `:473` | `() => void` | 触发优雅关闭 |
| `createContext()` @ `:481` | `() => ExtensionContext` | 创建事件 handler 上下文 |
| `createCommandContext()` @ `:502` | `() => ExtensionCommandContext` | 创建命令 handler 上下文 |
| `emit()` @ `:523` | `<TEvent>(event) => Promise<RunnerEmitResult<TEvent>>` | 通用事件派发 |
| `emitToolResult()` @ `:557` | `(event) => Promise<ToolResultEventResult \| undefined>` | tool_result 专用派发 |
| `emitToolCall()` @ `:607` | `(event) => Promise<ToolCallEventResult \| undefined>` | tool_call 专用派发 |
| `emitUserBash()` @ `:630` | `(event) => Promise<UserBashEventResult \| undefined>` | user_bash 专用派发 |
| `emitContext()` @ `:659` | `(messages) => Promise<AgentMessage[]>` | context 专用派发 |
| `emitBeforeAgentStart()` @ `:691` | `(prompt, images, systemPrompt) => Promise<BeforeAgentStartCombinedResult \| undefined>` | before_agent_start 专用派发 |
| `emitResourcesDiscover()` @ `:748` | `(cwd, reason) => Promise<{ skillPaths; promptPaths; themePaths }>` | resources_discover 专用派发 |
| `emitInput()` @ `:797` | `(text, images, source) => Promise<InputEventResult>` | input 专用派发 |

### 3.2 bindCore

`bindCore()` @ `runner.ts:236`

**签名**：
```typescript
bindCore(actions: ExtensionActions, contextActions: ExtensionContextActions): void
```

**核心逻辑**：

1. **将 actions 复制到共享 runtime**（所有扩展的 API 引用同一个 runtime，因此所有扩展立即获得真正的实现）：
   - `runtime.sendMessage = actions.sendMessage`
   - `runtime.sendUserMessage = actions.sendUserMessage`
   - `runtime.appendEntry = actions.appendEntry`
   - `runtime.setSessionName = actions.setSessionName`
   - `runtime.getSessionName = actions.getSessionName`
   - `runtime.setLabel = actions.setLabel`
   - `runtime.getActiveTools = actions.getActiveTools`
   - `runtime.getAllTools = actions.getAllTools`
   - `runtime.setActiveTools = actions.setActiveTools`
   - `runtime.getCommands = actions.getCommands`
   - `runtime.setModel = actions.setModel`
   - `runtime.getThinkingLevel = actions.getThinkingLevel`
   - `runtime.setThinkingLevel = actions.setThinkingLevel`

2. **保存 contextActions 到私有字段**：
   - `this.getModel = contextActions.getModel`
   - `this.isIdleFn = contextActions.isIdle`
   - `this.abortFn = contextActions.abort`
   - `this.hasPendingMessagesFn = contextActions.hasPendingMessages`
   - `this.shutdownHandler = contextActions.shutdown`
   - `this.getContextUsageFn = contextActions.getContextUsage`
   - `this.compactFn = contextActions.compact`
   - `this.getSystemPromptFn = contextActions.getSystemPrompt`

3. **处理延迟的 Provider 注册**：
   ```typescript
   for (const { name, config } of this.runtime.pendingProviderRegistrations) {
       this.modelRegistry.registerProvider(name, config);
   }
   this.runtime.pendingProviderRegistrations = [];
   ```

**设计要点**：这是"延迟绑定"模式的核心 — 加载期间 runtime 的 action 方法是 throwing stub，`bindCore()` 调用后才替换为真正实现。由于所有扩展的 API 通过闭包引用同一个 `runtime` 对象，替换字段后所有扩展立即生效。

#### `bindCommandContext()` @ `runner.ts:269`

**签名**：`bindCommandContext(actions?: ExtensionCommandContextActions): void`

若传入 actions，设置 `waitForIdleFn` / `newSessionHandler` / `forkHandler` / `navigateTreeHandler` / `switchSessionHandler` / `reloadHandler`。若不传入，重置为默认 no-op。

### 3.3 事件派发（每种事件）

#### 通用 `emit()` @ `runner.ts:523`

**签名**：
```typescript
async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>>
```

`RunnerEmitEvent` @ `:102` 排除了有专用 emit 方法的事件类型（ToolCallEvent, ToolResultEvent, UserBashEvent, ContextEvent, BeforeAgentStartEvent, ResourcesDiscoverEvent, InputEvent）。

**流程**：
1. `this.createContext()` 创建上下文
2. 遍历 `this.extensions`（按加载顺序）
3. 对每个扩展，获取 `ext.handlers.get(event.type)`
4. 对每个 handler 在 `try/catch` 中执行 `await handler(event, ctx)`
5. 对 `session_before_*` 事件（通过 `isSessionBeforeEvent()` 判断）：
   - 保存 handler 返回值为 result
   - 如果 `result.cancel === true`，**立即返回**（短路）
6. 非 `session_before_*` 事件忽略返回值
7. 返回最后一个非空 result（或 undefined）

#### `emitContext()` @ `runner.ts:659`

**签名**：`async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]>`

**流程**：
1. `structuredClone(messages)` — **深拷贝消息列表**（保护原始数据）
2. 遍历所有扩展的 `"context"` handler
3. 每次构造新的 `{ type: "context", messages: currentMessages }` 事件
4. 如果 handler 返回 `{ messages }` 非空，**替换** `currentMessages`
5. 返回最终的 `currentMessages`

**关键特性**：链式消息替换 — 后一个 handler 看到前一个 handler 修改后的消息列表。

#### `emitBeforeAgentStart()` @ `runner.ts:691`

**签名**：
```typescript
async emitBeforeAgentStart(
    prompt: string,
    images: ImageContent[] | undefined,
    systemPrompt: string,
): Promise<BeforeAgentStartCombinedResult | undefined>
```

**流程**：
1. 收集所有 handler 返回的 `message` 到 `messages[]` 数组
2. `systemPrompt` **链式修改**：每个 handler 收到的 `event.systemPrompt` 是前一个 handler 修改后的值
3. 如果有 message 或 systemPrompt 被修改，返回聚合结果
4. 否则返回 `undefined`

`BeforeAgentStartCombinedResult` @ `:93`:
```typescript
interface BeforeAgentStartCombinedResult {
    messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
    systemPrompt?: string;
}
```

#### `emitToolCall()` @ `runner.ts:607`

**签名**：`async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined>`

**流程**：
1. 遍历所有扩展的 `"tool_call"` handler
2. **无 try/catch**（异常直接上抛）
3. 如果任一 handler 返回 `{ block: true }`，**立即返回**（短路）
4. 返回最后一个非空 result

**注意**：这是唯一没有错误隔离的 emit 方法 — 如果 handler 抛异常，异常会传播到调用方（`wrapToolWithExtensions()` 中处理）。

#### `emitToolResult()` @ `runner.ts:557`

**签名**：`async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined>`

**流程**：
1. **浅拷贝**事件：`const currentEvent = { ...event }`
2. 遍历所有扩展的 `"tool_result"` handler
3. 每个 handler 返回的 `content` / `details` / `isError` 如果非 undefined，**更新** `currentEvent`
4. 跟踪 `modified` 标志
5. 如果有修改，返回 `{ content, details, isError }`；否则返回 `undefined`

**关键特性**：链式修改 — 后一个 handler 看到前一个 handler 修改后的 content/details/isError。

#### `emitUserBash()` @ `runner.ts:630`

**签名**：`async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined>`

**流程**：
1. 遍历所有扩展的 `"user_bash"` handler
2. **第一个返回非空结果的 handler 立即生效**，后续 handler 不执行
3. 错误被 try/catch 隔离

#### `emitResourcesDiscover()` @ `runner.ts:748`

**签名**：
```typescript
async emitResourcesDiscover(
    cwd: string,
    reason: ResourcesDiscoverEvent["reason"],
): Promise<{
    skillPaths: Array<{ path: string; extensionPath: string }>;
    promptPaths: Array<{ path: string; extensionPath: string }>;
    themePaths: Array<{ path: string; extensionPath: string }>;
}>
```

**流程**：
1. 遍历所有扩展的 `"resources_discover"` handler
2. **聚合**所有 handler 返回的路径，每个路径标记来源扩展
3. 返回三个路径数组

#### `emitInput()` @ `runner.ts:797`

**签名**：`async emitInput(text: string, images: ImageContent[] | undefined, source: InputSource): Promise<InputEventResult>`

**流程**：
1. 遍历所有扩展的 `"input"` handler
2. 如果 handler 返回 `{ action: "handled" }`，**立即短路返回**
3. 如果 handler 返回 `{ action: "transform", text, images? }`，更新 `currentText` / `currentImages`
4. 如果 text 或 images 被修改，返回 `{ action: "transform", ... }`；否则返回 `{ action: "continue" }`

### 3.4 错误隔离

**错误处理策略**：

| emit 方法 | 隔离方式 | 行为 |
|-----------|---------|------|
| `emit()` | try/catch 包裹每个 handler | 错误通过 `emitError()` 报告，继续执行下一个 handler |
| `emitContext()` | try/catch 包裹每个 handler | 同上 |
| `emitBeforeAgentStart()` | try/catch 包裹每个 handler | 同上 |
| `emitToolCall()` | **无 try/catch** | 异常直接上抛到调用方 |
| `emitToolResult()` | try/catch 包裹每个 handler | 同上 |
| `emitUserBash()` | try/catch 包裹每个 handler | 同上 |
| `emitResourcesDiscover()` | try/catch 包裹每个 handler | 同上 |
| `emitInput()` | try/catch 包裹每个 handler | 同上 |

**错误报告** — `emitError()` @ `runner.ts:398`:
```typescript
emitError(error: ExtensionError): void {
    for (const listener of this.errorListeners) {
        listener(error);
    }
}
```

**错误监听** — `onError()` @ `runner.ts:393`:
```typescript
onError(listener: ExtensionErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
}
```

**设计原则**：单个扩展 handler 的异常不应中断其他扩展的执行。唯一例外是 `emitToolCall()`，其异常会阻止工具执行（这是有意为之 — 如果 tool_call handler 本身失败，应阻止工具执行以保证安全）。

### 3.5 上下文创建

#### `createContext()` @ `runner.ts:481`

```typescript
createContext(): ExtensionContext {
    const getModel = this.getModel;
    return {
        ui: this.uiContext,
        hasUI: this.hasUI(),
        cwd: this.cwd,
        sessionManager: this.sessionManager,
        modelRegistry: this.modelRegistry,
        get model() { return getModel(); },  // 动态 getter
        isIdle: () => this.isIdleFn(),
        abort: () => this.abortFn(),
        hasPendingMessages: () => this.hasPendingMessagesFn(),
        shutdown: () => this.shutdownHandler(),
        getContextUsage: () => this.getContextUsageFn(),
        compact: (options) => this.compactFn(options),
        getSystemPrompt: () => this.getSystemPromptFn(),
    };
}
```

**关键**：`model` 是 getter 属性，每次访问都会调用 `getModel()` 获取最新值。

#### `createCommandContext()` @ `runner.ts:502`

```typescript
createCommandContext(): ExtensionCommandContext {
    return {
        ...this.createContext(),
        waitForIdle: () => this.waitForIdleFn(),
        newSession: (options) => this.newSessionHandler(options),
        fork: (entryId) => this.forkHandler(entryId),
        navigateTree: (targetId, options) => this.navigateTreeHandler(targetId, options),
        switchSession: (sessionPath) => this.switchSessionHandler(sessionPath),
        reload: () => this.reloadHandler(),
    };
}
```

### 3.6 noOpUIContext

`noOpUIContext` @ `runner.ts:168` — 无 UI 模式（print/RPC）下的 UI 上下文替身。所有方法要么返回空值（`undefined`, `false`, `""`），要么什么都不做。`theme` 属性返回默认主题。

### 3.7 快捷键冲突检测

`getShortcuts()` @ `runner.ts:344`

**保留快捷键** `RESERVED_ACTIONS_FOR_EXTENSION_CONFLICTS` @ `:53`：
```
interrupt, clear, exit, suspend, cycleThinkingLevel, cycleModelForward,
cycleModelBackward, selectModel, expandTools, toggleThinking, externalEditor,
followUp, submit, selectConfirm, selectCancel, copy, deleteToLineEnd
```

**冲突处理规则**：
1. 扩展快捷键与 **保留内置快捷键** 冲突 → **跳过**，生成 warning
2. 扩展快捷键与 **非保留内置快捷键** 冲突 → **允许覆盖**，生成 warning
3. 两个扩展注册相同快捷键 → **后注册的覆盖前者**，生成 warning

### 3.8 辅助函数

`emitSessionShutdownEvent()` @ `runner.ts:158`：
```typescript
async function emitSessionShutdownEvent(extensionRunner: ExtensionRunner | undefined): Promise<boolean>
```
如果 runner 存在且有 `session_shutdown` handler，则触发事件。返回是否触发成功。

---

## 4. 工具包装（wrapper.ts）

文件路径：`packages/coding-agent/src/core/extensions/wrapper.ts`（119 行）

### 4.1 `wrapRegisteredTool()` @ `wrapper.ts:13`

**签名**：`function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool`

**功能**：将 `RegisteredTool`（扩展注册的工具）转为 `AgentTool`（Agent 核心使用的工具接口）。

**核心逻辑**：
- 复制 `name`, `label`, `description`, `parameters`
- `execute` 方法包装：调用原始 `definition.execute()` 时注入 `runner.createContext()` 作为最后一个参数

### 4.2 `wrapRegisteredTools()` @ `wrapper.ts:29`

**签名**：`function wrapRegisteredTools(registeredTools: RegisteredTool[], runner: ExtensionRunner): AgentTool[]`

**功能**：批量包装，对数组中每个元素调用 `wrapRegisteredTool()`。

### 4.3 `wrapToolWithExtensions()` @ `wrapper.ts:38`

**签名**：`function wrapToolWithExtensions<T>(tool: AgentTool<any, T>, runner: ExtensionRunner): AgentTool<any, T>`

**功能**：在已有工具外包装一层，注入 `tool_call` 和 `tool_result` 事件。这是内置工具被扩展拦截的核心机制。

**详细流程**：

1. 返回新 AgentTool，`...tool` 展开原始属性
2. 新的 `execute` 方法：

**Phase 1 — tool_call 事件**（工具执行前）：
```typescript
if (runner.hasHandlers("tool_call")) {
    const callResult = await runner.emitToolCall({
        type: "tool_call",
        toolName: tool.name,
        toolCallId,
        input: params,
    });
    if (callResult?.block) {
        throw new Error(callResult.reason || "Tool execution was blocked by an extension");
    }
}
```
- 如果有 handler 返回 `{ block: true }`，抛出异常阻止工具执行
- `emitToolCall()` 没有 try/catch，handler 异常会传播
- 外层 catch 处理传播的异常，re-throw

**Phase 2 — 实际工具执行**：
```typescript
const result = await tool.execute(toolCallId, params, signal, onUpdate);
```

**Phase 3 — tool_result 事件**（工具执行后，成功路径）：
```typescript
if (runner.hasHandlers("tool_result")) {
    const resultResult = await runner.emitToolResult({
        type: "tool_result",
        toolName: tool.name,
        toolCallId,
        input: params,
        content: result.content,
        details: result.details,
        isError: false,
    });
    if (resultResult) {
        return {
            content: resultResult.content ?? result.content,
            details: (resultResult.details ?? result.details) as T,
        };
    }
}
```
- 如果有 handler 修改了结果，使用修改后的版本
- 否则返回原始结果

**Phase 4 — tool_result 事件**（工具执行后，失败路径）：
```typescript
catch (err) {
    if (runner.hasHandlers("tool_result")) {
        await runner.emitToolResult({
            type: "tool_result",
            toolName: tool.name,
            toolCallId,
            input: params,
            content: [{ type: "text", text: err.message }],
            details: undefined,
            isError: true,
        });
    }
    throw err;
}
```
- 工具执行失败时也触发 `tool_result` 事件（`isError: true`）
- 异常仍然被 re-throw

### 4.4 `wrapToolsWithExtensions()` @ `wrapper.ts:116`

**签名**：`function wrapToolsWithExtensions<T>(tools: AgentTool<any, T>[], runner: ExtensionRunner): AgentTool<any, T>[]`

**功能**：批量包装，对数组中每个元素调用 `wrapToolWithExtensions()`。

---

## 5. 多 Extension 共存

### 5.1 加载顺序与优先级

**加载顺序**（`discoverAndLoadExtensions()` @ `loader.ts:470`）：

1. **全局扩展**（`~/.pi/agent/extensions/`）最先加载
2. **项目本地扩展**（`<cwd>/.pi/extensions/`）其次
3. **CLI `--extension` 参数指定**的最后加载

在同一目录内，发现顺序取决于 `fs.readdirSync()` 的返回顺序（通常是字母序）。

**扩展加载是串行的**：`loadExtensions()` 使用 `for...of` 循环依次加载，保证确定性。

**事件处理顺序**：`emit()` 遍历 `this.extensions` 数组（保持加载顺序），先加载的扩展先执行 handler。

**顺序的影响**：
- **`context` 事件**：链式替换消息列表，后注册的 handler 看到前一个的输出
- **`before_agent_start`**：`systemPrompt` 链式修改，后注册的收到前一个的修改结果
- **`tool_result`**：`content`/`details`/`isError` 链式修改
- **`input`**：`text`/`images` 链式 transform
- **`session_before_*`**：任一 handler 返回 `cancel: true` 即短路，后续不执行
- **`tool_call`**：任一 handler 返回 `block: true` 即短路
- **`user_bash`**：第一个返回非空结果的 handler 生效
- **`resources_discover`**：所有 handler 结果聚合

**名称冲突**：
- 同名 **工具**：后注册的覆盖前者（因为 Extension 内部 `tools` 是 `Map<string, ...>`）
- 同名 **命令**：后注册的覆盖前者，且与内置命令冲突时被跳过
- 同键 **快捷键**：后注册的覆盖前者（保留键除外）

### 5.2 EventBus 跨扩展通信

文件路径：`packages/coding-agent/src/core/event-bus.ts`（34 行）

#### 接口定义

```typescript
interface EventBus {
    emit(channel: string, data: unknown): void;
    on(channel: string, handler: (data: unknown) => void): () => void;
}

interface EventBusController extends EventBus {
    clear(): void;
}
```

#### `createEventBus()` @ `event-bus.ts:12`

**签名**：`function createEventBus(): EventBusController`

**实现**：
- 基于 Node.js `EventEmitter`
- `emit(channel, data)` — 直接调用 `emitter.emit(channel, data)`
- `on(channel, handler)` — 包装 handler 为 `safeHandler`，内部 `try/catch` 捕获异常并 `console.error`。返回 `() => emitter.off(channel, safeHandler)` 取消函数
- `clear()` — 调用 `emitter.removeAllListeners()` 清除所有监听器

**关键设计**：
- handler 异常不会传播到 emit 调用方
- handler 支持 async（`await handler(data)`）
- 无类型安全（`data: unknown`），扩展需自行断言类型
- 所有扩展共享同一个 EventBus 实例（通过 `createExtensionAPI()` 的 `eventBus` 参数传入）

#### 使用模式

```typescript
// 扩展 A：监听
pi.events.on("my:channel", (data) => {
    const { field } = data as { field: string };
    // ...
});

// 扩展 B：发送
pi.events.emit("my:channel", { field: "value" });
```

取消监听：`const unsubscribe = pi.events.on(...); unsubscribe();`

### 5.3 扩展间依赖

**没有显式依赖机制**。扩展系统不支持声明"我依赖另一个扩展"或"我必须在某个扩展之后加载"。

**隐式依赖方式**：
1. **通过 EventBus 通信**：一个扩展 emit 事件，另一个 listen（松耦合）
2. **通过加载顺序**：如果扩展 A 在 B 之前加载，A 的 handler 总是先执行。可通过文件名/目录位置控制
3. **通过共享 session 数据**：扩展 A 通过 `pi.appendEntry()` 写入数据，扩展 B 通过 `ctx.sessionManager.getBranch()` 读取
4. **通过共享 runtime**：所有扩展共享同一个 `ExtensionRuntime`，一个扩展的 `setActiveTools()` 调用对所有扩展可见

**无法实现的依赖**：
- 无法确保某个扩展已加载（没有 `hasExtension()` API）
- 无法在扩展 A 的工厂函数中调用扩展 B 注册的工具
- 无法强制加载顺序（除非控制文件系统目录结构）

---

## 6. 示例扩展分析

### 6.1 todo.ts — 状态管理 + 自定义工具 + 命令 + 渲染

文件路径：`packages/coding-agent/examples/extensions/todo.ts`（299 行）

**功能**：管理 Todo 列表，LLM 可调用、用户可查看。

**使用的 API**：
- `pi.on("session_start" / "session_switch" / "session_fork" / "session_tree")` — 四个 session 事件中重建状态
- `pi.registerTool()` — 注册 `todo` 工具（带 `renderCall` 和 `renderResult` 自定义渲染）
- `pi.registerCommand("todos")` — 注册 `/todos` 命令
- `ctx.ui.custom()` — 全屏自定义组件显示 Todo 列表

**状态管理模式**：
1. 内存状态 `todos[]` 和 `nextId` 在模块作用域
2. `reconstructState(ctx)` 遍历 `ctx.sessionManager.getBranch()`，找所有 `toolName === "todo"` 的 toolResult 条目，从 `details` 重建状态
3. 每次 session 事件时重建（确保 fork/switch 后状态正确）
4. 每次 tool execute 返回时将完整状态写入 `details`（持久化到 session）

**自定义渲染**：
- `renderCall()` — 单行显示 action + text/id
- `renderResult()` — 按 action 类型显示不同的彩色输出，支持 expanded/collapsed 模式

### 6.2 permission-gate.ts — 工具调用拦截

文件路径：`packages/coding-agent/examples/extensions/permission-gate.ts`（34 行）

**功能**：拦截危险 bash 命令（`rm -rf`, `sudo`, `chmod 777`），弹出确认对话框。

**使用的 API**：
- `pi.on("tool_call")` — 唯一的事件 handler
- `ctx.ui.select()` — 选择对话框
- `ctx.hasUI` — 检查是否有 UI 可用

**关键逻辑**：
1. 检查 `event.toolName === "bash"`
2. 正则匹配危险命令
3. 无 UI 时直接 `{ block: true }`
4. 有 UI 时弹出选择对话框，用户拒绝则 `{ block: true, reason: "Blocked by user" }`
5. 允许则返回 `undefined`（不阻止）

**展示模式**：最小化的 tool_call 拦截器。

### 6.3 event-bus.ts — 扩展间通信

文件路径：`packages/coding-agent/examples/extensions/event-bus.ts`（43 行）

**功能**：演示 `pi.events` 的发布/订阅通信。

**使用的 API**：
- `pi.events.on("my:notification", handler)` — 监听 EventBus 事件
- `pi.events.emit("my:notification", data)` — 发送 EventBus 事件
- `pi.on("session_start")` — 保存 ctx 引用 + 发送启动事件
- `pi.registerCommand("emit")` — 注册 `/emit` 命令

**设计要点**：
1. 在 `session_start` 中保存 `currentCtx` 到模块作用域闭包，供 EventBus handler 使用
2. 同一扩展既监听又发送 — 自己发的事件自己也能收到
3. 频道名用冒号分隔命名空间（`"my:notification"`）是约定，非强制

**展示模式**：EventBus 是 untyped 的（data 是 `unknown`），需要在 handler 中手动断言类型。

---

## 7. 导出（index.ts）

文件路径：`packages/coding-agent/src/core/extensions/index.ts`（167 行）

### 导出来源分布

**从 `../slash-commands.js` 导出类型**：
- `SlashCommandInfo`, `SlashCommandLocation`, `SlashCommandSource`

**从 `./loader.js` 导出函数**：
- `createExtensionRuntime`, `discoverAndLoadExtensions`, `loadExtensionFromFactory`, `loadExtensions`

**从 `./runner.js` 导出**：
- 类：`ExtensionRunner`
- 类型：`ExtensionErrorListener`, `ForkHandler`, `NavigateTreeHandler`, `NewSessionHandler`, `ShutdownHandler`, `SwitchSessionHandler`

**从 `./types.js` 导出类型**（约 100+ 个）：涵盖所有事件接口、Result 类型、Context 类型、API 类型、Tool 类型、Provider 类型、Runtime 类型等。

**从 `./types.js` 导出值**（类型守卫函数）：
- `isBashToolResult`, `isEditToolResult`, `isFindToolResult`, `isGrepToolResult`, `isLsToolResult`, `isReadToolResult`, `isToolCallEventType`, `isWriteToolResult`

**从 `./wrapper.js` 导出函数**：
- `wrapRegisteredTool`, `wrapRegisteredTools`, `wrapToolsWithExtensions`, `wrapToolWithExtensions`
