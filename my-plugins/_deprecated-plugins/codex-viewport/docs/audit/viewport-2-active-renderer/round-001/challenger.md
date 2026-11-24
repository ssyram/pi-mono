# Challenger

本遍只攻击，不替设计辩护。

## F1 — entering-managed物理锚点不完整

设计说明安装patch和第一次managed render，但没有定义如何把Pi最后一个native visible frame转换为`previous ActiveViewportState`。若第一帧直接假设空active frame，可能重画/覆盖当前可见历史；若把agent_start时所有chat children视为committed，尚未实际render的user/assistant可能丢失。

严重度：blocker，S/C。

## F2 — Ctrl+O“显式进入suspended”缺触发接口

插件没有公开key event或InteractiveMode回调。当前可见接口只有`getToolsExpanded()`。架构写coordinator显式处理Ctrl+O，却未定义谁检测expanded state变化以及在何时避免managed write。

严重度：blocker，C。

## F3 — 图片策略未决

HistoryInsertion承认Kitty image不能当text提交，却没有选定fallback或完整支持。implementation-ready声明与此冲突。

严重度：blocker，C。

## F4 — terminal.write成功前提过强

Hoare成功路径把write返回解释为bytes按序交付，但ProcessTerminal.write只是`process.stdout.write(data)`且忽略boolean/backpressure。返回不等于刷新到terminal；硬故障下exactly-once无法成立。

严重度：known risk，S措辞。

## F5 — width resize seamless handoff证据不足

只比较visible frame不能证明terminal reflow后的旧scrollback等于按新width render的完整native tree。文档已指出，但RuntimePhase没有明确强制recovery条件。

严重度：major，C。

## F6 — unknown custom finality影响目标覆盖

opaque到run end虽然Sound，但一个很早的unknown component会阻塞后续所有finalized items，导致run中几乎不提交history。需明确这是保守降级而不是一般行为保证。

严重度：major，Complete/Optimization。

## F7 — native helper调用可能有副作用

`extractCursorPosition`会修改lines；overlay compositor可能padding到terminal height。Handoff和FrameLayout若调用顺序不同于Pi，byte compare会产生假不等或错误cursor。

严重度：major，S。

## F8 — status finality识别缺代码依据

设计正确指出`showStatus`可更新tail Text，但插件只能看到generic Spacer/Text shape；没有公开字段证明它是`lastStatusText`。若将普通Text与status混淆，可能过早commit或过度阻塞。

严重度：major，S。

## F9 — poisoned recovery无法保证不重复

native force redraw能恢复visible screen，但已部分进入scrollback的bytes无法删除。若报告“恢复单份历史”会越界。

严重度：known risk，S。

## F10 — 旧实现与新实现过渡

设计列删除旧文件，但README仍把component-only当前行为写成现行保证。实现前若不标明“当前代码仍是viewport-1”，读者会混淆设计与已交付行为。

严重度：major，Concise/Sound documentation。
