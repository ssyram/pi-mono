# D.backend：后台、管理会话与客户端凭据细化

状态：待批准的完整设计；承接 architecture.md 的 D.backend 和 P.global。E3/E4 的 wire、CLI 和外部源码修改只在 ../extern-dep-design.md 定义；本文件不把拟新增外部功能当作现成功能。

## 1. 文件与状态

| 源文件（拟） | 单一职责 |
|---|---|
| backend-bootstrap.ts | 私有bootstrap身份的读取与独占发布 |
| backend-init.ts | E3.init子进程RPC、deadline、manifest验证 |
| backend-owner.ts | 本次加载的共享后台生命周期、启动合并、实例绑定 |
| control-client.ts | 控制状态/账号管理 HTTP 边界及归一化 |
| newapi-session.ts | 私有 new-api 管理登录和受限 JSON 请求 |
| relay-policy.ts | 私有订阅路由的本地计费与管理域检查 |
| client-token.ts | 稳定 client token 的状态、创建和取回 |
| provider-login.ts | 标准 auth.login 与上述组件的组合，见 detailed-design.md |

每个文件 ≤200 有效代码行；协议 envelope 在 client 内解析，业务 data 由使用它的概念模块验证，不用 `request<T>() as T` 代替 wire 验证。

### 1.1 私有持久状态

```ts
export interface BootstrapState {
  version: 1;
  instanceId: string;
  adminUsername: string;
  adminPassword: string;
}

export type TokenJournal =
  | { kind: "creating"; name: string; startedAtMs: number }
  | { kind: "ready"; name: string; tokenId: number }
  | { kind: "uncertain"; name: string; startedAtMs: number };
```

无文件表示未开始。creating 在进程恢复时按 uncertain 处理。journal 不保存上游 KEY 或 gateway key。bootstrap 管理密码随机生成一次，用户名 qt-owner（满足 E4 长度限制）；只有本插件新建的私有 backend 可使用它。

写文件权限 0600、目录 0700。初始化状态使用写完/fsync 的独占临时文件再原子 link 到最终名，EEXIST 时读取赢家；不先占最终空文件让别人读到半个 JSON。只清理本调用创建的临时文件，不扫目录删除他人文件。更新 journal 使用私有临时文件/fsync/rename。

这些保证原子可见性及已请求的 fsync，不承诺任意文件系统/掉电环境的数据永不丢失；状态丢失而 backend 已存在时 fail closed，不生成新身份接管。

### 1.2 内存 owner

```ts
export type DaemonState =
  | { kind: "idle" }
  | { kind: "starting"; task: Promise<BackendResult<BackendInfo>> }
  | { kind: "ready"; info: BackendInfo; checkedAtMs: number };
```

由 extension factory 拥有，不是 module singleton。多个本次实例共享；跨 Pi 的 daemon 单实例依赖 E3 OS 锁，不靠此 Promise。

### 1.3 共享接口（各自源模块导出）

```ts
export type JsonValue = null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };
export type InitOutcome = { kind: "created" } | { kind: "existing" };
export interface KeyInput { name: string; apiKey: string; scope: PlanScope }
export interface ImportedKey {
  kind: "added" | "existing";
  name: string;
  channelId: number;
}
export interface NewApiSession {
  authenticate(signal: AbortSignal): Promise<BackendResult<void>>;
  read(path: string, signal: AbortSignal): Promise<BackendResult<unknown>>;
  write(path: string, body: JsonValue, signal: AbortSignal): Promise<BackendResult<unknown>>;
}
export interface BackendOwner {
  readonly relayBaseUrl: string;
  bindInstance(provider: Provider): void;
  owns(provider: Provider | undefined, selection: Selection): boolean;
  ensureRunning(signal: AbortSignal): Promise<BackendResult<BackendInfo>>;
  managementSession(signal: AbortSignal): Promise<BackendResult<NewApiSession>>;
  readOwnedSnapshot(signal: AbortSignal): Promise<BackendResult<PoolSnapshot>>;
  invalidateReady(): void;
}
```

JsonValue是JSON基本值/数组/对象的递归类型，不是any；Selection来自E2公开契约。管理cookie不通过接口返回。createBackendOwner还接收本次官方metadata ID列表，以便首次ready前完成该版本relay-policy。

## 2. backend-bootstrap.ts

### `loadBootstrapState(config): Promise<BackendResult<BootstrapState>>`

