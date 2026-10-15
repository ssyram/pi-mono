---
function: settings-service.ts:L17::execute
source: {file: "settings-service.ts", line: 17}
self_consistency: aligned
---

## 综述

服务的操作执行核心（settings-service.ts:17-65）：入口做会话所有权检查（svc:23）；query 分支把 defaults < global 文件 < project 文件 < session 日志四层合并、只返回 defaults 声明的键（svc:24-42）；save 分支（global/project）先经互斥队列原子写文件（svc:46-54）、再在所有权复查后把补丁深拷贝追加进会话日志（svc:56-58），文件已写而日志失败时报 `PARTIAL_SAVE` 并前缀已写路径（svc:60-62）。**异步裸层**：除日志段的本地 catch（svc:59-63）外，rejection 不在本地折叠——统一由唯一调用点的 `.catch`（svc:89，manifest fn settings-service.ts:L89::catch）折叠为 OPERATION_FAILED。

## 调用者驱动契约

callgraph 入边：`settings-service.ts:L73::on → execute`（svc:89 实调点，callgraph.json:234-237）；`settings-service.ts:L67::registerMySettingsService → execute`（extractor 把嵌套 handler 内调用归到 L67 的伪影边——机制同 open-questions.md:12 对 L67→accept 的裁定，实调点在 on 内）。

1. **on handler（svc:89，fn-settings_service-on-L73.md:70-72 已落盘期望）**：调它时已保证——operation 为 parseSettingsOperation 的合法产物（svc:88）；session 为 resolveSession 认领产物（svc:86，ext:12-17 形态）；globalRoot/queue 为注册期闭包常量（ext:18 注入）。期望：返回 `Promise<SettingsResult>`；execute 层面 **reject 是允许的**，一切 rejection 最终由 svc:89 `.catch` 折叠——结果形态必须是 SettingsResult（折叠由 settingsFailure 的 total 性保证）。
2. **README 语义（经 on → 客户端）**：查询按 scope 优先级合并（README:67-70）；保存 = 文件补丁 + 会话日志、非事务（README:87 文件不回滚、PARTIAL_SAVE 标识部分持久化）；错误一律结构化、不静默回退（README:72）。

## 契约

### Pre（调用前须成立；[SELF] 消解与上传见文末清单）

- operation：parseSettingsOperation 产物——op ∈ {query, save-global, save-local, save-session}；query.defaults / save.values 为 copySettings 深拷贝（无循环、纯 JSON 值的普通对象）；globalPath/localPath ∈ {undefined, null, string}（svc:88 保证）。
- session：resolveSession 认领产物——SettingsSession 形态：cwd 为 string、isCurrent/getBranch/appendEntry 为端口方法（ext:12-17；宿主 cwd/会话 API 前提见 external-*.md）。
- globalRoot：string（svc:70 注册期常量 ← ext:18 getAgentDir()，external-getAgentDir.md 前提）。
- queue：宿主 withFileMutationQueue（extern-model 'Mutation queue and Promise dispatch' 语义）。
- 无 UB 级前提需 execute 自行新增：输入侧形态全部由上游校验/类型/外部前提覆盖（各 [SELF] 消解记录见文末）。

### Post（出口穷举见 SP；成功/错误分支在此刻画）

