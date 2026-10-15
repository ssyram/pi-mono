# external-relative.md

node:path `relative`。

- Sites: settings-files.ts:17 `relative(resolve(root), path)`（包含性判定基量）。
- Pre: 两个 string 路径（此处第一参为 resolve 产物）。
- Post: from→to 的相对串；同路径 ⇒ `""`（:18 `!within` 拒，防根目录本身）；to 在 from 之下 ⇒ `..` 开头；Windows 跨盘 ⇒ 绝对串（:18 isAbsolute 闸兜底）。
- Throw domain: 非 string 实参 TypeError（root 非串时）⇒ settings-files.ts:23 contained；string 域内不抛。
