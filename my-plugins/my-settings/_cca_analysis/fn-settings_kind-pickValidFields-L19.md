---
fn: "settings-kind.ts:L19::pickValidFields"
source: "settings-kind.ts"
line: 19
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_kind-pickValidFields-L19.md

## 综述

逐字段种类过滤器（settings-kind.ts:19-37）：以 defaults 的值种类为期望类型，从 raw 中挑出种类匹配的请求键，种类失配 ⇒ `reportSettingsError` 诊断后**只丢本来源该键**（:28-29），其余键与低优先级来源不受影响；最后经 `copySettings(picked)`（:33）二次验证输出。整体位于 try（:20-36），catch 调 `settingsFailure("OPERATION_FAILED", error)`（:35）。依赖 kindOf（已证仓域 no-throw）、reportSettingsError（已证无条件 no-throw）、copySettings（已证无条件 no-throw + ok 良构定理）。**任意实参域无条件 no-throw**，且 ok-结果良构——Batch C 对"pickValidFields ok-contract"的转发义务在此闭合。

## 契约（调用者驱动）

调用者（全仓 2 处，均在 settings-query.ts）：:15 `pickValidFields(path, defaults, raw.value)`（文件来源，loadFile 内）、:57 `pickValidFields(patch.source, validated.value, patch.values)`（session 补丁，executeSettingsQuery 内）。

- PRE（语义域）：`defaults` 为 Settings 对象（仓内恒为 copySettings 输出：settings-query.ts:30 `validated.value`）；`raw` 为对象（仓内两路均验证：raw.value 来自 readSettingsFile——copySettings 输出或 `{}` 字面量（settings-files.ts:31/34）；patch.values 来自 readSessionPatches 逐条 copySettings 复制（settings-session-log.ts:47-52））。⇒ 修正转发注记一处：raw 的容器原型是 **Object.prototype**（JSON.parse 输出），不是 null 原型；两形态皆为普通对象，`key in raw`（:23）在其上不抛。
- POST：`ok:true` ⇒ `value` 良构 Settings（copySettings ok 定理），且键集 ⊆ `Object.keys(defaults)`、每个值满足 `kindOf(value) === kindOf(defaults[key])` ✔ prototype.md §3 parseQuery（"只处理调用方请求的 key"；"一个 key 类型错误不影响其他合法 key"；"类型错误只取消这个来源的贡献"）。
- POST：`ok:false` ⇒ INVALID_REQUEST（copySettings 拒绝透传）或 OPERATION_FAILED（兜底 catch）。
- 对调用方的 always-settles：同步函数，返回即完成；loadFile（settings-query.ts:15-16）与 ：57 的 valid 均可安全解构。

## 自身异常合同（逐路径）

- :21 `{}` 字面量：不抛。
- :22 `Object.keys(defaults)`（external-keys）：参数非 object ⇒ TypeError ⇒ :34 catch **contained**；仓域 defaults 为对象 ⇒ 正常。
- :23 `key in raw`（external-has，`in` 运算符形态）：raw 为原始值 ⇒ TypeError ⇒ **contained**；仓域 raw 为普通对象 ⇒ 普通属性查找不抛。原型链可见性注记：`in` 沿原型链——defaults 若含 `"toString"` 类 Object.prototype 内建名，raw 无自身该键时 `in` 为真、`raw[key]` 取到继承函数 ⇒ kindOf 得 `"function"` ∉ 六种期望 ⇒ :27 失配 ⇒ 诊断+丢弃（函数值**不可能**进入 picked，因 expected 恒属六种而 `"function"` 不等价任何期望）。与 prototype"containsKey"的自身键语义仅在病理键名上多出一条诊断，无值泄漏，记域注记非偏差。
- :24/:26 `kindOf(...)`：仓域（copySettings 输出）无 Proxy ⇒ no-throw（fn-settings_kind-kindOf-L7.md）；若未来传入被撤销 Proxy ⇒ TypeError ⇒ :34 **contained**。
- :27 比较：不抛。
- :28 `reportSettingsError`：无条件 no-throw（fn-settings_error-reportSettingsError-L12.md），且其外仍有 try 兜底（双重防护）。诊断文案含 `${source}`/`${key}`/`${expected}`/`${actual}` 插值——source 为调用方传入的 path/`session log #n` 字符串 ✔。
- :31 `picked[key] = actualRaw`：picked 为新建普通对象，值恒为 JSON 域（raw 域保证）⇒ 不抛。
- :33 `copySettings(picked)`：无条件 no-throw ✔；ok ⇒ 良构（Batch C 闭合点：executeSettingsQuery :58 将 valid.value 展开进 overlay、:66 再整体验证，最终 `detached.ok ? {ok:true, values: detached.value}`（settings-query.ts:67）——链条上每个 ok 值都过本函数/copySettings ⇒ client.ts:58 无 `{ok:true, values:undefined}` 透传）。
- :34-36 catch：settingsFailure no-throw。
- 全文件无 `throw`/`Promise.reject`（settings-kind.ts 核实）⇒ 无显式偏差。
- 宿主灾难性 OOM/终止不属 JS 异常合同，单独声明。

对照 arch/prototype.md §3：失配诊断后 `continue`（本来源该键）✔；不存在的 key 不报错不补默认（:23 `continue` 静默）✔；默认值不在此填充（本函数不碰 defaults 值本身，合并与默认注入在 executeSettingsQuery）✔。

## 霍尔逻辑 SP

{P: defaults ∈ Settings 对象域（仓内：copySettings 输出）；raw ∈ 普通对象域（仓内：copySettings 输出 ∪ {}）；source 任意}
body: picked := {}（:21）；for key ∈ Object.keys(defaults)：key ∉ dom(raw)（:23，含自身键语义近似）⇒ skip；kindOf(defaults[key]) ≠ kindOf(raw[key]) ⇒ diagnose（:28，no-throw）+ skip；☐ picked[key] := raw[key]（:31）；return copySettings(picked)（:33，全域 no-throw，异常亦被 ：34 折叠）
{Q: 返回 {ok:true, value: 良构 Settings ∧ keys ⊆ keys(defaults) ∧ ∀key kindOf(value[key])=kindOf(defaults[key])} ∨ {ok:false, code∈{INVALID_REQUEST, OPERATION_FAILED}}；∀实参无异常逃逸；副作用 ⊆ {每失配键至多一条 console.error}}

## 并发/异步义务

- 纯同步：picked 为调用帧局部，defaults/raw 只读 ⇒ 重入/并发零义务；单线程下交错调用互不影响。
- 不创建 promise ⇒ 无悬挂/unhandled rejection 面。