- **query 成功（出口 F）**：`{ok:true, values}`——values 仅含 defaults 的键；每键值 = 按优先级 `session 日志 > project 文件 > global 文件 > defaults` 合并（svc:40 spread 次序）后的结果（README:67-70）；scope="global" 时不读项目文件与日志。
- **save 成功（出口 J）**：`{ok:true, values}`——values 为原补丁（README:90）；save-global/save-local 已原子更新对应文件（existing 键保留、values 顶层键整值覆盖）；日志已追加。
- **PARTIAL_SAVE（出口 I）**：文件已写但所有权复查失败（svc:57）或 appendEntry 失败（svc:58）——`{ok:false, error:{code:"PARTIAL_SAVE", message:"Saved <savedPath>, but session log failed: <原始信息>"}}`（svc:60-61）；文件不回滚（extern-model.md:50 无跨文件/会话事务）；**不写日志进替换后的会话**（svc:57 先于 svc:58）。session scope 时 savedPath 恒 undefined → 同路径折叠为 OPERATION_FAILED（saveSession 文档"无 PARTIAL_SAVE"的依据）。
- **SESSION_UNAVAILABLE（出口 A/D）**：入口检查失败（svc:23）或文件读取后复查失败（svc:38）。
- **INVALID_REQUEST（出口 B/G）**：路径计算抛错（svc:29/30/49/50 → catch）。
- **OPERATION_FAILED（出口 C/E/H 经 svc:89 折叠；出口 I 的 session-scope 形态）**：文件读取失败（非 ENOENT I/O、非法 JSON、copySettings 校验/超深）、getBranch/readSessionSettings 失败（损坏日志、宿主 API 失败）、writeSettingsFile 全部 rejection 源（I/O、会话切换、isCurrent throw）、isCurrent 在 svc:23/38 点 throw。
- 副作用：query 只读（文件 + 会话分支）；save 至多写一个文件（原子替换）+ 至多一条日志（`{scope, values: copySettings(values)}`，深拷贝防后续别名泄漏）。不修改 operation/session。
- 宿主 OOM/进程终止：尤其进程死在 svc:54 与 svc:57 之间的窗口 = "文件已新、日志未记"且无人报告——extern-model.md:50 明示无跨文件/会话事务，单独注明（非普通 JS 异常）。

### 对 callee 的期望（下传 demand）

#### isCurrent（ext:14，manifest fn extension.ts:L14::isCurrent，并行批次）
- 调它时已保证：无参；调用点为所有权复查点 svc:23（入口）/ svc:38（读取后）/ svc:57（日志前）/（svc:54 以 `session.isCurrent` **未绑定方法引用**传入 writeSettingsFile，files:40/48 执行）。
- 需要它保证：同步返回 boolean 所有权快照（`active === owner && getSessionId() === sessionId` 的即时求值）；可能 throw（外部前提）——throw 在 svc:23/38/54 点 → execute reject → svc:89 折叠，在 svc:57/files:40/48 点 → 结构化 PARTIAL_SAVE/OPERATION_FAILED，均含。

#### settingsFailure（settings-error.ts:3）
- 需要它保证：恒返回结构化失败且不抛（svc:23/32/38/60 四出口的 nothrow 依据）。

#### settingsFilePath（settings-files.ts:9）
- 调它时已保证：root 为 string（[SELF] 消解 1）、configured ∈ {undefined, null, string}（parseSettingsOperation）。
- 需要它保证：合法 → root 内绝对路径；非法 → 抛两种固定消息 Error（被 svc:31/51 catch → INVALID_REQUEST）。

#### join（external-join.md）/ Promise.all（external-all.md，本批）/ Object.keys（external-keys.md，本批）/ Object.fromEntries（external-fromEntries.md，本批）
- 需要它们保证：join 纯词法拼接不抛（string 实参）；Promise.all 全 fulfill 才 resolve、首 reject 即 reject（svc:34-37 无本地 try，依赖其透传）；keys 返回 defaults 的自有可枚举 string 键（defaults 为 copySettings 产物 → 普通对象，无敌意输入）；fromEntries 对 pair 数组不抛。

#### readSettingsFile（settings-files.ts:22）
- 调它时已保证：path 为 settingsFilePath 刚成功返回的绝对路径（svc:29/30）。
- 需要它保证：ENOENT → `{}`；其余失败 → reject（svc:34-37 无本地 try，README:72 错误不回退依赖 reject 而非静默回退）。

#### readSessionSettings（settings-session-log.ts:4）
- 调它时已保证：entries 为 `session.getBranch()` 返回值（svc:39，[SELF] 消解 3 / 上传 getBranch）。
- 需要它保证：良构输入下按序合并或对损坏日志 throw（→ execute reject）；空/无匹配 → `{}`。

#### getBranch（ext:15，manifest fn，并行批次）——[SELF] 上传目标
- 需要它保证：返回数组且**每个元素为非 null 的条目对象**（readSessionSettings L7 裸属性读的前提；宿主 sessionManager 外部前提——上传该 fn 契约固化）。

