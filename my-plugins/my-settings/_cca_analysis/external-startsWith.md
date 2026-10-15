# external-startsWith.md

`String.prototype.startsWith`。

- Sites: settings-files.ts:18 `within.startsWith(`..${sep}`)`（越界路径前缀闸，darwin sep="/"）。
- Pre: receiver 为 string（relative 产物）；实参为模板串。
- Post: boolean；与 `within === ".."`、`!within`、`isAbsolute(within)` 共同构成四闸：`..`、`../x`、空串、绝对 within 全部拒绝 ⇒ resolve(root) 包含性成立。
- Throw domain: string 上不抛。
