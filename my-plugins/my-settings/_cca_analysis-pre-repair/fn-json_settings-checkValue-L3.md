---
function: json-settings.ts:L3::checkValue
source: {file: "json-settings.ts", line: 3}
self_consistency: aligned
---

## 综述

私有递归 JSON 值校验器（json-settings.ts:3-15，模块内非导出）：深度优先遍历值树，确认每个节点是 JSON 原始值（null/string/boolean/有限 number）或普通对象/数组（数组不验原型；对象原型须为 Object.prototype 或 null），并以路径集（ancestors）拒绝引用环；违规即 throw 拒绝，全部通过则返回 undefined（TS 断言 `asserts value is SettingValue` 成立）。唯一外部 caller 为 copySettings（json-settings.ts:19），其余调用边为 L13 自递归（SCC 大小 1，callgraph.json:102-105）。

## 调用者驱动契约

callgraph 入边（2 条）：`json-settings.ts:L17::copySettings → checkValue`（L19 顶调，callgraph.json:106-109）；`checkValue → checkValue` 自递归（L13，callgraph.json:102-105）。非导出函数，无独立模块导出 caller。

1. **copySettings（L19 顶调，fn-json_settings-copySettings-L17.md:63-65 已落盘期望）**：调它时已保证：value 为 L18 已验的**非 null 非数组对象**；ancestors 为每次调用新建的**空 Set**（`new Set()`，本函数独占、调用后即弃——不与其他调用共享）。期望（拒绝信道，stringify 安全性押在其上）：对含循环/非 JSON 值/非普通嵌套对象的树**以 throw 拒绝，绝不静默通过**；合法树正常返回且**不修改 value**；返回后（常规路径）value 可被 JSON.stringify 安全序列化。已知残余（copySettings 文档明示接受，非 demand 违约）：校验视野为自有可枚举值（不可枚举循环属性/抛出性 toJSON 的缺口）+ 递归深度无界。
2. **自递归（L13）**：调它时已保证：item 为 L13 迭代产出的子值（数组元素或 Object.values 的自有可枚举值——任意 unknown）；ancestors 为含当前路径对象的同一 Set（value 已 add）。期望：即本函数自身契约（同 SCC，普通阶段两侧契约一致即 aligned）。

## 契约

### Pre（调用前须成立）

- value：**任意值可被穷举处理，无 UB 级前提**（顶调由 copySettings L18 保证非 null 非数组对象；递归调用传入任意子值，由 L4-6 分支过滤）。敌意对象（Proxy/抛出性 getter）按 throw 拒绝信道处理，非 UB。
- ancestors：**Set 实例**（TS 签名保证；顶调为空 `new Set()`，递归为含当前路径的同一实例）；**独占所有权**——调用期间不被调用链以外的代码读写，调用后顶调即弃。**[SELF]（就地消解）**：copySettings L19 每次新建并独占，满足。
- **[SELF]（就地消解——残余记录）递归深度在 JS 栈限内**：L13 递归无深度上限，超深嵌套输入 → RangeError（Maximum call stack size exceeded）传播——敌意输入残余，全部包内调用点经 copySettings 的包含路径折叠为结构化错误（copySettings [SELF]#1 已上传至其各 caller）；本函数不再新增上传。
- 敌意输入残余按拒绝信道处理（非 UB）：Proxy trap 抛出、抛出性 getter、超深——均归异常合同（见下），不消解为"成功"。

### Post

- **成功**：返回 undefined；TS 断言成立——value 整树满足：节点 ∈ {null, string, boolean, 有限 number（NaN/±Infinity 被拒）} ∪ 数组（任意原型）∪ 原型 ∈ {Object.prototype, null} 的普通对象；**无路径环**（路径集语义：任意"后代→祖先"引用链被 L7 拒绝；非环的共享子树/DAG 允许——同一对象可被兄弟分支重复校验）；**value 未被修改**（本函数只读 value，ancestors 为私有工作集）；ancestors 对称清空（add/delete 恢复进入时状态）。
- **失败**：同步 throw（拒绝信道），四类固定文案 + 原生异常：
  - `"Settings must contain JSON values only"`（L6）——undefined/function/symbol/bigint/NaN/±Infinity；
  - `"Settings must not contain cycles"`（L7）——当前路径环；
  - `"Settings objects must be plain JSON objects"`（L10）——非数组且原型 ∉ {Object.prototype, null}（类实例/Date/Map 等）；
  - 敌意对象原生异常：L8 `Object.getPrototypeOf` 的 Proxy getPrototypeOf trap 抛出、L13 `Object.values` 的 ownKeys/get trap 或抛出性 enumerable accessor getter 抛出——原样传播；
  - 超深嵌套 → RangeError 传播（非校验文案，仍走 throw 信道）。
  - throw 路径上 ancestors 非对称（沿途 add 未及 delete）——**无后果**：顶调 caller（copySettings L19）在 throw 时即弃该 Set，无跨调用状态。
