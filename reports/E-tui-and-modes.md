# E - TUI 与执行模式

## 概述

pi-mono 的 TUI 库（`@mariozechner/pi-tui`）是一个独立的 npm 包，提供终端差分渲染引擎、组件系统和键盘输入处理。它不依赖 coding-agent 的任何模块，可独立使用。

coding-agent 提供 4 种执行模式：Interactive（TUI 交互）、Print（单次输出）、RPC（JSON 协议无头运行）、SDK（通过 `RpcClient` 编程接入）。每种模式都创建 `AgentSession` 但以不同方式驱动输入/输出。

## 文件树

```
packages/tui/src/
  index.ts                 # 导出入口
  tui.ts                   # TUI 核心类 + Component/Container 接口（~1187行）
  terminal.ts              # Terminal 接口 + ProcessTerminal 实现（~324行）
  keys.ts                  # 键盘解析（legacy + Kitty 协议）（~34KB）
  keybindings.ts           # Editor 快捷键配置
  editor-component.ts      # EditorComponent 接口（自定义编辑器契约）
  autocomplete.ts          # 自动补全 Provider
  fuzzy.ts                 # 模糊匹配
  stdin-buffer.ts          # stdin 批量拆分缓冲
  terminal-image.ts        # Kitty/iTerm2 图像协议
  kill-ring.ts             # Emacs 式 kill ring
  undo-stack.ts            # 撤销栈
  utils.ts                 # ANSI 字符串工具（visibleWidth, wrapTextWithAnsi 等）
  components/
    box.ts                 # 带 padding 和背景色的容器
    cancellable-loader.ts  # 可用 ESC 取消的 Loader
    editor.ts              # 多行文本编辑器（自动补全、word-wrap、undo）
    image.ts               # 终端图像渲染组件
    input.ts               # 单行文本输入
    loader.ts              # 旋转动画加载器
    markdown.ts            # Markdown 渲染组件
    select-list.ts         # 选项列表（搜索、滚动）
    settings-list.ts       # 设置项列表（label-value 对、子菜单）
    spacer.ts              # 空行占位
    text.ts                # 多行文本（word-wrap、padding、背景）
    truncated-text.ts      # 单行截断文本

packages/coding-agent/src/modes/
  index.ts                 # 模式分发入口
  print-mode.ts            # Print 模式
  rpc/
    rpc-mode.ts            # RPC 模式服务端
    rpc-types.ts           # RPC 协议类型定义
    rpc-client.ts          # RPC 客户端（SDK 模式）
  interactive/
    interactive-mode.ts    # TUI 交互模式（~2600行）
    theme/theme.ts         # 主题系统
    components/            # Interactive 模式专用组件（35个）
```

## TUI 库（packages/tui/）

### TUI 核心类

TUI 类继承自 `Container`（而 `Container` 实现了 `Component` 接口），是整个渲染系统的根节点。

#### 公共 API 列表

| 方法 | 描述 | 位置 |
|------|------|------|
| `constructor(terminal, showHardwareCursor?)` | 创建 TUI 实例 | `tui.ts:230` |
| `start()` | 启动终端输入监听和渲染循环 | `tui.ts:373` |
| `stop()` | 停止 TUI，恢复终端状态 | `tui.ts:406` |
| `requestRender(force?)` | 请求下一次 tick 渲染，`force=true` 全量重绘 | `tui.ts:424` |
| `setFocus(component)` | 设置焦点组件（输入路由） | `tui.ts:268` |
| `showOverlay(component, options?)` | 显示覆盖层组件，返回 `OverlayHandle` | `tui.ts:286` |
| `hideOverlay()` | 隐藏最顶层覆盖层 | `tui.ts:333` |
| `hasOverlay()` | 检查是否有可见覆盖层 | `tui.ts:345` |
| `addInputListener(listener)` | 添加全局输入拦截器 | `tui.ts:384` |
| `removeInputListener(listener)` | 移除输入拦截器 | `tui.ts:389` |
| `addChild(component)` / `removeChild(component)` | 继承自 Container | `tui.ts:168-176` |
| `invalidate()` | 使所有子组件缓存失效 | `tui.ts:368` |
| `setShowHardwareCursor(enabled)` | 控制硬件光标 | `tui.ts:246` |
| `setClearOnShrink(enabled)` | 内容缩小时是否清除空行 | `tui.ts:264` |
| `onDebug` | 全局调试键回调 (Shift+Ctrl+D) | `tui.ts:209` |
| `terminal` | 公共属性，直接访问 Terminal 实例 | `tui.ts:202` |

