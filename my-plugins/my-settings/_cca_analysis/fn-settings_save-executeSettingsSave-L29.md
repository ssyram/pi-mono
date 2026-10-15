---
fn: "settings-save.ts:L29::executeSettingsSave"
source: "settings-save.ts"
line: 29
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_save-executeSettingsSave-L29.md

## 综述

导出 async 保存执行器（settings-save.ts:29-52，entries.json 入口 + settings-service.ts:44 dispatch save 支）：filePathFor 路由（:37）→ 文件步骤（:38-48：Only 变体失败/成功即返回、不触日志；AndSession 失败诊断+吞掉）→ 日志步骤决定整体结果（:50-51）。无顶层 try/catch——安全性由「全部被调函数合同（filePathFor PRE 域 no-throw、saveFileOnly 恒 settle fulfilled、appendSessionSettings 任意域 no-throw、reportSettingsError 无条件 no-throw）+ 剩余语句域内不可抛」构成，与姊妹执行器 executeSettingsQuery 同构。**Batch C accept-settle 义务 DISCHARGED**（调用者驱动契约 POST 1/2）；五操作语义逐锚点 ✔ prototype §5（语义对照节）；**PARTIAL_SAVE 不存在于错误码联合（protocol.ts:35）及任何保存路径**（逐字核实）。

## 契约（调用者驱动）

调用者：settings-service.ts:44（handler 三元 save 支；返回 promise 在 ：46 交请求方 accept——Batch A/B 的 settle 与形状前提由本报告闭合）；extern-model.md 列其为独立可调用导出（测试域）。

- **PRE-A（经 parseSettingsOperation 的仓内域）**：`op` ∈ 五保存操作白名单（settings-operation.ts:5-11/:36）；`save` = `{globalPath, localPath ∈ string∪{null,undefined}, values = copySettings ok 良构快照}`（fn-settings_operation-parseSettingsOperation-L31.md POST ok+save）；`session` = resolver 产物（cwd: string、isCurrent/getBranch/appendEntry 端口合同——fn-extension-registerMySettingsService-L16.md）；`globalRoot: string`（extension.ts:60）；`queue` = withFileMutationQueue（extension.ts:61 → :18 → :44 透传）。
- **PRE-B（独立可调用导出的下界）**：`save` 非 null/undefined 对象；`session` conforming（cwd: string、isCurrent callable 端口）；`globalRoot: string`；`queue` 函数。类型说谎域行为如实记录：`save` = null ⇒ :37 filePathFor 内读 `save.globalPath` TypeError ⇒ rejection；`session.cwd` 非 string ⇒ join TypeError ⇒ 同上；`session.isCurrent` 非 callable ⇒ :26 bind TypeError ⇒ 同上。**rejection 仍属 settle**，且被 client accept `.catch` 折为结构化 OPERATION_FAILED（fn-client-accept-L36.md）——外层纵深防御，不参与本函数 no-throw 证明。记 **PRE 边界非偏差**（与 executeSettingsQuery PRE-B 同判例）；仓内唯一生产调用点恒满足 PRE-A。
- **POST 1（always-settles 定理——Batch C 转发义务）**：PRE-A 域内返回 promise 恒 **settle fulfilled**，值 ∈ SettingsResult（protocol.ts:43）。证链：(1) **await 全集 = {:42 saveFileOnly}，恰一处**——:50 `appendSessionSettings(session, save.values)` 为**同步调用、无 await**（settings-save.ts:50-51 源码核实；该函数本身非 async，fn-settings_session_log-appendSessionSettings-L16.md）；:36-41/:43-49 全同步；(2) :42 被等待对象恒 settle fulfilled（saveFileOnly 定理 → writeSettingsFile 恒 settle fulfilled，fn-settings_files-writeSettingsFile-L40.md）⇒ await 必推进且不抛；(3) 同步段调用面——filePathFor（PRE-A 域 no-throw，本批）、reportSettingsError（无条件 no-throw）、appendSessionSettings（**任意域** no-throw，本批）——与语句面（全等比较、`path && !path.ok` 于 filePathFor 返回值（本模块新建对象/undefined，属性读不抛）、对象字面量、条件 return）均不可抛；(4) 全文件无 `throw`/`Promise.reject` 语句（settings-save.ts 全文核实）⇒ 无显式偏差、无内部 reject 构造 ∎。理论 PRE-B 违约的同步抛出转 rejection——仍 settle，被 accept .catch 消化（同 executeSettingsQuery 报告注记）。唯一悬挂面 = :42 链上宿主 fs/queue 永不 settle（JS 合同外，并发节声明）。
- **POST 2（ok 良构链——Batch C 转发义务第二半）**：:47/:51 的 `{ok:true, values: save.values}` 良构。链条：client invoke 载荷 → handler settings-service.ts:40 `parseSettingsOperation` → **ok 支 `values = copySettings(原始 values)` 快照**（settings-operation.ts:68-76）→ :44 原样透传为本函数 `save` → :47/:51 回传 `save.values`。良构性由 copySettings ok 定理承接（fn-json_settings-copySettings-L4.md：ok ⇒ JSON.parse 域、无访问器/循环/孔洞/原型污染）。**双独立验证**：:47 可达 ⇒ written.ok ⇒ writeSettingsFile :47-48 已对 `save.values` 过 copySettings 闸；:51 可达 ⇒ logged.ok ⇒ appendSessionSettings :21-22 已对 `values` 过 copySettings 闸——两条 ok 支路**各自独立**证明 values 为合法 JSON Settings ⇒ client.ts:58 的 `{ok:true, values:undefined}` 透传缺口在保存侧双重不可达 ✔（与查询侧 settings-query.ts:66-67 链对称，fn-settings_service-on-L21.md 契约缺口条目据此闭合）。
- **POST 3（结构化失败位点全表）**：:39（路径解析失败，Only 变体；INVALID_REQUEST 透传）；:44（文件写失败，Only 变体；code ⊆ {INVALID_REQUEST, SESSION_UNAVAILABLE, OPERATION_FAILED}，D 值域）；:51（日志步骤结果 = save-session/AndSession 的总裁决；code ∈ {SESSION_UNAVAILABLE（:20）, INVALID_REQUEST（:22）, OPERATION_FAILED（:27）} ∪ 端口失败码）。全部 ⊆ protocol.ts:35 ✔ **无 PARTIAL_SAVE**。诊断位点：:40/:45 `reportSettingsError`（无条件 no-throw）——恰在 AndSession 文件步骤失败时输出，≙ prototype `catchAndPrint`。

