# TUI 可定制性完整报告

范围：`@mariozechner/pi-tui`（底层）+ `@mariozechner/pi-coding-agent`（应用层）能被扩展/配置改动的一切。

---

## 1. 渲染模型

- 一切是 `Component { render(width): string[] }`。返回字符串数组 = 多行。每行不能超过 `width`，否则 TUI 崩。
- `Container` 纵向堆 children。
- `TUI` 本身就是 `Container`，管焦点、输入路由、overlay 栈、差分渲染、硬件光标。
- 每行结尾会 reset 样式 (`\x1b[0m`)，多行彩色要逐行加样式。
- 内置组件：`Text`（多行 wrap）、`TruncatedText`（单行截断）、`Box`（padding/背景）、`Spacer`、`Editor`、`Input`、`SelectList`、`SettingsList`、`Markdown`、`Image`、`Loader`、`CancellableLoader`。
- 调试：`PI_TUI_DEBUG=1`（写 `/tmp/tui/`）、`PI_DEBUG_REDRAW=1`（写 `~/.pi/agent/pi-debug.log`）、`PI_HARDWARE_CURSOR`、`PI_CLEAR_ON_SHRINK`。

## 2. 主布局（interactive-mode）

垂直栈，顺序固定：

```
headerContainer
chatContainer
pendingMessagesContainer
statusContainer
widgetContainerAbove
editorContainer
widgetContainerBelow
footer
```

每一块都可被扩展替换或注入。**没有内建 split-pane / sidebar**。右侧显示只能走 overlay 覆盖。

## 3. 扩展能改的每一块

通过 `ctx.ui`（`ExtensionUIContext`）和 `pi`（`ExtensionAPI`）。以下是完整清单。

### 3.1 顶/底/编辑器替换
- `ctx.ui.setHeader((tui, theme) => Component)` — 替换默认 header
- `ctx.ui.setFooter((tui, theme, footerData) => Component)` — 替换默认 footer；可返回多行；通过 `footerData.getExtensionStatuses()` / `getGitBranch()` / `getAvailableProviderCount()` 读数据
- `ctx.ui.setEditorComponent(factory)` — 完整替换输入编辑器（Vim 之类）；actionHandlers/autocomplete/onSubmit 等会被拷贝

### 3.2 块状注入
- `ctx.ui.setWidget(key, string[] | factory, { placement: "aboveEditor" | "belowEditor" })`
  - 多行，但硬上限 `MAX_WIDGET_LINES = 10`
  - 只能上/下，**不能放右侧**
- `ctx.ui.setStatus(key, text)` — footer 单行摘要；多个扩展共享一行，`\n \t` 会被压成空格，超宽截断

### 3.3 自定义组件与 overlay（最强通道）
`ctx.ui.custom<T>(factory, options)`：
- 不带 `overlay: true` → 替换 editor 区域（inline）
- 带 `overlay: true` → 调用 `tui.showOverlay()`，叠加在当前内容之上

`OverlayOptions` 全集：
- `anchor`: `center | top-left | top-center | top-right | left-center | right-center | bottom-left | bottom-center | bottom-right`
- `width / minWidth / maxHeight`：数字或 `"25%"`
- `row / col`：绝对或百分比
- `offsetX / offsetY`
- `margin`：统一或逐边
- `visible(termWidth, termHeight) => boolean`：响应式显隐
- `nonCapturing: true`：不抢焦点，适合常驻信息
- `onHandle(OverlayHandle)`：拿到句柄后可 `hide / setHidden / isHidden / focus / unfocus`

**右侧常驻面板唯一路径就是这个。**

### 3.4 对话与交互
- `ctx.ui.select(...)` / `confirm(...)` / `input(...)` / `editor(title, prefill?)` — 替换 editor 区的临时对话
- `ctx.ui.notify(msg, type?)` — info/warning/error
- `ctx.ui.setWorkingMessage(msg?)` — 流式期间的 loading 文本
- `ctx.ui.setHiddenThinkingLabel(label?)`
- `ctx.ui.setTitle(title)` — 终端窗口标题

### 3.5 编辑器内容控制
- `pasteToEditor(text)` / `setEditorText(text)` / `getEditorText()`

### 3.6 原始输入拦截
- `ctx.ui.onTerminalInput(handler)`：handler 返回 `{ consume?, data? }`，可在到达 focused 组件前改写或吞掉任意输入

