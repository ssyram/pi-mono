---
fn: "settings-save.ts:L13::filePathFor"
source: "settings-save.ts"
line: 13
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_save-filePathFor-L13.md

## 综述

模块内同步路径路由纯函数（settings-save.ts:13-23，非导出）：按五个保存操作把文件目标路由到 global 根或 local 根，`save-session` 返回 `undefined`（:19）——调用方据 undefined 跳过整个文件分支、只走日志步骤。`save-global-only`/`save-global-and-session` → `settingsFilePath(globalRoot, save.globalPath)`（:20-21）；其余两操作（save-local-only/save-local-and-session）→ `settingsFilePath(join(session.cwd, ".pi"), save.localPath)`（:22）。无 try/catch——no-throw 性由「settingsFilePath 任意域无条件 no-throw + PRE 域内 join 不抛」构成；域外行为如实记录为 PRE 边界（下文）。对应 arch/prototype.md §5 `saveGlobalOnly`/`saveLocalOnly` 的 `path <-? globalFile/localFile` 与 §5 `saveSession = addNewPiLog`（无文件步骤）。

## 契约（调用者驱动）

调用者（全仓 1 处）：executeSettingsSave settings-save.ts:37（同步调用，无 await；返回值在 ：38/:41 分支消费）。

- PRE-A（经 parseSettingsOperation 的仓内域）：`op` ∈ 五保存操作白名单（settings-operation.ts:5-11/:36）；`save` 为解析器 ok 载荷（globalPath/localPath ∈ string∪{null,undefined}，fn-settings_operation-parseSettingsOperation-L31.md POST）；`session` 为 resolver 产物（`cwd: string` = owner.context.cwd，extension.ts:25；普通对象字面量）；`globalRoot: string`（extension.ts:60 `getAgentDir()`）。
- PRE-B（独立可调用下界——本函数非导出，floor 即「仓内任意直接调用」）：`session.cwd` 为 string 且 session 为普通对象（`join` 的 TypeError 域，external-join.md：非 string 分段抛 TypeError）。类型说谎域行为如实记录：`session` 为 Proxy（`get` 陷阱抛）⇒ :22 `session.cwd` 属性读抛出；`cwd` 非 string ⇒ :22 `join` 抛 TypeError——两者均**向外逃逸（本函数无 try）**。记 **PRE 边界非偏差**（同 executeSettingsQuery PRE-B / kindOf 硬 PRE 判例）；仓内唯一调用点实参恒满足 PRE-A。
- POST（值域）：`undefined` ⇔ `op === "save-session"`（:19）✔ prototype §5 saveSession 无文件步骤；`{ok:true, value}` ⇒ value 为对应根内规范绝对路径（settingsFilePath ok 合同，fn-settings_files-settingsFilePath-L10.md）；`{ok:false}` ⇒ INVALID_REQUEST（非空相对无 NUL 校验 ：13 或越界 ：18）。五操作全覆盖：if 链三分支（:19/:20-21/:22）与 SAVE_OPS 白名单一一对应，无漏-default 路径。

## 自身异常合同（逐路径）

- :19 `return undefined`：不抛。
- :20-21 op 全等比较 ×2 + `settingsFilePath(globalRoot, save.globalPath)`：settingsFilePath **任意实参域无条件 no-throw**（fn-settings_files-settingsFilePath-L10.md）✔；`save.globalPath` 属性读于解析器新建普通对象 ⇒ 不抛。
- :22 `join(session.cwd, ".pi")`（external-join.md）：string 分段不抛；`cwd ∈ string` 由 PRE-A 保证 ⇒ 域内不抛；PRE-B 违约域 ⇒ TypeError 逃逸（上文，PRE 边界）。`settingsFilePath(join(...), save.localPath)`：no-throw ✔。
- 无 `throw`/`Promise.reject` 语句（settings-save.ts:13-23 核实）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions.md §其他），单独声明。
- 零副作用：不触 fs、不触 session 端口、无共享态。

## 霍尔逻辑 SP

{P: PRE-A（op ∈ 5 ops；save 载荷域；session.cwd: string 普通对象；globalRoot: string）；settingsFilePath 全域 no-throw}
body: op = "save-session" ⇒ return undefined（:19）；op ∈ {save-global-only, save-global-and-session} ⇒ return settingsFilePath(globalRoot, save.globalPath)（:20-21）；☐ return settingsFilePath(join(session.cwd, ".pi"), save.localPath)（:22）
{Q: 恒返回 undefined ∨ SettingsOutcome<string>；undefined ⇔ save-session；ok ⇒ value 为对应根（global=getAgentDir()，local=session.cwd/.pi）内规范绝对路径；PRE-A 域内无异常逃逸；零副作用}

## 并发/异步义务

- 纯同步纯函数：`session.cwd` 只读、无 await、无 promise ⇒ 重入/并发零义务；同参数并发调用结果一致。
- **本地根锚点语义对照**（转发义务核验）：代码 local 根 = `join(session.cwd, ".pi")`（settings-save.ts:22）✔ 对齐 prototype §2 `projectRoot = getCurrentProjectDir() / ".pi"`——`session.cwd = owner.context.cwd`（extension.ts:25）即该会话的项目工作目录，≙ 原型的"当前项目目录"；且与查询侧 local 读根（settings-query.ts:27 同式 join）**同锚** ⇒ 保存与查询的 local 层定位一致，无错位。
- AndSession 变体路由正确：save-global-and-session → global 文件（:20-21）、save-local-and-session → local 文件（:22）✔ prototype §5 组合定义（catchAndPrint 文件步骤所选层）。
