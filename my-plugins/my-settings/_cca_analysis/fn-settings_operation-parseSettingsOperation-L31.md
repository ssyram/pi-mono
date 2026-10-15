---
fn: "settings-operation.ts:L31::parseSettingsOperation"
source: "settings-operation.ts"
line: 31
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_operation-parseSettingsOperation-L31.md

## 综述

导出同步协议解析器（settings-operation.ts:31-80）：把任意 `unknown` 的请求载荷折叠为「结构化 INVALID_REQUEST」或「已验证的 SettingsOperation」。管线：信封层 readDataFields（:33，["op","query","save"]，fn-settings_operation-readDataFields-L13.md 已证任意域 no-throw）→ op 白名单（:36，`SAVE_OPS` 模块级 `ReadonlySet`（:5-11，五个保存操作串）+ `SAVE_OPS.has(op)`，external-has.md Form 2 任意实参不抛）→ 载荷层 readDataFields（:39，五键）→ 路径类型校验（:49-55，string|null|undefined 三态）→ query 分支 scope 白名单 + copySettings(defaults)（:57-66）／save 分支 copySettings(values)（:68-76）。整体 try（:32-76）+ catch 调 settingsFailure("INVALID_REQUEST", error)（:78，已证 no-throw）。**任意实参域无条件 no-throw**；ok 结果携带 copySettings 快照 ⇒ 良构性由 fn-json_settings-copySettings-L4.md 定理承接。调用者：settings-service.ts:40（handler，fn-settings_service-on-L21.md）；extern-model.md 将其列为独立可调用导出。

## 契约（调用者驱动）

调用者：唯一生产调用点 settings-service.ts:40 `parseSettingsOperation("operation" in data ? data.operation : undefined)`；测试域另有直接调用（不计入生产合同）。

- PRE：`value` 任意（无前置约束）。
- POST（ok + query）：`value = { op:"query", query:{ globalPath, localPath, scope, defaults } }`，其中 globalPath/localPath ∈ string ∪ {null, undefined}（:51 三态闸）、scope ∈ {"global","project","session"} ∪ {undefined}（:58 白名单）、`defaults` 为 copySettings ok 快照（良构、深拷贝、与输入零别名）——**这是本批次向 executeSettingsQuery :24-31 交付的第一扫 PRE**：解构域、settingsFilePath 实参域、copySettings 实参域全部预验证。
- POST（ok + save）：`value = { op: <五保存操作之一>, save:{ globalPath, localPath, values } }`，values 为良构快照（settings-save.ts:47 的 patch 验证因此前置满足）。
- POST（ok 判别不变式）：op 字段与载荷字段一一对应——query 分支不读 `save` 字段、save 分支不读 `query` 字段（:39 三元只取其一）；两字段同时存在时仅校验被选中的那个，另一字段内容不影响结果。
- POST（错误映射）：`ok:false` ⇒ 恒 INVALID_REQUEST、message: string。拒绝类：信封非对象/数组（:15）、信封含访问器（:21）、op ∉ {query} ∪ SAVE_OPS（:36-38）、载荷非对象/数组、载荷键含访问器（:39→readDataFields）、路径类型非法（:51-53）、scope 非法（:58-60）、defaults/values 非合法 JSON（:61-62/:68-69，copySettings 拒绝透传，含缺字段 ⇒ undefined ⇒ "Settings must be a JSON object"）。

## 自身异常合同（逐路径）

- :33/:39 readDataFields：合同任意域 no-throw（本批次前序报告）⇒ **contained（总不抛）**。
- :35 `envelope.value.op`、:39 三元中 `envelope.value.query`/`envelope.value.save`：对 :25 新建普通对象的属性读，不抛。
- :36 `op !== "query" && !SAVE_OPS.has(op)`：全等比较不抛；`Set.prototype.has`（external-has.md Form 2）对任意实参（含 symbol/Proxy/undefined）不抛。**contained（总不抛）**。
- :37/:52/:59/:78 settingsFailure：无条件 no-throw（已证）。
- :47 `fields.value`、:50 `input[key]`、:57 `input.scope`：对 :25/:18 新建普通对象的属性读，不抛。
- :49 `for (const key of ["globalPath","localPath"] as const)`：数组字面量迭代，不抛。
- :51-53 三态比较 + typeof + 模板串 `` `${key} must be a relative file path` ``：key 为字符串字面量 ⇒ 模板插值不触发 toString ⇒ 不抛。
- :54/:74 `paths[key] = path`／对象展开 `{ ...paths, scope, defaults: defaults.value }`（:65）、`{ ...paths, values: values.value }`（:74）：对新建字面量目标的 CreateDataPropertyOrThrow，键为字符串、值已过域闸 ⇒ 不抛；展开源均为新建普通对象（无 Proxy）。
- :58 scope 四向全等比较：不抛。
- :61/:68 copySettings：已证任意域无条件 no-throw + ok 良构（fn-json_settings-copySettings-L4.md）⇒ **contained（总不抛）**。
- :73 `op as SettingsSaveOperation`：纯编译期断言，运行时无操作。
- :77-79 catch：仅 settingsFailure ⇒ catch 链不可能二次逃逸。
- 全文件无 `throw`/`Promise.reject` 语句（settings-operation.ts 核实）⇒ 无显式偏差。
- 宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions.md §其他），单独声明。

## 霍尔逻辑 SP

{P: value ∈ 任意值域 V；readDataFields/copySettings/settingsFailure 全域 no-throw（已证）；SAVE_OPS 为模块级常量 Set（:5-11）}
body: envelope := readDataFields(value, [op,query,save])（:33，异常不可能）；!ok ⇒ 透传（:34）；op ∉ {query}∪SAVE_OPS ⇒ INVALID_REQUEST（:36-38）；fields := readDataFields(选中载荷, 五键)（:39）；!ok ⇒ 透传（:46）；路径 ∈ {undefined,null,string} 否则 INVALID_REQUEST（:51-53）；query ⇒ scope 白名单闸（:58-60）+ defaults := copySettings（:61）+ return ok{op,query}（:63-66）☐ values := copySettings（:68）+ return ok{op,save}（:70-76）；catch ⇒ settingsFailure(INVALID_REQUEST)（:78）
{Q: 返回 SettingsOutcome<SettingsOperation>；ok ⇒ 载荷形状/类型/白名单全部验证且深值域为 copySettings 快照；∀value∈V 无异常逃逸；副作用：无（纯解析，不触 fs/不触 session 端口）}

## 并发/异步义务

- 纯同步、无 await、无共享可变模块态（SAVE_OPS 只读）⇒ 重入/并发零义务；两次并发解析互不干扰。
- 不创建 promise ⇒ 无 unhandled rejection 面、无悬挂义务（同步函数返回即完成，service handler :40 同步取用其值）。
- 与信封 double-read 相关：:33 与 ：39 两次 readDataFields 之间无 await ⇒ 输入对象无法在两读之间被改写（单线程同步段）。
