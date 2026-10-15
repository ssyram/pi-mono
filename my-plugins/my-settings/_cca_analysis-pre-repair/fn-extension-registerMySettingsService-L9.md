---
function: extension.ts:L9::registerMySettingsService
source: {file: "extension.ts", line: 9}
self_consistency: aligned
---

## 综述

注册期注入服务的**会话认领回调**（extension.ts:9-17；manifest id 沿用提取器对宿主调用点的命名——实为传给 settings-service.ts:67 `registerMySettingsService` 的 `resolveSession` 参数，open-questions.md:21 与派发澄清一致）。收到 `(session, sessionId)` 时读取 `active` 快照：仅当 active 存在、其 `context.sessionManager` 与请求 session 为**同一对象**且 `sessionId` 串相等时，返回绑定该快照的 SettingsSession 视图（cwd + isCurrent/getBranch/appendEntry 三个闭包端口）；否则返回 undefined。三个端口全部闭包捕获 owner 快照——即便 active 此后被替换，旧视图仍对原 context 求值，由 isCurrent 的 `active === owner` 比较显式失效。

## 调用者驱动契约

callgraph 入边：`extension.ts:L6::mySettings → registerMySettingsService(ext:9)`（callgraph.json:62-65——注入关系）。真实调用者是服务回调 on（settings-service.ts:86 `resolveSession(data.session, data.sessionId)`）——同步、在 emit 调用栈内（extern-model 'Event bus dispatch'：服务回调 sync 调用；edges/settings-service-on.json direct edge 已记录 on→本回调派发事实）。

1. **服务回调 on（svc:86，fn-settings_service-on-L73.md:62-64 已落盘期望）**：调它时已保证：`data.session` 为非 null 非 Array 对象（svc:78 已验）、`data.sessionId` 为非空 string（svc:82 已验）。期望：认领时返回含 cwd/isCurrent/getBranch/appendEntry 的 SettingsSession 形态对象；不认领返回 undefined（svc:87 静默不-accept → 客户端 SERVICE_UNAVAILABLE）；可同步 throw（svc:91 已含——实际不抛，见异常合同）。

## 契约

### Pre（调用前须成立）

- **无 UB 级前提**：`active` 可为任意状态（undefined / 过期 owner）——回调以身份比较处理（ext:11 三个条件穷举）；入参已过 svc:78/82 校验。external-resolveSession.md 的 Pre 一致。

### Post

- **认领（ext:12-17）**：返回 SettingsSession 形态视图：
  - `cwd`：owner.context.cwd 的**快照值**（视图创建时刻读取；宿主保证 string——svc:30/50 join 的输入，execute [SELF] 消解 1 的就地依据）。
  - `isCurrent()`：`active === owner && owner.context.sessionManager.getSessionId() === sessionId`——**每次调用即时求值**（active 重读 + getSessionId 重读）；双条件须同时成立。
  - `getBranch()`：`owner.context.sessionManager.getBranch()` 透传（宿主 API）。
  - `appendEntry(type, data)`：`pi.appendEntry(type, data)` 透传（宿主持久化请求，extern-model："It can fail"）。
- **不认领（ext:11 任一条件成立）**：返回 undefined → svc:87 静默不-accept → 客户端得 SERVICE_UNAVAILABLE（client.ts:27）——多插件实例/陈旧身份共享频道时的让位语义，不伪装成功。
- 不修改 active、不修改入参。
- 异常安全档：认领判定 nothrow（见异常合同）；三端口方法的异常合同属各自 manifest fn（ext:14/15/16，并行批次）与其调用点包含分析——本回调的同步契约是"判定本身不抛"。

### 对 callee 的期望（下传 demand）

#### sessionManager 属性与比较（ext:11，宿主对象普通属性链）
- 需要它保证：`owner.context.sessionManager` 为普通属性读取（宿主构造的 context 对象，无抛出性 getter）——外部前提；svc:91 兜底按"可抛"建模，实际不触发。

#### isCurrent / getBranch / appendEntry（ext:14/15/16，manifest fn，并行批次）——[SELF] 上传目标
- 构造时已保证：三端口闭包捕获 owner（ext:10 快照）与 sessionId/pi；被调用时 active 可能已变（isCurrent 即时比较正是为此设计）。
- 需要它们保证（承接 execute 的上传清单，经本视图透传）：
  - **getBranch**：返回数组、元素均为非 null 条目对象（readSessionSettings L7 前提；execute [SELF] 消解 3 / 上传 getBranch 的透传层——`session.getBranch()` 的实体即本端口）。
  - **appendEntry**：失败以 throw 可见（extern-model "It can fail"）——execute svc:59 的 PARTIAL_SAVE/OPERATION_FAILED 显式报告依赖该形态。
  - **isCurrent**：同步返回 boolean；可能 throw（外部前提）——各调用点（svc:23/38/57、files:40/48）已含。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **认领判定（本回调同步体，ext:10-17）不向外 throw、无 reject 形态**（同步箭头，返回普通对象或 undefined）。逐条 source:line：
  - ext:10 `const owner = active`：读闭包 let 变量——不抛。
  - ext:11 `!owner || owner.context.sessionManager !== session || owner.sessionId !== sessionId`：普通属性读取 + 全等比较——对宿主构造的 context 对象不抛（外部前提；无显式 throw）。
  - ext:12-17 对象字面量构造（含三个箭头方法定义）——无异常路径。