## 自身异常合同（逐路径）

- :36 `op === "..." || op === "..."`：全等比较，不抛。
- :37 `filePathFor(op, save, session, globalRoot)`：PRE-A 域 no-throw（fn-settings_save-filePathFor-L13.md；settingsFilePath 任意域 no-throw + join 于 string cwd）；PRE-B 违约域 ⇒ PRE 边界（上文）。
- :38 `path && !path.ok`：undefined 短路；filePathFor 返回值恒为本模块新建 SettingsOutcome 对象或 undefined ⇒ 属性读不抛。
- :39/:44 `return path` / `return written`：结构化透传，不抛。
- :40/:45 `reportSettingsError(path.error.message / written.error.message)`：无条件 no-throw（fn-settings_error-reportSettingsError-L12.md）✔；`path.error`/`written.error` 属性读于结构化失败对象（settingsFilePath/settingsFailure 形状）⇒ 不抛。
- :42 `await saveFileOnly(path.value, save, session, queue)`：`path.value` 读于 ok 对象不抛；被等待对象恒 settle fulfilled（本批 saveFileOnly 定理）⇒ await 必推进、无 rejection 逃逸；宿主 fs/queue 永不 settle ⇒ 悬挂（JS 合同外，显式义务）。
- :43 `written.ok` / :46 `!andSession`：布尔判定，不抛。
- :46-47 `return {ok:true, values: save.values}`：字面量构造 + `save.values` 属性读（解析器新建普通对象）⇒ 不抛。
- :50 `appendSessionSettings(session, save.values)`：**任意域 no-throw**（fn-settings_session_log-appendSessionSettings-L16.md 定理）⇒ 直接调用边界安全；**同步、无 await** ✔（转发义务核验）。
- :51 `logged.ok ? {ok:true, values: save.values} : logged`：不抛。
- 无 `throw`/`Promise.reject` 语句 ⇒ 无显式偏差。宿主灾难性 OOM/进程终止不属 JS 异常合同；崩溃一致性注记（rename 提交后进程死亡 ⇒ 文件已提交而响应丢失）归 writeSettingsFile D 报告，本函数行为一致（悬挂或响应丢失，不抛）。

## 霍尔逻辑 SP

{P: PRE-A；filePathFor PRE-A 域 no-throw；saveFileOnly 恒 settle fulfilled；appendSessionSettings 任意域 no-throw；reportSettingsError/settingsFailure no-throw（全部已证）}
body: andSession := op ∈ {save-global-and-session, save-local-and-session}（:36）；path := filePathFor(op, save, session, globalRoot)（:37；save-session ⇒ undefined）；path ∧ ¬ok ⇒ Only: return path（:39）∣ And: diagnose（:40）+ 吞；path ∧ ok ⇒ written := await saveFileOnly(path.value, save, session, queue)（:42，恒推进）；written ∧ ¬ok ⇒ Only: return written（:44）∣ And: diagnose（:45）+ 吞；written ∧ ok ∧ Only ⇒ return {ok:true, values: save.values}（:46-47）；☐ logged := appendSessionSettings(session, save.values)（:50，同步）；return logged.ok ? {ok:true, values: save.values} : logged（:51）
{Q: promise 恒 settle；PRE-A 域内恒 fulfilled ∈ SettingsResult 且 ok 支 values 良构（POST 2 链）；失败位点 ⊆ {:39,:44,:51} 结构化且 code ⊆ protocol.ts:35（无 PARTIAL_SAVE）；诊断位点 ⊆ {:40,:45}；副作用 ⊆ {≤1 文件原子写 + ≤1 日志追加 + ≤2 诊断}}

