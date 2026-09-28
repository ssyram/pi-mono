# clear-to-clipboard：架构设计

归属：`my-plugins/clear-to-clipboard/`；这是插件整体的设计，survey 记录在 `../../RESEARCH.md`。用户后续裁决取代了 survey 中“必须确认复制成功才清空”的候选：**只要向系统发出剪贴板写入请求，pi 的清空/双击退出照常执行；无需等待系统实际写入。** 设计只承诺请求，不承诺最终剪贴板状态。

## 1. Q 与已核事实

- **Q.I（用户）**：在交互模式主输入框的 `Ctrl+C` 清空时发起内容复制；长粘贴在剪贴板请求文本中表示为 `[paste#ID-- <actual text> ##]`，其中 ID 为 pi 生成的数字、`<actual text>` 为该粘贴的真实正文；纯插件，绝不修改 pi-mono 官方源码。
- **Q.I（用户后续裁决）**：不要求插件等待、验证或兜底操作系统/终端是否真的接受剪贴板写入；其余默认按键行为不因复制请求改变。
- **Q.E（用户）**：有误触清空丢输入的经历；该经历不证明任何平台剪贴板必可用。
- **Q.A（源码）**：pi 的 `CustomEditor.actionHandlers` 是公开 Map；真正触发 `app.clear` 时调用它保存的回调，回调最终执行 `handleCtrlC()`（第一次清空、500ms 内第二次退出）。`Editor` 把大粘贴正文存于运行时私有 `pastes: Map<number,string>`，可见输入里只放 `[paste #N …]`。`getText()` 返回标记，`getExpandedText()` 返回正文但丢失 ID。来源：`packages/coding-agent/src/modes/interactive/components/custom-editor.ts` 的 `handleInput`/`actionHandlers`、`interactive-mode.ts` 的 `handleCtrlC`、`packages/tui/src/components/editor.ts` 的 `handlePaste`/`getExpandedText`。

## 2. D.root：设计性质 P

- **P1（目标事件）**：当主 editor 的实际 `app.clear` 回调执行且 `getText()` 非空时，插件从当前 editor 同步构造请求文本，调用一次 `copyToClipboard(text)`，随后调用原始 `app.clear` 回调一次；不依赖 Promise 的完成、失败、耗时或终端回执。
- **P2（数据）**：保留非粘贴正文、换行、空格；对仍有正文映射的真实 pi 粘贴标记 `[paste #N …]`，输出 `[paste#N-- ${正文} ##]`。多个标记各自展开一次；没有映射的同形文本按普通文字保留，不得伪造正文。空编辑器不提交复制请求。
- **P3（默认行为）**：包装的是实际 action handler，不抢先按原始 Ctrl+C 字节猜测，也不延后清空；原 handler 的 500ms 双击退出、keybindings 重绑、extension shortcut 优先级由 pi 保持。不可因复制请求失败而跳过原 handler。
- **P4（生命周期）**：仅 TUI 会话安装，订阅的终端监听器用于发现当前聚焦的 editor 并在其处理键前装入回调包装；会话停止时取消监听，并只恢复本插件拥有的包装，不触碰其它扩展后续替换的 handler；状态由会话闭包拥有，不建跨会话全局可变状态。
- **P5（纯插件）**：新代码仅位于 `my-plugins/clear-to-clipboard/`；不修改官方源码、默认键位和 pi 的 editor 组件。

**作用域**：这里的“发出请求”指对 pi 导出的 `copyToClipboard(text): Promise<void>` 发起调用，不是断言物理剪贴板随后可粘贴。`pastes` 是当前 pi-tui 的 TS private 运行时字段，并非受支持的扩展 API；对未知版本若读不到映射，以 `getExpandedText()` 作为有正文而无 ID 的降级请求文本，并声明精确 P2 的适用前提。

## 3. Operational model M

