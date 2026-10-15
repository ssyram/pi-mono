---
function: writeSettingsFile
source: {file: "settings-files.ts", line: 33}
self_consistency: mismatch
---

## 综述

`writeSettingsFile(path, values, queue, isCurrent)` 是模块导出的 async 写入 helper（settings-files.ts:33-55）：把整个"读-改-写"过程作为 action 交给调用方注入的文件互斥队列（宿主 `withFileMutationQueue`，见下"对 callee 的期望"）——在 lane 内先查会话所有权（L40），读旧文件（L41，非法文件即中止、不覆盖），合并为顶层键补丁（L42），经临时文件 + `wx` 写入 + 原子 rename 落盘（L44-49），rename 前再查所有权（L48）；任何失败清理临时文件后把原错误以 Promise rejection 外传。失败最多表现为 rejection（由服务端折叠为结构化错误），文件侧为强异常安全（rename 前目标文件零改动）。

## 调用者驱动契约

callgraph 入边：`execute → writeSettingsFile`（callgraph.json L175-177）。

1. **execute 保存分支（settings-service.ts:54）**：`await writeSettingsFile(savedPath, values, queue, session.isCurrent)` —— **不在任何本地 try/catch 内**。前提：savedPath 是 settingsFilePath 刚成功返回的路径（svc:48-50）；values 是 `operation.save.values`，即 parseSettingsOperation→copySettings 的产物（settings-operation.ts:31）——保证为无循环、JSON 可序列化的普通对象深拷贝；queue 是宿主 `withFileMutationQueue`（extension.ts:18 注入）；`session.isCurrent` 是 extension.ts:14 的所有权闭包。期望：文件被补丁更新（existing 键保留、values 顶层键整值覆盖，README:85）；任何失败以 rejection 表达并上抛 execute → settings-service.ts:89 `.catch` → `OPERATION_FAILED`；写成功但后续日志失败 → svc:57-63 报 `PARTIAL_SAVE`（文件不回滚，README:87）。
2. **独立模块导出 caller（entries.json:13）**：需自行满足 values 可 JSON 序列化、queue 具备互斥语义、isCurrent 反映真实所有权——函数不校验（见 [SELF]）。
3. **测试**：范围外。

## 契约

### Pre（调用前须成立）
- path 为 string（违反 → 队列 realpath 阶段 rejection，非 UB）。
- **[SELF] values 须为无循环、JSON 可序列化的普通对象**（L42 `JSON.stringify` 遇循环/BigInt/抛错 getter 会 throw → rejection 外传；服务路径由 copySettings 前置保证，独立直调路径函数自身无守卫——确认风险，见自洽）。
- **[SELF] queue 须实现"同路径互斥、action 拒绝向外传播、finally 释放"的宿主语义**（extern-model.md 'Mutation queue and Promise dispatch'）；传入无互斥语义的可调用对象 → 读-改-写竞态（丢更新），函数无从察觉。
- **[SELF] isCurrent 须返回 boolean 且语义为"发起保存的会话仍当前"**（返回恒 true 不构成 UB，但使 L40/L48 的会话切换防护失效，PARTIAL_SAVE 语义退化到 execute 的 svc:57 兜底检查）。

### Post
- 成功：resolve `undefined`；`path` 文件内容 = `{...existing, ...values}` 的 tab 缩进 JSON + 换行（顶层键：existing 的键保留、values 同名键整值替换、无深层合并——README:24、85；`__proto__` 经对象 spread 以自有属性复制，不改原型）；目标文件只经原子 rename 整体替换，并发读者见旧或新完整内容。
- 失败：reject **原始 Error**，且 `path` 旧内容不变（rename 前一切失败只动了临时文件；临时文件在 L50-52 清理，清理自身失败被吞、可能残留 `.tmp` 文件——无目标文件损坏）。reject 来源穷举：
  - 队列阶段（L39 `await queue(...)`，action 未运行）：宿主 realpath 失败（EACCES/ELOOP/NUL 路径等非 ENOENT/ENOTDIR 错误）；
  - L40 / L48 `!isCurrent()` → `Error("Settings session changed before saving")`（会话在途切换）；
  - L41 readSettingsFile 的 rejection（非 ENOENT I/O、非法 JSON、非对象文件——**非法旧文件不会被覆盖**，README:85）；
  - L42 stringify 抛（仅违反 [SELF] values 前提时可达）；
  - L45 mkdir rejection（EACCES/ENOTDIR/EIO 等）；
  - L47 writeFile rejection（EEXIST 撞名/EACCES/ENOSPC/EISDIR）；
  - L49 rename rejection（EACCES/EPERM/ENOENT 等；EXDEV 不可达——临时文件与目标同目录）；
  - isCurrent 本身抛（外部前提）。
