# clear-to-clipboard：函数级细化

上游合同：[architecture.md](architecture.md) §2 的 P1–P5；用户明确只要求**请求**剪贴板写入，复制结果不控制清空。本文描述已实现的函数职责与适用前提，不把文档当代码证明；当前 pi 私有 `pastes` 和运行时焦点方法的兼容边界见 §2 与 [correctness.md](correctness.md)。

## 1. 文件及职责

- `index.ts`：仅 `export { default } from "./extension.js";`，不放逻辑。
- `extension.ts`：扩展入口；按会话装/卸插件，不存跨会话可变全局状态。
- `attach-clear-action.ts`：取得 TUI 引用，监听键入、包装焦点主 editor 的实际 `app.clear` handler，释放包装。一个职责：事件挂接。
- `clipboard-payload.ts`：纯函数，把折叠 marker 与 pi 运行时 paste Map 组合成复制请求文本。一个职责：文本变换。
- `clipboard-payload.test.ts`、`attach-clear-action.test.ts`：定向功能测试（实施时创建）。
- `package.json`：插件加载入口 `index.ts`，与同目录插件惯例一致。

不使用 `any`、动态 import、参数属性、`utils.ts`；单源文件不超过 200 LOC（排除空行/注释）；只在 `my-plugins/clear-to-clipboard/` 写入。

## 2. 接口合同与私有字段边界

| 调用对象 | 已核实行为 | 实施依赖 |
|---|---|---|
| `ctx.ui.setWidget(key,factory)` | factory 同步以当前 `TUI` 调用；`setWidget(key,undefined)` 移除组件并安排重绘（`interactive-mode.ts` 的 `setExtensionWidget`） | 临时 factory 返回 `render:()=>[]` 零行组件，只用来取得 TUI，随后立即移除 |
| 运行时 `getFocusedComponent()` | 当前 `TuiBase` 实现和交互 TUI 代理提供，但导出的 `TUI` interface 未声明；input listeners 在焦点组件 `handleInput` 之前执行（`packages/tui/src/tui.ts`、`tui-renderer.ts`） | 插件运行时检测方法存在才安装，缺失时不包装，不冒充公开接口保证 |
| `CustomEditor.actionHandlers` | 公开 `Map<AppKeybinding,()=>void>`；实际 action dispatch 迭代它的 handler；`app.clear` 已在启动/重绑定时注册 | 读取和替换 `"app.clear"` 项，不更改键位或其它 action |
| `Editor.getText()` / 运行时 `pastes` | `getText()` 有 `[paste #N …]`；真实正文映射为当前版本 TS private `pastes: Map<number,string>` | 运行时 guard `pastes instanceof Map`，只在 ID 对应值为 string 时展开；这是版本耦合，不是公开 API |
| `Editor.getExpandedText()` | 可得展开全文，但失去 marker 数字 ID | 缺 paste Map 时的降级文本，绝不伪造 ID/正文 |
| `copyToClipboard(text)` | 导出 `Promise<void>`，可能拒绝，也可能 OSC 52 无回执 | 先发起调用并附 `.catch` 消纳拒绝；不 await、不让成功/失败决定原 handler |
| `pi.on("session_start"/"session_shutdown", ...)` | 生命周期通知，返回取消注册函数 | 每次 TUI session 仅在闭包内持有监听器与包装集合 |

`getText()` 与 `pastes` 在键处理同一个同步调用栈取得；Map 若缺失不把“有实际正文的 marker”假装为已按 `[paste#ID## 正文 ##]` 复制，改用 `getExpandedText()` 提供可用正文。原 core 源码升级若改变私有字段，精确格式不再有合同保障，需适配或调整需求。

## 3. 状态与不变量

一个 TUI session 的闭包状态：`tui`、`unsubscribeInput`、`wrappedEditors: Map<EditorView,{original,wrapper}>`、`originalForWrapper: WeakMap<Function,Function>`。不跨 session 共享。

- I1：同一 editor 现有 `app.clear` handler 若已是本 session 装的 wrapper，不再次包一层；若它是从其它 editor 复制来的本 session wrapper，则查 `originalForWrapper` 得原 handler，再包装该 editor。
- I2：wrapper 同步取当前焦点 editor 快照、发起至多一个 `copyToClipboard(payload)`，之后**无条件调用且只调用一次**保存的原 handler；异步 Promise 回调永不调用 handler/editor。
- I3：释放时只在某 editor 的 Map 项仍是自己装的 wrapper 时恢复保存的 original；其它扩展后来替换了 handler，不覆盖其变化。
- I4：读取正文只影响 clipboard 请求，既不修改 paste Map，也不替换 editor，故不会触发 pi `setCustomEditorComponent()` 的 marker 迁移缺陷。

