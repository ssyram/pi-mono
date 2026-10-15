---
fn: "client.ts:L39::catch"
source: "client.ts"
line: 39
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-client-catch-L39.md

## 综述

提取器条目 `client.ts:L39::catch` 是匿名 Promise reaction 箭头 `(error: unknown) => {...}`（client.ts:39-42）：由 accept 闭包在 `Promise.resolve(result).catch(...)` 挂接，不是具名方法。输入 promise rejected 时它把 reason 转成结构化 `OPERATION_FAILED` 失败并作为 `observed` 的 fulfil 值；若该次 accept 未被选中（晚到/重复/closed 后，client.ts:38），额外经 `reportSettingsError` 输出诊断（client.ts:40）。

## 契约（调用者驱动）

调用者是 JS Promise 机制本身（reaction 调度），唯一人类调用点是挂接处 client.ts:39（构造者 client.ts:L36::accept）。

- PRE：reaction 被调度 ⇒ 输入 promise 已 rejected，reason 可为任意值（服务端可 accept 任意 rejected promise，settings-service.ts:46）。
- POST：reaction 正常完成，返回值恒为 `{ok:false, error:{code:"OPERATION_FAILED", message:string}}` 形状（client.ts:41 + settings-error.ts:3-10）；`observed` 恒 fulfilled。

## 自身异常合同

reaction 体内任何异常都会使派生 promise `observed` rejected——这是本文件唯一没有二次兜底的 rejection 屏障。逐语句：

- client.ts:38 引用的 `selected` 是 accept 同步执行时刻求值的闭包捕获 boolean，reaction 内只读，不抛。
- client.ts:40 `reportSettingsError`：settings-error.ts:12-16 整体包在 try/catch，`console.error` 在 try 内 ⇒ 自身不向外抛（安全诊断通道；【premise】settings-error.ts:L12::reportSettingsError 的专属 no-throw 报告由其所属批次出具，本文件按其实现判定为安全）。
- client.ts:41 `settingsFailure`：settings-error.ts:3-10，消息化在 try/catch（settings-error.ts:5-8，`String(value)` 的失败被吞为默认消息），返回对象字面量 ⇒ 不抛（【premise】settings-error.ts:L3::settingsFailure 同上）。

结论：无向外 throw/reject 路径。若上述两个 premise 失效：选中路径的 rejection 会被 invoke 的 await→catch 转结构化（client.ts:56, 59-60），非选中路径将成为 unhandled rejection——即"晚到/重复 accept 不泄漏 unhandled rejection"的保证（arch/prototype.md §6、extern-model.md Event bus dispatch）承重于此 reaction 的 no-throw 性质。

边界：Promise 挂接与 reaction 调度按 ES 语义不向挂接方同步抛；Promise.resolve 对 thenable 的解包中 accessor 抛出转为 rejection 而非同步抛【unknown：ES Promise 机制未列入 manifest externals，见总报告第 (3) 项】。

宿主灾难性 OOM/进程终止不属于 JS 异常合同（open-questions.md），此处若发生则任何契约均失效，单独说明不算偏差。

## 霍尔逻辑 SP

{P: reaction 被调度 ⇒ 输入 promise rejected 且 reason ∈ 任意值；`selected` 已在 accept 同步体内固定（client.ts:38）}
body: ¬selected ⇒ reportSettingsError(reason)（安全诊断，client.ts:40）；恒 return settingsFailure("OPERATION_FAILED", reason)（client.ts:41）
{Q: reaction 正常完成且返回值满足 SettingsFailure（protocol.ts:37-40）⇒ `observed` fulfilled，fulfil 值即该返回值}

## 并发/异步义务

- 每次 accept 调用各自挂接独立 reaction 与独立 `observed`，多个并存互不影响（client.ts:39 在 accept 体内，随调用重复执行）。
- `selected` 在 accept 同步体内求值后不再变化；reaction 异步触发时不重读 `closed`/`response`（client.ts:38-43），无 TOCTOU 窗口。
- 非选中路径的 rejection 只产生诊断不产生结构化返回（client.ts:40-41 的返回值被丢弃）——诊断语义：晚到/重复失败可见于 console，不影响任何 invoke 结果。
