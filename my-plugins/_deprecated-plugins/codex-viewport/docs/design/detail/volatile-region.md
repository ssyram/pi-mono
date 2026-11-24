# 细化：VolatileRegion

## 内容顺序

```text
pending visual blocks
pending/status/widgetAbove
Editor
widgetBelow
footer
bottom slack
```

输出恰好`InlineViewportArea.height`行；不足只在Footer后补empty。slack不得出现在任何transcript block前。

## Priority

1. Editor和footer必须完整；两者合计超高则native fallback。
2. widgetBelow取剩余空间尾部。
3. pending/status/widgetAbove取再剩余空间尾部。
4. pending transcript只取最后余量。

widgets过高时裁顶部；live overflow只裁pending transcript顶部。没有active finalized-history queue：finalized source-order prefix交给native commit，不能作为裸行留在本region。

## Revision replacement

frame固定absolute rows。widget变高、变矮或删除时，next frame对改变row执行absolute move + `EL2` + next bytes。普通更新无CRLF，不会将旧revision推入history。

## Cursor

Pi cursor marker在render raw lines后提取，坐标相对viewport；最终转换为`area.top + row`。`showHardwareCursor`决定show/hide。cursor placement是transaction最后一步。

## Opaque content

未知chat component默认pending；当它被后续chat component确定地从tail推开时可finalize。commit前它完整处于managed suffix；commit后由native renderer持有。任何已native-committed component mutation触发native recovery。