## 4. 函数级规约与流程

### 4.1 入口 `export default function clearToClipboard(pi: ExtensionAPI): void`（`extension.ts`）

- **Requires**：扩展已加载，`pi.on` 可注册生命周期事件。
- **Ensures**：同步注册一个 `session_start` handler；未启动进程、未替换 editor；非 TUI session 不安装监听器。
- **步骤**：`pi.on("session_start",(_event,ctx)=>{ if(ctx.mode!=="tui") return; const release=attachClearAction(ctx.ui,copyToClipboard); const stop=pi.on("session_shutdown",()=>{release();stop();}); })`。`attachClearAction` 仅在 TUI 分支被调用；shutdown 单次/重复安全。
- **理由**：只有会话闭包持有状态，符合 P4/P5。若注册前即抛错，host 正常报告扩展初始化失败；不假装已生效。无循环。

### 4.2 会话挂接 `attachClearAction(ui: EditorUI, copy: (text:string)=>Promise<void>): () => void`（`attach-clear-action.ts`）

- **Requires**：交互 UI；`setWidget` factory 同步执行（§2）。`EditorUI` 是从公开 `ExtensionUIContext` 用 `Pick` 取得的 `setWidget`/`onTerminalInput`，无需自造 UI 类型行为。
- **Ensures**：返回幂等 `release()`；监听器仅在该 session 内活动；不留可见 widget；不替换 editor。
- **步骤**：① 定义 `let tui: TUI|undefined`，用唯一 key 的零行 widget factory 捕获 `tui`；② 同步 `setWidget(key,undefined)` 删除；若未获得 tui，则返回空的 release（不假装挂接成功）；③ 创建每会话 Maps 并注册 `onTerminalInput`，handler 读取 `tui.getFocusedComponent()`，仅当其为下述 `EditorView` 且有 `app.clear` handler 时执行 `installWrapper`，返回 `undefined` 让 pi 继续输入。④ `release` 先 unsubscribe，然后对已跟踪 Map 项逐一执行“仍是自己 wrapper 才还原”，清空集合；重复 release 无操作。
- **副作用**：仅临时空 widget、一个输入 listener、每个接键 editor 的一个 Map 项；不直接请求复制或清空。循环仅 release 遍历有限的已包 editor 集合；每轮删去一项，终止。
- **callee 依据**：`setWidget`/`onTerminalInput`/`TUI.getFocusedComponent` 的前后置见 §2；监听器在焦点组件之前到达（pi-tui source）。

### 4.3 焦点识别与包装 `installWrapper(focus: Component | null): void`（上节会话闭包内）

- **Requires**：TUI 输入 listener 同步运行。候选必须经运行时 guard：对象有 `actionHandlers instanceof Map`、`getText` 和 `getExpandedText` 方法、`actionHandlers.get("app.clear")` 是函数；否则直接返回。`pastes` 单独检查，不把其它弹窗的取消 action 视作 app.clear。
- **Ensures**：可用 editor 的 `app.clear` Map 项至多被本会话包一次；若原 handler 已被其它扩展修改，重新保存最新 handler 而不是回写旧 handler。不可用组件无变化。
- **步骤**：① guard 失败 → 返回；② 取当前 Map handler，若与 `wrappedEditors.get(focus)?.wrapper` 相同 → 返回；③ `original = originalForWrapper.get(currentHandler) ?? currentHandler`（处理本插件 wrapper 被 host 复制至新 editor）；④ 创建 `wrapper`（§4.4），记录 `originalForWrapper.set(wrapper,original)` 和 `wrappedEditors.set(focus,{original,wrapper})`，**最后** `focus.actionHandlers.set("app.clear",wrapper)`；⑤ 返回。
- **退出/正确性**：只改一个 Map 项；由于 handler 来自实际 action dispatch，不预判原始键位，P1/P3。Map 保存的 editor 对象在 shutdown 释放，避免跨 session 状态泄漏。无循环。

### 4.4 `app.clear` 包装回调 `wrapper(): void`（上节创建）