- 异常安全档：目标文件为 **strong**（要么旧内容要么完整新内容）；临时文件为 basic（尽力清理，可能残留）。

### 对 callee 的期望（下传 demand）
#### queue（宿主 withFileMutationQueue，参数注入；manifest 无此 external 条目——按 extern-model.md 'Mutation queue and Promise dispatch' 建模，未建 external 文件）
- 调它时已保证：path 为 string、action 为 async 闭包（即 manifest 节点 settings-files.ts:L39::queue）。
- 需要它保证：同 path 串行执行 action（进程内 realpath 键 lane）；action 的 resolve/reject 原样传播给本函数的 `await`；lane 在 finally 释放（不因 action 失败而泄漏锁）；队列自身注册阶段失败（realpath 非 ENOENT/ENOTDIR）以 rejection 传播。**不得假设它恒成功或吞错。**

#### settings-files.ts:L39::queue（queue action 闭包，manifest 独立节点，fn 文档在别的批次；即 L39-54 的 async 箭头）
- 调它时已保证：由 queue 在持有 path lane 后调用；闭包捕获 path/values/queue/isCurrent。
- 需要它保证：完成上述读-改-写序列；一切失败以 action promise 的 reject 表达（含 finally 清理后 rethrow 原错误，L52）；不在 reject 之外留下半更新状态。

#### isCurrent（extension.ts:L14::isCurrent，manifest 节点，fn 文档在别的批次）
- 调它时已保证：无（无参）。
- 需要它保证：返回 boolean（真值语义 = 会话仍当前）；不产生除抛错外的其他副作用；抛错可接受（计入 rejection 路径）但需知晓。

#### readSettingsFile（本模块，见其 fn 文档）
- 调它时已保证：path 合法、持有 lane。
- 需要它保证：ENOENT → `{}`；其余失败 → reject（本函数依赖 reject 来中止覆盖非法文件）。

#### stringify / dirname / join / randomUUID / mkdir / writeFile / rename / unlink（external-*.md，本次已建）
- 调它们时已保证：见各 external 文档 Pre（string 入参、目录已建等）。
- 需要它们保证：writeFile "wx" 独占创建全量写；rename 原子整体替换（同目录内无 EXDEV）；mkdir recursive 幂等；unlink 失败可被 `.catch(()=>{})` 吞掉（L51 清理尽力而为）；stringify 在 [SELF] 前提下不抛。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**（async 函数：一切失败以 rejection 外传；无同步 throw——首语句 L39 即进入 queue 调用，queue 非可调用时也是 async 体内的 TypeError → rejection）：
- settings-files.ts:40 显式 `throw`（会话切换）—— **偏差**。
- settings-files.ts:48 显式 `throw`（rename 前会话切换）—— **偏差**。
- settings-files.ts:52 显式 `throw error;`（清理后 rethrow 原错误）—— **偏差**。
- settings-files.ts:41/42/45/47/49/39 的 callee 失败向外的传播（readSettingsFile、stringify、mkdir、writeFile、rename、队列注册）—— **偏差**。
- L51 `unlink(temporary).catch(() => {})` 是唯一被吞的失败（清理尽力而为，可能残留 `.tmp`）。

**异常在服务/插件边界的包含效果**（不降低上面标准）：唯一服务内 caller（svc:54）无本地 catch，rejection 上传至 settings-service.ts:89 `.catch` → `OPERATION_FAILED` accept → 外层 Pi 受保护；错误码不区分 I/O 失败与会话失败（信息损失）。独立模块导出 caller 不 catch 时 rejection 直接外传。宿主灾难性 OOM/进程终止不属于普通 JS 异常（extern-model 约定）——尤其 rename 与日志追加之间无跨文件/会话事务（extern-model.md:50），进程死在该窗口会留下"文件已新、日志未记"且无人报告的状态。

## 并发

