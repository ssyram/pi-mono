# open-questions.md — my-settings 独立逐函数验证轮

## extern-model 状态

`extern-model: present`（`_cca_analysis/extern-model.md`，33 行，已全文读取并于首扫使用）。

## 首扫裁决（2026-10-15，A_PREPARE_READY）

extern-model 声明的派发语义已全部落边（edges/*.json 带 source:line 锚点；edge_join.py join 10 条框架派发边 + 9 条 direct 边，富图已灌入 callgraph.json/scc_groups.json，106 条边）：

| 模型语义 | 裁决 | 锚点 |
| --- | --- | --- |
| `bus.emit(MY_SETTINGS_CHANNEL, request)` 派发到 service handler | edge（op=my-settings:service:v1）：invoke → settings-service.ts:L21 handler | client.ts:49；settings-service.ts:21 |
| service handler 调用请求方的 `accept(promise)` | edge（op=my-settings:accept-callback）：invoke → client.ts:L36 accept；direct：handler → accept | client.ts:36-47；settings-service.ts:25,27,36,46,49 |
| `pi.on(session_start/session_tree/session_shutdown)` 注册生命周期回调 | edges（op=session_start/session_tree/session_shutdown）：mySettings → bind(L67) / shutdown 闭包(L82) | extension.ts:80,81,82 |
| `withFileMutationQueue(path, action)` 由宿主队列回调 action | edge（op=file-mutation-queue）：writeSettingsFile → 匿名 action 闭包(settings-files.ts:L51) | settings-files.ts:51 |
| SettingsSession 函数端口由 service 侧经抽象调用、实现在 extension.ts 闭包 | edge（op=settings-session-ports）：resolver(extension.ts:L16) → isCurrent/getBranch/appendEntry；direct：executeSettingsQuery→isCurrent/getBranch、appendSessionSettings→isCurrent/appendEntry、writeSettingsFile→isCurrent、saveFileOnly→isCurrent | extension.ts:22-55；settings-query.ts:33,42,48；settings-session-log.ts:18,23；settings-files.ts:53,63；settings-save.ts:26 |
| `resolveSession` 参数桥接到 extension.ts 的 resolver 闭包 | direct：settings-service registerMySettingsService → extension.ts:L16 resolver | settings-service.ts:34；extension.ts:14-59 |

`unknown-dispatch`：无。所有模型声明的派发语义均已用仓内源码证据闭环。

## 半边与外部消费（非缺陷，记录义务）

- `my-settings:ready:v1`（builds_op: extension.ts:L67::bind@L74）在仓内无 `bus.on`/`pi.on` 消费者——ready 通知面向宿主与其他插件（外部消费）。edge_join 报 `建图无注册（半边）` 属预期；不伪造仓内注册边。client 不监听 ready 通道：client 的 `invoke` 依赖 `bus.emit` 同步派发期间 service handler 调用 `accept` 设定 `response`（client.ts:49-56），此语义已作为契约写进对应 fn 报告要求。

## 静态图已知噪声（不作为语义事实，逐函数报告以真实行为为准）

- 自环假阳性：`extension.ts:L36::getBranch → 自身`、`extension.ts:L46::appendEntry → 自身` 实为外部方法调用 `owner.context.sessionManager.getBranch()`（extension.ts:40）与 `pi.appendEntry(...)`（extension.ts:48），非递归。SCC 分析按平凡 SCC 处理即可。
- 启发式同名补边噪声（保留在 base 图中，不可删）：
  - `settings-save.ts:L25::saveFileOnly → extension.ts:L67::bind`：实为 `session.isCurrent.bind(session)`（settings-save.ts:26）对 `Function.prototype.bind` 的调用与 extension `bind` 函数同名碰撞；真实目标是 extension.ts:L26::isCurrent（已落 direct 边）。
  - `settings-service.ts:L14::registerMySettingsService → extension.ts:L67::bind / client.ts:L36::accept`：无直接调用关系；真实桥接已由 direct 边（→ resolver 闭包、→ dispose 闭包）与 join 边表达。

## 提取器覆盖核查（覆盖计数）

manifest 39 个函数逐一对照源码核实：全部命中真实函数/闭包定义，**无遗漏的返回方法或闭包**。其中 7 个条目是匿名闭包，提取器以调用点 callee 名命名（分析报告须写明真实构造）：

1. `client.ts:L39::catch` — `Promise.resolve(result).catch((error) => {...})` 的 reaction 箭头（client.ts:39-42）。
2. `extension.ts:L16::registerMySettingsService` — 传给 registerMySettingsService 的 session resolver 箭头（extension.ts:16-59）。
3. `extension.ts:L82::on` — `pi.on("session_shutdown", () => {...})` 的箭头（extension.ts:82-84）。
4. `settings-files.ts:L51::queue` — 传给队列的 async action 闭包（settings-files.ts:51-81）。
5. `settings-query.ts:L65::map` — `Object.keys(...).map((key) => [key, merged[key]])` 的箭头（settings-query.ts:65）。
6. `settings-service.ts:L21::on` — `bus.on(MY_SETTINGS_CHANNEL, (data) => {...})` 的 handler 箭头（settings-service.ts:21-54）。
7. `settings-service.ts:L57::value` — 返回对象中的 dispose 闭包 `value: () => {...}`（settings-service.ts:57-64）。

## join 后诊断（registered 回调可达性）

所有 registered_as 回调（service handler、accept、bind、shutdown 闭包、三个 session 端口、队列 action 闭包、dispose 闭包）在富图重算后均可自 entries.json 的入口到达：无红旗、无死代码候选。

## 其他

- 宿主灾难性事件（进程 OOM/退出）不属于 JS 异常合同，逐函数报告单独说明即可，不算偏差。
- 本轮 owner 判据：逐函数自身不向外 throw/reject；失败只能是结构化 SettingsResult/SettingsOutcome error 或安全诊断（reportSettingsError → console.error，自身不抛）。语义对照 arch/prototype.md（用户已确认）。

---

# 逐函数分析轮累积记录（2026-10-15，Batch A–F 收敛后）

## 偏差

**无。** 全仓 39 函数 0 显式 throw / 0 Promise.reject（六批独立 grep 验证）。

## 非违例分歧（对照 arch/prototype.md，均带锚点，不改码）

1. settings-files.ts:49 — `mkdir` 在入队前执行；prototype §5 将建目录折入队列内 atomicWriteObject。后果：中途失败的保存留下空目录树。判定：无害副作用，记录在案。
2. settings-kind.ts:23 — `in` 走原型链，prototype 用 own-key containsKey。后果：defaults 含 Object.prototype 内建名时多一次诊断；kind 门挡掉函数值，无值泄漏。
3. protocol.ts:4 — `MY_SETTINGS_DEFAULT_PATH = "settings.json"` 与 prototype §2 尾注 "my-settings.json" 矛盾；代码符合用户已批准的最终选择（§6 item 1），尾注视为陈旧。
4. settings-query.ts:25-33 — 校验次序（paths→defaults→isCurrent）与 prototype 的 ensureCurrentSession 前置不同；仅影响多因失败时哪个结构化错误胜出，prototype 未定 normative 次序。
5. settings-service.ts:24/:39 — 静默丢弃（accept 不可调用 / session 不匹配）处 prototype 未规定；客户端侧可观察效果为 SERVICE_UNAVAILABLE。文档缺口，非偏差。
6. settings-save.ts:46-51 — AndSession 文件成功后日志失败 ⇒ 整体失败但文件已提交；符合 prototype catchAndPrint 语义，记录语义边界。
7. client.ts:40 — 若 emit 在 handler 已运行后抛出，被选中 rejection 的诊断被跳过（诊断丢失边界，无 throw）。
8. settings-session-log.ts:36-57 — 整体 try/catch：Proxy 条目陷阱抛出会中止整个函数（exotic 域）；调用方 executeSettingsQuery 已按层跳过处理。
9. extension.ts:14/:63 — registration.value（dispose）被丢弃，无反注册路径；extension.ts:80-88 — pi.on 部分注册失败 ⇒ handler 已注册但永久惰性 + 诊断（fail-closed，符合诊断+惰性教义）。
10. external-emit.md — 就绪通道监听者异常会沿 pi.events.emit 传播（不同于 service 通道）；bind 捕获后清 active（fail-closed）。

## 运行期 unknown（宿主/环境域；均已在对应 fn 报告标注【unknown】）

- 宿主保证"扩展加载完成前不派发首个 session_start"未文档化 → missed-bind 窗口（mySettings）。
- fs/宿主队列 promise 永不 settle（卡死文件系统）→ 调用方挂起；handler→accept→invoke 全链无超时（readSettingsFile/writeSettingsFile/executeSettingsQuery/executeSettingsSave/invoke）。
- console.error 之后宿主 stderr 异步态（reportSettingsError）。
- 总线 dispose 幂等性、emit/dispose 竞态、bus.on 注册期是否同步回放积压（宿主合同）。
- 宿主变更队列调用时机无文档化超时（withFileMutationQueue）。
- 原型链投毒（Array.prototype.toJSON / .map、Object.prototype 注入）→ stringify/map 域（被 try 包含，环境域）。
- revoked Proxy 可达性（kindOf 的 Array.isArray 硬 PRE；仓内域不可达，pickValidFields 外层 try 兜底）。
- TOCTOU 残余：settings-files.ts:50 双 realpath 窗口（并发 symlink 重定向）；:63→:66 isCurrent 复检与 rename 之间的提交窗口——固有竞态，记录不可消除。
- Proxy/getter 型 context/session 对象（宿主是否传入未文档化）——全部按 contained-fallible 处理。
- 宿主 OOM/终止：JS 异常合同之外，逐函数已声明。

## 图修正记录

- edges/fn-settings_query-map-L65.json 曾含 worker 自标的 reverse-of-caller direct 边（map→executeSettingsQuery），污染 join 产生假环 {map, executeSettingsQuery}；已移入非 join `notes` 字段并从 pristine base 重灌富图（最终 39 节点 / 107 边 / 39 SCC / 2 环，均为已记录的外部调用假自环）。edge_audit `--strict-existence` PASS。
