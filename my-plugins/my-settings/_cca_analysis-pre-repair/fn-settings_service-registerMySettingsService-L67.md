---
function: settings-service.ts:L67::registerMySettingsService
source: {file: "settings-service.ts", line: 67}
self_consistency: aligned
---

## 综述

导出的服务注册壳（settings-service.ts:67-72）：把 `MY_SETTINGS_CHANNEL`（"my-settings:service:v1"，protocol.ts:1）上的服务回调——svc:73-96 匿名 handler，其完整分析见 **fn-settings_service-on-L73.md**（本文不复述其内部）——绑定到注入的 SettingsEventBus 上，并把 `bus.on` 返回的退订句柄（类型 `() => void`，protocol.ts:48）原样返回。参数注入四端口：bus（宿主事件总线）、resolveSession（会话认领回调）、globalRoot（全局配置根路径 string）、queue（SettingsMutationQueue 文件互斥队列）。函数体唯一语句即注册调用，自身无任何业务逻辑；请求处理语义全部属 handler 文档。

**同名区分**：manifest 中 `extension.ts:L9::registerMySettingsService` 是**另一个实体**——ext:9-17 传给本函数 `resolveSession` 形参的会话认领回调（提取器按宿主调用点命名），其分析见 fn-extension-registerMySettingsService-L9.md。两者仅命名巧合，无代码关系；本文档专指 settings-service.ts:67 的导出注册壳。

## 调用者驱动契约

callgraph 入边：`extension.ts:L6::mySettings → settings-service.ts:L67::registerMySettingsService`（callgraph.json:62-65）——**唯一 caller**；entries.json 未列本函数为入口（它是模块导出 helper，生产代码内仅被 mySettings 调用）。

### 唯一 caller：mySettings（ext:6）

在 ext:8-37 的 try 内于 ext:9-18 调用。四实参来源与前提：

- `bus = pi.events`：宿主 EventBus，须具 SettingsEventBus 语义（protocol.ts:46-49；extern-model 'Event bus dispatch'，native 佐证 packages/coding-agent/src/core/event-bus.ts）。
- `resolveSession`：ext:9-17 闭包（fn-extension-registerMySettingsService-L9.md），满足其文档契约（身份比较认领 / undefined 让位 / 判定不抛）。
- `globalRoot = getAgentDir()`：在 ext:18 实参求值时调用（先于本函数体进入）；external-getAgentDir.md——返回 string 或同步 throw，throw 时本函数不会被进入。
- `queue = withFileMutationQueue`：宿主文件互斥队列（extern-model 'Mutation queue and Promise dispatch'，native 佐证 file-mutation-queue.ts:33-56）；类型 SettingsMutationQueue（settings-files.ts:7）。本函数不消费它，仅经闭包下传给 handler→execute。

**重复调用的效果**：宿主扩展工厂语义下每进程调用一次；若被重复调用，会在同一频道重复注册 handler——**非 UB**：emit 时多个 handler 副本都会运行并各自调 accept，client 首记录语义（client.ts:22 `response ??= result`，fn-client-accept-L21.md 结论）使重复注册无害，代价仅为重复执行拒绝路径。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **唯一自身失败源**：svc:73 `bus.on(MY_SETTINGS_CHANNEL, handler)` **同步 throw**（宿主 EventBus API，外部前提）——本函数无 try/catch，该异常**未捕获向外传播 = 自身偏差**（source:line svc:73）。
- 其余语句（常量绑定求值、handler 闭包构造、return）无异常路径。
- throw 后状态：**无注册、无部分状态**——bus.on 原子性（要么注册完成并返回句柄，要么 throw 前无注册效果）为宿主前提（extern-model 'Event bus dispatch' 建模，见 Post）。
- **handler 运行期异常不归本函数**：handler 同步段由其自身 try（svc:75/91）包裹、execute 异步 rejection 由 catch-L89 折叠为结构化结果——零逃逸结论见 fn-settings_service-on-L73.md 异常合同，此处仅引用。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（open-questions.md:41 约定单独注明）。

### 【边界包含效果】（caller 侧，引用）

svc:73 的 throw 被 caller mySettings 的 ext:33 catch 包含（fn-extension-mySettings-L6.md 逐操作清单第一条）。包含效果：输出 `[my-settings] <message>` 诊断、`active=undefined`、服务未注册——后续客户端请求经 invoke 的 no-accept 路径得结构化 SERVICE_UNAVAILABLE（client.ts:27，含安装提示文案），不伪装成功。本函数是 ext:9 的第一个注册动作，其失败时后文 pi.on ×3 尚未执行，"部分注册不回滚"语义在此调用点不触发。

## 契约（霍尔逻辑）

### Pre（调用前须成立；caller mySettings 保证）

- `bus` 具 SettingsEventBus 语义（protocol.ts:46-49）：`on(channel, handler)` 同步接受注册并返回 `() => void` 退订函数；**注册时不调用 handler**（handler 仅在 emit 时运行，extern-model 'Event bus dispatch'）。
- `resolveSession` 满足 fn-extension-registerMySettingsService-L9.md 契约（认领返回 SettingsSession 形态视图 / 不认领 undefined / 判定不抛）。
- `globalRoot` 为 string（getAgentDir 成功返回值）——svc 不消费，仅下传给 execute 的 settingsFilePath/globalRoot 使用点。
- `queue` 满足 SettingsMutationQueue 语义（settings-files.ts:7；withFileMutationQueue 模型见 extern-model 'Mutation queue'）——同上仅下传。
- 无 UB 级前提：四参为任意值不构成本函数内的 UB；语义违约（如 bus.on 缺失）表现为被 caller 包含的同步 throw，非 UB。

