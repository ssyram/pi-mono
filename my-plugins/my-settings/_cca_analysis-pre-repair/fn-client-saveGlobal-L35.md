---
function: saveGlobal
source: {file: "client.ts", line: 35}
self_consistency: aligned
---

## 综述

`saveGlobal(save: SettingsSave)` 是工厂返回对象上的公共入口箭头方法（client.ts:35）：把保存参数装进 `{ op: "save-global", save }` 后整条委托给内部 `invoke`。语义上（服务端 settings-service.ts:44-64）该操作把补丁写入全局文件（读-改-写 + 原子 rename，在 Pi 文件互斥队列下），随后把同一补丁追加到当前会话日志；两步不是事务，日志失败时报 `PARTIAL_SAVE`。

## 调用者驱动契约

callgraph.json 无指向本函数的入边 → 纯入口面（entries.json:8）：

1. **外部消费者（README.md:77、82、86、90）**：`settings.saveGlobal({ globalPath?, values })`。前提：values 为 Settings（键值均为 JSON 值；键须与其他消费者错开，README:26）。期望：`Promise<SettingsResult>`；成功 `{ok:true, values}` 中 values 是**被接受的补丁本身**（非全部生效配置，README:90）；失败错误码可含 SERVICE_UNAVAILABLE / INVALID_REQUEST / SESSION_UNAVAILABLE / OPERATION_FAILED / PARTIAL_SAVE（PARTIAL_SAVE 消息中标识已写文件，settings-service.ts:60-61）。全局保存不改动项目文件（README:86）。
2. **测试**（test/*.test.ts）：范围外，仅意图旁证。

垃圾入参（values 非对象、含循环等）不产生 UB：服务端 parseSettingsOperation 的 copySettings 先拒绝为 INVALID_REQUEST（settings-operation.ts:31），不会到达文件写入。

## 契约

### Pre（调用前须成立）
- 无避免 UB 的硬前提：本方法对 save 不做属性访问（client.ts:35 直接装进字面量）；任意实参在本函数内无异常路径；形状校验由服务端结构化拒绝。

### Post
- 返回 `Promise<SettingsResult>`，**永不 reject**（invoke 全捕获）。
- resolve 值为服务端 accept 结果逐字透传：成功 = 补丁已写入全局文件（existing 键保留、values 顶层键整值覆盖，无深层合并——README:24、85）且已追加会话日志；文件已写但日志失败 = `PARTIAL_SAVE`（文件不回滚，README:87）；会话在途失效 = SESSION_UNAVAILABLE 或 PARTIAL_SAVE；无服务 = SERVICE_UNAVAILABLE；其余失败 = INVALID_REQUEST / OPERATION_FAILED。
- 无副作用义务在本方法侧：文件与会话日志写入全部发生在服务端；本方法不改 bus、不触碰文件系统。
- 异常安全档：nothrow。

### 对 callee 的期望（下传 demand）
#### invoke（client.ts:15，1a 批次 fn 文档）
- 调它时已保证：operation = `{op:"save-global", save:<原引用>}`。
- 需要它保证：返回 Promise<SettingsResult> 且永不 reject；save 原样入请求；失败全折叠为结构化结果。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**：无任何向外 throw / reject 路径。箭头体（client.ts:35）仅对象字面量 + invoke 调用；invoke 的 Promise 永不 reject。宿主灾难性 OOM/进程终止除外。

**异常在服务/插件边界的包含效果**：服务端写文件/写日志的异常经 execute 的 `.catch`（settings-service.ts:89）折叠为结构化结果后 accept；本方法不新增逃逸点。

## 并发

无本方法侧义务。文件互斥（同路径读-改-写串行化）由服务端经宿主 withFileMutationQueue 保证；并发多个 save 的提交顺序由队列 lane 决定（进程内）；在途会话切换由服务端 isCurrent 复查（写前、rename 前、写日志前三处）并以 SESSION_UNAVAILABLE/PARTIAL_SAVE 显式报告。client 侧无锁、无顺序要求。

## SP

【L35】`invoke({ op: "save-global", save })`：字面量构造无异常路径；依赖 invoke 的 Post（resolve SettingsResult、不 reject）。
【Post】透传 invoke 的 Post。

## 自洽

- caller 期望（README:77-90 的 save 语义 + "returns error results instead of throwing"）与本方法透传行为、服务端 settings-service.ts:43-64 实现对齐。
- 与 invoke 保证一致 → aligned。
