---
fn: "settings-kind.ts:L7::kindOf"
source: "settings-kind.ts"
line: 7
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_kind-kindOf-L7.md

## 综述

模块私有纯分类器（settings-kind.ts:7-12），唯一调用者 pickValidFields（settings-kind.ts:19）。四个全等/内建判定：`value === null`（:8）→ `"null"`；`Array.isArray(value)`（:9）→ `"array"`；`typeof value === "object"`（:10）→ `"object"`；否则返回 `typeof value`（:11，声明收窄为 `"boolean" | "number" | "string"`）。严格相等、typeof 运算符对任意值不抛；唯一可抛点是 `Array.isArray` 的 Proxy 边界（见自身异常合同）。无 try/catch——本函数的安全性靠"操作本身对声明域不抛"成立，属于全批中唯一无兜底的函数，故其 PRE 域是硬约束。

## 契约（调用者驱动）

调用者：仅 pickValidFields，settings-kind.ts:24（`kindOf(defaults[key])`）与 :26（`kindOf(actualRaw as SettingValue)`）。

- PRE（no-throw 的真实下界）：`value` 不是"target 已被撤销的 Proxy"（含以被撤销 Proxy 为 target 的 Proxy 链）。仓内调用域恒满足：`defaults[key]` 来自 copySettings 验证输出（json-settings.ts:79 JSON.parse 域，纯 JSON 值，无 Proxy）；`actualRaw = raw[key]` 中 raw 为 readSettingsFile 输出（settings-files.ts:30/34，同为 copySettings 域或 `{}` 字面量）或 readSessionPatches 产出（settings-session-log.ts:47 经 copySettings 复制）。Array.isArray 对这些值走 OrdinaryIsArray/数组分支，不进入 Proxy 递归（ES 规范仅当参数是 Proxy 时才解 target，target 已撤销时抛 TypeError）。
- POST：返回 `ValueKind` 六串之一（protocol.ts:6 的 null/boolean/number/string/array/object ↔ settings-kind.ts:5）。对声明域 `SettingValue` 恒在六串内。域外行为（不抛，但声明类型说谎）：`undefined` → 返回 `"undefined"`（:11 typeof 原样透出，cast 不改变运行时值）；函数 → `"function"`。两者在调用方 :27 均因 `actual !== expected` 被诊断丢弃（expected 由已验证 defaults 决定，恒属六串），不会把非法值放进 picked——类型说谎无害化，记为域边界注记，非偏差。

## 自身异常合同（逐路径）

- :8 `value === null`：严格相等，任意操作数不抛。**contained（总不抛）**。
- :9 `Array.isArray(value)`：ES `IsArray` 抽象操作。非 Proxy 参数（含数组、普通对象、原始值、null、revoked Proxy 之外的任意值）不抛；参数为 Proxy 且沿 target 链最终 target 已撤销 ⇒ 抛 TypeError，**本函数无 catch ⇒ 向外逃逸**。这是全函数唯一 throw 域；仓内两调用点的实参域（copySettings 输出）不可能出现 Proxy ⇒ 仓内域内不可达。若未来调用者传入任意 unknown 值，须由调用方兜底——pickValidFields 的整体 try（settings-kind.ts:20-36）恰好兜住该 TypeError ⇒ 组合仍 no-throw。
- :10-11 `typeof`：运算符，任意值不抛。**contained（总不抛）**。
- 全函数无 `throw`/`Promise.reject` 语句（settings-kind.ts:7-12 核实）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions.md §其他），单独声明。

对照 arch/prototype.md §1 `kind`：六类判据一致——null 特判、数组先于对象（数组也是 object，必须先判）✔；不跨类归并 ✔。

## 霍尔逻辑 SP

{P: value ∈ SettingValue ∪ {undefined, function}（仓内：copySettings 输出域，无 Proxy）}
body: value = null ⇒ return "null"（:8）；IsArray(value)（对仓内域不抛）⇒ return "array"（:9）；typeof = "object" ⇒ return "object"（:10）；☐ return typeof value（:11）
{Q: 返回 ∈ {"null","array","object","boolean","number","string","undefined","function"}；对声明域限定于前六种；无异常逃逸（仓内域）；无副作用（纯函数）}

## 并发/异步义务

- 纯同步纯函数：无 await、无共享可变状态、无闭包捕获 ⇒ 重入/并发零义务；单线程交错调用互不影响。
- 不创建 promise ⇒ 无 unhandled rejection 面、无悬挂义务。
