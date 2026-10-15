# external-fromEntries.md

`Object.fromEntries`。

- Sites: settings-query.ts:65 `Object.fromEntries(Object.keys(validated.value).map((key) => [key, merged[key]]))`（executeSettingsQuery 的 defaults 键集投影，唯一调用点；即 arch/prototype.md §4 `pickKeys (keys defaults) combined`）。
- Pre: 实参可迭代（仓内恒为 `Array.prototype.map` 的新建数组 ⇒ 数组迭代器，无用户代码）；每条目需为对象（仓内恒为箭头新建的二元数组）⇒ 条目非对象的 TypeError 域不可达；`Get(item, "0"/"1")` 对普通数组为普通属性读，不抛；键经 ToPropertyKey（仓内恒为 `Object.keys` 产出的字符串，不触发 toString）。
- Post: 返回**新建普通对象**（Object.prototype 原型），键为各条目 key、值为各条目 value，属性经 CreateDataPropertyOrThrow 建立 ⇒ 均为自身可枚举数据属性；键重复时后者胜（仓内 `Object.keys` 输出无重复 ⇒ 不适用）；`"__proto__"` 键成为自身数据属性，无原型污染。
- Throw domain: 调用点域内不可抛；`merged` 值中不可序列化对象经 ：66 copySettings 最终把关（分离快照），fromEntries 本身不做值校验。
