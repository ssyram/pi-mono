# external-getPrototypeOf.md

`Object.getPrototypeOf`。

- Sites: json-settings.ts:39（普通对象原型闸）。
- Pre: 任意值。
- Post: 原型或 null；json-settings.ts:40 仅接受 `Object.prototype` 或 null ⇒ 类实例/Map/Date/RegExp 等一切非平凡原型对象被结构化拒绝 ✔ prototype.md §2 validateValues"不执行业务提供的方法"。
- Throw domain: 对原始值装箱返回其原型不抛；Proxy 的 getPrototypeOf 陷阱可抛 ⇒ 落 json-settings.ts:82 contained。
