# external-entries.md

`Object.entries`。

- Sites: json-settings.ts:69 `Object.entries(fields)`（遍历描述符对象的字符串键）。
- Pre: 对象（此处为 gOPD 产物）。
- Post: `[key, value]` 对数组，**仅自身可枚举字符串键** ⇒ descriptor 对象上的 symbol 键名（对应源对象的 symbol 属性）被此步天然过滤，与 JSON 序列化域一致。
- Throw domain: 参数为原始值时抛 TypeError/装箱行为——此处实参恒为 ：43 新建普通对象 ⇒ 不可达；Proxy 病态域不适用。json-settings.ts:69 在 try 内，双保险。
