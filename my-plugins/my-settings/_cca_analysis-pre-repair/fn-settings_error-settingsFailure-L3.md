---
function: settings-error.ts:L3::settingsFailure
source: {file: "settings-error.ts", line: 3}
self_consistency: aligned
---

## 综述

结构化失败构造器（settings-error.ts:3-9）：把任意捕获值（unknown）折进 `{ok:false, error:{code, message}}`。message 提取包在自身 try/catch 内，提取失败回落 `"Unknown settings error"`。全函数对任意输入 total、无副作用、不抛——是本插件"失败最多是结构化 SettingsResult error"判据的底座：所有 catch 块与 `.catch` 折叠点都押在它不抛上。

## 调用者驱动契约

callgraph 入边（8 条，callgraph.json）：`client.ts:L13::createMySettingsClient`（extractor 把嵌套 invoke 的调用归到工厂，实调点 client.ts:27/30）、`client.ts:L15::invoke`（client.ts:27 SERVICE_UNAVAILABLE 文案 / client.ts:30 catch 折叠）、`extension.ts:L6::mySettings`（extension.ts:35 外层 catch）、`extension.ts:L19::bind`（extension.ts:26 内层 catch）、`settings-service.ts:L17::execute`（svc:23/32/38/60）、`settings-service.ts:L67::registerMySettingsService`（extractor 把 svc:79/83/89/93 的调用归到 L67，实调点全在 on handler 内）、`settings-service.ts:L73::on`（svc:79/83/93）、`settings-service.ts:L89::catch`（svc:89 折叠箭头）。另有独立模块导出面（entries.json:16）。

1. **所有 repo caller 的共同期望**（已落盘文档明示：fn-client-createMySettingsClient-L13.md:43-45、fn-extension-bind-L19.md:50-51、fn-extension-mySettings-L6.md:58-59）：恒返回 `{ok:false, error:{code, message}}`、自身不抛——bind/mySettings 的 catch 链和 svc:89 的折叠把"catch 里再抛"当作不可接受风险，直接押在本函数不抛上。前提：caller 传入的 code 为字面量 SettingsErrorCode（全 repo 皆然），error 为捕获到的任意值。
2. **client invoke**：用 `settingsFailure("SERVICE_UNAVAILABLE", "<安装提示文案>")` 构造缺服务错误、用 `settingsFailure("OPERATION_FAILED", error)` 折叠 emit/await 异常（client.ts:27/30）；期望 message 保留提示文案或原错误信息（README:92：SERVICE_UNAVAILABLE 须含 install/enable 指引，不得默认值伪装成功）。
3. **on handler / svc:89**：期望 error.message 提取自原始异常（INVALID_REQUEST/OPERATION_FAILED 的可诊断性）；提取任何失败回落默认文案而非抛出（fn-settings_service-on-L73.md 的 catch 双保险依赖）。
4. **独立导出 caller**：任意 code/error 输入均得到结构化结果；code 参数被原样回显（本函数不校验 code 合法性——传入非法 code 会得到含非法 code 的结果，责任在 caller）。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **不向外 throw，无 reject 形态**（同步函数）。无显式 throw。逐条可能异常点：
  - settings-error.ts:6 `error instanceof Error`：右操作数为 Error 全局构造器，`instanceof` 对任意左操作数不抛（external-Error.md Pre）。
  - settings-error.ts:6 `error.message` 属性读取：普通 Error 实例不抛；敌意 Error 子类（getter 抛出）可抛 → 被 L5-7 try 捕获。
  - settings-error.ts:6 `String(error)`：对含抛出 Symbol.toPrimitive/toString 的敌意对象可抛 → 被 L5-7 try 捕获。
  - settings-error.ts:4/8 `let message` 初始化、对象字面量构造：无异常路径。
  - try/catch（L5-7）穷举覆盖 message 提取段；catch 空体回落默认文案。**结论：对任意 `(code, error)` 输入均正常返回。**
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

### 【服务/插件边界的包含效果】

- 本函数是插件全部 catch 块的公共叶子：bind（extension.ts:26）、mySettings（extension.ts:35）、on handler（svc:79/83/93）、svc:89 折叠、invoke（client.ts:27/30）、execute（svc:23/32/38/60）都把"不抛"作为自身不抛论证的前提。本函数满足之，链条闭合。
- 包含后的效果：任何失败都以结构化 SettingsResult 呈现给客户端/独立 caller；无 console 副作用、无日志；message 恒为 string 语义（见下"潜在边界"）。
- 潜在边界（非异常）：若 error 是 `.message` 被改为非 string 值的 Error 实例（如 `err.message = 42`），L6 直接取用 → `error.message` 非 string，结果对象内 message 运行时非 string（类型标注被绕过）。正常构造的 Error（`new Error(x)` ToString 化）不触发。记为潜在类型漏洞，非 UB、非逃逸。

## 契约（霍尔逻辑）

### Pre（调用前须成立）

- **无 UB 级前提**：`error` 任意值、`code` 任意值均被穷举处理（提取段有 try 兜底）。code 语义合法性由 caller 保证（功能前提，违反得到回显非法 code 的结果，非 UB）。

### Post（返回后保证）

- 恒返回**新分配**的 `{ok:false, error:{code, message}}`（fresh 对象，无共享引用）。
- `code` === 传入 code（原样回显）。
- `message`：error instanceof Error 且 `.message` 读取成功 → `error.message`；否则 `String(error)`；提取过程抛出 → `"Unknown settings error"`。
- 无副作用：不改全局、不触碰 error、不 I/O、不日志。异常安全档：nothrow（对任意输入）。

### 对 callee 的期望（下传 demand）

#### Error（external-Error.md，已存在）
- 调它时已保证：仅作 `instanceof` 判定，左操作数任意。
- 需要它保证：`instanceof` 对任意左操作数返回 boolean 不抛（Node fs 错误含 `.code` 为其子类实例，判真）。

#### String（external-String.md，本批补写）
- 调它时已保证：实参为任意 unknown（捕获值）。
- 需要它保证：常规输入返回可读字符串；敌意对象（抛出 toPrimitive）**可能同步 throw**——本函数以 L5-7 try 含之，不依赖其不抛。

## 并发

无：纯函数，无共享状态，无 I/O；并发调用互不干扰（各得 fresh 结果对象）。

## SP

- [L4] `message := "Unknown settings error"`。
- [L5-6] try：`error instanceof Error` → 真：`message := error.message`（getter 抛 → [L7]）；假：`message := String(error)`（toPrimitive 抛 → [L7]）。
- [L7] catch 空体：message 保持默认文案。
- [L8] 返回 `{ok:false, error:{code, message}}`。
- 合流：唯一出口为返回结构化失败。终止：无循环、无分支遗漏（instanceof 两路 + catch 兜底穷举）。Post 达成。

## [SELF] 前提（上传 caller）

- 无（total 函数，caller 无需任何前提）。

## 自洽

- 三份已落盘 caller 文档的期望（恒 ok:false、不抛、message 回落）与实现逐条一致。
- svc:89 `.catch` 的折叠正确性押在本函数不抛上——L5-7 try 使该押注成立。
- 非 string message 的敌意 Error 边界：与类型声明（SettingsResult.error.message: string）存在理论缝隙，正常构造路径不可达；不构成 caller 期望冲突。aligned。
