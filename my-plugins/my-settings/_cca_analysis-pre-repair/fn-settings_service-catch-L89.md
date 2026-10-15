---
function: settings-service.ts:L89::catch
source: {file: "settings-service.ts", line: 89}
self_consistency: aligned
---

## 综述

svc:89 `.catch((error: unknown) => settingsFailure("OPERATION_FAILED", error))` 的箭头回调（settings-service.ts:89）：execute 的结果 Promise 的**唯一 rejection 折叠点**——把任意拒绝原因折成结构化 `OPERATION_FAILED`，使 accept（svc:90）收到的 Promise 恒 resolve。它是 on handler "结果 Promise 永不 reject" 保证（fn-settings_service-on-L73.md:17）的实现载体，也是 execute 五类 rejection 出口的公共收口。

## 调用者驱动契约

callgraph 入边：`settings-service.ts:L73::on → catch`（svc:89 注册点，callgraph.json:230-233）；`settings-service.ts:L67::registerMySettingsService → catch`（extractor 伪影边，机制同 open-questions.md:12）。真实调用者是 **Promise 机制**（ECMAScript rejection 语义，extern-model 'Mutation queue and Promise dispatch'："Promise then/catch ... have normal ECMAScript rejection semantics"）：execute 的 Promise reject 时在微任务中、以恰好一个拒绝原因实参调用本回调恰一次。

1. **Promise 机制 / 注册者 on handler**：调它时已保证：单实参（拒绝原因，任意 unknown）；由注册 Promise 的 reject 触发。期望：返回 SettingsResult（OPERATION_FAILED 形态）、自身不抛——`result` 派生 Promise 的"永不 reject"完全押在本回调不抛上（fn-settings_service-on-L73.md:33、fn-settings_error-settingsFailure-L3.md:80 同款押注）。

## 契约

### Pre（调用前须成立）

- **无 UB 级前提**：实参（拒绝原因）为任意 unknown——settingsFailure 对任意输入 total（内部 L5-7 try 兜住 message 提取，fn-settings_error-settingsFailure-L3.md）。
- 调用时序（由 Promise 机制保证，非 caller 义务）：仅在该 Promise reject 后调用一次；this 无要求（箭头函数）。

### Post

- 返回 `{ok:false, error:{code:"OPERATION_FAILED", message}}`：message 提取自拒绝原因（Error 实例 → `.message`；否则 `String(error)`；提取失败回落 "Unknown settings error"）。
- 该返回值成为派生 Promise 的 resolve 值 → **派生 Promise 恒 resolve、永不 reject**。
- 无副作用：不改全局、无 I/O、无日志。
- 异常安全档：nothrow。

### 对 callee 的期望（下传 demand）

#### settingsFailure（settings-error.ts:3）
- 调它时已保证：code 为字面量 "OPERATION_FAILED"、error 为捕获的任意拒绝原因。
- 需要它保证：恒返回 `{ok:false, error:{code, message}}` 且自身不抛——本回调的 nothrow 即其 total 性的直接推论（fn-settings_error-settingsFailure-L3.md:24-29 逐点论证）。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **不可能 throw；无 reject 形态**（同步箭头回调，返回值被 Promise 机制消费）。唯一语句 `settingsFailure("OPERATION_FAILED", error)`：settingsFailure 对任意输入 total（其内部 try/catch 兜住敌意 `.message` getter 与抛出性 `String()`）——本回调对任意拒绝原因正常返回。**无显式 throw 语句**。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

### 【服务/插件边界包含效果】

- 本回调是 execute 五类 rejection 出口（svc:23 / svc:34-37 / svc:38 / svc:39 / svc:54，见 fn-settings_service-execute-L17.md 异常合同）的公共折叠点：折叠后 accept 收到的 Promise 恒 resolve → 服务边界（extern-model 'Event bus dispatch'：客户端"must not wait forever"由 invoke 的 no-response 路径处理，本回调处理"有响应但 reject"侧）与 owner 判据（失败最多是结构化 SettingsResult error）闭合。
- 代价（信息损失，非逃逸）：一切执行期失败统一为 OPERATION_FAILED；message 保留原始文案（如 "Invalid my-settings session log…"、I/O 错误消息）可诊断。
- 晚折叠时序：rejection 常发生在 handler 同步返回（accept 已交出 result 引用）之后——本回调在微任务中执行、返回值流入同一 Promise，await 方（invoke）观察后续 resolve；无二次通知义务。

## 并发

- 微任务时序：execute 后台继续 → reject → 本回调在微任务执行；与 handler 的同步段（accept）、invoke 的 await 无交叉写（error 为本次实参、返回值为 fresh 对象）。
- 无共享状态：箭头体不捕获任何可变闭包（仅实参与字面量 code）。
- 无锁需求。

## SP

- 单语句：`error → settingsFailure("OPERATION_FAILED", error)` → 返回。
- settingsFailure 内部（见其 fn 文档 SP）：instanceof 分支两路 + L5-7 catch 兜底 → 恒返回结构化失败。
- 终止：平凡（无循环、无 await）。Post 达成：返回值即派生 Promise 的 resolve 值。

## [SELF] 前提（上传 caller）

- 无：对任意拒绝原因 total；Promise 机制侧无需任何前提。

## 自洽

- 与 on handler 期望对齐："execute 层面 reject 是允许的，但结果形态必须是 SettingsResult（折叠由 settingsFailure 保证）"（fn-settings_service-on-L73.md:72）——本回调即该折叠的实现；settingsFailure 的 total 性使"catch 里再抛"风险为零。
- 与 invoke 侧闭合：await 永不 reject（client.ts:28 的 await 只可能拿到 resolve 值或进 client.ts:29 catch——后者在"宿主 emit 抛错"等情形）。
- 与 execute 的异常合同（rejection 出口集合）一致 → aligned。
