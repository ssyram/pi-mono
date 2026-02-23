# C - Extension 系统

## 概述

pi-mono 的 Extension 系统是一个事件驱动的插件架构，允许 TypeScript 模块在不修改核心代码的前提下扩展 Coding Agent 的功能。扩展以"工厂函数"模式注册，通过 `ExtensionAPI` 接口订阅 30+ 种事件、注册工具/命令/快捷键/消息渲染器、与 TUI 交互，并能在多个层面控制上下文（消息列表、系统提示、工具调用拦截）。

核心设计哲学：

1. **同进程、无沙盒**：扩展运行在与主进程相同的 Node.js/Bun 进程中，共享内存空间，无隔离边界
2. **事件拦截链**：多个扩展按加载顺序依次执行 handler，部分事件支持 cancel/block/transform
3. **运行时延迟绑定**：加载时 runtime action 是 throwing stub，由 `runner.bindCore()` 注入真正实现
4. **TUI 完全可定制**：扩展可替换编辑器、页脚、页头、覆盖层，甚至注册全屏自定义组件

## 文件树

```
packages/coding-agent/src/core/extensions/
  types.ts      (1342 行) - 所有类型定义：事件、上下文、API、工具、Provider
  loader.ts     (517 行)  - 扩展发现、加载、工厂函数执行
  runner.ts     (827 行)  - 事件派发引擎、上下文创建、错误隔离
  wrapper.ts    (119 行)  - 工具包装：tool_call/tool_result 事件注入
  index.ts      (167 行)  - 公共 API 导出（~150 个类型 + 函数）

packages/coding-agent/src/core/
  event-bus.ts  (34 行)   - 扩展间通信：EventEmitter 封装
  sdk.ts        (367 行)  - SDK 入口：createAgentSession()，编程式使用

packages/coding-agent/examples/extensions/
  60+ 示例扩展（含 hello.ts, pirate.ts, plan-mode/, subagent/, sandbox/ 等）
```

## Extension 生命周期

### 发现与加载

**入口**：`discoverAndLoadExtensions()` @ `loader.ts:470`

扩展从三个位置按优先级发现（先加载的先执行）：

1. **全局扩展**：`~/.pi/agent/extensions/` 目录
2. **项目本地扩展**：`<cwd>/.pi/extensions/` 目录
3. **显式配置路径**：通过 `--extension` 或 `-e` CLI 参数指定

**发现规则** (`discoverExtensionsInDir()` @ `loader.ts:433`)：
- 目录下的 `*.ts` / `*.js` 文件直接加载
- 子目录中的 `index.ts` / `index.js` 作为入口
- 子目录中的 `package.json` 含 `pi.extensions` 字段时，加载声明的路径
- 不递归超过一级

**去重**：通过 `path.resolve()` 后的 `Set<string>` 去重，同一文件不会重复加载。

