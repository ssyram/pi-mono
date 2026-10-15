# external: values (Object.values)

- 来源引用点：json-settings.ts:13（`Array.isArray(value) ? value : Object.values(value)`）。
- kind：ECMAScript 内建静态函数。

## Pre
- 实参为对象（本调用点 value 已过 L6 对象过滤 + L9 普通性检查——非 null、非数组、原型 ∈ {Object.prototype, null} 的普通对象）。

## Post
- 返回实参**自有可枚举 string 键**属性的值数组（属性序：integer-like 键数值升序在前、其余按创建序）；不含 symbol 键、不含不可枚举属性——**该视野缺口即 checkValue 残余缺口的来源**（不可枚举循环属性/抛出性 toJSON 可过校验而 stringify 抛，copySettings 异常合同已记录）；不修改实参。

## 可否 throw-reject
- 普通数据属性对象不抛。
- **敌意对象可同步抛**：Proxy 的 ownKeys/getOwnPropertyDescriptor/get trap、抛出性 enumerable accessor 的 getter——checkValue 调用点按该失败模式建模（异常原样传播 = 拒绝信道的一部分，不假设掉危险）。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定）。