- **[CONC] 文件互斥（进程本地）**：全部读-改-写（L40-L52）都在 queue 为 `path` 获取的 lane 内执行；同进程对同 path 的并发 writeSettingsFile 串行化；不同 path 并行。队列是进程本地，**不防跨进程丢更新**（README:133）——两个 Pi 进程并发保存同一文件可互相覆盖补丁，本函数无对策（记录为已知边界，非本函数可修）。
- **[CONC] 与无队列读者竞态**：execute 查询路径（svc:35）不经 lane 直接读——因 rename 原子性只会读到完整旧/新内容，无撕裂；本函数对读者无额外义务。
- **[CONC] TOCTOU（会话所有权）**：L40（读前）与 L48（rename 前）两次检查之间、以及 L48 与 rename 提交之间都存在窗口——会话可在最后一次检查后失效，文件仍会被本函数提交（无回滚）；缺口由 execute 的日志前复查（svc:57）兜住为 `PARTIAL_SAVE`。即：所有权防护是"尽力 + 显式报告"，不是硬互斥。
- **[CONC] 同一会话并发 save**：多个 action 在各自 path 的 lane 内串行；同 path 的两个 save 按到达顺序提交，后者的 read-modify-write 看到前者的结果（lane 语义保证）。

## SP

【L39】`await queue(path, action)`：进入宿主队列——注册（realpath(path) 为键；非 ENOENT/ENOTDIR 的 realpath 失败 → registration reject → 本 await reject，**action 未执行**，出口①）；等待 lane 后执行 action。lane 释放由宿主 finally 保证（action reject 也不泄漏锁）。
【L40】`!isCurrent()` → throw E_cur（"Settings session changed before saving"）→ action reject → 传播为出口②；此时未读未写。
【L41】`existing = await readSettingsFile(path)`：ENOENT → existing={}；非 ENOENT/非法 JSON/非对象 → rejection 传播（出口③，目标文件未触碰——README:85 不覆盖语义的实现点）。合流不变量：existing 为普通对象深拷贝。
【L42】`text = JSON.stringify({...existing, ...values}, null, "\t") + "\n"`：values 满足 [SELF] 前提时不抛；违反时 TypeError → 出口④（目标文件未触碰）。
【L43-44】dir = dirname(path)；temporary = join(dir, ".my-settings.json.<uuid>.tmp")。纯计算。
【L45】`await mkdir(dir, {recursive:true})`：目录已存在不抛；失败 → 出口⑤（此刻无临时文件，无泄漏）。
【L46-49】try 块：
  【L47】writeFile(temporary, text, wx)：失败 → catch L50；成功 → temporary 存在且内容完整。
  【L48】`!isCurrent()` → throw E_cur → catch L50；
  【L49】`await rename(temporary, path)`：失败 → catch L50；成功 → path=新内容、temporary 消失。
【L50-53】catch：`await unlink(temporary).catch(()=>{})`（临时文件不存在时 ENOENT 被吞；清理失败被吞、可能残留）→ `throw error`（rethrow 原错误，非清理错误）→ action reject（出口⑥）。
【合流 Post】resolve(undefined)（rename 成功）∨ reject（出口①-⑥，path 原内容不变）。逐出口资源核查：所有出口都无未释放 lane（宿主 finally）、无未清理目标文件改动；仅出口⑥的 unlink 失败可留 `.tmp` 残留。
【度量/终止】无循环；队列等待由宿主 lane 链保证有界（前驱 finally 释放）。

## 自洽

- caller 期望对齐：execute 与 README:85-87 的语义（补丁合并、非法文件不覆盖、原子替换、PARTIAL_SAVE）与实现逐条对应；ENOENT→{} 与 owner"仅 ENOENT 算空配置"判据一致。
- **偏差 → self_consistency=mismatch**：L40/L48/L52 显式 throw 与六类 callee 失败外传，均违反 extern-model.md:7 的全函数不外抛要求（确认风险：错误折叠完全依赖 svc:89 的 OPERATION_FAILED 兜底，丢失错误类别）。
- **确认风险（守卫缺失）**：[SELF] values/queue/isCurrent 三前提在"独立模块导出"调用面上无本地校验（values 循环 → L42 stringify throw；queue 无互斥 → 竞态；isCurrent 恒真 → 防护失效）。服务路径由 parseSettingsOperation/extension.ts 注入消解，独立路径留待主 agent 裁决是否补守卫。
- 对 queue action 节点、isCurrent、readSettingsFile 的期望与各自源码一致；对宿主队列的语义以 extern-model + 宿主源码（file-mutation-queue.ts:33-56）核实，无未消解假设。
