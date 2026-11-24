# codex-viewport 架构

状态：demand-driven pending suffix、bottom slack与native commit/re-entry已实现；本次架构替换的证据和回归门禁见 `fixes/atomic-block-native-commit.md`。

## 1. 边界

```text
Pi component tree       内容真相
TranscriptLedger        source order与finality
InlineViewportArea      [top,bottom) managed物理范围
StableScreenRows        managed area上方的可见稳定bytes，仅用于native handoff attestation
InlineViewportFrame     managed area当前bytes/cursor
```

插件只改变agent run期间的物理绘制。provider、message、tool、abort、session、Editor和input仍由Pi原生负责。

## 2. 状态机

```text
idle-native
→ entering-managed
→ active-managed(epoch N)
→ draining-handoff
→ idle-native | active-native-fallback | disposed
```

Width resize增加：

```text
active-managed(N)
→ one native full redraw
→ width-recapture-gate
→ active-managed(N+1) | active-native-fallback
```

任一时刻只有一个renderer owner。gate期间component tree和lifecycle可继续变化，但terminal frame write为零。

## 3. Entry

1. patch `doRender/stop`为零绘制gate；
2. 发送`CSI 6n`，只消费DSR并把邻接输入返回input chain；
3. 由native cursor baseline求Pi物理origin；
4. 比较header/resources/chat与`previousLines`求stable boundary；
5. `area.top`取最早unfinished/differing component的物理起点；
6. `area.bottom`取Pi当前已绘制内容的物理末端，而非terminal bottom；
7. 用native可见bytes seed首个frame。

因此短内容不会立即跳进全屏box，也不会清除submitted user message以上的稳定行。

## 4. Demand-driven geometry

Managed area是`[top,bottom)`：

- 新内容先把`bottom`按实际overflow向下增长；
- 当前实现到terminal bottom后裁剪live transcript顶部，不移动`top`；
- tribunal已裁决保留crop：不重新引入stable-row displacement或插件history insertion；
- `top`上方不得收到无真实占用依据的`EL2`；
- Editor/footer始终优先。

Finalized表示“不再变化”，不表示“按行离开屏幕”。可见finalized component保持完整；当source-order连续finalized prefix形成时，它经native commit整体进入Pi静态scrollback。

## 5. Ledger与static suffix

```text
pending → finalized → prepared → committed
```

committed只能是最大连续finalized source-order前缀。后面的static/custom/tool即使先finalized也不能越过前面的pending item，但相同物理位置和bytes不再重复写入。opaque tail在无completion contract时保持pending；离开tail后才finalize。

## 6. Native commit与UI预算

每帧先计算intrinsic高度：

```text
pending transcript
+ widgetAbove/status
+ Editor
+ widgetBelow
+ footer
```

真实overflow先向下增长area；到达terminal bottom后只裁pending transcript顶部，绝不滚动stable rows或手工插入history。空余行只放在Footer后。连续finalized source-order prefix先完整留在当前frame，再把该已可见frame原子采纳为Pi baseline；commit不二次调用component render或native `doRender`。若仍有pending component，DSR recapture后从首个pending component重建area。

## 7. 单帧事务

```text
preflight
→ reconcile ledger
→ prepare maximal finalized prefix
→ calculate intrinsic demand and [nextTop,nextBottom)
→ preview ledger/frame/stable attestation state
→ render frame diff + cursor
→ one synchronized terminal.write
→ commit ledger and accept all previews
```

write返回前不推进内存状态；write失败后不重发prepared batch。

## 8. Resize

Height、footer和widget高度变化留在当前epoch：调整`bottom`/capacity并重绘owned rows，不调用native renderer。

Width变化需要文本reflow：

1. 停止当前managed epoch；
2. 调用一次Pi native `fullRender(true)`，允许一次`2J/3J`闪烁；
3. 立即重新gate；
4. 再次DSR；
5. 保留ledger identity/finality，清除旧physical provenance；
6. 从最早non-committed component建立新area；
7. 激活下一managed epoch。

Recapture失败时保留mandatory width reflow建立的native baseline。若gate消费了后续更新，返回native前执行catch-up render；它通常incremental，但Pi自身height/clear-on-shrink等full-render条件仍然优先。

## 9. Handoff与fallback

Handoff以native cursor和managed physical cursor建立logical→physical origin，保留未被Pi占有的terminal顶部prefix，并逐行比较其余attested rows、Footer后bottom slack、cursor column和geometry。相同则prime native baseline后无重画交权；否则一次native recovery。

Visible overlay、image、Ctrl+O状态变化、foreign owner、ABI不符、committed mutation和write failure走native。Persistent hidden overlay不触发。TUI stop在managed frame上同步recovery；若width redraw后仍在recapture gate，则直接恢复原方法，因为屏幕已经是native。

## 10. Hard death

Process death丢弃plugin内存；新Pi只从canonical session JSONL恢复`message_end`已持久化内容。in-flight assistant/tool和旧terminal partial bytes不恢复。

## 11. D 层修正：native commit boundary

旧 `ProtectedHistoryRows → top scroll-region insertion` 已删除。active renderer 只拥有 pending suffix，且 overflow 只裁剪该 suffix 的顶部；它不滚动 stable rows、不插入 history。source-order finalized prefix 保持为完整 component block，先被写入当前managed frame，再由Pi baseline adoption提交；若仍有unfinished component，则DSR recapture后重新进入 managed。slack 永远是Footer后的frame尾部。