---
fn: "settings-error.ts:L3::settingsFailure"
source: "settings-error.ts"
line: 3
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_error-settingsFailure-L3.md

## 综述

模块级纯工厂（settings-error.ts:3-10）：把任意 `error: unknown` 折叠为 `SettingsFailure` 形状（protocol.ts:37-40）。`message` 初值 `"Unknown settings error"`（:4）；try 块（:5-8）内经 `instanceof Error` 取 `.message`、否则 `String(value)` 折叠为字符串；catch 为空（:8，吞掉一切）；返回字面量 `{ ok: false, error: { code, message } }`（:9）。try 外只有 ：4 的字符串初始化与 ：9 的对象字面量，均不可抛。**对任意实参域无条件 no-throw**——这是 Batch A（client late/duplicate-accept barrier）赖以成立的无第二兜底前提，本文件形式化证毕（见自身异常合同）。

## 契约（调用者驱动）

调用者：全仓生产代码的通用失败构造器。代表性调用点（含本批）：settings-error.ts:14（reportSettingsError）、settings-service.ts:27/31/49/62/67、client.ts:22/25/31/41/51/60、settings-query.ts:35/44、settings-files.ts:14/19/23/31/36/55/65/79/83、settings-operation.ts:16/22/27/37/52/59/78、settings-session-log.ts:20/27/56、extension.ts:33/43/51/57。无外部宿主派发角色。

- PRE：`code` 为 protocol.ts:35 联合内的字符串（调用方义务）；`error` 为**任意** JS 值——本函数对 `error` 无任何前置要求（见下：全部异域被 ：8 contain）。
- POST：恒返回满足 protocol.ts:37-40 的对象：`ok === false`、`error.code` 透传、`error.message: string`（:4 初值或 ：7 的字符串分支结果，二者皆 string）。永不返回 `ok:true`，永不抛出、永不返回非对象。
- POST（对 Batch A 转发前提）：本函数 no-throw 是 client.ts:39-42 reaction 与 client.ts:44-46 内层兜底"自身安全"的必要条件；此处证明其为**无条件下界**（不依赖 caller catch）。

## 自身异常合同（逐路径，异域清单）

try 外（不可抛）：settings-error.ts:4（字符串字面量）、:9（对象字面量）。

try 内逐构造，对每个可设想 throw 域给出归属：

- :6 `error instanceof Error`：
  - `error` 为原始值（string/number/symbol/null/undefined/bigint）⇒ OrdinaryHasInstance 立即 false，不抛。
  - `error` 为 Proxy 且 `getPrototypeOf` 陷阱抛出 ⇒ TypeError 在 ：6 抛出 ⇒ 被 ：8 捕获，message 保持初值。**contained**。
  - 宿主篡改 `Error[Symbol.hasInstance]` 为抛出函数 ⇒ 调用时抛 ⇒ :8 捕获。**contained**。
  - `error` 为 Error 子类实例且 `message` 定义为 throwing getter ⇒ instanceof 通过、:6 的 `error.message` 触发 getter 抛出 ⇒ :8 捕获。**contained**。
- :7 `typeof value === "string"`：typeof 运算符对任何值不抛。**contained（总成立）**。
- :7 `String(value)`（external-String.md）：ToPrimitive(value, hint=string) 依次尝试 `Symbol.toPrimitive`（抛出/返回 object ⇒ TypeError）、`toString`、`valueOf`（抛出 ⇒ 传播）：全部 ⇒ :8 捕获。**contained**。具体域：
  - Symbol（含 describer）：`String(symbol)` 是合法的显式转换 ⇒ 返回 `"Symbol(desc)"`，不抛（与 `"" + symbol` 不同）。**contained 且产出消息**。
  - Proxy（get 陷阱抛出或返回 bogus toString）：ToPrimitive 触发陷阱抛出 ⇒ :8 捕获。**contained**。
  - 循环自名/Symbol.toPrimitive 返回对象：ToPrimitive 归约失败 ⇒ TypeError ⇒ :8 捕获。**contained**。
  - 普通对象/数组/null/undefined/number/boolean：标准折叠，不抛。
- 全文件无 `throw`/`Promise.reject` 语句（settings-error.ts 全文 16 行核实）⇒ 无显式偏差。

结论：**不存在任何使本函数向外抛出的实参域**；每个候选 throw 点都落于 ：8 空 catch，message 退回 `"Unknown settings error"`。JS 合同内【unknown】为空集；宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions §其他），单独声明不算偏差。

对照 arch/prototype.md §2 `reportError`/错误输出教义：失败只能成为结构化 SettingsFailure ✔（本函数即该形状的构造器）。

## 霍尔逻辑 SP

{P: code ∈ protocol.ts:35；error ∈ 任意值域 V（含 Proxy/getter/Symbol/toPrimitive 病态对象）}
body: message := "Unknown settings error"（:4）；try：value := (∈Error ⇒ error.message ☐ error)（:6，任何异常 ⇒ 中止 try，message 保持初值）；∈string ⇒ message := value ☐ message := String(value)（:7，任何异常同前）；return {ok:false, error:{code, message}}（:9）
{Q: 返回值满足 protocol.ts:37-40 ∧ message: string ∧ ∀error∈V 无异常逃逸 ∧ 无副作用（纯函数，不改任何外部状态）}

## 并发/异步义务

- 纯同步、纯函数：无共享可变状态、无 await、无闭包捕获 ⇒ 重入/并发无义务；同一线程任意交错调用互不影响。
- 异步义务为零：不创建 promise、不订阅 reaction ⇒ 不产生 unhandled rejection 面。Batch A 的 accept-barrier 因此只需依赖 client 侧 reaction，本函数侧无悬挂/泄漏义务。