### 3.7 主题
- `ctx.ui.theme`（只读）/ `getAllThemes()` / `getTheme(name)` / `setTheme(theme)`
- 约 50 个颜色 token：Core UI / Backgrounds / Markdown / Tool Diffs / Syntax / Thinking borders / Bash mode
- 值可以是 hex、256-color index、`vars` 变量引用、空串（终端默认）
- 用户主题目录热重载（fs.watch，debounce 100ms）
- 扩展可注册主题
- `highlightCode(code, lang)` 和 `getLanguageFromPath` 可复用

### 3.8 工具展开状态
- `getToolsExpanded()` / `setToolsExpanded(bool)`

## 4. 扩展 API（`pi` / `ExtensionAPI`）

- `on(event, handler)` — 事件订阅，~25 种：session/agent/tool/model/input/resource 生命周期。关键可改写事件：
  - `context`：改 LLM 发出前的消息
  - `before_provider_request`：改 payload
  - `before_agent_start`：改 prompt / system prompt
  - `tool_call`：拦截/改工具参数
  - `tool_result`：改工具结果
  - `input`：改/吞用户输入
  - `session_before_compact`：取消/替换 compaction
  - `session_before_tree`：改树导航
- `registerTool(def)` — 自定义 LLM 可调用工具，带 `renderCall` / `renderResult` 组件
- `registerCommand(name, opts)` — 斜杠命令
- `registerShortcut(shortcut, opts)` — 键盘快捷键
- `registerFlag / getFlag` — CLI flag
- `registerMessageRenderer(customType, renderer)` — 自定义消息渲染
- `sendMessage / sendUserMessage` — 注入消息（steer / followUp / nextTurn）
- `appendEntry(customType, data?)` — **持久化自定义数据到 session 文件，不发给 LLM**（这是扩展自己存数据的地方）
- `registerProvider / unregisterProvider` — 自定义模型 provider，支持 OAuth
- `setModel / getThinkingLevel / setThinkingLevel`
- `setSessionName / getSessionName / setLabel`
- `getActiveTools / getAllTools / setActiveTools`
- `exec(cmd, args, opts?)` — shell 执行
- `events` — 跨扩展的 EventBus

命令上下文 `ExtensionCommandContext` 还多：`waitForIdle`、`newSession`、`fork`、`navigateTree`、`switchSession`、`reload`。

## 5. 信息可以存哪里

按生命周期从短到长：

| 位置 | 生命周期 | 会发给 LLM | 典型用法 |
|---|---|---|---|
| 组件局部状态 | 组件实例 | 否 | 临时 UI 状态 |
| `ctx.ui.setStatus/setWidget` | 当前会话显示 | 否 | 显示用 |
| `pi.events` EventBus | 进程 | 否 | 跨扩展通信 |
| `pi.appendEntry(customType, data)` | 持久到 session 文件 | **否** | 扩展自己的结构化历史/状态 |
| `pi.sendMessage / sendUserMessage` | 持久到 session | **是** | 要让 LLM 看到的内容 |
| `<agentDir>/settings.json`（全局） | 永久 | 否 | 用户设置 |
| `<cwd>/.pi/settings.json`（项目） | 永久 | 否 | 项目级设置，deep merge 覆盖全局 |
| `<agentDir>/keybindings.json` | 永久 | 否 | 键位 |
| 自定义文件（插件自己写） | 永久 | 否 | 例：`.pi/impression.json` |

**要存永久但不污染 LLM 上下文的数据 → `appendEntry` 或自己写文件。**

## 6. 可直接用 settings.json 调的 UI/行为

项目或全局 `settings.json`：
- `theme`
- `editorPaddingX` (0–3)
- `autocompleteMaxVisible` (3–20)
- `showHardwareCursor`
- `markdown.codeBlockIndent`
- `terminal.showImages / clearOnShrink`
- `images.autoResize / blockImages`
- `hideThinkingBlock`
- `thinkingBudgets.{minimal,low,medium,high}`
- `defaultProvider / defaultModel / defaultThinkingLevel`
- `transport`（sse/websocket）
- `steeringMode`、`followUpMode`
- `compaction.{enabled, reserveTokens, keepRecentTokens}`
- `branchSummary.{reserveTokens, skipPrompt}`
- `retry.{enabled, maxRetries, baseDelayMs, maxDelayMs}`
- `shellPath / shellCommandPrefix / npmCommand`
- `sessionDir / quietStartup / collapseChangelog / doubleEscapeAction / treeFilterMode`
- `packages[] / extensions[] / skills[] / prompts[] / themes[]`
- `enableSkillCommands / enabledModels[]`

**UI layout（多行 footer、侧栏、分栏）不在 settings 里，必须写 extension。**