#### writeSettingsFile（settings-files.ts:33）
- 调它时已保证：path 为 settingsFilePath 产物、values 为无循环 JSON 深拷贝（[SELF] 消解 2）、queue 为宿主队列、isCurrent 为未绑定提取的所有权闭包（ext:14 为箭头属性、不依赖 this——见问题清单）。
- 需要它保证：成功原子更新文件；一切失败以 rejection 表达（svc:54 无本地 try，原样上传）。

#### appendEntry（ext:16，manifest fn，并行批次）——[SELF] 上传目标
- 需要它保证：同步转发宿主持久化请求；失败**以 throw 形式可见**（extern-model "It can fail"）——svc:59 catch 的 PARTIAL_SAVE/OPERATION_FAILED 报告依赖该失败形态真实可达（不得静默吞掉失败伪装成功）。

#### copySettings（json-settings.ts:17，svc:58）
- 调它时已保证：values 已在 parseSettingsOperation 验过（幂等通过）；需要它保证：返回等值深拷贝（防日志条目与补丁对象别名）——其 fn 文档 caller 4 期望一致。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

execute 为 async 函数——**可能向外 reject**（裸异步层，调用点 .catch 折叠是设计的一部分）；显式 throw 一处（svc:57，被 svc:59 即时捕获）。逐条 source:line：

- svc:23 `session.isCurrent()` throw（外部前提：getSessionId 失败）——**未捕获传播** → execute reject。
- svc:29/30/49/50 `settingsFilePath` 抛（两种固定消息）——**被捕获**（svc:31-33 / svc:51-53）→ INVALID_REQUEST。
- svc:34-37 `await Promise.all([readSettingsFile(globalFile), ...])` **不在任何 try 内**：readSettingsFile 的非 ENOENT I/O 错误 / JSON.parse SyntaxError / copySettings Error（含超深输入 RangeError）——**未捕获传播** → execute reject。
- svc:38 `session.isCurrent()` throw——**未捕获传播** → execute reject。
- svc:39 `readSessionSettings(session.getBranch())` 裸调：getBranch throw（外部前提）/ readSessionSettings 的损坏日志 throw / copySettings Error / 元素非对象 TypeError——**未捕获传播** → execute reject。
- svc:40/41 spread、keys、map、fromEntries：defaults/merged 为 copySettings 产物普通对象——不可达 throw。
- svc:54 `await writeSettingsFile(...)` **不在 try 内**：其全部 rejection 源（队列注册失败、files:40/48 会话切换 throw、readSettingsFile 失败、stringify 违约、mkdir/writeFile/rename I/O、isCurrent throw）——**未捕获传播** → execute reject。
- svc:57 显式 `throw new Error("my-settings session changed before logging")`——**被 svc:59 捕获**（设计信道：会话切换 → PARTIAL_SAVE）。
- svc:58 `session.appendEntry(...)` throw（extern-model）/ `copySettings(values)` 理论深度缝隙 throw——**被 svc:59 捕获**。
- svc:60 settingsFailure 不抛；svc:61 message 模板赋值不抛。
- **rejection 出口合计：{svc:23, svc:34-37, svc:38, svc:39, svc:54}**；svc:57/58 异常折为 PARTIAL_SAVE/OPERATION_FAILED。

### 【服务/插件边界的包含效果】

- 唯一包内调用点 svc:89 `.catch`（manifest fn settings-service.ts:L89::catch，其 total 性已论证）把上述全部 rejection 折叠为 `OPERATION_FAILED` 结果 → accept（svc:90）收到的 Promise **恒 resolve** → 服务边界零逃逸（owner 判据：失败最多是结构化 SettingsResult error）。代价：一切执行期失败统一 OPERATION_FAILED（message 保留原文案可诊断；错误码粒度变粗——batch 1 多份文档已记同款观察）。
- PARTIAL_SAVE 路径满足"部分持久化必须显式报告"（extern-model.md:50）；不写日志进替换会话。
- 宿主 OOM/进程终止除外（见 Post 注）。

## 并发

