# self-check.md — 覆盖对账与质量门

## 1. manifest 覆盖对账

> **更正记录**：本文件初版（及 goal.md）曾声明"29/29 一一对应、无缺失"，该声明当时不真实——按 manifest.analysis_file 实际核对为 28/29，缺 `fn-settings_service-registerMySettingsService-L67.md`（settings-service.ts:67 导出注册壳；当时唯一同名文件 fn-extension-registerMySettingsService-L9.md 是另一个实体——ext:9-17 的 resolveSession 回调，不能替代）。补齐轮已对该函数完成原规定的 caller 契约/异常合同/SP/资源与并发义务/edge 证据分析并落盘，现确为 29/29。此更正不改变既有 28 份报告内容。

- **函数**：manifest 29 个 `kind=function` 条目 ↔ `fn-*.md` 29 份，一一对应、非空、无一缺失、无一多余（28 份原批 + 1 份补齐轮 batch-fix67）。工作集 = entries.json 16 入口在 join 图（59 边）上的可达闭包 = 全部 29 函数（逐边核对；3 条伪影自环不影响可达性结论）。**闭包外 manifest 函数：0**。
- **提取器覆盖缺口申报**：10 个生产文件人工通读对账，所有函数形态节点（含匿名回调/闭包/箭头方法/catch 回调）均已入 manifest，无未覆盖者。manifest 命名怪癖（以调用点方法名命名匿名函数）已在 open-questions.md §A 逐条映射，未据名误判语义。
- **skipped（58 条，全部 test/ 下）**：`test/settings-errors.test.ts`、`test/settings-fixture.ts`、`test/settings-lifecycle.test.ts`、`test/settings-query.test.ts`、`test/sdk-runtime.ts` 的函数/回调，理由 = 排除名 `test`（owner 范围：仅根目录生产 TS）。`test/sdk-import.mjs` 为非 TS 资源未入清单。不参与 no-throw 结论。
- **external**：manifest 33 个 ↔ `external-*.md` 33 份，一一对应。31 份由 worker write-once 落盘；`external-startsWith.md`、`external-error.md` 由主线程在收敛段补写（worker 分工未及，manifest 有条目）。manifest 无条目而代码中出现的可调用点（`Function.prototype.bind`@svc:77、`pi.on/pi.appendEntry/pi.events.emit` 宿主方法、`Promise.prototype.catch`、`Array.prototype.map`、`sessionManager.getBranch`）按规未建 external 文件：其前提分别固化于对应 fn 文档与 edges 事实（svc:77 的同名碰撞为伪影 A4）。
- **非函数源文件**：index.ts（纯 re-export，无函数）、protocol.ts（常量/类型）、3 个 JSON 配置——无函数形态节点，不进 fn 集。

## 2. 产物完整性

