# goal.md — my-settings 架构与逐函数分析总纲

RUN_STATUS: COMPLETED

## 1. 系统是什么

`my-settings` 是 Pi 的一个独立扩展包（`my-plugins/my-settings/`，protocol v1），在 Pi 公共事件总线上提供共享设置服务：分层读取（defaults < global 文件 < project 文件 < session 日志）、补丁式保存（global/project 文件 + session 日志追加）、结构化错误结果。不迁移任何既有消费者、不注册工具或命令。

生产源码 10 个文件（全部在包根）：`index.ts`（纯 re-export）、`extension.ts`（扩展工厂 + 生命周期绑定）、`client.ts`（纯客户端工厂）、`protocol.ts`（常量与类型，无函数）、`settings-service.ts`（服务注册 + 操作执行）、`settings-files.ts`（文件路径校验/读写）、`settings-operation.ts`（请求解析校验）、`settings-session-log.ts`（分支日志读取）、`settings-error.ts`（错误结果构造）、`json-settings.ts`（JSON 值深校验与拷贝）。

## 2. 架构与数据流

### 2.1 三条外部驱动的控制流（extern-model.md 派发模型，已全部落边）

1. **Pi 生命周期**：宿主 extension runner 调用工厂 `mySettings(pi)`（加载时一次）→ 注册 `session_start`/`session_tree` → `bind`（ext:19-29，建立 `active` 认领并广播 ready）、`session_shutdown` → 匿名回调（ext:32，清 `active`）。join 边：mySettings→bind、mySettings→on(L32)。
2. **事件总线请求**：消费者 `createMySettingsClient(bus, owner)` → 返回 `query/saveGlobal/saveLocal/saveSession` → `invoke` 构造请求 `{session, sessionId, operation, accept}` 并 `bus.emit("my-settings:service:v1")`（client:26）→ 服务回调 `on(L73)`（svc:73-96）同步认领：校验 accept/session/sessionId → `resolveSession`（ext:9-17 回调，按 manager 身份 + sessionId 认领，产出 SettingsSession 视图）→ `parseSettingsOperation` → `execute(...).catch(...)` → `accept(resultPromise)` 同步交付。join/direct 边：invoke→on、on→ext:L9、on→accept、invoke→accept。
3. **文件变更队列**：`execute` → `writeSettingsFile(path, values, queue, isCurrent)` → `queue(path, async action)`（宿主 `withFileMutationQueue`，extension.ts:18 注入）→ lane 内原子写：读旧值 → 合并 → 写 `.tmp`（`wx`）→ 所有权复查 → `rename` → 失败清理 `unlink().catch(()=>{})`。join 边：writeSettingsFile→queue、queue→isCurrent/catch。

### 2.2 数据流与合并语义

- **读（query）**：`settingsFilePath(globalRoot, globalPath)` 与 `settingsFilePath(join(cwd, ".pi"), localPath)` 解析两层文件路径（拒绝绝对/空/越界 `..`，缺省 `my-settings.json`）→ `readSettingsFile`（ENOENT=空对象；其他 I/O 错、非法 JSON、非对象文件 = 错误结果）→ scope 决定层数：global=仅 global；project=+project；session（默认）=+`readSessionSettings(session.getBranch())`（仅 `type==="custom" && customType==="my-settings-v1"` 的条目，按序合并 `data.values`）→ `{...defaults, ...global, ...project, ...current}` → **只返回 defaults 中的键**（svc:41 map 回调）。`false/0/""/null` 显式值保留；缺键回退。
- **写（save-global/save-local/save-session）**：scope 映射 op→层。文件层（global/local）：`writeSettingsFile` 队列内读-改-写、顶层键合并、原子 rename；随后**当前 session 日志追加同一补丁**（svc:58）。save-session 仅追加日志。文件写与日志追加非事务：文件成功 + 日志失败 = `PARTIAL_SAVE`（消息含已存路径，不回滚）。
- **值模型**：`SettingValue` = JSON 值（有限 number、string、bool、null、数组、普通对象）；`copySettings` 经 `checkValue` 递归校验（环/原型/类型）后 `JSON.parse(JSON.stringify())` 深拷贝。

### 2.3 资源生命周期（分配/释放）

无手动内存管理（GC）；资源生命周期实体为：
- **临时文件** `.tmp`（files:44 `randomUUID()` 命名，files:47 创建 `wx`，files:49 rename 提交，files:51 失败清理）。清理失败被吞 → `.tmp` 残留（观察项，无诊断）。
- **目录** files:45 `mkdir(recursive)`（幂等创建，不删除）。
- **事件总线订阅**：`registerMySettingsService` 返回 `bus.on` 的退订句柄（svc:96）；生命周期订阅由 Pi 在运行时 disposal/reload 清理（README:119）。
- **`active` 闭包槽**（ext:7）：唯一跨回调共享状态，认领/替换/清除见 §4。

