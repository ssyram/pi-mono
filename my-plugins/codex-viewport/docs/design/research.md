# codex-viewport 调研

## 范围

本报告比较三类实现，目标由 `principles.md` 定义。调研对象包括 Pi 当前 TUI、既有 `cooldown-redraw` 原型和 Codex CLI transcript 模型。

## 已有基础

### Pi TUI

- 每帧从完整 component tree 生成逻辑行，再与上一帧比较。
- 变化位于 terminal viewport 上方时，原 renderer 会清除 screen/scrollback 并重写完整内容。
- message、tool、editor、theme 与展开组件已经成熟，扩展没有公开 history insertion 或 chat container API。
- assistant 与 tool 生命周期事件足以标记完成；并行 tool 的结束事件按实际完成顺序发出，source order 来自 assistant 内容。
- session 数据在 `message_end` 后持久化，TUI component 归属不参与数据链。

### cooldown-redraw

- 通过修改 `doRender` 在一段时间内忽略 viewport 上方变化。
- 优点是接入轻；缺点是 off-screen 内容可能陈旧，最后仍需全量对齐。
- 不能同时保证“运行中无历史重写”和“finalized history 只有正确的一份”。

### Codex CLI

- 可变 active cell 与 committed history 分离。
- active cell 原地更新；完成后通过独立 history insertion 提交。
- 该模型能同时避免 transient history 和完成后重复，但 Pi 没有对应公开 API。

## 候选方案

### A. 仅组件迁移 + 原 Pi renderer

把 active components 放进裁剪组件，完成后移回 transcript；所有 terminal 绘制继续使用原 renderer。

- 优点：最小、复用最多；当前原型已验证普通 streaming。
- 缺点：resize、forced render、theme/reload 等仍可能触发原生历史重写；无法满足绝对运行期约束。

### B. 组件分层 + 运行期原因感知 renderer

保留方案 A 的 active/finalized component 分离；仅在 agent run 中包装 `requestRender`/`doRender`。普通动态变化和非展开强制变化采用 viewport-only 差分；检测到工具展开状态变化时允许原生历史重绘。进入静态前恢复原 renderer。

- 优点：满足运行期无历史重写、静态原生、AI 零影响；仍复用全部业务组件和大部分 Pi 行渲染。
- 缺点：需要维护一段与 Pi 私有 renderer 状态耦合的适配代码；Pi 升级必须 fail-open。

### C. 独立 transcript/terminal 全面接管

自己维护 committed ledger、active cells、scroll regions、cursor、overlay、resize 与 editor。

- 优点：能力最接近 Codex，可完全控制 terminal history。
- 缺点：重写 Pi TUI 核心，维护成本最高，违反“不全面接管”。

## 推荐

选择方案 B。

理由：方案 A 不能覆盖所有运行期 history redraw 入口；方案 C 违反维护边界。方案 B 只在运行期接管“是否允许历史重绘以及 active visible range”这一层，不接管消息内容、tool renderer、Markdown、editor、输入或 session。

## 关键风险

- 私有 TUI layout 或字段变化：安装前验证；任何不匹配立即退回原 TUI。
- 另一个 renderer patch：拒绝叠加，避免恢复顺序破坏。
- component render 异常：不得吞掉原 TUI 行为或影响 agent；插件回滚后调用原 renderer。
- 运行中 reload：Pi 交互命令明确拒绝 streaming/compacting 时 reload；若外部扩展绕过该前置条件，插件只保证 fail-open 和数据不变，不猜测重建 active state。