输入为已验证本插件路径。读不到返回 uninitialized；坏版本/字段/权限错误返回 storage/configuration，不自动修复或覆盖。只读取私有 state，不解析活跃 TOML。

后置：返回已验证身份与本插件生成的管理凭据；不返回 raw JSON。论证：失败不会产生一个新的“看起来属于我们”的身份。

### `createBootstrapState(config): Promise<BackendResult<BootstrapState>>`

前置：首次显式登录，且没有既有 bootstrap；若 backend config 已存在但缺 bootstrap，返回 identity-conflict。

步骤：生成 UUID、32 字节随机 base64url 管理密码 → 写私有 temp → sync → link 最终路径。赢者成功；EEXIST 读既有完整 state；其它失败清理本 temp 并报 storage。

不修改已有 state；多个首次调用只能采用同一个成功发布的身份。并发账号/配置 mutation 仍按 H.5 串行，不把这项文件发布性质扩成整个 onboarding 事务。

### backend-init.ts：`initializeBackend(state, seed, config, signal): Promise<BackendResult<InitOutcome>>`

调用 E3.init：可执行文件绝对路径、argv 只有 command/config 路径，秘密与团队上下文走 stdin JSON。只执行本插件配置的受信任 binary，不通过 shell。

处理：
- binary 不存在/不支持协议 → configuration/unsupported-backend。
- stdout 限制 64KiB，只接受一个完整 v1 JSON；stderr 不进入 UI，日志仅保留受控操作状态。
- created：首 key 已探活并原子写入 E3 配置。
- existing：只证明身份相同且已有配置，没有替新输入 KEY 做在线导入。
- owner、URL 或协议不符 → identity-conflict，不继续 root 管理认证。
- timeout/取消：终止本次有限 init 子进程，必要时只对持有的子进程对象升级信号；E3 配置可能已写入，不能声称回滚。后续由幂等 init 对账。

20s deadline；所有退出清理监听器/stdio。论证：本插件不复制 TOML parser，不覆盖服务权威状态；只有 manifest 与预期同一身份才进入后续运行阶段。

## 3. backend-owner.ts

### `createBackendOwner(config, metadataIds): BackendOwner`

仅创建本次加载拥有的状态、clients 和实例 WeakSet；不启动进程。`bindInstance(provider)` 在 create 中记录原始 Provider 对象；E2 请求传当前 getRegisteredNativeProvider 结果，owns 还同时匹配 provider.id/API/endpoint。WeakSet 不保留登录用的临时 Provider，旧来源不能仅凭字符串前缀认领新实例。

### `ensureRunning(callerSignal): Promise<BackendResult<BackendInfo>>`

1. caller 已取消立即返回 cancelled。
2. ready 且健康检查不足 5s 可复用；过期进入新检查。
3. starting 时只加入其等待，不启动第二个本进程任务。
4. idle/过期时创建 owner 自己 180s deadline 和 task，当前 caller 的取消只取消其等待。
5. 读私有 bootstrap；缺失返回 uninitialized，模型调用不能用 gateway key反推出上游 seed。
6. GET E3.status：身份/URL不符立即错误；ready/dry_run=false/new_api_healthy=true之后，再做不带秘密的new-api公开健康检查，不能只信最多一个quota tick前的旧健康位。
7. control不可达时用argv `["up",configPath]` 启动daemon；detached、私有日志、unref，不把KEY放argv/env。E3锁冲突返回already-running时转只读等待。
8. control仍活而proxy不健康时，只提交一次E3 POST /api/backend/ensure，由持锁controller恢复自身proxy；不重起第二个controller。controller仍在starting但proxy健康时只等待初始化快照。
9. 每250ms探测，单次3s；仅在匹配实例ready且relay健康时成功。ensure回执未知继续只读status直到deadline；180s结束报startup-timeout，不杀共享daemon。
10. 首次就绪还须建立管理会话、执行relay-policy；准备失败不写ready。内部task直接调用session.authenticate/relay-policy，不调用会等待自身的managementSession。该preparation由owner合并并在同一受管实例内复用，不随每次健康失效重写设置；metadata ID版本在本次加载固定。
11. 任务收敛后写ready或idle；不得留下已完成的starting Promise。

论证：内存 task 合并本进程并发，E3 lifetime lock 合并跨 Pi 并发；二者义务不同。身份检查先于任何管理 cookie/client key，错误端口不会收到秘密。循环由绝对 deadline 终止。

