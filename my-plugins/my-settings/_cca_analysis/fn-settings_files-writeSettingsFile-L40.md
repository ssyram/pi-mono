---
fn: "settings-files.ts:L40::writeSettingsFile"
source: "settings-files.ts"
line: 40
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_files-writeSettingsFile-L40.md

## 综述

异步保存编排器（settings-files.ts:40-84）：patch 验证（:47-48，copySettings）→ 建目录（:49，mkdir recursive）→ realpath 化目标（:50）→ **经宿主 `queue` 参数把读-改-写 action 入队**（:51-81，action 本体见 fn-settings_files-queue-L51.md）→ 一切同步/异步异常折叠 OPERATION_FAILED（:82-83）。依赖四方均已证安全：copySettings（无条件 no-throw + ok 良构）、readSettingsFile（恒 settle，经 action）、isCurrent 端口（Batch B no-throw，经 action）、settingsFailure/reportSettingsError（无条件 no-throw）。**恒 settle fulfilled、永不 reject**——executeSettingsSave（settings-save.ts:42 经 saveFileOnly :25-27）与 executeSettingsQuery 侧的 always-settles 前提由本文件证明。对应 arch/prototype.md §5 `saveFile` + `atomicWriteObject`。

## 契约（调用者驱动）

调用者（全仓 1 处）：settings-save.ts:26 `saveFileOnly` → `writeSettingsFile(path, save.values, queue, session.isCurrent.bind(session))`；saveFileOnly 又被 executeSettingsSave（settings-save.ts:29-52）await。测试直接调用（test/*，不在生产合同内）。

- PRE：`path` 为 settingsFilePath ok 值（根内绝对路径）；`values: Settings`（任意可JSON化与否均可——由 ：47 验证）；`queue: SettingsMutationQueue`（仓内实参 = 宿主 `withFileMutationQueue`，extension.ts:61 注册 → settings-service.ts 透传 → settings-save.ts:26/:42 传入）；`isCurrent` 为 SettingsSession 端口绑定。
- **fp 目标契约：`withFileMutationQueue`**（宿主提供，manifest externals 之外的函数值目标；其文件 external-withFileMutationQueue.md 由主 agent 回填，本节记录观测合同）：语义 = 同进程内按规范化文件键串行执行 `(path, action)` 的完整读-改-写并返回 action 结果（extern-model.md；native 证据 file-mutation-queue.ts:32-60）。观测到的失败面：(a) 队列内部 realpath（getMutationQueueKey）遇非 ENOENT/ENOTDIR 错误（如 EACCES/ELOOP）时**重新抛出**（file-mutation-queue.ts:24）⇒ 本函数 ：51 的 await reject ⇒ :82 折叠 OPERATION_FAILED（action 未启动，零写入）✔ 不破坏 no-throw；(b) ENOENT/ENOTDIR ⇒ 退化为 resolvedPath 键，不抛（:21-22）；(c) action settle（本设计恒 fulfilled）⇒ 其 finally 释放后继者，链前进。
- POST（always-settles 定理）：返回 promise 恒 fulfilled，值 ∈ SettingsOutcome<void>。证：async 体 await 集合 = {mkdir :49, realpath :50, queue :51}，全部位于 try（:46-83）内；catch 体同步（settingsFailure）；queue 的实参 action 恒 settle fulfilled（fn-settings_files-queue-L51.md）⇒ :51 的 await 必然完成 ⇒ 无 rejection 逃逸。executeSettingsSave:42 `await saveFileOnly(...)` 因此必然继续到 ：43 的分支判定（Batch C 义务闭合）。
- POST（值域）：`ok:true` ⇒ 目标文件已原子替换为 `{...原文件, ...patch}`（\t 缩进 + 尾换行，:58）；`ok:false` code ∈ {INVALID_REQUEST（:48 透传或 ：83 兜底路径类）, SESSION_UNAVAILABLE（:55/:65，经 action）, OPERATION_FAILED（I/O/队列/读取失败透传 ：57）, isCurrent 端口失败透传（:54/:64）}。

## 自身异常合同（逐路径）

- :47 `copySettings(values)`：无条件 no-throw ✔；!ok ⇒ :48 原样透传（INVALID_REQUEST + message）⇒ **零 I/O 副作用**（mkdir 未达）。
- :49 `await mkdir(dirname(path), {recursive:true})`（external-mkdir + external-dirname）：recursive 模式吞 EEXIST（目录已存/竞态创建皆成功）；rejection 域 EACCES/ENOTDIR/ELOOP/ENOSPC/path 非 string（TypeError→rejection）⇒ :82 **contained**。
- :50 `await realpath(dirname(path))`（external-realpath）：**missing dir → ENOENT rejection** ⇒ :82 structured（:49 刚建好仍可被并发 rmdir——竞态失败是安全的结构化失败，零写入）；ELOOP/EACCES ⇒ 同上。`join(..., basename(path))`（external-join/external-basename）：string 计算，不抛。
- :51-81 `return await queue(target, action)`：宿主边界。queue 非 函数（调用方违约）⇒ 调用 TypeError ⇒ :82 **contained**；queue 正常 ⇒ action 合同（queue-L51 报告）保证 settle；queue 内部 realpath 重抛 ⇒ :82 **contained**（见上 fp 契约）。
- :82-84 catch：settingsFailure no-throw ✔。
- 无 `throw`/`Promise.reject` 语句（settings-files.ts:40-84 核实；action 内亦无）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同：进程在 rename 前死于 ：62/:66 之间 ⇒ 磁盘留 tmp 文件（下次保存撞名概率仍≈0，UUID）；死于 rename 后 ：67 前 ⇒ 文件已提交但返回丢失——均属崩溃一致性范畴，单独声明，不算偏差。

## 霍尔逻辑 SP

{P: path ∈ 根内绝对路径域；queue ≡ withFileMutationQueue（串行同键、透传 action 结果、内部 realpath 重抛面如上）；isCurrent no-throw；copySettings no-throw + ok 良构}
body: patch := copySettings(values)（:47）；¬ok ⇒ return patch（:48）；await mkdir(dirname(path), recursive)（:49，reject ⇒ catch）；target := join(realpath(dirname(path)), basename(path))（:50，reject ⇒ catch）；return await queue(target, action)（:51，action 恒 settle，queue 重抛 ⇒ catch）；catch ⇒ return OPERATION_FAILED（:82-83）
{Q: promise 恒 fulfilled ∈ SettingsOutcome<void>；ok ⇒ target 原子更新为 RAW 基线右偏合并 ∧ 未提交 tmp 已清理；¬ok ⇒ 目标文件字节未被本调用修改（:48/:49/:50/:55/:57/:64/:65 各失败点均在 rename 前）；∀实参无 rejection 逃逸}

## 并发/异步义务

- **原子性**：tmp(wx) + rename 提交，读方永远看到旧完整文件或新完整文件；writeFile 直写目标不存在 ✔。
- **串行化**：同 target 的读-改-写由宿主队列互斥；不同文件并行 ✔（native file-mutation-queue.ts:28-31 语义）。**双重 realpath**：target 于 ：50（入队前）与队列键于宿主入队时（file-mutation-queue.ts:19）各 realpath 一次——两读之间目录符号链接重定向 ⇒ 键与文件错位、互斥失效（固有 TOCTOU，与 queue-L51 报告同一条义务，记录不消除）。
- **mkdir 时序偏差（观察）**：prototype.md §5 把目录创建折入队列内的 `atomicWriteObject`；本代码在 ：49 入队**前**建目录 ⇒ isCurrent 闸失败（:55）或原文件损坏（:57）的保存仍留下新建的空目录树。副作用无害（空目录），记录为 divergence-with-anchor：settings-files.ts:49 vs arch/prototype.md §5 saveFile；不判偏差（不违反任何 no-throw/不覆盖性质）。
- **isCurrent 闸位（Batch B 边界）**：两闸（:53/:63）都在队列 action 内同步直调——gate→use 语义：闸与使用（读/提交）之间无 await 之外的让出点；:63→:66 残余窗口见 queue-L51 报告。isCurrent 永不抛（Batch B）⇒ 直调安全；即便违约也有 ：78 兜底。
- 无 unhandled rejection：所有 promise（mkdir/realpath/queue 及 action 内部）均被 await；queue 内部 `registrationQueue` 链自消化（native :46-49 双 reaction）。
- 【unknown】宿主 fs/队列 promise 永不 settle ⇒ 本函数悬挂（调用方 executeSettingsSave 一并悬挂）——JS 异常合同外，显式列为本函数异步义务。
