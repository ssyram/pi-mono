# Hoare Proof：Inline Native Entry

令B为Pi最后native baseline，T为terminal physical screen，O为Pi logical row 0的physical row，S为header/resources/chat的首个native mismatch。

在native baseline描述T时安装zero-write gate并发送DSR。DSR不改变cells；filter只消费完整cursor report，邻接输入返回原input chain。因此等待期间T不变。

```text
O = actualCursor.row - (hardwareCursorRow - previousViewportTop)
```

ABI前提使括号项等于native cursor相对viewport位置，故O成立。

从index 0比较current normalized prefix与B。循环不变量为`∀i<S: current[i]=B[i]`；只attest完整结束于S前的components。

```text
top = physical(O + S - previousViewportTop)
bottom = physical end of B's currently rendered lines
area = [top,bottom)
```

Width recapture还将top取到earliest non-committed ledger component的起点，防止native redraw显示的pending partial被误当stable。

Native visible rows映射后分别seed `StableScreenRows[0,top)`和initial frame`[top,bottom)`。因此首个managed diff只写真实变化，不清除stable prefix，也不把short layout预扩到terminal bottom。

任一DSR、geometry、origin、ABI或mapping失败发生在首个managed frame前，恢复native owner且不提交history。
