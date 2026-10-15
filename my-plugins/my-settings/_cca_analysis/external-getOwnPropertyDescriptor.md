# external-getOwnPropertyDescriptor.md

`Object.getOwnPropertyDescriptor`（单数形式；区别于 copySettings 使用的复数 `getOwnPropertyDescriptors`）。

- Sites: settings-operation.ts:20 `Object.getOwnPropertyDescriptor(value, key)`（readDataFields 的信封/载荷字段读取，同文件 :33/:39 两处调用共享）。
- Pre: 第一实参须为 Object（含函数）；null/undefined/原始值 ⇒ TypeError——settings-operation.ts:15 守卫已把 value 收敛为非空对象 ⇒ 该域不可达。第二实参经 ToPropertyKey（仓内恒为字符串字面量，无用户代码）。
- Post: 返回该键的**自身**属性描述符（宿主新建普通对象：{value,writable,enumerable,configurable} 或 {get,set,...}）或 undefined（键不存在）。**从不执行 getter**——读取的是描述符而非 `value[key]` 的 Get，与 arch/prototype.md §2「不执行业务提供的方法」同向；enumerable=false 的自身数据属性同样被读到（readDataFields 不问 enumerable，与 copySettings 只取可枚举的复制语义不同——信封校验语义，非偏差）。
- Throw domain: 普通 OrdinaryGetOwnProperty 不抛；Proxy 目标 ⇒ 触发 `getOwnPropertyDescriptor` 陷阱，陷阱抛出或返回非法值（reporter）⇒ TypeError ⇒ settings-operation.ts:26 catch **contained**。
