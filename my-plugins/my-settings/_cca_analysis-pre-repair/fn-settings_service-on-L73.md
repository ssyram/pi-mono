---
function: settings-service.ts:L73::on
source: {file: "settings-service.ts", line: 73}
self_consistency: aligned
---

## 综述

`bus.on(MY_SETTINGS_CHANNEL, handler)` 注册的匿名服务回调（settings-service.ts:73-96；manifest id "on" 为提取器按 bus.on 命名，open-questions.md:21）：消费客户端在 `my-settings:service:v1` 频道 emit 的请求对象，做请求形态校验与会话所有权判定（resolveSession），然后把 `execute` 的异步结果以 Promise 形式同步交还请求方的 `accept`。整个回调体是同步的、无 await；对非法请求静默忽略或回 `INVALID_REQUEST`，对会话不持有则不 accept（客户端由此得到 SERVICE_UNAVAILABLE）。回调自身不向外抛。

## 调用者驱动契约

callgraph 入边：`settings-service.ts:L67::registerMySettingsService → on`（注册关系，callgraph.json:186-188）、`client.ts:L15::invoke → on`（bus emit 派发 join 补边，callgraph.json:246-249；edges/client-invoke.json + edges/settings-service-on.json 已记录派发事实）。真实调用者是宿主 EventBus 派发（extern-model.md 'Event bus dispatch'），包内触发点只有 client invoke 的 emit（client.ts:26）。

1. **宿主 EventBus（emit 派发，extern-model 'Event bus dispatch'）**：emit 启动已注册 safe handler，wrapper 在 handler 首个 await 前同步调用之。前提：无 UB 级前提——`data` 为任意值（null/原始值/敌意对象）都走 L76 守卫或 L91 catch，不产生逃逸异常。期望：handler 同步返回、同步调用 accept（满足 README:109 "calls accept synchronously"）、不向外抛。
2. **client invoke（client.ts:15-32，经 emit 派发）**：请求对象按 SettingsRequest 形态构造（client.ts:17-24：session、sessionId、operation、accept）。期望：
   - 请求合法且会话被持有时，accept 恰在 emit 返回前被调一次，收到**永不 reject** 的 `Promise<SettingsResult>`（L89 `.catch` 折叠 + settingsFailure 不抛）；
   - 请求缺 session/sessionId 时收到结构化 `INVALID_REQUEST`（L79/L83，README:111 服务选择要求双重身份）；
   - 会话不被本服务持有时（resolveSession 返回 undefined，L87）不被 accept → invoke 落入 no-response 路径 → `SERVICE_UNAVAILABLE`（client.ts:27）；
   - operation 非法时收到结构化 `INVALID_REQUEST`（L88 throw 被 L91 捕获、L93 accept）。
3. **registerMySettingsService（svc:67，注册者）**：把本 handler 注册到常量频道后返回解除注册函数；对 handler 的期望即上文 1、2，另要求 handler 对 `data` 无任何前置假设（测试 test/settings-errors.test.ts 用原始对象/缺字段请求打它，范围外但意图旁证）。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **不向外 throw**。无显式 throw 语句；同步 void 回调，无 reject 形态。逐条可能异常点：
  - svc:76 `data.accept` 属性读取 / `"accept" in data`：`data` 已过 `typeof data === "object"` 且 truthy 守卫；敌意 Proxy 的 get/has trap 可能抛 → L91 捕获。
  - svc:77 `data.accept.bind(data)`：L76 已验 callable；**双读窗口**——若 `data.accept` 是会二次求值的 getter（Proxy/hostile object），第二次读取可能返回非函数 → TypeError → L91 捕获。不构成逃逸。
  - svc:79/83/90/93 `accept(...)`：accept 是请求方回调（client.ts:21-23 的 `response ??= result`，正常实现不抛）；敌意 accept 抛出 → L91 捕获 → L93 重试一次 → 若再抛被 L94 空 catch 吞掉。不逃逸。
  - svc:86 `resolveSession(...)`：外部回调（extension.ts:9-17 闭包，manifest 名 `extension.ts:L9::registerMySettingsService`；edges/settings-service-on.json direct edge 已记录派发事实）。可见源码只做属性读与比较、不抛，但按 external 前提建模可抛 → L91 捕获。
  - svc:88 `parseSettingsOperation(...)`：对非法 operation **显式 throw**（settings-operation.ts:5/8/11/16/22 及 copySettings 传播）→ L91 捕获 → INVALID_REQUEST accept。这是设计的拒绝信道，按 owner 标准记为被包含的偏差：显式 throw 存在于 callee，本 handler 全捕获。
  - svc:89 `execute(...)`：async 函数，同步段异常也化为 rejection；`.catch((error) => settingsFailure("OPERATION_FAILED", error))`（即 manifest fn settings-service.ts:L89::catch）把一切 rejection 折叠为结构化结果 → `result` 恒 resolve，accept 收到的 Promise **无 reject 路径**。settingsFailure 自身不抛（fn-settings_error-settingsFailure-L3.md）。
  - svc:91-94 catch：`settingsFailure` 不抛；L93 包在 L94 空 catch 内。双保险闭合。
  - `Promise.resolve`：内建，不抛。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（open-questions.md:27 约定单独注明）。