#### 初始化流程

```
TUI.start()
  -> terminal.start(onInput, onResize)    # 设置 raw mode, 键盘监听, resize 监听
  -> terminal.hideCursor()                 # 默认隐藏光标
  -> queryCellSize()                       # 查询终端 cell 像素尺寸（图像渲染用）
  -> requestRender()                       # 触发首次渲染
```

`start()` @ `tui.ts:373` 调用 `terminal.start()` 将 stdin 设为 raw 模式，注册 `handleInput` 和 `requestRender` 两个回调。terminal 实现可替换（只需实现 `Terminal` 接口）。

#### 渲染循环

渲染是 **被动触发** 的，不是定时轮询：

1. `requestRender()` @ `tui.ts:424` 在 `process.nextTick` 调度一次 `doRender()`
2. 同一 tick 内多次调用只触发一次渲染（`renderRequested` 去重）
3. `doRender()` @ `tui.ts:848` 执行差分渲染

`doRender()` 流程：
```
1. 调用 this.render(width) 递归渲染所有子组件 -> newLines
2. compositeOverlays() 将覆盖层合成到内容上
3. extractCursorPosition() 提取 CURSOR_MARKER 位置
4. applyLineResets() 在每行末尾添加 ANSI reset
5. 差分比较：找 firstChanged / lastChanged
6. 使用 Synchronized Output (CSI ?2026h/l) 批量写入
7. positionHardwareCursor() 处理 IME 光标定位
```

关键优化点：
- **差分渲染**：只更新变化的行，不重绘整个屏幕
- **Synchronized Output**：使用 DEC 私有序列包裹写入，防止闪烁
- **宽度超限检测**：渲染后检查行宽，超宽则 crash（带 debug log）

#### 缓冲区管理

TUI 维护 `previousLines: string[]` 作为上一帧的快照。每次 `doRender()` 对比新旧行数组，只输出差异部分。视口通过 `maxLinesRendered` 和 `termHeight` 计算：

```
viewportTop = max(0, maxLinesRendered - termHeight)
```

覆盖层（Overlay）的合成在差分比较之前完成，通过 `compositeLineAt()` 在指定行列位置「贴入」覆盖层内容。

### 组件系统

#### 组件基类/接口

```typescript
// packages/tui/src/tui.ts:16
interface Component {
  render(width: number): string[];     // 渲染为行数组
  handleInput?(data: string): void;    // 可选：处理键盘输入
  wantsKeyRelease?: boolean;           // 可选：接收 key release
  invalidate(): void;                  // 清除渲染缓存
}

// packages/tui/src/tui.ts:51
interface Focusable {
  focused: boolean;                    // TUI 在 setFocus 时设置
}
```

`Container` 类（`tui.ts:165`）是组件容器，`render()` 依次渲染子组件并拼接行数组。TUI 自身继承 Container。

`EditorComponent` 接口（`editor-component.ts`）是自定义编辑器的契约，包含 `getText()`、`setText()`、`handleInput()`、`onSubmit`、`onChange` 等。

#### 组件列表

| 组件 | 描述 |
|------|------|
| `Box` | 带 padding 和背景色的容器，嵌套子组件 |
| `CancellableLoader` | 继承 Loader，支持 ESC 取消 + AbortSignal |
| `Editor` | 多行文本编辑器，word-wrap、自动补全、undo/redo、kill ring |
| `Image` | 终端图像渲染（Kitty 协议 / iTerm2 协议 / 文本 fallback） |
| `Input` | 单行文本输入，水平滚动 |
| `Loader` | 旋转动画加载指示器（80ms 间隔） |
| `Markdown` | Markdown -> ANSI 渲染（代码块语法高亮、链接、列表等） |
| `SelectList` | 可搜索的选项列表，支持滚动和键盘导航 |
| `SettingsList` | 键值对设置列表，支持循环值切换和子菜单 |
| `Spacer` | 空行占位组件 |
| `Text` | 多行文本显示，word-wrap、padding、可选背景 |
| `TruncatedText` | 单行截断文本（不换行） |

