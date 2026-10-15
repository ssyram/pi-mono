# external-includes.md

`String.prototype.includes`。

- Sites: settings-files.ts:13 `name.includes("\0")`（NUL 字节拒绝——node fs 路径注入防线）。
- Pre: receiver 为 string（:13 typeof 守卫已收敛）。
- Post: boolean；大小写敏感子串判定。
- Throw domain: string receiver 上不抛。
