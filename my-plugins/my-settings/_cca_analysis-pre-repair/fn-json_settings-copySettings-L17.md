---
function: json-settings.ts:L17::copySettings
source: {file: "json-settings.ts", line: 17}
self_consistency: aligned
---

## 综述

JSON 深拷贝校验器（json-settings.ts:17-21）：先验根为普通对象，再经 `checkValue` 全树遍历确认每个成员都是 JSON 值（无循环、无非普通对象、无非 JSON 原始值），最后用 `JSON.parse(JSON.stringify(value))` 产生全新深拷贝。对一切非 JSON 对象根输入**以 throw 拒绝**（README:72 "non-object files ... return errors" 链条的守门员）——校验未过就没有拷贝发生。

## 调用者驱动契约

callgraph 入边（4 条）：`settings-operation.ts:L4::parseSettingsOperation`（其 L26/31，callgraph.json:142-145）、`settings-service.ts:L17::execute`（svc:58，callgraph.json:178-185）、`settings-session-log.ts:L4::readSessionSettings`（其 L15，callgraph.json:242-245）、`settings-files.ts:L22::readSettingsFile`（files:30，callgraph.json:110-113）。另有独立模块导出面（entries.json 无本函数条目？——entries.json:16 为 settingsFailure；本函数作模块导出独立可调，extern-model.md:14）。

1. **readSettingsFile（files:30，fn-settings_files-readSettingsFile-L22.md:41-43 已落盘期望）**：传 `JSON.parse(text)` 的产物——必不含循环/非普通对象（JSON 文本性质），但**根可能是非对象**（数组/原始值/null/空文件）。期望：非对象根 throw（把"文件是数组/原始值"变成拒绝）；对象根返回深拷贝普通对象且不产生其他异常。
2. **parseSettingsOperation（其 L26/31）**：传 `"defaults" in input ? input.defaults : undefined` 等任意值。期望：非对象根（含 undefined，即键缺失）throw 作为拒绝信道；对象根深拷贝。
3. **readSessionSettings（其 L15）**：传日志条目的 `data.values`（键存在已验、值任意）。期望：同 2——损坏 values 靠 throw 拒绝。
4. **execute（svc:58）**：传 `values`——已经 parseSettingsOperation 的 copySettings 验过（合法 JSON 对象根）。期望：不抛（二次校验幂等通过）、返回等值深拷贝供日志条目使用（防后续变异泄漏进 session log）。
5. **独立导出 caller**：须自行 catch；非 JSON 对象根必 throw。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **可能向外 throw**（同步；校验拒绝信道）。逐条 source:line：
  - json-settings.ts:18 `throw new Error("Settings must be a JSON object")`：value 为 falsy（null/undefined/0/""/false/NaN）、typeof 非 object（number/string/boolean/function/symbol/bigint）、或 Array.isArray。
  - json-settings.ts:19 `checkValue(value, new Set())` 传播（callee 无捕获，全部上浮）：
    - checkValue:6 `throw new Error("Settings must contain JSON values only")`——成员为 undefined/function/symbol/bigint/NaN/Infinity。
    - checkValue:7 `throw new Error("Settings must not contain cycles")`——路径环。
    - checkValue:10 `throw new Error("Settings objects must be plain JSON objects")`——非数组且原型非 Object.prototype/null（Date/Map/类实例等）。
    - checkValue:8 `Object.getPrototypeOf(value)`：敌意 Proxy trap 抛出 → 传播。
    - checkValue:13 `Object.values(value)`：**enumerable 自有 accessor 的 getter 抛出 → 传播**；递归无深度上限——**超深嵌套输入 → RangeError（Maximum call stack size exceeded）传播**（非 Error 校验文案，仍是向外 throw）。
  - json-settings.ts:20 `JSON.stringify(value)`（external-stringify.md：可同步 throw）：checkValue 只看 **enumerable 自有值**——非 enumerable 的循环属性或抛出性 `toJSON`（JSON.stringify 无视 enumerability）可溜过校验 → stringify throw TypeError → 传播。常规路径（checkValue 已过）下 stringify 无 BigInt/循环，不抛。
  - json-settings.ts:20 `JSON.parse(text)`（external-parse.md）：text 是同一值 stringify 的产物——合法 JSON 文本，parse 不抛（对 stringify 成功的输出 parse 失败需 stringify/parse 语义分裂，无此情形）；类型上仍按"可能 throw 的边界"记录，实际不可达。
  - **未见捕获**：函数内无 try——所有 throw 直接外传。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

### 【服务/插件边界的包含效果】

- 四个包内调用点的包含路径：
  - files:30 → readSettingsFile L30 无本地 try → rejection 上传 execute（svc:34-37 Promise.all，无本地 try）→ svc:89 折叠 **OPERATION_FAILED**；或 writeSettingsFile 队列 action 内（files:41）→ 队列 rejection → svc:54 上传 → svc:89。README:85 "invalid files are not overwritten" 依赖该 rejection 在 stringify（files:42）前中止。
  - parseSettingsOperation L26/31 → svc:88 处于 on handler try 内 → svc:91 catch → **INVALID_REQUEST**。
  - readSessionSettings L15 → svc:39 裸调 → svc:89 → **OPERATION_FAILED**。
  - execute svc:58 → svc:56-63 try 内 → **PARTIAL_SAVE / OPERATION_FAILED**（svc:60）；且该调用点输入已双重校验，实际不可达 throw。
  - **边界内零逃逸**；代价：错误码随折叠点分化（INVALID_REQUEST / OPERATION_FAILED / PARTIAL_SAVE），message 保留原始校验文案。