## 3. 入口识别（entries.json 16 条；PRE 写实）

| 入口 | PRE（调用方必须满足） |
| --- | --- |
| `mySettings(pi)`（ext:6） | 无 UB 级前提（任意 `pi` 值仅导致被捕获异常）；宿主按扩展工厂语义调用一次 |
| `bind`（ext:19，session_start/session_tree） | 宿主以 ExtensionContext 派发；`context.sessionManager` 提供getSessionId/getBranch（external-getSessionId/宿主前提） |
| shutdown 回调（ext:32） | 无前提（纯赋值） |
| 服务回调 on(L73) | 总线以 `{accept: function, session, sessionId, operation}` 请求对象派发；畸形请求 → 结构化 INVALID_REQUEST 或静默忽略（无 accept 时） |
| `createMySettingsClient(bus, owner)`（client:13） | `owner` 非 null/undefined（否则 client:14 同步 TypeError）；`bus` 具 SettingsEventBus 语义 |
| `query/saveGlobal/saveLocal/saveSession`（client:34-37） | 经工厂获得；参数为 SettingsQuery/SettingsSave（运行时校验在服务端 parseSettingsOperation） |
| 导出 helpers：settingsFilePath / readSettingsFile / writeSettingsFile / parseSettingsOperation / readSessionSettings / settingsFailure / copySettings | 各自 PRE 见对应 fn 文档（如 settingsFilePath 要求 root 为 string；writeSettingsFile 要求 values 已为无循环 JSON 对象、queue 具宿主互斥语义——独立导出调用面无本地守卫，[SELF] 已记录） |

索引.ts/protocol.ts 无函数。29 个 manifest 函数 = 16 入口 + 13 内层（invoke、accept、execute、svc:map/catch-L89、svc:L67 注册壳、ext:L9 resolveSession 回调、ext:isCurrent/getBranch/appendEntry、files:queue action/catch-L51、json:checkValue），全部在 join 图上自入口可达（edge_audit PASS），29 份 fn 文档一一对应（svc:L67 为补齐轮交付）。

## 4. 核心数据结构不变量与共享状态/同步盘点

### 4.1 `active`（extension.ts:7）——插件级共享变量，唯一跨回调状态

- 不变量：`active === undefined` 或 `{context, sessionId}` 为**最近一次 bind 的认领快照**；shutdown 置 undefined；bind（start/tree）替换。
- 端口闭包以 `owner`（构造时快照）判定：`isCurrent = active === owner && manager.getSessionId() === sessionId`（ext:14）。**manager 复用防护**：即使 Pi 复用同一 manager 跑新会话，`getSessionId()` 变化使旧视图失活。
- 同步义务：bind 内 ext:21 写、shutdown ext:32 写、resolveSession svc:86 认领读、各 isCurrent 调用读——全部同步段，无 await 穿越读写之间（bind 的 emit 在写之后同一同步段）。**在途操作窗口**：execute 的 await 期间 active 可被替换 → 每个副作用前的 isCurrent 复查（svc:23/38/57、files:40/48）+ PARTIAL_SAVE 语义兜底；旧会话可恰在 files:48 检查后、rename 前失活（TOCTOU 窗口，文件不回滚——README:87 文档化）。
- **无并发线程**：单进程事件循环 + 宿主 mutation queue 的 lane 串行；无锁原语。"无并发"成立于 JS 交错意义，交错义务如上逐点列出。

### 4.2 SettingsSession 视图（ext:12-17）

svc:86 每次认领**新建**视图（cwd、isCurrent、getBranch、appendEntry 端口闭包捕获 owner 快照）；视图不可变，失效判定走 isCurrent。svc:54 以未绑定引用提取 `session.isCurrent`（ext:14 箭头属性无 this 依赖故安全；接口其他实现若依赖 this 会 TypeError——契约注记）。

### 4.3 请求/响应协议（protocol.ts）

- `SettingsResult` 判别联合：`{ok:true, values}` | `{ok:false, error:{code,message}}`，5 个错误码。
- accept 首记录语义（client:22 `response ??=`）：多 handler 竞争时首个同步 accept 胜出。
- 同步认领义务（extern-model + native emit 语义）：服务回调在首个 await 前完成 accept；客户端 emit 后无 response → `SERVICE_UNAVAILABLE`（含安装提示，不默认值伪装、不留 pending、不起 timer）。残余：第三方迟到 accept 的 promise 无人 await → unhandled rejection（open-questions.md 风险项 R1）。

### 4.4 session 日志条目

`{type:"custom", customType:"my-settings-v1", data:{scope, values}}`；`readSessionSettings` 对缺 scope/values 或 scope 非法的条目 throw（→ OPERATION_FAILED 折叠，非静默跳过——README:72"invalid session logs return errors"）。

