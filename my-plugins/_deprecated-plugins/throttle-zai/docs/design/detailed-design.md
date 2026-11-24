# 内部细化设计

状态：完整候选设计，待批准；所有函数为未来产品接口，不是已存在导出。本文承接 [架构](architecture.md) 的 D.source/D.catalog/D.request/D.usage；后台函数见 [backend.md](backend.md)。跨插件与后台 wire 契约只见 [外部设计](../extern-dep-design.md)。

## 1. 文件与调用图

```text
index.ts（只 re-export）
throttle-zai-extension.ts
  ├ plugin-config.ts
  ├ backend-owner.ts → backend-bootstrap/control-client/newapi-session
  ├ provider-source.ts → provider-login/model-catalog/native Provider
  └ usage-service.ts → control-client/pool-usage/usage-format

provider-login.ts → backend-bootstrap.ts/backend-init.ts/client-token.ts
backend-owner.ts → relay-policy.ts
所有后台失败 → backend-failure.ts → SDK 边界或 E2 QueryResult
```

每个生产源文件 ≤200 有效代码行；不建 utils/helpers/common 桶文件，不用 enum、参数属性或动态 import。export 类型放各自概念模块，不再建收纳全部类型的源文件。

## 2. 共同类型和规则

### 2.1 失败

`backend-failure.ts`：

```ts
export type FailureCode =
  | "configuration" | "unsupported-backend" | "uninitialized" | "not-ready"
  | "identity-conflict" | "startup-timeout" | "timeout" | "network" | "http"
  | "invalid-response" | "management-auth" | "quota-probe"
  | "relay-policy" | "ambiguous-write" | "client-disabled" | "storage";

export interface BackendFailure {
  kind: "error";
  code: FailureCode;
  httpStatus?: number;
  operation?: string;
}

export type BackendResult<T> =
  | { kind: "ok"; value: T }
  | BackendFailure
  | { kind: "cancelled" };
```

这不是给第三方错误添加任意 details。message 从固定映射生成，仅附非秘密 operation/HTTP status；不保存原始请求体、响应全文、stderr、cookie、key。

`toProviderError(failure): Error` 在 SDK 允许的拒绝边界使用；cancelled 生成 AbortError。内部 IO 在拥有外部边界的函数捕获，返回 BackendResult。getModels 不抛错；E2 handler 最终捕获并返回 QueryResult；公开 auth/refresh/stream setup 则由 SDK 处理失败，不能让事件 handler 未观察地 reject。

### 2.2 配置（plugin-config.ts）

```ts
export type PlanScope =
  | { kind: "personal" }
  | { kind: "team"; organization: string; project: string };

export type QuotaPolicy =
  | { kind: "equal" }
  | { kind: "weighted"; unit: string;
      keys: Readonly<Record<string, { fiveHour: number; weekly: number }>> };

export interface PluginConfig {
  version: 1;
  executable: string;
  controlUrl: string;
  relayBaseUrl: string;
  plan: PlanScope;
  quota: QuotaPolicy;
}
```

`loadPluginConfig(path: string): Promise<BackendResult<PluginConfig>>`：读取固定插件路径，验证JSON/version/URL/plan/quota；缺文件或非法值返回configuration，IO失败返回storage。只返回已验证值，不输出原JSON。入口将失败转成受控的extension加载错误，且在挂服务之前退出；不声称静默成功。

配置、state 和 backend 路径从公开 getAgentDir 推导：
- throttle-zai/config.json：上述静态配置；无管理员密码或上游 KEY。
- throttle-zai/state/bootstrap.json：私有 bootstrap 身份。
- throttle-zai/state/clients/<client-name>.json：token 操作 journal。
- throttle-zai/backend/config.toml、new-api 数据/日志：E3 拥有；本插件不直接编辑。

URL 只接受数字回环 HTTP 地址，control 为 origin，relay 为 origin + `/v1`，无 userinfo/query/hash；两服务不得配置同一监听地址。其它域名/远程中心不在本版范围。executable 必须绝对路径；是否存在在第一次执行时检查，不在同步 create 中启动探测。

