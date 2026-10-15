# external: getSessionId (sessionManager.getSessionId — 宿主会话管理器 API)

- 来源引用点：extension.ts:14（isCurrent 端口体内 `owner.context.sessionManager.getSessionId() === sessionId`）；extension.ts:21（bind 内快照 `context.sessionManager.getSessionId()`）。
- kind：native 宿主 API（ExtensionSessionManager；extern-model.md 'Pi lifecycle dispatch'）。

## Pre
- 无参；经持存的 sessionManager 对象调用（receiver 良构）。

## Post
- 返回该管理器**当前**会话的 id（string，宿主 TS 标注）。
- 语义：管理器被复用于另一会话时返回值**可能变化**（extern-model.md:22）——不能假设跨 await 稳定；isCurrent 以"每次调用即时求值"消费该语义。

## 可否 throw-reject
- 同步 API；按外部前提建模可能同步 throw（所有调用点均已含：ext:21 在 bind 的 try 内；ext:14 的 throw 传播给 execute L23/38 → svc:89 折叠 OPERATION_FAILED、svc:57 → PARTIAL_SAVE、files:40/48 → svc:89）。宿主 OOM/进程终止除外。
