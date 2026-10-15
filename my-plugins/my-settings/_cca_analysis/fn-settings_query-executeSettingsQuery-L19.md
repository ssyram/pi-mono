---
fn: "settings-query.ts:L19::executeSettingsQuery"
source: "settings-query.ts"
line: 19
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_query-executeSettingsQuery-L19.md

## 综述

导出 async 查询执行器（settings-query.ts:19-68，entries.json 入口 + settings-service.ts:43 经 dispatch 调用）：解构查询（:24，scope 默认 `"session"`）→ global/local 路径解析（:25-28，失败=硬结构化失败；scope=global 短路跳过 local）→ defaults 验证快照（:30-31）→ isCurrent 门（:33-35，先于任何 await）→ `Promise.all` 并行读两文件（:37-40，元素为 loadFile×2 或 loadFile+`Promise.resolve({})`）→ isCurrent 复检（:42-44，陈旧窗口语义）→ scope=session 时读 session 覆盖层（:46-62，getBranch→readSessionPatches→逐补丁 pickValidFields，失败=诊断+跳过该层/该条）→ 浅合并 defaults < global < local < overlay（:64）→ defaults 键集投影 + copySettings 分离快照（:65-67）。**无顶层 try/catch**——安全性由「全部被调函数合同 no-throw + 剩余操作域内不可抛」构成：PRE 域内 promise **恒 settle fulfilled 且值良构**（Batch C accept-settle 义务在此闭合，下证）；PRE 之外的独立调用域单列（见调用者驱动契约）。对应 arch/prototype.md §4 `queryAt` 全部锚点逐条核对见下。

## 契约（调用者驱动）

调用者：settings-service.ts:43（handler dispatch 三元，其返回 promise 在 ：46 交给请求方 accept——Batch A/B 已证的 settle 义务由本报告闭合）；extern-model.md 列其为独立可调用导出（测试与潜在消费者）。

- **PRE-A（经 parseSettingsOperation 的仓内域）**：`query` 为该解析器 ok 输出 ⇒ globalPath/localPath ∈ string∪{null,undefined}、scope ∈ {"global","project","session"}∪{undefined}、defaults 为 copySettings 良构快照（fn-settings_operation-parseSettingsOperation-L31.md POST）；`session` 为 resolver 产物（extension.ts:22-55：cwd: string=owner.context.cwd（extension.ts:25）、isCurrent/getBranch 合同不抛且恒返回 SettingsOutcome，fn-extension-isCurrent-L26.md / fn-extension-getBranch-L36.md）；`globalRoot: string`（extension.ts:60 getAgentDir()）。
- **PRE-B（独立可调用导出的下界）**：`query` 为**非 null/undefined 对象**（:24 解构对 null/undefined 抛 TypeError）；`session` 满足 SettingsSession 端口合同（cwd: string——非 string 使 ：27 join 抛 TypeError；isCurrent()/getBranch() 恒返回 SettingsOutcome——返回 undefined 使 ：34/:43 读 `.ok` 抛 TypeError，返回无 ok 垃圾对象则被 `!current.ok` 判 true 而原样透传为返回值，破坏 SettingsResult 形状）；`globalRoot: string`。以下类型说谎域（未满足 PRE-B）的行为如实记录：query 为原始值（非 null）⇒ 解构得全 undefined 字段 ⇒ :30 copySettings(undefined) ⇒ **结构化 INVALID_REQUEST，不抛**；query=null/undefined ⇒ rejection；session 缺失/非对象/isCurrent 非函数 ⇒ :33 TypeError ⇒ rejection。均记 **PRE 边界非偏差**（与 kindOf 的硬 PRE 同判例）；仓内唯一生产调用点恒满足 PRE-A。
- POST（always-settles 定理，Batch C 义务）：PRE-A/B 域内返回 promise **恒 settle fulfilled**，值满足 protocol.ts:43：`{ok:true, values}` 中 values 为 copySettings ok 快照（:66-67，良构、与全部输入对象零别名），或 SettingsFailure。证明链：(1) :24-:36 同步段——settingsFilePath（任意域 no-throw）、join（string 域不抛，cwd∈string 由 PRE）、copySettings（任意域 no-throw）、isCurrent（端口合同不抛）⇒ 无同步 throw；(2) 唯一 await（:37）的被等待对象恒 settle fulfilled——loadFile 恒 fulfill（fn-settings_query-loadFile-L9.md 定理）+ `Promise.resolve({})` 创建即 fulfilled（external-resolve.md Form 2）⇒ Promise.all 无 reject 元素（external-all.md：仅在元素 reject 时 reject）且无 pending 悬挂（除宿主 fs 永不 settle 的 JS 合同外域）⇒ await 必推进；(3) :42-:67 同步段——isCurrent/getBranch（端口合同不抛）、readSessionPatches（settings-session-log.ts:36-57 整体 try/catch，源码核实不抛）、pickValidFields（任意域 no-throw）、reportSettingsError（no-throw）、copySettings（no-throw）、对象展开/keys/map/fromEntries（JSON 域普通对象上不抛，见 fn-settings_query-map-L65.md）⇒ 无同步 throw；(4) 全文件无 `throw`/`Promise.reject` 语句（settings-query.ts 核实）⇒ 无显式偏差、无内部 reject 构造。∎（注：即便理论同步 throw，async 帧转 rejection 仍属 settle，且被 client accept `.catch` 折为结构化 OPERATION_FAILED——此为外层纵深防御，**不参与**本函数自身的 no-throw 证明。）
- POST（结构化失败位点全表）：:26（global 路径解析）、:28（local 路径解析）、:31（defaults 非法）、:34（isCurrent !ok 透传）、:35（会话失效 SESSION_UNAVAILABLE）、:43（isCurrent !ok 透传）、:44（会话切换 SESSION_UNAVAILABLE）、:67 失败支（最终快照拒绝透传）。错误码域 ⊆ protocol.ts:35，无 PARTIAL_SAVE ✔。
- POST（诊断位点全表）：loadFile 内来源失败与失配诊断（:11-14 经 loadFile）、:50（getBranch !ok）、:54（readSessionPatches !ok）、pickValidFields 逐键失配（:57 间接）、readSessionPatches 逐条损坏（:52 间接）。诊断全部经 reportSettingsError（已证 no-throw）。

