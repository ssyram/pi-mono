---
function: extension.ts:L15::getBranch
source: {file: "extension.ts", line: 15}
self_consistency: aligned
---

## 综述

SettingsSession 视图（ext:12-17）的 `getBranch` 端口闭包（extension.ts:15）：无参同步转发宿主 `owner.context.sessionManager.getBranch()`，向服务侧暴露**分支本地**的会话日志条目（extern-model.md:24 "Read only getBranch() for branch-local settings"）。不读 `active`、不做所有权检查——分支时效由 caller 的 isCurrent 复查点保证；宿主 API 失败原样 throw 外传。

## 调用者驱动契约

callgraph 边（4 条，均需裁定）：`settings-service.ts:L17::execute → getBranch`（callgraph.json:166-169，**真实调用边**）；`extension.ts:L6::mySettings → getBranch` 与 `extension.ts:L9::registerMySettingsService → getBranch`（构造嵌套伪影——闭包在 ext:9-17 回调体内定义/构造，非调用）；`getBranch → getBranch` 自环（伪影，open-questions.md:9-10：体内调宿主 `sessionManager.getBranch()`，提取器按方法名误配到本地闭包，非递归）。

1. **execute（svc:39，fn-settings_service-execute-L17.md:63-64 已落盘期望）**：调它时已保证：无参；调用点在 svc:38 `isCurrent()` 复查**通过后**、与 svc:39 同一同步帧（无 await 间隔——execute 并发节"svc:38 检查 → svc:39 读取之间：全同步，无窗口"），此刻 owner 仍为当前会话。期望（execute [SELF] 消解 3 上传链的终点）：返回数组且**每个元素为非 null 的条目对象**（readSessionSettings L7 对 entry.type/customType/data 裸属性读的前提）；失败以 throw 表达（svc:39 裸调 → execute reject → svc:89 折叠）。

## 契约

### Pre（调用前须成立）

- **无 UB 级前提需 caller 新增**：owner 为 ext:10 快照（视图构造前提——ext:11 保证构造视图时 owner truthy，闭包捕获后不可变）；`owner.context` / `.sessionManager` 为宿主构造对象的普通属性读取（外部前提：无抛出性 getter，同 ext:9 文档"对 callee 的期望"节）。
- 功能前提（决定正确性而非 UB）：caller 在紧邻的 isCurrent 通过后调用（svc:38→svc:39 同步帧）——否则返回值可能属于已替换会话的分支（本端口无自守卫，见并发节）。

### Post

- 成功：透传宿主 getBranch() 的返回值——**数组，元素均为非 null 的条目对象**（宿主 API 前提，见下节固化；条目内容反映调用时刻的分支 leaf→root 路径）；本端口不做拷贝/过滤/校验，返回引用由 caller 消费（readSessionSettings 只读遍历）。
- 失败：宿主 API throw → 本端口**原样向外 throw**（自身偏差，见异常合同；不得吞错伪装空分支——svc:39 裸调路径把它折叠为 OPERATION_FAILED，非"空配置"）。
- 异常安全档：basic（无本地状态，throw 无副作用残留）。

### 对 callee 的期望（下传 demand）

#### 宿主 sessionManager.getBranch（原生 API；不在 manifest.external——前提固化于下节，不建 external 文件）
- 调它时已保证：receiver 为 ext:10 快照的 sessionManager（宿主构造良构对象）；无参。
- 需要它保证：返回数组、元素均为非 null 条目对象（只读分支本地条目）；常规不抛、按外部前提建模可能同步 throw（throw 经本端口上浮 svc:39 → OPERATION_FAILED——不吞）。

## 宿主 API 前提：sessionManager.getBranch（external-getSessionId.md 同款风格）

