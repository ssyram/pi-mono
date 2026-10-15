---
function: client.ts:L15::invoke
source: {file: "client.ts", line: 15}
self_consistency: aligned
---

## 综述

消费者侧请求/响应握手的内层 async 闭包（client.ts:15-32）：为每次调用构造携带会话身份快照（工厂期解构的 `session`/`sessionId`）与 `accept` 回调（即 client.ts:L21::accept）的 SettingsRequest（client.ts:17-24），在 `my-settings:service:v1` 频道上同步 emit（client.ts:26）；emit 栈内有服务同步 accept（`response` 已置）则 await 该响应 Promise（client.ts:28），否则立即 resolve `SERVICE_UNAVAILABLE`（client.ts:27，message 含"please install and enable the my-settings plugin"安装提示）；emit 抛出或响应 Promise reject 一律折叠为 `OPERATION_FAILED`（client.ts:29-30）。返回的 Promise 永不 reject。

## 调用者驱动契约

callgraph 入边：`query/saveGlobal/saveLocal/saveSession → invoke`（callgraph.json:46-61，四个入口箭头的实调点）；`createMySettingsClient → invoke`（callgraph.json:38-41，extractor 把嵌套闭包调用归到工厂的伪影边——实调点全在四个箭头内，与 fn-settings_operation-parseSettingsOperation-L4.md:13 记录的同类归并机制一致）。测试范围外。

1. **四个入口箭头（client.ts:34-37，fn-client-query-L34.md:32-34 等已落盘期望）**：调它时已保证 operation = `{op, query|save}` 对象字面量（本函数不读其属性）；期望：返回 `Promise<SettingsResult>` 且**永不 reject**；把 operation 原样放进请求；失败语义以结构化结果表达——SERVICE_UNAVAILABLE（无同步 accept）/ OPERATION_FAILED（emit 抛错或响应 rejection），服务端各类错误码逐字透传（client.ts:28）。
2. **外部消费者（经四箭头，README:92/109）**："returns error results instead of throwing"；emit 期间无服务同步 acknowledge 时不挂起等待（extern-model 'Event bus dispatch'）。

## 契约

### Pre（调用前须成立）

- **无 UB 级前提**：request 对象在函数内构造、`operation` 仅作为属性值装入字面量（client.ts:20，无属性读取）——任意实参值在本函数内无异常路径；形状校验由服务端结构化拒绝（INVALID_REQUEST）。
- 功能前提（非 UB）：`bus` 须为宿主 EventBus（emit 同步派发语义，external-emit.md）——工厂期注入、非本函数 caller 义务。

### Post

- resolve `SettingsResult`，**永不 reject**（异常合同穷举见下）。resolve 值恰为三者之一：
  1. 服务 accept 传入的 Promise 的 resolve 值逐字透传（client.ts:28）——ok:true 或服务端任意错误码；
  2. `{ok:false, error:{code:"SERVICE_UNAVAILABLE", message:"my-settings service unavailable for this session; please install and enable the my-settings plugin."}}`（client.ts:27——emit 期间无任何 handler 同步 accept；满足 owner"缺服务提示安装、不默认值伪装成功"判据）；
  3. `{ok:false, error:{code:"OPERATION_FAILED", ...}}`（client.ts:29-30——emit throw 或响应 Promise reject）。
- emit 的请求携带工厂期身份快照与 accept（首记录语义：多次 accept 首个生效，client.ts:22 `??=`）。
- 无共享状态变异；不修改 operation。
- 敌意 handler accept 非 Promise 值：await 原样以该值 resolve（undefined → 走 no-response 分支得 SERVICE_UNAVAILABLE）——类型违约不产生 UB。
- 异常安全档：nothrow（结果以结构化错误表达）。

### 对 callee 的期望（下传 demand）

#### bus.emit（external-emit.md，本批补写）
- 调它时已保证：channel 为常量 "my-settings:service:v1"，data 为完整 SettingsRequest。
- 需要它保证：同步启动已注册 handler（在 L27 判定前完成同步 accept 窗口）；可能 throw（本函数以 L29 catch 兜住——**不得假设其恒成功**）。

#### settingsFailure（settings-error.ts:3，fn-settings_error-settingsFailure-L3.md）
- 调它时已保证：code 为字面量错误码、error 为提示文案串或捕获值。
- 需要它保证：恒返回 `{ok:false, error:{code, message}}` 且不抛——L27/L30 两出口的 nothrow 押在其 total 性上。

