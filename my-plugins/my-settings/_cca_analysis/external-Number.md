# external-Number.md

ES `Number` 内建（构造器形态调用）。

- Sites: json-settings.ts:74 `Number(frame.key)`（数组下标字符串 → 数值）。
- Pre: 任意值；此处实参为 `String(index)` 形态的规范数字串。
- Post: 返回 number；对规范十进制整数字符串恒为精确整数（此处 key 由本源码 ：65 生成，域收敛）。
- Throw domain: `Number(symbol)` 抛 TypeError；其余值域不抛。json-settings.ts:74 位于 try（:5-83）内 ⇒ 任何异常落 ：82 折叠 INVALID_REQUEST，contained。
- 注：`Number.isFinite`/`Number.isSafeInteger` 静态方法另有独立条目（external-isFinite/external-isSafeInteger），静态方法不做 ToNumber、永不抛。
