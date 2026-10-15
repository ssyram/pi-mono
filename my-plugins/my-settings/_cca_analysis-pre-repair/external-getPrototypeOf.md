# external: getPrototypeOf (Object.getPrototypeOf)

- 来源引用点：json-settings.ts:8（`const prototype = Object.getPrototypeOf(value)`）。
- kind：ECMAScript 内建静态函数。

## Pre
- 实参为任意值（本调用点 value 已过 L6 对象过滤——非 null 对象）。

## Post
- 返回实参的 [[Prototype]]：对象 → 其原型（Object.prototype/类原型/null 等）；原始值 → 装箱后原型或 null（本调用点已排除）；不修改实参。

## 可否 throw-reject
- 普通对象/数组实参不抛。
- **敌意 Proxy 的 getPrototypeOf trap 可同步抛**——checkValue 调用点按该失败模式建模（异常原样传播 = 拒绝信道的一部分，不假设掉危险）。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定）。