- **返回端口的方法体在被调用时才执行**：isCurrent 调 getSessionId（external-getSessionId.md：外部前提，可抛）；getBranch 调宿主 API（可抛）；appendEntry 调 pi.appendEntry（extern-model："It can fail"）——这些 throw 属于端口 fn 的自身异常合同（并行批次），其包含路径在此记录为边界效果（下节）。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

### 【服务/插件边界的包含效果】

- svc:86 调用点位于 on handler 的 try 内（svc:91 catch → INVALID_REQUEST）——即便按外部回调建模"可抛"也被包含；可见源码实际不触发。
- 端口异常的包含路径（服务边界零逃逸）：
  - isCurrent throw → execute svc:23/38（reject → svc:89 → OPERATION_FAILED）、svc:57（catch → PARTIAL_SAVE）、files:40/48（→ rejection → svc:89）。
  - getBranch throw → execute svc:39（reject → svc:89）。
  - appendEntry throw → execute svc:59 catch → PARTIAL_SAVE/OPERATION_FAILED（显式报告）。
- 不认领路径与"缺服务提示安装"判据衔接：resolveSession 返回 undefined → 不 accept → client SERVICE_UNAVAILABLE（含安装提示）。

## 并发

- **[R/W] active（extension.ts:7，插件级共享可变量）**：bind（session_start/session_tree，ext:21）写、session_shutdown（ext:32）写、本回调（ext:10）与三端口（ext:14 等）读。无锁（单线程事件循环）；本回调在 svc:86 的同步栈内读取——与 bind 的写不交叠（bind 由宿主在生命周期事件派发，与 emit 派发互斥于事件循环）。
- **[CONC] 认领-使用窗口**：视图在 svc:86 创建后，execute 的所有权复查（svc:23/38/57、files:40/48）全部经 isCurrent 即时比较 `active === owner`——active 被替换（新会话或重绑定）→ 旧视图 isCurrent false → SESSION_UNAVAILABLE / PARTIAL_SAVE。视图不会误写替换后的会话。
- **[CONC] session_tree 重绑定**：bind 以**新对象**覆盖 active（ext:21）——即使 sessionId 与 context 都不变，旧快照的 `active === owner` 也变 false → 在途旧视图失效（保守所有权语义）；新请求经本回调认领到新快照。与 extern-model "getSessionId() may change ... Do not assume captured context remains current" 一致。
- 三端口各自的并发语义（isCurrent 双条件的求值窗口、getBranch 返回值的时效性）属其自身 fn 文档；本回调只保证快照绑定与身份判定的原子性（同步单帧）。

## SP

- [L10] `owner := active`（快照读取——此后 active 的变化不影响本帧判定，只影响后续 isCurrent 的即时比较）。
- [L11] `!owner ∨ owner.context.sessionManager !== session ∨ owner.sessionId !== sessionId` → return undefined（出口 A：不认领）。合流不变量：owner 存在且 (sessionManager, sessionId) 身份二元组匹配。
- [L12-17] 返回视图对象：cwd 取快照值；三端口闭包捕获 owner/sessionId/pi。构造无异常。
- 出口穷举：A（undefined）、R（视图）。终止：平凡（无循环、无 await）。Post 达成。

## [SELF] 前提（消解记录与上传清单）

1. **[SELF] 上传 getBranch（ext:15）**——execute [SELF] 消解 3 的透传层：`session.getBranch()`（svc:39）的实体是本视图的 getBranch 端口 → `owner.context.sessionManager.getBranch()`。前提"返回数组、元素均为非 null 条目对象"须在该 fn 契约（宿主 sessionManager 外部前提）中固化。
2. **[SELF] 上传 appendEntry（ext:16）**：失败须以 throw 可见——PARTIAL_SAVE 显式报告依赖之。
3. **[SELF] 上传 isCurrent（ext:14）**：即时快照语义（active 与 getSessionId 在同一调用内求值）；可 throw（外部前提）——各调用点已含。
4. **（就地消解，承接 execute [SELF] 消解 1）cwd 须为 string**：视图 cwd ← owner.context.cwd（ExtensionContext，宿主保证 string）→ svc:30/50 `join(session.cwd, ".pi")` 的输入。外部前提，就地收。

## 自洽

- 与 on handler 期望对齐：认领/不认领形态、可 throw 建模（fn-settings_service-on-L73.md:62-64）与 external-resolveSession.md 的 Post（视图形态、undefined、常规不抛）逐条一致。
- 与 execute 的所有权复查设计闭环：isCurrent 的 `active === owner` 正是 execute 五个复查点所消费的谓词——PARTIAL_SAVE/SESSION_UNAVAILABLE 的语义由本回调的快照绑定保证其指向"发起请求时的会话"。
- svc:11 的让位语义（不认领 → 客户端 SERVICE_UNAVAILABLE）与 on 文档出口 C、client 文档出口 A 三方一致 → aligned。
