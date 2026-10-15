# external: emit (SettingsEventBus.emit)

Manifest external called directly by `client.ts:L27::invoke` at client.ts:L49 (`bus.emit(MY_SETTINGS_CHANNEL, request)`). Written by Batch A (client side); other callers (ready-channel emit in extension.ts) should append, never rewrite.

## Interface

protocol.ts:52-55: `emit(channel: string, data: unknown): void` — 结构化接口，只声明同步返回 void，未声明任何失败模式。真实实现见 packages/coding-agent/src/core/event-bus.ts:12-33（EventEmitter 包装）。

## Pre

- bus 实例在 client 工厂期注入（client.ts:14），直到 invoke 才被触碰；可为任意满足接口形状的对象。
- 通道 `my-settings:service:v1`（protocol.ts:1）有/无监听者均合法：无监听 ⇒ invoke 返回 SERVICE_UNAVAILABLE（client.ts:50-55）。
- 同步派发（仓内事实，非接口承诺）：EventEmitter.emit 同步调用监听者；真实 bus 用 async safeHandler 包裹 handler（event-bus.ts:19-25），handler 体同步执行 ⇒ 服务端在 emit 返回前同步调用 accept（settings-service.ts:25,27,31,36,46,49）。

## Post

- emit 正常返回后，若存在合格 handler，request.accept 已被同步调用且 invoke 的 `response` 已定（client.ts:43,50）。
- handler 的同步/异步异常不会以异常形式逃出 emit（safeHandler try/catch + console.error，event-bus.ts:20-24）——这是真实实现的事实，不是 protocol.ts 接口的承诺。

## Failure behavior

- 接口层 emit 可同步 throw（未承诺不抛）。invoke 把它当外部边界处理：catch-all 转 OPERATION_FAILED 结构化失败（client.ts:59-60）。
- 若宿主注入异步派发的 bus 实现：accept 晚于 client.ts:50 判定 ⇒ selected=false（client.ts:38）⇒ invoke 恒返回 SERVICE_UNAVAILABLE；晚到 accept 的 rejection 仅产生诊断（client.ts:40），无 unhandled rejection。语义退化为"服务不可用"，不违反 no-throw，但违反 prototype.md §6「同步认领 Promise」的语义前提——宿主侧义务：传入同步派发的 bus。

## Caller obligations

- 调用方必须把 emit 视为可抛外部边界并自带 try/catch（invoke 已满足：client.ts:30,59-60）。
- 调用方不得假设"emit 返回即服务已受理"，必须以 `response === undefined` 判定（client.ts:50），并把同步派发作为生态前提写入契约（prototype.md §6）。
- handler 收到的 request.accept 必须在 emit 同步窗口内调用（服务端 handler 满足，settings-service.ts:21-54）。

## Caller appendix (Batch B: extension.ts:74 ready-channel emit)

第二调用点：`pi.events.emit(MY_SETTINGS_READY_CHANNEL, ready)`（extension.ts:74，bind 内）。与 service 通道同为实现（EventBus → EventEmitter，event-bus.ts:15-17），但契约要点不同：

- **零监听合法**：ready 通道仓内无消费者（open-questions §半边），面向宿主/其他插件；无监听 emit 为 no-op，不视为失败。
- **监听者异常可传播**：EventEmitter 同步调监听者且不捕获异常 ⇒ 其他插件的 ready 监听器抛出会从本 emit 逃出（区别于 service 通道 handler 被 safeHandler 包裹，event-bus.ts:19-25）。仓内收口：bind try/catch ⇒ active=undefined + 诊断（extension.ts:75-77；分析见 fn-extension-bind-L67.md）。
- 载荷形状 `SettingsReady`（protocol.ts:74-77）；时序义务：active 置位先于 emit（extension.ts:69→74，prototype §6/§审核要点）。
