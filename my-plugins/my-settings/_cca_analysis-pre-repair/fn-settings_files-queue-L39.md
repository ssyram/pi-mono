---
function: settings-files.ts:L39::queue
source: {file: "settings-files.ts", line: 39}
self_consistency: mismatch
---

## 综述

writeSettingsFile 传给宿主互斥队列的 async action 闭包（settings-files.ts:39-54，manifest 名 `queue` 为提取器对 `queue(path, async () => {...})` 调用点的命名，open-questions.md:21）：由宿主 `withFileMutationQueue` 在取得 `path` 的进程内文件 lane 后调用（extern-model 'Mutation queue and Promise dispatch'：lane 内串行调用 action、finally 释放、rejection 传播回 `await queue(...)` 的 writeSettingsFile）。lane 内执行：所有权检查（files:40）→ 读旧文件（files:41，ENOENT=空）→ 合并为顶层键补丁文本（files:42）→ 临时文件名（files:44）→ mkdir（files:45）→ `wx` 独占写临时文件（files:47）→ rename 前所有权复查（files:48）→ 原子 rename 提交（files:49）；失败路径清理临时文件（files:51，尽力、吞错）后 rethrow 原错误（files:52）。

## 调用者驱动契约

callgraph 静态边 `writeSettingsFile → queue`（callgraph.json:114-117）表达的是 enqueue 调用；action 本体的真实调用者是**宿主 withFileMutationQueue**（argument-passing 注册，见 edges/fn-settings_files-queue-L39.json 的 registered_as 事实）。callgraph 另有 `queue → isCurrent/readSettingsFile/catch-L51` 三条静态边（callgraph.json:130-141），与 action 体内的实调点一致。

1. **宿主 withFileMutationQueue（extern-model 'Mutation queue and Promise dispatch'）**：调它时已保证：已持有 path 的 lane（同进程同 path 串行）；无参调用。期望：action 以其返回 Promise 的 resolve/reject 报告结果；宿主观察该 Promise 并在 finally 释放 lane——action reject 也不得泄漏锁。
2. **writeSettingsFile（files:39 enqueue 侧，fn-settings_files-writeSettingsFile-L33.md:45-47 已落盘期望）**：调它时已保证：path 为 settingsFilePath 产物（svc:48-50）、values 为无循环 JSON 深拷贝（服务路径）、isCurrent 为 ext:14 所有权闭包。期望：完成读-改-写序列；一切失败以 action promise 的 reject 表达（含清理后 rethrow 原错误，files:52）；不在 reject 之外留下半更新状态。

## 契约

### Pre（调用前须成立）

- path：string、settingsFilePath 产物（绝对、root 内）——宿主队列注册阶段对非法 path 的拒绝（非 ENOENT/ENOTDIR realpath 失败）也归 rejection 通道（writeSettingsFile 文档出口①），action 未执行。
- **[SELF] values 须为无循环、JSON 可序列化的普通对象**（files:42 stringify 不抛的前提；服务路径由 parseSettingsOperation→copySettings 就地保证——[SELF] 消解 2；独立导出 writeSettingsFile 的直调路径函数无守卫——同 writeSettingsFile 文档的确认风险）。
- **[SELF] isCurrent 须返回 boolean 所有权快照**（ext:14；恒 true 不构成 UB 但使 files:40/48 防护失效——退化到 execute svc:57 的 PARTIAL_SAVE 兜底）。
- 由调用结构保证（非 caller 义务）：执行时已持有 path lane。

### Post