### Post

- **成功路径**：正常返回 bus.on 的退订句柄（`() => void`）；MY_SETTINGS_CHANNEL 上已注册 svc:73-96 handler——此后该频道 emit 可达 handler（join 边 invoke→on 已闭合，callgraph.json:246-249）。**句柄所有权归 caller**：mySettings 丢弃它（ext:9 未保存），插件进程生命周期内注册持续（session_shutdown 仅清 active 使服务让位，ext:32；README:119 "Pi owns subscription cleanup on runtime disposal/reload"——运行期退订依赖宿主 disposal/reload 清理）。
- **失败路径**（bus.on 同步 throw）：无返回值、handler 未注册、无部分状态；对 caller 的可观察效果 = 向外抛（由 ext:33 包含，见【边界包含效果】）。
- 本函数不修改任何参数、不触碰文件系统、不派发任何事件。

### 对 callee 的期望（下传 demand）

#### bus.on（宿主 EventBus API；extern-model 'Event bus dispatch' 建模）
- 调它时已保证：channel 为模块常量 "my-settings:service:v1"（protocol.ts:1，string 字面量求值不抛）；handler 为 svc:73-96 闭包（其行为契约见 fn-settings_service-on-L73.md，对 bus 无前置假设）。
- 需要它保证：同步注册或同步 throw（throw 时无注册效果）；注册后同频道 emit 触发该 handler（wrapper 在 handler 首 await 前同步调用，extern-model:30）；返回退订函数（调用后不再触发 handler——本插件无调用点，仅生命周期事实）。

## 并发

- **无共享/闭包状态**：本函数不创建、不读写任何模块级变量；注册动作在调用栈内同步完成，无 TOCTOU 窗口。闭包捕获仅为参数（bus 接收者、resolveSession/globalRoot/queue）——均 caller 传入即定、init 后只读。
- [CONC] 重复注册（caller 违约重复调用）：多 handler 副本并发运行互不互斥，accept 首记录语义消解（见调用者驱动契约）。
- 退订句柄所有权：归 caller；本函数不持有、不调用。mySettings 未保存句柄——无进程内退订路径，清理归宿主 disposal/reload（README:119）。

## SP

- [L67-72] 入口。Pre 成立：bus 具 SettingsEventBus 语义 ∧ 三注入参数满足各自 fn 文档前提。
- [L73] 求 handler 闭包（词法捕获 resolveSession/globalRoot/queue）→ `bus.on(MY_SETTINGS_CHANNEL, handler)`：
  - 成功 → 返回退订句柄 ⇒ **Post 成功路径**（注册完成 + 句柄交还；emit 可达 handler）。
  - 同步 throw（外部前提）→ 未捕获传播 ⇒ **Post 失败路径**（无注册、无部分状态；由 ext:33 包含）。
- 终止：无循环、无 await，单语句线性，两出口穷举、无合流分支。Post 达成。

## [SELF] 前提（上传 caller mySettings）

- `bus` 须为具 SettingsEventBus 语义的宿主事件总线（on 可注册并返回退订函数、emit 触发已注册 handler、注册时不调用 handler）。
- `resolveSession` 须满足 fn-extension-registerMySettingsService-L9.md 契约。
- `globalRoot` 须为 string（getAgentDir 成功返回值）。
- `queue` 须满足 SettingsMutationQueue 语义（withFileMutationQueue）。
- 四者皆由 mySettings 实参构造保证（fn-extension-mySettings-L6.md 调用者驱动契约）；违约形态 = svc:73 同步 throw（被 ext:33 包含）或 handler 运行期行为不可控（属 handler/下游合同，非本函数 UB）。

## Edge 证据

- `edges/fn-settings_service-registerMySettingsService-L67.json`（**write-once 保留，本批不重写**）：registered_as / builds_op / direct_edges 全空——**本函数不引入新 op**；handler 自身的注册事实（op `bus:my-settings:service:v1`）记录于 edges/fn-settings_service-on-L73.json。
- 该文件 note 要点：静态边 `svc:L67 → on(L73)`（callgraph.json:186-188）是 handler 字面量词法归属的**注册连接边**（本函数经 bus.on 与 handler 建立注册关系）；`svc:L67 → {parseSettingsOperation, catch-L89, execute, accept, bind}` 为**嵌套归因伪影**（handler 体调用被归到外层注册函数；svc:77 `data.accept.bind` 为 Function.prototype.bind 同名碰撞），open-questions.md §A4 已裁定，勿按字面读。
- 入边 `mySettings → svc:L67`（callgraph.json:62-65）为唯一真实 caller 边，与源码一致；无漏边。

## 自洽

- Pre/Post 与唯一 caller mySettings 的期望（fn-extension-mySettings-L6.md "对 callee 的期望 > registerMySettingsService"：同步完成注册或同步 throw、无异步半注册、返回的解除注册函数可丢弃）逐条对齐。
- 与 handler 文档（fn-settings_service-on-L73.md 调用者驱动契约第 3 条）一致：本函数注册后返回句柄，对 handler 的期望即其宿主 EventBus 条目。
- 与 extern-model 'Event bus dispatch'、open-questions §A4 伪影裁定一致。aligned。
