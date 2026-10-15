---
function: extension.ts:L16::appendEntry
source: {file: "extension.ts", line: 16}
self_consistency: aligned
---

## 综述

SettingsSession 视图（ext:12-17）的 `appendEntry` 端口闭包（extension.ts:16）：`(type, data) => pi.appendEntry(type, data)` ——无 try 的同步透传，把服务侧的会话日志追加请求转发给宿主 Pi API 的原生持久化（extern-model.md:24 "synchronously requests native non-message session-log persistence. It can fail."）。**失败必须以 throw 形式可见**：execute 的 PARTIAL_SAVE 显式报告（svc:59-62）依赖该失败形态，本端口不得吞错伪装成功。

## 调用者驱动契约

callgraph 边（4 条，均需裁定）：`settings-service.ts:L17::execute → appendEntry`（callgraph.json:178-181，**真实调用边**，svc:58）；`extension.ts:L6::mySettings → appendEntry` 与 `extension.ts:L9::registerMySettingsService → appendEntry`（构造嵌套伪影——闭包在 ext:9-17 内构造，非调用）；`appendEntry → appendEntry` 自环（伪影，open-questions.md:10——体内调 `pi.appendEntry`，提取器按方法名误配，非递归）。

1. **execute（svc:58，fn-settings_service-execute-L17.md:70-71 已落盘期望）**：调它时已保证：type = MY_SETTINGS_ENTRY_TYPE（protocol.ts:3，常量 string "my-settings-v1"）；data = `{scope, values: copySettings(values)}`——普通对象、scope ∈ {global, project, session}（svc:44 三元）、values 为新鲜深拷贝（svc:58 实参内联求值）；调用点在 svc:57 isCurrent 复查**通过后**、同一同步帧（无 await 间隔），此刻宿主当前会话仍为已认领会话。期望：同步转发持久化请求；成功返回 undefined；**失败以 throw 可见**（PARTIAL_SAVE/OPERATION_FAILED 显式报告依赖之）。

## 契约

### Pre（调用前须成立）

- type：string；data：任意（原生 API 形态为 `appendEntry(customType: string, data?: unknown): void`——原生佐证见下节；本端口与原生层均不校验 data 结构，svc:58 传入良构 SettingsLog 形态）。
- **无 UB 级前提需 caller 新增**：owner 快照非空（视图构造前提）；`pi` 为构造期捕获的 ExtensionAPI（ext:16 闭包变量，宿主注入良构）。
- 功能前提（决定语义正确性）：caller 在紧邻的 isCurrent 通过后调用（svc:57→svc:58 同步帧）——本端口**无所有权自守卫**且持久化目标是宿主**当前**会话（见并发节），无该前提则可能把日志写进替换后的会话（违反 extern-model.md:50 "must not write a log into a replacement session"）。

### Post

- 成功：返回 undefined；宿主已把该条目同步追加进其当前会话的会话日志（非消息条目；原生实现同步完成——见下节佐证）。
- 失败：宿主 API 失败 → **以同步 throw 向外可见**（extern-model "It can fail"；原生形态为同步 void 调用，无 Promise/rejection 通道）——本端口原样上浮，不吞、不重试、不伪装成功。
- 异常安全档：basic（无本地状态；throw 无副作用残留——持久化成败由宿主侧决定）。

### 对 callee 的期望（下传 demand）

#### pi.appendEntry（原生宿主 API；不在 manifest.external——前提固化于下节，不建 external 文件）
- 调它时已保证：customType 为非空 string 常量、data 为普通对象；receiver 为宿主注入的 ExtensionAPI（构造期良构）。
- 需要它保证：同步执行（void，不返回 Promise——否则 svc:59 的同步 catch 无法包含 eventual rejection，见异常合同注记）；成功无异常返回；失败以同步 throw 表达且**不静默**。

## 宿主 API 前提：pi.appendEntry（external-getSessionId.md 同款风格）

