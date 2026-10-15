---
fn: "extension.ts:L11::mySettings"
source: "extension.ts"
line: 11
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-extension-mySettings-L11.md

## 综述

扩展包默认导出的入口函数（extension.ts:11-89；经 index.ts `export { default }` 露出，extern-model §Public entry surfaces）。由宿主在扩展加载期调用一次，同步返回 void。职责三段：(1) 注册 service——`registerMySettingsService(pi.events, resolver, getAgentDir(), withFileMutationQueue)`（extension.ts:14-62），构造 resolver 闭包（fn-extension-registerMySettingsService-L16.md）；(2) 注册失败 ⇒ 诊断 + 提前返回保持惰性（extension.ts:63-66）；(3) 注册成功 ⇒ 注册三个生命周期回调 session_start/session_tree→bind、session_shutdown→匿名箭头（extension.ts:80-82）。整体 try/catch（extension.ts:13-88），失败路径 `active = undefined` + `reportSettingsError`（extension.ts:86-87）。

共享可变状态：仅闭包单元 `active`（extension.ts:12）——resolver/ports/bind/shutdown 全部共享，无其他模块级状态。

## 契约（调用者驱动）

调用者：宿主扩展加载器（加载后调用默认导出；本仓无其他调用点）。

- 对宿主的 POST：**任何输入、任何内部失败下都不同步抛出**（自身 catch-all + reportSettingsError 不抛）。宿主的加载失败兜底（loader 侧 catch，loader.ts:626）存在但不作前提。
- 对插件生态的 POST（成功路径）：service 已注册（`my-settings:service:v1` 有 handler，settings-service.ts:21）∧ 三个生命周期回调已挂 ⇒ 后续 session_start/session_tree 激活服务、session_shutdown 停用；ready 通道随 bind 广播。
- 失败路径 POST：仅 console.error 诊断（extension.ts:64 或 ：87），插件惰性（service handler 虽已注册但 active 永远为 undefined ⇒ 所有请求被 resolver 拒为 undefined ⇒ SERVICE_UNAVAILABLE）——符合 prototype「注册失败 → 诊断 + 插件保持惰性」✔。
- PRE：pi 满足 ExtensionAPI（types.ts:1592+）；单次调用假设（宿主契约；重复调用会重复注册 service handler 与生命周期回调，本函数不设防——宿主派发模型内单次，标注为前提）。

## 自身异常合同（逐路径）

- extension.ts:14-62 注册调用：被调 `registerMySettingsService` 自身全程 try/catch、按契约返回 SettingsOutcome 不抛（settings-service.ts:20-68）；作为外部边界仍按可失败对待 ⇒ 逃逸则 :85 捕获。实参求值：`pi.events` 属性读取（:15）不抛（异常访问器情形落 ：85）；resolver 闭包构造不抛。
- extension.ts:60 `getAgentDir()`：外部调用。原生实现（packages/coding-agent/src/config.ts:605-611）：env 读取 + `expandTildePath` + `homedir()/join`——`os.homedir()` 在无法确定主目录的环境可抛（Node 文档级行为），非零但病态概率；落 :85 捕获 ⇒ 诊断 + 惰性。
- extension.ts:61 `withFileMutationQueue`：**仅按引用传递**（作为 `SettingsMutationQueue` 实参注入 service），本函数不调用它；真实调用点在 settings-files.ts:51（其他批次范围）。无异常面。
- extension.ts:63-66 注册失败分支：`registration.error.message` 属性读取 + `reportSettingsError`（不抛，settings-error.ts:12-15）+ return。注：失败时 service 未注册成功（bus.on 抛出路径，settings-service.ts:66-68 返回 failure），无半注册残留。
- extension.ts:80-82 `pi.on(...)` ×3：外部注册边界。原生证据（loader.ts:272-287）：先 `assertActive()`——扩展 failed/stale 时抛（loader.ts:254-259）；正常加载期 state="loading" 必过；其后为纯内存 handlers 表操作，不抛。接口上按可失败对待 ⇒ :85 捕获。
- **部分注册危害**（:80-82 中途抛出，如 session_start 已挂、session_tree 抛）：catch ⇒ `active = undefined`（:86）+ 诊断（:87）。已挂的 bind 因宿主永不派发对应事件而失效 ⇒ active 永不被置 ⇒ resolver 恒 undefined ⇒ 服务惰性（所有请求 SERVICE_UNAVAILABLE）+ 已有诊断。no-throw/诊断/惰性三条件仍满足 ✔ prototype 教义。**残留观察**：service handler 已注册且 `registration.value`（dispose）被**丢弃**（:14 接收后从未存储、:63 只读 `.ok`）⇒ 无任何注销路径，bus.on 的订阅无法回收。进程生命周期型扩展下无实际泄漏；记为观察项而非偏差（prototype 未要求注销路径）。
- extension.ts:85-88 catch 体：赋值不抛 + reportSettingsError 不抛 ⇒ catch 不可能二次抛出。
- 全文件无显式 `throw` 语句（extension.ts 全文核实）；不依赖 Pi 对插件异常的兜底（runner.ts:1111-1120 containment 仅佐证）。宿主灾难性 OOM/进程终止不属于 JS 异常合同（open-questions.md §其他），单独说明不算偏差。

对照 arch/prototype.md：注册 all-or-nothing 从扩展视角成立（失败 ⇒ 诊断 + 惰性，extension.ts:63-66/:85-88）✔；ready 仅在 active 置位后发出 ✔（fn-extension-bind-L67.md）；shutdown 清 active ✔（fn-extension-on-L82.md）。

## 霍尔逻辑 SP

{P: pi 满足 ExtensionAPI；本函数被宿主调用一次；active 单元 :12}
body: registration := registerMySettingsService(pi.events, resolver, getAgentDir(), withFileMutationQueue)（:14-62）；¬registration.ok ⇒ reportSettingsError(-registration.error.message) ∧ return（:63-66，惰性退出）；否则注册 bind（session_start/session_tree）与 shutdown 箭头（:80-82）；任一步同步异常 ⇒ active := undefined ∧ reportSettingsError（:86-87）
{Q: 成功 ⇒ service + 三生命周期回调就绪、active 初始为 undefined（待 bind）；失败（任一层）⇒ 诊断 + 惰性；无任何异常逃出函数体}

## 并发/异步义务

- 本函数体内无 await、无异步派发后置逻辑：加载期单线程顺序执行，注册原子性无竞态。
- 与首次 session_start 派发的先后：若宿主在加载完成前派发 session_start，bind 未注册则错过（service 已可接收请求但 active=undefined ⇒ SERVICE_UNAVAILABLE，直至下一次 session_start/session_tree）——宿主派发时序前提，非本函数可闭合，标注【unknown：宿主保证扩展加载先于首轮 session_start 派发与否】。
- `active` 的全部后续变更只发生在三个宿主回调与 catch 内（:69、:76、:83、:86），均同步单语句 ⇒ 单线程下无撕裂；跨回调的状态机（未激活→激活→停用→可复活）见各 fn 文件。
- 边界声明：`mySettings → extension.ts:L36::getBranch / L46::appendEntry / settings-error.ts:L3::settingsFailure`（callgraph 现存边）为嵌套闭包同名启发式噪声——mySettings 函数体（:11-13、:60-66、:80-88）不调用这三者，真实调用者分别是 resolver/端口构造（:22-55）与 :64/:87 的 reportSettingsError。逐函数语义以本文件为准（open-questions §静态图已知噪声同款处置）。
