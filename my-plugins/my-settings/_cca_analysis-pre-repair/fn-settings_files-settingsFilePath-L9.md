---
function: settingsFilePath
source: {file: "settings-files.ts", line: 9}
self_consistency: mismatch
---

## 综述

`settingsFilePath(root, configured?)` 是模块导出的纯路径计算 helper（settings-files.ts:9-20）：把可选的相对配置路径（null/undefined → 默认 `my-settings.json`）解析为 `root` 下的绝对路径，并做两项词法校验——非空相对路径（L11-13）、不逃出 root（L16-18）；校验失败以 `throw new Error` 报告。不访问文件系统、不做 symlink 解析（README:20 明示非沙箱）。

## 调用者驱动契约

callgraph 入边：`settings-service.ts:L17::execute → settingsFilePath`（callgraph.json L155-157）。

1. **execute（settings-service.ts:29、30、49、50）**：四处调用全部包在 try/catch 里，catch 后 `settingsFailure("INVALID_REQUEST", error)`（svc:31-33 query 分支、svc:51-53 save 分支）。调用前提：第一参 root 为绝对目录串（global 分支 = `getAgentDir()` 结果 svc:29/49；local 分支 = `join(session.cwd, ".pi")` svc:30/50）；第二参为 parseSettingsOperation 校验过的 `string|null|undefined`（settings-operation.ts:13-18）。期望：合法路径 → 返回绝对路径供后续 readFile/writeSettingsFile 使用；非法路径 → 抛错并被映射为 INVALID_REQUEST（README:20："Absolute paths, empty paths, and paths escaping the root with `..` are rejected"）。
2. **独立模块导出 caller（entries.json:11，extern-model.md 'Module-exported helpers'）**：任何 TS 代码可直接调用。期望同上：返回路径或抛 Error（两个固定消息）。
3. **测试**：范围外，仅意图旁证。

## 契约

### Pre（调用前须成立）
- **[SELF] root 须为 string**（函数不校验第一参；root 非 string → L14/L15 `resolve` 抛 TypeError 向外传播，见异常合同——这是函数体推导出、须 caller 保证的前提。execute 侧由 getAgentDir 外部前提与 join 返回值满足）。
- configured 为 `string | null | undefined`（签名约定；传入其他类型会被 L11 的 typeof 检查捕获 → 走 L12 显式 throw，属函数自身的异常合同而非 UB）。

### Post
- 成功：返回绝对、规范化路径 = `resolve(root, name)`，且 `relative(resolve(root), 该路径)` 非空、非 `".."`、不以 `"<sep>.."` 开头、非绝对——即词法上位于 root 之内（含子目录，不含 root 本身：name="." 会被拒）。
- 失败：抛 `Error`，消息恰为两种之一——"Settings paths must be non-empty relative file paths"（configured 非字符串 / trim 后为空 / 绝对路径）或 "Settings paths must stay within their global or project root"（解析结果等于 root、为 `".."`、以 `..${sep}` 开头或 within 为绝对）。
- 不触碰文件系统：不检查存在性、不创建目录；同输入恒同输出（纯函数）。
- 异常安全档：nothrow 之外的基本保证（无资源、无副作用，throw 时无状态残留）。

### 对 callee 的期望（下传 demand）
#### trim（external-trim.md）
- 调它时已保证：this 为 string（L11 typeof 短路在先）。
- 需要它保证：返回新字符串、不抛、不改原值。

#### isAbsolute / resolve / relative（external-isAbsolute.md / external-resolve.md / external-relative.md）
- 调它们时已保证：全部实参为 string（name 经 L11 校验；root 依赖 [SELF] Pre）。
- 需要它们保证：纯词法计算、同步返回 boolean/string、不访问文件系统；非 string 入参抛 TypeError（这正是 root 前提被 [SELF] 上传的原因）。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**：
- settings-files.ts:12 显式 `throw new Error("Settings paths must be non-empty relative file paths")` —— **偏差**（extern-model.md:7：显式 throw 即便被 caller 捕获也记为偏差）。
- settings-files.ts:17 显式 `throw new Error("Settings paths must stay within their global or project root")` —— **偏差**。
- settings-files.ts:14/15 隐式 TypeError（root 非 string 时由 resolve/relative 抛出，函数无守卫）—— **偏差**。
- 除此之外（trim/isAbsolute 在其 Pre 下）无其他 throw 点。

**异常在服务/插件边界的包含效果**（不降低上面标准）：execute 的两处 try/catch（svc:28-33、47-53）把上述异常全部映射为 `INVALID_REQUEST` 结构化结果，不会冒泡出 execute；但独立模块导出 caller 若不 catch，会直接收到异常。

## 并发

无。纯词法计算，无共享状态、无 I/O、无锁；线程/协程安全由无副作用性保证。

## SP

【L10】`name = configured ?? "my-settings.json"`：仅 null/undefined 取默认（`""`、`false` 等不走默认，进 L11 判空）。
【L11-13】若 name 非 string ∨ `!name.trim()`（空/全空白）∨ `isAbsolute(name)` → L12 throw E1。合流不变量：name 为非空白相对路径 string。
【L14】`path = resolve(root, name)`：绝对化；root 非 string → TypeError（偏差出口，不在显式 throw 列表）。
【L15】`within = relative(resolve(root), path)`：root 与 path 同基准，within 即 name 的词法规范化结果。
【L16-18】若 `!within`（name="." 或 "./" 等 → 结果等于 root）∨ `within === ".."` ∨ `within.startsWith("../")`（POSIX sep="/"）∨ `isAbsolute(within)` → L17 throw E2。注意 `"..foo/bar"` 不以 `"../"` 开头 → 放行（正确）。
【L19】返回 path。合流 Post：path 为 root 内绝对路径。
【失败分支穷举】E1（L12）、TypeError（L14/15）、E2（L17）；三者之外无退出点。

## 自洽

- caller 期望对齐：execute 需要"返回路径 ∨ 抛错→INVALID_REQUEST"，实现一致；README:20 的拒绝清单与 L11/L16 判据一一对应。
- **偏差 → self_consistency=mismatch**：两处显式 throw 与 extern-model.md:7 的全函数不外抛要求冲突（确认风险：这是插件内"以异常作错误信道的既有设计"，owner 标准仍记为偏差；被 execute 完整包含为 INVALID_REQUEST，不逃逸出服务边界）。root 无守卫（[SELF]）为第二个缺口：独立 caller 传非 string root 会得到 TypeError 而非两种文档化消息之一。