## 自身异常合同（逐路径）

- :24 解构 `const { defaults, globalPath, localPath, scope = "session" } = query`：query=null/undefined ⇒ TypeError ⇒ async 帧转 rejection——**PRE-B 边界**（仓内 PRE-A 域恒为解析器 ok 输出的普通对象 ⇒ 不抛）；默认值 `scope = "session"` 仅在 scope===undefined 时生效（解构默认语义）✔ prototype `query = queryAt Session`（默认 session 层）。
- :25/:27 `settingsFilePath(...)`：合同任意域 no-throw（fn-settings_files-settingsFilePath-L10.md）。
- :26-28/:30-31/:34-35/:43-44 结构化 return：字面量/透传，不抛。
- :27 `join(session.cwd, ".pi")`（external-join.md）：string 分段不抛；cwd 非 string ⇒ TypeError ⇒ rejection——**PRE-B 边界**（PRE-A 域 cwd=owner.context.cwd 为宿主 string）。**scope=global 时此调用被三元短路完全跳过**（`scope === "global" ? undefined : ...`）——join 与 settingsFilePath 均不执行 ✔「scope=global 不得读 local」的读取侧（不仅不读文件，连路径解析都不做）；localPath 全文件唯一消费点就是 ：27，无其他 local 读 ✔。
- :28 `if (localFile && !localFile.ok)`：SettingsOutcome 恒对象（truthy）⇒ 等价 !ok；不抛。
- :30/:66 `copySettings(...)`：任意域 no-throw（fn-json_settings-copySettings-L4.md）。
- :33/:42 `session.isCurrent()`：端口合同同步返回 SettingsOutcome<boolean>、不抛（fn-extension-isCurrent-L26.md）⇒ 直接调用边界安全；返回 undefined 的端口违约域 ⇒ :34 TypeError ⇒ rejection——PRE-B 边界。
- :37-40 `Promise.all([...])`（external-all.md）：数组字面量迭代（数组迭代器，无用户代码）；元素构造本身不抛（loadFile 调用即 async fn 同步段：readSettingsFile 同步发起 readFile 并返回 promise；`Promise.resolve({})` 不抛）；**Promise.all 本身在此不可能 reject**——两元素均恒 fulfill（loadFile 定理 + external-resolve.md Form 2），Promise.all 仅在元素 reject 时 reject ∎。
- :48 `session.getBranch()`：端口合同不抛（fn-extension-getBranch-L36.md）⇒ 直接调用边界安全。
- :49-51/:53-54 `reportSettingsError(...)`：无条件 no-throw（fn-settings_error-reportSettingsError-L12.md）。
- :52 `readSessionPatches(branch.value)`：整体 try/catch、返回 SettingsOutcome、无 throw 语句（settings-session-log.ts:35-58 源码核实；正式报告归 Batch F）⇒ 调用点安全。
- :56-58 `for (const patch of patches.value)` + `overlay = { ...overlay, ...valid.value }`：patches.value 为 readSessionPatches 新建数组（可迭代，不抛）；展开目标为新建字面量 ⇒ CreateDataPropertyOrThrow，键为 copySettings 输出的字符串键（含 `"__proto__"` 时亦为自身数据属性，无原型污染，同 json-settings 往返语义）⇒ 不抛。
- :64 `merged = { ...validated.value, ...global, ...local, ...overlay }`：四个展开源均为 copySettings 输出/`{}`/其展开（JSON 域普通对象，无 Proxy、无访问器——loadFile/pickValidFields/validated 各自合同保证）⇒ CopyDataProperties 不执行用户代码 ⇒ 不抛。
- :65 `Object.fromEntries(Object.keys(validated.value).map((key) => [key, merged[key]]))`（external-keys/external-fromEntries，箭头见 fn-settings_query-map-L65.md）：keys 实参为 copySettings 输出 ⇒ 不抛；map 回调域内不可抛；fromEntries 条目为二元数组 ⇒ 不抛。
- :66-67 返回：不抛。
- 全文件无 `throw`/`Promise.reject` 语句 ⇒ 无显式偏差。宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions.md §其他），单独声明。