- 静态图：callgraph.json 29 节点 / 59 边（静态 53 + join/direct 补边 6 条净新增）；scc_groups.json 29 SCC（3 自环：checkValue 真递归、getBranch/appendEntry 伪影）。
- 富图：edges/*.json 33 份 edge-delta（含 4 份主线程补齐的缺失文件：mySettings、bind、on-L32、svc:L67；早期 4 份主线程文件与 worker 文件存在 op 事实重叠，collect_deltas 按集合去重，幂等无冲突）。`edge_join.py` 重算成功、`edge_audit.py --strict-existence` **PASS**（29 fn / 33 edge-delta / 21 条 join 派发边 / 无悬空、无未解析注册回调）。唯一 WARN：`bus:my-settings:ready:v1` 建图无注册 —— 结构性事实（消费者在包外，extern-model.md:34 明示），非断链（open-questions.md §H1）。
- op 统一裁决：`promise-rejection-fold:*`→`promise-rejection:*`（execute rejection 与 catch-L89 同一语义两侧）、`host:withFileMutationQueue action`→`queue:withFileMutationQueue`、isCurrent 端口 op 简化——均为同一派发语义的命名对齐，两侧各有独立源码锚点，非伪造边。

## 3. 敷衍词扫描

grep 模式 `TODO|待补|待定|略。|同上|省略|不展开|此处从简` 命中 3 处，逐一核验均为合法指代：settingsFilePath 文档"期望同上"紧跟完整期望定义；external-stringify 的"省略"描述 JSON.stringify 成员省略行为；on(L73) 文档"同上（出口 B'）"指向前一同构出口的完整描述。**无敷衍 SP 段**；29 份文档均含 SP/异常合同/并发义务/[SELF] 章节实体内容。

## 4. worker 上传前提（[SELF]）传播账

| 前提 | 上传方 | 消解点 | 状态 |
| --- | --- | --- | --- |
| settingsFilePath：root 须 string | files:L9 | execute 四调用点（getAgentDir/ExtensionContext.cwd 宿主前提） | 收 |
| writeSettingsFile：values 无循环 JSON | files:L33 | execute svc:54 ← parseSettingsOperation→copySettings（settings-operation.ts:31） | 收 |
| writeSettingsFile：queue 宿主互斥语义 / isCurrent 所有权快照 | files:L33 | execute svc:54（extension.ts:18/ext:14 注入）；独立导出调用面无守卫 → 记为契约缺口 R6 | 收 + 记录 |
| readSessionSettings：entries 元素非 null 对象 | session-log:L4 | execute svc:39 ← getBranch 宿主前提 → 固化于 fn-getBranch/external-getSessionId | 收 |
| copySettings：嵌套深度栈限内 | json:L17（经 checkValue） | 各调用点 = 敌意输入残余 U2（服务边界折叠，不要求新保证） | 收 + unknown |
| execute/getBranch：返回数组、元素非 null | svc:L17→ext:L15 | 宿主 sessionManager 前提（native 佐证 session-manager.ts:1469-1479） | 收 |
| execute/appendEntry：失败以 throw 可见 | svc:L17→ext:L16 | 原生同步 void 签名（types.ts:1747、agent-session.ts:3436-3442）+ ext:16 无 try 转发 | 收 |
| isCurrent：同步 boolean 快照、可 throw | svc:L17/files:L33/L39→ext:L14 | ext:14 自身偏差 + 五调用点包含映射精确化（isCurrent 文档 L54 为准） | 收 |
| map：defaults/merged 普通对象 | svc:L41 | copySettings 产物就地满足 | 收 |
| createMySettingsClient：owner 非空 | client:L13 | 入口前提，README:35-38 文档化 | 收 |

传播过程中**无重新进入已分析函数的重复推理**（已分析者一律引用既有文档/标 unknown），终止保证成立。

## 5. 潜在 bug / 风险清单（详见 open-questions.md §R）

R1 client.ts:27 迟到 accept → unhandled rejection（仅第三方 handler 可触发）；R2 writeSettingsFile TOCTOU（files:48 复查与 rename 间窗口，PARTIAL_SAVE 兜底、文件不回滚）；R3 settingsFilePath 不拦 NUL 字节（下游 ERR_INVALID_ARG_VALUE，仍结构化）；R4 svc:54 未绑定 isCurrent 提取（this 依赖实现会 TypeError；包内构造流安全）；R5 files:51 吞清理失败 → .tmp 残留无诊断；R6 writeSettingsFile 独立导出调用面无 values/queue/isCurrent 本地守卫；R7 checkValue 不可枚举循环属性/抛出性 toJSON 绕过 → stringify throw（json-settings.ts:19-20）；R8 settings-error.ts:6 敌意 Error.message 非 string 类型缝隙。**断链点：0**（edge_audit PASS）。

**自身外抛偏差计数（更正，实体口径）**：14/29 函数自身向外 throw/reject（createMySettingsClient、settingsFilePath、readSettingsFile、writeSettingsFile、files:queue、checkValue、copySettings、parseSettingsOperation、readSessionSettings、execute、isCurrent、getBranch、appendEntry、svc:L67），逐个 source:line 见 goal.md §5 与各 fn 文档；其余 15 个自身不外抛。先前"22"系分组计数误差，现按 fn 文档异常合同节精确化。

## 6. unknown 清单

U1 session_tree 重绑定即使 context/sessionId 未变也使在途旧视图失效（ext:11 `active === owner` 保守语义——行为正确、意图未证实）；U2 copySettings 输入深度（敌意输入残余，服务边界折叠）；U3 宿主若将 appendEntry 改为 Promise 返回，svc:59 的同步 try 不再能包含（宿主契约变更前提，现契约下不可达）。

## 7. owner 判据逐条自检

1. 逐函数自身异常合同与边界包含效果分离 ✔（每份 fn 文档两节分写；14/29 函数自身外抛记为偏差，不以"外层兜底/测试过/README"抵扣）。
2. 失败 = 结构化 error / 安全诊断；缺服务 = SERVICE_UNAVAILABLE + 安装提示 ✔（client:27 文案、插件自身失败路径零逃逸但严格限定 R1 第三方迟到 accept 条件为记录在案的例外、无默认值伪装路径）。
3. getter/proxy、回调、JSON、I/O、Promise、reply、日志、生命周期边界均有真实失败路径与捕获点（source:line）；宿主 OOM/进程终止单列 ✔。
4. 合并序 defaults<global<project<session、只返回请求键、falsy 保留、路径相对 agent-dir 与 cwd/.pi、global/local 只写己文件再记日志、身份/branch/并发读改写/替换会话在途操作/部分成功——均按源码推理落档 ✔。
5. 未改任何源码/测试/共享定义；未跑付费集成；分析产物仅写 _cca_analysis/ ✔。**结论形态：逐函数证据 + 反例 + 最小修复建议已交付；因存在 14 个自身外抛偏差（owner 标准下），本分析不宣称"所有生产函数无外抛"的安全通过——按判据据实报告。**
