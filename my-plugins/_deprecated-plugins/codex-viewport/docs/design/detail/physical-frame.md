# 细化：InlineViewportFrame

`rows.length=area.height`；cursor是area-relative并必须在bounds内。

Entry frame直接seed为DSR/native baseline对应的`[top,bottom)` bytes。首个managed render因此只diff真实变化，不重复clear相同Editor/content。

Diff按absolute row比较previous与next area的重叠部分。Top/bottom/terminalHeight可以变化，只要width相同；相同absolute row bytes不写。变化row使用absolute CUP、`CSI 2K`和next bytes，不发送CRLF。

Width不同不能diff，必须先Pi native reflow并建立新epoch。完整physical comparison对象是stable top rows加managed frame；short area以下未使用屏幕不属于transcript。