- 无副作用：无 I/O、无全局可变状态、不改入参对象。异常安全档：nothrow-guarantee 等价（完整成功或干净 throw，无部分产物）。
- **残余缺口（非本函数违约，copySettings 异常合同明示接受）**：校验视野为自有可枚举值（L13 `Object.values`）——不可枚举的循环属性、抛出性 `toJSON`（stringify 无视 enumerability）可溜过校验 → copySettings L20 stringify throw（服务边界折叠）。本函数不为此背书"stringify 恒不抛"。

### 对 callee 的期望（下传 demand）

#### Number.isFinite（L5；external-isFinite.md，本批新建）
- 调它时已保证：实参 typeof 为 "number"（L5 短路已验）。
- 需要它保证：有限数值（含 -0）→ true；NaN/±Infinity → false；恒不抛、无副作用。

#### Object.getPrototypeOf（L8；external-getPrototypeOf.md，本批新建）
- 调它时已保证：value 为非 null 对象（L6 已过滤）。
- 需要它保证：返回原型对象或 null；不修改实参；普通对象/数组不抛——敌意 Proxy 的 getPrototypeOf trap 可能抛（按拒绝信道记录，不假设掉危险）。

#### Array.isArray（L9/L13；external-isArray.md，已存在）
- 需要它保证：恒返回 boolean（内部槽判定，含跨 realm 数组）；任意输入不抛、无副作用。

#### Set.prototype.has / add / delete（L7 / L12 / L14；external-Set.md + external-has.md + external-add.md + external-delete.md，本批新建）
- 调它们时已保证：receiver 为顶调传入的 Set 实例；实参为对象值（L7/12/14 均在 L6 对象过滤之后）。
- 需要它们保证：SameValueZero（对象 = 引用同一性）成员语义；has → boolean、add → 返回该 Set（重复添加幂等）、delete → boolean；对对象元素不抛、无用户可覆写路径（接收方非敌意子类——顶调 `new Set()` 构造本征 Set）。

#### Object.values（L13；external-values.md，本批新建）
- 调它时已保证：value 为非 null 对象（L6），且普通性已过 L9（数组走另一分支）。
- 需要它保证：返回**自有可枚举 string 键**属性值数组（属性序）；不改实参；普通对象不抛——敌意对象（Proxy ownKeys/get trap、抛出性 enumerable accessor getter）可能抛（按拒绝信道记录）。

#### checkValue 自身（L13 自递归）
- 需要它保证：即本契约（拒绝信道 + 不修改 value + 路径集维护对称）；深度以"当前路径对象数"为度量、环检查阻断路径重复 → 对有限结构终止（超深输入以 RangeError 显式失败，不无限递归）。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **可能向外 throw**（同步；无 try/catch——全部直接上浮）。逐条 source:line：
  - json-settings.ts:6 `throw new Error("Settings must contain JSON values only")`——**显式 throw（设计拒绝信道）**。
  - json-settings.ts:7 `throw new Error("Settings must not contain cycles")`——**显式 throw（设计拒绝信道）**。
  - json-settings.ts:10 `throw new Error("Settings objects must be plain JSON objects")`——**显式 throw（设计拒绝信道）**。
  - json-settings.ts:8 `Object.getPrototypeOf(value)`——敌意 Proxy getPrototypeOf trap 抛出 → **未捕获 callee 传播**。
  - json-settings.ts:13 `Object.values(value)`——敌意 Proxy ownKeys/get trap、抛出性 enumerable accessor getter → **未捕获 callee 传播**。
  - json-settings.ts:13 递归深度超栈限 → RangeError → **未捕获传播**。
  - L5 Number.isFinite / L9 Array.isArray / L7/12/14 Set 方法（本征 Set）：常规不可达 throw（各 external 文档）。
- 无 reject 形态（同步函数）。三处显式 throw 与 copySettings/parseSettingsOperation/readSessionSettings 同类：owner 标准下的偏差，但为**设计中**的拒绝信道，包内路径全部被包含折叠（见下）——svc:58 双重校验等"校验幂等"用法依赖该信道存在。

### 【服务/插件边界的包含效果】

- 本函数**非导出**——无"独立 caller 无包含"路径；全部 throw 经唯一 caller copySettings（其内亦无 try）上浮至四个包内调用点（copySettings fn 文档【服务/插件边界的包含效果】节已穷举）：
  - files:30（readSettingsFile）→ execute svc:34-37 或 files:41 → rejection 通道 → svc:89 → **OPERATION_FAILED**（"非法文件不覆盖"依赖校验失败在 stringify 前中止）；
  - parseSettingsOperation L26/31 → svc:88（on handler try 内）→ svc:91 → **INVALID_REQUEST**；
  - readSessionSettings L15 → svc:39 裸调 → svc:89 → **OPERATION_FAILED**；
  - execute svc:58 → svc:56-63 try 内 → **PARTIAL_SAVE / OPERATION_FAILED**（该调用点输入已双重校验，实际不可达 throw）。
