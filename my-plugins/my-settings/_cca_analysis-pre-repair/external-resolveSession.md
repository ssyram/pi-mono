# external: resolveSession (registerMySettingsService 的会话认领回调参数)

- 来源引用点：settings-service.ts:86（`resolveSession(data.session, data.sessionId)`）；实参由 extension.ts:9-17 的闭包提供（manifest id `extension.ts:L9::registerMySettingsService`，edges/settings-service-on.json direct edge 已记录派发事实）。
- kind：包内构造、经参数注入的回调；对 svc:73::on 而言按 external 前提建模。

## Pre
- 实参 `(data.session, data.sessionId)` 已过 svc:78/82 校验：session 为非 null 非 Array 对象、sessionId 为非空 string。
- 闭包捕获的 `active`（extension.ts:7）可为任意状态（undefined/过期 owner）——闭包自身以身份比较处理。

## Post
- 认领：返回 SettingsSession 形态对象 `{cwd, isCurrent, getBranch, appendEntry}`（extension.ts:12-17 构造），其中 cwd 为会话 cwd 串、isCurrent/getBranch/appendEntry 为闭包端口。
- 不认领：返回 undefined（extension.ts:11 身份不匹配）→ 调用点 svc:87 静默不-accept。

## 可否 throw-reject
- 可见源码（extension.ts:9-17）只做属性读取与比较，常规不抛；owner 标准下按外部回调建模"可能同步 throw"——调用点 svc:91 catch 已包含，不依赖其不抛。
- 宿主灾难性 OOM/进程终止除外（extern-model 约定）。
