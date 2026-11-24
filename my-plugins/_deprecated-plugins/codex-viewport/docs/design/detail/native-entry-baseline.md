# 细化：NativeEntryBaseline

Entry在zero-write gate内发送DSR，由`actualCursor-(hardwareCursorRow-previousViewportTop)`求Pi physical origin。

Renderer重新render header/resources/chat并与native `previousLines`求stable boundary。Initial `area.top`映射到最早differing component；width recapture时还会取earliest non-committed ledger component的更早起点。

`area.bottom`映射到native当前已绘制lines的physical末端，不是terminal bottom。Native visible bytes被映射到screen rows并seed为initial frame；因此首个managed diff不重写相同内容。

Baseline committed components只包含stable boundary之前完整结束的chat components。DSR、geometry、origin或ABI证明失败时，在首个managed frame前恢复native。
