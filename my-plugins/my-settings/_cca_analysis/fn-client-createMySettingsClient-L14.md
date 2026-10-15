---
fn: "client.ts:L14::createMySettingsClient"
source: "client.ts"
line: 14
run: "post-rewrite no-throw verification"
date: "2026-10-15"
---

# fn-client-createMySettingsClient-L14.md

## 综述

消费者工厂（extern-model.md Public entry surfaces；entries.json 入口 `index.ts named export; consumer factory`）。`createMySettingsClient(bus: SettingsEventBus, owner: SettingsReady)`：构造期一次性读取 owner 的 session 身份并校验（client.ts:18-26），失败转为常驻 `initialFailure`（INVALID_REQUEST）；随后返回含 6 个入口箭头的对象（client.ts:65-72）。构造期之后不再触碰 owner/bus，直到 invoke 才使用。

## 契约（调用者驱动）

- PRE：无 no-throw 前提——bus/owner 均可为任意值（含 undefined/null）：owner 属性访问包在 try 内（client.ts:18-26）。bus 直到 invoke 的 emit（client.ts:49）才被触碰，缺失时的失败由 invoke 转结构化。
- POST：恒同步返回 `{query, saveGlobalOnly, saveLocalOnly, saveGlobalAndSession, saveLocalAndSession, saveSession}` 六方法对象（client.ts:65-72），不向外抛。
- POST（身份非法或 owner 读取抛出时）：`initialFailure` 常驻（client.ts:17,22,25），此后六个方法无视实参恒返回 INVALID_REQUEST（经 client.ts:31）——初始 session 身份校验语义（arch/prototype.md §6「请求绑定当前 session 身份」）✔。

## 自身异常合同（逐路径）

- client.ts:19-20 `owner.session`/`owner.sessionId`：owner 为 null/undefined ⇒ TypeError ⇒ client.ts:24 捕获；owner 为对象但属性是 throwing getter ⇒ 同样捕获。getter 副作用属于外部边界（【unknown】getter 语义由调用方定义，本分析只保证捕获）。
- client.ts:21 校验：纯存在性/类型比较，不抛。
- client.ts:22/25 `settingsFailure`：安全（settings-error.ts:3-10 全程 try/catch；【premise】settings-error.ts:L3 专属报告由其所属批次出具）。
- client.ts:65-72 返回对象字面量 + 六个闭包创建：不抛（闭包体安全见各自 fn 报告）。
- ⇒ 无向外 throw/reject 路径；全文件无 throw/reject 语句（grep 证实）。
- 宿主灾难性 OOM/进程终止不属于 JS 异常合同（open-questions.md）。

## 霍尔逻辑 SP

{P: bus、owner ∈ 任意值}
body: try 读取 session/sessionId（client.ts:19-20）；session 非对象或 sessionId 非非空字符串 ⇒ initialFailure := INVALID_REQUEST（client.ts:21-22）；读取抛出 ⇒ initialFailure := INVALID_REQUEST(error)（client.ts:24-25）；return 六方法对象（client.ts:65-72）
{Q: 正常返回且返回对象含六个方法；对返回的 client 任意方法 m、任意 args：m(args) 满足各方法 SP（恒 fulfilled 的 SettingsResult promise，身份失败时为 INVALID_REQUEST）；无异常逃出工厂}

## 并发/异步义务

- `session`/`sessionId`/`initialFailure` 仅在工厂体同步执行期写定，此后只读（读点 client.ts:31/33/34）⇒ 返回的 client 无共享可变状态，并发调用安全。
- `session` 是引用捕获而非快照（client.ts:19）：若宿主此后替换/变更 `owner.session` 的内容，request 携带的是工厂时刻的引用；服务端以该引用做 resolveSession 判定（settings-service.ts:34）。【unknown】宿主替换 session 引用（新会话换新对象）的行为属于 extension/lifecycle 批次的闭合范围；客户端语义上仅承诺"request 绑定工厂时刻的身份引用"。
- bus 同步派发是 invoke 判定 SERVICE_UNAVAILABLE 的生态前提（fn-client-invoke-L27.md），工厂不重复校验 bus 形状。
