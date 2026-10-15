---
function: settings-operation.ts:L4::parseSettingsOperation
source: {file: "settings-operation.ts", line: 4}
self_consistency: aligned
---

## 综述

请求 operation 的校验与归一化器（settings-operation.ts:4-33）：把未知 `value` 验成判别联合 `SettingsOperation`（query / save-global / save-local / save-session），逐字段校验路径与 scope，并用 `copySettings` 深拷贝 `defaults`/`values`（输入与结果零别名）。对一切非法输入**以 throw 拒绝**（这是它的设计信道）——唯一包内 caller（on handler，svc:88）以 catch 消费并折叠为 INVALID_REQUEST。

## 调用者驱动契约

callgraph 入边：`settings-service.ts:L73::on`（svc:88，实调点，callgraph.json:226-229）、`settings-service.ts:L67::registerMySettingsService`（extractor 把嵌套 handler 内的调用归到 L67 的伪影边，callgraph.json:202-205；open-questions.md 未单列，实调点在 on 内）。另有独立模块导出面（entries.json:14）。

1. **on handler（svc:88）**：传 `"operation" in data ? data.operation : undefined`——任意值含 undefined。前提：无（任意输入都是合法调用）；期望：合法输入返回结构化 operation（随后交给 execute）、非法输入以 throw 拒绝（throw 被 svc:91 catch → INVALID_REQUEST accept，README:92 错误码表内）。
2. **独立导出 caller**：须自行 catch——本函数对非法输入必 throw（不返回结构化错误）；合法输入返回深拷贝 operation，输入对象不被修改。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **可能向外 throw**（同步；设计使然）。逐条 source:line：
  - settings-operation.ts:5 `throw new Error("Invalid my-settings operation")`：value 为 null/undefined/非对象/无 `op` 键。前置属性读取 `!value`、`typeof value`、`"op" in value`：已被守卫顺序排除对原始值用 `in`（truthy + typeof object 先验）。
  - settings-operation.ts:6-7 `value.op` 属性读取：普通对象不抛；敌意 Proxy get trap 可抛（传播，未被本函数捕获）。
  - settings-operation.ts:8 `throw new Error("Unknown my-settings operation")`：op 非 "query"/"save-global"/"save-local"/"save-session"。
  - settings-operation.ts:10 `"query"/"save" in value`、`value.query`/`value.save`：敌意 Proxy 可抛（传播）。
  - settings-operation.ts:11 `throw new Error("Invalid my-settings arguments")`：query/save 缺失、非对象、或为数组。
  - settings-operation.ts:16 `throw new Error(\`${key} must be a relative file path\`)`：globalPath/localPath 存在且非 undefined/null 且非 string。
  - settings-operation.ts:22 `throw new Error("Query scope must be global, project or session")`：scope 存在且非 undefined 且非三合法值。
  - settings-operation.ts:26/31 `copySettings(...)` 传播：defaults/values 缺失（undefined）、非对象根、含循环、含非 JSON 值（函数/symbol/bigint/NaN/Infinity）、非普通嵌套对象 → copySettings 的 Error（"Settings must be a JSON object" 等）原样传播。
  - 敌意 Proxy 的 get/has trap 在 L13-17（`key in input`、`input[key]`）、L20-21（`"scope" in input`、`input.scope`）可抛（传播）。
  - **未见捕获**：函数内无 try——所有 throw 直接外传给 caller。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

### 【服务/插件边界的包含效果】

- 包内唯一调用点 svc:88 位于 on handler 的 try 内：全部 throw 被 svc:91 捕获 → `settingsFailure("INVALID_REQUEST", error)` → accept（svc:93）→ 客户端得到结构化 INVALID_REQUEST。**边界内零逃逸**；代价是错误码统一为 INVALID_REQUEST（message 保留原始文案，可诊断）。
- 独立导出 caller 无此包含：throw 直接落在 caller 栈上（extern-model.md:7 "Explicit internal throw statements are deviations even when caught by a caller"——本函数的 throw 是显式设计，记录为偏差；包含效果使其不违反服务边界不外抛的实效）。

## 契约（霍尔逻辑）

### Pre（调用前须成立）

- **无 UB 级前提**：value 为任意值都被穷举处理（守卫 + throw 拒绝信道）。功能前提（决定成功/失败分支，非 UB）：value 须为对象、op ∈ {query, save-global, save-local, save-session}、对应 query/save 为非数组对象、globalPath/localPath ∈ {undefined, null, string}、（query）scope ∈ {undefined, "global", "project", "session"}、（query）defaults 为 JSON 对象根、（save）values 为 JSON 对象根——违反即 throw（Post 失败分支），非 UB。