**模块加载** (`loadExtensionModule()` @ `loader.ts:258`)：
- 使用 `@mariozechner/jiti` (TypeScript-in-JS 运行时) 加载 `.ts` 文件
- Bun 编译二进制中使用 `virtualModules` 映射内置包
- Node.js/开发环境中使用 `alias` 映射到 `node_modules`
- 可用虚拟模块：`@sinclair/typebox`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`

**加载顺序**：严格串行（`for...of` 循环），保证全局 > 本地 > 显式配置的顺序。

### 初始化与注册

**工厂模式**：每个扩展导出一个默认函数（同步或异步），接收 `ExtensionAPI` 参数：

```typescript
// ExtensionFactory 签名
type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
```

**注册阶段** (`createExtensionAPI()` @ `loader.ts:136`)：

工厂函数调用 `pi.on()`, `pi.registerTool()`, `pi.registerCommand()` 等方法时，数据写入该扩展的 `Extension` 对象（局部作用域）。而 `pi.sendMessage()`, `pi.setActiveTools()` 等"action 方法"委托给共享的 `ExtensionRuntime`。

**关键约束**：加载期间调用 action 方法（如 `pi.sendMessage()`）会抛出 `"Extension runtime not initialized"` 错误。这些方法只有在 `runner.bindCore()` 之后才可用。

**内联工厂支持**：`loadExtensionFromFactory()` @ `loader.ts:316` 允许不通过文件路径、直接传入函数来创建扩展。

### 事件派发

由 `ExtensionRunner` 类管理，见下方"事件派发"详细章节。

### 卸载/清理

扩展系统没有显式的"卸载"API。清理通过以下机制实现：

1. **`session_shutdown` 事件**：进程退出前触发，扩展可在此释放资源
   - 辅助函数：`emitSessionShutdownEvent()` @ `runner.ts:158`
2. **`EventBusController.clear()`**：清除所有 event bus 监听器
3. **重新加载**：`ExtensionCommandContext.reload()` 可触发完整的扩展重新加载

---

## 事件类型完整分类

共 30 种事件类型，按生命周期阶段分为 7 组。

### 资源发现事件 (1 种)

| 事件名 | 触发时机 | 返回值类型 | 说明 |
|--------|---------|-----------|------|
| `resources_discover` | `session_start` 后 | `ResourcesDiscoverResult` | 允许扩展注册额外的 skill/prompt/theme 路径 |

**Handler 签名**：
```typescript
(event: { type: "resources_discover"; cwd: string; reason: "startup" | "reload" }, ctx) =>
  { skillPaths?: string[]; promptPaths?: string[]; themePaths?: string[] }