### `managementSession(signal): Promise<BackendResult<NewApiSession>>`

内部调用ensureRunning，确认preparation已完成后返回同一owner的管理客户端，不返回cookie值；失败/取消透传。首次preparation合并在共享task，不把它变成多个实例的重复配置动作。

### `invalidateReady(): void`

仅将 ready 失效；不停止进程，不撤销管理账号/客户端，不把正在启动的共享 task 取消。模型流明确失败时可调用，下一次独立操作再检查。

### `readOwnedSnapshot(signal): Promise<BackendResult<PoolSnapshot>>`

只读已有bootstrap + GET status，验证identity/endpoint/version/采样时间；不调用ensureRunning，不启动daemon。用于E2。无私有状态、starting、离线或旧版本分别明确返回。

## 4. control-client.ts

### `getSnapshot(expected, signal): Promise<BackendResult<PoolSnapshot>>`

HTTP redirect=error、3s；验证 E3.service 元数据和既有快照字段。updated_at 与 reset 为 ms，不能把 RequestLog 的秒格式混进来。

- HTTP/解析/字段不合法 → http/invalid-response。
- wrong owner/relay URL → identity-conflict。
- starting snapshot可有空keys/0采样时间；用于启动等待，不作为usage成功。ready要求完整channel映射。
- quota snapshot age超阈值→timeout/stale受控失败，不拿旧值当新值。
- managed keys严格映射，不从channels补wild keys；已有enabled/status_raw与group决定路由状态。
- 另记录属于路由组却未受管理的 enabled channel id，交 relay-policy 检查；不隐藏成可用池。

论证：所有不可信 JSON 在这一边界变成内部数据；失效 snapshot 不产生数字成功结果。

### `addKey(state, keyInput, signal): Promise<BackendResult<ImportedKey>>`

只有 handshake 已匹配时发送 E3 POST /api/keys，75s。稳定标签为 `acct-` + SHA256(KEY 与标准化团队上下文 tuple) 的短十六进制；不暴露原 KEY 前缀。E3 仍比较完整 fingerprint，名字碰撞不能覆盖不同 key。

added/existing 都返回真正的 canonical key name/channelId。quota-probe/conflict/busy 为受控失败；timeout/连接中断先以同一 fingerprint 对账，不自动重复未经确认的写入。不能仅凭名字相同就认定同一个账号。

## 5. newapi-session.ts

### 状态与 `authenticate(signal): Promise<BackendResult<void>>`

管理会话仅本 owner 持有，不能进入 model options、E2 或 profile credential。

等待已匹配 E3 ready 后，用 BootstrapState 的管理用户名/密码调用 E4 `/api/user/login`，保存该 origin 返回的 cookie 与 data.id。未登录、2FA、root 身份/用户名不匹配、成功 envelope 为空均报 management-auth。

只使用同一数字回环 origin；不跟随 redirect。Set-Cookie 只提取同一已确认 origin 的 name=value，管理请求带 Cookie 和 New-Api-User。无须暴露或轮换 User.AccessToken。

### `read(path, signal): Promise<BackendResult<unknown>>`

单次10s，校验 HTTP 与 success envelope，data 保持 unknown，由调用者验证业务字段。明确401可重新管理登录后重读一次；其它业务失败不靠本地化 message 猜成功。

### `write(path, body, signal): Promise<BackendResult<unknown>>`

同样验证 envelope。已确认来自固定 E4 auth middleware 的401在进入 handler 前拒绝，可重登后重发一次；其它网络失败/timeout/5xx 返回 ambiguous-write，不自动重放。不能以“JSON没收到”推断没有执行。

循环最多初始请求+一次已知 auth 拒绝重试；caller/单操作 deadline 都有效。所有退出清掉本次资源，错误不包含 password/cookie/body。

## 6. relay-policy.ts

### `ensureOwnedRelayPolicy(snapshot, metadataIds, session, signal): Promise<BackendResult<void>>`

前置：匹配本插件 identity，私有 new-api、默认路由组、无不相关用户/渠道；metadataIds 是本插件会暴露的官方 GLM ID。