## 5. 逐函数异常合同总判定（owner 最严格标准）

> 覆盖声明更正（补齐轮）：原报告曾误称 fn 文档 29/29 一一对应，实际当时为 28/29（缺 `fn-settings_service-registerMySettingsService-L67.md`）；本轮已补齐该函数分析后为 **29/29**。以下异常计数按 29 份 fn 文档异常合同节的实体结论精确化（以各 fn 文档为准，此处为汇总口径；先前"22"的数字系把安全清单的分组项数误当函数实体数，现予更正）。

**自身不向外 throw/reject 的函数（15）**：`mySettings`（ext:8-37 try 全包）、`bind`（ext:20-28 try 包，catch 内 console.error 双包）、`on(L32)`（纯赋值）、`ext:L9` resolveSession 回调（体无调用执行，仅属性比较与视图构造）、`settingsFailure`（自身 try 包 message 提取）、`invoke`（client:25-31 全捕获）、`accept`（client:21-23 纯赋值）、`query/saveGlobal/saveLocal/saveSession`（转发 invoke）、`svc:map`（纯构造，前提由 copySettings 产物满足）、`files:catch-L51`（空函数）、`svc:on(L73)`（svc:75-95 整体 try，catch 内再包）、`svc:catch-L89`（调 settingsFailure）。

**自身外抛 = 偏差（14，全部带 source:line 与包含点，详见各 fn 文档）**：
1. `createMySettingsClient` — client:14 对 null owner 的隐式 TypeError。
2. `settingsFilePath` — files:12/17 显式 throw ×2。
3. `readSettingsFile` — files:28 非 ENOENT rethrow、files:30 JSON.parse SyntaxError（含空文件）+ copySettings 传播。
4. `writeSettingsFile` — files:39 `await queue(...)` 的 action rejection 全量传播（stringify/mkdir/writeFile/rename/isCurrent 等）。
5. `files:queue` action — files:40/48 显式 throw、files:52 rethrow。
6. `checkValue` — json:6/7/10 显式 throw ×3 + json:13 递归深度 RangeError。
7. `copySettings` — json:18 显式 throw + checkValue 传播 + json:20 stringify 敌意缺口（R7）。
8. `parseSettingsOperation` — settings-operation.ts:5/8/11/16/22 显式 throw ×5。
9. `readSessionSettings` — session-log:10/13 显式 throw ×2 + copySettings 传播。
10. `execute` — svc:57 显式 throw + await 链未捕获传播（svc:34-37/38/39/54 不在 try 内）。
11. `isCurrent` — ext:14 getSessionId throw 传播（外部前提，无 try）。
12. `getBranch` — ext:15 宿主调用传播（无 try）。
13. `appendEntry` — ext:16 pi.appendEntry 传播（无 try）。
14. `svc:L67::registerMySettingsService` — svc:73 bus.on 同步 throw 传播（外部前提，无 try；唯一 caller mySettings ext:33 catch 包含）。

**包含效果（服务/插件边界）**：on(L73) 整体 try → INVALID_REQUEST；execute rejection → catch-L89 → OPERATION_FAILED；PARTIAL_SAVE 仅文件已写后日志失败（svc:57/58）；client invoke 全捕获；mySettings/bind 失败 → console.error 诊断（双包 try）。缺服务 = SERVICE_UNAVAILABLE + 安装提示。**没有任何路径以默认值伪装成功**；所有失败终点均为结构化 SettingsResult 或安全 Pi 诊断。**插件自身失败路径（mySettings/bind/handler/execute/invoke 的捕获边界）对 Pi 零异常逃逸——该结论严格限定于插件自身构造的失败源（R8 敌意 message 等类型缝隙除外）；不涵盖客户端 accept 通道的第三方残余：R1（emit 后无同步 accept 时返回 SERVICE_UNAVAILABLE，若第三方 handler 迟到调用 accept，该 promise 无人 await 可成 unhandled rejection）为记录在案的例外条件。** 宿主灾难性 OOM/进程终止不在任何函数合同内（单独注明于各 fn 文档）。

## 6. 交付物索引

- 逐函数：`fn-*.md` ×29（每份含综述/调用者驱动契约/异常合同[自身 vs 边界分开]/SP/并发义务/[SELF]）
- 外部契约：`external-*.md` ×33（与 manifest.external 一一对应，write-once 最小假设）
- 图与边：manifest.json、callgraph.json（59 边）、scc_groups.json、entries.json、edges/*.json（33 edge-delta，edge_join+edge_audit PASS）
- 问题清单：open-questions.md（风险 R1-R8、unknown U1-U3、伪影 A1-A6、半边裁决）
- 对账：self-check.md