## 并发/异步义务

- **AndSession 两步语义（:36-51）**：文件步骤失败被诊断并**吞掉**（:40/:45），日志步骤恒尝试并决定整体（:50-51）✔ prototype §5"catchAndPrint =<< saveGlobalOnly/saveLocalOnly; saveSession values；整体结果等于 saveSession 的结果"。文件成功 + 日志失败 ⇒ 返回失败而文件已提交，无自动回滚 ✔ §5"组合返回 Error 时文件可能已提交……不自动回滚"（注记：文件成功步的静默与 catchAndPrint 只打印 Error 一致，非偏差）。
- **Only 变体恒不写日志**：save-global-only/save-local-only 的全部支路（:39/:44/:46-47）均在 :50 之前 return ⇒ 恒不追加日志 ✔ §5"纯写对应文件，不写 session 日志"；**save-session 恒不写文件**：filePathFor :19 返回 undefined ⇒ :38/:41 两分支全跳过 ⇒ 直达 ：50-51 ✔ §5 `saveSession = addNewPiLog`。
- **isCurrent 复查窗**：文件路径的会话现役性由 writeSettingsFile 内部双闸承担（settings-files.ts:53-55/:63-65；提交前复查残余窗 ：63→:66 不可消除，D 报告已声明）；日志路径的现役性由 appendSessionSettings :18 门承担（本批，gate→use 零窗口）。两层闸独立：文件提交后、日志门前会话失效 ⇒ 返回 SESSION_UNAVAILABLE、文件保留（无回滚）——与 prototype"文件与 session 日志不是一个事务"一致。
- **日志追加后于文件写（:50 在 ：42 await 之后）**：日志步骤恒在文件步骤 settle 后执行；两步之间有 await 让点 ⇒ 并发查询可能观察到「文件已新、日志未追加」的中间态——prototype 未规定两步原子性（§5"文件与 session 日志不是一个事务"），最终态语义（会话 overlay 高于文件层）不受影响，非偏差。日志条目只记 values（{values} 形状，appendSessionSettings :23-25）✔ §2/§5"日志条目只记 values"。
- **并发保存串行化**：同文件 RMW 经宿主队列互斥（fn-settings_files-writeSettingsFile-L40.md）；save-session 不入队列，两次并发日志追加按到达顺序入账、合并时后写覆盖 ✔ fn-extension-appendEntry-L46.md 并发节。并发 Only 写与查询的读写原子性由 rename 提交保证（无撕裂读，executeSettingsQuery 报告注记同源）。
- **悬挂义务（JS 合同外）**：:42 链（fs promise/宿主队列永不 settle）⇒ 本函数 pending ⇒ handler accept pending ⇒ client invoke pending——链路无超时、不抛、不泄漏。【unknown：宿主 fs/队列实现】。

## 语义对照（arch/prototype.md §5，逐锚点）

| 锚点 | prototype | 代码 | 裁决 |
| --- | --- | --- | --- |
| saveGlobalOnly = globalFile + saveFile | :222-224 | :20-21 路由 + :41-48 文件步，恒不触 ：50 | ✔ |
| saveLocalOnly = localFile + saveFile | :226-228 | :22 路由（根 = session.cwd/.pi ≙ projectRoot，与查询侧同锚）+ 同上 | ✔ |
| saveGlobalAndSession = catchAndPrint 文件步 + saveSession | :230-232 | :40 诊断+吞 → :50-51 日志步裁决 | ✔ |
| saveLocalAndSession 同构 | :234-236 | :45 诊断+吞 → :50-51 | ✔ |
| saveSession = addNewPiLog（无文件） | :238 | :19 undefined → :38/:41 跳过 → :50-51 | ✔ |
| 文件失败诊断并吞（AndSession） | :81 catchAndPrint / :242 | :40/:45 reportSettingsError + 不 return | ✔ |
| Only 路径失败 = 硬 Error | :144/:149 `<-?` | :39/:44 结构化 return | ✔ |
| Only 文件成功返回值 | Result 语义 | :47 `{ok:true, values: save.values}` | ✔ |
| 日志条目只记 values | :78 / §2 | appendSessionSettings :23-25 `{values}` | ✔ |
| 保存基线 = RAW 原文件、损坏不覆盖 | :209/:217 | writeSettingsFile action（D 报告，:56-58） | ✔ |
| 错误码联合无 PARTIAL_SAVE | §5/§6 教义 | protocol.ts:35 四码；全部失败位点码域 ⊆ 该联合 | ✔ |
