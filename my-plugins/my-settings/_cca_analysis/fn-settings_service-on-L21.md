---
fn: "settings-service.ts:L21::on"
source: "settings-service.ts"
line: 21
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_service-on-L21.md

## 综述

提取器条目 `settings-service.ts:L21::on` 是 `bus.on(MY_SETTINGS_CHANNEL, (data) => {...})` 的 handler 箭头（settings-service.ts:21-54），由 registerMySettingsService 构造并在注册时交给 bus（:21），此后由 `bus.emit("my-settings:service:v1", request)` 同步派发驱动（client.ts:49；extern-model §Event bus dispatch）。职责链：提取并绑定 `data.accept`（:24-25）→ session 身份形状校验（:26-33，Batch B 前提的调用方侧 discharge）→ `resolveSession`（:34）→ `parseSettingsOperation`（:40）→ 分派 `executeSettingsQuery`/`executeSettingsSave` 或结构化失败（:41-45）→ `accept(result)`（:46）；任何同步异常折为 `accept?.(OPERATION_FAILED)`（:47-52），内层兜底 `reportSettingsError`（:51，无条件 no-throw）。handler 全程同步（无 await），**不向外抛出**（证明见自身异常合同），并对 Batch A 的两条 load-bearing 前提（同步 accept 窗口、accept 的 promise 必 settle 且形状良构）给出逐 accept 位点证明（见调用者驱动契约末）。

## 契约（调用者驱动）

调用者：bus emit 派发（真实实现 event-bus.ts:15-17 同步派发；宿主 containment safeHandler event-bus.ts:19-25 仅佐证、不作前提）。每次 emit 恰一次调用本箭头。

