---
function: extension.ts:L14::isCurrent
source: {file: "extension.ts", line: 14}
self_consistency: aligned
---

## 综述

SettingsSession 视图（ext:12-17）的 `isCurrent` 端口闭包（extension.ts:14）：`active === owner && owner.context.sessionManager.getSessionId() === sessionId` ——同步求值的**会话所有权即时快照**：要求插件级共享变量 `active`（ext:7）仍指向构造视图时的 owner 快照，且宿主会话管理器的当前会话 id 仍等于认领时的 sessionId。它是 execute 五个所有权复查点（svc:23/38/57、files:40/48）共同消费的谓词——SESSION_UNAVAILABLE / PARTIAL_SAVE 语义的判定基础。

## 调用者驱动契约

callgraph 边：`settings-service.ts:L17::execute → isCurrent`（callgraph.json:146-149，svc:23/38/57 三处经 `session.isCurrent()` 端口调用）；`settings-files.ts:L33::writeSettingsFile → isCurrent` 与 `settings-files.ts:L39::queue → isCurrent`（callgraph.json:119-121/130-133——svc:54 以**未绑定方法引用** `session.isCurrent` 传入 writeSettingsFile，files:40/48 在队列 action 内调用）。注意：`extension.ts:L6::mySettings → isCurrent` 与 `extension.ts:L9::registerMySettingsService → isCurrent` 两条构造嵌套伪影边**在 callgraph 中缺失**（同族伪影边对 getBranch/appendEntry 存在、对本端口不存在——提取器不对称），已列入返回报告；不影响执行图（真实调用边齐全）。

1. **execute（svc:23 入口 / svc:38 读取后 / svc:57 日志前）**：调它时已保证：无参；svc:23/38 的 throw → execute reject → svc:89 折叠；svc:57 的 throw → svc:59 catch → PARTIAL_SAVE/OPERATION_FAILED。期望：同步返回 boolean 即时快照；可能 throw（外部前提，execute [SELF] 5 已含）。
2. **writeSettingsFile/queue action（files:40/48，fn-settings_files-writeSettingsFile-L33.md:49-51 与 fn-settings_files-queue-L39.md:42-44 已落盘期望）**：调它时已保证：无参；在宿主队列 lane 内的同步点调用；throw 可接受（计入 rejection 路径）。期望：同 1——同步 boolean 快照；**未绑定调用安全**（ext:14 为箭头属性、body 不依赖 this，svc:54 的未绑定提取不改变语义）。

## 契约

### Pre（调用前须成立）

- **无 UB 级前提**：`active` 可为任意状态（undefined / 替换后的新 owner）——全等比较穷举处理；owner 为构造期捕获的不可变快照（ext:11 保证构造时 truthy）。
- **[SELF]（就地消解）owner.context.sessionManager 为普通属性读取的宿主构造对象**（无抛出性 getter——外部前提，同 ext:9 文档裁定）；`getSessionId()` 按外部前提可同步 throw（external-getSessionId.md）——containment 见异常合同，不升级为 caller 义务。

### Post

- 返回 **boolean 即时快照**：true 当且仅当**调用时刻** `active === owner`（插件仍绑定本视图的会话快照——bind 覆盖 / shutdown 清空 / 重绑定新对象均使其变 false，保守失效语义）**且** `owner.context.sessionManager.getSessionId() === sessionId`（宿主管理器当前会话 id 未变）；否则 false。
- 求值语义：**每次调用即时求值**——active 重读 + getSessionId 重读（非构造期缓存）；短路：`active === owner` 为 false 时不调 getSessionId（不触发宿主 API、不可能在其上 throw）。
- 无副作用：不写 active、不触宿主可变状态（getSessionId 为只读查询——external-getSessionId.md）。
- 异常安全档：nothrow 的 boolean 查询 + 可传播的外部前提异常（见异常合同）；无部分状态。

### 对 callee 的期望（下传 demand）

#### sessionManager.getSessionId（external-getSessionId.md，已存在）
- 调它时已保证：receiver 为 owner 快照的宿主 sessionManager（构造良构）；短路保证仅在 `active === owner` 成立时调用。
- 需要它保证：返回管理器**当前**会话 id（string）；可能变化（管理器复用于另一会话——extern-model.md:22，本端口以即时求值消费该语义）；可同步 throw（外部前提——传播合同见异常合同，不得吞）。

## 异常合同（owner 最严格标准）

### 【自身异常合同】

- **可能向外 throw**（无 try；显式 throw 无）。逐条 source:line：
  - extension.ts:14 `active === owner`：闭包 let 变量读取 + 全等比较——不抛。
  - extension.ts:14 `owner.context.sessionManager` 属性链：快照对象普通属性读取（外部前提：宿主构造对象无抛出性 getter）——常规不可达 throw。
  - extension.ts:14 `sessionManager.getSessionId()`：宿主 API（external-getSessionId.md：按外部前提可同步 throw）——**未捕获传播** = 自身偏差（各调用点已建模包含，见下）。
- 无 reject 形态（同步箭头）。构造时（ext:12-17 对象字面量内定义）**不执行**——构造路径无异常。