### 【服务/插件边界的包含效果】

- 本 handler 是插件的服务边界：即使（按本分析不会）异常逃出，宿主 EventBus wrapper 只记录不传播（extern-model.md:30）；owner 标准不依赖该兜底，仅作边界事实。
- 包含后的效果：无服务可注册失败形态——handler 存在即服务在；会话不持有/请求非法时以结构化 INVALID_REQUEST 或静默不-accept 收场，客户端绝不得到默认值伪装成功（静默不-accept → client.ts:27 的 SERVICE_UNAVAILABLE 含安装提示文案，满足 owner 特判据"缺服务提示安装 my-settings"）。

## 契约（霍尔逻辑）

### Pre（调用前须成立；[SELF] 标注见文末清单）

- **无 UB 级前提**：`data` 可为任意值；守卫链（L76-85）与 L91 catch 穷举一切输入形态。功能前提（非 UB）：`data.accept` 须为可调用函数才会收到任何响应（L76 否则静默 return）；`data.session`/`data.sessionId` 须通过 L78/L82 校验且 resolveSession 认领（L86-87）才会进入 execute 路径——违反均产生明确定义的拒绝/静默结果，非 UB。

### Post（返回后保证）

- 同步执行完毕（无 await），期间恰满足以下之一：
  1. `data` 无 callable accept → 静默返回（不抛、不 accept、无副作用）。
  2. 缺 session 身份（L78）或 sessionId 身份（L82）→ accept 恰一次，收到 resolve 为 `{ok:false, error:{code:"INVALID_REQUEST", message:"A session identity is required"|"A session ID is required"}}` 的 Promise。
  3. resolveSession 不认领（L87）→ 静默返回（不 accept）。
  4. operation 解析失败 → accept 恰一次，收到 resolve 为 `INVALID_REQUEST`（message 含解析错误）的 Promise。
  5. 全部通过 → accept 恰一次，收到 `execute(operation, session, globalRoot, queue)` 的结果 Promise，该 Promise **永不 reject**（L89 折叠），resolve 为 ok:true 值或结构化错误（SESSION_UNAVAILABLE/INVALID_REQUEST/OPERATION_FAILED/PARTIAL_SAVE）。
- 任何路径不向外抛；不修改 `data`；不触碰文件系统（文件 I/O 全在 execute 内）。
- accept 调用次数：0 或 1（L79/83/90 后立即 return；catch 路径 L93 只在异常后补一次）。请求方 accept 以首记录为准（client.ts:22 `??=`）。

### 对 callee 的期望（下传 demand）

#### resolveSession（外部回调；manifest 名 extension.ts:L9::registerMySettingsService）
- 调它时已保证：`data.session` 为非 null 非 Array 的 object（L78 已验）、`data.sessionId` 为非空 string（L82 已验）。
- 需要它保证：认领时返回含 cwd/isCurrent/getBranch/appendEntry 的 SettingsSession 形态对象；不认领返回 undefined。可同步 throw（本 handler 已含）。

#### parseSettingsOperation（settings-operation.ts:4，manifest fn，fn 文档本批产出）
- 调它时已保证：value 为 `"operation" in data ? data.operation : undefined`（任意值）。
- 需要它保证：合法 operation 返回结构化 SettingsOperation 且不修改输入；非法**以 throw 拒绝**（L5/8/11/16/22、copySettings Error）——本 handler 以 L91 catch 消费该信道。

