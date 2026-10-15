# external-create.md

`Object.create`。

- Sites: json-settings.ts:9 `Object.create(null)`（holder，null 原型顶层容器）、json-settings.ts:50 `Object.create(null)`（每个拷贝出的普通对象容器）。
- Pre: proto 为 null 或对象（此处恒 null）。
- Post: 无自有任何属性的可扩展 Ordinary 对象，原型为 null ⇒ 其后一切 `[[Set]]`/属性读写走 Ordinary 行为，无原型访问器可触发（`__proto__` 键成为自身数据属性，无污染通路）。
- Throw domain: proto 非对象非 null 时抛 TypeError——此处字面量 null ⇒ 不可达；propertiesObject 形态未使用。