### Post（返回后保证）

- **成功**：返回全新 `SettingsOperation` 判别联合：
  - `op === "query"` → `query` 字段含 `defaults`（**深拷贝**，纯 JSON 值的普通对象，与输入零别名）、`scope`（undefined 或三合法值之一）、`globalPath`/`localPath`（string | null | undefined，原样透传）。
  - `op ∈ {"save-global","save-local","save-session"}`（回显输入 op）→ `save` 字段含 `values`（深拷贝普通对象）与两条可选路径。
  - 不修改输入 `value`；不触碰文件系统；无副作用。
- **失败**：同步 throw Error，message ∈ {"Invalid my-settings operation", "Unknown my-settings operation", "Invalid my-settings arguments", "<globalPath|localPath> must be a relative file path", "Query scope must be global, project or session", copySettings 的 "Settings must be a JSON object" 等校验文案}。throw 时无部分产物、无状态残留（函数无外部状态）。
- 异常安全档：nothrow-guarantee 等价（要么完整成功返回 fresh 值，要么干净 throw，无半成品）。

### 对 callee 的期望（下传 demand）

#### copySettings（json-settings.ts:17，本批）
- 调它时已保证：实参为 `"defaults" in input ? input.defaults : undefined` / `"values" in input ? input.values : undefined`——任意值（含 undefined）。
- 需要它保证：非对象根**以 throw 拒绝**（"Settings must be a JSON object"）——本函数把"缺 defaults/values"的拒绝完全押在该 throw 上；对象根返回深拷贝普通对象；不修改输入；对含循环/非 JSON 值/非普通嵌套对象的输入以 throw 拒绝而非静默通过。

#### Error（external-Error.md，已存在）
- 需要它保证：`new Error(message)` 对任意 message 不抛并返回 Error 实例（各 throw 点构造前置无异常）。

#### Array.isArray（external-isArray.md，本批补写）
- 调它时已保证：实参为 L11 已验的非 null 对象。
- 需要它保证：任意输入返回 boolean 不抛。

## 并发

无：纯校验函数，无共享状态、无 I/O、无锁；输入对象在同步执行期间不被并发改写的前提由 caller 侧事件循环串行化保证（on handler 全同步）。

## SP

- [L5] `!value ∨ typeof value ≠ object ∨ ¬("op" in value)` → throw（出口 A）。否则 value 为对象且有 op。
- [L6-9] `query := (value.op === "query")`；op ∈ {"query"} ∨ {"save-global","save-local","save-session"} 之外 → throw（出口 B）。合流后 op ∈ 四合法值。
- [L10-11] `input := query ? value.query : value.save`（缺键 → undefined）；`!input ∨ typeof ≠ object ∨ Array.isArray(input)` → throw（出口 C）。合流后 input 为非数组对象。
- [L12-18] paths 初始化 `{}`；for-of 恒定二元数组（key ∈ {globalPath, localPath}）：
  - 不变量 ESTABLISHMENT：paths 为空普通对象。PRESERVATION：每轮至多加一键，值 ∈ {undefined, null, string}（L16 校验）。INTERIOR：L15 读取不抛（普通对象假设下）。度量：2 元素常量数组 → 终止。
  - 非 string 且非 undefined/null → throw（出口 D）。
- [L19-28] query 分支：scope ∈ {undefined,"global","project","session"} 之外 → throw（出口 E）；返回 `{op:"query", query:{...paths, scope, defaults: copySettings(...)}}`——copySettings throw → 传播（出口 F）。
- [L29-32] save 分支：返回 `{op, save:{...paths, values: copySettings(...)}}`——copySettings throw → 传播（出口 F'）。
- 合流：A-F' 穷举全部出口；成功出口恰两个（query/save 返回）。终止：无递归、循环有界。Post 达成。

## [SELF] 前提（上传 caller）

- 无 UB 级前提（任意输入被穷举处理为返回或 throw）。
- 功能级：caller 须 catch（on handler 已做；独立导出 caller 必须自担）——前提本身：caller 调用即默示接受 throw 信道。

## 自洽

- 与唯一包内 caller（on handler）对齐：throw 信道 ↔ svc:91 catch；成功形态 ↔ execute 的 SettingsOperation 消费（svc:24-44 读 operation.query/operation.save/operation.op）。
- 与 copySettings 的实际行为一致（json-settings.ts:18 非对象根必抛——"缺 defaults/values → throw" 的押注成立）。
- query 缺 `defaults`、save 缺 `values` 必 throw：与 protocol.ts:15/20 的非可选字段声明一致（意图正确行为）；无矛盾。aligned。
