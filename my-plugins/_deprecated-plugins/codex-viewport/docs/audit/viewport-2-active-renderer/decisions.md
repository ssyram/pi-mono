# viewport-2 Decisions

## D1：demand-driven variable area

Managed area是`[top,bottom)`。Entry不预占全屏；新内容先向下增长，到terminal bottom后才按真实overflow向上增长。

## D2：finality不等于displacement

Finalized rows可继续在当前screen原位可见。只有连续source-order finalized前缀可commit；只有实际content pressure使其离开可见区时才进入history。

## D3：Editor-first

Editor+footer最高优先；widgets次之；transcript tail最后。Mandatory rows无法容纳才fallback。

## D4：width re-entry

Height/footer/widget变化保持managed。Width变化触发一次mandatory Pi native full redraw，再DSR recapture并进入新managed epoch。Gate期间若消费了后续更新，返回native时允许一次catch-up render；它通常是incremental，但Pi自身full-render条件仍然优先。

## D5：unsupported rendering

Visible overlay、image、Ctrl+O、foreign owner、ABI mismatch、committed mutation和write failure走native。Persistent hidden overlay不触发。

## D6：hard death

只恢复Pi `message_end`已持久化内容；不恢复in-flight assistant/tool或旧terminal fragments。

## D7：拒绝 row-history 与 bottom-anchor

真实 `/tsnapshot` 已证明 D1/D2/D3 的现有实现组合存在设计漏洞：row FIFO 可以拆开多行 visual component，顶部 padding 可以把同一 component 的两部分分隔，手工 history insertion 可以在长 block commit 时制造单次 layout flash。这些不是接受的风险，也不能以局部 padding 或 slice 修补处理。

已实施 `../../design/fixes/atomic-block-native-commit.md`：组件以完整 visual block 为转移单位；slack 仅能在 Footer 后；插件不再运行期手工插入 history，而是经一次 Pi native commit boundary后重新进入 managed suffix。