```

**派发函数**：`emitResourcesDiscover()` @ `runner.ts:748`

### 会话生命周期事件 (10 种)

| 事件名 | 触发时机 | 可取消 | 返回值类型 |
|--------|---------|--------|-----------|
| `session_start` | 初始会话加载 | 否 | `void` |
| `session_before_switch` | 切换/新建会话前 | **是** | `{ cancel?: boolean }` |
| `session_switch` | 切换会话后 | 否 | `void` |
| `session_before_fork` | 分叉会话前 | **是** | `{ cancel?: boolean; skipConversationRestore?: boolean }` |
| `session_fork` | 分叉会话后 | 否 | `void` |
| `session_before_compact` | 上下文压缩前 | **是** | `{ cancel?: boolean; compaction?: CompactionResult }` |
| `session_compact` | 上下文压缩后 | 否 | `void` |
| `session_before_tree` | 会话树导航前 | **是** | `{ cancel?: boolean; summary?: {...}; ... }` |
| `session_tree` | 会话树导航后 | 否 | `void` |
| `session_shutdown` | 进程退出 | 否 | `void` |

**关键：`session_before_compact` 可完全替换压缩逻辑**。返回 `{ compaction: { summary, firstKeptEntryId, tokensBefore } }` 即可跳过默认压缩，使用自定义摘要。见示例 `custom-compaction.ts`。

**`session_before_tree` 可替换分支摘要**。返回 `{ summary: { summary: string } }` 即可使用自定义摘要。

### Agent 循环事件 (6 种)

| 事件名 | 触发时机 | 返回值类型 | 说明 |
|--------|---------|-----------|------|
| `context` | **每次 LLM 调用前** | `{ messages?: AgentMessage[] }` | **可修改发送给 LLM 的消息列表** |
| `before_agent_start` | 用户提交后、Agent 循环前 | `{ message?: CustomMessage; systemPrompt?: string }` | 可注入消息、修改系统提示 |
| `agent_start` | Agent 循环开始 | `void` | |
| `agent_end` | Agent 循环结束 | `void` | 携带 `messages: AgentMessage[]` |
| `turn_start` | 每个 turn 开始 | `void` | 携带 `turnIndex`, `timestamp` |
| `turn_end` | 每个 turn 结束 | `void` | 携带 `message`, `toolResults` |

**`context` 事件是上下文控制的核心**。Handler 接收 `structuredClone` 后的消息列表副本，可返回修改后的消息列表。多个 handler 链式执行，后一个 handler 接收前一个的输出。

**派发函数**：`emitContext()` @ `runner.ts:659`

```typescript
// runner.ts:659 - 关键实现
async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    let currentMessages = structuredClone(messages);  // 深拷贝！
    for (const ext of this.extensions) {
        for (const handler of ext.handlers.get("context") ?? []) {
            const result = await handler({ type: "context", messages: currentMessages }, ctx);
            if (result?.messages) {
                currentMessages = result.messages;  // 替换消息列表
            }
        }
    }
    return currentMessages;
}
```

**`before_agent_start` 可修改系统提示**。多个扩展的 `systemPrompt` 返回值链式应用——后一个扩展收到前一个修改后的 `systemPrompt`。

**派发函数**：`emitBeforeAgentStart()` @ `runner.ts:691`

### 消息流事件 (3 种)

| 事件名 | 触发时机 | 返回值类型 | 说明 |
|--------|---------|-----------|------|
| `message_start` | 消息开始（user/assistant/toolResult） | `void` | |
| `message_update` | 流式输出中的逐 token 更新 | `void` | 携带 `assistantMessageEvent` |
| `message_end` | 消息结束 | `void` | |

### 工具事件 (5 种)

| 事件名 | 触发时机 | 返回值类型 | 说明 |
|--------|---------|-----------|------|
| `tool_call` | 工具执行前 | `{ block?: boolean; reason?: string }` | **可阻止工具执行** |
| `tool_result` | 工具执行后 | `{ content?; details?; isError? }` | **可修改工具结果** |
| `tool_execution_start` | 工具开始执行 | `void` | |
| `tool_execution_update` | 工具流式输出 | `void` | |
| `tool_execution_end` | 工具执行完成 | `void` | 携带 `isError` |

**`tool_call` 的类型守卫**：
```typescript
// 内置工具自动窄化
if (isToolCallEventType("bash", event)) {
    event.input.command;  // string - 完全类型安全
}
```

每个内置工具有独立的事件类型：`BashToolCallEvent`, `ReadToolCallEvent`, `EditToolCallEvent`, `WriteToolCallEvent`, `GrepToolCallEvent`, `FindToolCallEvent`, `LsToolCallEvent`，以及通用的 `CustomToolCallEvent`。

**`tool_result` 链式修改**：`emitToolResult()` @ `runner.ts:557` 使用浅拷贝 `{ ...event }` 并在每个 handler 后更新 `content`/`details`/`isError`。

### 输入事件 (1 种)

| 事件名 | 触发时机 | 返回值类型 | 说明 |
|--------|---------|-----------|------|
| `input` | 用户输入后、Agent 处理前 | `InputEventResult` | 可 transform/handled |

**三种处理结果**：
- `{ action: "continue" }`：不做处理，传递给下一个 handler
- `{ action: "transform", text, images? }`：修改输入文本
- `{ action: "handled" }`：**短路**，不发送给 LLM

**派发函数**：`emitInput()` @ `runner.ts:797`

### 模型事件 (1 种)

| 事件名 | 触发时机 | 返回值类型 | 说明 |
|--------|---------|-----------|------|
| `model_select` | 切换模型时 | `void` | 携带 `model`, `previousModel`, `source` |

### 用户 Bash 事件 (1 种)

| 事件名 | 触发时机 | 返回值类型 | 说明 |
|--------|---------|-----------|------|
| `user_bash` | 用户通过 `!`/`!!` 前缀执行命令时 | `{ operations?: BashOperations; result?: BashResult }` | 可替换执行逻辑 |

---

## 扩展能力清单

### 自定义工具

**注册方式**：`pi.registerTool(definition)` @ `loader.ts:150`

```typescript
interface ToolDefinition<TParams, TDetails> {
    name: string;           // LLM 调用名
    label: string;          // UI 显示名
    description: string;    // LLM 描述
    parameters: TParams;    // TypeBox schema
    execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>>;
    renderCall?(args, theme): Component;       // 可选：自定义调用渲染
    renderResult?(result, options, theme): Component;  // 可选：自定义结果渲染
}
```

**工具包装** (`wrapper.ts`)：
- `wrapRegisteredTool()` 将 `RegisteredTool` 转为 `AgentTool`，注入 `runner.createContext()`
- `wrapToolWithExtensions()` 在原生工具外包一层，先触发 `tool_call` 事件（可阻止），执行后触发 `tool_result` 事件（可修改结果）

**覆盖内置工具**：扩展可注册同名工具来替换内置工具（如 `read`），见示例 `tool-override.ts`。

**工具管理 API**：
- `pi.getActiveTools(): string[]` - 获取当前活动工具名列表
- `pi.getAllTools(): ToolInfo[]` - 获取所有工具（含 name, description, parameters）
- `pi.setActiveTools(names)` - 设置活动工具集

### 自定义命令

**注册方式**：`pi.registerCommand(name, options)` @ `loader.ts:157`

```typescript
interface RegisteredCommand {
    name: string;
    description?: string;
    getArgumentCompletions?(argumentPrefix: string): AutocompleteItem[] | null;
    handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}