#### 组件挂载机制

组件通过树形结构挂载：

```typescript
// 根节点是 TUI（继承 Container）
const tui = new TUI(terminal);
tui.addChild(header);       // Container.addChild()
tui.addChild(chatArea);
tui.addChild(editor);
tui.addChild(footer);
tui.setFocus(editor);       // 键盘输入路由到 editor
tui.start();                // 启动渲染
```

渲染时 `Container.render(width)` 遍历 `children` 数组依次调用 `child.render(width)`，将返回的行数组拼接。**没有** 虚拟 DOM 或 reconciliation，组件直接返回 `string[]`。

覆盖层通过 `tui.showOverlay(component, overlayOptions)` 显示，在主内容渲染后通过字符级别的行合成叠加显示。

### TUI 是否可独立使用？

**可以**。`@mariozechner/pi-tui` 是独立的 npm 包，有自己的 `package.json`，MIT 许可。它的依赖只有 `chalk`、`marked`、`get-east-asian-width`、`mime-types`、`koffi`（仅 Windows）。

不依赖 `pi-agent-core`、`pi-ai` 或 `pi-coding-agent` 的任何模块。

独立使用示例：

```typescript
import { TUI, ProcessTerminal, Container, Text, Editor, Spacer } from "@mariozechner/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

const header = new Text("My App", 1, 1);
const editor = new Editor(tui, { /* theme */ });

tui.addChild(header);
tui.addChild(new Spacer(1));
tui.addChild(editor);
tui.setFocus(editor);
tui.start();

// 后续用 tui.requestRender() 触发重绘
```

**限制**：
1. `Editor` 组件需要传入 `TUI` 实例（用于 Loader 动画的 requestRender）
2. `Loader` / `CancellableLoader` 需要 `TUI` 实例（定时器触发重绘）
3. `Markdown` 和 `SelectList` 需要外部传入主题函数（`MarkdownTheme` / `SelectListTheme`）
4. 没有内建的布局系统（flex / grid），只有线性垂直拼接

## 执行模式

### 模式分发入口

`packages/coding-agent/src/modes/index.ts` 导出 4 个入口：

```typescript
export { InteractiveMode, type InteractiveModeOptions } from "./interactive/interactive-mode.js";
export { type PrintModeOptions, runPrintMode } from "./print-mode.js";
export { type ModelInfo, RpcClient, type RpcClientOptions, type RpcEventListener } from "./rpc/rpc-client.js";
export { runRpcMode } from "./rpc/rpc-mode.js";
export type { RpcCommand, RpcResponse, RpcSessionState } from "./rpc/rpc-types.js";
```

所有模式共享同一个 `AgentSession` 实例（在上层创建后传入），模式只负责 I/O 绑定。

### Interactive 模式（TUI）

#### 启动流程完整调用链

```
InteractiveMode.run()                          @ interactive-mode.ts:512
  -> this.init()                               @ interactive-mode.ts:368
     -> 检测 changelog
     -> ensureTool("fd"), ensureTool("rg")     # 下载 fd/rg 工具
     -> 构建 UI 布局：
        tui.addChild(headerContainer)
        tui.addChild(chatContainer)
        tui.addChild(pendingMessagesContainer)
        tui.addChild(statusContainer)
        tui.addChild(widgetContainerAbove)
        tui.addChild(editorContainer)
        tui.addChild(widgetContainerBelow)
        tui.addChild(footer)
        tui.setFocus(editor)
     -> setupKeyHandlers()                     # 注册快捷键
     -> setupEditorSubmitHandler()             # 编辑器提交回调
     -> initExtensions()                       @ interactive-mode.ts:1004
        -> createExtensionUIContext()          # 创建 Extension UI 桥接
        -> session.bindExtensions({ uiContext, ... })
        -> setupExtensionShortcuts()
     -> renderInitialMessages()                # 渲染历史消息
     -> tui.start()                            # 启动终端渲染
     -> subscribeToAgent()                     # 订阅 AgentSession 事件
     -> onThemeChange(...)                     # 监听主题变化
  -> 显示启动警告
  -> 处理 initialMessage / initialMessages
  -> while(true) {                             # 主循环
       userInput = await getUserInput()
       await session.prompt(userInput)
     }
```

