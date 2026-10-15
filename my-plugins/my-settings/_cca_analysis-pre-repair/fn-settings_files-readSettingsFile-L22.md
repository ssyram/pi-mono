---
function: readSettingsFile
source: {file: "settings-files.ts", line: 22}
self_consistency: mismatch
---

## 综述

`readSettingsFile(path)` 是模块导出的 async 读取 helper（settings-files.ts:22-31）：读入 utf8 文本后 `copySettings(JSON.parse(text))` 深拷贝返回；唯一的宽容分支是 `ENOENT`（缺文件 = 空配置 `{}`），其余一切失败（其他 I/O 错误、非法 JSON、非对象文件）都以 Promise rejection 外传——符合 owner 判据"缺文件只有 ENOENT 才算空配置"，但 rejection 外传本身按 owner 标准记为偏差。

## 调用者驱动契约

callgraph 入边：`execute → readSettingsFile`（callgraph.json L159-161）、`writeSettingsFile → readSettingsFile`（L123-125，实为 queue action 内 L41 的调用，extractor 把 action 归到 queue 节点）、`settings-files.ts:L39::queue → readSettingsFile`（L135-137）。

1. **execute 查询分支（settings-service.ts:34-37）**：`Promise.all([readSettingsFile(globalFile), localFile ? readSettingsFile(localFile) : ...])`，两路径均为 settingsFilePath 的成功产物（绝对、root 内）。前提：无本地 try/catch——任一 rejection 使 execute 整体 reject，由 settings-service.ts:89 的 `.catch` 折叠为 `OPERATION_FAILED` 后 accept（README:72："Unreadable files, invalid JSON, non-object files ... return errors rather than silently falling back"）。期望：ENOENT → `{}`；否则 → 深拷贝 Settings；再失败 → 结构化错误。
2. **writeSettingsFile 的读-改-写（settings-files.ts:41，互斥队列 action 内）**：前提：path 合法、持有该路径的进程内写 lane。期望：读得 existing 普通对象用于合并；**文件非法时 rejection 中止写入流程**（README:85 "invalid files are not overwritten"——rejection 在 L42 stringify 之前发生，目标文件未被触碰）。rejection 经队列传播回 execute（svc:54 无本地 try）→ svc:89 → OPERATION_FAILED。
3. **独立模块导出 caller（entries.json:12）**：直接 await；自行处理 `{}` 与 rejection。
4. **测试**：范围外。

## 契约

### Pre（调用前须成立）
- 无避免 UB 的硬前提：path 非 string/含 NUL 时 readFile 以 rejection（ERR_INVALID_ARG_VALUE 等）表达，走 L28 rethrow 错误分支，不产生静默成功。

### Post
- 成功：resolve 一个**全新深拷贝**的普通对象（Settings：键 → JSON 值；copySettings 经 JSON 往返保证无别名、无循环、无原型污染），调用方可自由变异而不影响文件或其他读者。
- **ENOENT**：resolve `{}`（空配置）——且仅此一个 I/O 错误码享受该语义（L27）。
- 其他失败：reject 携带原始 Error——readFile 的非 ENOENT 错误（EACCES/EISDIR/EMFILE/ELOOP/ERR_INVALID_ARG_VALUE，L28 rethrow）、JSON.parse 的 SyntaxError（含空文件 `""` → "Unexpected end of JSON input"，L30）、copySettings 的 "Settings must be a JSON object"（文件内容为数组/原始值/null，L30）。调用方（execute 或独立 caller）负责把 rejection 变成结构化结果；本函数不做折叠。
- 无副作用：只读；不创建/修改文件。
- 异常安全档：basic（无资源、无状态；失败即带原始错误的 rejection）。

### 对 callee 的期望（下传 demand）
#### readFile（external-readFile.md）
- 调它时已保证：path 为调用方传入值、encoding "utf8"。
- 需要它保证：resolve 完整文件文本或 reject 带 `.code` 的 Error；`.code === "ENOENT"` 可靠区分缺文件（本函数的空配置判据完全押在这个属性上——该属性由 Node 契约保证）。