- **成功**：resolve `undefined`；path 文件内容 = `{...existing, ...values}` 的 tab 缩进 JSON + 换行（existing 键保留、values 顶层键整值覆盖、无深层合并——README:24/85；`__proto__` 经对象 spread 以自有属性复制、不改原型）；目标文件仅经原子 rename 整体替换；temporary 消失。
- **失败**：reject **原始 Error**，path 旧内容不变（rename 前一切失败只动临时文件）。reject 源穷举：
  - files:40 / files:48 `!isCurrent()` → `Error("Settings session changed before saving")`（所有权复查失败——extern-model 要求与 I/O 失败区分记录：本 action 内二者共用 reject 通道，区分靠错误 message 与触发点）；
  - files:41 readSettingsFile rejection（非 ENOENT I/O / JSON.parse SyntaxError / copySettings Error 含超深 RangeError——**非法旧文件不会被覆盖**，rejection 先于 files:42 发生）；
  - files:42 stringify throw（仅违反 [SELF] values 前提时可达）；
  - files:45 mkdir rejection（EACCES/ENOTDIR/EIO 等——try 外，无临时文件需清理）；
  - files:47 writeFile rejection（EEXIST 撞名/EACCES/ENOSPC/EISDIR）→ 进 catch；
  - files:49 rename rejection（EXDEV 不可达——临时文件与目标同目录）→ 进 catch；
  - isCurrent 自身 throw（外部前提）。
- 异常安全档：目标文件 **strong**（要么旧内容要么完整新内容）；临时文件 basic（尽力清理，unlink 失败被吞、可残留 `.tmp`）。

### 对 callee 的期望（下传 demand）

#### isCurrent（ext:14，manifest fn，并行批次）
- 调它时已保证：无参；调用点 files:40（读前）/ files:48（rename 前）。
- 需要它保证：同步返回 boolean 即时快照；throw 可接受（计入 rejection 路径，writeSettingsFile 文档已记）。

#### readSettingsFile（settings-files.ts:22）
- 调它时已保证：path 合法、持有 lane。
- 需要它保证：ENOENT → `{}`；其余失败 → reject（"非法文件不覆盖"语义依赖 reject 在写前中止）。

#### stringify / dirname / join / randomUUID / mkdir / writeFile / rename / unlink（external-*.md，均已存在）
- 需要它们保证：stringify 在 [SELF] 前提下不抛；writeFile `wx` 独占创建全量写；rename 原子整体替换；mkdir recursive 幂等；unlink 失败可被 `.catch(()=>{})` 吞掉（files:51 清理尽力而为）；randomUUID 不抛（external-randomUUID.md）。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

action 为 async 闭包——**可能向外 reject**（rejection 即它向 writeSettingsFile 报告失败的信道）。逐条 source:line：

- files:40 显式 `throw new Error("Settings session changed before saving")`（所有权检查失败）——**偏差**（显式 throw）。
- files:41 `readSettingsFile(path)` rejection——**未捕获 callee 传播**。
- files:42 `JSON.stringify({...existing, ...values}, null, "\t")`：values 满足 [SELF] 前提下不抛（existing 为 copySettings 产物、无 BigInt——checkValue 拒绝 bigint、无循环）；前提被违反时 TypeError——**未捕获传播**（仅独立导出路径可达）。
- files:45 `mkdir(dir, {recursive: true})` rejection——**未捕获传播**（try 外；此刻无临时文件，无清理义务）。
- files:47 `writeFile(temporary, text, {encoding: "utf8", flag: "wx"})` rejection → 进 catch。
- files:48 显式 `throw new Error("Settings session changed before saving")`（rename 前复查失败）→ 进 catch——**偏差**。
- files:49 `rename(temporary, path)` rejection → 进 catch。
- files:51 `await unlink(temporary).catch(() => {})`：清理失败**被吞**（全 action 唯一吞错点；unlink 不 sync throw，rejection 被空 catch 消费）——可残留 `.tmp` 临时文件，无诊断输出。
- files:52 显式 `throw error;`（rethrow 原错误而非清理错误）——**偏差**。

### 【服务/插件边界包含效果】

- action rejection → writeSettingsFile 的 `await queue(...)`（files:39，其无本地 try）→ execute reject（svc:54）→ svc:89 `.catch` → `OPERATION_FAILED` accept。**服务边界零逃逸**；代价：I/O 失败与会话切换共用 OPERATION_FAILED（错误码粒度粗，message 保留原文案）。
- 独立模块导出调用面（writeSettingsFile 直调）无该包含：rejection 直接外传（extern-model.md:7 记为偏差）。
- 宿主 OOM/进程终止除外：尤其 writeFile 与 rename 之间进程死亡残留 `.tmp`；rename 提交与 svc:57 日志检查之间无跨文件/会话事务（extern-model.md:50）。

