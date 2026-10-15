---
fn: "client.ts:L27::invoke"
source: "client.ts"
line: 27
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-client-invoke-L27.md

## 综述

异步请求核心（client.ts:27-64，`async function`）。每次调用：先重放工厂期 `initialFailure`（client.ts:31）；否则构造含 accept 闭包的 request（client.ts:32-48），emit 到 `my-settings:service:v1`（client.ts:49），同步判定服务是否认领——未认领返回 `SERVICE_UNAVAILABLE` 安装提示（client.ts:50-55）——await 认领的 `observed`（client.ts:56），按 `SettingsResult` 形状返回（client.ts:57-58）；所有同步异常收敛为 `OPERATION_FAILED` 结构化失败（client.ts:59-60），finally 置 `closed`（client.ts:61-63）。

## 契约（调用者驱动）

调用者：client.ts:66-71 的六个入口箭头（直接调用，client.ts:66 即 `invoke({op:"query", ...})` 等）。

- 对调用者的 POST：返回 promise 恒 fulfilled，值为满足 protocol.ts:43 的 `SettingsResult`；绝不 reject、绝不同步抛（async 函数体异常全落 catch-all）。对任意实参成立（operation 形状校验在服务端 parseSettingsOperation，settings-service.ts:40）。
- 生态 PRE（本函数内不可闭合，已由原型确认为语义前提，arch/prototype.md §6「同步认领 Promise」）：bus 同步派发 handler 且 handler 同步 accept。真实链满足：event-bus.ts:15-17（EventEmitter.emit 同步派发）→ settings-service.ts:25,27,31,36,46,49（同步调用 accept）。若宿主注入异步派发的 bus：client.ts:50 判定时 `response` 仍 ⊥ ⇒ 恒返回 SERVICE_UNAVAILABLE；晚到的 accept 落入非选中诊断路径，仍 no-throw，但语义退化为"服务不可用"。
- 服务端 PRE：被接受的 promise 最终 settle 且解析为 SettingsResult 形状。不 settle ⇒ invoke 永久 pending（不抛不泄漏，但调用方悬挂）【unknown：悬挂义务由服务端/executor 批次闭合】；解析为垃圾（如 `{ok:false}` 无 `error`）⇒ client.ts:57 字段访问 TypeError → catch-all → OPERATION_FAILED（结构化，合规）；解析为 `{ok:true}` 无 `values` ⇒ client.ts:58 透传 `{ok:true, values:undefined}`——畸形成功透传，无抛出，记为服务端契约缺口（见总报告第 4 项）。

## 自身异常合同（逐路径）

- client.ts:31 `initialFailure` 重放：`settingsFailure` 安全（settings-error.ts:3-10 全程 try/catch）。
- client.ts:32-48 request 构造：对象字面量 + 闭包创建，不抛；accept 闭包自身安全（fn-client-accept-L36.md）。
- client.ts:49 `bus.emit`：外部边界。接口 protocol.ts:53 未承诺不抛；若同步 throw → client.ts:59 catch → `OPERATION_FAILED`。真实实现 event-bus.ts:15-17 不因 handler 异常逃逸抛出（safeHandler 捕获并 console.error，event-bus.ts:19-25），但该事实只作佐证不作前提。
- client.ts:50-55 未认领分支：`settingsFailure` 构造 SERVICE_UNAVAILABLE + 安装提示——对照 arch/prototype.md §6「服务不存在时返回安装提示，不把缺服务当作某来源没有值」✔（invoke 需返回结构化失败：满足）。
- client.ts:56 `await response`：`observed` 因内建 .catch 恒 fulfilled（client.ts:39-42，reaction 自身安全）⇒ await 不产生 rejection。
- client.ts:57 `returned.ok` / `returned.error.code` 字段访问：`returned` 为 null/undefined 或缺 `error` 时 TypeError → client.ts:59 → 结构化 OPERATION_FAILED（无泄漏）。
- client.ts:58 返回字面量：不抛。
- client.ts:59-60 catch-all：兜底上述一切同步异常（含 emit throw、字段访问 TypeError），体仅调 `settingsFailure`（安全）。
- client.ts:61-63 finally：`closed = true`，不抛。
- 全文件无 `throw`/`Promise.reject` 语句（grep 证实）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属于 JS 异常合同（open-questions.md），单独说明不算偏差。

对照 arch/prototype.md（client 侧四项）：无服务响应⇒结构化 SERVICE_UNAVAILABLE（client.ts:50-55 ✔）；晚到/重复 accept 不泄漏 unhandled rejection（client.ts:38-43 + reaction 安全 ✔）；初始 session 身份校验由工厂完成并在 L31 重放（✔，见 fn-client-createMySettingsClient-L14.md）；无 PARTIAL_SAVE（所用码 INVALID_REQUEST/SERVICE_UNAVAILABLE/OPERATION_FAILED ⊆ protocol.ts:35 联合 ✔）。

## 霍尔逻辑 SP

{P: 每次调用拥有独立 `response`/`closed` 帧（client.ts:28-29）；`initialFailure`/`session`/`sessionId` 为工厂期写定的只读闭包态（client.ts:15-17）；bus 满足 protocol.ts:52-55}
body: initialFailure ≠ ⊥ ⇒ return 重放 INVALID_REQUEST（client.ts:31）；否则构造 request、emit（client.ts:32-49）后分派：response=⊥ ⇒ return SERVICE_UNAVAILABLE（client.ts:50-55）；否则 await observed（client.ts:56），returned.ok ⇒ 透传 values（client.ts:58）、¬ok ⇒ 重放 error（client.ts:57）；任何同步异常 ⇒ return OPERATION_FAILED（client.ts:59-60）；finally closed := true（client.ts:62）
{Q: 返回 promise fulfilled 且值满足 protocol.ts:43；closed=true；进程无新增 unhandled rejection；无任何异常逃出函数体}

## 并发/异步义务

- 每次调用独立 `response`/`closed` ⇒ 并发 invoke 互不串扰；共享的 `session`/`sessionId`/`initialFailure` 在工厂期写定后只读（client.ts:15-17 读点 31/33/34），单线程 JS 下无竞态。
- `closed` 仅在 finally 置位（client.ts:62）：await 期间 `closed` 仍 false，此窗口内重复 accept 靠 `response !== undefined` 落选；返回后靠 `closed=true` 落选——双防线先后衔接（client.ts:38），无空窗。
- emit 抛出时 finally 仍执行 ⇒ 失败调用同样封死 request 复用。
- emit 抛出但 handler 已运行的罕见路径：`response` 已置而无人 await；因 observed 恒 fulfilled 无泄漏（细节见 fn-client-accept-L36.md）。
- 依赖 emit 同步派发（生态 PRE，见上）：判定 client.ts:50 与 emit client.ts:49 之间无让出点，同一宏任务内完成。