- 来源引用点：extension.ts:16（appendEntry 端口体内 `pi.appendEntry(type, data)`）；服务侧调用点 settings-service.ts:58。
- kind：native 宿主 API（ExtensionAPI；extern-model.md 'Pi lifecycle dispatch' + 'It can fail'）。**不在 manifest.external 列表——不建 external 文件，本节为该前提的固化位置**（execute [SELF] 消解 6 / ext:9 [SELF] 2 上传链的终点）。
- Pre：customType 为 string；data 任意（原生 TS 标注 `data?: unknown`）；receiver 为宿主注入的 ExtensionAPI。
- Post：同步把 `{customType, data}` 作为非消息条目持久化进宿主**当前**会话日志；返回 undefined。原生佐证（外部证据，非本包源码）：packages/coding-agent/src/core/extensions/types.ts:1747 `appendEntry<T = unknown>(customType: string, data?: T): void`——**同步 void 签名，无 Promise**；实现 packages/coding-agent/src/core/agent-session.ts:3436-3442——同步调 sessionManager.appendCustomEntry + getEntry + `_emit`，无异步化。
- 可否 throw-reject：**失败形态 = 同步 throw**（外部前提 "It can fail" + 同步 void 原生证据）——svc:59 的同步 catch 才能包含之。注记：若宿主未来改为返回可 reject 的 Promise，execute svc:56-63 的 try 将不包含 eventual rejection（extern-model.md:42）——该情形属宿主契约变更，现契约下不可达。宿主 OOM/进程终止除外。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **可能向外 throw**（无 try 透传端口；无显式 throw 语句）。逐条 source:line：
  - extension.ts:16 `pi.appendEntry(type, data)`：宿主 API（上文前提节）——失败同步 throw，**未捕获传播** → 唯一调用点 svc:58。
  - 实参求值（type/data 由 caller 已构造）在本端口体内无求值步骤——无其他异常源。
- 无 reject 形态（同步箭头）。**转发无 try 正是设计**：它保证宿主失败对服务侧可见——若此处吞错，PARTIAL_SAVE 语义失效（文件已写却报 ok:true，违反 owner "不得默认值伪装成功" 判据）。

### 【服务/插件边界的包含效果】

- 唯一调用点 svc:58 位于 execute 的 try（svc:56-63）内 → throw 被 svc:59 捕获 → `settingsFailure(savedPath ? "PARTIAL_SAVE" : "OPERATION_FAILED", error)`（svc:60）——savedPath 已设（global/project scope，文件已写）→ **PARTIAL_SAVE**（消息前缀 "Saved <path>, but session log failed: …"，svc:61）；session scope（savedPath 为 undefined）→ **OPERATION_FAILED**。服务边界零逃逸，部分持久化显式报告（extern-model.md:50）。
- 构造伪影边（mySettings/ext:9 → 本端口）不构成调用路径；本端口构造时（ext:12-17 对象字面量）**不执行**。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明；进程死于"文件已写、日志未记"窗口的状态由 execute Post 注记覆盖）。

## 并发

- **不读 `active`**：body 只用构造期捕获的 `pi`——active 替换不改变本端口行为；无 TOCTOU 自守卫。
- **[CONC] 持久化目标的时效义务在 caller**：原生 API 写入宿主**当前**会话（agent-session.ts:3437 `this.sessionManager`——运行时当前 manager，非端口捕获的 owner 快照）。execute 的设计把唯一调用点放在 svc:57 isCurrent 通过后的**同一同步帧**——事件循环单线程下，复查与追加之间不可插入会话替换，故写入目标 = 已认领会话。若未来新增跨 await 的调用点，须自行补 isCurrent 复查（本端口不提供防护——这正是 svc:57 显式 throw 检查存在的理由）。
- 宿主侧并发：`_emit({type: "entry_appended", ...})`（agent-session.ts:3440）为同步派发，在单线程事件循环内完成；无跨 await 状态。

## SP

- [L16] body 单表达式：`pi.appendEntry(type, data)`。
  - 出口 R：宿主成功 → undefined → svc:58 顺序完成 → execute 走向 svc:64 出口 J。
  - 出口 A：宿主失败 throw（外部前提）→ 未捕获传播 → svc:59 catch → PARTIAL_SAVE / OPERATION_FAILED（按 savedPath 三元）→ svc:62 return（出口 I）。
- 终止：单次同步调用。Post 达成。

## [SELF] 前提（消解记录与上传清单）

1. **（就地消解——宿主 API 前提）"失败以 throw 可见"**：execute [SELF] 消解 6 → ext:9 [SELF] 2 的上传链终止于此——承担者是宿主 API 的同步 throw 失败形态（上文"宿主 API 前提"节固化，含原生签名佐证）+ 本端口无 try 转发的构造性保证；**非 execute 调用点义务**。
2. **（就地消解）"同步 void、无 Promise 失败通道"**：原生签名佐证（types.ts:1747 / agent-session.ts:3436-3442）——svc:59 同步 catch 的包含有效性依据，就地收。
3. 无需向 caller 上传的新前提。

## 自洽

- 与 execute 的期望（fn-settings_service-execute-L17.md:70-71）对齐：throw 可见 + 同步转发 + PARTIAL_SAVE 依赖链一致。
- 与 ext:9 文档（fn-extension-registerMySettingsService-L9.md:43 [SELF] 2）的透传层定位一致；与 extern-model.md:24（"synchronously requests … It can fail. The plugin must not rely on Pi catching its errors."）一致——插件自含失败（svc:59），不依赖 Pi 兜底。
- 自环伪影已由 open-questions.md:10 裁定，本端口无递归。aligned。
