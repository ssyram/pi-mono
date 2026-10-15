# external-pop.md

`Array.prototype.pop`。

- Sites: json-settings.ts:18 `pending.pop()`（显式工作栈出帧——copySettings 无递归的关键）。
- Pre: 数组；空数组返回 undefined（:19 `if (!frame) break` 防御，实际 `while (pending.length)` 保证非空）。
- Post: 移除并返回末元素；length 减一。
- Throw domain: 无（仅宿主内存耗尽，单独声明）。try 内双保险。
