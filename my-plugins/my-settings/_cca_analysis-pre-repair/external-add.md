# external: add (Set.prototype.add)

- 来源引用点：json-settings.ts:12（`ancestors.add(value)`）。
- kind：ECMAScript 内建方法。

## Pre
- receiver 为 Set 实例（本调用点 ancestors 为调用链私有的本征 Set）；实参为任意值（本调用点为非 null 对象——L6 已过滤）。

## Post
- 把实参加入 receiver（已存在则幂等）；返回 receiver 自身（本调用点不链式使用）。集合大小只增不减（删除由 delete 承担）。

## 可否 throw-reject
- 本征 Set 上对任意实参不抛、无用户可覆写路径（接收方非敌意子类）。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定）。
