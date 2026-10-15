---
function: extension.ts:L6::mySettings
source: {file: "extension.ts", line: 6}
self_consistency: aligned
---

## 综述

Pi 扩展工厂（包默认导出，宿主在扩展加载时调用一次；entries.json + extern-model 'Public entry surface'）。它在本进程内完成三组注册：(1) 经 registerMySettingsService 在事件总线 `my-settings:service:v1` 频道注册服务处理器，并注入三个函数值端口——resolveSession 闭包（extension.ts:9-17，基于闭包变量 `active` 做会话所有权判定）、globalRoot=getAgentDir()、队列=withFileMutationQueue；(2) 把生命周期回调 `bind`（extension.ts:19）注册到 `session_start` 与 `session_tree`（建立/替换 `active` 并广播 ready 事件）；(3) 把匿名回调注册到 `session_shutdown`（清 `active`）。

整个函数体包在单个 try/catch（extension.ts:8-37）中：任何注册期同步失败都降级为一条 `[my-settings] …` console.error 诊断，绝不向外抛。它是本插件在宿主侧的唯一初始化入口；注册失败时插件保持"无服务"状态，客户端会得到 SERVICE_UNAVAILABLE（client.ts:27），不存在默认值伪装成功。

## 调用者驱动契约

### Pi 扩展宿主（packages/coding-agent extension runner；经 index.ts:1 默认再导出）
- 前提：宿主按扩展工厂语义调用本函数，传入 ExtensionAPI。无 UB 级前提——`pi` 为任意值（含 null/undefined）时 extension.ts:9 `pi.events` 属性读取抛出的 TypeError 落入 L33 catch。
- 功能前提：宿主调用一次（重复调用会重复注册处理器——非 UB，accept 首记录语义使其无害，client.ts:22）。
- 期望：调用后不向外抛；成功路径下服务处理器与三个生命周期回调已注册；失败路径下已输出诊断且不伪装成功。

## 异常合同

### 函数自身
- 不向外 throw（同步 void 函数，无 Promise）。无显式 throw 语句。extension.ts:33-37 catch 覆盖 L8-32 的全部同步异常。

### 逐操作清单（source:line）
- extension.ts:9 `registerMySettingsService(pi.events, …)`：内部 bus.on 为宿主 API，可同步 throw → L33 捕获。
- extension.ts:18 `getAgentDir()`：宿主 API，可同步 throw（external 前提，external-getAgentDir.md）；实参在 L9 调用前求值 → L33 捕获。
- extension.ts:30-32 `pi.on(...)` ×3：宿主 API，可同步 throw → L33 捕获。
- extension.ts:35 `settingsFailure(...)`：自身 no-throw（settings-error.ts:5-7 内部 try）。
- extension.ts:36 `console.error(...)`：位于 `try{}catch{}` 内（L36），双保险。
- 宿主灾难性 OOM / 进程终止：非普通 JS 异常，不在本合同内（单独注明）。

### 服务/插件边界的包含效果
本函数是插件加载边界：即使（按本分析不会）向外抛，宿主 runner 也有兜底——owner 标准下这不降低自身合同，仅作边界事实记录。包含后的效果：诊断输出、`active=undefined`、服务未注册或部分注册（注册逐条进行，如 `pi.on("session_start")` 已成功而 `pi.on("session_tree")` 抛出时，前者仍会在宿主派发时运行——失败不回滚）。无服务时客户端经 invoke 的 no-accept 路径得到结构化 SERVICE_UNAVAILABLE（client.ts:27，含安装提示文案），满足 owner 特判据。

## 契约（霍尔逻辑）

### Pre
- 无 UB 级前提（任意 `pi` 值只导致被捕获的异常）。
- 功能性前提归宿主派发模型：宿主在扩展加载时调用。

### Post
- 正常返回 undefined。
- 成功路径：服务处理器已注册于 `my-settings:service:v1`；`session_start`/`session_tree` → bind（extension.ts:19）；`session_shutdown` → 清 `active` 回调（extension.ts:32）；此刻 `active === undefined`。
- 失败路径（L33 捕获）：`active === undefined`；已输出 `[my-settings] <message>` 诊断；注册状态为"部分或全部完成"（不回滚）；不抛。
- 对调用方的失败形态保证：任何后续客户端请求在服务未注册/会话未持有时得到结构化 SERVICE_UNAVAILABLE（client.ts:27），绝不默认值伪装。

### 对 callee 的期望
#### registerMySettingsService（settings-service.ts:67，repo）
- 调它时已保证：bus 为 pi.events（宿主事件总线）；resolveSession 闭包已构造；globalRoot=getAgentDir() 结果；queue=withFileMutationQueue。
- 需要它保证：同步完成注册或同步 throw（无异步半注册）；返回的解除注册函数本调用方丢弃（插件随进程存活，无解除注册义务）。
#### getAgentDir（external-getAgentDir.md）
- 调它时已保证：宿主运行时已初始化。
- 需要它保证：返回 string 路径或同步 throw（二者皆被容纳）。
#### pi.on（宿主 API；不在 manifest.external 列表，见返回报告）
- 调它时已保证：事件名与回调形态合法。
- 需要它保证：注册后宿主按 extern-model 'Pi lifecycle dispatch' 派发；同步 throw 被容纳。
#### settingsFailure（repo）
- 需要它保证：no-throw、恒返回 `{ok:false,…}` 结构化失败。

## 并发
- `active` 闭包变量：[W] 本函数 catch 路径 extension.ts:34；[W]（经由本函数注册的回调）bind L21/L25、shutdown L32；[R] resolveSession 闭包 L10-11、isCurrent 闭包 L14。
- JS 单线程事件循环，各同步段原子；无锁。跨 await 的在途操作（service execute）通过 owner 身份比较 + isCurrent 复验防护（extension.ts:11/14）。
- check/act 窗口：resolveSession 快照 `active`（L10）后，服务端再用 isCurrent 复验——设计内的 TOCTOU 防护，非裸窗口。

## SP
- [L7] `active = undefined`。
- [L8-18] 进入 try；求值实参（pi.events、resolveSession 闭包、getAgentDir()、withFileMutationQueue）→ 调 registerMySettingsService。任一步同步 throw ⇒ 跳 [L33]。
- [L19-29] 定义 bind（无执行效果）。
- [L30-32] pi.on ×3；任一 throw ⇒ [L33]。
- [L33-37] catch：`active=undefined`；settingsFailure（no-throw）恒返回 ok:false ⇒ `!failure.ok` 恒真 ⇒ console.error（自身 try 包裹，最坏吞掉）。
- 合流：两条路径都正常返回、不向外抛。终止：无循环。Post 达成。

## [SELF] 前提
- 无（宿主无需任何额外保证即不会 UB；功能级前提已并入调用者驱动契约）。

## 自洽
Pre/Post 与宿主派发模型（extern-model）、registerMySettingsService 契约、bind/shutdown 对 `active` 的读写闭环一致。aligned。
