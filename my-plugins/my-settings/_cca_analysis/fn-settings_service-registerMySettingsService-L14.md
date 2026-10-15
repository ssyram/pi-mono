---
fn: "settings-service.ts:L14::registerMySettingsService"
source: "settings-service.ts"
line: 14
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-settings_service-registerMySettingsService-L14.md

## 综述

服务注册入口（settings-service.ts:14-69）：以 `bus.on(MY_SETTINGS_CHANNEL, handler)`（:21，handler 即 fn-settings_service-on-L21.md）安装 `my-settings:service:v1` 请求处理器，成功时返回 `{ok:true, value: disposeClosure}`（:55-65，dispose 即 fn-settings_service-value-L57.md），`bus.on` 同步抛出则返回结构化 `OPERATION_FAILED`（:66-68）。全程单一 try（:20-68），catch 体仅 `settingsFailure`（:67，无条件 no-throw，fn-settings_error-settingsFailure-L3.md）。**无任何向外 throw 路径；注册失败以结构化 SettingsOutcome 交付**——满足 prototype.md §6"返回的 Error 由调用方报告给 Pi，不可转成 throw"与 owner 判据。

## 契约（调用者驱动）

调用者：extension.ts:14-62（mySettings，仓内唯一调用点）。实参桥接（open-questions §首扫裁决表已落边）：bus = `pi.events`；resolveSession = extension resolver 闭包（extension.ts:16-59，直接边 settings-service → extension.ts:L16）；globalRoot = `getAgentDir()`（extension.ts:60）；queue = `withFileMutationQueue`（extension.ts:61，仅按引用注入，本函数不调用）。

- PRE（caller 义务）：bus 满足 protocol.ts:52-55（`on(channel, handler) → () => void`）；resolveSession 满足 Batch B 合同（不抛、返回 SettingsOutcome——其上游 discharge 即 handler 的 :26-33 形状校验，已在 fn-settings_service-on-L21.md 记录）；globalRoot 为 string；queue 为 `SettingsMutationQueue`（settings-files.ts:8）。参数域偏离时本函数仍 no-throw（：21 的 bus.on 对病态 bus 抛出 ⇒ :66-68 结构化；queue/globalRoot 域偏离延后到 executeSettings* 的各自合同内折为结构化失败）。
- POST（对 extension.ts）：
  - 成功：返回 ok outcome，handler 已可被该通道后续 emit 派发；dispose 闭包可用（本仓现状：extension.ts:63 只读 `.ok`，value 被丢弃——无注销路径，残留观察见 fn-extension-mySettings-L11.md）。
  - 失败（bus.on 抛出）：返回 SettingsFailure（OPERATION_FAILED）；**handler 未安装**（:21 的调用未完成返回 ⇒ 不存在半注册：要么 on 成功返回 dispose，要么进入 catch，无中间态可观察）⇒ extension.ts:63-66 诊断 + 惰性 ✔ prototype 教义（注册失败 → 诊断 + 插件保持惰性）。
  - 恒同步返回、不抛 ⇒ extension.ts:14-62 处按值处理即可，extension.ts:85 catch 为纵深防御非必需。
- POST（对 bus 生态）：注册后 `my-settings:service:v1` 的每次 emit 恰派发一次本 handler（单注册前提，见并发义务）。

## 自身异常合同（逐路径）

- :21 `bus.on(MY_SETTINGS_CHANNEL, (data) => {...})`：箭头构造不抛；`bus.on` 为外部边界（external `on` 缺口，见总报告）——同步抛出 ⇒ :66 捕获 ⇒ :67 结构化返回。**contained**。若宿主 bus 在 on 内即派发积压请求（合同层【unknown：bus.on 是否可能同步派发】）：handler 自身 no-throw（fn-settings_service-on-L21.md）⇒ 即便发生也不破坏本合同。
- :22-54 handler 体：不执行（仅构造闭包）；其运行期合同独立闭合于 fn-settings_service-on-L21.md。
- :55-65 返回对象与 dispose 闭包构造：字面量 + 闭包创建，不抛；`dispose` 绑定为 :21 的返回值（若到此必已正常返回）。
- :66-68 catch 体：仅 `settingsFailure`（no-throw）⇒ **catch 链终止，不可能二次抛出**。
- 全文件无 `throw`/`Promise.reject` 语句（settings-service.ts 全文核实）⇒ 无显式偏差。宿主灾难性 OOM/进程终止不属 JS 异常合同（open-questions §其他），单独声明。

**对照 arch/prototype.md**：§6"公共调用仍使用 pi.events 的 my-settings:service:v1" ✔（:21 通道常量 protocol.ts:1）；注册失败 ⇒ 结构化失败而非 throw ✔（:66-68）；无消费者注册表/启动屏障 ✔（本函数无注册表副作用）。callgraph 中 `registerMySettingsService → parseSettingsOperation/executeSettingsQuery/executeSettingsSave/reportSettingsError/extension.ts:L67::bind/client.ts:L36::accept` 均为**嵌套闭包同名归因噪声**（真实调用者是 handler 闭包 ：25/:34/:40/:43/:44/:51 与 client 侧闭包；open-questions §静态图已知噪声同款处置）——registerMySettingsService 函数体自身仅调 `bus.on`（:21），经 handler 构造与 :34 参数桥接间接关联，不构成直接边。

## 霍尔逻辑 SP

{P: bus 满足 protocol.ts:52-55（或病态 ⇒ 结构化失败）；resolveSession 满足 Batch B 合同；globalRoot/queue 为注册期 const 实参}
body: try { dispose := bus.on(MY_SETTINGS_CHANNEL, handlerArrow)（:21，抛 ⇒ catch）；return {ok:true, value: disposeClosure}（:55-65，闭包捕获 dispose/resolveSession/globalRoot/queue）} catch { return settingsFailure("OPERATION_FAILED", error)（:66-68，no-throw）}
{Q: 恒返回 protocol.ts:42 的 SettingsOutcome<() => SettingsOutcome<void>> ∧ 无异常逃逸 ∧ ok ⇒ handler 已注册且 dispose 可用 ∧ ¬ok ⇒ 无 handler 安装（无半注册）∧ dispose 闭包自身 no-throw（fn-settings_service-value-L57.md）}

## 并发/异步义务

- 纯同步、无 await：注册原子性由单线程保证；:21 返回前不可能有本通道 emit 派发到本 handler（除非宿主 on 内积压派发——【unknown】，见上，且无害）。
- 共享状态仅为闭包捕获（dispose/resolveSession/globalRoot/queue，均注册期写定后只读）⇒ handler 多次派发间无注册层竞态；全局无模块级可变状态（settings-service.ts 全文核实，仅 ：14 函数与 ：21/:57 闭包）。
- double registration：本函数不设防（重复调用 ⇒ 双 handler，client 首认领胜出仍无泄漏，见 fn-settings_service-on-L21.md 并发义务）；防重为 caller（宿主单次加载）PRE，仓内满足。
- 注册→首个请求的时序：handler 生效即刻起可接请求，早于首个 session_start 时 resolveSession 判 identity 不匹配 ⇒ :39 静默丢弃 ⇒ client SERVICE_UNAVAILABLE（结构化）——语义见 fn-extension-mySettings-L11.md 的【unknown：宿主保证扩展加载先于首轮派发与否】。