```

命令 handler 接收 `ExtensionCommandContext`（比普通 `ExtensionContext` 多出 session 控制方法：`waitForIdle()`, `newSession()`, `fork()`, `navigateTree()`, `switchSession()`, `reload()`）。

**冲突检测**：`getRegisteredCommands()` @ `runner.ts:424` 会跳过与内置命令同名的扩展命令，生成警告诊断。

### 快捷键

**注册方式**：`pi.registerShortcut(shortcut, options)` @ `loader.ts:161`

```typescript
pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
});
```

**保留键**（不可覆盖）：`interrupt`, `clear`, `exit`, `suspend`, `cycleThinkingLevel`, `cycleModelForward/Backward`, `selectModel`, `expandTools`, `toggleThinking`, `externalEditor`, `followUp`, `submit`, `selectConfirm/Cancel`, `copy`, `deleteToLineEnd`。

非保留键可被扩展覆盖（生成警告但允许）。

### UI 组件注册

`ExtensionUIContext` 提供丰富的 TUI 控制能力：

**对话框**：
- `ui.select(title, options, opts?)` - 选择器
- `ui.confirm(title, message, opts?)` - 确认对话框
- `ui.input(title, placeholder?, opts?)` - 文本输入
- `ui.editor(title, prefill?)` - 多行编辑器
- `ui.notify(message, type?)` - 通知消息

**布局组件**：
- `ui.setWidget(key, content, options?)` - 编辑器上方/下方的 widget（支持纯文本数组或 Component 工厂）
- `ui.setFooter(factory | undefined)` - 替换整个页脚
- `ui.setHeader(factory | undefined)` - 替换页头
- `ui.setEditorComponent(factory | undefined)` - **替换整个输入编辑器**（见 `modal-editor.ts` 示例：Vim 模式编辑器）
- `ui.custom(factory, options?)` - 显示全屏自定义组件，支持 overlay 模式

**状态控制**：
- `ui.setStatus(key, text | undefined)` - 页脚状态栏
- `ui.setWorkingMessage(message?)` - 流式输出时的等待消息
- `ui.setTitle(title)` - 终端标题
- `ui.setToolsExpanded(expanded)` - 工具输出展开/折叠

**编辑器交互**：
- `ui.setEditorText(text)` / `ui.getEditorText()` - 读写编辑器内容
- `ui.pasteToEditor(text)` - 粘贴文本（触发粘贴处理）

**主题控制**：
- `ui.theme` - 当前主题
- `ui.getAllThemes()` / `ui.getTheme(name)` / `ui.setTheme(theme)` - 主题管理

**终端输入拦截**：
- `ui.onTerminalInput(handler)` - 监听原始终端输入，可消费/修改按键

### 消息渲染器

**注册方式**：`pi.registerMessageRenderer(customType, renderer)` @ `loader.ts:181`

```typescript
type MessageRenderer<T> = (
    message: CustomMessage<T>,
    options: { expanded: boolean },
    theme: Theme,
) => Component | undefined;
```

与 `pi.sendMessage({ customType: "xxx", content, display: true, details })` 配合使用，自定义消息在 TUI 中的显示方式。

### 上下文控制

**核心能力 - 可修改消息列表**：

1. **`context` 事件**（最强大）：每次 LLM 调用前触发，可完全替换消息列表
   - 消息经过 `structuredClone()` 深拷贝，扩展修改不影响原始数据
   - 可添加/删除/修改任意消息
   - 示例：`plan-mode/index.ts` 在非 plan mode 时过滤掉 `[PLAN MODE ACTIVE]` 消息

2. **`before_agent_start` 事件**：可注入 CustomMessage 和修改 systemPrompt
   - systemPrompt 链式修改：后一个扩展收到前一个修改后的值
   - 示例：`pirate.ts` 动态追加系统提示

3. **`input` 事件**：可拦截/转换用户输入
   - `"handled"` 动作阻止消息进入 LLM
   - `"transform"` 动作修改输入文本

4. **`tool_result` 事件**：可修改工具结果内容
   - 修改 `content`, `details`, `isError`

5. **`session_before_compact` 事件**：可替换整个压缩逻辑
   - 返回自定义 `CompactionResult` 完全替代默认压缩

### Provider 注册

**注册方式**：`pi.registerProvider(name, config)` @ `loader.ts:248`

允许扩展注册自定义 AI Provider，支持：
- 新 Provider + 自定义模型
- 覆盖已有 Provider 的 baseUrl
- OAuth 登录流程
- 自定义 `streamSimple` handler

**延迟处理**：Provider 注册在加载期间队列化（`pendingProviderRegistrations`），在 `bindCore()` 时统一处理。

### 扩展间通信

**EventBus**：`pi.events` 提供简单的发布/订阅机制。

```typescript
// event-bus.ts
interface EventBus {
    emit(channel: string, data: unknown): void;
    on(channel: string, handler: (data: unknown) => void): () => void;
}
```

基于 Node.js `EventEmitter`，handler 异常被 `try/catch` 捕获并 `console.error`。

### 其他 API

- `pi.sendMessage(message, options?)` - 发送自定义消息（可触发 turn 或不触发）
- `pi.sendUserMessage(content, options?)` - 发送用户消息（总是触发 turn）
- `pi.appendEntry(customType, data?)` - 追加自定义条目到 session（不发送给 LLM，用于状态持久化）
- `pi.setSessionName(name)` / `pi.getSessionName()` - session 显示名
- `pi.setLabel(entryId, label)` - 给条目设标签
- `pi.exec(command, args, options?)` - 执行 shell 命令
- `pi.setModel(model)` / `pi.getThinkingLevel()` / `pi.setThinkingLevel(level)` - 模型控制
- `pi.registerFlag(name, options)` / `pi.getFlag(name)` - CLI flag 注册与读取
- `pi.getCommands()` - 获取当前可用的 slash 命令

---

## 关键类型/接口

### Extension（已加载的扩展实例）

```typescript
// types.ts:1313
interface Extension {
    path: string;                              // 原始路径
    resolvedPath: string;                      // 解析后的绝对路径
    handlers: Map<string, HandlerFn[]>;        // 事件名 -> handler 列表
    tools: Map<string, RegisteredTool>;        // 工具名 -> 工具定义
    messageRenderers: Map<string, MessageRenderer>;  // customType -> 渲染器
    commands: Map<string, RegisteredCommand>;   // 命令名 -> 命令定义
    flags: Map<string, ExtensionFlag>;          // flag 名 -> flag 定义
    shortcuts: Map<KeyId, ExtensionShortcut>;   // 快捷键 -> handler
}
```

### ExtensionContext（事件 handler 的上下文）

```typescript
// types.ts:261
interface ExtensionContext {
    ui: ExtensionUIContext;               // UI 方法
    hasUI: boolean;                       // 是否有 UI（print/RPC 模式下为 false）
    cwd: string;                          // 工作目录
    sessionManager: ReadonlySessionManager;  // 只读 session 管理器
    modelRegistry: ModelRegistry;         // 模型注册表
    model: Model<any> | undefined;        // 当前模型（getter，动态解析）
    isIdle(): boolean;                    // Agent 是否空闲
    abort(): void;                        // 中止当前操作
    hasPendingMessages(): boolean;        // 是否有排队消息
    shutdown(): void;                     // 优雅关闭
    getContextUsage(): ContextUsage | undefined;  // 上下文 token 使用情况
    compact(options?): void;              // 触发压缩
    getSystemPrompt(): string;            // 获取当前系统提示
}
```

### ExtensionCommandContext（命令 handler 的增强上下文）

```typescript
// types.ts:294
interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle(): Promise<void>;         // 等待 Agent 完成
    newSession(options?): Promise<{ cancelled: boolean }>;
    fork(entryId): Promise<{ cancelled: boolean }>;
    navigateTree(targetId, options?): Promise<{ cancelled: boolean }>;
    switchSession(sessionPath): Promise<{ cancelled: boolean }>;
    reload(): Promise<void>;              // 重新加载扩展/skills/prompts/themes
}
```

### ExtensionRuntime（共享运行时状态）

```typescript
// types.ts:1246-1310
interface ExtensionRuntimeState {
    flagValues: Map<string, boolean | string>;
    pendingProviderRegistrations: Array<{ name: string; config: ProviderConfig }>;
}