不调用 `setEditorComponent`，避免 pi 在替换 editor 时只迁移折叠标记、丢失正文。`session_start` 使用短暂、零行的 `ctx.ui.setWidget()` factory 取得该 TUI，随即移除 widget；当前 renderer 运行时有 `getFocusedComponent()`，但导出的 `TUI` 接口未声明它，插件先作运行时检测再订阅 `ctx.ui.onTerminalInput`，缺此方法便不安装。pi 的 TUI 在把输入交给焦点组件之前调用该监听器（`packages/tui/src/tui.ts` 的 `handleTerminalInput`）。

```text
输入进入 TUI
  → 插件监听器取得当前焦点组件
  → 若它持有主 editor 的 app.clear actionHandlers，且此 handler 尚未包装：
       保存原 handler；把其 Map 项设为包装函数
  → 不 consume、不更改按键；由 pi 自己选择动作
  → 如果实际执行 app.clear 包装函数：
       读取当前聚焦 editor 的 getText() 与运行时 pastes 映射
       非空：构造 [paste#N-- 正文 ##] 格式并发起 copyToClipboard(payload)
       不等待结果；同步调用原 handler（包括退出的情况）
```

真实 handler 而非预先匹配键值是操作分界，故其它 UI 中的取消键与扩展快捷键不误触发。旧方案的两条反例不再适用：不替换 editor 就没有“长粘贴在安装时只迁移 marker”；清空也不在异步 Promise 完成后才触发，故没有“旧 editor 回调清空新 editor”。

两项独立职责：`clipboard-payload.ts` 只负责用 Map 把真实 marker 变换为请求文本；`attach-clear-action.ts` 只负责挂接实际 clear handler 并释放会话资源。入口 `extension.ts` 负责 session_start/shutdown，`index.ts` 只 re-export。剪贴板平台选择复用 pi 的 `copyToClipboard`，插件不维护另一个 pbcopy/wl-copy/OSC 52 实现。

## 4. 接口与不变量

- **editor → payload**：输入 `raw: string` 和 `pastes: ReadonlyMap<number,string>`；输出纯字符串。仅匹配符合 pi 当前 marker 格式且 ID 存在于 Map 的片段；从不改 Map 或 editor。
- **focus → action wrapper**：要求当前焦点组件确实暴露 `actionHandlers: Map`、`getText()` 和 `getExpandedText()`；包装后，若 handler 被执行，`copyToClipboard` 被请求至多一次，再**无条件**调用原 handler 一次。包装不能递归包裹自己；原 handler 被其它扩展替换后不得私自覆盖。
- **I1**：会话内同一 editor 当前 handler 只有一层本插件包装；会话关闭只恢复自己那一层。其它扩展可以覆盖 handler，届时本插件不承诺与其组合的效果。
- **I2**：请求文本在原 handler 清空编辑器前同步形成；Promise 的继续/拒绝路径不再访问或清空 editor。这样不产生跨会话异步清空。

## 5. 架构论证 R 与边界

`Q.I → P1/P2/P3`：事件精确性由包装实际 `app.clear` handler 承担；正文一致性由 pi 的 `pastes` Map 提供；用户只要求请求，因此无需 Promise 成功门控，原 handler 立即运行即可保持默认行为。`P4/P5` 由会话闭包、终端监听器取消及不替换 editor 保证。比原自定义 editor/等待复制方案少一份新 editor、一份 pending 状态及失效回调。

**格式边界**：固定结束符 `##]` 让日常文本更容易批量匹配，但正文若也包含 `##]`，仅靠非贪婪正则仍可能提前结束；插件不删除正文、不转义用户粘贴内容。

**仍然不能证明的更强命题**：终端一定接受 OSC 52、剪贴板最终持有内容、后续程序不会覆盖；这已被用户明确排除在本插件保证外。当前 pi 版本的 `pastes` 私有字段或 widget factory 时序若改变，精确 ID+正文格式需更新插件；不能把这种实现依赖偷换成稳定公开 API。代码现已落在本插件目录；定向测试 11/11、插件 TypeScript 检查和 `npm run check` 通过，交互启动已显示插件加载（未以真实 Ctrl+C 写入用户剪贴板）。函数级步骤见 [detailed-design.md](detailed-design.md)，证明边界见 [correctness.md](correctness.md)。
