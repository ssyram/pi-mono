# Open Questions — my-settings CCodeAnalyze-decoupled（最终版）

## extern-model

- `extern-model: present` — 全文先读；其声明的全部派发语义（Pi 生命周期、事件总线、accept 回执、mutation queue、函数值端口、rejection 语义）均已落边（edges/*.json，33 份 edge-delta）或记为结构性半边（§H）。无 `unknown-dispatch` 遗留。

## R — 潜在 bug / 风险（带 source:line；均为分析结论，未改源码）

- **R1** client.ts:27 vs :21-23 竞态：emit 后无同步 accept 即返回 SERVICE_UNAVAILABLE；若第三方 handler **迟到**调用 accept，该 response promise 永不被 await → unhandled rejection。本插件服务恒同步 accept（svc:79/83/90），仅恶意/第三方 handler 可触发。最小修复建议：invoke 中对 `response ??=` 后的迟到 accept 加标记或 `response.catch(() => {})` 兜挂。
- **R2** writeSettingsFile TOCTOU：files:48 复查与 files:49 rename 提交间存在窗口，失活会话仍可提交文件；execute svc:57 兜底 PARTIAL_SAVE、文件不回滚（README:87 已文档化）。进程内 lane 只串行本进程，跨进程写者无互斥（README:133）。
- **R3** settingsFilePath 不拦 NUL 字节路径（files:11/16 无校验）→ 下游 fs 以 ERR_INVALID_ARG_VALUE 失败——仍为结构化错误，非静默成功。
- **R4** svc:54 以未绑定方法引用提取 `session.isCurrent`：对依赖 `this` 的 SettingsSession 实现会产生 TypeError（files:40/48）。包内唯一构造流（ext:14 箭头属性）无 this 依赖，安全；建议在 SettingsSession 契约注明"端口不得依赖 this"。
- **R5** files:51 `unlink(temporary).catch(() => {})` 吞掉清理失败 → `.tmp` 残留且无诊断。观察项；最小修复：catch 内 console.error（保持不抛）。
- **R6** writeSettingsFile 作为独立导出 helper 对 `values/queue/isCurrent` 无本地守卫（其 [SELF] 前提仅由 execute 注入满足）；独立直调者违约时 stringify/mkdir/queue 行为不可控。建议 README 注明导出契约。
- **R7** checkValue 仅遍历 enumerable 自有属性：不可枚举循环属性或抛出性 `toJSON` 可绕过校验使 json-settings.ts:20 `stringify` throw（敌意对象残余缺口；传播路径均被服务边界折叠为 OPERATION_FAILED/INVALID_REQUEST）。
- **R8** settings-error.ts:6 敌意 Error（`.message` 被赋非 string）→ 结果 message 运行时非 string（类型缝隙；正常构造不可达）。

## U — unknown（需人/后续裁决，不影响结构化失败终点）

- **U1** session_tree 重绑定即使 context/sessionId 未变也使在途旧视图失效（ext:11 `active === owner` 保守语义）——行为正确（旧视图全守卫拒绝），**意图未证实**。
- **U2** copySettings/checkValue 输入嵌套深度无上限（json-settings.ts:13 递归）——敌意输入 RangeError 为残余风险，各入口路径均被服务边界折叠；不要求新保证。
- **U3** 宿主若将 `pi.appendEntry` 改为 Promise 返回语义，svc:59 的同步 try 不再能包含其失败（宿主契约变更前提；现原生同步 void 签名下不可达，已注记于 fn-appendEntry）。

## A — 提取器伪影（callgraph.json 中的非调用边，勿按字面读）

1. `ext:L15::getBranch` 自环 = 体内 `sessionManager.getBranch()`（ext:15）宿主调用的名字碰撞；非递归。
2. `ext:L16::appendEntry` 自环 = 体内 `pi.appendEntry()`（ext:16）同款；非递归。
3. `svc:L67 → ext:L19::bind` 与 `svc:L73::on → ext:L19::bind` = svc:77 `data.accept.bind(data)`（Function.prototype.bind）与生命周期回调 bind 的同名碰撞。
4. `svc:L67 → {parseSettingsOperation, catch-L89, execute, accept}` = handler 体调用归因到外层注册函数的嵌套伪影。
5. `svc:L73::on → client:L21::accept` 语义正确（accept 经 request 对象传值派发，client:17-24 构造流闭合），保留为真实派发边。
6. 构造嵌套边 `mySettings/ext:L9 → getBranch/appendEntry`（视图端口词法定义）非调用；同族 `→ isCurrent` 两条在静态图中缺失（提取器不对称）——一致性缺口，不影响执行图（isCurrent 实调边齐全），join 后 mySettings→bind/on(L32) 等真实注册派发边已补足。

## H — 半边裁决（edge_audit 唯一 WARN，非断链）

- **H1** `bus:my-settings:ready:v1` 建图无注册：ext:23 广播 ready，消费者在本包外部（extern-model.md:34"no production consumer migration is part of this source scope"）。包内无注册者是设计事实；不伪造注册者。
- 其余 registered 无 build 侧的 op（pi-event ×3、resolveSession、端口 ×3、builtin ×2、queue action）已在收敛段通过真实调用点 builds_op 补全 join（audit PASS）；无遗留。

## 前提与边界（外部给定，非本包可证）

- `getAgentDir()`、`withFileMutationQueue`（lane 串行/finally 释放/rejection 传播，已对照 file-mutation-queue.ts:33-56）、`pi.on/emit/appendEntry`（同步 void、可失败）、`sessionManager.getSessionId/getBranch`（可 throw、返回良构分支条目，native 佐证 session-manager.ts:1469-1479）——宿主 API 契约按 extern-model 建模于 external-*.md。
- 宿主灾难性 OOM/进程终止不属于任何函数的 JS 异常合同（各 fn 文档单独注明）。
- 错误码粒度差（svc:88 INVALID_REQUEST vs svc:34/39/54 OPERATION_FAILED）为设计事实，非 bug。

## 覆盖计数（最终，补齐轮更正）

manifest 函数 29 / fn 文档 29（28 份原批 + 1 份补齐轮：`fn-settings_service-registerMySettingsService-L67.md`，其自身偏差 = svc:73 bus.on 同步 throw 传播，已计入 goal.md §5 偏差清单；初版"29/29 无缺失"的声明系主线程文件计数错误，已在本文件与 self-check.md §1 更正）；manifest external 33 / external 文档 33；skipped 58（全部 test/，理由=排除名）；join 后图 29 节点 / 59 边；edge-delta 33 份；edge_audit `--strict-existence` PASS（补齐轮幂等复跑）；断链 0；`unknown-dispatch` 0。