#### parse（external-parse.md）
- 调它时已保证：text 为 readFile resolve 的 string。
- 需要它保证：非法 JSON 同步抛 SyntaxError（本函数不捕获 → L30 rejection）；合法 JSON 返回任意 JSON 值（可能是数组/原始值，由下一个 callee 把关）。

#### copySettings（json-settings.ts:17，manifest 节点，fn 文档在别的批次）
- 调它时已保证：value 为 JSON.parse 的产物（不可能含循环/非普通对象——JSON 文本的性质），但**可能是非对象根**。
- 需要它保证：非对象根抛 Error；对象根返回深拷贝普通对象且自身不产生其他异常（其 checkValue 逻辑对 JSON.parse 产物而言循环/非普通分支不可达，但契约上仍要求它在一切违规值上抛而不是静默通过）。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**（async 函数：一切失败均以 rejection 外传）：
- settings-files.ts:28 `throw error;` 显式 rethrow 非 ENOENT 的 readFile 错误 —— **偏差**。
- settings-files.ts:30 `JSON.parse(text)` 向外传播 SyntaxError —— **偏差**。
- settings-files.ts:30 `copySettings(...)` 向外传播其 Error（非对象根等）—— **偏差**。
- ENOENT 分支（L27）不外抛：返回 `{}`，符合"缺文件只有 ENOENT 才算空配置"。
- 无同步 throw 路径（async 体首语句即 try 内 await）。

**异常在服务/插件边界的包含效果**（不降低上面标准）：两个服务内 caller 都不本地 catch——rejection 一路上传至 settings-service.ts:89 的 `.catch` 折叠为 `OPERATION_FAILED` accept，外层 Pi 受保护；但错误码不区分"读失败"与"其他操作失败"（信息损失，非逃逸）。独立模块导出 caller 不 catch 时 rejection 直接外传。

## 并发

- **无锁的纯读者**：不经互斥队列直接读文件。与持有同一队列 lane 的 writeSettingsFile 并发时，读到的内容依赖 rename 原子性——只会是完整的旧内容或完整的新内容（POSIX rename，external-rename.md），无撕裂读；跨进程写者无此保证（README:133，queue 为进程本地）。
- **[CONC] 读后失效窗口**：读取结果在调用方使用前可能过期（文件被并发改写）；查询路径的会话所有权由 execute 在读取后复查（svc:38 → SESSION_UNAVAILABLE），本函数自身不复查、无义务。
- 同 path 的多次并发 readSettingsFile 互不干扰（只读）。

## SP

【L23-25】`text = await readFile(path, "utf8")`：成功 → text 为整文件 utf8 串（可为 `""`）；失败 → 进 catch。
【L26-29】catch 内：`error.code === "ENOENT"`（且为 Error 实例、含 code 字段）→ **return {}**（空配置出口）；否则 L28 `throw error` → Promise reject（携带原错误对象）。两分支穷举 catch 出口。
【L30】`copySettings(JSON.parse(text))`：
  - JSON.parse(text)：text 非法 → SyntaxError 传播 → reject；合法 → value ∈ JSON 值全域。
  - copySettings(value)：value 非普通对象（数组/number/string/bool/null）→ throw → reject；对象 → 深拷贝。
【合流 Post】resolve（{} ∨ 深拷贝对象）∨ reject（readFile 原 Error ∨ SyntaxError ∨ copySettings Error）。
【循环/资源】无循环、无资源持有；失败路径无清理义务。

## 自洽

- caller 期望对齐：execute（README:72 错误不回退）与 writeSettingsFile（README:85 非法文件不覆盖）都依赖"非 ENOENT → rejection"的行为，实现一致；ENOENT→{} 与 owner 判据一致。
- **偏差 → self_consistency=mismatch**：L28/L30 的外传 rejection 与 extern-model.md:7 冲突（确认风险：本函数无本地结构化折叠，把异常信道留给 caller；服务边界由 svc:89 兜住为 OPERATION_FAILED，错误码粒度变粗）。
- 对 copySettings 的期望（非对象根必抛）与其源码（json-settings.ts:18）一致，无未消解假设。