interface ExtensionRuntime extends ExtensionRuntimeState, ExtensionActions {}
```

### ExtensionRunner（事件派发引擎）

`ExtensionRunner` 类 @ `runner.ts:196` 是运行时核心，管理：

- **绑定**：`bindCore(actions, contextActions)` 注入真正的 action 实现
- **绑定**：`bindCommandContext(actions?)` 注入 session 控制方法
- **UI 上下文**：`setUIContext(uiContext?)` 设置 UI 实现（interactive/RPC/print 各有不同）
- **上下文创建**：`createContext()` / `createCommandContext()` 为 handler 创建上下文对象

---

## 事件派发机制详解

### 通用 emit（大部分事件）

```typescript
// runner.ts:523
async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>>
```

遍历所有扩展，按加载顺序执行 handler。对 `session_before_*` 事件，如果任一 handler 返回 `{ cancel: true }`，立即短路返回。

### 专用 emit 方法

| 方法 | 事件 | 特殊行为 |
|------|------|---------|
| `emitContext()` | `context` | `structuredClone` 深拷贝，链式替换 messages |
| `emitBeforeAgentStart()` | `before_agent_start` | 聚合所有 handler 的 message + 链式 systemPrompt |
| `emitToolCall()` | `tool_call` | `block=true` 时短路 |
| `emitToolResult()` | `tool_result` | 链式修改 content/details/isError |
| `emitUserBash()` | `user_bash` | 第一个返回结果的 handler 生效 |
| `emitResourcesDiscover()` | `resources_discover` | 聚合所有 handler 的路径 |
| `emitInput()` | `input` | `"handled"` 短路，`"transform"` 链式 |

### 错误隔离

所有 handler 执行都在 `try/catch` 中，错误通过 `emitError()` @ `runner.ts:398` 报告：

```typescript
interface ExtensionError {
    extensionPath: string;
    event: string;
    error: string;
    stack?: string;
}
```

单个扩展的 handler 异常不会影响其他扩展的执行（除了 `emitToolCall()` 的 `catch` 块会 re-throw，导致工具执行被阻止）。

---

## 示例扩展分析

### 最小示例：hello.ts
```typescript
export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "hello",
        label: "Hello",
        description: "A simple greeting tool",
        parameters: Type.Object({ name: Type.String() }),
        async execute(_id, params) {
            return { content: [{ type: "text", text: `Hello, ${params.name}!` }] };
        },
    });
}
```
展示了工具注册的最简形式。

### 上下文控制：pirate.ts + plan-mode/
- **pirate.ts**：通过 `before_agent_start` 动态追加系统提示，改变 Agent 行为
- **plan-mode/**：综合使用 `context` 事件（过滤消息）、`before_agent_start`（注入上下文消息）、`tool_call`（阻止危险命令）、`agent_end`（提取计划步骤）、`turn_end`（追踪进度）、widget/status（UI 反馈）、`appendEntry`（状态持久化）。是最复杂的示例之一

### 工具拦截：permission-gate.ts + confirm-destructive.ts
- **permission-gate.ts**：`tool_call` 事件拦截危险 bash 命令，通过 `ui.select()` 弹出确认对话框
- **confirm-destructive.ts**：`session_before_switch`/`session_before_fork` 事件阻止意外的会话操作

### 工具覆盖：tool-override.ts
注册同名 `read` 工具替换内置实现，添加审计日志和敏感路径阻止。展示了"不提供 renderCall/renderResult 时自动使用内置渲染器"的特性。

### 自定义压缩：custom-compaction.ts
`session_before_compact` handler 使用 Gemini Flash 模型生成完整摘要，替换默认压缩行为。展示了 `modelRegistry.find()` + `modelRegistry.getApiKey()` + `complete()` 的组合使用。

### UI 深度定制：modal-editor.ts
通过 `CustomEditor` 基类实现 Vim 模式编辑器，展示了 `setEditorComponent()` 的强大能力。扩展了 `handleInput()` 方法实现模式切换和键映射。

### 子代理：subagent/
最复杂的示例。注册一个 `subagent` 工具，通过 `spawn("pi", ...)` 启动隔离的 pi 进程。支持单任务、并行、链式三种模式，包含完整的 `renderCall` 和 `renderResult` 自定义渲染。

### OS 级沙盒：sandbox/
使用 `@anthropic-ai/sandbox-runtime` 包装 bash 执行。通过 `user_bash` 事件替换执行逻辑，通过 `registerTool` 覆盖 bash 工具，通过 `registerFlag` 添加 `--no-sandbox` 选项。

### 动态资源：dynamic-resources/
`resources_discover` 事件返回额外的 skill/prompt/theme 路径，展示了扩展如何动态添加资源。

### 扩展间通信：event-bus.ts
通过 `pi.events.emit()` 和 `pi.events.on()` 实现扩展间的发布-订阅通信。

---

## 与其他 Domain 的接口

### 与 Agent Loop (Domain A) 的接口
- `context` 事件由 Agent 的 `transformContext` 回调触发（`sdk.ts:297`）
- `before_agent_start` 在用户提交后、Agent loop 启动前触发
- `tool_call`/`tool_result` 通过 `wrapToolWithExtensions()` 注入到工具执行链中

### 与 Compaction (Domain B) 的接口
- `session_before_compact` 可完全替换压缩结果（`CompactionResult`）
- `session_compact` 在压缩完成后通知扩展
- 扩展可通过 `ctx.compact(options?)` 主动触发压缩

### 与 Session Manager 的接口
- `ctx.sessionManager`（ReadonlySessionManager）：`getEntries()`, `getBranch()`, `buildSessionContext()`
- `pi.appendEntry()` 写入自定义条目到 session 文件（持久化扩展状态）
- `ExtensionCommandContext` 提供写入能力：`newSession()`, `fork()`, `navigateTree()`, `switchSession()`

### 与 TUI 的接口
- `ExtensionUIContext` 完全控制 TUI 布局和交互
- `CustomEditor` 基类允许替换输入编辑器
- `MessageRenderer` 控制自定义消息的显示
- `renderCall`/`renderResult` 控制工具调用/结果的显示

### 与 Model Registry 的接口
- `pi.registerProvider()` 注册新的 AI Provider
- `pi.setModel()` / `pi.getThinkingLevel()` / `pi.setThinkingLevel()` 控制模型
- `ctx.modelRegistry.find()` / `ctx.modelRegistry.getApiKey()` 查找和认证模型

---

## 开发指南：Extension vs SDK

### Extension 方式

**适用场景**：在现有 pi Coding Agent 上添加功能、修改行为。

**优势**：
- 零配置开发：把 `.ts` 文件放到 `~/.pi/agent/extensions/` 即可
- 无需编译：jiti 运行时直接执行 TypeScript
- 热重载：`/reload` 命令重新加载扩展
- 30+ 事件钩子覆盖 Agent 的完整生命周期
- 可复用 pi 的所有基础设施（TUI、session、model registry、tools）

**局限**：
- 同进程执行，崩溃影响主进程
- 无法修改 Agent 核心循环逻辑（只能通过事件钩子干预）
- `sessionManager` 在事件 handler 中是只读的（写操作需要通过命令 handler 的 `ExtensionCommandContext`）

### SDK 方式

**适用场景**：构建全新的 Coding Agent 或将 pi 嵌入其他应用。

**入口**：`createAgentSession()` @ `sdk.ts:165`

```typescript
const { session } = await createAgentSession({
    model: getModel('anthropic', 'claude-opus-4-5'),
    thinkingLevel: 'high',
    tools: [readTool, bashTool],
    customTools: [myCustomTool],
});
```

**优势**：
- 完全控制 Agent 的创建参数（模型、工具、session 管理）
- 可替换 ResourceLoader、SessionManager、SettingsManager
- 可内嵌到其他 Node.js 应用中
- 扩展仍然可用（通过 `extensionsResult`）

**局限**：
- 需要自行管理 TUI 或提供 `ExtensionUIContext` 实现
- 需要自行调用 `runner.bindCore()` 等初始化步骤
- API 表面更大，学习曲线更陡

### 上下文控制方面的对比

| 能力 | Extension | SDK |
|------|-----------|-----|
| 修改消息列表 | `context` 事件 | 直接操作 `agent.replaceMessages()` |
| 修改系统提示 | `before_agent_start` 返回 `systemPrompt` | `agent.state.systemPrompt` |
| 添加/删除工具 | `pi.setActiveTools()` / `pi.registerTool()` | `tools` 参数 / `agent.state.tools` |
| 拦截工具调用 | `tool_call` 事件 | `wrapToolWithExtensions()` 或自定义包装 |
| 控制压缩 | `session_before_compact` 事件 | 自定义 SessionManager |
| 拦截用户输入 | `input` 事件 | 直接控制输入流 |

**结论**：如果目标是**控制上下文**（添加/删除/修改消息），Extension 方式通过 `context` 事件已经提供了完整能力——它可以在每次 LLM 调用前拿到 `structuredClone` 后的完整消息列表，并返回修改后的版本。这是最直接、最低成本的方案。

如果目标是**构建全新的 Coding Agent**（不依赖 pi 的 Agent loop），则需要使用 SDK 方式或直接构建在 `@mariozechner/pi-agent-core` 之上。

### 推荐策略

1. **先用 Extension**：90% 的定制需求可通过 Extension 实现，包括完整的上下文控制
2. **Extension 不够时用 SDK**：当需要替换 Agent loop 核心逻辑、自定义 session 存储格式、或嵌入其他应用时
3. **两者可组合**：SDK 创建的 session 仍然加载和运行 Extension
