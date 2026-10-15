---
fn: "extension.ts:L16::registerMySettingsService"
source: "extension.ts"
line: 16
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-extension-registerMySettingsService-L16.md

## 综述

**真实构造**：传给 `registerMySettingsService(...)` 第 2 参的会话解析器匿名箭头 `(session, sessionId) => {...}`（extension.ts:16-59）；manifest 以被调函数命名（extension.ts:L16::registerMySettingsService），非独立具名函数。由 mySettings 在扩展加载期构造（extension.ts:14-62），被 service handler 在每次请求派发时**同步调用**（settings-service.ts:34）。

职责：把请求绑定的 `(session, sessionId)` 与扩展现役态 `active`（extension.ts:12）做三元身份核对；匹配则构造一次性 SettingsSession 端口对象（extension.ts:22-55：cwd 快照 + isCurrent/getBranch/appendEntry 三方法），否则返回 `undefined`（extension.ts:20）表示"非本会话/无现役会话"。全程 try/catch（extension.ts:17-58）。

## 契约（调用者驱动）

调用者：settings-service.ts:L21::on handler（直接同步调用 settings-service.ts:34；direct 边已录于 edges/fn-settings_service-registerMySettingsService-L14.json 与 callgraph）。

- 对调用者的 POST：同步返回 `SettingsOutcome<SettingsSession | undefined>`（settings-service.ts:16 的参数类型），**绝不抛**。
  - `{ok:true, value:undefined}`（extension.ts:20）⇒ handler 直接 return、**不 accept**（settings-service.ts:39）⇒ 请求方 invoke 判 SERVICE_UNAVAILABLE（fn-client-invoke-L27.md client.ts:50-55）。触发条件三选一：无现役会话（启动后未 bind、shutdown 后）、manager 实例不同（旧客户端在会话切换后仍持旧身份）、请求 sessionId ≠ bind 期捕获值。
  - `{ok:true, value:ports}` ⇒ ports 满足 protocol.ts:67-72；cwd 为**解析时刻快照**（extension.ts:25 读取一次），三端口闭包共享同一 `owner` const 与请求 `sessionId`，行为由各自 fn 文件定义（fn-extension-isCurrent-L26.md 等）。
  - `{ok:false, OPERATION_FAILED}` ⇒ handler 把该失败直接 accept 回请求方（settings-service.ts:35-37）。
- PRE（调用方义务，已由 handler 满足）：`session` 为非空非数组对象、`sessionId` 为非空字符串（settings-service.ts:26-33 先行校验）；在本 handler 的同步派发窗口内调用。

## 自身异常合同（逐路径）

- extension.ts:18 `const owner = active`：单元读取，不抛。
- extension.ts:19 三元比较：`owner.context.sessionManager !== session` 两跳属性读取 + 引用比较；对普通对象不抛，宿主注入访问器/Proxy 时可能抛 ⇒ :56 捕获。
- extension.ts:25 `owner.context.cwd`：属性读取（快照），同上；类型 plain string（types.ts:333）。
- extension.ts:22-55 端口对象与三个方法闭包的**构造**：对象字面量 + 闭包创建，不抛（方法体执行是后续事件，不属于本函数调用）。
- extension.ts:56-58 catch：`settingsFailure("OPERATION_FAILED", error)` 不抛（settings-error.ts:3-10）⇒ catch 不会二次抛出。
- 全函数无显式 `throw`；不依赖 Pi 兜底。宿主 OOM/终止非 JS 异常合同。

对照 arch/prototype.md：ensureCurrentSession 语义（§2）的"失效返回 Error，不能转用另一个会话"——本函数以 `undefined`（而非 Error）表达失效，由上层把"无 accept"归一为 SERVICE_UNAVAILABLE；**不发生**"转用另一会话"（身份不匹配即拒绝）✔；请求绑定当前 session 身份（§6）✔。

## 霍尔逻辑 SP

{P: active 为 mySettings 共享单元（extension.ts:12）；(session, sessionId) 已过 handler 形状校验（settings-service.ts:26-33）}
body: owner := active（:18）；¬owner ∨ owner.context.sessionManager ≠ session ∨ owner.sessionId ≠ sessionId ⇒ return {ok:true, value:undefined}（:19-21）；否则 return {ok:true, value:{cwd 快照 + 三端口}}（:22-55）；意外同步异常 ⇒ return {ok:false, OPERATION_FAILED}（:56-58）
{Q: 三种结构化返回之一；无异常逃出；ports 若返回则其行为仅依赖 owner/sessionId 闭包态，不隐式重读 active（除 isCurrent 内的显式现役裁决）}

## 并发/异步义务

- 全同步、无 await ⇒ 与 bind/shutdown/其他 resolver 调用之间原子；不会观察到"半初始化"的 active（bind 的赋值是单条语句 extension.ts:69）。
- **请求时点捕获**语义：每次请求独立调用本函数、独立构造 ports ⇒ 不存在跨请求的 owner 陈旧；唯一陈旧窗口在**单个请求的异步执行期**（resolver 之后 executor 仍可能在途），由 isCurrent 时刻谓词裁决（fn-extension-isCurrent-L26.md 并发节）。
- 身份三元检查与活体检查的分工（Batch A 义务 a 裁决）：本函数做**静态身份**（实例引用 + bind 期 id）；**活体身份**（同一实例 sessionId 就地改写，session-manager.ts:1713/:1745）留给 isCurrent 每次重读。两层缺一不可。
- ready 先行保证：bind 先置 active 再发 ready（extension.ts:69→74）⇒ 任何收到 ready 的外部消费方发来的请求必能通过本函数身份核对（同实例同 id）；本函数永不"看到 ready 但服务未就绪"。
