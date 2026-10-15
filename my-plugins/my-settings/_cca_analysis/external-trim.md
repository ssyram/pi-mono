# external-trim.md

`String.prototype.trim`。

- Sites: settings-files.ts:13 `!name.trim()`（空白路径拒绝）。
- Pre: receiver 为 string（:13 前有 `typeof name !== "string"` 守卫 ⇒ 域收敛）。
- Post: 去首尾空白的串；`"".trim() === ""` ⇒ 与 `!` 组合拒绝空/纯空白路径。
- Throw domain: string receiver 上不抛（coercible receiver 越域由守卫排除）。