### 【服务/插件边界的包含效果】

- 调用点包含映射（throw → 最终结果形态）：
  - **svc:23**（execute 入口裸调）→ execute reject → svc:89 → **OPERATION_FAILED**。
  - **svc:38**（execute 读取后裸调）→ execute reject → svc:89 → **OPERATION_FAILED**。
  - **svc:57**（execute try svc:56-63 内）→ svc:59 catch → savedPath 已设 → **PARTIAL_SAVE**；session scope → **OPERATION_FAILED**。
  - **files:40 / files:48**（队列 action 内；files:48 位于 action 内层 try files:46-49）→ action rejection（files:48 经 files:50-52 清理后 rethrow 原错误）→ writeSettingsFile 的 `await queue(...)`（files:39）reject → execute svc:54（无本地 try）reject → svc:89 → **OPERATION_FAILED**。注：files:40/48 的 throw 走 rejection 通道、终点是 OPERATION_FAILED——**不产生 PARTIAL_SAVE**（文件尚未提交或恰在提交前中止；PARTIAL_SAVE 仅源于文件已写后的 svc:57/58 失败）。
- 服务边界零逃逸（全部终点为结构化 SettingsResult error）；未绑定引用路径（svc:54 → files:40/48）与端口路径（svc:23/38/57）包含等级相同。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

## 并发

- **[R] active（extension.ts:7，插件级共享可变量）**：写者为 bind（session_start/session_tree，ext:21；catch 路径 ext:25）、session_shutdown（ext:32）、mySettings catch 路径（ext:34）；读者为本端口（ext:14）与 resolveSession 回调（ext:10-11）。无锁——JS 单线程事件循环，本端口的同步求值帧内读取原子；与写者帧不交叠。
- **[CONC] 即时快照与 TOCTOU 分工**：本端口保证"求值时刻"的所有权真值；**不提供跨 await 的保护**。调用方的防护设计 = 在每个 await 窗口后重新调用本端口（svc:23 入口 → svc:34 await → svc:38 复查；files:40 → await 们 → files:48 复查；svc:54 await → svc:57 复查）——快照失效窗口由复查点收敛，残余窗口（最后一次检查与 rename 提交之间）由 execute svc:57 兜为 PARTIAL_SAVE（尽力检查 + 显式报告，非硬互斥——execute/queue/writeSettingsFile 文档并发节已详）。
- **[CONC] 双条件求值窗口**：`active === owner` 与 `getSessionId() === sessionId` 在同一同步帧内先后求值——两者之间无 await，事件循环不可插入替换；快照内部原子。
- session_tree 重绑定的保守失效：bind 以**新对象**覆盖 active（ext:21）——即使 sessionId 与 context 都不变，旧快照的本端口也返回 false（身份比较优先于值比较）；与 extern-model.md:22 "Do not assume captured context remains current" 一致。

## SP

- [L14] body 单表达式，两条件与：
  - `active === owner`：false → 返回 false（出口 F₂，短路——未触宿主 API）。
  - true → `owner.context.sessionManager.getSessionId() === sessionId`：宿主 API throw（外部前提）→ 出口 A（传播，包含映射见异常合同）；比较 false → 出口 F₂；true → 出口 F₁。
- 出口穷举：F₁（true）、F₂（false）、A（getSessionId throw → 各调用点包含）。终止：单帧同步。Post 达成。

## [SELF] 前提（消解记录与上传清单）

1. **（就地消解）"同步返回 boolean 即时快照"**：execute [SELF] 5 / writeSettingsFile·queue 文档对本端口的 demand——由构造性满足（无 await 的同步求值 + active 重读 + getSessionId 重读 + 短路）；不须 caller 新增义务。
2. **（就地消解——外部前提）getSessionId 可 throw**：external-getSessionId.md 固化；本端口无 try → 传播 = 自身偏差，各调用点包含映射完整（svc:23/38/54 与 files:40/48 → OPERATION_FAILED；svc:57 → PARTIAL_SAVE/OPERATION_FAILED）——无 UB、无逃逸。
3. **（就地消解）未绑定调用安全**：ext:14 为箭头函数属性、body 不引用 this——svc:54 的未绑定方法引用传递不改变语义。
4. 无需向 caller 上传的新前提。

## 自洽

- 与 execute 的期望（fn-settings_service-execute-L17.md:41-43 [SELF] 5）对齐：即时快照 + throw 可接受 + 五复查点包含映射一致（files:40/48 终点精确化为 OPERATION_FAILED——execute 文档 43 行 "svc:57/files:40/48 点 → 结构化 PARTIAL_SAVE/OPERATION_FAILED" 的合写在此拆分为逐点精确映射）。
- 与 writeSettingsFile/queue 文档（"返回 boolean、throw 可接受"）对齐；与 ext:9 文档 [SELF] 3 的透传层定位一致。
- 与 extern-model.md:22（getSessionId 可能变化）和 md:36（"session.isCurrent is also passed into writeSettingsFile as an ownership guard and invoked there"）的未绑定传递事实一致。aligned。
