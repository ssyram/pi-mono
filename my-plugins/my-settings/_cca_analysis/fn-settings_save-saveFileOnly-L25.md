---
fn: "settings-save.ts:L25::saveFileOnly"
source: "settings-save.ts"
line: 25
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_save-saveFileOnly-L25.md

## 综述

模块内 async 适配器（settings-save.ts:25-27，非导出）：把 executeSettingsSave 的文件步骤参数适配为 `writeSettingsFile(path, save.values, queue, session.isCurrent.bind(session))`（:26）——第 4 实参为**绑定端口**（external-bind.md：callable receiver 的 `Function.prototype.bind` 不抛；bound 调用 this 恒为 session）。恒 settle fulfilled：async 函数 return-promise 采纳语义 + writeSettingsFile 恒 settle fulfilled 定理（fn-settings_files-writeSettingsFile-L40.md）⇒ executeSettingsSave :42 的 await 必推进（Batch C accept-settle 义务的文件步闭合点）。本函数自身无 try/catch、无状态：同步前导（属性读+bind）在 conforming session 域内不可抛，域外为 PRE 边界。

## 契约（调用者驱动）

调用者（全仓 1 处）：executeSettingsSave settings-save.ts:42（`await saveFileOnly(path.value, save, session, queue)`）。测试域直接调 writeSettingsFile（非本函数，fn-settings_files-writeSettingsFile-L40.md 调用者节）。

- PRE-A（仓内域）：`path` ∈ settingsFilePath ok 值（filePathFor :21/:22 产物，根内绝对路径）；`save` 为解析器 ok 载荷（values 属性读安全）；`session` 为 resolver 产物（isCurrent 为端口函数、普通对象字面量，extension.ts:22-55）；`queue` = withFileMutationQueue（extension.ts:61 → settings-service.ts:18/:44 → settings-save.ts:42 透传）。
- PRE-B（类型说谎域，如实记录）：`session` 为 Proxy（get 陷阱抛）⇒ :26 `session.isCurrent` 属性读/bind 构造同步抛 ⇒ async 帧 ⇒ rejection（**仍 settle**，被 client accept `.catch` 折为结构化 OPERATION_FAILED——外层纵深防御，不参与本函数 no-throw 证明）；`session.isCurrent` 非 callable ⇒ bind 抛 TypeError ⇒ 同上。记 **PRE 边界非偏差**（同 filePathFor/executeSettingsQuery PRE-B 判例）；仓内唯一调用点实参恒满足 PRE-A。注：external-bind.md 所述"call sites sit inside try blocks"指 bound 函数的**后续调用**位点（settings-files.ts:52-80 action try）；本文件 ：26 的 bind **构造**位点不在 try 内，构造期抛出仅 PRE-B 域可达——如实记录。
- POST（always-settles 定理）：恒 **fulfilled**，值 ∈ SettingsOutcome<void>。证：async 体唯一步骤 ：26 调用 writeSettingsFile（async 函数调用不同步抛，D 报告"恒 settle fulfilled、永不 reject"）⇒ return-promise 采纳其 settled 值；PRE-A 域内前导同步段（:26 实参求值：属性读、bind、实参传递）不可抛 ∎。
- POST（值域/副作用）：全权委托 writeSettingsFile——原子 tmp+rename 写、RAW 原文件基线右偏合并、损坏原文件不覆盖、isCurrent 双闸、失败零写入（fn-settings_files-writeSettingsFile-L40.md / fn-settings_files-queue-L51.md）。

## 自身异常合同（逐路径）

- :26 `session.isCurrent` 属性读：PRE-A 域（普通对象字面量）不抛；Proxy 域 ⇒ PRE 边界（上文）。
- :26 `.bind(session)`（external-bind.md）：callable receiver ⇒ bound function 构造**不抛**（ES 规范 bound function exotic object 创建对合法实参无抛出点）；receiver 非 callable ⇒ TypeError ⇒ PRE 边界。
- :26 `writeSettingsFile(...)` 调用：async 函数 ⇒ 同步段异常转 rejection 而非同步抛；其合同恒 settle fulfilled（D）。
- 无 `throw`/`Promise.reject` 语句（settings-save.ts:25-27 核实）⇒ 无显式偏差；本函数无 try/catch 且不需要——被调合同覆盖全部可达抛出面。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同，单独声明。

## 霍尔逻辑 SP

{P: PRE-A（path ∈ 根内绝对路径；session conforming；queue ≡ withFileMutationQueue）；writeSettingsFile 恒 settle fulfilled（D 定理）；bind 对 callable 不抛（external-bind.md）}
body: return writeSettingsFile(path, save.values, queue, session.isCurrent.bind(session))（:26）——promise 采纳，前导同步段域内不可抛
{Q: PRE-A 域内恒 fulfilled ∈ SettingsOutcome<void>（值语义=writeSettingsFile）；PRE-B 违约域 ⇒ rejection（仍 settle，被 accept .catch 收敛）；无同步异常逃逸}

## 并发/异步义务

- **绑定端口契约（转发义务核验）**：`session.isCurrent.bind(session)` 仅固定 this、不包装行为 ⇒ bound 函数完整保持端口合同（同步返回 SettingsOutcome<boolean>、no-throw——fn-extension-isCurrent-L26.md Batch B 定理）。writeSettingsFile :53/:63 以普通调用 `isCurrent()` 消费，this 经 bound 函数解析为 session，端口语义与直调等价 ✔ external-bind.md Form。D 报告闸位分析逐字适用：两闸（:53-55/:63-65）为 action 内同步直调、gate→use 同步、提交前复查残余窗 ：63→:66 不可消除（已声明，TOCTOU 语义同 prototype 双 ensureCurrentSession）。
- 纯适配器：无本地状态、无额外让点（:26 即函数体全部）⇒ 并发/串行化/悬挂义务全部继承 writeSettingsFile（D：同文件队列互斥、双重 realpath TOCTOU、tmp 清理、宿主 fs 永不 settle ⇒ 悬挂——JS 合同外）。