**端口前提（gate→use 同步性）逐条核验**：
1. :33 isCurrent 门**先于任何 await**（首个 await 是 ：37）✔——门前的 ：24-:31 全为同步结构化失败闸。
2. :42 复检位于 ：37 await 之后——陈旧窗口恰为「:37 两路 fs 读并行期间」：窗口内可发生 session 切换/注销/就地 id 改写（session-manager.ts:1713/:1745，fn-extension-isCurrent-L26.md TOCTOU 节）；复检在合并前将失效收敛为 SESSION_UNAVAILABLE（:44），窗口内读到的 global/local 随之整体丢弃、不部分采用 ✔。复检为**时刻谓词**：身份失效又复原（振荡）不可检测——与 prototype `ensureCurrentSession` 的时点语义一致，非偏差。
3. :48 getBranch 在 :42 门之后**同步**调用：精确交错 = await :37 恢复于微任务 → :42 isCurrent() → :43/:44 判定 → :46 赋值 → :47 比较 → :48 getBranch()，其间**无任何 await/让点** ⇒ 同一同步段 ⇒ 单线程下 bind/shutdown 不可能插入门与用之间 ✔（与 fn-extension-getBranch-L36.md「:42→48 同步段纪律」互证）。getBranch 不抛（B 已证）⇒ :48 直接调用边界安全 ✔。
4. 覆盖层之后的 ：64-:67 不再触端口、无 await ⇒ 无第三次检查义务（prototype §4 也只在合并前查两次，:171/:182）。

## 霍尔逻辑 SP

{P: PRE-A/B（query 为验证形状对象；session 端口合同成立、cwd:string；globalRoot:string）；全部被调函数各自合同（settingsFilePath/copySettings/pickValidFields/reportSettingsError/readSessionPatches 任意域 no-throw；isCurrent/getBranch 端口不抛；loadFile 恒 fulfill；settingsFailure no-throw）}
body: 解构 ：24（scope 默认 session）；globalFile := settingsFilePath(globalRoot, globalPath)（:25）!ok ⇒ return（:26）；localFile := (scope=global ? ⊥ : settingsFilePath(join(cwd,".pi"), localPath))（:27）存在且 !ok ⇒ return（:28）；validated := copySettings(defaults)（:30）!ok ⇒ return（:31）；isCurrent 门（:33）!ok/false ⇒ return（:34-35）；[global,local] := await Promise.all([loadFile(g,validated), localFile? loadFile(l,validated) : resolve({})])（:37-40，恒 fulfilled）；isCurrent 复检（:42）!ok/false ⇒ return（:43-44）；overlay := {}（:46）；scope=session ⇒ branch := getBranch()（:48）!ok ⇒ diagnose（:50）☐ patches := readSessionPatches（:52）!ok ⇒ diagnose（:54）☐ for patch：valid := pickValidFields（:57），valid.ok ⇒ overlay := overlay∪valid（:58）；merged := defaults⊕global⊕local⊕overlay（:64，右偏浅合并）；picked := fromEntries(map keys(validated))（:65）；detached := copySettings(picked)（:66）；return detached.ok ? {ok:true,values} : detached（:67）
{Q: PRE 域内 promise 恒 fulfilled，值 ∈ {ok:true, values=良构分离快照, 键集=keys(defaults)} ∪ SettingsFailure；无异常/rejection 逃逸；失败位点 ⊆ 结构化八处（见 POST 表）；副作用 ⊆ {≤2 次文件读 + 诊断流 + 零写入}——查询不写文件、不追加日志 ✔}

## 并发/异步义务