#### 如何创建 AgentSession

`InteractiveMode` **不创建** `AgentSession`，而是在构造函数中接收：

```typescript
// interactive-mode.ts:255
constructor(session: AgentSession, private options: InteractiveModeOptions = {}) {
    this.session = session;
    // ...
}
```

`AgentSession` 在上层（CLI 入口）创建后传入。模式只负责 UI 绑定。

#### 如何绑定到 TUI

绑定分两步：

1. **事件订阅**：`subscribeToAgent()` @ `interactive-mode.ts:2035`
   ```typescript
   this.unsubscribe = this.session.subscribe(async (event) => {
       await this.handleEvent(event);
   });
   ```
   事件包括 `agent_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_result` 等。每个事件处理函数会创建/更新对应的 TUI 组件并调用 `tui.requestRender()`。

2. **用户输入**：`getUserInput()` @ `interactive-mode.ts:2540` 返回 Promise，在编辑器 `onSubmit` 回调中 resolve：
   ```typescript
   async getUserInput(): Promise<string> {
       return new Promise((resolve) => {
           this.onInputCallback = (text) => {
               this.onInputCallback = undefined;
               resolve(text);
           };
       });
   }
   ```

#### 组件列表（interactive/components/）

| 组件 | 描述 |
|------|------|
| `ArminComponent` | 彩蛋动画组件 |
| `AssistantMessageComponent` | 渲染 AI 助手消息（Markdown + thinking block） |
| `BashExecutionComponent` | 渲染 bash 命令执行过程和输出 |
| `BorderedLoader` | 带边框的加载动画 |
| `BranchSummaryMessageComponent` | 渲染分支摘要信息 |
| `CompactionSummaryMessageComponent` | 渲染压缩摘要信息 |
| `ConfigSelectorComponent` | 配置选择器（keybindings 等） |
| `CountdownTimer` | 倒计时组件 |
| `CustomEditor` | 继承 TUI Editor 的自定义编辑器（含 app 快捷键、bash 模式） |
| `CustomMessageComponent` | 渲染自定义消息 |
| `DaxnutsComponent` | 另一个彩蛋组件 |
| `DiffComponent` | 渲染文件 diff |
| `DynamicBorder` | 全宽分隔线 |
| `ExtensionEditorComponent` | 扩展用的多行编辑器 |
| `ExtensionInputComponent` | 扩展用的单行输入 |
| `ExtensionSelectorComponent` | 扩展用的选项选择器 |
| `FooterComponent` | 底部状态栏（model、tokens、git branch 等） |
| `KeybindingHints` | 快捷键提示文本工具函数 |
| `LoginDialogComponent` | 登录对话框 |
| `ModelSelectorComponent` | 模型选择覆盖层 |
| `OAuthSelectorComponent` | OAuth 认证选择器 |
| `ScopedModelsSelectorComponent` | 受限模型选择器 |
| `SessionSelectorComponent` | 会话选择器 |
| `SessionSelectorSearchComponent` | 会话搜索组件 |
| `SettingsSelectorComponent` | 设置面板 |
| `ShowImagesSelectorComponent` | 图片显示设置选择器 |
| `SkillInvocationMessageComponent` | 渲染 Skill 调用消息 |
| `ThemeSelectorComponent` | 主题选择器覆盖层 |
| `ThinkingSelectorComponent` | 思考级别选择器 |
| `ToolExecutionComponent` | 渲染工具调用过程和结果 |
| `TreeSelectorComponent` | 消息树导航选择器 |
| `UserMessageComponent` | 渲染用户消息 |
| `UserMessageSelectorComponent` | 用户消息选择（fork 用） |
| `VisualTruncate` | 视觉行截断工具函数 |

### Print 模式

`runPrintMode()` @ `print-mode.ts:30`

- 入口：`pi -p "prompt"`（text 模式）或 `pi --mode json "prompt"`（JSON 模式）
- 无 TUI，直接 `console.log()` 输出
- 流程：
  1. `session.bindExtensions({ ... })` — 绑定无 UI 版本的 extension context
  2. `session.subscribe(event => ...)` — JSON 模式输出所有事件
  3. 依次发送 `initialMessage` + `messages`
  4. text 模式在最后输出 `assistant` 消息的文本内容
