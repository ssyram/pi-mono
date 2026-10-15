---
fn: "extension.ts:L82::on"
source: "extension.ts"
line: 82
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-extension-on-L82.md

## 综述

`pi.on("session_shutdown", ...)` 注册的匿名箭头（extension.ts:82-84，构造于 mySettings 注册点 extension.ts:82）。体只有一条语句 `active = undefined`（extension.ts:83），复位于 mySettings 闭包共享的会话单元（extension.ts:12）。由宿主在会话关闭时派发（`emitSessionShutdownEvent`，packages/coding-agent/src/core/extensions/runner.ts:265-274；handler 逐个 await，runner.ts:1100-1121）。

## 契约（调用者驱动）

调用者：宿主生命周期派发（registered_as: op=session_shutdown，见 edges/fn-extension-on-L82.json；注册点 extension.ts:82）。

- 对派发方的 POST：同步返回、不抛、不产生诊断；幂等——重复派发只重复置 `active = undefined`。无返回值要求（handler 返回值被 runner 忽略，runner.ts:1103 仅对 session before-event 读取，session_shutdown 不属其列）。
- 对其余组件的全局 POST：派发完成后 `active === undefined` ⇒ resolver（extension.ts:18-21）对任何请求返回 `{ok:true, value:undefined}` ⇒ service handler 不 accept 直接返回（settings-service.ts:39） ⇒ 请求方 client 得到 SERVICE_UNAVAILABLE 安装提示（fn-client-invoke-L27.md client.ts:50-55）。即：shutdown 后本插件服务对该会话静默失效，无 SESSION_UNAVAILABLE 语义——这是设计内行为（client 侧把"无 accept"统一归为服务不可用）。
- PRE：无。handler 忽略 `(event, context)` 两个实参，对实参形状零要求。

## 自身异常合同（逐路径）

- extension.ts:83 `active = undefined`：对作用域内闭包变量（extension.ts:12 声明）的赋值，语言级不抛。无属性读取、无函数调用。
- 全函数无 `throw`/rejection 路径；不需要 try/catch 即满足 no-throw。
- 宿主派发层对 handler 异常的兜底（runner.ts:1111-1120 catch → emitError）存在，但按 extern-model 不作为前提——本 handler 体不可能抛，前提无需动用。
- 宿主灾难性 OOM/进程终止不属于 JS 异常合同（open-questions.md §其他），单独说明不算偏差。

## 霍尔逻辑 SP

{P: `active` 为 mySettings 闭包声明单元（extension.ts:12），本 handler 与 resolver/bind 共享它}
body: active := undefined（extension.ts:83）
{Q: active = undefined ∧ 无异常逃出 ∧ 无诊断输出；后续 resolver 调用必得 `value:undefined`（extension.ts:19 `!owner` 分支）}

## 并发/异步义务

- 单线程同步赋值：与 resolver（settings-service.ts:34 同步调用）、bind（同为主线程同步派发体）之间无撕裂窗口——任一 resolver 调用要么完全在 shutdown 前要么完全在后。
- 与在途异步请求的关系：shutdown 派发前已被 resolver 发出端口的在途 executor，其后调 isCurrent 得 `active === owner` 为 false（extension.ts:30）⇒ 各消费点先被 SESSION_UNAVAILABLE 拦下（settings-session-log.ts:18-20；writeSettingsFile/saveFileOnly 同门，见各自批次报告）；getBranch/appendEntry 端口本身无 active 守卫，但仓内无绕过 isCurrent 直调的路径。
- 顺序语义：shutdown 后若宿主再派发 session_start/session_tree，bind 会重新置 active（extension.ts:69）——本 handler 不注销任何注册、不阻止复活；复活正确性由 bind 与 resolver 的身份三元检查保证（fn-extension-bind-L67.md、fn-extension-registerMySettingsService-L16.md）。
