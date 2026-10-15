---
function: query
source: {file: "client.ts", line: 34}
self_consistency: aligned
---

## 综述

`query(query: SettingsQuery)` 是工厂返回对象上的公共入口箭头方法（client.ts:34）：把查询参数装进 `{ op: "query", query }` 后整条委托给内部 `invoke`（client.ts:15-32），由后者完成"emit 请求 → 服务同步 accept → await 响应 → 全部失败折叠为结构化 SettingsResult"的握手。本方法自身无逻辑、无状态。

## 调用者驱动契约

callgraph.json 无指向本函数的入边 → 纯入口面（entries.json:7）：

1. **外部消费者（README.md:40-44、58-62）**：`settings.query({ globalPath, localPath, defaults, scope })`。前提：参数为 SettingsQuery 形状（defaults 必为对象；scope ∈ {"global","project","session"} 缺省 session；路径为相对路径或 null/缺省）。期望：得到 `Promise<SettingsResult>`；成功时 `result.values` 只含 defaults 声明的键、值为按 scope 优先级（defaults < global 文件 < project 文件 < session 日志，README:67-70）合并后的有效值（settings-service.ts:40-41 实现该合并）；失败时 `result.error.code ∈ {SERVICE_UNAVAILABLE, INVALID_REQUEST, SESSION_UNAVAILABLE, OPERATION_FAILED}`；不得把不可用当默认值（README:46-50）。
2. **测试**（test/settings-query.test.ts）：范围外，仅意图旁证。

注：垃圾入参（如 query=null、scope="nope"）不产生 UB——服务端 `parseSettingsOperation`（settings-service.ts:88 → settings-operation.ts:19-27）拒绝后经 handler 的 catch 以 `INVALID_REQUEST` 结构化 accept（settings-service.ts:91-94）；client 侧原样透传。

## 契约

### Pre（调用前须成立）
- 无避免 UB 的硬前提：本方法对实参不做任何属性访问（client.ts:34 直接把引用装进对象字面量），任意实参（含 null/undefined）都不在本函数内引发异常；形状校验由服务端以结构化 INVALID_REQUEST 兜住。

### Post
- 返回 `Promise<SettingsResult>`，**永不 reject**（invoke 全捕获）。
- resolve 值为服务端 accept 的结果逐字透传：成功 `{ok:true, values}`（仅 defaults 键、scope 合并语义）；失败为五类错误码之一的结构化对象（SERVICE_UNAVAILABLE = emit 期间无服务同步 accept；INVALID_REQUEST = 参数/身份不合规；SESSION_UNAVAILABLE = 查询期间会话失效（settings-service.ts:38）；OPERATION_FAILED = 文件读取/JSON/日志错误或 emit 抛错）。
- 无副作用：本方法不改 bus、不写文件；查询的文件读取与会话日志读取全部在服务端完成。
- 异常安全档：nothrow（结果以结构化错误表达）。

### 对 callee 的期望（下传 demand）
#### invoke（client.ts:15，1a 批次 fn 文档）
- 调它时已保证：operation = `{op:"query", query:<原引用>}`；不提前读取 query 的任何属性。
- 需要它保证：返回 Promise<SettingsResult> 且永不 reject；把本方法的 query 原样放入请求；其所有失败模式折叠为结构化结果。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**：无任何向外 throw / reject 路径。逐项核对：箭头体仅有一个对象字面量构造与一次 invoke 调用（client.ts:34），无属性访问、无显式 throw；invoke 的 Promise 永不 reject。宿主灾难性 OOM/进程终止除外（extern-model 约定）。

**异常在服务/插件边界的包含效果**：服务端执行期异常（文件 I/O、JSON、日志）由 settings-service.ts:89 的 `.catch` 折叠为 OPERATION_FAILED 后 accept，经本方法返回结构化结果；本方法不新增逃逸点。

## 并发

无。本方法无共享状态；同一 client 上并发多个 query 各自独立握手（invoke 局部 response）。查询期间会话切换由服务端在读取后复查所有权（settings-service.ts:38）并以 SESSION_UNAVAILABLE 报告，client 侧无义务。

## SP

【L34】`invoke({ op: "query", query })`：对象字面量构造无异常路径；随后控制流进入 invoke（其 SP 见 1a 批次 fn 文档；此处只依赖其 Post：resolve SettingsResult、不 reject）。
【Post】即 invoke 的 Post（透传）。

## 自洽

- caller（README §Client/§Queries）期望的"结构化结果、不抛、values 仅含 defaults 键"与本方法 + invoke + 服务端（settings-service.ts:24-42）行为对齐。
- 与 invoke 的保证（1a 批次：全捕获、结构化结果）一致，无矛盾、无未消解假设 → aligned。