- PRE（ecosystem）：`data` 为 emit 的第二实参；仓内唯一生产 emit 是 client.ts:49 的 `SettingsRequest` 字面量（session: object、sessionId: string、operation、accept 函数，client.ts:32-48 + protocol.ts:45-50）。handler 对 `data` 形状零假设（全程守卫，见下）——任意 `data` 域均被 contain。
- PRE（resolveSession，Batch B discharge 记录）：**handler 在调用 resolveSession（settings-service.ts:34）之前已形状校验 `data.session`/`data.sessionId`**：:26 断言 `"session" in data` ∧ truthy ∧ typeof object ∧ 非数组；:30 断言 `"sessionId" in data` ∧ typeof string ∧ 非空串。故 resolver 收到的实参域恰为 `session: object`（非 null、非数组）∧ `sessionId: string`（非空）——与 extension resolver 的期待对齐（extension.ts:19 仅做引用/字符串比较，不对实参取属性）。此为 Batch B 转发前提的调用方侧 discharge，**确认成立**；resolver 自身不抛、返回 SettingsOutcome 为 Batch B 侧 discharge（fn-extension-registerMySettingsService-L16.md）。
- POST（对 bus emit 方/client）：
  1. handler 同步返回 undefined，无异常逃入 emit 调用栈（异常合同节）。
  2. **同步 accept 窗口（Batch A 前提 a，DISCHARGED）**：handler 体 ：22-53 无任何 await ⇒ 从派发进入到每个 accept 位点（:27/:31/:36/:46/:49）全程同步；配合 event-bus.ts:15-17 的同步 emit ⇒ 每个 accept 都发生在 client `bus.emit`（client.ts:49）返回之前、`if (!response)` 判定（client.ts:50）之前。若宿主注入异步派发 bus ⇒ accept 晚于判定 ⇒ SERVICE_UNAVAILABLE（client.ts:50-55，仍 no-throw，语义退化已由 fn-client-invoke-L27.md 记录）。
  3. **accept 的 promise 必 settle 且形状良构（Batch A 前提 b，DISCHARGED，逐位点）**：
     - :27、:31、:49：`Promise.resolve(settingsFailure(...))` —— settingsFailure 无条件 no-throw 且返回 protocol.ts:37-40 良构 SettingsFailure（fn-settings_error-settingsFailure-L3.md）；实参为普通对象 ⇒ external-resolve.md Form 2：**创建即 fulfilled、形状良构**。
     - :36：`Promise.resolve(session)` 且仅在 `!session.ok` 分支（:35）⇒ `session` 为 SettingsFailure 形状（protocol.ts:42 联合的失败支，由 resolver 合同保证）⇒ 同上 fulfilled 良构。
     - :46 失败支：`Promise.resolve(operation)` 且仅在 `!operation.ok`（:41）⇒ SettingsFailure ⇒ fulfilled 良构。
     - :46 成功支 query：`executeSettingsQuery(...)`（settings-query.ts:19-68，async fn）。唯一 await 在 ：37 `await Promise.all([loadFile, loadFile|Promise.resolve({})])`：loadFile（settings-query.ts:9-17）唯一 await 是 `readSettingsFile`（settings-files.ts:27-38），其体全程 try/catch，仅 await `readFile`（node:fs/promises——fs promise 对任何调用恒 settle）⇒ readSettingsFile 恒 fulfill ⇒ loadFile 恒 settle；`Promise.resolve({})` 即刻 fulfilled ⇒ Promise.all 恒 settle。其余语句（settingsFilePath :25/:27、copySettings :30/:66、isCurrent :33/:42、getBranch :48、readSessionPatches :52、pickValidFields :57）均为同步调用：同步 throw 会把 async fn 转为 **rejection（仍是 settle）**，且这些调用自身按各自批次合同返回结构化值。⇒ **恒 settle**；fulfill 形状：每个 return 位点（settings-query.ts:26/28/31/34/35/44/67）要么是结构化 SettingsFailure，要么 `{ok:true, values: <copySettings 快照>}`（:67）——**良构**（PRE：copySettings ok ⇒ value 为合法 Settings 快照，json-settings 批次；若该 PRE 被违反才会出现 client.ts:58 的 `{ok:true, values:undefined}` 透传，见"契约缺口"）。
     - :46 成功支 save：`executeSettingsSave(...)`（settings-save.ts:29-52，async fn）。唯一 await 在 ：42 `await saveFileOnly(...)` ⇒ writeSettingsFile（settings-files.ts:40-85）：await 位点 mkdir :49、realpath :50、queue :51、readSettingsFile :56、writeFile :62、rename :66、unlink :72（后者在 finally 内、自含 try/catch :73-75）——fs promise 恒 settle；queue = withFileMutationQueue（宿主，extern-model §Pi lifecycle：进程内串行同文件 RMW；native 证据为纯 promise 链式排队，action（:51-81）自体全程 try/catch 恒 fulfill ⇒ 队列链推进、queue promise 恒 settle）【unknown：宿主队列对 action 的调用时机契约无超时文档；在 action 恒 settle 前提下不悬挂】。:50 `appendSessionSettings`（settings-session-log.ts:16-29）为同步、全程 try/catch ⇒ SettingsOutcome。filePathFor（settings-save.ts:13-23）同步。⇒ **恒 settle**；fulfill 形状：settings-save.ts:39/44（结构化失败）、:47/:51（`{ok:true, values: save.values}`，save.values 为 parseSettingsOperation 经 copySettings 的快照，settings-operation.ts:68-74 ⇒ 良构）。
     - 综上：**不存在任何 never-settling await 路径**；rejection 情形（理论上游 PRE 违反）也 settle，且被 client accept 的 `.catch` 折为结构化 OPERATION_FAILED（client.ts:39-42）——前提 b 无例外闭合。
  4. **服务端契约缺口**（转记总报告，非本函数可修）：若上游 copySettings 违反快照 PRE 返回 `{ok:true, value:undefined}`，:67/:47/:51 会产出 `{ok:true, values:undefined}`，client.ts:58 原样透传（畸形成功）。以 copySettings/pickValidFields 合同成立为前提，该缺口不可达。

## 自身异常合同（逐路径）

判断结构：:22-53 整体在 try（:23）内；catch（:47-52）内层再 try（:48-52），最内层为 `reportSettingsError`（:51，无条件 no-throw，fn-settings_error-reportSettingsError-L12.md）。因此向外逃逸 ⇔ catch 链自身抛出，逐点排除：

