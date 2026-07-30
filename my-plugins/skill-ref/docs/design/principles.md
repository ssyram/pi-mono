# skill-ref — 意图与前提（Q 层）

> 本文件是本插件的宪法。修改它需经用户确认。
> 状态：**部分确认**——A5/P5/R5 已由用户确认（2026-07-30）；其余条目仍为草案（2026-07-27）

## 1. 核心意图

### 追求

- **A1｜句中也能引用 SKILL / prompt**：在一句话中间输入 `/` 再按 Tab，弹出的候选是所有 SKILL / prompt 对象，选择与搜索的手感与行首斜杠菜单一致（打字即筛选）。
- **A2｜模型侧能把这个引用兑现**：提供 `try_load_skill_or_prompt` 工具，名字完全命中就直接给出该 SKILL / prompt 的原文；没命中就按模糊语义给出候选，让模型自己收敛到正确的那个。
- **A3｜宽松的模糊匹配**：`/abc` 意为 `.*a.*b.*c.*`；`/x...a`、`/x..a` 同样意为 `.*x.*a.*`。用户不必记全名、不必记分隔符。
- **A4（加分项，非必须）｜视觉可辨**：候选与已插入的引用如果能着色，最好；但不得为此付出"替换编辑器组件"这类高耦合代价（见 H9/H10 与架构 §8）。
- **A5｜加载结果简洁但可定位**：`try_load_skill_or_prompt` 的折叠态用户可见结果只用一行：成功时显示加载对象、来源路径与原文字符数；失败时只显示候选数量，不显示正文、候选名称或其他明细。

### 保护

- **P1｜行首斜杠行为完全不变**：句首 `/` 仍是原生命令菜单，本插件不得干预。
- **P2｜不改上游包**：只作为可插拔扩展存在于 `my-plugins/`，不修改 `packages/tui` 与 `packages/coding-agent` 源码。
- **P3｜资源口径与 pi 一致**：SKILL / prompt 的来源就是 pi 自己认的那套标准路径与加载结果，不另建一套扫描逻辑，`/reload` 后自动跟随。
- **P4｜不吃掉别的补全**：`@` 文件补全、命令参数补全、其他扩展注册的补全一律透传。
- **P5｜展示与模型输入严格分离**：折叠态精简只作用于 TUI 渲染；工具交给模型的完整资源正文或候选内容必须保持不变，并通过全局 impression passthrough 避免被 distill。

### 不接受

- **R1｜句中 `/` + Tab 只能给出文件系统绝对路径候选**（当前行为）。
- **R2｜为实现本功能而 fork / patch 上游 TUI 编辑器**。
- **R3｜两处（补全 UI 与工具）使用不一致的名字口径或匹配语义**——同一个字符串在补全里能选中、在工具里查不到，是不可接受的。
- **R4｜句中插入的引用被误当成可执行命令**——它只是文本引用，兑现动作交给工具。
- **R5｜折叠态打印资源正文或失败候选明细、成功时不告知加载对象与路径，或为了压缩用户展示而删改模型收到的工具内容**。

## 2. 认知前提（Q.A）

- **H1**：pi 的编辑器把 Tab 分成两条路径——`textBeforeCursor.trimStart().startsWith("/")` 为真时走行首斜杠菜单（`force=false`），否则走 `forceFileAutocomplete`（`force=true`）。因此"句中 `/` + Tab"在协议层是唯一可辨识的入口（`packages/tui/src/components/editor.ts:2139-2158`）。
- **H2**：`ExtensionUIContext.addAutocompleteProvider(factory)` 是官方的装饰器链扩展点，`factory(current)` 拿到下层 provider，可选择拦截或透传（`packages/coding-agent/src/core/extensions/types.ts:223`，装配见 `interactive-mode.ts:625-640`）。
- **H3**：`pi.getCommands()` 返回的 `SlashCommandInfo` 已经带 `source: "extension" | "prompt" | "skill"`、`description` 与 `sourceInfo.path`（文件绝对路径），skill 的 `name` 形如 `skill:<name>`（`agent-session.ts:2315-2338`）。它就是 pi 自己的口径，覆盖用户级 / 项目级 / 包与插件提供的资源。
- **H4**：`@earendil-works/pi-tui` 导出的 `fuzzyMatch` 已经是"字符按序出现即匹配"的子序列语义，等价于 `.*a.*b.*c.*`；但它把 `.` `*` 当字面量，也会按 `[\s/]+` 拆 token，因此不能直接承担 A3 的通配语义。
- **H5**：扩展注册的补全 wrapper 在 `/reload` 时被清空（`interactive-mode.ts:1953`），所以必须在 `session_start` 事件里注册才能存活。
- **H9**：补全菜单（`SelectList`）的 `label` / `description` 可以内嵌 ANSI —— `visibleWidth`（`packages/tui/src/utils.ts:216-253`）与 `truncateToWidth`（同文件 `:936` 起）都显式跳过转义序列，宽度与截断不会算错。选中行整行被 `theme.selectedText()`（= `theme.fg("accent", …)`）包裹，故内嵌色应以 `\x1b[39m`（仅恢复默认前景）收尾而非 `\x1b[0m`。
- **H10**：**输入框正文没有着色钩子**。编辑器把 `layoutLine.text` 原样写出，只对光标处做反显（`editor.ts:532-565`）；`EditorTheme` 仅有 `borderColor` 与 `selectList` 两项（`editor.ts:228-231`）。要给已输入的 `/foo` 上色，只能经 `ctx.ui.setEditorComponent()` 换掉整个编辑器组件——而该 factory 全局唯一、后注册者覆盖前者。
- **H6**：句中插入的 `/xxx` 不会被 pi 展开成命令——命令展开只发生在消息开头（`agent-session.ts:1134,1285`）。这正是 A2 这个工具存在的理由。
- **H11**：custom tool 的 `renderResult(result, { expanded })` 只控制 TUI 展示，`execute` 返回的 `content` 仍独立进入模型上下文；impression 的全局 `skipDistillation` 可按 tool 名精确旁路 distill。

## 3. 经验材料（Q.E）

- **E1**：`my-plugins/CONVENTIONS.md` G1——任何定时器 / 子进程 / 文件监听泄漏都会让 `pi -p` 永不退出。本插件因此不引入任何长生命周期句柄（补全数据每次现取或按会话缓存于内存）。
- **E2**：`my-plugins/CONVENTIONS.md` 首节——`renderResult` 收到的 `details` 可能被别的插件替换，必须做运行时形状校验；自定义渲染器不得直接信任其静态类型。
- **E3**：`packages/coding-agent/examples/extensions/github-issue-autocomplete.ts` 是补全 wrapper 的官方参考实现（拦截 token → 命中则接管、未命中则 `return current.getSuggestions(...)`）；`dynamic-tools.ts` 是 `registerTool` 的参考实现。
