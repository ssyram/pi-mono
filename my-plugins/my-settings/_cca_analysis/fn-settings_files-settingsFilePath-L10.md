---
fn: "settings-files.ts:L10::settingsFilePath"
source: "settings-files.ts"
line: 10
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_files-settingsFilePath-L10.md

## 综述

同步路径解析纯函数（settings-files.ts:10-25）：把根目录 + 可选相对配置名折叠为「根内绝对路径」或结构化 INVALID_REQUEST。整体位于 try（:11-24），catch 调 `settingsFailure("INVALID_REQUEST", error)`（:23，已证 no-throw）。管线：`configured ?? MY_SETTINGS_DEFAULT_PATH`（:12）→ 非空相对无 NUL 校验（:13，trim/includes/isAbsolute）→ `resolve(root, name)`（:16，external-resolve.md Form 1）→ `relative(resolve(root), path)` 越界检查（:17-18，空前/`..`/`..${sep}` 前缀/绝对 within 四闸）→ 返回 `{ok:true, value: path}`（:21）。无 await、无 fs 副作用。对应 arch/prototype.md §2 `resolveWithin`（"返回根目录内的绝对路径；非法路径返回 Error，不向外抛异常"）✔。

## 契约（调用者驱动）

调用者（全仓 4 处）：settings-query.ts:25（globalFile）、settings-query.ts:27（localFile，`scope === "global"` 时短路不调 ✔ prototype §"scope: global 不得读 local"）、settings-save.ts:21（global）、settings-save.ts:22（local，`join(session.cwd, ".pi")`）。

- PRE：`root: string`（仓内来源：extension.ts:60 `getAgentDir()` / settings-save.ts:22 `join(session.cwd, ".pi")`，均 string）；`configured: string | null | undefined`（SettingsPaths 协议域）。两参任一为非 string（如调用方误传 null root）⇒ :16/:17 resolve/relative 抛 TypeError ⇒ :23 结构化，仍 no-throw——PRE 只决定语义正确性，不决定 no-throw。
- POST：`ok:true` ⇒ `value` 是 `resolve(root, name)` 的规范化绝对路径，且 `relative(resolve(root), value)` 非空、非 `..`、不以 `..${sep}` 开头、非绝对（:18 全闸）⇒ 落在根内；`ok:false` ⇒ INVALID_REQUEST。永不抛。
- 语义注记：`name = ""`/纯空白被 ：13 拒（`!name.trim()`）；`"."` 经 ：17 within 为空串被 ：18 拒 ✔；`"a/../../x"` 归一化后 within 以 `../` 开头被拒 ✔；`configured = null` → 默认 `"settings.json"`（protocol.ts:4；注意运行代码用 `my-settings.json`？——protocol.ts:4 实为 `"settings.json"`，与 prototype.md §2 尾注"当前运行代码使用独立的 my-settings.json"的描述**不符**：代码就是 settings.json。此为 prototype 尾注与代码的文档级出入，代码行为=用户原型最终选择（prototype.md §6 确认项 1：使用 settings.json），判代码正确、prototype 尾注过时，记观察非偏差）。

## 自身异常合同（逐路径）

- :12 `??`：任意实参不抛。
- :13 `typeof name !== "string"` 守卫先行 ⇒ 以下三者输入恒为 string：`name.trim()`（external-trim）、`name.includes("\0")`（external-includes）、`isAbsolute(name)`（external-isAbsolute，node:path 对 string 实参不抛）。
- :16 `resolve(root, name)`（external-resolve.md Form 1）：仅非 string 实参抛 TypeError ⇒ :23 **contained**。
- :17 `relative(resolve(root), path)`（external-relative + resolve 同上）：同上 ⇒ **contained**。
- :18 四个判定（truthiness/全等/`startsWith`（external-startsWith）/isAbsolute）：string 上的纯计算，不抛。
- :21 字面量构造：不抛。
- :22-24 catch：settingsFailure 无条件 no-throw。
- 全文件无 `throw`/`Promise.reject`（settings-files.ts:10-25 核实）⇒ 无显式偏差。**任意实参域无条件 no-throw**。
- 宿主灾难性 OOM/终止不属 JS 异常合同，单独声明。

## 霍尔逻辑 SP

{P: root ∈ V_root（任意值域，string 才有语义）∧ configured ∈ string ∪ {null, undefined}}
body: name := configured ?? "settings.json"（:12）；name ∉ 非空相对无 NUL 串 ⇒ return INVALID_REQUEST（:13-14）；path := resolve(root, name)（:16）；within := relative(resolve(root), path)（:17）；within ∈ {""; ".."; `..${sep}`*; 绝对路径} ⇒ return INVALID_REQUEST（:18-19）；☐ return {ok:true, value:path}（:21）
{Q: 恒返回 SettingsOutcome<string>；ok ⇒ value 为 resolve(root) 内的规范化绝对路径；∀实参无异常逃逸；无副作用（不触 fs）}

## 并发/异步义务

- 纯同步纯函数：无 await、无共享态 ⇒ 重入零义务；同参数并发调用结果一致。
- 不创建 promise ⇒ 无悬挂/unhandled rejection 义务。
