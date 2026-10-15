---
fn: "json-settings.ts:L4::copySettings"
source: "json-settings.ts"
line: 4
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-json_settings-copySettings-L4.md

## 综述

同步深拷贝验证器（json-settings.ts:4-84）：把任意 `unknown` 折叠为「结构化失败」或「经过验证的纯 JSON Settings 快照」。整体位于 try（:5-83），catch 只调 `settingsFailure("INVALID_REQUEST", error)`（:82，fn-settings_error-settingsFailure-L3.md 已证无条件 no-throw）。内部算法：null 原型 holder（:9）+ `ancestors: Set`（:10）+ 显式 `pending` 栈（:11-16，**纯迭代无递归**），逐节点做种类检查（:26-35）、环检测（:37）、普通对象原型检查（:39-42）、访问器/序列化钩子拒绝（:43-49）、数组 length/孔洞检查（:54-67）、可枚举字符串键复制（:68-72），最后 `JSON.parse(JSON.stringify(holder.root))` 归一化往返（:79）。**无任何向外 throw 路径**（下证），且 ok-结果有严格良构性定理——这是 Batch C 转发义务的闭合点：client.ts:58 的 `{ok:true, values:undefined}` 透传缺口在本函数（及组合它的 pickValidFields/readSettingsFile/parseSettingsOperation/appendSessionSettings/readSessionPatches/executeSettingsQuery）侧被证明不存在。

## 契约（调用者驱动）

调用者（全仓 7 处）：settings-operation.ts:61/:68（请求 defaults/values 入口验证）、settings-files.ts:30（readSettingsFile）、settings-files.ts:47（writeSettingsFile 的 patch 验证）、settings-kind.ts:33（pickValidFields）、settings-query.ts:30/:66（executeSettingsQuery 的 defaults 验证与最终快照）、settings-session-log.ts:21/:47（appendSessionSettings 与 readSessionPatches 逐条验证）。

- PRE：`value` 为**任意** JS 值（无前置约束——所有病态域见下节，均被 ：82 contain）。
- POST（良构性定理，Batch C 义务）：`ok === true` ⇒ `value` 是 `JSON.parse` 输出：对象键为字符串、容器为 Object.prototype 普通对象或真数组、叶子 ∈ {null, boolean, 有限 number, string}；无符号键、无访问器、无 toJSON、无循环、无 undefined/function/bigint/symbol/NaN/±Infinity、无孔洞、`__proto__` 为自身数据属性（无原型污染）。因此消费方读 `result.value.xxx` 得到的恒是 JSON 域值；executeSettingsSave 把 `save.values`（未经 copySettings 的原始输入）与 `patch.value` 区分后，`{ok:true, values: save.values}`（settings-save.ts:47/51）回传的虽是原对象，但该路径的 well-formedness 由本函数在 ：47 的前置验证（`!patch.ok` 即弃，settings-files.ts:48）保证——**不存在 ok:true 而 values 非良构的通路**。
- POST：`ok === false` ⇒ `error.code === "INVALID_REQUEST"` 且 message: string。

## 自身异常合同（逐路径，全值类清单）

try 外：:9 `Object.create(null)`、:10 `new Set()`、:11-16 数组字面量——均不抛。

try 内逐构造：

