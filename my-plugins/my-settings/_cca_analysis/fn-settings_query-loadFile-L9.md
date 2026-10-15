---
fn: "settings-query.ts:L9::loadFile"
source: "settings-query.ts"
line: 9
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_query-loadFile-L9.md

## 综述

模块私有 async 单来源文件查询器（settings-query.ts:9-17）：`await readSettingsFile(path)`（:10，fn-settings_files-readSettingsFile-L27.md：**恒 settle fulfilled**、ENOENT ⇒ `{ok:true,{}}`）→ !ok ⇒ `reportSettingsError` 诊断（:12，已证无条件 no-throw）+ **返回 `{}` 即跳过该来源**（:13）；ok ⇒ `pickValidFields(path, defaults, raw.value)`（:15，fn-settings_kind-pickValidFields-L19.md 已证任意域 no-throw）→ valid.ok ? valid.value : `{}`（:16）。函数体无 try/catch，但其安全性由「三个被调函数全部已证 no-throw + 剩余语句域内不可抛」构成，**恒 settle fulfilled 且值 ∈ Settings**（下证）。这是 executeSettingsQuery :37-40 `Promise.all` 元素，即 Batch C「accept 的 promise 必 settle」义务的关键环节：**loadFile 恒 fulfill ⇒ Promise.all 在本文件不可能 reject**。对应 arch/prototype.md §4 `queryFile`（Ok ⇒ parseQuery 过滤；Error ⇒ reportError + empty；empty 仅表示该来源无贡献）✔。

## 契约（调用者驱动）

调用者：唯一，executeSettingsQuery :38（global 来源）与 :39（local 来源，scope≠global 时），两处以 `Promise.all` 并行调用（settings-query.ts:37-40）。

- PRE：`path: string`（仓内恒为 settingsFilePath ok 值：settings-query.ts:26/:28 闸后）；`defaults: Settings`（仓内恒为 ：30 copySettings ok 快照 `validated.value`）。无 no-throw 前置约束——path 非 string 时 readSettingsFile 仍按合同折叠为 OPERATION_FAILED ⇒ loadFile 走 ：11-14 诊断+`{}`；defaults 为原始值时 pickValidFields 的 try 兜底 ⇒ OPERATION_FAILED ⇒ :16 `{}`。
- POST（always-settles 定理）：返回 promise **恒 fulfilled**，值 ∈ `Settings`：要么 `{}` 字面量（:13/:16 失败支，每次新建、无共享态），要么 `valid.value`（pickValidFields ok ⇒ copySettings 快照，良构、深拷贝）。证：async 帧内唯一 await 是 :10，其被等待对象按 readSettingsFile 合同恒 fulfilled ⇒ 不会向 async 帧注入 rejection；其余语句（:11-:16）中被调函数全部合同 no-throw，模板串（:12）在 path: string 域内不触发 toString ⇒ 无同步 throw 可被引擎转为 rejection；无显式 `throw`/`Promise.reject`（settings-query.ts:9-17 核实）。∎
- POST（来源失败语义 ✔ prototype §4）：文件读取失败（含损坏/顶层类型错）⇒ 诊断 + 该来源贡献为空，**不是**把失败静默伪装成"无配置"——诊断经 ：12 reportSettingsError 交给 Pi ✔「一个来源读取失败则报错、忽略该来源」；kind 过滤后的字段级失败由 pickValidFields 内部逐键诊断，pickValidFields 整体 !ok（仓域不可达，仅其 ：34 兜底 catch 或 copySettings(picked) 拒绝）⇒ :16 静默 `{}`——该支无新增诊断，但逐键失配已在 pickValidFields 内诊断过，且仓域不可达，记观察非偏差。

## 自身异常合同（逐路径）

- :10 `await readSettingsFile(path)`：合同恒 settle fulfilled（fn-settings_files-readSettingsFile-L27.md always-settles 定理）；若合同被违反（上游 rejection，理论域）⇒ await 把 rejection 注入本 async 帧 ⇒ 本函数 reject——**该情形以下游合同成立为前提，仓域不可达**；悬挂风险继承宿主 fs 层永不 settle 的【unknown：宿主 fs 实现】（同 readSettingsFile 报告）。
- :11 `!raw.ok`：布尔取反，不抛。
- :12 模板串 `` `${path}: ${raw.error.message}；忽略该来源` ``：path 在 PRE 域为 string（插值不触发 toString）；`raw.error.message` 为 SettingsFailure 形状的 string 字段（readSettingsFile POST）⇒ 不抛。
- :12 `reportSettingsError(...)`：无条件 no-throw（fn-settings_error-reportSettingsError-L12.md）。
- :13/:16 `{}` 字面量：不抛。
- :15 `pickValidFields(path, defaults, raw.value)`：合同任意域 no-throw（整体 try/catch，settings-kind.ts:20-36）⇒ **contained（总不抛）**。
- :16 三元 + 返回：不抛。
- 全文件无 `throw`/`Promise.reject`（settings-query.ts:9-17 核实）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions.md §其他），单独声明。

## 霍尔逻辑 SP

{P: path: string（仓域：settingsFilePath ok 值）；defaults: Settings（仓域：copySettings ok 快照）；readSettingsFile 恒 settle fulfilled；pickValidFields/reportSettingsError 全域 no-throw（已证）}
body: raw := await readSettingsFile(path)（:10，恒 fulfilled）；!raw.ok ⇒ reportSettingsError（:12）+ return {}（:13）；valid := pickValidFields(path, defaults, raw.value)（:15，异常不可能）；valid.ok ⇒ return valid.value ☐ return {}（:16）
{Q: promise 恒 fulfilled 且值 ∈ Settings（良构快照 ∪ {}）；∀(path,defaults) 无 rejection 逃逸；副作用 ⊆ {至多一次文件读 + 至多 N 条失配诊断 + 至多一条来源级诊断}}

## 并发/异步义务

- **Promise.all 并行性（:37-40）**：两个 loadFile 调用在数组字面量构造时同步启动（async fn 同步段执行到首个 await——readSettingsFile 同步发起 readFile）；两调用无共享可变态（defaults 只读、path 不同或相同但读操作无副作用）⇒ 并行安全；任一支失败互不影响另一支（各自治愈为 `{}`）。
- **悬挂义务（JS 合同外）**：两支的唯一等待点是 readSettingsFile 的 readFile；宿主 fs 层永不 settle ⇒ 本函数 pending ⇒ Promise.all pending ⇒ executeSettingsQuery 悬挂于 :37。不抛、不泄漏，但调用方悬挂——与 readSettingsFile 报告同一【unknown：宿主 fs 实现】，非 JS 异常合同违反。
- **Promise.all 不 reject 的证明（本文件交付）**：Promise.all 仅在任一元素 reject 时 reject（external-all.md）；元素域 = {loadFile 返回值（本报告定理：恒 fulfill）, `Promise.resolve({})`（settings-query.ts:39，external-resolve.md Form 2：创建即 fulfilled）} ⇒ 无元素可 reject ⇒ Promise.all 恒 settle fulfilled ⇒ executeSettingsQuery :37 await 必推进。
- 重入：两次并发查询各自创建独立闭包帧，无跨调用共享态。