- **Requires**：pi 实际 dispatch 到 `app.clear` handler；保存的 `original` 可调用。
- **Ensures**：如果当前焦点 editor `raw.length>0`，在同步调用原 handler **之前**触发一次 `copy(payload)` 并消纳 Promise 拒绝；无内容不复制。无论格式读取或 clipboard 失败与否都调用 `original()` **一次**，不等待 clipboard。
- **顺序与分支**：① 同步取当前焦点并按 §4.3 guard；无有效 editor → 仅调用 `original()` 返回。② `raw=focus.getText()`；空串 → 仅调用 `original()` 返回。③ 运行时读 `pastes`：若是 Map，`payload=formatClipboardPayload(raw,pastes)`；否则 `payload=focus.getExpandedText()`；均保留前后空白。④ `void copy(payload).catch(()=>{})`；⑤ 调用 `original()`，让 pi 自己选择清空或双击退出。若构造 payload 意外抛错，仅跳过复制，不抑制 `original()`；实现需用 `try/finally` 保持这项关系。实际复制由异步 API 执行，不声称系统已写入。
- **副作用与论证**：唯一额外副作用是 clipboard 请求；pi 现有默认行为由 `original()` 独立承担。相同同步栈没有 await，旧回调永不在 Promise 结算后清空新 editor（原 R2 消失）。无循环。

### 4.5 `formatClipboardPayload(raw: string, pastes: ReadonlyMap<number,unknown>): string`（`clipboard-payload.ts`）

- **Requires**：`raw` 是同一次键事件的 `getText()`；`pastes` 为同一 Editor 实例的现存 Map。非粘贴文字可能偶然包含与 marker 同形的字符串。
- **Ensures**：逐个匹配 pi 的 `[paste #N +K lines]` 或 `[paste #N K chars]` 格式；仅在 `pastes.get(N)` 是字符串时替换为 `[paste#N## ${正文} ##]`，包括原文中的括号、新行与空白；否则保留原片段。其余文本逐字符保持原值；不 trim、不改 Map。
- **步骤**：对 `raw` 调用带 `g` 的明确 marker 正则 `replace`；每次匹配解析 `N`，读取 Map，按字符串/非字符串两支返回新片段或原片段；整体返回结果。所有 match 非空且 raw 长度有限，replace 扫描至末尾终止。
- **正确性**：marker ID 与 Map 键同源于 pi 的 `handlePaste()`；有映射则复制准确正文，无映射不虚构值。若用户手工输入与真实 marker 同形文字、且该 ID 恰存在，pi 自身 `getExpandedText()` 也全局替换这个同形文字；当前版本无法仅凭 raw 区分它与真实 marker，此能力边界不延伸为“始终唯一正确识别”保证。

## 5. 测试与执行条件（实施时）

- 纯函数用例：普通多行空白原样；单个/多个真实 marker、不同数字 ID；正文含 `]`/换行；未知 ID 不被替换；无 Map 时 wrapper 请求 `getExpandedText()`。
- 挂接用例：空 widget 获取 TUI 后立即移除；首键之前 wrap、非 app.clear 不复制；实际 app.clear 一次请求 + 原 handler 一次；空输入不覆盖剪贴板；重新绑定键无需硬编码；同一个 editor 重复事件不重包；不同 editor 复制 wrapper 不叠加；release 只复原自己、对外部替换不反写；copy Promise 拒绝仍交回原 handler；真实 `CustomEditor` 的 Ctrl+C 分派与实际 pi-tui paste Map 已由定向测试覆盖。
- 项目要求：编辑测试后运行该测试并迭代，通过后运行 `npm run check`（完整输出）；不运行全量 `npm test` 或 `npm run build`。若测试真实 pi 交互模式，先按 `.pi/skills/interactive-testing.md` 执行 tmux 流程，不调用真实 LLM。

## 6. 完备性与边界

函数流按同步栈连续：键监听装包 → pi 自身选择 action → 真正 app.clear wrapper 读取当前 editor → 复制请求 → 无条件原 handler；分支/退出/外部 callee 合同已列。业务无无界循环，释放集合和有限字符串替换均终止。模块协作与当前 pi 源码的局部推导见 [correctness.md](correctness.md)。不能从本设计推出操作系统接受剪贴板请求，这是用户明确排除的外部结果；也不能把尚未运行的测试写成实施证据。
