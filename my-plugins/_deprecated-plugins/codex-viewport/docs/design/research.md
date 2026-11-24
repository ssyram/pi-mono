# codex-viewport 调研

状态：viewport-2 实现依据；implementation evidence见`known-state.md`

## 1. 问题与证据

目标由 `principles.md` 定义。当前 component-only 原型已证明两件事：裁剪动态尾部能够阻止未完成工具进入上方历史；仅移动 components 并继续调用原生 `doRender` 不能稳定完成历史提交。

真实失败包括：

- 完成内容延迟到 `agent_end` 时，最终 component tree 一次性增长，Editor 曾落到物理屏幕以下。
- 为保序把 info/user 一并放进单一 LiveRegion 时，静态尾部长期占据可见空间。
- 自定义 renderer 与原生 renderer 交错写 terminal 时，出现过物理重复和 cursor baseline 分叉。
- Pi 等待阶段真实输出包含 2003 次 `ESC[2K`；Apple Terminal crash 位于 `NSTextInputContext`，不是 Node exception。

## 2. Pi 当前能力

### 2.1 Component 与输入

`packages/tui/src/tui.ts` 的 `Component.render(width)` 返回逻辑行。`Container.render()` 依 child 顺序拼接；InteractiveMode root 顺序为 header、resources、chat、pending、status、widgets、editor、footer。

Editor 继续由原生 input chain 管理。它在 focused 时输出 `CURSOR_MARKER`，TUI 删除 marker 后定位 hardware cursor，供 IME candidate window 使用。

### 2.2 Renderer

`TUI.requestRender()` 负责 16ms 调度；`requestRender(true)` 会清空原生 baseline。私有 `doRender()`：

1. render 完整 component tree；
2. composite overlays；
3. 提取 cursor marker；
4. 与 `previousLines` 比较；
5. 选择 full redraw 或 line diff；
6. 写 synchronized ANSI；
7. 更新 viewport/cursor baseline。

关键私有状态为 `previousLines`、`previousWidth`、`previousHeight`、`previousViewportTop`、`cursorRow`、`hardwareCursorRow`、`maxLinesRendered` 和 Kitty image ids。

### 2.3 现有缺口

Pi 没有公开的 finalized-history queue 或 `insertHistoryAboveViewport()`。把 component 加回 chat 只会令完整逻辑文档增长；原生 renderer 不知道这是“历史提交”。扩展可以 patch instance `doRender`，当前真实探针已验证这一点。

### 2.4 动态widget物理泄漏

`pi-subagents` live progress以同一key替换`aboveEditor` widget，逻辑tree始终只有一份。但Pi按完整root逻辑行index diff；目标行落到旧viewport底部以下时用CRLF滚屏。因此旧elapsed revision可在component已删除后留在physical history。

这否定了动态`viewportTop=H-currentContentHeight`：history/volatile边界必须在managed epoch内固定，ordinary volatile diff不得滚屏。

## 3. Codex 当前参考

OpenAI Codex 当前源码包含：

- `pending_history_lines`；
- `insert_history_lines`；
- 独立 inline `viewport_area`；
- 单次 synchronized update 内的 history flush + active frame draw；
- scroll region、cursor restore、wrap policy、Zellij 特例和 resize reflow。

其关键不是特殊 completion 规则，而是 renderer 明确区分 physical history 与 active viewport。

参考：

- `codex-rs/tui/src/tui.rs`
- `codex-rs/tui/src/insert_history.rs`
- `codex-rs/tui/src/app.rs`

## 4. 真实候选

### A. Component-only bridge

裁剪 wrapper + 完成后恢复原 chat，terminal 始终由原生 `doRender` 写。

- 优点：依赖小、输入与 cursor 原生。
- 缺点：完成提交仍是整张长文档变化；真实运行已出现 final jump、顺序和 Editor 可见性问题。
- 结论：保留为旧实现与回归参考，不再作为目标架构。

### B. 运行期有限 renderer 接管

保留原生 component tree 和 `requestRender`；agent 运行期间插件独占 `doRender`，维护 ordered ledger、history insertion、active frame diff 和 cursor。idle 时交还原生 renderer。

- 优点：直接表达目标模型；无需重写消息、工具、Editor、输入或 session。
- 缺点：必须正确实现 terminal transaction、overlay/image、resize 和 baseline handoff；依赖 Pi 私有 ABI。
- 结论：选定。

### C. 修改 Pi 增加 history seam

在官方 TUI 增加 `commitHistory(lines)` 和 active viewport API，插件只调用公开能力。

- 优点：长期最稳，Pi 保持唯一 owner。
- 缺点：当前任务运行官方全局 Pi，修改 workspace 官方源码不会生效；需要 upstream 接受。
- 结论：长期最优，不是当前插件的可交付路径。

### D. 全面重写 TUI

插件重做 components、Editor、输入、overlay、renderer 和 session UI。

- 优点：完全控制。
- 缺点：超出意图，维护面最大。
- 结论：拒绝。

## 5. 推荐与边界

选择 B，并坚持：

- 原生 component tree 始终是静态 UI 真相；不再靠 detach/restore 表达历史。
- agent 运行期间插件是唯一 terminal renderer；原生 `doRender` 不参与写入。
- idle、reload 后、下次进程恢复为原生 renderer。
- 计算失败且尚未写 terminal 时 fail-open；写入已开始后的失败进入 poisoned recovery，不能谎称事务回滚。
- AI/session/tool/input observers 保持零替换、零持久化副作用。

## 6. 实现后仍需验证的风险

- Kitty image history insertion 不能仅凭文本 scroll-region 证明；首版需实现专门 block 计划或明确 native fallback。
- width resize 后 terminal scrollback reflow 与 Pi component 重渲染可能不一致。
- seamless handoff 需要同步私有 baseline；不兼容时只能接受一次原生 force redraw。
- `terminal.write()` 没有物理原子提交确认；进程在 write 中途死亡时无法保证 scrollback 无部分提交。
- Apple Terminal 系统级 IME crash 只能降低触发面，不能由插件证明修复。
