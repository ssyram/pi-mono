---
fn: "extension.ts:L26::isCurrent"
source: "extension.ts"
line: 26
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-extension-isCurrent-L26.md

## 综述

resolver 构造的 SettingsSession 端口方法（extension.ts:26-35，对象字面量成员，extension.ts:22-55）。同步返回当前请求会话是否仍然"现役"：`active === owner && owner.context.sessionManager.getSessionId() === sessionId`（extension.ts:30）。try/catch 包裹（extension.ts:27-34），失败收敛为 `settingsFailure("OPERATION_FAILED", error)`。

## 契约（调用者驱动）

调用者：service 侧经 SettingsSession 抽象调用（extern-model §Event bus dispatch）。仓内真实调用点：executeSettingsQuery（settings-query.ts:33,42）、appendSessionSettings（settings-session-log.ts:18）、writeSettingsFile（settings-files.ts:53,63）、saveFileOnly（settings-save.ts:26，经 `isCurrent.bind(session)` 取_port）。全部约定：先调 isCurrent，`!ok` 或 `value:false` 即放弃后续端口调用。

- 对调用者的 POST：同步返回 protocol.ts:42 的 `SettingsOutcome<boolean>`，绝不抛、绝不返回 undefined。
  - `{ok:true, value:true}` ⇒ **时刻谓词**，非租约：仅断言"此刻" active 仍指向本请求的 owner 且活体 sessionId 仍等于请求 sessionId。调用方不得在后续 await 之后继续视为有效（见并发节）。
  - `{ok:true, value:false}` ⇒ 调用方返回 SESSION_UNAVAILABLE（如 settings-session-log.ts:20）。
  - `{ok:false}` ⇒ OPERATION_FAILED 结构化失败，调用方原样上抛为失败响应。
- PRE：owner 是 resolver 期捕获的非空 const（extension.ts:18）——由 resolver 契约保证（fn-extension-registerMySettingsService-L16.md）；`sessionId` 是请求绑定的字符串。

## 自身异常合同（逐路径）

- extension.ts:30 `active === owner`：引用比较，不抛（active 为闭包单元，extension.ts:12）。
- extension.ts:30 `owner.context.sessionManager`：两跳属性读取。owner 非空 const；对普通对象属性读取不抛；若宿主注入 Proxy/访问器则可能抛 ⇒ 被 extension.ts:32 捕获。
- extension.ts:30 `getSessionId()`：外部方法。原生证据：纯字段返回（packages/coding-agent/src/core/session-manager.ts:1152-1154），真实实例上不抛；接口上按可失败外部边界对待（extern-model.md:18）⇒ try/catch → `settingsFailure("OPERATION_FAILED")`（extension.ts:32-34）。settingsFailure 自身不抛（settings-error.ts:3-10，全程内部 try/catch）。
- 全函数无显式 `throw`；唯一逃逸口（外部 getSessionId 抛）已闭合。不依赖 Pi 兜底。
- 宿主灾难性 OOM/进程终止不属于 JS 异常合同，不作为偏差。

## 霍尔逻辑 SP

{P: owner = resolver 捕获 const（extension.ts:18，非空）；sessionId = 请求绑定串；active 为共享单元；owner.context.sessionManager 满足 ReadonlySessionManager（types.ts:335；session-manager.ts:245-262）}
body: b := (active === owner ∧ owner.context.sessionManager.getSessionId() === sessionId)（extension.ts:30）；外部 getSessionId 抛 ⇒ settingsFailure(OPERATION_FAILED)（extension.ts:32-34）
{Q: 返回 {ok:true, value:b} 或 {ok:false, error.code=OPERATION_FAILED}；无异常逃出；b=true 仅当"此刻"身份双条件同时成立}

## 并发/异步义务

- 全同步、无 await ⇒ 单线程下求值原子：结果不会反映"求值中途"的 bind/shutdown 交错。
- 双条件各自的存在理由（Batch A 转办义务 a 的裁决）：
  - `active === owner`（extension.ts:30 前半）：捕捉 manager **实例被替换**——bind 每次派发重建 active（extension.ts:69）、shutdown 清空（extension.ts:83）。
  - `getSessionId() === sessionId`（extension.ts:30 后半）：**非冗余**。原生证据：同一 SessionManager 实例的 `this.sessionId` 可被就地改写（session-manager.ts:1713 与 :1745，branch/label 恢复路径重写会话身份）。即"同一实例、身份已变"只能靠活体重读捕捉。
- TOCTOU 义务（向调用方）：true 不担保下一次端口调用仍 true。若调用方在 isCurrent 与后续端口之间插入 await，期间可发生 session 切换或就地 id 改写。仓内消费点全部同步紧邻使用（appendSessionSettings 的 isCurrent→copy→appendEntry 无 await，settings-session-log.ts:18-25），义务已闭合；新增消费方必须维持此纪律。
- capture-after-await：端口闭包持有请求时的 `owner`/`sessionId`，永不重读 active 之外的活体状态——过期检测完全依赖本函数，故本函数是唯一现役裁决点。
