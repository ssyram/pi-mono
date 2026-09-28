# clear-to-clipboard 插件调研（survey，未实现）

状态：survey 历史产物。用户后来明确只要求发起剪贴板写入请求，并要求 `[paste#ID-- <actual text> ##]` 格式；本文件的自定义 editor/等待复制方案均已废弃，当前合同与实现见 `docs/design/`。

## 1. 问题

交互模式下 `Ctrl+C`（默认 `app.clear`）清空输入框时内容直接丢失：
`handleCtrlC()` → `clearEditor()` → `editor.setText("")`（`packages/coding-agent/src/modes/interactive/interactive-mode.ts:4080` / `:4422`）。
内容不进 kill-ring、不进剪贴板。`setText` 会 push undo 快照（`packages/tui/src/components/editor.ts:1112-1123`）；非 Windows 默认撤销键是 `Ctrl+-`，`Ctrl+Z` 默认挂起进程（`packages/coding-agent/src/core/keybindings.ts:77-99`）。

## 2. 目标（Q.I）

- `app.clear` 清空输入前，自动把被清空文本写入系统剪贴板。
- 清空/双击退出等默认行为保持不变（纯增量副作用）。
- 纯插件，不改 pi-mono 源码。

## 3. 机制调研结论（Q.A，全部来自源码只读验证）

| 事实 | 证据 |
|---|---|
| `CustomEditor` 与 `copyToClipboard` 均从主包导出 | `packages/coding-agent/src/index.ts:394` / `:438` |
| 扩展可替换核心输入框组件，factory 收到 `(tui, theme, keybindings)` | `packages/coding-agent/src/core/extensions/types.ts:128` / `:263` |
| 替换后 pi 自动复制 `defaultEditor.actionHandlers`（含 `app.clear`）到新 editor，默认行为完整保留 | `interactive-mode.ts:2766`（`setCustomEditorComponent`，duck typing 兼容 jiti 模块边界） |
| `CustomEditor.handleInput(data)` 可被子类 override，在 `super.handleInput(data)` 前拦截按键 | `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`，官方文档推荐此模式 |
| `keybindings.matches(data, "app.clear")` 按 keybindings.json 实际绑定匹配，重绑自动跟随 | `core/keybindings.ts:94`（默认 ctrl+c） |
| `copyToClipboard` 跨平台尝试本地写入、外部命令及 OSC 52；OSC 52 回退发出后无法确认终端是否写入剪贴板 | `packages/coding-agent/src/utils/clipboard.ts:74-135` |
| 备选拦截点 `onTerminalInput` 在焦点组件处理前运行，可 consume/改写输入 | `types.ts:148`、`packages/tui/src/tui.ts:1014` |

## 4. 候选方案对比

### 方案 A（推荐）：CustomEditor 子类拦截

`session_start` 时 `ctx.ui.setEditorComponent((tui, theme, keybindings) => new ClipboardClearEditor(tui, theme, keybindings))`；子类在 `handleInput` 里：

```ts
class ClipboardClearEditor extends CustomEditor {
	private clearKeys: KeybindingsManager;
	constructor(tui, theme, keybindings, options?) {
		super(tui, theme, keybindings, options);
		this.clearKeys = keybindings; // 父类字段是 private，需自存引用
	}
	handleInput(data: string): void {
		if (this.clearKeys.matches(data, "app.clear")) {
			const text = this.getExpandedText(); // getText() 可能含折叠粘贴占位符
			if (text.length > 0) void copyToClipboard(text).catch(() => {});
		}
		super.handleInput(data); // 默认清空/双击退出行为原样保留
	}
}
```

- 优点：随 `app.clear` 实际绑定变化；只作用于核心输入框。局限：若其它扩展快捷键优先消费同一键，此预判可能把未清空的文本复制走；需要在详细设计中列为适用前提或改用精确触发点。异步复制失败时仍清空会违背防丢失目标，不能作为强保证方案。
- 代价：替换 editor 组件（但 pi 自动迁移 actionHandlers/onSubmit/onChange/外观/autocomplete，见上表）。

### 方案 B：onTerminalInput 观察式

`ctx.ui.onTerminalInput(handler)` 收到 raw data 含 `\x03` 时读 `ctx.ui.getEditorText()`（此时尚未清空，listener 先于焦点组件）并复制，不 consume。

- 优点：代码最少。
- 否决理由：`\x03` 匹配与 keybindings.json 重绑脱钩；dialog 打开时按 `Ctrl+C`（本意 cancel dialog）也会把核心 editor 现存文本写进剪贴板，误覆盖剪贴板。

### 方案 C：改绑 keybindings.json 避开 Ctrl+C —— 只防误触，不满足"存剪贴板"，仅作对照。

### 方案 D：依赖现状撤销键（非 Windows 默认 `Ctrl+-`）—— 已存在，但不可见、不跨终端，不满足需求，仅作对照。

## 5. 关键行为细节（实现时须保持）

- 双击退出：`handleCtrlC` 500ms 内第二次触发是 shutdown；第二击时 `getText()` 已空，自然不复制，无需特判。
- 空输入按 `Ctrl+C`：文本为空不复制（`text.length > 0` 守卫），避免覆盖剪贴板。
- `copyToClipboard` 异步执行；若立即清空并静默吞错，只能保证发起复制请求，不能保证保存成功。设计阶段必须明确复制失败、OSC 52 无回执和与再次输入并发的边界。
- `ctx.hasUI` / `ctx.mode === "tui"` 守卫，JSON/print 模式不注册。
- 生命周期约束：`setEditorComponent` 在 `session_start` 调用（非扩展加载 factory 阶段）；reload 时 pi 的 `resetExtensionUI()` 会恢复默认 editor（`interactive-mode.ts:2355-2373`）；若显式清理，须确保只卸载自己安装的 factory。

## 6. 风险与边界

- `setEditorComponent` 与其它同样替换 editor 的扩展互斥（后注册者胜出）——本插件与 oh-my-pi-v2 等无 editor 替换冲突，已知共存风险仅限未来其它 editor 类插件。
- 多行粘贴内容会折叠为占位符；必须使用 `getExpandedText()` 取得真实内容（`packages/tui/src/components/editor.ts:1083-1102`），不能直接复制 `getText()`。
- jiti 加载的插件模块边界：duck typing 已由 pi 处理，子类无需关心。

## 7. 结论

**纯插件可行**，推荐自定义 editor 作为拦截点。但上面的 fire-and-forget 伪代码不足以证明“清空前内容已保存”；架构阶段需确定失败时是否禁止清空及可验证平台的范围。后续仅在设计获确认后实现。
