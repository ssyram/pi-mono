# 细化：InlineViewportArea

## Geometry

```ts
interface InlineViewportArea {
  top: number;
  bottom: number;
  width: number;
  height: number;
  terminalHeight: number;
}
```

不变量：`0≤top<bottom≤terminalHeight`，`height=bottom-top`。Screen `[0,top)`是stable-visible region；`[top,bottom)`由managed renderer拥有；`[bottom,terminalHeight)`是尚未使用的native空白空间。

Entry的top来自最早unfinished/differing component，bottom来自native当前内容末端。两者都不预先扩到全屏。

## Growth

Intrinsic content超过area height时：先增长bottom；bottom抵达terminal bottom后，剩余overflow才降低top。每次增长等于真实overflow，新增rows在同一frame填入内容。

Top可以向上增长；bottom可以向下增长；height resize会rebase terminalHeight。Width变化结束当前epoch并进入native redraw/recapture。

## Small top

`top=0/1`仍可absolute diff，但不能安全执行top history insertion。若此时必须spill则fallback。