- **边界内零逃逸**；代价：错误码随折叠点分化（INVALID_REQUEST / OPERATION_FAILED / PARTIAL_SAVE），message 保留原始校验文案（可诊断）。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明；超深输入引发的是普通 RangeError，属上列传播，非宿主灾难）。

## 并发

无：纯同步函数、无 await；`ancestors` 为调用链局部 Set（顶调每次新建、递归内私有传递、退出对称删除）；无模块级/全局可变状态、无 I/O；并发调用互不干扰（各自独立 Set 与 value 树）。

## SP

记 D(v) = 以 v 为根的子树深度，P = 调用链当前路径上的对象集合（= ancestors 内容）。

- **入口不变量（ESTABLISHMENT）**：顶调（copySettings L19）：value 为非 null 非数组对象，ancestors = ∅ = P；递归调用：item ∈ 父对象子值，P = 父调用路径集（父已 add 自己）。
- [L4] `value === null ∨ typeof value ∈ {string, boolean}` → return（出口 R：JSON 原始值通过）。
- [L5] `typeof value === "number" ∧ Number.isFinite(value)` → return（出口 R；有限 number 通过——含 -0）。
- [L6] 其余：typeof ∈ {undefined, function, symbol, bigint, number(NaN/±Inf)} → throw 出口 A（"…JSON values only"）。**附注：`value === null` 不可达（L4 已 return null）——dead check，无行为影响。** 合流后不变量：value 为非 null 对象。
- [L7] `ancestors.has(value)`（SameValueZero 引用同一性）→ true ⇔ value 已在当前路径上 = 环 → throw 出口 B（"…must not contain cycles"）。合流后不变量：value ∉ P。
- [L8-11] `prototype := getPrototypeOf(value)`（敌意 trap → 出口 D：原生异常传播）；`¬Array.isArray(value) ∧ prototype ≠ Object.prototype ∧ prototype ≠ null` → throw 出口 C（"…plain JSON objects"）。合流后不变量：value 为数组 ∨ 普通对象（原型 Object.prototype 或 null）。
- [L12] `ancestors.add(value)`：P' = P ∪ {value}。
- [L13] 对每个子值 item（数组 → 元素按序；普通对象 → `Object.values(value)` 的自有可枚举值按属性序；敌意 trap/getter → 出口 D）递归 checkValue(item, ancestors)：
  - **循环不变量（PRESERVATION）**：每次子调用前后 P 不变（子调用对称 add/delete）；任一子调用 throw → 直接上浮（出口 A/B/C/D/F）。
  - **INTERIOR**：子调用的入口不变量成立（item 任意值可处理、P 为当前路径）。
  - **度量（终止性）**：递归深度 ≤ 当前路径对象数 + 子树剩余深度；环被 L7 阻断（路径上对象不重复压入）→ 对有限结构必终止；**深度无上限**——D 超过 JS 栈限 → RangeError（出口 F）传播。
- [L14] `ancestors.delete(value)`：P 恢复 = 进入时（对称性——仅成功路径；throw 路径残留无后果：顶调 Set 即弃）。
- **Post 达成**：出口 R（顶调返回时）⇔ 全树遍历完成 → value 为 SettingValue 树、无路径环、未修改；出口 A/B/C（校验拒绝）、D（敌意原生异常）、F（RangeError）→ throw（Post 失败分支穷举）。终止：见 L13 度量；无循环体（for...of 有界迭代）。

## [SELF] 前提（消解记录与上传清单）

1. **（就地消解）顶调 value 为非 null 非数组对象**——copySettings L18 守卫；递归 value 任意值由本函数分支穷举。不须上传。
2. **（就地消解）ancestors 为独占的新建 Set**——copySettings L19 `new Set()`；独占性由构造点与"调用后即弃"保证。不须上传。
3. **（就地消解——残余记录）递归深度在 JS 栈限内**——L13 递归无上限，超深 → RangeError；敌意输入残余，包内全部调用点经 copySettings 包含路径折叠为结构化错误（copySettings [SELF]#1 已把同一前提上传至 readSettingsFile / parseSettingsOperation / readSessionSettings / execute 的调用点）；本函数非导出，无新增上传目标。
4. 敌意对象（Proxy/抛出性 getter）按拒绝信道记录于异常合同——不消解为成功，不假设掉危险。

## 自洽

- 与唯一 caller copySettings 的 demand（fn-json_settings-copySettings-L17.md:63-65）逐条对齐：拒绝信道（三类固定文案 + 敌意/超深传播）、不修改 value、返回后常规路径可安全 stringify（残余缺口由其异常合同明示接受）——无矛盾。
- 与 pre 临时版骨架一致并补全：SP 全量、[SELF] 标注、并发、自洽节；临时版结论（三类 throw、RangeError、敌意原生异常、dead check）均保留且细化。
- 自递归两侧契约同源（SCC 大小 1）——无 peer 分歧。三处显式 throw 为设计拒绝信道、包内全包含（copySettings 文档边界节），svc:58 幂等用法自洽 → aligned。