weighted 的 unit 非空，各容量为正安全整数，每个窗口配置容量之和也须为安全整数；可用更细单位表达比例。equal 是操作者声明同容量/独立额度，不是代码从套餐名猜测。team 两 selector 均非空、trim 后无 CR/LF。缺配置/结构错误在来源发布前报告，不把任意值传入网络。

### 2.3 共享数据及 owner

control-client.ts 提供经过 wire 验证的内部数据，不直接暴露服务原文：

```ts
export interface BackendInfo {
  instanceId: string;
  controlUrl: string;
  relayBaseUrl: string;
}

export interface KeyWindow {
  usedPercent: number;
  resetAtMs?: number;
}

export interface KeyUsage {
  id: string;
  channelId: number;
  route: "enabled" | "disabled";
  tier: "active" | "standby" | "exhausted" | "unknown";
  fiveHour?: KeyWindow;
  weekly?: KeyWindow;
  query: "ok" | "failed";
}

export interface PoolSnapshot {
  info: BackendInfo;
  phase: "starting" | "ready";
  observedAtMs: number;
  pollIntervalMs: number;
  healthy: boolean;
  dryRun: boolean;
  unmanagedChannelIds: readonly number[];
  keys: readonly KeyUsage[];
}
```

成员只取受管理 keys，不把 wild channels 加入池。disabled 仍是池中真实额度，但 compact 标记不可调度数量；不把它解释为 0 容量或 100% 已用。这里 tier 归一化映射以 E3 为准。

一个 BackendOwner 由本次 extension factory 持有，用 WeakSet 记录本次 create 返回的原始 Provider 对象，同时匹配实例 ID、API 和固定 endpoint；同池后台连接和启动状态可共享。每个 Provider 的目录单独持有。E2 从公开 getRegisteredNativeProvider 传递当前原对象，避免 source 覆盖后旧 owner 仅凭字符串认领。无模块级可变表。

内部接口归属：BackendOwner/InitOutcome/ImportedKey/NewApiSession 在 backend.md 的 §1 定义；ModelCatalog 在本文件 §5 定义。跨插件的 ProviderProfileSpec 和 QueryResult 只引用 E1/E2。

## 3. 时间、取消和重试合同

| 操作 | 上限/行为 |
|---|---|
| 来源 QUERY/create/offline refresh | 同步或本地 cache publication，无网络；无等待服务 timer |
| init CLI | 20s；上游探活内部 10s，结束不等于撤销已经写的配置 |
| 共享 daemon startup | owner 独立 180s；250ms 状态探测间隔；单次 GET 3s |
| caller 等待启动 | 尊重 caller signal，取消不 abort owner 的共享启动，不杀 daemon |
| control snapshot | 3s；usage 的外层仍有 E2 15s |
| AddKey / backend ensure | 各75s；前者覆盖当前60s回执；超时对账，不声称未执行 |
| new-api 管理读/写 | 单次 10s；凭据登录 10s；只对明确认证拒绝和只读操作按 E4 重登一次 |
| token issuance | 60s 包含创建/查找/取 key；unknown 不重放创建 |
| 完整 login setup | KEY 输入完成后 360s 总 deadline，与 caller signal 合并 |
| 目录刷新 | 10s 模型请求；正常刷新复用 60s 新鲜度，force 绕过；错误保留旧目录 |
| 推理 | 继承 Pi 的信号及超时，不加另一层 token/请求重试 |

共用标准AbortSignal.any/timeout；未提供caller signal时由边界创建局部signal。保留原caller与局部timer引用：caller取消为cancelled，本函数deadline到期而原caller仍有效为timeout；组合函数在callee返回cancelled时也先检查自己的deadline，不能把所有AbortError都当用户取消。SDK边界最终尊重原始interaction/options signal。deadline在操作开始时创建，不用进程启动时刻预耗未来预算。

读 GET 可在后续独立调用重读；本插件不做无界自动重试。source/usage 请求失败不改走其它账号/官方上游。new-api 自己的渠道 fallback 与 Pi 自己的重试保持原契约，不再叠加本插件模型重放。

## 4. 入口与 source

### 4.1 `throttleZaiExtension(pi: ExtensionAPI): Promise<void>`

