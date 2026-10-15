# external: getSessionId (SessionManager.getSessionId)

Manifest external ✔（manifest.json `external/getSessionId`）。仓内生产代码调用点两处，均在 extension.ts，接收者同为 `*.context.sessionManager`（`ReadonlySessionManager`，types.ts:335；session-manager.ts:245-262）：

1. extension.ts:30（isCurrent 端口内的活体重读）——接收者为 resolver 捕获的 `owner.context.sessionManager`。
2. extension.ts:69（bind 内的捕获时读取）——接收者为本次派发 `context.sessionManager`。

## Interface / native evidence

packages/coding-agent/src/core/session-manager.ts:1152-1154：`getSessionId(): string { return this.sessionId; }`——纯字段返回。

## Pre / Post

- Pre: 接收者满足 ReadonlySessionManager（字段/方法子集，session-manager.ts:245-262）。
- Post: 返回该实例**当前**会话 id 字符串。

## Failure assumption

- 原生实现为字段读取，真实实例上不可能抛。接口层面仍按可失败外部边界对待（extern-model.md:18「sessionManager.getSessionId()/getBranch() can change or fail」）；两处调用点均已处于 try 内（extension.ts:27-34、:68-78），异常 ⇒ 结构化 OPERATION_FAILED / 诊断 + active 清空。

## 身份可变性（关键语义，Batch A 转办义务 a 的原生证据）

`this.sessionId` 在实例生命周期内**可被就地改写**：session-manager.ts:1713 与 :1745（branch/label 恢复路径重写文件身份与内存身份）。因此：

- 同一 manager 实例两次调用可返回不同值——**不得把单次结果缓存为永久身份**；
- extension.ts:30 的重读因此非冗余：`active === owner` 捕捉实例替换，`getSessionId() === sessionId` 捕捉就地改写（fn-extension-isCurrent-L26.md 并发节）；
- extension.ts:69 捕获的是 bind 时刻快照，此后漂移由 isCurrent 活体裁决兜底。

## Caller obligations

- 现役判定必须活体重读（isCurrent 模式），不得用启动期快照断言当前性。
- 调用置于 try 边界内（两仓内点均满足）。