- :6 `!value || typeof value !== "object" || Array.isArray(value)`：逻辑运算 + typeof 不抛；Array.isArray 对仓内"顶层任意输入"域**可抛**（被撤销 target 的 Proxy，见 fn-settings_kind-kindOf-L7.md 分析）⇒ 抛出落 ：82 ⇒ **contained**。
- :18 `pending.pop()` / :53,:62,:70 `pending.push(...)`（external-pop/external-push）：数组端点操作不抛（内存耗尽属宿主灾难，另行声明）。
- :21-24 leave 帧：typeof 判定 + `ancestors.delete(item)`（external-delete）：Set.delete 任意参数不抛。
- :26-31 叶子判定：`item === null` / typeof / `Number.isFinite(item)`（external-isFinite，静态方法对 number 实参不抛；此处 item 已被 typeof 收敛为 number）不抛。NaN/±Infinity 落 else ⇒ :34-35 结构化拒绝 ✔。
- :34-35 非 object 叶子（undefined/function/bigint/symbol）⇒ `settingsFailure` 不抛 ⇒ **contained（return）**。
- :37 `ancestors.has(item)`：Set.has 不抛；环 ⇒ 结构化拒绝 ✔。
- :38 `Array.isArray(item)`：同 ：6，Proxy 病态域 ⇒ :82 **contained**。
- :39 `Object.getPrototypeOf(item)`（external-getPrototypeOf）：对含 `__proto__` 访问器魔改的对象可抛（`setPrototypeOf` 陷阱）⇒ :82 **contained**。
- :40-42 非数组且原型 ∉ {Object.prototype, null} ⇒ 拒绝：类实例/Map/Date/RegExp/ boxed 值全部挡在门外 ✔（prototype.md §2 validateValues"不执行业务提供的方法"）。
- :43 `Object.getOwnPropertyDescriptors(item)`（external-getOwnPropertyDescriptors）：Proxy 陷阱抛出 ⇒ :82 **contained**。
- :44-47 遍历 `Object.values(fields)`（external-values）拒绝一切 get/set 描述符——**含不可枚举与 symbol 键**（gOPD 域是全部自有权属）：仓域内不抛（描述符是宿主新建的普通对象），**contained（return）**。
- :48-49 `fields.toJSON?.value` 拒绝自身字符串键 `toJSON` 为函数：挡掉 JSON.stringify 钩子；symbol 键 toJSON 本就不被 stringify 咨询，且会被 symbol 丢弃规则排除（见下）。不抛。
- :50-52 新容器 + `ancestors.add(item)`（external-add）：不抛。
- :55-57 数组 length：读**自身** `fields.length?.value`；要求 number ∧ `Number.isSafeInteger` ∧ 0 ≤ length ≤ 0xffffffff（external-isSafeInteger）。2^32-1 = 4294967295 恰为上界且远小于 2^53-1 ⇒ isSafeInteger 判真；length 非法 ⇒ 结构化拒绝。**contained（return）**。
- :59-67 逐下标：`fields[index]` 缺失即孔洞 ⇒ 拒绝（:61）✔（`new Array(n)` 类稀疏数组必被挡）；合法下标帧入栈。下标超出 length 的自有权属被忽略 ✔（与 JSON 序列化域一致）。
- :69-71 `Object.entries(fields)`（external-entries）：**只回字符串键** ⇒ symbol 键数据属性被静默丢弃（不复制）——与 JSON.stringify 域一致 ✔；`descriptor.enumerable` 过滤不可枚举字符串键 ✔。
- :74-75 赋值：parent 恒为本函数新建的 null 原型对象或新数组（可扩展、无访问器），key 恒为 "root"/规范化下标/字符串键 ⇒ OrdinarySet 不抛；键名 `"__proto__"` 落在 null 原型容器上成为**自身数据属性**，无原型污染 ✔。
- :79 `JSON.stringify(holder.root)`（external-stringify）：规范 throw 域仅三类——(a) 循环结构：拷贝树是树（每容器恰一父，环在 ：37 已拒）⇒ 不可能；(b) bigint：:34-35 已拒 ⇒ 不可能；(c) 宿主篡改 `Array.prototype.toJSON`/`Object.prototype.toJSON` 使 Get 命中可抛钩子——**环境篡改域，非本源码可致**，【unknown：宿主原型污染】单独声明。lone surrogate 由 ES2019 well-formed stringify 转义不抛。**clean host 下不可能 throw**。
- :79 `JSON.parse(...)`（external-parse）：入参是 stringify 输出，恒为合法 JSON ⇒ 不抛（`__proto__` 键经 CreateDataProperty 成自身属性，不触原型 setter）。
- :81-82 catch：仅调 settingsFailure，无条件 no-throw。
- 全文件无 `throw`/`Promise.reject` 语句（json-settings.ts 全文核实）⇒ 无显式偏差。
- 栈深义务：**无递归**——pending 是显式堆栈，帧数 O(节点数)（每容器 1 leave 帧 + 每子 1 帧），调用栈深度恒定 ⇒ 任意深嵌套不栈溢出；规模上限是堆内存（宿主灾难域，单独声明）。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同。

往返语义注记（:79 的可观察归一化，均不破坏良构性）：null 原型容器 → Object.prototype 容器；-0 → 0；不可枚举/symbol 键消失；共享子树（DAG）被展开为独立副本（环才拒绝，DAG 合法，test settings-no-throw.test.ts:80 佐证）。全部无害。

对照 arch/prototype.md：§2 `validateValues`"检查并取得合法 JSON 数据快照；不执行业务提供的方法，不把非法值悄悄转成合法值" ✔（访问器/toJSON/非普通原型一律拒绝而非绕过）；§1 Value 六类 ✔。

## 霍尔逻辑 SP

{P: value ∈ 任意值域 V；settingsFailure 全域 no-throw（已证）；clean host（无原型篡改）}
body: 顶层守卫（:6）∉ {非 null 对象} ⇒ return INVALID_REQUEST；否则迭代 pending：每个容器节点依次过 种类/环/原型/访问器/toJSON/length/孔洞 七道闸，任一不过 ⇒ return INVALID_REQUEST（各闸自身异常均落 :82）；叶子仅收 null/bool/有限 number/string；拷贝树构造完成后 holder.root 是「只含 JSON 值的无环树」；stringify∘parse（:79）在该不变式上不抛
{Q: 返回满足 {ok:true, value: 良构 Settings} ∪ {ok:false, INVALID_REQUEST, message:string}；∀value∈V 无异常逃逸；输出为全新对象图（无别名泄漏：输入与输出不共享任何可变对象）}

## 并发/异步义务

- 纯同步、无 await、无共享模块态（holder/ancestors/pending 均为调用帧局部）⇒ 重入/并发零义务；同一输入重复调用互不干扰。
- 不创建 promise ⇒ 无 unhandled rejection 面、无悬挂义务（Batch C 的"always settles"对同步函数平凡成立：返回即完成）。
- 【unknown】宿主对 `Array.prototype`/`Object.prototype` 的 toJSON 注入可使 :79 stringify 偏离——属环境篡改，仓内不可控，不判偏差。