- **[CONC] 会话替换窗口（active 闭包变量，ext:7，bind/session_shutdown 写）**：所有权 = `active === owner && getSessionId() === sessionId` 的即时快照。execute 的 await 点与复查点配对：
  - svc:23 检查 → svc:34 await 之间替换 → **svc:38 复查拦截** → SESSION_UNAVAILABLE。
  - svc:38 检查 → svc:39 读取之间：**全同步，无窗口**。
  - svc:54 await（文件写入）期间替换 → **svc:57 复查拦截** → PARTIAL_SAVE（文件已写、日志未记、显式报告；日志绝不写入替换后的会话）。
  - svc:57 检查 → svc:58 appendEntry 之间：**全同步，无窗口**。
  - 残余：rename 提交（files:49 await）发生在最后一次所有权检查（files:48）之后——会话可在 rename await 期间替换，文件仍提交；由 svc:57 兜为 PARTIAL_SAVE。防护语义 = 尽力检查 + 显式报告，非硬互斥。
- **[CONC] 队列 lane**：文件写经宿主 withFileMutationQueue 同 path 串行（进程本地）；svc:35/36 查询读**不在 lane 内**——依赖 rename 原子性，只见完整旧/新内容，无撕裂（external-rename.md）。
- **[CONC] 并发请求**：多 emit → 多 execute 并行；query 只读安全；并发 save 同 path 由 lane 串行（后者 read-modify-write 见前者结果）、不同 path 并行；save 与 query 交叠由 rename 原子性覆盖。
- 所有权复查点汇总：svc:23（入口）、svc:38（读取后）、files:40（lane 内读前）、files:48（rename 前）、svc:57（日志前）——appendEntry 仅在 svc:57 通过后调用。

## SP

- [L23] `!session.isCurrent()` → return SESSION_UNAVAILABLE（出口 A）。合流不变量：入口时刻所有权成立。
- [L24-25] query 分支：解构 `{defaults, globalPath, localPath, scope = "session"}`——defaults 为深拷贝普通对象、scope ∈ 三值、路径 ∈ {undefined,null,string}（svc:88 保证）。解构含默认值运算，无异常。
- [L26-27] 声明。
- [L28-33] try：svc:29 `settingsFilePath(globalRoot, globalPath)` → 抛 → INVALID_REQUEST（出口 B）；svc:30 scope ≠ "global" → `settingsFilePath(join(session.cwd, ".pi"), localPath)` → 抛 → 出口 B。合流：globalFile 为绝对路径；localFile 在 scope="global" 时 undefined、否则绝对路径。
- [L34-37] `await Promise.all([readSettingsFile(globalFile), localFile ? readSettingsFile(localFile) : Promise.resolve({})])`——无本地 try：任一 reject → **execute reject（出口 C）**。成功：global/project 均为深拷贝普通 Settings。
- [L38] `!session.isCurrent()`（await 窗口后复查）→ SESSION_UNAVAILABLE（出口 D）。
- [L39] scope === "session" → `current := readSessionSettings(session.getBranch())`：getBranch 抛 / 损坏日志 throw → **execute reject（出口 E）**；否则 `current := {}`。
- [L40] `merged := {...defaults, ...global, ...project, ...current}`——四层 spread 优先级递增（session 最高）；普通对象 spread 无异常。
- [L41] return `{ok:true, values: Object.fromEntries(Object.keys(defaults).map(k => [k, merged[k]]))}`（出口 F）。不变量：defaults 为 copySettings 产物 → 每键自有、值 ∈ SettingValue 且非 undefined → merged[k] ∈ SettingValue。
- [L43-44] save 分支：`values := operation.save.values`（深拷贝产物）；scope 由 op 判别（svc:44 三元）。
- [L46-53] scope ≠ "session"：try 内 svc:49/50 计算 savedPath → 抛 → INVALID_REQUEST（出口 G）。合流：savedPath 已设（绝对路径）。
- [L54] `await writeSettingsFile(savedPath, values, queue, session.isCurrent)`——无本地 try：rejection → **execute reject（出口 H）**。成功：文件已原子更新；await 期间会话可能被替换（残留风险由 svc:57 兜）。
- [L56-58] try：svc:57 `!isCurrent()` → **显式 throw E_cur** → svc:59 catch；svc:58 `appendEntry(MY_SETTINGS_ENTRY_TYPE, {scope, values: copySettings(values)})` throw → svc:59 catch。
- [L59-63] catch：`failure := settingsFailure(savedPath ? "PARTIAL_SAVE" : "OPERATION_FAILED", error)` → savedPath 已设时 message 前缀 `"Saved <savedPath>, but session log failed: "` → return（出口 I）。
- [L64] return `{ok:true, values}`（出口 J）。
- 出口穷举：A/D（SESSION_UNAVAILABLE）、B/G（INVALID_REQUEST）、C/E/H（reject → svc:89 → OPERATION_FAILED）、I（PARTIAL_SAVE ∨ session-scope OPERATION_FAILED）、F/J（ok:true）。终止：无循环、有限 await 链。Post 达成。

