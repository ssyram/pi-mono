# external-keys.md

`Object.keys`。

- Sites: settings-kind.ts:22 `Object.keys(defaults)`（遍历请求键——defaults 的自身可枚举字符串键）。
- Pre: 对象；原始值 ⇒ TypeError ⇒ 落 pickValidFields try（settings-kind.ts:34）contained。仓域 defaults 恒为 copySettings 输出 ⇒ 不可达。
- Post: string[]，仅自身可枚举字符串键 ⇒ symbol/不可枚举的 defaults 键天然不参与查询（与 prototype §3 keys 语义一致）。
- Throw domain: 如上，contained。
