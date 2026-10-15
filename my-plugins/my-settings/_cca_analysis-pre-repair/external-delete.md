# external: delete (Set.prototype.delete)

- 来源引用点：json-settings.ts:14（`ancestors.delete(value)`）。
- kind：ECMAScript 内建方法。

## Pre
- receiver 为 Set 实例（本调用点 ancestors 为调用链私有的本征 Set）；实参为任意值（本调用点为非 null 对象）。

## Post
- receiver 中存在 SameValueZero 相等成员（对象 ⇔ 引用同一）→ 移除并返回 true；不存在 → 返回 false。仅移除该成员，不影响其余成员。

## 可否 throw-reject
- 本征 Set 上对任意实参不抛、无用户可覆写路径（接收方非敌意子类）。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定）。
