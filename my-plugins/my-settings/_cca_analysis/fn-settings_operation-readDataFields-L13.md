---
fn: "settings-operation.ts:L13::readDataFields"
source: "settings-operation.ts"
line: 13
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_operation-readDataFields-L13.md

## 综述

模块私有同步信封字段读取器（settings-operation.ts:13-29）：对任意 `unknown` 的 `value`，先做非空对象守卫（:15），再对调用方给定的键逐一 `Object.getOwnPropertyDescriptor(value, key)`（:20，external-getOwnPropertyDescriptor，只读**自身**描述符、**不执行 getter**），访问器属性（get/set）⇒ 结构化 INVALID_REQUEST（:21-22），数据属性取 `descriptor?.value`（键缺失 ⇒ undefined）；整体 try（:14-25）+ catch 调 `settingsFailure("INVALID_REQUEST", error)`（:27，已证无条件 no-throw，fn-settings_error-settingsFailure-L3.md）。返回 `{ok:true, value: fields}`（:25）。**任意实参域无条件 no-throw**（下证）；唯一调用者 parseSettingsOperation（settings-operation.ts:33/:39，fn-settings_operation-parseSettingsOperation-L31.md）。

## 契约（调用者驱动）

调用者（全文件 2 处，均 parseSettingsOperation）：:33 `readDataFields(value, ["op","query","save"])`（信封层）、:39 `readDataFields(op === "query" ? envelope.value.query : envelope.value.save, ["globalPath","localPath","scope","defaults","values"])`（载荷层）。

- PRE：`value` 为**任意** JS 值（service 侧实参 = `"operation" in data ? data.operation : undefined`，settings-service.ts:40，宿主任意域）；`keys` 为可迭代对象（仓内恒为字面量 `readonly string[]`）。两参均无 no-throw 前置约束（见自身异常合同）。
- POST（ok 良构）：`ok:true` ⇒ `value` 是**新建普通对象**（字面量，Object.prototype 原型），自身键集恰为 `keys`（插入序），每键值 = 输入对象该键的**自身数据属性值**（不问 enumerable/writable），键缺失时为 `undefined`。**值是别名不是拷贝**——深别名由调用方 :61/:68 的 copySettings 快照截断，不外泄。
- POST（错误映射）：`ok:false` ⇒ 恒 `INVALID_REQUEST`、message: string。两类拒绝：非非空对象（:15-17，含数组）、键含访问器（:21-22）。
- 访问器语义要点：读取走 gOPD 描述符路径，**从不通过 `value[key]` 触发 getter**（:23 取 `descriptor.value`）——与 arch/prototype.md §2 `validateValues`"不执行业务提供的方法"同向；协议信封层即拒绝访问器（更具体的错误文案），嵌套值的访问器再由 copySettings 拒绝（json-settings.ts:43-47）。

## 自身异常合同（逐路径）

- :15 `!value || typeof value !== "object" || Array.isArray(value)`：`!`/typeof 对任意值不抛；`Array.isArray`（external-isArray）对仓内任意域不抛，唯被撤销 target 的 Proxy 链抛 TypeError（与 fn-settings_kind-kindOf-L7.md 同一 PRE 类）⇒ 落 ：26 catch ⇒ **contained**。
- :19 `for (const key of keys)`：keys 不可迭代 ⇒ TypeError ⇒ **contained**（仓域恒数组字面量，不可达）；迭代器协议若被宿主篡改（`Array.prototype[Symbol.iterator]` 注入）属环境篡改域，同样落 :26。
- :20 `Object.getOwnPropertyDescriptor(value, key)`（external-getOwnPropertyDescriptor）：value 已被 ：15 收敛为非空对象 ⇒ 原始值 TypeError 不可达；Proxy 的 `getOwnPropertyDescriptor` 陷阱抛出或返回非法值（reporter）⇒ **contained**；普通对象不抛、不执行 getter。
- :21 `descriptor?.get || descriptor?.set`：descriptor 为宿主新建的普通 PropertyDescriptor 对象或 undefined；其属性读取不抛（若 Proxy 陷阱返回的对象本身又是带抛陷阱的 Proxy——环境篡改域 ⇒ **contained**）。
- :23 `fields[key] = descriptor?.value`：fields 为新建普通对象，key 为字符串 ⇒ OrdinarySet 不抛。
- :25 返回字面量：不抛。
- :26-28 catch：仅 settingsFailure，无条件 no-throw ⇒ catch 链不可能二次逃逸。
- 全文件无 `throw`/`Promise.reject` 语句（settings-operation.ts 核实）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions.md §其他），单独声明。

## 霍尔逻辑 SP

{P: value ∈ 任意值域 V；keys ∈ 可迭代域（仓域：string 字面量数组）；settingsFailure 全域 no-throw（已证）}
body: 守卫 :15（∉ {非空对象} ⇒ return INVALID_REQUEST）；for key ∈ keys：descriptor := gOPD(value, key)（自身、无 getter 执行；异常 ⇒ catch）；descriptor 有 get/set ⇒ return INVALID_REQUEST（:21-22）；☐ fields[key] := descriptor?.value（:23）；return {ok:true, value:fields}（:25）；catch ⇒ settingsFailure(INVALID_REQUEST, error)（:27）
{Q: 返回 SettingsOutcome；ok ⇒ value 为新建普通对象、键集=keys、值为输入自身数据属性值或 undefined；∀value∈V, ∀keys 无异常逃逸；副作用：无（纯读取，不触发任何用户代码）}

## 并发/异步义务

- 纯同步：fields 为调用帧局部，value 只读（gOPD 不改可变属性）⇒ 重入/并发零义务。
- 不创建 promise ⇒ 无 unhandled rejection 面、无悬挂义务。
- 两次调用（:33 信封、:39 载荷）相互独立、无共享态；"envelope double-read" 之间 input 对象可被并发改写的窗口为零（同一同步段内完成）。
