---
fn: "settings-files.ts:L51::queue"
source: "settings-files.ts"
line: 51
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_files-queue-L51.md

## 综述

**匿名 async 箭头闭包**（settings-files.ts:51-81），manifest 以调用点 callee 命名为 `queue`——真实构造是 `writeSettingsFile` 内 `queue(target, async (): Promise<SettingsOutcome<void>> => {...})` 的 action 实参，由宿主 `withFileMutationQueue`（extension.ts:61 传入，settings-save.ts:26/:34 透传）在目标文件的队列轮到时调用（extern-model.md op=file-mutation-queue；native 证据 packages/coding-agent/src/core/tools/file-mutation-queue.ts:32-60）。执行序：isCurrent 闸（:53-55）→ 读原文件（:56-57，损坏即弃写）→ 浅合并 `{...existing.value, ...patch.value}`（:58，**RAW 原文件为基线**）→ 写临时文件（:62，wx 旗标）→ isCurrent 复查（:63-65）→ 原子 rename（:66-67）→ finally 未提交则 unlink 清理（:69-77）。全 body 位于 try（:52-80），catch 折叠 OPERATION_FAILED（:79）。**action 恒 settle fulfilled、永不 reject** ⇒ 队列链（host 实现 ：54 `return await fn()`）必前进。

## 契约（调用者驱动）

- registered_as：`file-mutation-queue` 的 queued-mutation-action——宿主队列按 realpath 键串行同文件变更后调用本闭包（调用者 = withFileMutationQueue，非仓内 manifest 函数）。
- 入参环境（闭包捕获）：`target`（writeSettingsFile :50 的 realpath 化绝对路径）、`patch.value`（copySettings ok 值，良构 JSON）、`isCurrent`（SettingsSession 端口 = extension.ts:26 闭包经 settings-save.ts:26 `session.isCurrent.bind(session)` 绑定）。
- PRE：patch.ok === true（:48 已闸）；target 为绝对路径串。
- POST：恒返回 `Promise<SettingsOutcome<void>>` 且 **fulfilled**（逐 await 归纳见下）；`ok:true` ⇔ rename 已提交（:67 committed 置位先于 ：68 返回）；`ok:false` 的 code ∈ {SESSION_UNAVAILABLE（:55/:65）, OPERATION_FAILED（:79）, OPERATION_FAILED（readSettingsFile 失败透传 :57，其 message 保留）, isCurrent 失败原样透传（:54/:64，code 由端口决定，仓内为 OPERATION_FAILED）}。
- 类型注记（良性）：:54/:64 返回 `SettingsOutcome<boolean>`（isCurrent 值）而非 void——TS void 返回位协变放行；运行时仅 `.ok` 被消费（settings-save.ts:43），ok:true 情形的 value 字段不被读取；记录为注记非偏差。

## 自身异常合同（逐 await 全枚举）

- :53 `isCurrent()`——**同步直调，非 await**。端口合同（Batch B 已证 extension.ts:26-35 全程 try/catch ⇒ 无条件 no-throw）：gate→use 语义为同步调用取得 `SettingsOutcome<boolean>`，无 promise、无悬挂。边界声明：本 action 依赖"isCurrent 不抛"这一已证事实；即使未来端口违约抛出，异常落 ：78 仍折叠为 OPERATION_FAILED，不破坏 no-throw（双保险）。
- :54-55 闸未过：结构化返回，无 I/O。
- :56 `await readSettingsFile(target)`：fn-settings_files-readSettingsFile-L27.md 已证恒 settle fulfilled ⇒ 本 await 不产生 rejection。!ok ⇒ :57 返回其失败 ⇒ **损坏原文件（非法 JSON/顶层非对象/I/O）时保存停止且不写任何字节**（:62/:66 未达）✔ prototype.md §5。
- :58 `{...existing.value, ...patch.value}`：两操作数均为 copySettings 域普通对象 ⇒ 展开不抛；浅合并右偏 ✔ prototype `x <> y`；`__proto__` 键经 CreateDataProperty 落为自身属性，无原型污染。`${JSON.stringify(..., null, "\t")}`（external-stringify）：操作数为无环无 bigint 的 JSON 树 ⇒ 规范 throw 域不可达，不抛。
- :59 `randomUUID()`（external-randomUUID）：同步；CSPRNG 缺失等宿主级故障可抛 ⇒ :78 **contained**。
- :62 `await writeFile(temporary, text, {encoding:"utf8", flag:"wx"})`（external-writeFile）：rejection 域——EEXIST（wx 撞名；temporary 含 randomUUID ⇒ 概率可忽略，发生时 ⇒ :78 structured，finally 清理仍跑）、ENOSPC/EACCES/ENOENT（目录被并发删除）/EISDIR ⇒ 全部 :78 **contained**。
- :63 `isCurrent()`：同 :53，同步 no-throw 直调（提交前复查）。
- :64-65 复查失败：经 finally（committed=false ⇒ unlink 清理）后返回结构化失败 ✔。
- :66 `await rename(temporary, target)`（external-rename）：temporary 与 target 同目录（:59 `join(dirname(target),...)`）⇒ 同一文件系统 ⇒ **EXDEV 跨设备不可达**；其余 EACCES/ENOENT ⇒ :78 **contained**。POSIX rename 对已存在 target 原子替换 ✔（atomicWriteObject 语义）。
- :69-77 finally：`committed` 标志保证提交成功（:67）后不清理（tmp 已不存在）；未提交路径 `await unlink(temporary)`（external-unlink）内层 try/catch（:71-75）——unlink 失败（含 ENOENT：writeFile 本就失败时 tmp 不存在）⇒ `reportSettingsError(error)`（no-throw ✔）诊断后吞掉。**内层 catch 是必要设计**：若无它，finally 中 unlink 的 rejection 会**替换** try 体原异常——现设计中原始 rejection/返回值不受 finally 影响 ✔。
- :78-80 catch：settingsFailure no-throw ✔。
- 无 `throw`/`Promise.reject` 语句（settings-files.ts:51-81 核实）⇒ 无显式偏差。