- :24 `!data` / `typeof data !== "object"`：运算符，不抛。
- :24 `"accept" in data`：`in` 触发 target 的 `has` 代理陷阱/普通属性扫描；陷阱抛出 ⇒ TypeError ⇒ :47。**contained**。
- :24 `typeof data.accept` 与 `data.accept` 属性读：Proxy `get` 陷阱抛出 ⇒ :47。**contained**。
- :25 `data.accept.bind(data)`（external-bind 缺口，见总报告）：`bind` 属性 get 陷阱抛出 ⇒ :47；`Function.prototype.bind` 对 callable 目标本体不抛（:24 已保证 typeof function），返回 bound function；**调用**该 bound function（:27/:31/:36/:46/:49）若底层 apply/目标 accept 抛出 ⇒ 全部位点在 try 内 ⇒ :47。**contained**。
- :26 `"session" in data` / `!data.session` / `typeof` / `Array.isArray(data.session)`（external-isArray.md，对任意值不抛）：同上，陷阱异常 ⇒ :47。**contained**。
- :27/:31/:36/:49 `Promise.resolve(settingsFailure(...))`：两因子均 no-throw ⇒ 不抛（external-resolve.md Form 2 普通值路径）。
- :34 `resolveSession(data.session, data.sessionId)`：合同返回 SettingsOutcome 不抛（Batch B，extension.ts:16-59 全程 try/catch）；属性读 `data.session`/`data.sessionId` 陷阱异常 ⇒ :47。**contained（双保险）**。
- :35/:39 布尔判定与 return：不抛。
- :40 `parseSettingsOperation(...)`：合同 no-throw 返回 SettingsOutcome（settings-operation.ts:31-79 全程 try/catch，他批 discharge；此处作 PRE 记录）；`"operation" in data ? data.operation : undefined` 的 `in`/get 陷阱异常 ⇒ :47。**contained**。
- :41-45 三元分派：`executeSettingsQuery`/`executeSettingsSave` 为 async 函数调用——**同步段异常被引擎转为返回 promise 的 rejection**，不同步抛出；rejection 由 client accept 的 `.catch` 消化（client.ts:39-42）⇒ 无 unhandled rejection、无逃逸。
- :46 `accept(result)`：accept 可抛（病态 emitter 注入 throwing accept）⇒ :47。**contained，但见边缘观察**：此时 `result`（成功支的 async promise）**尚无 rejection 观察者**；若其随后 reject ⇒ unhandled rejection（进程级诊断，非本函数向外抛）。仓内域下 accept = client.ts:36-47，已证恒不抛（fn-client-accept-L36.md）⇒ 不可达；仅病态 emitter 可达，记边缘观察非偏差。:49 兜底路径传 `Promise.resolve(良构失败)` 恒 fulfilled ⇒ 即使 accept 抛也无泄漏。
- :47-49 catch 体：`settingsFailure`（no-throw）+ `Promise.resolve`（普通值）+ `accept?.(...)`——accept 未绑定（:25 前抛出）时 `?.` 短路；accept 抛出 ⇒ :50 内层 catch ⇒ :51 `reportSettingsError`（no-throw）⇒ **catch 链终止，不可能二次逃逸**。
- 全文件无 `throw`/`Promise.reject` 语句（settings-service.ts 全文核实）⇒ 无显式偏差。宿主灾难性 OOM/终止单独声明（open-questions §其他）。

**对照 arch/prototype.md**：
- "registration returns structured failure if bus.on throws" 属 registerMySettingsService（:66-68），handler 不涉 ✔。
- **malformed request vs silent drop**：prototype.md 无显式 malformed-request 条款（仅 §6 session 身份绑定与"服务不存在时返回安装提示"）。handler 的静默丢弃位点：:24（缺/非函数 accept）与 ：39（resolver 判定该身份无活动会话）。对仓内 client 的可观察效果均为 SERVICE_UNAVAILABLE+安装提示（client.ts:50-55，结构化、no-throw）；:39 情形与"请求绑定当前 session 身份"（prototype §6）语义一致（非本会话的服务＝对该会话不可用）；:24 情形仅病态 emitter 可达（client 恒提供 accept，client.ts:36）。裁定：静默丢弃在 prototype 未指定处发生，效果不劣于结构化 SERVICE_UNAVAILABLE，**不判偏差，记为文档缺口**。缺 session/sessionId（:27/:31）与坏 operation（:40→INVALID_REQUEST）均为结构化失败，符合错误码教义 ✔；码域 ⊆ protocol.ts:35 ✔（无 PARTIAL_SAVE）。
- handler 不抛入 emit 调用栈 ✔（上文）；宿主 safeHandler（event-bus.ts:19-25）仅纵深防御。