- **Promise.all 并行**（:37-40）：两路读无共享可变态（defaults 快照只读；两 path 独立），任一路失败自愈为 `{}` 不影响另一路；并行读不读同一写队列——查询侧不加文件锁，读到的可能是并发写的中间态？不会：写侧经 withFileMutationQueue 的 tmp+rename 原子替换（settings-files.ts:58-66），读侧 readFile 要么见旧文件要么见新文件，无撕裂读（rename 原子性为 POSIX 语义；非本函数义务，记为组合注记）。
- **陈旧窗口**：:33→:37（门与读之间无让点，无窗口）；:37→:42（真窗口，见端口前提 2——复检兜底）；:42→:48（无让点，无窗口）；:48 后无端口调用。isCurrent 双检纪律与 fn-settings_service-on-L21.md 并发节一致。
- **悬挂义务（JS 合同外）**：唯一悬挂面 = :37 的两路 readFile 永不 settle（宿主 fs 灾难/自定义 FS 挂起）⇒ 本函数 pending、handler 的 accept pending、client invoke pending——链路无超时，不抛不泄漏。【unknown：宿主 fs 实现】。
- **overlay 合并序**（:64）：defaults < global < local < session overlay ✔；overlay 内部 ：56-58 按 patches 旧→新右偏展开 ⇒ 后到的**合法**补丁覆盖先前值，后来失配的补丁键被 pickValidFields 丢弃、不遮先前合法值 ✔ prototype §4。
- **最终投影与分离**（:65-67）：fromEntries 按 keys(validated.value) 投影——overlay/global/local 中不在 defaults 键集内的键（其他插件的 key）被排除，不回传给请求方 ✔ prototype `pickKeys (keys defaults) combined`；copySettings(:66) 把 merged 中的全部别名（validated/global/local/overlay 共享的嵌套对象）替换为深拷贝 ⇒ 返回值与输入、与后续并发写完全隔离 ✔。copySettings(picked) 在 picked 全 JSON 域时 !ok 不可达（picked 键集 ⊆ merged ⊆ JSON 快照域），失败支 ：67 透传为防御性闭合。
- 重入：两次并发查询各自独立闭包帧（validated/overlay/merged 均帧局部）⇒ 互不干扰；并发查询与并发写的串行化由文件系统原子性与写侧队列保证（上文注记）。

## 语义对照（arch/prototype.md §4，逐锚点）

| 锚点 | prototype | 代码 | 裁决 |
| --- | --- | --- | --- |
| merge 序 | :183 `defaults <> global <> local <> session` | settings-query.ts:64 同序展开 | ✔ |
| scope=global 不读 local | :177-178 | :27 三元短路（连路径解析都跳过；localPath 唯一消费点 ：27） | ✔ |
| scope 默认 session | :167-168 `query = queryAt Session` | :24 `scope = "session"` | ✔ |
| scope=project 无 session 层 | :179-180 | :47 `if (scope === "session")` | ✔ |
| 逐键 kind 过滤、失配只丢本来源该键 | §3 parseQuery | :15/:57 pickValidFields（逐键诊断+丢弃） | ✔ |
| 低优先级合法值胜出 | §3 例子 | 失配只从该来源贡献中删键，merged 保留低层 | ✔ |
| 来源读失败 → 诊断+跳过 | :139-141 queryFile | loadFile :11-14（诊断+`{}`） | ✔ |
| 补丁结构损坏逐条跳过 | §2 readCurrentSessionPatches | readSessionPatches 内部 ：41-51 逐条诊断+跳过（settings-session-log.ts）；调用点 ：57-58 valid.ok 二道闸 | ✔ |
| 整层读失败 → 诊断+session 层空 | :157-159 | :49-51（getBranch）/ :53-54（readSessionPatches）诊断+overlay 保持 `{}`，查询**继续成功** | ✔ |
| 路径解析失败 → 硬 Error | :144/:149 `<-?` | :26/:28 结构化 return | ✔ |
| defaults 非法 → 硬 Error | :172 `<-?` | :30-31 结构化 return | ✔ |
| ensureCurrentSession ×2（入口+合并前） | :171/:182 | :33/:42（时点谓词，振荡不可检——同 prototype 语义） | ✔ |
| 查询不写文件/不写日志 | :195 | 全文件无写调用 | ✔ |
| 错误优先序 | :171 先 ensureCurrent 后 validateValues | :25-31 先路径后 defaults 后 isCurrent（:33） | 观察非偏差：多因失效时错误码选择不同（如「会话已死∧defaults 非法」prototype 报 SESSION、代码报 INVALID_REQUEST），两者均为结构化 Error，prototype 未把优先序定为规范语义 |

## unknowns

- 宿主 fs 层 promise 永不 settle ⇒ :37 悬挂（JS 合同外）。
- 宿主对 Array.prototype/Object.prototype 的注入篡改可使 :64-:65 偏离（环境篡改域，仓内不可控）。
- getBranch 返回值是时点快照且元素为活体引用（fn-extension-getBranch-L36.md）——readSessionPatches 只读消费，本函数内无变异窗口。