**always-settles 归纳**：await 集合 = {readSettingsFile（恒 fulfilled，L27 报告）, writeFile（reject ⇒ :78）, rename（reject ⇒ :78）, unlink（reject ⇒ 内层 catch）}；同步 throw 域 = {isCurrent 违约、randomUUID、stringify 病理域} ⇒ 全部 :78。⇒ action promise 恒 fulfilled。宿主队列 `return await fn()`（file-mutation-queue.ts:54）随之 settle，finally `releaseNext()`（:56）释放后续排队者 ⇒ **队列链前进**（Batch C 义务：action-never-rejects ⇒ 链推进成立；即使 action reject，host finally 仍释放，链也不会死锁——本设计使该后备分支不可达）。

对照 arch/prototype.md §5 saveFile：`ensureCurrentSession` → `readRawObject` → merge → `ensureCurrentSession` → `atomicWriteObject` 的五步序与本 action 的 ：53→:56→:58→:63→:66 逐点对应 ✔；"只有文件不存在才允许从 empty 创建"（readSettingsFile ENOENT→{}）✔；"原文件损坏必须停止"（:56-57）✔。

## 霍尔逻辑 SP

{P: patch.value 良构 JSON（:48 闸）；target 绝对路径；isCurrent 端口 no-throw（Batch B）；readSettingsFile 恒 settle（L27）；队列互斥（宿主保证同 target 串行）}
body: current := isCurrent()（:53）；¬ok ∨ ¬value ⇒ return 结构化失败（:54-55）；existing := await readSettingsFile(target)（:56）；¬ok ⇒ return existing（:57，零写入）；text := stringify(existing ⊕ patch)（:58，⊕ 右偏浅合并）；tmp := dirname(target)/".settings.json.<uuid>.tmp"（:59）；committed := false；writeFile(tmp, wx)（:62）；latest := isCurrent()（:63）；¬ok ∨ ¬value ⇒ return 失败（:64-65，经 finally 清理）；rename(tmp, target)（:66）；committed := true；return ok（:67-68）；finally ¬committed ⇒ unlink(tmp) 吞错诊断（:70-76）；任何异常 ⇒ return OPERATION_FAILED（:78-80）
{Q: 恒 fulfilled 且值 ∈ SettingsOutcome<void>；ok ⇒ target 内容 = existing ⊕ patch（原子替换）；¬ok ⇒ target 未被本 action 修改 ∧ tmp 已清理（或清理失败已诊断）；无 rejection 逃逸；队列释放}

## 并发/异步义务

- **互斥依赖**：正确性（读-改-写原子性）依赖宿主队列对同 realpath 的串行化（file-mutation-queue.ts:33-52）。序列化键=宿主入队时的 realpath；writeSettingsFile 在 :50（入队前）自行 realpath 一次得 target——**双重 realpath 窗口**：两读之间目录符号链接被并发重定向时，target 与队列键可能指向不同文件，互斥失效（固有 TOCTOU，非本批可消除；发生率与危害同普通竞态，记录义务）。
- **TOCTOU 语义（isCurrent 复查）**：:63 在 writeFile 后、rename 前复查，把"会话已失效却提交"的窗口压缩到 ：63 与 ：66 之间（亚毫秒）；会话在该窗内失效时提交仍发生——设计为"提交点前一刻会话有效即提交"，与 prototype 双 `ensureCurrentSession` 模式一致 ✔，残余竞态声明为不可消除。
- finally 中 await unlink：清理串行于失败返回之前，不并发泄漏 tmp；tmp 命名含 UUID ⇒ 并发不同 action 互不撞名。
- 无 unhandled rejection：所有 promise 均被 await。
- 【unknown】宿主 fs 永不 settle（writeFile/rename 挂起）⇒ action 挂起、队列头阻塞——JS 异常合同外，列为此处显式异步义务。