调用链：读取/验证配置 → 本地加载官方 metadata → 创建 owner → 创建 source → 安装 E2 handler → 最后调用 E1.provideProviderSource。

前置：SDK/公共依赖可加载。后置：要么失败且未发布 source，要么 source 可同步构造。副作用仅注册本次 owner 的 handler/服务，不启动 daemon、不读写真实凭据。

分支：配置或 metadata 失败在 publish 之前报告；无对应官方 metadata 源为 configuration。发布后直接返回，不再执行可失败的 await。loader 负责订阅失效清理。

论证：所有可能失败的准备都在最后发布前；E1 的两个加载顺序都能收到同步 factory，不存在等待未来插件的循环。此论证依赖 E1，不替 E1 实施。

### 4.2 `createProviderSource(config, metadata, owner): ProviderSourceService`

返回稳定 service 对象，其 create(profile) 只调用下节。profile 类型、频道名及 helper 来自 E1 公共模块，不导入 consumer 私有代码。创建新 service 不写全局注册表。

### 4.3 `createThrottleProvider(profile, metadata, owner): Provider`

前置：E1 结构校验，id 是最终实例身份；profile.apiKey 若有，是调用凭据/环境引用，不是上游 KEY。

步骤：用 E1 公共 wrapApiKeyAuth 建 auth → 构造本实例 catalog → 构造两个 lazy stream → owner 用 WeakSet 记录返回 Provider 对象 → 返回完整 Provider。

关键字段：

```ts
const provider: Provider = {
  id: profile.id,
  name: `GLM pool (${profile.id})`,
  baseUrl: owner.relayBaseUrl,
  auth: { apiKey: configuredAuth },
  getModels: () => catalog.models(),
  refreshModels: context => catalog.refresh(context),
  stream: (model, context, options) => forwardStream(model, context, owner, options),
  streamSimple: (model, context, options) => forwardSimpleStream(model, context, owner, options)
};
owner.bindInstance(provider);
return provider;
```

configuredAuth 的 login 绑定 `profile.id`，返回 provider-login 的标准 ApiKeyCredential；resolve 保留本实例 stored credential 优先，其次显式配置 apiKey，无 TYPE/其它账号/官方 env 回退。

后置：本地基线立即可读；每个实例 catalog 独立；除 owner 的实例绑定外无外部副作用。提供者不调用 pi.registerProvider，登记归 E1。

论证：最终 id 在构造闭包时决定，所以不会继承原 TYPE 的 id/目录状态；元数据只在必要处复制用于别名和 endpoint，不冻结/遍历内部值。

## 5. model-catalog.ts

### 5.1 数据与转换

```ts
export type CatalogState =
  | { kind: "baseline"; models: readonly Model[] }
  | { kind: "ready"; models: readonly Model[]; checkedAtMs: number };
```

`createMetadataIndex(): ReadonlyMap<string, Model>`：使用公开 `pi-ai/providers/all` 的 zai-coding-cn factory。未知源/空目录是配置错误；不导入受限制的单 provider 子路径。

`bindModel(metadata, profileId, relayUrl): Model`：复制官方模型，改 provider/baseUrl；compat 为 Z.ai 默认差异再叠加官方显式 compat。差异为 supportsStore=false、supportsDeveloperRole=false、supportsReasoningEffort=false、maxTokensField=max_tokens、thinkingFormat=zai。不改官方 contextWindow/maxTokens/cost/input/reasoning，不接受服务返回的 URL/headers/capacity 字段。

论证：这五类 provider/URL 自动识别差异有安装版源证；官方显式字段优先，避免未来显式模型能力被旧默认覆盖。

### 5.2 `createModelCatalog(profileId, auth, metadata, owner): ModelCatalog`

```ts
export interface ModelCatalog {
  models(): readonly Model[];
  refresh(context: RefreshModelsContext): Promise<void>;
}
```

初始化 CatalogState.baseline = 所有已知官方模型的绑定副本。`models()` 直接返回当前列表，不 IO、不抛错、不每次重新 map。

不使用 createProvider 的 baseline+overlay union 语义做完整筛选：那会保留网关已经移除的基线模型。本模块持有自己的标准 refreshModels 闭包，以完整成功列表替换。