## 7. 键位

- `<agentDir>/keybindings.json` 可完全覆盖默认键位
- `KEYBINDINGS` 常量 ~30 项：interrupt、clear、exit、suspend、thinking cycle、model cycle/select、tools expand、session fork/tree/switch、clipboard、editor、follow-up、dequeue 等
- 扩展可 `pi.registerShortcut(...)` 追加
- `KeybindingsManager.reload()` 运行时重载
- 有旧名迁移（`cursorUp` → `tui.editor.cursorUp` 等）

## 8. 大幅度修改的可行路径

按侵入度从小到大：

1. **只改配置**：settings.json、keybindings.json、主题 json、`.pi/impression.json` 等插件自己的配置
2. **新写扩展**：
   - `setStatus` / `setWidget` / `setFooter` / `setHeader` / `custom` / overlay
   - 自定义 tool / command / shortcut / message renderer
   - 注册 provider / 主题
3. **替换编辑器** `setEditorComponent` — Vim 模式之类
4. **替换 header / footer** — 完整重做上下边栏
5. **叠加 overlay** — 右侧固定面板、浮层、dialog
6. **原始输入接管** `onTerminalInput` — 在任何组件前吞/改输入
7. **替换内置工具** — `CreateAgentSessionOptions.tools / customTools`
8. **改 compaction / system prompt / context**：通过事件钩子 `context`、`before_agent_start`、`session_before_compact`
9. **自定义 model provider**：`registerProvider`，带 OAuth
10. **真要改主布局顺序、加真正的 split-pane/sidebar**：必须改 `packages/coding-agent/src/modes/interactive/interactive-mode.ts` 的 init 布局栈。没有扩展 API 能做这件事，overlay 只能覆盖，不能让主视图让位。

## 9. 硬限制（扩展做不到的）

- 主布局顺序固定，无法用扩展插入新区域（只能 above/below editor 或 overlay 覆盖）
- **主视图宽度不可调**：`Container.render(width)` 直接用终端全宽，没有 padding/margin/maxWidth 参数；唯一的水平收窄是 `editorPaddingX`（0–3）且只作用于编辑器。要让主视图给侧栏让位必须改 `interactive-mode.ts` 渲染逻辑。
- **主面板不可组件化**：header/chat/editor/footer 是硬编码在 interactive-mode 垂直栈里的，不能被包装成可放置/可移动的组件。扩展只能替换槽位内容，不能改排列。
- **没有内建鼠标事件系统**：stdin-buffer 能解析 SGR 鼠标序列，但 TUI 不启用鼠标上报、不做 hit-test、不路由点击。要做 click/hover 交互需扩展全 DIY（开鼠标上报 → 拦截 → 解析坐标 → 判断区域）。hover 需 any-event tracking，会严重干扰文本选择。
- `setWidget` 最多 10 行
- `setStatus` 永远单行、共享、会被截断，且 `\n` 会被压成空格
- overlay 是合成覆盖，不是真正的 split pane；主视图不会自动让出空间
- footer 的 extension status 没有分组/优先级/多行能力（要这些必须自己 `setFooter`）
- 每行不能超过 `width`，超了 TUI 崩
- overlay 关闭后组件销毁，不可复用旧实例

## 10. 关键文件索引

- `packages/tui/src/tui.ts` — TUI 主类、overlay 系统、输入路由
- `packages/tui/src/components/*` — 内置组件
- `packages/coding-agent/src/core/extensions/types.ts` — `ExtensionAPI` / `ExtensionUIContext` / `ExtensionContext` 全部接口
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — 主布局、`createExtensionUIContext`、`setExtensionFooter/Header/Widget/Custom`、`showExtensionCustom`（overlay 走这里）
- `packages/coding-agent/src/modes/interactive/components/footer.ts` — 默认 footer，扩展 status 单行聚合+截断的实现
- `packages/coding-agent/src/core/footer-data-provider.ts` — `getExtensionStatuses` / `getGitBranch`
- `packages/coding-agent/src/core/keybindings.ts` — 键位系统
- `packages/coding-agent/src/core/settings-manager.ts` — 全部 settings 字段
- `packages/coding-agent/src/modes/interactive/theme/theme.ts` — 主题系统
- `packages/coding-agent/examples/extensions/overlay-qa-tests.ts` — **右侧侧栏活样本**（`/overlay-sidepanel`）
- `packages/coding-agent/examples/extensions/custom-footer.ts` — 自定义 footer 活样本
- `packages/coding-agent/examples/extensions/status-line.ts` — `setStatus` 活样本
