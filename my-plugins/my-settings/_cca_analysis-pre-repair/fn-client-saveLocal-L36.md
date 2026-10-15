---
function: saveLocal
source: {file: "client.ts", line: 36}
self_consistency: aligned
---

## 综述

`saveLocal(save: SettingsSave)` 是工厂返回对象上的公共入口箭头方法（client.ts:36）：把保存参数装进 `{ op: "save-local", save }` 后整条委托给内部 `invoke`。服务端语义（settings-service.ts:44-64）：把补丁写入项目文件 `<session.cwd>/.pi/<localPath|my-settings.json>`（读-改-写 + 原子 rename，互斥队列下），随后追加会话日志；非事务，日志失败报 `PARTIAL_SAVE`。

## 调用者驱动契约

callgraph.json 无指向本函数的入边 → 纯入口面（entries.json:9）：

1. **外部消费者（README.md:78、83）**：`settings.saveLocal({ localPath?, values })`。前提：values 为 Settings；localPath 为相对路径或 null/缺省（默认 `my-settings.json`，挂在 `<cwd>/.pi` 下）。期望：`Promise<SettingsResult>`；成功 `{ok:true, values}` = 被接受的补丁（README:90）；错误码语义同 saveGlobal（含 PARTIAL_SAVE）。项目保存不改动全局文件。
2. **测试**：范围外，仅意图旁证。

垃圾入参不产生 UB：服务端 copySettings 先拒绝为 INVALID_REQUEST（settings-operation.ts:31）。

## 契约

### Pre（调用前须成立）
- 无避免 UB 的硬前提：本方法对 save 不做属性访问；任意实参在本函数内无异常路径；形状校验由服务端结构化拒绝。

### Post
- 返回 `Promise<SettingsResult>`，**永不 reject**（invoke 全捕获）。
- resolve 值为服务端 accept 结果逐字透传：成功 = 补丁已写入项目文件（existing 键保留、顶层键整值覆盖）且已追加会话日志；文件已写但日志失败 = `PARTIAL_SAVE`（文件不回滚）；无服务 = SERVICE_UNAVAILABLE；会话在途失效 = SESSION_UNAVAILABLE / PARTIAL_SAVE；其余 = INVALID_REQUEST / OPERATION_FAILED。
- 无本方法侧副作用：文件与会话日志写入全在服务端。
- 异常安全档：nothrow。

### 对 callee 的期望（下传 demand）
#### invoke（client.ts:15，1a 批次 fn 文档）
- 调它时已保证：operation = `{op:"save-local", save:<原引用>}`。
- 需要它保证：返回 Promise<SettingsResult> 且永不 reject；save 原样入请求；失败全折叠为结构化结果。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**：无任何向外 throw / reject 路径（client.ts:36 仅字面量 + invoke；invoke 永不 reject）。宿主灾难性 OOM/进程终止除外。

**异常在服务/插件边界的包含效果**：服务端异常经 settings-service.ts:89 `.catch` 折叠为结构化结果后 accept；本方法不新增逃逸点。

## 并发

无本方法侧义务。同 saveGlobal：文件互斥由服务端 + 宿主队列（进程内 lane）保证；与 saveGlobal 写不同路径（全局 vs 项目）时并行执行；并发 saveGlobal/saveLocal 写**不同文件**但都会追加同一会话日志——日志条目顺序由服务端 appendEntry 调用顺序决定，client 侧无义务；会话切换由服务端复查并以结构化错误报告。

## SP

【L36】`invoke({ op: "save-local", save })`：字面量构造无异常路径；依赖 invoke 的 Post。
【Post】透传 invoke 的 Post。

## 自洽

- caller 期望（README:78、83）与透传行为、服务端实现对齐；与 invoke 保证一致 → aligned。