### 5.3 `fetchModelIds(info, apiKey, signal): Promise<BackendResult<readonly string[]>>`

由本模块请求已核实 relayBaseUrl 的 GET /models，Bearer 只用本实例 gateway key，10s，禁止 redirect。验证成功 envelope/data数组/非空字符串id，trim后去重；合法空数组是有效目录，无效结构不是空目录。网络失败、非2xx或格式错误返回受控结果，不保存原响应。只接受ID，不读取服务端给出的URL、headers或上下文参数。

### 5.4 `refresh(context: RefreshModelsContext): Promise<void>`

1. 检查取消；allowNetwork=false 立即结束，保留本地基线/当前目录，不启动 backend，也不让旧 stored（尤其空目录）遮蔽初始基线。
2. 未 force 且已有成功目录不足 60s 时结束。
3. 使用 configuredAuth.resolve，传入公开 defaultProviderAuthContext()、本实例 api_key credential（先按 kind 收窄）和 signal。无凭据则不查询网关；不借 TYPE 凭据。
4. owner.ensureRunning 后调用 fetchModelIds；无效响应报错并保留旧列表。
5. 用 metadata 匹配 ID。未知 ID 不造参数，记录受控诊断；合法空列表或全部未知的成功响应生成空目录，不假保留全部模型。
6. context.publish({update})，由回调在宿主允许后更新 state/checkedAt；false 表示过期。省略 persist，不创建磁盘目录副本，不读取旧 stored 的能力或 URL。

退出：刷新取消按 SDK signal；网络/管理错误转为受控 ProviderError 由 Models.refresh 捕获。成功只改变当前实例内存目录，不写 models-store。

论证：更新经宿主针对 profileId 的 publish，旧 generation 不能覆盖新目录；失败路径没有修改旧 state，完整替换保证删除能力。重启重新从官方基线构造，缓存不构成启动条件。

## 6. 请求转发

`forwardStream(model, context, owner, options?)` 与 `forwardSimpleStream(...)` 各对接 native 对应入口，不使用 boolean 参数切换。

步骤：立即返回公开 lazyStream(model, async setup)；setup 等待 owner.ensureRunning(options.signal)，失败映射标准流错误；成功后调用官方国内 Provider 的对应 stream，传入当前 alias model、原 context 和完整 options。

后置：不重新解析 SSE；onPayload/onResponse/provider-stream-event、signal、env、headers、usage、工具及思考行为由原生实现承接，管理会话不进入 options。observer 只在明确错误时使 owner 的健康快照失效，不重放本次模型请求。

论证：setup 先完成身份检查，才把 gateway key 发给 relay；native 操作使用已绑定的 model.compat，不因 localhost 丢失格式。caller 取消不终止共享启动，后台继续在自己的 deadline 内收敛。

## 7. provider-login.ts

`loginGatewayClient(profileId, interaction, owner): Promise<ApiKeyCredential>` 是 SDK 边界，内部用 BackendResult，最终成功返回 credential，取消拒绝 AbortError，其它失败拒绝受控 ProviderError。

1. 通过 interaction.prompt(secret) 获取上游 KEY，trim 后为空直接失败；不读取其它 provider 的 key。
2. 创建 setup 总 deadline，与 interaction.signal 合并；读取本插件既有/bootstrap state。
3. 首次运行调用 E3.init，team 参数从配置提供，不从 KEY 猜。若 init 新建，seed 已探活/保存；若返回 existing，后面在线 add-key。
4. owner.ensureRunning：核实 identity/relay endpoint/dry_run=false/new-api 健康。
5. existing 情况调用 E3 AddKey 的幂等路径；冲突或探活失败终止，不覆写已有账号。
6. 取得 owner 已准备的 newapi-session（首次 ready 已完成 relay-policy），client-token 确保稳定 client token；不重复登录/重写倍率。
7. 返回 `{type:"api_key",key}`，不保存该 key 到插件 state，也不代 E1 写 auth.json。上游 KEY 退出后不在 owner/global 表保留。

失败均不称为已登录。若远端已经导入或生成 token，明确部分成功；不删除共享池成员，不自动撤销可能被其它 Pi 使用的 token。E1 决定如何显示登录失败和保留已登记的未配置实例。