## 霍尔逻辑 SP

{P: data ∈ 任意值域 V（含 Proxy/getter/throwing-accept 病态域）；accept 局部槽初值 ⊥（:22）；resolveSession/parse/executors 满足各自结构化 no-throw 合同；捕获 globalRoot/queue 为注册期 const}
body: 守卫链 ：24-40（每步异常 ⇒ catch）；分派 ：41-45（query ⇒ executeSettingsQuery | save ⇒ executeSettingsSave | !ok ⇒ Promise.resolve(operation)）；accept(result)（:46）；catch: accept?.(Promise.resolve(settingsFailure(OPERATION_FAILED, e)))（:49），内层异常 ⇒ reportSettingsError（:51）
{Q: 恒同步返回 undefined ∧ ∀data∈V 无异常逃入 emit 栈 ∧ 每 accept 位点传入 promise 恒 settle 且 fulfill 形状 ⊆ SettingsResult ∧ client 存在时无新增 unhandled rejection ∧ 返回路径上 accept 至多被调一次（:27/31/36/46 各后随 return/终点）}

## 并发/异步义务

- **handler 重入（两次 emit 交错）**：handler 全同步、所有状态（accept、session、operation、result）为每次调用局部 ⇒ 单线程下两次派发天然串行，无共享槽。跨请求共享仅经 resolveSession→extension `active`（只读比较，extension.ts:18-21）与 executors 的 fs/日志层：写路径由 withFileMutationQueue 按目标路径串行（extern-model §Pi lifecycle），队列 action 内重读 existing（settings-files.ts:56）⇒ 进程内无丢失更新；查询路径只读、两个并发 query 各自 `Promise.all` 互不干扰，isCurrent 双检（settings-query.ts:33/42）容忍交错（过期 ⇒ SESSION_UNAVAILABLE，结构化）。
- **handler 异常 vs accept settlement**：accept 前任何异常 ⇒ catch 兜底 accept（:49）传恒 fulfilled 良构 promise ⇒ 无泄漏；accept 后（:46 成功支）无后续语句，异常面为空；accept 自身抛出 ⇒ 见自身异常合同边缘观察（仓内不可达）。
- **duplicate accepts（client 侧）**：handler 每次调用至多 accept 一次（每位点后随 return/终点，:27/31/36/46/49）；catch 兜底只在前序 accept 未发生或抛出时执行 ⇒ 不存在 handler 主动双 accept；client 端 first-accept-wins（client.ts:38/43）已由 fn-client-accept-L36.md 闭合。
- **dispose-then-emit**：handler 不引用 `dispose`（:22-53 无引用）⇒ 无 handler 内注销路径；注销后 emit 不再派发本 handler ⇒ client SERVICE_UNAVAILABLE（client.ts:50-55）；进行中的 executeSettings promise 不受注销影响（其响应已 accept）。
- **double registration**：registerMySettingsService 若被调两次 ⇒ 同通道两个 handler ⇒ 同一请求被 accept 两次 ⇒ client 首认领胜出、次者落选（client.ts:38/43，仍无泄漏）。仓内唯一调用点 extension.ts:14，宿主单次加载前提下不发生（fn-extension-mySettings-L11.md PRE）；handler 自身不设防，记为 caller PRE 非偏差。
- 异步义务唯一来源是传给 accept 的 executors promise；其 settle 性与形状已证（调用者契约 POST 3），client 侧 reaction 挂接时序（accept 同步内创建即挂 .catch，client.ts:39）由 Batch A 闭合。