- 适用场景：脚本化调用、管道组合

### RPC 模式

`runRpcMode()` @ `rpc-mode.ts:45`

- 入口：`pi --mode rpc`
- 无 TUI，通过 stdin/stdout JSON Lines 通信
- 常驻进程，`return new Promise(() => {})` 永不退出

#### 接口定义

**Commands（stdin -> agent）**：

```typescript
// rpc-types.ts:18-67
type RpcCommand =
  // Prompting
  | { type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
  | { type: "steer"; message: string; images?: ImageContent[] }
  | { type: "follow_up"; message: string; images?: ImageContent[] }
  | { type: "abort" }
  | { type: "new_session"; parentSession?: string }
  // State
  | { type: "get_state" }
  // Model
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "cycle_model" }
  | { type: "get_available_models" }
  // Thinking
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "cycle_thinking_level" }
  // Queue modes
  | { type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
  | { type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
  // Compaction
  | { type: "compact"; customInstructions?: string }
  | { type: "set_auto_compaction"; enabled: boolean }
  // Retry / Bash / Session / Messages / Commands ...
```

共 26 种命令类型，每个带可选 `id` 字段用于请求-响应关联。

**Responses（agent -> stdout）**：
- 成功：`{ type: "response", command: "...", success: true, data?: ... }`
- 失败：`{ type: "response", command: "...", success: false, error: "..." }`
- Agent 事件直接输出为 JSON（与 subscribe 事件一致）

**Extension UI 协议**：

扩展 UI 请求通过 stdout 发出 `extension_ui_request`，客户端回复 `extension_ui_response`：
```typescript
// 请求方法：select, confirm, input, editor, notify, setStatus, setWidget, setTitle, set_editor_text
// 响应：{ type: "extension_ui_response", id: string, value/confirmed/cancelled }
```

部分 UI 功能在 RPC 模式不可用：`setWorkingMessage`、`setFooter`、`setHeader`、`custom`、`setEditorComponent`。

#### 通信协议

- **传输层**：JSON Lines over stdin/stdout
- **帧格式**：每行一个完整 JSON 对象
- **方向**：双向（命令 -> stdin，响应 + 事件 -> stdout，stderr 用于 debug）
- **关联**：`id` 字段用于匹配请求和响应
- **事件**：AgentSessionEvent 不带 `id`，直接流式输出

**SDK 客户端（RpcClient）** @ `rpc-client.ts:54`：

```typescript
const client = new RpcClient({ cwd: "/path/to/project" });
await client.start();          // 启动 RPC 子进程
client.onEvent(event => ...);  // 订阅事件流
await client.prompt("hello");  // 发送命令
const state = await client.getState();
await client.stop();           // 停止子进程
```

`RpcClient` 是一个完整的类型安全的 API 封装，spawn 子进程运行 `node dist/cli.js --mode rpc`，通过 readline 处理 JSON Lines。

## Extension UI 组件渲染

### 扩展注册的组件在哪里被渲染

Extension 注册的 UI 组件通过 `ExtensionUIContext` 接口桥接到 TUI：

1. **Widget（编辑器上方/下方区域）**：
   - 接口：`setWidget(key, content, options)` @ `types.ts:129-135`
   - 实现：`setExtensionWidget()` @ `interactive-mode.ts:1176`
   - 渲染位置：`widgetContainerAbove`（编辑器上方）或 `widgetContainerBelow`（编辑器下方）
   - 组件挂载：`this.widgetContainerAbove.addChild(component)` @ `interactive-mode.ts:1265-1291`
   - 支持两种内容：`string[]`（包装为 Text 组件）和工厂函数 `(tui, theme) => Component`

2. **自定义 Footer**：
   - 接口：`setFooter(factory)` @ `types.ts:143-147`
   - 实现：`setExtensionFooter()` @ `interactive-mode.ts:1296`
   - 渲染位置：替换 TUI 根的最后一个子组件（footer 位置）

3. **自定义 Header**：
   - 接口：`setHeader(factory)` @ `types.ts:149-150`
   - 实现：`setExtensionHeader()` @ `interactive-mode.ts:1329`
   - 渲染位置：替换 headerContainer 的内容

