---
fn: "settings-files.ts:L27::readSettingsFile"
source: "settings-files.ts"
line: 27
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_files-readSettingsFile-L27.md

## 综述

异步文件读取验证器（settings-files.ts:27-38）：`readFile(path,"utf8")`（:29）→ `JSON.parse` → `copySettings`（:30）三连；**ENOENT 特判返回 `{ok:true, value:{}}`**（:34，"仅文件不存在 = 空对象"），其余一切失败折叠为 `OPERATION_FAILED`（:31/:36）。外层 try（:28-37）+ 内层 try（:33-35，空 catch）双兜底；依赖 copySettings（已证无条件 no-throw + ok 良构）与 settingsFailure（已证无条件 no-throw）。对应 arch/prototype.md §2 `readRawObject`（"仅文件不存在返回 Ok empty；I/O、语法或顶层类型错误返回 Error"）✔。**恒 settle fulfilled、永不 reject**——executeSettingsQuery（经 loadFile）与写路径（queue action）的 always-settles 前提由本文件证明。

## 契约（调用者驱动）

调用者（全仓 2 处）：settings-query.ts:10（loadFile，await 后 !ok ⇒ 诊断+忽略该来源 settings-query.ts:11-14 ✔ prototype §4"一个来源读取失败则报错、忽略该来源"）、settings-files.ts:56（queue action，await 后 !ok ⇒ 整个保存停止且**不覆盖** settings-files.ts:57 ✔ prototype §5"保存原文件读取失败时停止，不能覆盖"）。

- PRE：`path: string`（仓内：settingsFilePath ok 值或其 realpath 派生，见 fn-settings_files-writeSettingsFile-L40.md）。非 string 也 no-throw（下证），只是语义失败。
- POST（always-settles 定理）：返回 promise 恒 fulfilled，值 ∈ SettingsOutcome。证：async 函数体全部 await 点（仅 :29 readFile）位于 try 内；catch 与内层 catch 均**同步**（settingsFailure/字面量），不引入新 await ⇒ 无 rejection 可逃逸 async 帧外。executeSettingsQuery:37-40 的 `Promise.all([loadFile(...), ...])` 与 queue action :56 因此等待的 promise 必定完成（Batch C 义务闭合：该 await 不会悬挂于本函数——剩余悬挂可能只在宿主 fs 层永不 settle，见异步义务）。
- POST（ok 良构，Batch C 义务）：`ok:true` ⇒ `value` 为 `{}` 字面量（:34，每次调用新建，无共享可变态）或 copySettings 输出（:30，良构定理）⇒ 恒为普通 JSON 对象，供 pickValidFields 的 raw 域与保存合并基线使用。
- POST（错误映射）：ENOENT → 成功空对象；EISDIR/EACCES/ELOOP/非法 JSON/顶层非对象 → OPERATION_FAILED（其中顶层类型错由 copySettings INVALID_REQUEST 经 ：31 **重映射**为 OPERATION_FAILED，message 保留）。

## 自身异常合同（逐路径）

- :29 `await readFile(path, "utf8")`（external-readFile）：rejection 域全谱——ENOENT/EISDIR/EACCES/ELOOP/EMFILE/路径含 NUL（node 抛 ERR_INVALID_ARG_VALUE）/path 非 string（同步 TypeError 被 async 帧折叠为 rejection）等 ⇒ 全部落 ：32 catch。**无逃逸**。
- :30 `JSON.parse(text)`（external-parse）：非法 JSON ⇒ SyntaxError ⇒ :32 **contained**。
- :30 `copySettings(...)`：无条件 no-throw ✔。
- :31 `copied.ok ? copied : settingsFailure(...)`：settingsFailure no-throw ✔。
- :33 `error instanceof Error && "code" in error && error.code === "ENOENT"`：短路链。instanceof 已把后续操作对象收敛为 Error 实例 ⇒ `"code" in error`（external-has，`in` 形态）对普通 Error 对象不抛；若 error 为 `get`/`has` 陷阱抛出的 Proxy 错误对象 ⇒ 陷阱异常触发 ⇒ 落**内层 catch :35（空体）** ⇒ 顺序落 ：36 **contained**（这正是内层 try 存在的理由：防止判定表达式自身抛出替代原始错误）。
- :34 返回字面量 `{ok:true, value:{}}`：不抛。
- :36 settingsFailure：no-throw ✔。
- 全文件无 `throw`/`Promise.reject`（settings-files.ts:27-38 核实）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同，单独声明。

ENOENT 边界精确化：`code === "ENOENT"` 覆盖「文件不存在」与「路径某目录分量不存在」；目录分量存在但其中一段是文件（ENOTDIR）**不**在此列 → OPERATION_FAILED。与 prototype"仅文件不存在返回 empty"的语义一致（分量缺失 ⇒ 文件必不存在）✔。

## 霍尔逻辑 SP

{P: path ∈ 任意值域（string 才有读语义）；copySettings/settingsFailure 全域 no-throw（已证）}
body: text := await readFile(path,"utf8")（:29，任何 reject ⇒ catch）；copied := copySettings(parse(text))（:30，parse 抛 ⇒ catch）；copied.ok ⇒ return copied ☐ return OPERATION_FAILED(copied.message)（:31）；catch：∈Error ∧ code=ENOENT ⇒ return {ok:true,{}}（:34，判定自身异常 ⇒ 内层空 catch 吞）；☐ return OPERATION_FAILED(error)（:36）
{Q: promise 恒 fulfilled 且值满足 protocol.ts:42；ok ⇒ value 为普通 JSON 对象；∀path 无 rejection 逃逸；副作用：至多一次读文件}

## 并发/异步义务

- **悬挂义务（JS 合同外，须列）**：宿主 fs 层 promise 永不 settle（如自定义 FS 钩子挂起、内核级 I/O 停滞）时本函数 pending——不抛不泄漏，但调用方悬挂。【unknown：宿主 fs 实现】。
- 无共享可变态；并发读同一文件安全（只读）；:34 的 `{}` 每次新建 ⇒ 调用间无别名。
- 无 unhandled rejection 面：唯一 promise（readFile）必被 await。
