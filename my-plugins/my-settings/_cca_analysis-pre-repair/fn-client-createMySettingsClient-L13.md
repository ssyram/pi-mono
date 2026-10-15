---
function: createMySettingsClient
source: {file: "client.ts", line: 13}
self_consistency: mismatch
---

## 综述

`createMySettingsClient(bus, owner)` 是消费者侧纯工厂：从 `owner` 解构出会话身份快照 `{session, sessionId}`（client.ts:14），定义内部 `invoke` 闭包后返回一个恰好含 `query` / `saveGlobal` / `saveLocal` / `saveSession` 四个箭头方法的对象（client.ts:33-38）。工厂自身不 emit、不注册任何 handler、不做 I/O；所有协议交互（在 `MY_SETTINGS_CHANNEL` 上 emit 请求、被服务同步 accept、await 响应）都发生在四个方法的调用链（经 `invoke`，client.ts:15-32）里。

闭包语义：`session`/`sessionId` 在工厂调用时刻从 `owner` 一次性快照；此后修改 `owner` 对象不影响已创建 client 发出的请求。四个方法每次调用各自走一遍请求/响应握手，互相独立。

## 调用者驱动契约

caller 类型（callgraph.json 无指向本函数的入边 → 全部为入口面，entries.json:6）：

1. **外部消费者（README.md:32-54 §Client）**：`createMySettingsClient(pi.events, { session: ctx.sessionManager, sessionId: ctx.sessionManager.getSessionId() })`。前提：`bus` 满足 `SettingsEventBus`（protocol.ts:46-49，具备 `emit`/`on`）；`owner.session` 是其真实 sessionManager、`owner.sessionId` 是当时捕获的 `getSessionId()`（README:100-101——身份不匹配时服务端按 INVALID_REQUEST/不响应处理，见 settings-service.ts:78-87）。期望：返回的四个方法各给 `Promise<SettingsResult>`，且"returns error results instead of throwing"（README:92、109）；消费者须 await 返回值并检查 `.ok`（README:46-50）；在服务绑定前调用得到 `SERVICE_UNAVAILABLE`（README:117）。
2. **模块再导出面**：index.ts:2 `export { createMySettingsClient }`——纯再导出，无额外前提；语义同 caller 1。
3. **测试**（test/*.test.ts）：被本分析范围排除（manifest skipped 条目），仅作意图旁证，不参与契约。

## 契约

### Pre（调用前须成立）
- **[SELF] owner 非 null/undefined**（工厂在 client.ts:14 直接解构，无守卫；null 时工厂自身同步抛 TypeError，见异常合同——这是函数体推导出、须 caller 保证的前提）。
- `bus` 须具备可调用的 `emit`（违反不构成 UB：invoke 的 try 捕获后返回结构化错误，见 Post 错误分支）。
- `owner.session`/`owner.sessionId` 须为真实会话身份（违反由服务端以结构化 INVALID_REQUEST 拒绝，非 UB；client 侧不校验）。

### Post
- 同步返回含且仅含 `query`/`saveGlobal`/`saveLocal`/`saveSession` 四个方法的对象；每个方法返回 `Promise<SettingsResult>`，该 Promise **永不 reject**（invoke 的 try/catch + settingsFailure 不抛，见 invoke 的 fn 文档）。
- 每次方法调用经 `invoke` 在 `MY_SETTINGS_CHANNEL`（"my-settings:service:v1"）上 emit 一个携带本工厂快照身份与对应 operation 的请求（query → `{op:"query", query}`；saveGlobal/saveLocal/saveSession → `{op:"save-global"|"save-local"|"save-session", save}`，client.ts:34-37）。
- 结果分支（继承 invoke）：
  - emit 期间有服务同步调用 `accept` → resolve 为该服务承诺的 `SettingsResult`（ok:true 或各类结构化错误码，逐字透传，client.ts:28）。
  - emit 期间无任何 handler 同步 accept → resolve `{ok:false, error:{code:"SERVICE_UNAVAILABLE", ...}}`（client.ts:27，README:109 要求不挂起等待）。
  - `bus.emit` 抛出或被 accept 的 Promise reject → resolve `{ok:false, error:{code:"OPERATION_FAILED", ...}}`（client.ts:29-30）。
- 工厂调用本身无副作用：不改 bus、不注册 handler、不触碰文件系统。
- 异常安全档：工厂同步部分为 nothrow（除 Pre 第一条的 TypeError 出口）；方法调用为 nothrow（结果以结构化错误表达）。

### 对 callee 的期望（下传 demand）
#### invoke（client.ts:15，内部闭包，manifest 节点 client.ts:L15::invoke，fn 文档由 1a 批次产出）
- 调它时已保证：operation 对象字面量已按 protocol.ts:24-26 构造；闭包内 bus/session/sessionId 为工厂实参快照。
- 需要它保证：不向外 reject（返回的 Promise 总以 `SettingsResult` resolve）；不修改传入 operation。其失败语义（SERVICE_UNAVAILABLE/OPERATION_FAILED）必须以结构化结果表达。

#### settingsFailure（settings-error.ts:3）
- 调它时已保证：code ∈ SettingsErrorCode、error 为捕获到的 unknown。
- 需要它保证：返回 `{ok:false, error:{code, message}}` 且自身不抛（其内部 try/catch 保证 message 提取失败时回落 "Unknown settings error"）。

#### bus.emit（外部，宿主 EventBus；extern-model.md 'Event bus dispatch'）
- 调它时已保证：channel 为常量 "my-settings:service:v1"，data 为完整 SettingsRequest。
- 需要它保证：同步触发该 channel 已注册 handler（在本 await 点之前），handler 异常被宿主包装层记录而不炸 emit 本身；本分析按"可能抛"建模（invoke 用 catch 兜住）——不得假设其恒成功。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**：
- client.ts:14 `const { session, sessionId } = owner;`——owner 为 null/undefined 时向外同步抛 TypeError（隐式属性访问异常，无显式 throw 语句）。**记为偏差**：公开工厂面对 null owner 不满足"不向外抛"。
- 无其他 throw 点：client.ts:15-32 的 invoke 定义无异常路径；client.ts:33-38 对象字面量构造无异常路径。
- 返回的四个方法：无向外 throw；返回的 Promise 无 reject 路径（invoke 内 try/catch 全覆盖 emit 与 await，settingsFailure 自身不抛）。

**异常在服务/插件边界的包含效果**（与上面分开记，不降低上面标准）：
- client.ts:14 的 TypeError 发生在消费者调用栈，无人包裹——若消费者自身无 catch 会冒泡到其上层 Pi 诊断；这是唯一逃逸点。
- 四个方法返回的 Promise 即使被消费者忽略也不产生 unhandled rejection（永不 reject）。
- 宿主灾难性 OOM/进程终止不属于普通 JS 异常，不在本合同内（extern-model.md 约定单独注明）。

## 并发

无共享可变状态：工厂每次调用建独立闭包；四个方法可被并发调用，互不互斥——`invoke` 内 `response` 是每次调用的局部变量，请求间无交叉。串行化/竞态义务全部由服务端承担（文件 lane、会话所有权），client 侧无锁、无等待顺序要求；唯一时序语义是 emit 的同步 accept 窗口（见 invoke 的 fn 文档，1a 批次）。

## SP

【L13】进入工厂；`bus`、`owner` 入参就位。
【L14】解构 owner：若 owner==null/undefined → TypeError 同步抛出（唯一异常出口）；否则 session=owner.session（值可为任意，下行不校验）、sessionId=owner.sessionId（同前）。合流后不变量：session/sessionId 已快照进闭包。
【L15-32】定义 invoke（闭包捕获 bus/session/sessionId；本函数不执行其体）。无状态变化。
【L33-38】构造并返回对象字面量：4 个箭头各自把实参装进 `{op, query|save}` 后转发 invoke。对象字面量创建无异常路径。
【Post】返回该对象；工厂栈帧退出后仅剩闭包引用 bus/session/sessionId/operation 构造规则。

## 自洽

- caller 期望（README:92 "returns error results instead of throwing"）与四个方法行为对齐（invoke 全捕获）——这部分 aligned。
- 偏差/矛盾：client.ts:14 对 null owner 的同步 TypeError 与 extern-model.md:7 "every analyzed production function ... to avoid throwing outward" 冲突 → **self_consistency=mismatch**（确认风险：工厂入口对 owner 无守卫；实际消费者按 README 传对象则不触发）。
- 对 callee 的期望与 settingsFailure 的实际保证（settings-error.ts:3-8 内层 try/catch）一致。