#### accept（本函数自定义的请求回调，manifest fn client.ts:L21::accept）
- 调它时已保证：由事件派发侧（服务 handler）调用；result 为其声明的响应 Promise。
- 需要它保证：同步首记录写入、自身不抛（其 fn 文档论证成立）。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **返回 Promise 永不 reject；无显式 throw**。逐条 source:line：
  - client.ts:16-24 request 构造：属性字面量 + accept 方法定义——无异常路径。
  - client.ts:22 accept 体 `response ??= result`：对 let 闭包变量的赋值，不抛（被服务同步调用时若外层 handler 抛，由服务侧 svc:91 含，不影响本函数栈）。
  - client.ts:26 `bus.emit(...)`：宿主派发，按外部前提可能同步 throw → **被 L29 catch**。
  - client.ts:27 `settingsFailure(...)`：total 不抛（其 fn 文档 L24-29 逐点论证）。
  - client.ts:28 `await response`：响应 Promise reject → **被 L29 catch**；await 非 thenable 值直接返回该值，不抛。
  - client.ts:30 `settingsFailure(...)`：不抛 → 折叠完成。
  - **未见捕获后仍外泄的路径**：L25-31 try 罩住全部可抛点；catch 内调用不抛。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（open-questions.md:27 约定单独注明）。

### 【服务/插件边界包含效果】

- invoke 自身即消费者侧边界：emit 抛错与响应 rejection 在 L29-30 内部折叠，调用方（四箭头/外部消费者）无需 catch——四箭头文档"永不 reject"的论证依据即本合同。
- SERVICE_UNAVAILABLE 路径满足 owner 特判据（缺服务 → 明确提示安装启用，不伪装成功）；被 accept 的 Promise 即使 reject 也折为结构化结果——无 unhandled rejection 逃逸。

## 并发

- `response` 为每次调用的局部闭包变量：并发多次 invoke 各自独立握手，互不交叉（fn-client-createMySettingsClient-L13.md:65 同款结论）。
- **[CONC] 同步 accept 窗口**：`bus.emit` 调用栈内（宿主 wrapper 在 handler 首个 await 前同步调用之，extern-model 'Event bus dispatch'）的 accept 决定 L27 分支；生产服务 handler 全同步（svc:73-96 无 await），accept 必在窗口内发生（若服务在场且认领）。窗口关闭后晚到的 accept 仅写入已废弃闭包变量（首记录 `??=` 丢弃后续），无可观察效果。
- **[CONC] 过期会话**：session/sessionId 为工厂期快照；会话替换/重绑定后服务端 resolveSession（ext:11 身份比较）不认领 → 不 accept → 本函数得 SERVICE_UNAVAILABLE——不会拿到错会话的结果。
- 无锁需求：单线程事件循环内，accept 写与 L27/28 读同一调用帧内串行。

## SP

- [L16] `response := undefined`。
- [L17-24] `request := {session, sessionId, operation, accept}`：构造无异常；accept 语义 = 首记录（`??=`）。
- [L25-26] 进入 try；`bus.emit(MY_SETTINGS_CHANNEL, request)`：宿主同步派发——每个已注册 handler 在其首个 await 前被调用，期间任何同步 accept 赋值 response。emit throw → [L29]。
- [L27] `!response`（含 handler accept 了 undefined 的敌意情形）→ return SERVICE_UNAVAILABLE（出口 A）。
- [L28] `return await response`：resolve → 原样返回（出口 B）；reject → [L29]。
- [L29-31] catch → return OPERATION_FAILED（出口 C）。
- 合流：A/B/C 均为 resolve SettingsResult，无 reject 出口。终止：单 await、无循环。Post 达成。

## [SELF] 前提（上传 caller）

- 无 UB 级前提需上传：四个 caller（入口箭头）与外部消费者无需任何附加保证——operation 任意形状由服务端结构化拒绝，bus 前提在工厂期已固定。
- 功能级（非 UB）：消费者须 await 返回值并检查 `.ok`（README:46-50）——违反只导致结果被弃，非 UB。

## 自洽

- 与四份 caller 文档期望（永不 reject、operation 原样入请求、SERVICE_UNAVAILABLE/OPERATION_FAILED 折叠、透传）逐条对齐。
- 与 on handler 的同步 accept 语义（fn-settings_service-on-L73.md:87 handler 全同步）闭合：emit 窗口内 accept 必然发生（服务在场且认领时），L27 的 no-response 分支对应"无服务/不认领"——README:117 与 extern-model 一致。
- 与 settingsFailure 的 total 性一致；无未消解假设 → aligned。