## [SELF] 前提（消解记录与上传清单）

1. **（就地消解）settingsFilePath 的 root 须为 string**：svc:29/49 的 globalRoot ← ext:18 `getAgentDir()`（外部宿主 API，external-getAgentDir.md：返回绝对路径 string）；svc:30/50 的 `join(session.cwd, ".pi")` 中 session.cwd ← ext:13 ← ExtensionContext.cwd（宿主保证 string，extern-model 'Pi lifecycle dispatch' 外部前提）。依据为 extern 前提，**不需 execute 输入新条件**——不升级为对 on handler 的 [SELF]。
2. **（就地消解）writeSettingsFile 的"values 无循环 JSON"**：svc:54 的 values ← svc:43 ← parseSettingsOperation（settings-operation.ts:31 copySettings——JSON 往返产物，结构上无循环、可序列化）。已就地满足。
3. **（消解→[SELF] 上传 getBranch）readSessionSettings 的"entries 元素非 null 对象"**：svc:39 实参为 `session.getBranch()`（宿主 API）。按 extern-model 判定：分支条目由宿主构造，外部前提为良构条目数组；该前提作为 [SELF] **上传给 extension.ts:L15::getBranch**——其契约须固化"返回数组、元素均为非 null 条目对象"（违反 → readSessionSettings L7 TypeError → svc:89 折叠 OPERATION_FAILED，含但非意图）。
4. **（残余记录，不要求新保证）copySettings 的"嵌套深度在栈限内"**：checkValue 递归无上限。总线输入（parseSettingsOperation，svc:88 在 handler try 内 → INVALID_REQUEST）与文件输入（svc:34-37/54 路径 → execute reject → svc:89 OPERATION_FAILED）均为敌意输入残余风险：正常数据满足；敌意超深数据以 RangeError 被服务边界折叠为结构化错误。svc:58 二次 copySettings 同类（深度恰在 parse 与记录两栈深之间的输入 → PARTIAL_SAVE；理论缝隙，已被包含）。
5. **[SELF] 上传 isCurrent（ext:14）**：同步返回 boolean；可能 throw（外部前提）——throw 点全部被包含（svc:23/38/54 → OPERATION_FAILED；svc:57/files:40/48 → PARTIAL_SAVE/OPERATION_FAILED），无 UB。
6. **[SELF] 上传 appendEntry（ext:16）**：失败须以 throw 可见——PARTIAL_SAVE 显式报告依赖该失败形态；不得静默吞错伪装成功。
7. **[SELF] 上传 map（svc:41，manifest fn settings-service.ts:L41::map）**：defaults/merged 须为普通 JSON 对象（keys/fromEntries/spread 无异常的前提）——由 copySettings 产物性质就地满足。

## 自洽

- 与 on handler 期望对齐："execute 层面 reject 是允许的，结果形态必须是 SettingsResult（折叠由 svc:89 + settingsFailure 保证）"（fn-settings_service-on-L73.md:72）——本函数 rejection 出口集合与该分工一致。
- 与 client 侧文档逐条对应：优先级合并（fn-client-query-L34.md:15）、PARTIAL_SAVE 消息前缀（fn-client-saveGlobal-L35.md:27）、saveSession 无 PARTIAL_SAVE（fn-client-saveSession-L37.md:15——savedPath 恒 undefined 的 svc:60 三元）、SESSION_UNAVAILABLE 两处检查。
- 与 readSettingsFile/readSessionSettings/settingsFilePath/writeSettingsFile/copySettings/parseSettingsOperation 各 fn 文档的包含路径一致（非 ENOENT → reject；损坏日志 → throw；路径非法 → INVALID_REQUEST）。
- svc:57 显式 throw 为设计拒绝信道（被 svc:59 即时捕获、转化为结构化 PARTIAL_SAVE），与 parseSettingsOperation/readSessionSettings 同类判法 → aligned。