4. **自定义编辑器**：
   - 接口：`setEditorComponent(factory)` @ `types.ts:184-204`
   - 实现：`setCustomEditorComponent()` @ `interactive-mode.ts:1606`
   - 渲染位置：替换 editorContainer 的内容
   - 新编辑器继承 `onSubmit`/`onChange` 回调和快捷键处理

5. **覆盖层组件（custom）**：
   - 接口：`custom(factory, options)` @ `types.ts:156-170`
   - 实现：`showExtensionCustom()` @ `interactive-mode.ts:1678`
   - 两种显示方式：
     - 非覆盖层：替换 editorContainer 内容
     - 覆盖层：`tui.showOverlay(component, overlayOptions)` 在全屏范围内浮动

6. **对话框（select, confirm, input, editor）**：
   - 选择器：`showExtensionSelector()` @ `interactive-mode.ts:1445` — 替换 editorContainer
   - 确认框：复用选择器（Yes/No）
   - 文本输入：`showExtensionInput()` @ `interactive-mode.ts:1512` — 替换 editorContainer
   - 编辑器：`showExtensionEditor()` @ `interactive-mode.ts:1567` — 替换 editorContainer

7. **状态栏**：
   - 接口：`setStatus(key, text)` @ `types.ts:124`
   - 实现：`setExtensionStatus()` @ `interactive-mode.ts:1168`
   - 渲染位置：FooterComponent 底部状态区域，通过 `FooterDataProvider` 传递

### UI 布局结构

```
TUI (根 Container)
  ├── headerContainer         ← setHeader() 替换内容
  ├── chatContainer           ← 消息流（assistant/user/tool 组件）
  ├── pendingMessagesContainer← 排队中的消息
  ├── statusContainer         ← 加载动画
  ├── widgetContainerAbove    ← setWidget(placement: "aboveEditor")
  ├── editorContainer         ← 编辑器 / 对话框 / custom 组件
  ├── widgetContainerBelow    ← setWidget(placement: "belowEditor")
  └── footer / customFooter   ← setFooter() 替换
```

覆盖层（Overlay）不在树中，而是通过 `tui.showOverlay()` 放入独立的 `overlayStack`，在渲染时合成到最终输出。

## 关键类型/接口

```typescript
// TUI 库核心
interface Component { render(width: number): string[]; handleInput?(data: string): void; invalidate(): void; }
interface Focusable { focused: boolean; }
interface Terminal { start(onInput, onResize): void; stop(): void; write(data): void; columns: number; rows: number; ... }
interface EditorComponent extends Component { getText(): string; setText(text): void; onSubmit?: (text) => void; ... }
interface OverlayHandle { hide(): void; setHidden(hidden: boolean): void; isHidden(): boolean; }
interface OverlayOptions { width?, anchor?, margin?, maxHeight?, visible?, ... }

// coding-agent 模式
interface InteractiveModeOptions { initialMessage?, initialImages?, verbose?, ... }
interface PrintModeOptions { mode: "text" | "json"; messages?; initialMessage?; }
interface RpcClientOptions { cliPath?, cwd?, env?, provider?, model?, args?; }
type RpcCommand = { type: "prompt" | "abort" | ... }   // 26 种命令
type RpcResponse = { type: "response"; command: string; success: boolean; ... }
interface RpcSessionState { model?, thinkingLevel, isStreaming, sessionFile?, ... }

// Extension UI
interface ExtensionUIContext { select, confirm, input, notify, setStatus, setWidget, setFooter, setHeader, custom, ... }
```

## 与其他 Domain 的接口

| 接口 | 本域 | 对接域 | 说明 |
|------|------|--------|------|
| `AgentSession` | 所有模式接收 | Domain A (Agent Core) | 核心会话，模式通过它访问 agent、session manager |
| `ExtensionUIContext` | Interactive/RPC 提供 | Domain C (Extension) | 扩展通过此接口注册 UI 组件 |
| `session.subscribe()` | 所有模式调用 | Domain A | 事件流驱动 UI 更新 |
| `session.bindExtensions()` | 所有模式调用 | Domain C | 绑定扩展系统 |
| `Theme` | Interactive/RPC 使用 | 主题系统 | 颜色系统，JSON 配置 + 热重载 |
| `FooterDataProvider` | Interactive 使用 | Domain A | Git branch、extension status 等数据 |
| `session.prompt()` | 所有模式调用 | Domain A | 发送消息到 agent |
| `KeybindingsManager` | Interactive 使用 | 独立模块 | 快捷键配置 |

