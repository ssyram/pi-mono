---
function: settings-session-log.ts:L4::readSessionSettings
source: {file: "settings-session-log.ts", line: 4}
self_consistency: aligned
---

## 综述

会话日志重放器（settings-session-log.ts:4-18）：顺序扫描会话分支条目数组，挑出 type==="custom" 且 customType==="my-settings-v1" 的条目，把每条的 `values` 深拷贝后按序合并（后写覆盖先写，README:121 "merging patches in order"），返回累积的普通 Settings 对象。对形态损坏的 my-settings 条目**以 throw 拒绝**（README:72 "invalid session logs return errors rather than silently falling back"）——不跳过、不部分返回。

## 调用者驱动契约

callgraph 入边：`settings-service.ts:L17::execute → readSessionSettings`（svc:39，callgraph.json:162-164，唯一包内调用点）。另有独立模块导出面（entries.json:15）。

1. **execute 查询分支（svc:39）**：`readSessionSettings(session.getBranch())`，裸调（无本地 try）。前提：`session.getBranch()` 返回条目数组——这是宿主 API（extension.ts:15 闭包直通 sessionManager.getBranch()，external 前提），须为数组且元素为非 null 条目对象（违反 → 本函数 TypeError 传播 → svc:89 折叠为 OPERATION_FAILED）。期望：正常分支日志 → 按序合并的 Settings；损坏的 my-settings 条目 → throw（经 svc:89 → 结构化 OPERATION_FAILED，README:72 错误不回退）；空/无匹配条目 → `{}`。
2. **独立导出 caller**：自行 catch；输入须为条目数组（元素非 null 对象，否则 TypeError）；损坏条目 throw。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **可能向外 throw**（同步；损坏日志的设计拒绝信道）。逐条 source:line：
  - settings-session-log.ts:7 `entry.type` / `entry.customType` 属性读取：entry 为 null/undefined → TypeError 传播（**未捕获 callee 传播——数组元素级 UB 类前提**，见 [SELF]）；敌意 Proxy get trap 可抛（传播）。
  - settings-session-log.ts:9 `entry.data`、`"scope" in data`、`"values" in data`：data 为 L9 已验的非 null 对象；敌意 Proxy 可抛（传播）。
  - settings-session-log.ts:10 `throw new Error("Invalid my-settings session log")`：匹配条目的 data 缺失/非对象/缺 scope 或 values 键。
  - settings-session-log.ts:13 `throw new Error("Invalid my-settings session log scope")`：data.scope 非三合法值。
  - settings-session-log.ts:12 `data.scope` 属性读取：敌意 Proxy 可抛（传播）。
  - settings-session-log.ts:15 `copySettings(data.values)`：values 非 JSON 对象根（含 undefined——`"values" in data` 只验键存在，不验值）、含循环/非 JSON 值 → copySettings Error 传播（"Settings must be a JSON object" 等）。
  - settings-session-log.ts:15 spread `{...values, ...copy}`：普通对象 spread，无异常路径。
  - **未见捕获**：函数内无 try——所有 throw 直接外传。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

### 【服务/插件边界的包含效果】

- 唯一包内调用点 svc:39 在 execute 内无本地 try：throw 变成 execute 的 rejection → svc:89 `.catch` → `settingsFailure("OPERATION_FAILED", error)` → accept。**边界内零逃逸**；代价：损坏日志与文件读失败等共用 OPERATION_FAILED（错误码粒度变粗，message 保留 "Invalid my-settings session log…" 可诊断）。
- 独立导出 caller 无此包含：throw 直接外传（extern-model.md:7 显式 throw 记为偏差）。

## 契约（霍尔逻辑）

### Pre（调用前须成立；[SELF] 标注见文末清单）

- **[SELF] entries 须为可迭代数组，且每个元素为非 null 的对象**（L7 无元素级守卫：null 元素在 `entry.type` 处 TypeError）——该前提本函数自身不建立、须 caller（execute 的 `session.getBranch()`，宿主 API）保证。
- 功能前提（决定成功/throw 分支，非 UB）：匹配条目（type==="custom" 且 customType==="my-settings-v1"）的 data 须为含 scope（三合法值）与 values（JSON 对象根）的对象——违反即 throw（Post 失败分支）。

