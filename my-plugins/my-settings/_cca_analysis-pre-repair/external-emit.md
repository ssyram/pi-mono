# external: emit (SettingsEventBus.emit — 宿主 EventBus)

- 来源引用点：client.ts:26（`bus.emit(MY_SETTINGS_CHANNEL, request)`，invoke 内）；extension.ts:23（`pi.events.emit(MY_SETTINGS_READY_CHANNEL, ready)`，bind 内）。
- kind：宿主事件总线 API（protocol.ts:47 声明 `emit(channel, data): void`；native evidence：packages/coding-agent/src/core/event-bus.ts，extern-model.md 'Event bus dispatch'）。

## Pre
- channel 为 string；data 为任意值（无约束）。

## Post
- 同步启动该 channel 已注册的 safe handler：每个 wrapper 在 handler 首个 await 前同步调用之（invoke 的同步 accept 窗口即由此保证）；未注册任何 handler 时为 no-op。
- 返回 void；**不等待** handler 的异步部分完成。
- handler 内异常被宿主包装层记录而不炸 emit 本身——本插件不得依赖该 logging catch（extern-model.md:42），按"emit 可能 throw"建模。

## 可否 throw-reject
- 同步 void 调用；按外部前提建模可能同步 throw（invoke L29 catch 兜住），不产生 Promise。
