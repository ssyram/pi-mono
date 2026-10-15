# external-values.md

`Object.values`。

- Sites: json-settings.ts:44 `Object.values(fields)`（遍历全部属性描述符做访问器检查）。
- Pre: 对象（gOPD 产物）。
- Post: 描述符对象数组，**含 symbol 键与不可枚举键对应的值**（gOPD 域是全部自有权属，values 只是取值）⇒ 访问器检查覆盖面完整（含隐藏访问器）。
- Throw domain: 原始值实参 ⇒ TypeError——不可达（:43 产物）；json-settings.ts:44 在 try 内，双保险。
