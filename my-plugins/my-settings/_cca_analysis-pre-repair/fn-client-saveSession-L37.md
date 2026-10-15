---
function: saveSession
source: {file: "client.ts", line: 37}
self_consistency: aligned
---

## 综述

`saveSession(save: SettingsSave)` 是工厂返回对象上的公共入口箭头方法（client.ts:37）：把保存参数装进 `{ op: "save-session", save }` 后整条委托给内部 `invoke`。服务端语义（settings-service.ts:44-46、56-64）：scope = "session"，**跳过文件写入**（L46 `scope !== "session"` 为假），仅把补丁作为 `my-settings-v1` 条目追加到当前会话日志；成功即 `{ok:true, values}`。

## 调用者驱动契约

callgraph.json 无指向本函数的入边 → 纯入口面（entries.json:10）：

1. **外部消费者（README.md:79、84）**：`settings.saveSession({ values })`（globalPath/localPath 被忽略——服务端 scope 为 session 时不计算任何文件路径）。前提：values 为 Settings。期望：`Promise<SettingsResult>`；成功 = 补丁已入会话日志（后续 query 以 session scope 合并时生效，README:70）；失败错误码：SERVICE_UNAVAILABLE / INVALID_REQUEST / SESSION_UNAVAILABLE / OPERATION_FAILED（本操作无文件步骤，**不会出现 PARTIAL_SAVE**——settings-service.ts:60 的 savedPath 恒 undefined）。
2. **测试**：范围外，仅意图旁证。

垃圾入参不产生 UB：服务端 copySettings 先拒绝为 INVALID_REQUEST（settings-operation.ts:31）。

## 契约

### Pre（调用前须成立）
- 无避免 UB 的硬前提：本方法对 save 不做属性访问；任意实参在本函数内无异常路径；形状校验由服务端结构化拒绝。

### Post
- 返回 `Promise<SettingsResult>`，**永不 reject**（invoke 全捕获）。
- resolve 值为服务端 accept 结果逐字透传：成功 = 仅会话日志被追加（无任何文件改动，README:84）；无服务 = SERVICE_UNAVAILABLE；会话在途失效 = SESSION_UNAVAILABLE（写日志前的 isCurrent 复查，settings-service.ts:57）；其余 = INVALID_REQUEST / OPERATION_FAILED。
- 无本方法侧副作用：日志写入全在服务端（宿主 pi.appendEntry 持久化，可失败并被服务端折叠为错误结果）。
- 异常安全档：nothrow。

### 对 callee 的期望（下传 demand）
#### invoke（client.ts:15，1a 批次 fn 文档）
- 调它时已保证：operation = `{op:"save-session", save:<原引用>}`。
- 需要它保证：返回 Promise<SettingsResult> 且永不 reject；save 原样入请求；失败全折叠为结构化结果。

## 异常合同（owner 最严格标准）

**函数自身的异常合同**：无任何向外 throw / reject 路径（client.ts:37 仅字面量 + invoke；invoke 永不 reject）。宿主灾难性 OOM/进程终止除外。

**异常在服务/插件边界的包含效果**：服务端日志写入失败经 settings-service.ts:89 `.catch`（以及 L59-63 的局部 catch）折叠为结构化结果后 accept；本方法不新增逃逸点。

## 并发

无本方法侧义务。无文件 lane 参与（不写文件）；会话日志追加的会话所有权由服务端写前 isCurrent 复查保证（settings-service.ts:57）；并发多个 saveSession 的日志条目顺序由服务端调用顺序决定，client 侧无义务。

## SP

【L37】`invoke({ op: "save-session", save })`：字面量构造无异常路径；依赖 invoke 的 Post。
【Post】透传 invoke 的 Post。

## 自洽

- caller 期望（README:79、84、90）与透传行为、服务端实现对齐；与 invoke 保证一致 → aligned。
