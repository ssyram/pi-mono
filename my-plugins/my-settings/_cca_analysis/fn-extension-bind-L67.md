---
fn: "extension.ts:L67::bind"
source: "extension.ts"
line: 67
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-extension-bind-L67.md

## 综述

`pi.on("session_start", ...)` 与 `pi.on("session_tree", ...)` 共用的具名箭头 `bind`（extension.ts:67-79；注册点 extension.ts:80,81，由 mySettings 在注册成功后才注册——extension.ts:63-66 提前返回保证 bind 只在 service 注册成功路径上存在）。职责：把派发来的 `ExtensionContext` 捕获为现役态 `active = { context, sessionId }`（extension.ts:69），然后向 `my-settings:ready:v1` 广播 ready 载荷（extension.ts:70-74）。try/catch 包裹（extension.ts:68-78），失败路径 `active = undefined` + `reportSettingsError`（extension.ts:76-77）。

## 契约（调用者驱动）

调用者：宿主生命周期派发（registered_as: op=session_start、op=session_tree，见 edges/fn-extension-bind-L67.json；runner 逐 handler await，runner.ts:1100-1121）。两事件实参形状相同 `(_event, context: ExtensionContext)`。

- 对派发方的 POST：同步返回、**绝不向外抛**（自身 try/catch + reportSettingsError 不抛，settings-error.ts:12-15）。宿主层 containment（runner.ts:1111-1120 catch → emitError）存在但**不作为前提**。
- 对插件内其他组件的全局 POST（成功路径）：`active` 非空且为最新 context ⇒ resolver 三元身份核对可通过（extension.ts:19）⇒ 服务开始对该会话可用；ready 已广播 ⇒ 外部消费方得知会话身份（payload 满足 protocol.ts:74-77 `SettingsReady`）。
- 失败路径 POST：`active = undefined`（extension.ts:76）⇒ 服务对该会话保持不可用（resolver 返回 undefined）+ console.error 诊断——符合 prototype「注册失败 → 诊断 + 插件保持惰性」的失败侧语义。
- PRE：无（context 形状由宿主契约保证；畸形 context 的字段读取失败也落 catch）。

## 自身异常合同（逐路径）

- extension.ts:69 `context.sessionManager`：属性读取，普通对象不抛；异常访问器可抛 ⇒ :75 捕获。
- extension.ts:69 `context.sessionManager.getSessionId()`：外部方法。原生：纯字段返回（session-manager.ts:1152-1154）不抛；接口上按可失败边界对待（extern-model.md:18）⇒ :75 捕获。
- extension.ts:70-73 ready 对象字面量：不抛。
- extension.ts:74 `pi.events.emit(MY_SETTINGS_READY_CHANNEL, ready)`：**真实抛出向量**。原生证据：pi.events 为 EventBus（types.ts:1917），真实实现是 EventEmitter 包装（event-bus.ts:15-17，`emitter.emit` 直接转发）；node EventEmitter **同步**调用监听者且**不捕获监听者异常**——其他插件在 `my-settings:ready:v1` 上的监听器抛出会从 emit 传播出来，进入本函数 :75 catch。后果：`active = undefined`（:76）+ 诊断（:77）——捕获本已成功却因 ready 广播失败被回滚，该会话服务保持惰性。判定：no-throw 保持 ✔；fail-closed 保守方向正确；catch 范围把「ready 广播失败」与「捕获失败」合并处理属设计取舍而非偏差（prototype 只规定 ready 必须在 active 置位**之后**发出——满足 ：69 先于 ：74；未规定 emit 失败的善后）。附带：抛出点之前的监听者已收到 ready（部分送达，EventEmitter 语义），无本插件作用域内状态破坏。
- extension.ts:76-77 catch 体：赋值不抛；reportSettingsError 全程内部 try/catch 不抛（settings-error.ts:12-15）⇒ catch 不可能二次抛出。
- 全函数无显式 `throw`；不依赖 Pi 兜底。宿主 OOM/终止非 JS 异常合同。

对照 arch/prototype.md：ready 仅在 active 置位后发出 ✔（:69→:74 顺序，且原子单语句赋值，resolver 不可能见到半初始化 active）；失败 → 诊断 + 惰性 ✔。

## 霍尔逻辑 SP

{P: context 满足 ExtensionContext（types.ts:325-365）；pi.events 满足 SettingsEventBus.emit（protocol.ts:53）；本函数仅在 service 注册成功路径可达（extension.ts:63-66）}
body: active := {context, sessionId: context.sessionManager.getSessionId()}（:69）；ready := {session: context.sessionManager, sessionId: active.sessionId}（:70-73）；pi.events.emit(READY, ready)（:74）；任一步同步异常 ⇒ active := undefined ∧ reportSettingsError（:76-77）
{Q: 成功 ⇒ active 非空（身份 = 本次 context + 活体 id）∧ ready 已广播；失败 ⇒ active = undefined ∧ console.error 诊断；两种结局都不向外抛}

## 并发/异步义务

- **双事件重复派发**：session_start 与 session_tree 都会触发 bind；同一会话的 session_tree 重复派发会用**全新对象**重建 active（extension.ts:69）。后果：重建前已 resolve 端口的在途请求，其 owner 变陈旧 ⇒ 其后 isCurrent 得 false ⇒ SESSION_UNAVAILABLE——fail-closed，绝不出现"身份未变却判非现役导致错误会话写入"的反向错误。重建后的新请求拿到新 owner，一切正常。无需加锁（同步派发）。
- **与 shutdown 的顺序**：宿主保证 shutdown 在会话生命周期末派发；bind 复活（shutdown 后再来 session_start）由身份核对兜底（resolver 比对实例与 id），不产生跨会话串写。
- **与 resolver 的可见性**：bind 整体同步；任一 resolver 调用要么完全在前要么完全在后，无部分可见（单语句 active 赋值）。
- ready 半边：仓内无 ready 消费者（open-questions §半边），零监听 emit 为 no-op；消费方为外部/其他插件——若其监听器抛出，见上文 :74 路径。
- sessionId 载荷与活体语义：ready 里的 sessionId 是 bind 时刻快照；此后同一实例 sessionId 就地改写（session-manager.ts:1713/:1745）不会触发新 ready，直到宿主再派发 session_tree/session_start——现役裁决始终以 isCurrent 活体重读为准，ready 载荷仅供发现，不作担保。