## 开发指南：复用 TUI

### 方式一：直接使用 TUI 库构建自己的界面

```typescript
import {
  TUI, ProcessTerminal, Container, Text, Editor, Spacer,
  Markdown, SelectList, Box, Loader,
  type Component, type MarkdownTheme
} from "@mariozechner/pi-tui";

// 1. 创建 Terminal 和 TUI
const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

// 2. 构建组件树
const header = new Text("My Agent v1.0", 1, 1);
const chatArea = new Container();
const editor = new Editor(tui, myEditorTheme);

tui.addChild(header);
tui.addChild(chatArea);
tui.addChild(new Spacer(1));
tui.addChild(editor);
tui.setFocus(editor);

// 3. 处理编辑器提交
editor.onSubmit = async (text) => {
  chatArea.addChild(new Text(`> ${text}`, 1, 0));
  tui.requestRender();
  // 调用你的 agent...
  const response = await myAgent.chat(text);
  chatArea.addChild(new Markdown(response, 1, 0, myMarkdownTheme));
  tui.requestRender();
};

// 4. 启动
tui.start();

// 5. 覆盖层
const overlay = tui.showOverlay(myComponent, {
  anchor: "center",
  width: "80%",
  maxHeight: "50%",
  margin: 2,
});
```

**注意事项**：
- 所有组件的 `render()` 返回的行 **不能** 超过 `width`，否则 TUI 会 crash
- 使用 `visibleWidth()` 测量 ANSI 字符串宽度，`truncateToWidth()` 截断
- `Editor` 和 `Loader` 构造函数需要 `TUI` 实例
- 主题（颜色函数）需要自己提供，TUI 库本身不包含默认主题

### 方式二：SDK 模式（RPC Client）+ 自定义 TUI

```typescript
import { RpcClient } from "@mariozechner/pi-coding-agent";
import { TUI, ProcessTerminal, Text, Container, Markdown } from "@mariozechner/pi-tui";

// 1. 启动 RPC agent
const client = new RpcClient({ cwd: process.cwd() });
await client.start();

// 2. 构建 TUI（完全自定义布局）
const terminal = new ProcessTerminal();
const tui = new TUI(terminal);
const chat = new Container();
// ... 构建你的 UI 组件树

// 3. 订阅事件 -> 更新 TUI
client.onEvent(event => {
  if (event.type === "message_update" && event.message.role === "assistant") {
    // 渲染流式 markdown
    myAssistantComponent.updateContent(event.message);
    tui.requestRender();
  }
});

// 4. 用户输入 -> 发送到 agent
editor.onSubmit = async (text) => {
  await client.prompt(text);
};

tui.start();
```

**优势**：
- 完全控制 UI 布局和交互
- Agent 逻辑在独立子进程中运行
- RPC 提供 26 种命令（prompt、abort、model 切换、compaction 等）
- 事件流与 interactive 模式完全一致

**限制**：
- Extension UI 部分方法不可用（`setFooter`、`setHeader`、`custom`、`setEditorComponent`）
- `setWidget` 只支持 `string[]` 不支持组件工厂
- RPC 启动有约 100ms 延迟
- 需要 Node.js 运行时

### 方式三：复用 Interactive 模式的组件

如果想沿用 interactive 模式的消息渲染风格，可以直接导入 coding-agent 的组件：

```typescript
import { AssistantMessageComponent, ToolExecutionComponent, UserMessageComponent } from "@mariozechner/pi-coding-agent";
import { theme, initTheme } from "@mariozechner/pi-coding-agent"; // 共享主题

initTheme("dark");

// 这些组件实现 Component 接口，可以直接 addChild 到 TUI
const msgComponent = new AssistantMessageComponent(undefined, false, markdownTheme);
chatContainer.addChild(msgComponent);

// 流式更新
msgComponent.updateContent(assistantMessage);
tui.requestRender();
```

这种方式需要依赖 `@mariozechner/pi-coding-agent`，但能完整复用消息渲染、工具执行展示、diff 渲染等 35 个 UI 组件。
