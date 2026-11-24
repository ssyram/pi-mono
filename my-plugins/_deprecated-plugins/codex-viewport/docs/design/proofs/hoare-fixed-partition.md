# Hoare Proof：Variable Inline Area 与 Volatile Non-Leakage

令terminal高度H，managed area为`[T,B)`，满足`0≤T<B≤H`。

Intrinsic rows D超过`B-T`时：

```text
down=min(D-(B-T),H-B)
up=min(D-(B-T)-down,max(0,T-2))
nextArea=[T-up,B+down)
```

故area只按真实overflow增长，且downward growth不触碰stable rows。Upward growth的数量不超过未满足overflow，每个新增owned row由同帧content填入。

Editor+footer是mandatory；widgetBelow、widgetAbove/status和transcript依优先级取尾部。若mandatory超过area在可用growth后的容量则fallback。

令P为旧protected+新prepared finalized rows，Q为pending rows，K为最终transcript capacity：

```text
retain=max(0,K-|Q|)
spill=prefix(P,max(0,|P|-retain))
protected=suffix(P,retain)
```

因此任一finalized row要么仍可见于protected，要么属于spill，不存在hidden gap。Q从顶部裁剪但不能作为history input。

`T≥2`时spill只滚top stable region；managed area不动。`T<2`且spill非空时fallback。Ordinary diff只absolute CUP+erase/write，无CRLF，所以volatile UI不会泄漏到history。

Induction基础是native-seeded entry frame；每个成功transaction同时accept geometry、protected、stable和frame，保持不变量。