## 并发

- **[CONC] lane 互斥（进程本地）**：files:40-52 全程在宿主为 path 获取的 lane 内；同进程同 path 的并发保存按到达顺序串行提交（后者的 read-modify-write 见前者结果）；不同 path 并行。队列不防跨进程丢更新（README:133——已知边界）。
- **[CONC] TOCTOU（会话所有权）**：files:40（读前）与 files:48（rename 前）之间有多个 await 窗口（files:41/45/47）；files:48 与 rename 提交（files:49 await）之间**仍有窗口**——会话可在最后一次检查后失效，文件仍被提交（无回滚）；缺口由 execute 的 svc:57 日志前复查兜为 PARTIAL_SAVE。防护 = 尽力检查 + 显式报告，非硬互斥。
- **[CONC] 与 lane 外读者（execute 查询 svc:35/36）竞态**：rename 原子性保证读者见完整旧/新内容，无撕裂。
- 闭包捕获 path/values/isCurrent 为本次 writeSettingsFile 调用的常量；isCurrent 每次调用即时求值（读 ext:7 的 `active`）——复查点即 TOCTOU 所述。

## SP

- [L40] `!isCurrent()` → throw E_cur → action reject（出口①：未读未写）。
- [L41] `existing := await readSettingsFile(path)`：ENOENT → `{}`；其余失败 → 传播（出口②：目标未触碰——"非法文件不覆盖"的实现点）。合流不变量：existing 为普通对象深拷贝。
- [L42-44] `text := stringify({...existing, ...values}, null, "\t") + "\n"`；`dir := dirname(path)`；`temporary := join(dir, ".my-settings.json.<uuid>.tmp")`。[SELF] 前提下无异常（违约 → 出口③：目标未触碰）。
- [L45] `await mkdir(dir, {recursive: true})`：已存在不抛；失败 → 出口④（无临时文件、无残留）。
- [L46-49] try：writeFile（L47）失败 → catch；`!isCurrent()`（L48）→ throw E_cur → catch；rename（L49）失败 → catch；成功 → path=新内容、temporary 消失。
- [L50-53] catch：`await unlink(temporary).catch(() => {})`（ENOENT/清理失败皆吞）→ `throw error`（**原错误**，非清理错误）→ action reject（出口⑤）。
- 出口穷举：R（resolve undefined）、①-⑤（reject，path 旧内容不变）；仅出口⑤的 unlink 失败可留 `.tmp` 残留。lane 释放在宿主 finally（与 action 结果无关）。终止：有限 await 链；lane 等待由宿主前驱 finally 保证有界。Post 达成。

## [SELF] 前提（上传 caller）

1. **values 无循环、JSON 可序列化**（files:42 stringify 不抛的前提）——服务路径就地消解（execute [SELF] 消解 2：parseSettingsOperation→copySettings）；独立导出 writeSettingsFile 的 caller 须保证（writeSettingsFile 文档同款确认风险，非新增）。
2. **isCurrent 返回 boolean 且语义正确**——上传给 writeSettingsFile 的注入侧（ext:14 满足；恒 true 使 files:40/48 防护失效但退化到 svc:57 兜底，非 UB）。
3. （承接 execute [SELF] 消解 4）existing 超深 → files:41 copySettings RangeError → rejection——服务边界折叠，残余记录。

## 自洽

- 与 writeSettingsFile 文档对 queue action 的期望（fn-settings_files-writeSettingsFile-L33.md:45-47）逐条对齐：完成序列、rejection 表达失败、rethrow 原错误、无半更新状态。
- **偏差 → self_consistency=mismatch**：files:40/48/52 显式 throw 与 files:41/42/45/47/49 失败外传违反 extern-model.md:7 的全函数不外抛要求（确认风险：错误折叠完全依赖 svc:89 兜底、错误类别损失；files:51 吞错可留 `.tmp` 残留且无诊断——记录为观察，留主 agent 裁决是否需要清理失败报告）。
