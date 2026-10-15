---
function: client.ts:L21::accept
source: {file: "client.ts", line: 21}
self_consistency: aligned
---

## 综述

请求对象上的 `accept` 方法（client.ts:21-23）：服务回调通过它把响应 Promise 递回 invoke——以 `response ??= result` 的**首记录语义**写入 invoke 的局部闭包变量。单体、同步、无校验、不抛、不返回值。

## 调用者驱动契约

callgraph 入边：`settings-service.ts:L73::on → accept`（svc:79/83/90/93 实调点，callgraph.json:218-221）；`settings-service.ts:L67::registerMySettingsService → accept`（extractor 把 handler 内调用归到 L67 的伪影边，open-questions.md:12 已裁定）。真实"调用者"是事件派发链（extern-model 'Event bus dispatch'："Calling accept connects the service callback to the request's accept method in client.ts"）：

1. **服务回调 on（svc:79/83/90/93，经 bus.emit 同步派发）**：调它时已保证 result 为**永不 reject** 的 `Promise<SettingsResult>`（svc:89 `.catch` 折叠产物或 `Promise.resolve(settingsFailure(...))`）。期望：同步记录响应（fn-settings_service-on-L73.md:79 "同步记录响应（client.ts:22 response ??= result，首记录生效）；可同步 throw（L91/94 已含）"——实际不抛）。
2. **频道上任意 handler（广义）**：emit 把 request 交给该频道全部注册者；任意 handler（含外来插件）同步或异步调用均合法——后果见 Post/并发（首记录 + 晚到丢弃）。

## 契约

### Pre（调用前须成立）

- **无 UB 级前提**：this 为请求对象（response 闭包变量已初始化 undefined，client.ts:16）；`result` 任意值——单体赋值对任何实参无异常路径（类型声明 `Promise<SettingsResult>`，运行时不校验；违约后果见 Post，非 UB）。

### Post

- 调用前 response 为 undefined → `response := result`；否则无操作（首记录，后续 accept 一律丢弃）。
- 不抛、返回 undefined、无 I/O、不修改 request 其他字段、不触碰 result。
- result 为 undefined/非 Promise（敌意 handler）：invoke 的 `await` 原样以其 resolve（undefined → no-response 分支得 SERVICE_UNAVAILABLE）——类型违约不产生 UB。
- 异常安全档：nothrow。

### 对 callee 的期望（下传 demand）

- 无 callee：`??=` 为语言内建、对 let 闭包变量赋值；无属性访问、无外部调用。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **不可能 throw、无 reject 形态**（同步 void 方法）。唯一语句 `response ??= result`：nullish 判定 + 变量赋值，对任意 this/result 无异常路径；无显式 throw。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内。

### 【服务/插件边界包含效果】

- 本方法是响应进入 invoke 的唯一通道；"不抛"保证服务回调的四个 accept 调用点（svc:79/83/90/93）不会因本方法异常——on handler 文档"accept 正常实现不抛"的依据即本合同（其 L91/94 兜底按外部前提保留，实际不触发）。
- 晚到 accept 写入已废弃闭包变量：invoke 已返回后无可观察效果、闭包随调用帧回收——无 unhandled rejection 类逃逸（本方法不产出 Promise）。

## 并发

- **[CONC] 多 handler 竞争 accept**：emit 同步派发下多个 handler 可在 emit 栈内先后调用；`??=` 保证首个生效、其余丢弃——单线程事件循环内同步执行，无锁必要。
- **[CONC] 晚到 accept（handler 异步后调）**：仅写闭包变量；若 invoke 已返回 SERVICE_UNAVAILABLE，写入无观察者。
- [R/W] response 闭包变量：写仅在本方法（client.ts:22）、读仅在 invoke（client.ts:27/28）——同一调用帧同步段内串行，无交叉。

## SP

- [L22] `response ??= result`：response 为 undefined/null → `response := result`；否则不变。
- [Post] 返回 undefined。终止：单语句、无分支遗漏。Post 达成。

## [SELF] 前提（上传 caller）

- 无（total 回调：caller 无任何前提）。

## 自洽

- 与 on handler 期望（"同步记录响应、首记录生效"）对齐；与 invoke 的首记录语义（其 fn 文档 Post/并发节）对齐；与 extern-model 'Event bus dispatch' 的 accept 连接描述一致。aligned。
