---
function: extension.ts:L19::bind
source: {file: "extension.ts", line: 19}
self_consistency: unknown
---

## 综述

生命周期回调，同时注册给 `session_start` 与 `session_tree`（extension.ts:30-31）：把当前会话上下文记入闭包变量 `active`（替换旧 owner，实现会话/分支切换时的所有权转移），并同步向 `my-settings:ready:v1` 频道广播 ready 事件（携带 sessionManager 引用与会话 id），供外部消费者此后开始查询。失败时复位 `active` 并降级为 console.error 诊断，不向外抛。

## 调用者驱动契约

### Pi 宿主（extension runner；extern-model 'Pi lifecycle dispatch'；注册点 extension.ts:30-31）
- 前提：宿主在会话启动/分支树变化时以 (event, context) 调用。无 UB 级前提——`context` 为任意值（含 null）时 extension.ts:21 的属性读取 throw 被 L24 catch。
- 功能前提：`context` 应为本次事件的 ExtensionContext；`getSessionId()` 返回值被信任为当前会话 id（对外部 API 的期望，非 caller 前提）。
- 期望：返回后不向外抛；成功时 `active` 已指向新 owner 且 ready 已广播；失败时 `active` 已复位、已输出诊断。

## 异常合同

### 函数自身
- 不向外 throw。无显式 throw。L20-23 try 全覆盖，L24-28 catch 收尾。

### 逐操作清单（source:line）
- extension.ts:21 `context.sessionManager.getSessionId()`：external（external-getSessionId.md），可 throw → L24 捕获。
- extension.ts:23 `pi.events.emit(MY_SETTINGS_READY_CHANNEL, ready)`：external（external-emit.md）。宿主把扩展 handler 包装为 safe handler（extern-model），但 owner 标准不得依赖该隔离：若 ready 消费者的同步异常穿透 emit → L24 捕获。
  **确认风险**：此时 L25 会把 L21 刚建立的 `active` 复位——一次无关的消费者异常会静默禁用本会话的整个服务（后续请求 no-accept → 客户端 SERVICE_UNAVAILABLE）。可见路径缺少"区分 emit 派发失败与自身失败"的 guard，记为缺失（unknown）。
- extension.ts:26 `settingsFailure`：no-throw。
- extension.ts:27 `console.error`：双包 try（L27）。
- 宿主灾难性 OOM / 进程终止：不在合同内。

### 服务/插件边界的包含效果
bind 由宿主 runner 派发，宿主另有 safe-handler 日志兜底；本函数不依赖之（owner 标准）。包含后的效果：诊断输出 + `active=undefined` → 服务对所有请求 no-accept → 客户端结构化 SERVICE_UNAVAILABLE（不伪装成功）。

## 契约（霍尔逻辑）

### Pre
- 无 UB 级前提（见上）。

### Post
- 成功路径：`active = {context, sessionId: <L21 getSessionId() 快照>}`（替换旧 owner；旧 owner 的 isCurrent 经 `active === owner`（extension.ts:14）自动失效）；ready 事件已同步派发至 `my-settings:ready:v1`，载荷 `{session: context.sessionManager, sessionId: active.sessionId}`；不抛。
- 失败路径：`active === undefined`；已输出 `[my-settings] <message>` 诊断；无 ready 广播；不抛。

### 对 callee 的期望
#### getSessionId（external）
- 调它时已保证：context.sessionManager 为宿主提供的活动会话管理器。
- 需要它保证：返回当前会话 id；可同步 throw（本函数已含）。
#### emit（external-emit.md）
- 调它时已保证：频道常量与 SettingsReady 载荷形态。
- 需要它保证：同步启动该频道已注册消费者；是否隔离消费者同步异常为 unknown（见确认风险）。
#### settingsFailure（repo）
- 需要它保证：no-throw、结构化失败。

## 并发
- `active`：[W] L21、L25。事件循环串行；bind 同步执行、无 await。
- L23 的 emit 同步运行 ready 消费者（在 bind 返回前）——消费者代码在 bind 的调用栈内执行；若宿主派发语义允许同步重入（消费者再触发 session_start 等），`active` 后写胜出——宿主语义上不应发生，unknown。
- 在途的 service execute 操作不受本次重绑影响，靠 isCurrent 复验失效（extension.ts:14）。

## SP
- [L20-21] try 进入；`active = {context, sessionId}`（getSessionId throw ⇒ [L24]）。事实：active 非 undefined，sessionId 为快照。
- [L22-23] ready 构造（session: context.sessionManager 引用，sessionId: active.sessionId）；emit 同步派发（throw ⇒ [L24]）。
- [L24-28] catch：`active = undefined`；settingsFailure（no-throw）恒 ok:false ⇒ console.error（双包）。
- 合流：两路径均不向外抛。终止：无循环。Post 达成。

## [SELF] 前提
- 无 UB 级。功能级：宿主须在会话上下文有效时派发（否则后续服务请求将以 SESSION_UNAVAILABLE / SERVICE_UNAVAILABLE 结构化拒绝）。

## 自洽
与宿主派发模型、shutdown 清理（extension.ts:32）、服务端所有权检查（extension.ts:10-11/14）闭环一致；emit 消费者异常隔离为未消解外部假设（active 误复位路径）⇒ self_consistency=unknown。
