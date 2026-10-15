# external: fromEntries (Object.fromEntries)

- 来源引用点：settings-service.ts:41（`Object.fromEntries(Object.keys(defaults).map((key) => [key, merged[key]]))`）。
- kind：ECMAScript 内建。

## Pre
- 实参为可迭代的 [key, value] 对（本调用点：map 产出的二元数组序列，key 为 string、value ∈ SettingValue）。

## Post
- 返回全新普通对象（原型 Object.prototype）：每个对成为自有可枚举属性；重复 key 后者覆盖前者；不改输入。
- 本调用点 key 来自 Object.keys(defaults)（string、互异）→ 无覆盖歧义；value 恒为 JSON 值。

## 可否 throw-reject
- 对 pair 数组可迭代输入不抛；非可迭代实参才 TypeError——本调用点恒为 map 返回的数组，不可达。