#### execute（settings-service.ts:17，manifest fn，fn 文档由并行批次产出）
- 调它时已保证：operation 为 parseSettingsOperation 的合法产物；session 为 resolveSession 认领产物；globalRoot/queue 为注册期闭包常量。
- 需要它保证：返回 `Promise<SettingsResult>`；一切失败（含同步段异常化为 rejection）最终由本 handler 的 `.catch` 折叠——execute 层面 reject 是允许的，但结果形态必须是 SettingsResult（折叠由 settingsFailure 保证）。

#### settingsFailure（settings-error.ts:3，本批）
- 需要它保证：恒返回 `{ok:false, error:{code, message}}` 且不抛——L89 折叠与 L93 兜底依赖之。

#### accept（请求方回调；manifest fn client.ts:L21::accept）
- 调它时已保证：实参为永不 reject 的 `Promise<SettingsResult>`。
- 需要它保证：同步记录响应（client.ts:22 `response ??= result`，首记录生效）；可同步 throw（L91/94 已含）。

#### data.accept.bind（Function.prototype.bind；不在 manifest external 列表）
- 调它时已保证：`data.accept` 经 L76 校验为 callable。
- 需要它保证：返回绑定 this 的同语义函数；对普通函数不抛（敌意二次求值场景已被 L91 含）。

## 并发

- 回调体**全同步**（无 await）：`data` 的校验、resolveSession、parse、accept 全部在 emit 调用栈内完成——无 TOCTOU 窗口；README:109 的同步 accept 义务由此天然满足。
- 无共享可变状态：accept/operation/result 均为每次调用的局部；闭包捕获 resolveSession/globalRoot/queue 为注册期常量（init 后只读）。
- [CONC] 并发 emit：多个请求各自独立走本 handler，互不互斥；文件写互斥与会话所有权由下游承担（execute → writeSettingsFile 的队列 lane、isCurrent 复验）。
- [CONC] accept 与 execute 竞态：accept 收到的是**未完成的** Promise（execute 在后台继续）；请求方 await 它，execute 完成时 resolve——首记录语义（client.ts:22）保证即使未来有人再 accept 也不覆盖。

## SP

- [L74] `accept = undefined`。
- [L75-76] 进入 try。若 `!data ∨ typeof data ≠ object ∨ ¬("accept" in data) ∨ typeof data.accept ≠ function` → **return**（出口 A：静默）。否则 data 为对象且 accept callable。
- [L77] `accept := data.accept.bind(data)`（敌意 getter 二次求值失败 → 跳 [L91]）。
- [L78-81] 若 session 身份缺失 → `accept(Promise.resolve(settingsFailure("INVALID_REQUEST", …)))` → **return**（出口 B：INVALID_REQUEST）。
- [L82-85] 若 sessionId 身份缺失 → 同上（出口 B'：INVALID_REQUEST）。
- [L86-87] `session := resolveSession(...)`（throw → [L91]）；`!session` → **return**（出口 C：静默不-accept）。
- [L88] `operation := parseSettingsOperation(...)`（throw → [L91]）。
- [L89-90] `result := execute(...).catch(e ⇒ settingsFailure("OPERATION_FAILED", e))`——result 恒 resolve；`accept(result)`（accept throw → [L91]）→ **正常出口 D**。
- [L91-95] catch：`settingsFailure("INVALID_REQUEST", error)`（不抛）→ `accept?.(...)`，自身再包空 catch → **出口 E**（INVALID_REQUEST 或无-accept 静默）。
- 合流：A-E 均不向外抛；accept 次数 ∈ {0,1}。终止：无循环。Post 达成。

## [SELF] 前提（上传 caller）

- 无 UB 级前提需上传（data 任意值均被穷举处理）。
- 功能级：请求方须提供 callable `accept` 并在 emit 返回后 await 其收到的 Promise（client.ts:22/28 已实现）；违反只导致无响应/结果被弃，非 UB。

## 自洽

- 与 client invoke 的期望（同步 accept、永不 reject 的响应 Promise、INVALID_REQUEST 拒绝、no-accept → SERVICE_UNAVAILABLE）逐条对齐（README:109/111/92）。
- 与 extern-model 'Event bus dispatch'（同步 safe-handler、accept 连接 client）一致；edges/settings-service-on.json 的派发事实与源码一致。
- L87 的静默不-accept 是"会话不属于本服务"的设计语义（多插件实例/陈旧身份共享频道时让位），客户端由 no-response 得 SERVICE_UNAVAILABLE——不伪装成功。aligned。