- 来源引用点：extension.ts:15（getBranch 端口体内 `owner.context.sessionManager.getBranch()`）；服务侧消费点 settings-service.ts:39（`readSessionSettings(session.getBranch())`）。
- kind：native 宿主 API（ExtensionSessionManager；extern-model.md 'Pi lifecycle dispatch'）。**不在 manifest.external 列表——不建 external 文件，本节为该前提的固化位置**（execute [SELF] 消解 3 / ext:9 [SELF] 1 上传链的终点）。
- Pre：无参；receiver 为宿主构造并持有的 sessionManager（owner.context.sessionManager）。
- Post：返回**当前分支**（leaf→root 路径）的条目数组；**元素均为宿主存储的非 null 条目对象**；只读语义（extern-model.md:24——getBranch 是分支本地条目的唯一合法证据源，getEntries()/全分支不等价）。原生佐证（外部证据，非本包源码）：packages/coding-agent/src/core/session-manager.ts:1469-1479 `getBranch(fromId?): SessionEntry[]`——从 byId 映射的存储条目对象回溯构造，元素非 null。
- 可否 throw-reject：常规路径为纯内存遍历（原生证据）不抛；按外部前提建模可能同步 throw——唯一调用点 svc:39 → execute reject → svc:89 → OPERATION_FAILED。宿主 OOM/进程终止除外。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **可能向外 throw**（无 try 的透传端口；显式 throw 无）。逐条 source:line：
  - extension.ts:15 `owner.context.sessionManager` 属性链：快照对象上的普通属性读取（外部前提：宿主构造对象无抛出性 getter）——常规不可达 throw。
  - extension.ts:15 `sessionManager.getBranch()`：宿主 API（上文前提节）——可同步 throw，**未捕获传播** → 唯一调用点 svc:39。
- 无 reject 形态（同步箭头，返回值直接透传）。

### 【服务/插件边界的包含效果】

- 唯一调用点 svc:39（execute 体内裸调，无本地 try）→ throw 使 execute reject → svc:89 `.catch` 折叠为 **OPERATION_FAILED** → accept 收到的 Promise 恒 resolve——服务边界零逃逸。**不得**因该包含而把宿主失败读作"空分支"：readSessionSettings 不会执行，客户端得到结构化错误（满足 owner 判据，非默认值伪装）。
- 构造伪影边（mySettings/ext:9 → 本端口）不构成调用路径；本端口构造时（ext:12-17 对象字面量）**不执行**。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

## 并发

- **不读 `active`**：body 只用构造期捕获的 `owner` 快照——无 active 失效窗口、无 TOCTOU 自守卫问题；会话替换（bind 覆盖 active / shutdown 清空）不会改变本端口读取的 manager（仍为旧快照的）。
- **[CONC] 时效义务在 caller**：本端口返回"调用时刻"的分支状态。execute 的设计把唯一调用点放在 svc:38 isCurrent 通过后的**同一同步帧**（无 await 间隔）——事件循环单线程下，检查与调用之间不可插入会话替换；因此读到的分支属于已确认当前会话。若未来新增跨 await 的调用点，须自行补 isCurrent 复查（本端口不提供防护）。
- 宿主对分支的并发追加（同进程其他代码路径 appendEntry）在单线程事件循环内与本同步调用不交叠——返回值为调用时刻的一致快照（原生实现为同步遍历，session-manager.ts:1469-1479）。

## SP

- [L15] body 单表达式：`owner.context.sessionManager.getBranch()`。
  - 出口 R：宿主前提满足 → 返回条目数组（元素非 null 条目对象）→ 透传给 svc:39 → readSessionSettings 只读消费。
  - 出口 A：宿主 API throw（外部前提）→ 未捕获传播 → execute reject → svc:89 → OPERATION_FAILED。
- 终止：单次同步调用（原生遍历有限）。Post 达成。

## [SELF] 前提（消解记录与上传清单）

1. **（就地消解——宿主 API 前提）"返回数组、元素均为非 null 条目对象"**：execute [SELF] 消解 3 → ext:9 [SELF] 1 的上传链终止于此——承担者是宿主 API（上文"宿主 API 前提"节，external-getSessionId.md 同款风格固化，含原生佐证），**非 execute 调用点义务**；宿主前提满足时 readSessionSettings L7 的裸属性读安全，违反时经 throw/rejection 通道折叠为 OPERATION_FAILED（含但非意图）。
2. **（就地消解）owner.context / .sessionManager 属性链无抛出性 getter**：宿主构造对象外部前提（同 ext:9 文档裁定）——不升级为 caller 义务。
3. 无需向 caller 上传的新前提。

## 自洽

- 与 execute 的期望（fn-settings_service-execute-L17.md:63-64）对齐：数组 + 非 null 元素前提在本处固化（宿主 API 承担）、throw 形态失败与 svc:39 包含路径一致。
- 与 ext:9 文档（fn-extension-registerMySettingsService-L9.md:42 [SELF] 1）的透传层定位一致；与 extern-model.md:24 的只读分支语义一致。
- 自环伪影已由 open-questions.md:9 裁定，本端口无递归。aligned。