### Post（返回后保证）

- **成功**：返回全新普通对象 `Settings`：无匹配条目 → `{}`；有匹配条目 → 各条 `values` 深拷贝按数组序合并，**后写覆盖先写**（README:121 顺序合并语义）；结果与输入条目零别名、调用方可自由变异；输入数组与条目不被修改。
- **失败**：同步 throw——"Invalid my-settings session log"（匹配条目 data 形态坏）、"Invalid my-settings session log scope"（scope 非法）、copySettings 的校验 Error（values 非 JSON 对象）；或元素非对象时的 TypeError。throw 时无部分产物。
- 非匹配条目（其他 type / 其他 customType）被跳过，不参与合并、不校验。
- 无副作用：只读输入、无 I/O、无日志。异常安全档：basic（失败即干净 throw，无半更新——`values` 局部变量随帧销毁）。

### 对 callee 的期望（下传 demand）

#### copySettings（json-settings.ts:17，本批）
- 调它时已保证：实参为 `data.values`——已过 L9 `"values" in data` 键存在校验，值本身任意。
- 需要它保证：非对象根**以 throw 拒绝**（损坏 values 的拒绝信道押在该 throw 上，不可静默回 {}）；对象根返回深拷贝普通对象；对循环/非 JSON 值/非普通嵌套对象 throw 而非静默；不修改输入。

#### Error（external-Error.md，已存在）
- 需要它保证：`new Error(message)` 不抛（两个 throw 点的前置构造）。

## 并发

- 本函数全同步、无 await：一次调用期间 entries 数组不会被本插件并发改写（JS 事件循环串行化）。
- [CONC] 宿主侧条目来源：getBranch() 返回的数组是宿主会话状态投影；若宿主在 execute 的 await 点之间切换分支，svc:38 的 isCurrent 复验（SESSION_UNAVAILABLE）先于本函数调用拦截——本函数自身对数组内容不做时效性复查、无义务（与 svc:38 的防护分工明确）。
- 无锁需求：无共享可变状态（values 为局部累积器）。

## SP

- [L5] `values := {}`。
- [L6-16] for-of 遍历 entries：
  - 不变量 ESTABLISHMENT：values = 已处理匹配条目的按序合并（初值 {}）。PRESERVATION：每轮要么 continue（非匹配，values 不变），要么 values = {...values, ...copySettings(data.values)}（校验通过后合入）。INTERIOR：循环体内各 callee Pre 已由 L9/L12 校验建立（data 对象、scope 合法）；copySettings Pre（对象根）**未建立**——data.values 任意值 → 靠其 throw 拒绝（出口）。度量：entries 有限数组 → 终止。
  - [L7] 非匹配 → continue；entry 为 null → TypeError 传播（出口 T）。
  - [L9-11] data 形态坏 → throw（出口 A）。
  - [L12-14] scope 非法 → throw（出口 B）。
  - [L15] copySettings throw → 传播（出口 C）。
- [L17] 返回 values（出口 R）。
- 合流：A/B/C/T 为 throw 出口、R 为唯一成功出口；不变量在 R 处给出 Post。终止：无递归、循环有界。Post 达成。

## [SELF] 前提（上传 caller）

1. **entries 须为数组且元素均为非 null 对象**——来自本函数 L7 的裸属性读取；约束 caller：execute（svc:39）调用点的 `session.getBranch()` 返回值（宿主 sessionManager API 须返回良构条目数组）；独立导出 caller 同理。
2. （功能级，已入 Pre）匹配条目的 data/values 形态——违反产生结构化拒绝（throw），不产生 UB，不须上传。

## 自洽

- 与 execute 期望对齐：顺序合并、后写胜出 ↔ svc:40 的 `{...defaults, ...global, ...project, ...current}` 把本函数结果作为最高优先层（README:66-70 scope="session" 优先级表）。
- 损坏日志 throw ↔ README:72 "invalid session logs return errors"；经 svc:89 折叠为结构化 OPERATION_FAILED，不伪装成功。
- 对 copySettings 的期望与其源码（json-settings.ts:18）一致。aligned。
