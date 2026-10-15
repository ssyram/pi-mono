# external-isFinite.md

`Number.isFinite`（静态，非全局 isFinite）。

- Sites: json-settings.ts:30（叶子 number 判定：排除 NaN/±Infinity）。
- Pre: 任意值；此处 item 已被 typeof 收敛为 number。
- Post: boolean；**不做 ToNumber** ⇒ 对非 number 恒 false、永不抛（与全局 isFinite 的本质差异）。
- Throw domain: 无。json-settings.ts:30 在 try 内，双保险。
- 语义闭环：NaN/±Infinity 未通过本闸 ⇒ 落 :34-35 结构化拒绝 ⇒ :79 stringify 的"非有限数序列化为 null"通路不可达。