论证：只有已准备完成的 gateway key 能作为结果；原始 KEY 不可能流入模型 auth；身份、实例 credential、池成员是三个独立对象。

## 8. pool-usage.ts

```ts
export type WindowAggregate =
  | { kind: "known"; usedPercent: number; used: number;
      capacity: number; unit: string; keys: number }
  | { kind: "unknown"; reason: "missing-window" | "missing-capacity";
      knownKeys: number; keys: number };

export interface PoolUsage {
  fiveHour: WindowAggregate;
  weekly: WindowAggregate;
  keys: readonly KeyUsage[];
  unroutableKeys: number;
}
```

`aggregateWindow(keys, window: "fiveHour" | "weekly", policy)`：空池返回 unknown；对当前 managed keys 有限遍历。每项必须有有效百分比/容量；equal 取容量 1、unit=account-equivalent；weighted 取该 key 该窗口真实配置容量。任一项缺失返回 unknown 及 coverage，不给部分分母的“总池百分比”。其余计算 sum(capacity*pct/100)/sum(capacity)*100。

`aggregatePool(snapshot,policy)`：分别计算两个窗口；不取两窗口最大值代替各自总池。disabled/exhausted 仍计入真实池容量，单独计不可调度数；query failed 的窗口不伪造。不同 reset 逐 key 保留，不生成一个统一 resetAt。

不变量：已知结果 used/capacity/percent 在浮点容差内相容；成员顺序不影响总值；在安全容量范围内同乘正数不改变 percent；100% key 仍在分母；unknown 不生成数字。used 只是按报告百分比推导的估计，不是精确 credits/tokens 计数。

论证：同容量是加权公式的特例；必须覆盖全部成员才能代表总池。独立/容量声明 H.6 是数学前提，不由函数证明。

## 9. usage-format.ts 与 usage-service.ts

`formatPoolUsage(usage): {compact:string;text:string}`：compact 只含 5h/week 和必要的不可调度标记；已知汇总以 ≈ 标明按上游百分比精度计算，unknown 显示 `?` 与 coverage。text先总池，再每key的用量/重置/路由状态，避免把账号label当provider ID。本插件新生成的UI文字默认简短英文，用户别名原样保留；不以当前中文对话为由翻译用户内容或改外部旧文案。外部名字移除控制字符，错误只展示固定原因，不透传 raw error。

`registerUsageService(pi, owner, config)`：加载阶段挂 E2 handler，不依赖先收到 session_start。请求包含 selection、当前原始 native Provider、session owner 和 signal；owner 只认领 WeakSet 中的 Provider 对象，且 id/endpoint/API 均匹配。

同步 accept 异步 Promise。查询只做已初始化身份下的 GET snapshot，不启动服务；未初始化返回 configuration，离线返回 network，取消返回 cancelled。校验最近完整快照年龄 `max(2*pollInterval,120s)`；过旧报错，外层可保留旧成功值并标err。该时间不证明各key同时采样，不能描述为原子实时余额。

有完整或部分窗口数据时返回available的compact/text。cancelled原样返回；timeout/startup-timeout→E2.timeout，network/not-ready→network，http→http，invalid-response→invalid-response，management-auth/client-disabled→auth，其余配置/身份/版本/存储失败→configuration。configuration只附本插件安全提示，不指向consumer的glmTeams。dry-run、可路由wild渠道不输出成功总池。已认领后从不再调用其它provider查询。resolve/format 的所有循环都遍历有限成员列表。

论证：membership+endpoint 比 TYPE 名称匹配更准确；来源在模型解析前 create 过，所以首次 footer 查询不依赖本插件 session_start 顺序。E2 outer controller 已有节流、取消和 stale 策略，不新增 timer/轮询。

## 10. 必须的实现测试与交付边界

逐函数/分支测试及跨模块性质见 [test-plan.md](../test-plan.md)。生产实现后运行对应测试和 npm run check；需要 built 输出时才 build，不用 build 代替类型检查。

已有 loader/目录/登录存储探针只是依赖机制证据。本设计的状态解析、token journal、CLI init、HTTP、真实 native stream 和 UI 均尚未实现；不得把本文结构齐全或原型通过当成产品正确性证明。