1. 检查 managed channel IDs 与属于 default 的 enabled channels；发现 wild 可路由渠道时配置错误，不擅自禁用或删除。
2. GET root options，解析 GroupRatio/ModelRatio JSON map；坏 map 不覆盖。
3. 只在私有实例把 default 的 GroupRatio 设置为 0，保留其它 map 项。
4. 对尚未定价的本插件 metadata ID 加 ModelRatio=0，保留已有项。未知 provider 模型不由本插件擅自定价。
5. 用 E4 PUT option 逐项提交并读回确认；这是本地 subscription bookkeeping，不修改 Pi model.cost 或真实套餐。
6. GET user/self：必须仍是本插件 root 且 quota>0。余额<=0报 relay-policy，不能称智谱池用完，也不自动购买/兑换/充值。

调用时机：新 management session/daemon 启动后的 onboarding 和首次联网准备；不是每 token/每事件执行。正常配置保持零最终计费，正 root 余额不因这些 GLM 文本请求递减。外部管理员改配置时此保证条件失效，重新准备时检查；不能宣称无限余额。

论证源：E4 的 GroupRatio 允许0，模型/工具费用乘分组倍率且0不触发最低扣费1；缺模型价格会阻止请求，因此需显式补本插件已知 ID。此 source-level 论证尚需 T.RelayPolicy 真实本机 fake-upstream 集成验证。

此函数不用于任意已有网关。参数/所有权不符时零写入，避免把管理员便利功能扩成接管授权。

## 7. client-token.ts

### 稳定名称与 journal

client name = `qt-` + SHA256(instanceId + 分隔符 + providerId) 的32位十六进制，长度35，满足 E4 名称限制。不含秘密；同安装同实例恢复相同 token，实例 ID 不用作池成员名。

### `ensureClientToken(profileId, session, signal): Promise<BackendResult<string>>`

前置：已验证 root、relay-policy 完成，mutation 满足 H.5 串行。60s 总 deadline。

1. 读 private journal；坏/未知版本报 storage，不删除重建。
2. ready：GET 指定 token；验证所属用户、名称、组、enabled、unlimited、不过期。明确404可转新建；disabled 不自动启用，返回 client-disabled。
3. 无 journal：先分页查唯一 name。恰好一条可采用；多条为 ambiguous-write；没有则可新建。
4. creating/uncertain：只对账。找到唯一条则恢复；没有仍保持 uncertain，要求操作者确认，不重发 POST。
5. 新建前持久化 creating；POST token/unlimited/永不过期/default组。success 也没有 id/key，再分页找到唯一 tokenId。
6. POST token/:id/key 取完整 key，验证非空；保存 ready journal（只记 tokenId/name），返回 key。
7. 创建回执未知：保存 uncertain；即使后续临时 list 没查到，也不能推断原请求不会晚提交。

所有分页有上限：每页按 E4 支持的 size，最多100页，超过返回配置/结果过多错误，不无限遍历。匹配名称是精确相等，不用 substring。

对账读取、取 key 的 POST 在 E4 中无 mutation；创建才是非幂等。不存在严格 exactly-once 承诺。失败发生在远端已创建而本地未记录时，状态和诊断明确；不自动撤销共享 token。

论证：stable name + 先记意图 + unknown不重发缩小重复风险；跨进程同时 mutation 不在本版保证里，不能把文件 rename 当数据库唯一约束。

## 8. 组合、未完成依赖与错误归属

provider-login 的组合合同：init created 则 seed已落地；init existing 才在线导入；无论哪路都确保 daemon/root policy/token，最后只把 gateway key 返回 SDK。失败可留下服务/账号/token，但不会假报 credential 已保存。

| 失败 | 本插件保证 | 外部/用户后续 |
|---|---|---|
| binary旧/缺init | 清晰 unsupported-backend，不猜私有格式 | E3 实现/安装 |
| 存在未知配置/端口 | 不接管、不发管理凭据 | 显式迁移或改配置 |
| caller取消启动等待 | 不停共享daemon | 启动可继续 |
| KEY/团队探活失败 | 不返回gateway credential | 修正输入/静态上下文 |
| token未知结果 | journal阻止重放 | 对账/人工确认 |
| root余额0/价格配置失败 | 独立relay-policy错误 | 私有服务管理，不混成5h/week |
| 标准凭据写成功、主snapshot刷新失败 | 由 E1 返回部分成功 | 公开SDK刷新/重新选择，不再导入KEY |

E3.init、OS锁和服务身份不是当前 HEAD 已有能力；E1/E2 公共插件接口也未实施。本文所有未来函数必须按测试设计验证后，才可说对用户可用。