- 独立导出 caller 无包含：throw 直接外传（extern-model.md:7 显式设计记为偏差）。

## 契约（霍尔逻辑）

### Pre（调用前须成立）

- **无 UB 级前提**：value 任意值被穷举处理（L18 守卫 + checkValue 校验 → 要么深拷贝要么 throw）。超深嵌套可致 RangeError（异常合同已列）——若 caller 要求"绝不 RangeError"，须自行限深（[SELF]，见文末）。
- 功能前提（决定成功/throw，非 UB）：value 须为普通对象根、成员全为 JSON 值、无循环——违反即 throw（Post 失败分支）。

### Post（返回后保证）

- **成功**：返回全新普通对象 `Settings`：`JSON.parse(JSON.stringify(value))` 语义——树形化（共享引用被复制为独立子树）、原型归一为 Object.prototype、成员全为 JSON 值、与输入**零别名**；调用方可自由变异而不影响输入。输入 `value` 不被修改（checkValue 只动自己的 ancestors Set；stringify/parse 无副作用）。
- **失败**：同步 throw——"Settings must be a JSON object"（根非对象）、"Settings must contain JSON values only"、"Settings must not contain cycles"、"Settings objects must be plain JSON objects"、敌意对象下的原生异常（Proxy trap / getter / RangeError / stringify TypeError）。throw 时无部分产物、无状态残留。
- 无副作用：无 I/O、无日志、不改全局。异常安全档：nothrow-guarantee 等价（完整成功或干净 throw）。

### 对 callee 的期望（下传 demand）

#### checkValue（json-settings.ts:3，manifest fn，fn 文档由并行批次产出）
- 调它时已保证：value 为 L18 已验的非 null 非数组对象；ancestors 为新空 Set（独占，调用后即弃）。
- 需要它保证：对含循环/非 JSON 值/非普通嵌套对象的树**以 throw 拒绝**（绝不静默通过——L20 的 stringify 安全性押在其校验上）；合法树正常返回且不修改 value；返回后（常规路径）value 可被 stringify 安全序列化。已知残余（非 demand 违约）：enumerable-only 视野留下非 enumerable 缺口、递归深度无界——本函数接受这两项残余并在异常合同记录。

#### stringify（external-stringify.md，已存在）
- 调它时已保证：value 经 checkValue 校验（常规路径无循环/BigInt/抛出 getter）。
- 需要它保证：成功返回 JSON 文本串；失败同步 throw 且无部分输出（失败路径直接传播给 caller，无清理义务）。

#### parse（external-parse.md，已存在）
- 调它时已保证：text 为同一值 stringify 的成功产物。
- 需要它保证：合法 JSON 文本返回解析值不抛（stringify 输出恒合法 → 本调用点实际无 throw 路径）；产物为全新对象（与 stringify 的中间文本、与原 value 均无别名）。

## 并发

无：纯函数（输入只读、产物 fresh、无共享状态、无 I/O）；`ancestors` Set 为每次调用新建的局部。并发调用互不干扰。

## SP

- [L18] `!value ∨ typeof value ≠ object ∨ Array.isArray(value)` → throw（出口 A）。合流后 value 为非数组对象。
- [L19] `checkValue(value, new Set())`：
  - DFS 不变量：ancestors = 当前递归路径上的对象集合；每对象进入时 add、退出前 delete（checkValue:12-14）。ESTABLISHMENT：空 Set。PRESERVATION：子调用对称进出。INTERIOR：环判定（checkValue:7）依赖路径集语义。
  - 任一校验失败 → throw 传播（出口 B：仅 JSON 值 / 出口 C：循环 / 出口 D：非普通对象；敌意对象 → 出口 E：原生异常；超深 → 出口 F：RangeError）。
- [L20] `text := JSON.stringify(value)`（残余缺口 → 出口 G：TypeError）；`JSON.parse(text)` → 全新树 → 返回（出口 R）。
- 合流：A-G throw、R 唯一成功；R 处 value 已验证 + 产物 fresh。终止：checkValue 递归以树深度为度量但无上限（出口 F 显式记录）；stringify/parse 有界。Post 达成。

## [SELF] 前提（上传 caller）

1. **输入嵌套深度须在 JS 栈限内**（checkValue 递归 + stringify/parse 递归均无深度上限；超深 → RangeError 传播）——约束 caller：readSettingsFile（文件内容作者控制深度）、readSessionSettings/parseSettingsOperation（输入来自外部请求/日志，深度同样外部可控）；各调用点的包含效果使其最终折叠为结构化错误，但独立导出 caller 须自担。
2. （功能级，已入 Pre）"普通 JSON 对象根"——违反即 throw 拒绝，非 UB，不须上传。

## 自洽

- 与四份 caller 期望逐条对齐：readSettingsFile（非对象根必抛——其 fn 文档 L43 明示）、parseSettingsOperation（缺 defaults/values 抛）、readSessionSettings（坏 values 抛）、execute（已验输入幂等通过、深拷贝防日志别名泄漏）。
- svc:58 双重校验（parse 时 + 记录前）：幂等非冗余缺陷（第二次校验对合法输入恒通过），无行为冲突。
- 显式 throw 与 extern-model.md:7 的 no-throw owner 标准：本函数是设计中的拒绝信道，全部包内路径被包含折叠（见【服务/插件边界包含效果】），边界实效满足 README:92 "Runtime, I/O, and callback failures are contained at the service/client boundary"。aligned。
