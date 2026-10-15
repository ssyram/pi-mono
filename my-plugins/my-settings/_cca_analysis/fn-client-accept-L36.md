---
fn: "client.ts:L36::accept"
source: "client.ts"
line: 36
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-client-accept-L36.md

## 综述

提取器条目 `client.ts:L36::accept` 是 invoke 在每个 request 对象字面量内构造的匿名方法 `accept(result)`（client.ts:36-47），随 request 经 `bus.emit(MY_SETTINGS_CHANNEL, request)` 派发（client.ts:49）；服务端 handler 同步调用它认领响应 promise（settings-service.ts:25 绑定、27/31/36/46/49 调用；entries.json 记为 externally driven entry）。职责：以"首次认领胜出"语义选中唯一响应（client.ts:38,43），并把每个传入 promise 包上恒安全的 rejection reaction（client.ts:39-42，即 client.ts:L39::catch）。

## 契约（调用者驱动）

调用者：服务端 handler（真实实现 settings-service.ts:L21::on；派发边见 edges/fn-settings_service-on-L21.json）。

- PRE：在 `bus.emit` 的同步派发窗口内被调用（真实链满足：event-bus.ts:15-17 同步 emit + handler 体无 await 即调用 accept，settings-service.ts:21-54）。可多次调用、可在 invoke 结束（closed=true）后调用。
- PRE：参数应为 `Promise<SettingsResult>` 或可被 `Promise.resolve` 包装的任意值；类型不作运行时校验（协议仅类型层约束，protocol.ts:49）。
- POST：恒同步返回 undefined，不向外抛出（见下）。
- POST：对同一次 invoke 至多一次被选中（`response === undefined` 判定，client.ts:38,43）；每个传入 promise 都挂接了 rejection handler ⇒ 任何调用时序（正常/重复/晚到）都不产生 unhandled rejection（arch/prototype.md §6 要求 ✔）。
- POST（选中时）：`response` 置为恒 fulfilled 的 `observed`（rejection 已转结构化失败），使 invoke 的 await 必然正常完成（client.ts:43,56）。

## 自身异常合同

逐语句（无任何向外 throw 路径）：

- client.ts:38 `!closed && response === undefined`：闭包变量读与比较，不抛。
- client.ts:39 `Promise.resolve(result)`：不执行用户代码的同步路径；thenable 解包由引擎内部完成，accessor 抛出转为 rejection 而非同步抛【unknown：ES Promise 机制未入 manifest externals，见总报告】；`.catch()` 挂接不抛。
- client.ts:40-41：reaction 体，自身安全（见 fn-client-catch-L39.md；premise：settings-error.ts:3-16 的 try/catch 全覆盖）。
- client.ts:43 赋值：不抛。
- client.ts:44-46 内层 try/catch：兜底调用 `reportSettingsError`（安全诊断）。按上述各步判定该 catch 实际不可达，属防御性冗余，不构成显式 throw 偏差（全文件无 throw/reject 语句，grep 证实）。

宿主灾难性 OOM/进程终止不属于 JS 异常合同（open-questions.md）。

## 霍尔逻辑 SP

{P: handler 在 emit 同步窗口内以任意 result 调用本闭包，次数 n ≥ 0；`closed`/`response` 为所属 invoke 帧变量（client.ts:28-29）}
body: selected := ¬closed ∧ response=⊥（client.ts:38）；observed := Promise.resolve(result).catch(安全 reaction)（client.ts:39-42）；selected ⇒ response := observed（client.ts:43）；任何内层异常 ⇒ reportSettingsError（client.ts:44-46）
{Q: 正常返回 undefined；`response` 保持 ⊥ 或为恒 fulfilled 的 promise；全局不新增 unhandled rejection；重复/晚到调用的 rejection 至多转化为 console 诊断}

## 并发/异步义务

- 正常时序：accept 在 emit 内同步执行 ⇒ invoke 在 client.ts:50 判定前 `response` 已定；这是 invoke 能区分"服务不可用"与"等待响应"的前提（client.ts:50-55）。
- 重复 accept：第二次起 selected=false；其 promise reject 仅诊断（client.ts:40），fulfil 静默丢弃。
- 晚到 accept（closed=true 后）：同上；无泄漏。
- 罕见路径：emit 抛出但 handler 已运行 ⇒ `response` 已置而 invoke 走 catch 返回（client.ts:59-60），`observed` 无人 await——因内建 catch 恒 fulfilled 无泄漏；但此时服务 promise 若 reject，诊断被跳过（selected=true ⇒ client.ts:40 不报告），失败信息随 invoke 的 OPERATION_FAILED 之外被丢弃。属诊断损失边缘情况，非 no-throw 违规。
- accept 与 finally 置 closed（client.ts:62）之间的窗口：await 期间 closed 仍 false，晚到 accept 靠 `response !== undefined` 落选；invoke 返回后靠 `closed=true` 落选——两个防线先后衔接（client.ts:38）。
