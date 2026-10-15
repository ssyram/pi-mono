# external: Set (new Set 构造器)

- 来源引用点：json-settings.ts:19（`checkValue(value, new Set())`）。
- kind：ECMAScript 内建构造器（无参调用形式）。

## Pre
- 无实参调用（本调用点恒为 `new Set()`，非 iterable 注入形式）。

## Post
- 返回全新的空 Set 实例（本征 Set——非子类实例：调用点未用 new.target 继承）；成员身份为 SameValueZero（对象按引用同一性判定）。

## 可否 throw-reject
- 无参构造不抛（除宿主灾难性 OOM/进程终止——extern-model 约定不算普通 JS 异常）。
