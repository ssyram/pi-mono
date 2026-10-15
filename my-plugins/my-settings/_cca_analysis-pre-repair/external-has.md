# external: has (Set.prototype.has)

- 来源引用点：json-settings.ts:7（`if (ancestors.has(value))`）。
- kind：ECMAScript 内建方法。

## Pre
- receiver 为 Set 实例（本调用点 ancestors 为 copySettings L19 `new Set()` 的本征 Set，递归内同一实例透传）；实参为任意值（本调用点为非 null 对象）。

## Post
- 返回 boolean：receiver 中存在 SameValueZero 相等的成员（对象 ⇔ 引用同一）→ true；否则 false。无副作用、不修改集合。

## 可否 throw-reject
- 本征 Set 上对任意实参不抛、无用户可覆写路径（接收方非敌意子类——调用点构造形式排除）。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定）。
