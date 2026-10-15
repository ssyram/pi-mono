---
fn: "settings-query.ts:L65::map"
source: "settings-query.ts"
line: 65
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_query-map-L65.md

## 综述

提取器条目 `settings-query.ts:L65::map` 是 `Object.fromEntries(Object.keys(validated.value).map((key) => [key, merged[key]]))`（settings-query.ts:65）中的匿名箭头 `(key) => [key, merged[key]]`，提取器以调用点 callee `map` 命名（open-questions.md §提取器覆盖核查 条目 5）。语义：把 defaults 键集投影到合并结果上——即 arch/prototype.md §4 `pickKeys (keys defaults) combined`（prototype.md:184）。箭头体仅两个操作：普通对象属性读 `merged[key]` 与二元数组字面量构造；无 try/catch，但其安全不靠兜底而靠**域构造保证**：读的每个 key 都来自 `Object.keys(validated.value)`，而 merged 由 ：64 的对象展开从 validated.value 起步构造，故每个被读键都是 merged 的**自身属性**——普通属性读 + 数组字面量在干净宿主上不可抛（下证）。宿主为 Array.prototype.map 注入钩子属环境篡改域，单独声明。

## 契约（调用者驱动）

调用者：唯一，`Array.prototype.map` 在 settings-query.ts:65 被 executeSettingsQuery 调用（fn-settings_query-executeSettingsQuery-L19.md）；每元素恰一次、同步回调，返回值仅被外层 `Object.fromEntries` 消费。

- PRE（由 :30-31 与 ：64 结构性满足，非约定）：`key` ∈ `Object.keys(validated.value)`（copySettings ok 输出 ⇒ JSON.parse 域 ⇒ 自身可枚举字符串键，无 symbol、无访问器）；`merged` 为 ：64 新建普通对象且 `Object.keys(validated.value) ⊆ 自身键集(merged)`（展开首项即 validated.value）。**无 revoked-Proxy PRE 负担**：validated.value 过了 :30 copySettings 的域闸（JSON 域无 Proxy），global/local/overlay 均为 copySettings 输出或其展开——箭头域内不存在 Proxy。
- POST：返回二元数组 `[key, merged[key]]`；不修改 merged/validated/global/local/overlay 任何状态（纯读）。

## 自身异常合同（逐路径）

- `merged[key]`：merged 为 ：64 对象字面量展开的新建普通对象（Object.prototype 原型）。被读键恒为自身属性（见 PRE）⇒ 普通属性读，**不触发原型链查找**——即使宿主毒化 Object.prototype 上某键为抛错访问器，自身属性命中短路，读不到原型访问器；无 getter 执行、无 Proxy ⇒ 不抛。**contained（总不抛，域内）**。
- `[key, merged[key]]` 数组字面量：构造不抛（内存耗尽属宿主灾难域）。
- 回调对 map 的附加实参（value, index, array）全部忽略 ⇒ 无害。
- 回调自身无 `throw`/`Promise.reject`（settings-query.ts:65 核实）。若其抛出，异常会同步传入 `Array.prototype.map` 再传入 async 帧 executeSettingsQuery 转为 rejection——**仓域不可达**（上文两操作域内不可抛），仅环境篡改（毒化的 `Array.prototype.map` 或对象原型注入）可达：【unknown：宿主原型污染】不判偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions.md §其他）。

## 霍尔逻辑 SP

{P: key ∈ keys(validated.value)（map 的数组源保证）；merged 为新建普通对象 ∧ keys(validated.value) ⊆ dom_own(merged)（:64 展开顺序保证）}
body: return [key, merged[key]]（自身属性读 + 字面量，均不抛）
{Q: 返回 [key, merged[key]] 且不修改任何捕获变量；无异常逃逸（仓域）；每 key 恰调用一次（Array.prototype.map 契约）}

## 并发/异步义务

- 纯同步纯读回调：无 await、无共享可变态 ⇒ 单线程下 map 逐元素调用天然串行，零并发义务。
- 不创建 promise ⇒ 无 unhandled rejection 面、无悬挂义务。
