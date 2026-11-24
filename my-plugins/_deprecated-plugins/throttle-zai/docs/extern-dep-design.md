# 外部依赖设计

状态：完整推荐设计，待批准及对应 owner 实施。这里是所有外部修改的唯一规范位置；不能把“拟新增”写成上游已有功能。

本插件内部只引用 E 编号。不得将 throttle-zai、Pi Provider、provider-usage 的类型/频道/命令写进 quota-throttle 或 new-api 的接口。外部 PR 在 fork 独立准备，不与插件实现混交；本轮没有 fork、PR 或生产改动。

## E0. 依赖矩阵与已有依据

| ID | Owner | 已存在 | 还需实现 |
|---|---|---|---|
| E1 | provider-profiles | 配置、内置实例、注册、标准 SDK | 静态新来源、服务协议、统一工厂、自动标准登录 |
| E2 | provider-usage | text/compact、controller、共用 query | 通用外部优先请求协议 |
| E3 | quota-throttle | up/sync/run、status、AddKey、单写者调度 | init CLI、身份/ready、lifetime OS 锁、受管proxy恢复、幂等Key导入 |
| E4 | new-api rc.20 | setup/login/options/channel/token/models | 本方案不要求改其代码；插件需正确调用及配置私有路由 |
| E5 | Pi SDK 1.4 | Provider、事件总线、ModelRuntime/login、lazyStream | 不要求改宿主；默认文件凭据假设必须明确 |

固定源：quota-throttle `0b89c9611b60e439e0ed678a114ade72709f8c5e`；new-api `v1.0.0-rc.20`=`6ce7305cd36f16506fb6a2c3c524a5a318539ba7`；实际 Pi 1.4 安装库。历史事实与探针在 research/；本文件覆盖前轮 profile.apiKey 自动保存和缓存代理候选。

## E1. provider-profiles

### E1.1 配置与覆盖

仍使用 `getAgentDir()/provider-profiles.json`：

```json
{
  "new-providers": [{ "id": "throttle-zai" }],
  "my-zai": { "provider": "throttle-zai" },
  "codex-002": { "provider": "openai-codex" }
}
```

new-providers 只登记来源服务 ID，不包含实现路径、模型能力、shell、任意参数包。没有该字段按空数组，原 profile 结构保留。

- 字段非数组为整体 ConfigError，零登记。
- 单项须为仅含非空字符串 id 的对象；坏项跳过并报告，其它继续。
- 后声明覆盖前声明和内置同名来源，警告并列受影响 profile，不打印凭据。
- 覆盖的是来源定义，不授权覆盖实例名、清除凭据或重写其他配置。
- 声明先把同名来源置 waiting；缺服务绝不回退旧来源。
- new-providers 是保留 profile 名，已有同名 profile 需要明确迁移，不能自动改名/删除。
- 配置更改通过正常 restart/reload 生效；不新增文件监听器。

### E1.2 公共工厂协议

建议 public module `provider-source-service.ts`：

```ts
import type { Provider } from "@earendil-works/pi-ai";

export const PROVIDER_SOURCE_QUERY = "provider-profiles:source:v1";
export const PROVIDER_SOURCE_READY = "provider-profiles:source-ready:v1";

export interface ProviderProfileSpec {
  readonly id: string;
  readonly apiKey?: string;
}

export interface ProviderSourceService {
  create(profile: ProviderProfileSpec): Provider;
}

export interface ProviderSourceRequest {
  readonly id: string;
  accept(source: ProviderSourceService): void;
}

export interface ProviderSourceReady { readonly id: string }
```

`apiKey` 只表示已配置的最终模型调用 key/环境引用，不是待导入的上游 KEY。现有 `wrapApiKeyAuth` 可从 public barrel 明确 re-export，供提供者复用 stored > explicit config > undefined 的策略；不导出 consumer 私有配置/命令状态。

create 的合同：
- 同步返回完整 Provider，最终 id 必须匹配，getModels 可立即读本地初始目录。
- 每次创建产生独立实例闭包；不复制捕获 TYPE id 的动态 hook。
- 不 IO、不联网、不启动/登记 provider；异步工作放标准 auth/refresh/operation。
- 返回的标准 auth/models/stream 由提供者负责，consumer 不再白名单复制或削弱能力。

服务仅在进程内传递，不是另一个 HTTP daemon。EventBus unknown 处的类型断言基于此公开契约，不引入递归 schema walk。

### E1.3 查找、发布和顺序

`resolveProviderSource(id,bus,warn)`：同步 emit QUERY，accept 窗口只开到 emit 返回；try/finally 关闭窗口。0 响应返回 unavailable；多个响应按订阅顺序取最后一个并警告，不按异步速度竞争。

`provideProviderSource(id,source,pi)`：先挂 QUERY handler，再 emit READY；source 对象在本次 publication 内稳定。必须是提供者 factory 的最后成功步骤；发布后再失败没有跨扩展自动回滚保证。

消费者：先订阅 READY，再主动查询。未有服务就返回，不 await 未来插件。晚加载提供者在其 factory 内发 READY，consumer 同步构造登记；早加载提供者由主动查询发现。两路均在宿主提交 provider 队列及初始 full offline refresh 之前完成。

源证：Pi `loader.js:420-451,526-575`、`agent-session-services.js:71-111`、`main.js:602-683`。不把 session_start 当最早创建点。READY 只保证构造服务，不保证外部 gateway 健康。

### E1.4 来源表、结构校验和登记

```ts
export type SourceSlot =
  | { kind: "builtin"; source: ProviderSourceService }
  | { kind: "waiting" }
  | { kind: "service"; source: ProviderSourceService };

export type ProfileCreation =
  | { kind: "created"; provider: Provider;
      origin: "builtin" | "service"; source: ProviderSourceService }
  | { kind: "unavailable" }
  | { kind: "error"; code: "unknown-source" | "invalid-provider-id"
      | "api-key-not-accepted" | "construction-failed" };
```

每次扩展加载持有 catalog，不在 module 全局缓存 runtime 来源。内置来源继续用 instanceProvider，保留 clone-unsafe 排除及 Copilot 过滤规则；新服务返回值直接登记，不经过旧克隆器。

config 校验分为结构/已声明来源，以及构造后的 Provider 身份/auth 校验；不要让配置层猜待加载服务的 isOAuth。OAuth + 显式配置 apiKey 仍在保存/登记之前拒绝。

初始化持有本次拥有的登记请求名称。source 对象不变的 READY 不重复创建；新来源替换失败只撤销本次已经提交的旧别名，不留旧来源暗中成功、不删除别人的 provider。registerProvider 返回可能仅表示排队，最终提交错误仍由宿主 diagnostics 报告。

来源 id/new-providers/内置保留名不能被当作实例覆盖；命令上下文可拒绝已存在 runtime 实例。静态恢复不额外授权覆盖其他扩展实例。

### E1.5 /add-login 和标准登录落盘

命令签名注入同一 catalog。补全保留参数位置规则，候选包含 waiting，但标注服务未挂载；不补全秘密。

推荐操作顺序：
1. help/参数/名字/来源/冲突校验；unknown/waiting 零写入且明确报错。
2. source.create 得到实例，校验 id/auth，不外部 mutation。
3. 保存 profile **身份声明**，保留 new-providers；然后登记。失败明确“已保存但登记失败”。
4. builtin 保持原交互；service 的 API-key login 在没有显式第三参数时自动启动。OAuth-only 仍可用原生 /login。
5. 自动登录走下节公开 SDK，凭据不写入 profile.apiKey；取消/失败可留下已登记未配置的 profile，提示重试 `/login <id>`，不假称零副作用。
6. 登录后先 full offline refresh 主 registry，再只刷新该实例网络目录；目录失败是已登录但目录未确认，不再次导入 KEY。

第三参数仍是最终调用 key，保留原 profile config 回退；它不被猜成某个登录 prompt 的上游输入。正常用户两参数调用，由 TYPE 自己的 auth.login 决定输入内容。

### E1.6 已验证的公开 SDK 登录桥

ExtensionContext 没有 modelRuntime/login；不得访问 registry 的私有 runtime 或手写 auth.json。

候选 `profile-login.ts` 使用公开类：

```ts
const loginRuntime = await ModelRuntime.create({
  authPath: join(getAgentDir(), "auth.json"),
  modelsPath: null,
  modelsStore: new InMemoryModelsStore(),
  refreshOnCreate: false
});
const isolatedProvider = makeProvider();
loginRuntime.registerNativeProvider(isolatedProvider);
await loginRuntime.login(isolatedProvider.id, "api_key", interaction);
await context.modelRegistry.refresh({ allowNetwork: false });
```

makeProvider 再调用同一 source 工厂，避免临时 Runtime 和主 Runtime 共用一个可变目录闭包。临时 Runtime 不发无关目录网络请求，不写主 models-store；SDK 只修改本实例 credential，并保留返回 credential 的 env。**默认 CLI 文件存储**是前提；自定义 SDK CredentialStore 必须由宿主公开桥接，不能写默认路径假称成功。

AuthInteraction：prompt 支持 text/secret/select/manual_code，select 返回 option.id；取消 abort。notify 接受 AuthEvent 对象，逐类转换 UI，不发送用户消息、不触发模型。input 不保证密码掩码，不冒称已实现。进度 finally 清理。

结果分为 ready、registered-unconfigured（取消/登录失败）、credential-saved-but-sync-failed、saved-but-registration-failed。公开 CredentialSynchronizationError 表示凭据已改变而 snapshot 同步失败，不再次调用登录或撤销 gateway token。错误仅用固定安全信息，不回显响应/credential。

已有同名旧存储/实例冲突先拒绝，要求改名或原生清理，不悄悄覆盖无关身份。原生 logout 只删除凭据；自动流程 profile 不含 apiKey，所以不会再回退生成 key。用户显式配置 apiKey 的旧行为不变。

文件级探针 `research/evidence/login-runtime-probe.*` 已证明默认文件写入、主 Runtime refresh 可见、logout 删除及权限0600；不等于真实 UI/OAuth/自定义存储已测试。

### E1.7 文件改动

| 文件 | 修改 |
|---|---|
| config-loader.ts | splitProfileConfig，分离声明，坏 JSON/元数据不覆盖；诊断不含 JSON 秘密片段 |
| config-entry.ts | 保留名字/结构/来源检查；依赖 auth 的校验移到实际构造后 |
| provider-source.ts | 内置来源 service adapter，保留原过滤/排除 |
| 新 provider-source-service.ts | public 类型、同步 resolve/provide |
| 新 source-catalog.ts | 单 owner 来源表、覆盖、waiting、实例创建校验 |
| provider-profiles-extension.ts | 先订阅后查询，初始同步登记，拥有的实例失效处理 |
| commands.ts | 共用 catalog，身份保存/登记/服务登录流程 |
| 新 profile-login.ts | 公开临时 Runtime + AuthInteraction UI；无私有凭据写入 |
| config-writer.ts | 保留声明；本调用独占temp/0600/rename；仍不保证跨进程合并事务 |
| index.ts | 仅 public re-export |

保留键、自动交互、部分成功和默认凭据存储范围须作为外部 owner 的变更契约批准。源码文件≤200有效行，无 any/动态 import/非erasable TS。

## E2. provider-usage

### E2.1 最小公开协议

```ts
export const PROVIDER_USAGE_QUERY = "provider-usage:query:v1";
export interface ProviderUsageRequest {
  readonly session: object;
  readonly selection: Selection;
  readonly nativeProvider: Provider | undefined;
  readonly signal: AbortSignal;
  accept(result: Promise<QueryResult>): void;
}
```

Selection、QueryResult 复用现有 usage-contract；selection 已含 sessionId/model/providerId/api/endpoint，不再重复这些字段。nativeProvider 来自公开 `getRegisteredNativeProvider(providerId)`，不是私有 runtime。

本插件以创建过的 Provider 对象 WeakSet + 当前 endpoint/API 判断 ownership。这样同 id 新来源替换后，旧插件不会仅凭旧字符串认领；models.json 对模型的合成不改变原 native provider 引用。未注册为 native 的其它服务可用自己的公开身份策略，但不能让 consumer 硬编码厂商。

### E2.2 wrapper

在 bootstrap.ts 的共用 query factory 外包 external-first，先于 readTeams、处理内置 route 结果及认证解析。

- handler 同步 accept 异步 Promise；emit 完成后关闭认领窗口。
- 无认领 → 原 executeUsageQuery。
- 已认领 → 返回其结果；error/cancelled/unsupported/not-applicable/reject 都不再 fallback。
- first claim wins；所有已提交 Promise 都观察拒绝，避免未选结果成为 unhandled rejection。多 owner 属于装配诊断，不以异步速度选结果。
- 返回available仍只有compact/text，不增加raw capacity/key类型。error可增加可选的安全message用于详情；不允许原始HTTP/credential内容。

handler 在 extension factory 阶段挂载；请求携带当次 session 和标准对象，不依赖某个 session_start 已先执行。保留原 controller 的15s、60s节流、generation、取消及 staleError；不新增 footer timer。

### E2.3 修改位置和用例

bootstrap.ts注入wrapper；新增公开protocol/client；usage-contract的registry facade增加公开getRegisteredNativeProvider，error分支增加可选message；extension/command仍共用query。usage-command不能继续把所有configuration错误都硬编码为检查glmTeams：使用safe message或通用CONFIG，原GLM查询自己提供原有提示以保留行为。footer及多行详情不需要新渲染机制。

测试：未认领走旧路；认领失败不解析内置凭据；外部配置错误不误指glmTeams、原GLM提示保留；select localhost 原路由报错也可接管；取消/reject/多 handler；native对象替换后旧 owner 不认领；纯 modelOverrides 不丢 ownership；首次查询反加载顺序；多行 text 单行 compact；现有真实团队身份回归。未宣称这些生产测试已运行。

## E3. quota-throttle：必要的通用服务能力

没有本插件、Pi、provider TYPE、来源频道或 QPDI 字段。只增加“可安全托管的本机调度服务”能力；适用于任何外部客户端。

### E3.1 现有能力与限制

当前有 up/sync/run/down；up 下载/校验/启动 new-api、setup/login、sync、调度。status 提供逐 key 百分比、reset、模型/组、管理/野生渠道和虚拟余额。AddKey 探活后建渠道/持久化/热加入；RemoveKey 保留渠道，priority=0不等于禁用；最后一个 key 不可删。

当前没有完整的 init 命令、身份/version握手、daemon lifetime锁；看板 bind 失败仍继续调度。空池在 HTTP 启动前退出。这些限制不伪装成已有保证。

### E3.2 `init`：拟新增的幂等配置初始化

调用：`quota-throttle init <config-path> --json`。stdin 一个 JSON，stdout 一个 JSON，stderr只记无秘密诊断。

```ts
interface InitInput {
  version: 1;
  instanceId: string;
  controlUrl: string;
  relayBaseUrl: string;
  admin: { username: string; password: string };
  scope: { kind: "personal" } | {
    kind: "team"; organization: string; project: string;
  };
  seed: { name: string; apiKey: string };
}

type InitReply =
  | { version: 1; kind: "created" | "existing";
      instanceId: string; controlUrl: string; relayBaseUrl: string }
  | { version: 1; kind: "error";
      code: "identity-conflict" | "invalid-config" | "quota-probe" | "storage" };
```

- 全新路径：validate → QuotaProbe 查 seed（team准确作用域）→生成实例身份/地址/dry_run=false/管理配置/seed →私有原子写TOML →created。
- 存在且 identity/端点匹配：不覆写、不新增seed，返回existing；运行中账号修改仍走HTTP命令通道。
- 存在但缺身份/归属不明：identity-conflict，绝不按名幂等偷偷接管。
- 并发init使用该目录的初始化文件锁及原子写；只一份配置成为权威。无秘密stdout，argv不含KEY/password。
- 只创建配置，不启动loop或发模型请求。复用已有QuotaProbe、toml_edit；客户端无需复制TOML parser/serializer。

生成TOML沿用原Config：顶层status_addr/poll_interval_secs=60/dry_run=false；new_api.base_url为relay origin；管理账号来自stdin；manage.data_dir为本受管目录；channel_template为国内Coding Plan type8/default组及原生模型发现；seed映射为KeyMapping。省略未经本次核实的peak展示配置。新增 `[service]` 保存api_version=1和instance_id，决定v1机器管理合同；不把客户端instance/Profile写入配置。

初始化锁与daemon lifetime锁分离；已有原子配置只读验证后可返回existing，不等待正在持有lifetime锁的daemon。init不重写运行中的KeyMapping。

这不是“任意现有服务一键接管”。旧安装显式备份/迁移后才可成为受管实例；本版插件不执行自动迁移。

### E3.3 单实例与 readiness

up/run 在网络初始化前取得 canonical managed dataDir 的独占 lifetime lock；持有 File 到进程退出，崩溃由OS释放。[Rust std File::try_lock](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock) 自1.89稳定，可以提高MSRV而不加依赖；WouldBlock返回明确 already-running（约定exit3），其它锁错失败。锁文件不在运行中删除。

锁只保护同一受管目录和遵守协议的调度器，不是跨机器/不同目录重复使用同一批key的分布式锁。操作者不得给同一池配置多个控制者。

init生成的v1受管配置把control API视为必要服务：先取得lifetime锁、绑定control，再启动/复用new-api；control bind失败则退出并释放锁，不留下无法管理的调度loop。这是新v1管理合同，不要求悄悄删除legacy未版本化配置的best-effort看板行为。

status 增加非秘密、在启动阶段也可返回的 metadata：

```ts
interface ServiceMetadata {
  name: "quota-throttle";
  apiVersion: 1;
  instanceId: string;
  phase: "starting" | "ready";
}
```

放在 `/api/status.service`；保留现有字段，新增正整数 poll_interval_secs。starting响应也须从配置填入new_api_base/client_endpoint，不能用空URL使客户端误判为别的实例。

phase=ready 必须在control已监听、new-api认证成功、首份调度数据已发布且managed key IDs都有channels实况之后；new-api失联或渠道实况缺失回到starting。不要求所有key有剩余额度；正虚拟wallet也不是这个服务ready的同义条件。legacy无metadata不满足v1，不以HTTP200冒充握手。

现有channels字段为enabled:boolean、status_raw:number、group:string；KeyStatus.tier已有active/standby/exhausted/unknown。instanceId只防误连，不是抵御恶意本地服务的认证秘密，仍依赖可信回环部署。

数据单位明确：updated_at、five_hour_reset、weekly_reset是epoch ms；RequestLog.created_at仍是秒。模型入口必须等于配置的relayBaseUrl。不要在metadata返回管理员密码/token/key。

新增幂等 POST /api/backend/ensure：进入同一bounded命令队列，由持锁controller执行现有NewApiProcess.ensure_running、认证并恢复实况；成功返回 `{kind:"ready",instanceId,relayBaseUrl}`。只管理自身配置的new-api，不启动第二个controller、不改变KEY/priority选择、不杀未知进程。等待上限75s，超时后调用方只读status收敛，不反复叠加启动命令。正常运行仍用现有up；此接口解决controller尚活而托管proxy已退出的情况，不能靠重复up锁失败假装恢复。

### E3.4 AddKey 幂等语义

仍是 POST /api/keys；input保留name/api_key/org/project，写请求使用既有X-QT-Panel约定。安全范围仍是可信本机回环，不能宣称它是认证。

通过同一单写者处理：
1. 标准化name/selectors，比较完整KEY+selector fingerprint。
2. 同name但不同fingerprint：409 conflict，不覆写。
3. 已完成且存在相同fingerprint：返回200 `kind:existing`、canonical name/channel_id及可用探活结果，不重复渠道/配置。
4. 新fingerprint：探活成功后先持久化import intent，再创建自己的初始disabled渠道、记录channelId、保存配置/加入managed集合、仅激活本次新建渠道、tick后回执201 `kind:added`。不重新启用既有被手动/自动禁用的渠道。
5. import journal按fingerprint记录prepared/creating/channel-known/committed，不保存额外明文KEY；重试只恢复同一事务。KEY仍由本次请求或已提交配置提供。
6. NewAPI创建回执未知时先对账；不能证明归属或暂未查到则返回operation-uncertain，不再POST第二个渠道。发现同名未管理渠道但没有本次intent证据也冲突，不拿掩码key猜相同。
7. 失败说明渠道已创建/配置已保存/尚未激活等部分状态；失败记录保留，timeout不表示未执行。这里不是跨NewAPI和TOML的exactly-once事务。

不靠短标签证明身份，不接受名字碰撞后借用其它key。当前源码只按名字拒绝重复，此幂等语义是新增设计。

不必为本功能增加空池运行或修改RemoveKey语义。客户端若发现属于路由组却未管理的enabled渠道，拒绝将它视为受管池，不自动删/禁用旧渠道。

### E3.5 函数/文件落点

| 位置 | 待实现 |
|---|---|
| main.rs | init分派；up/run先锁、绑定v1 control再初始化；already-running退出；ready发布顺序 |
| config.rs | instanceId/端点与init参数校验，序列化幂等初始化 |
| 新 instance_lock.rs | canonical dataDir File lifetime lock，无PID租约 |
| status.rs | service metadata及明确schema/单位，starting snapshot |
| orchestrator.rs | 单写者AddKey/EnsureBackend、canonical名称回执、自己的新渠道激活 |
| 新 key_import.rs | 导入intent/恢复/未知结果与配置提交，不盲重放NewAPI创建 |
| 既有 quota.rs/newapi.rs | 复用探活/渠道和认证，不引入客户端专属协议 |

文件按该项目实际风格拆分，不能由本插件文档断言Rust实现/审查已通过。外部公开API README、控制设计、回归用例同步修改。

验收：init两路/冲突/坏KEY/无秘密stdout；并发up仅一个loop；异常退出释放锁；control bind失败不留下v1孤儿loop；proxy崩溃可由ensure恢复；wrong-owner可判定；starting不假ready；AddKey重复/冲突/崩溃阶段恢复/不激活未知渠道/回执后快照可见；保留现有调度/缓存粘性/窗口恢复行为。

## E4. new-api：现有 API 的使用合同

本方案不要求向 new-api 新增 Pi 功能，也不把包月真实额度映射到它的虚拟钱包。

### E4.1 管理认证

固定tag已有 POST /api/user/login，cookie+New-Api-User；User.AccessToken是系统管理token，不是 model.Token.Key。管理host仅受管回环origin，不跟随redirect，不把cookie放到模型请求。

setup创建root额度100000000。SelfUseModeEnabled不是“余额无限”的证明；余额<=0时tryWallet/preconsume仍403。私有模式不启用2FA自动化；如果操作者修改管理身份/启用2FA导致旧凭据不可用，明确管理认证失败，不接管。

### E4.2 私有订阅转发的零倍率

已有 RootAuth 的 GET/PUT `/api/option/`：

```json
{ "key": "GroupRatio", "value": "{\"default\":0,\"vip\":1,\"svip\":1}" }
```

实际实现先读/merge，不用示例整表覆盖未知配置。ModelRatio同样是JSON map string：只补本插件已知、尚未定价的模型ID为0；不设置猜测的真实模型价格。

理由：group_ratio.go拒绝负数但允许0；text_quota.go费用乘分组倍率，ratio=0不触发最低扣费1。已有用户余额正值检查仍存在；正常私有root保持正值且这些文本请求最终虚拟计费为0。

若有wild/default可路由渠道、非私有用户、身份不匹配、无效options或非正余额，插件拒绝自动修改/报独立配置错误。本策略不用于任意外部new-api，不自动购买/兑换/充值，不对上游套餐收费作承诺。

### E4.3 调用 token

- POST /api/token/：创建；response只有success/message，没有id或key。
- GET /api/token/：按受支持分页参数遍历；普通key掩码。
- POST /api/token/:id/key：返回完整data.key，无修改令牌副作用。
- 只对本次root用户的稳定client name匹配，group=default、unlimited_quota=true、expired_time=-1。
- 网络未知时停止创建并对账，不因list暂时为空自动发第二次POST。

调用认证用gateway token；upstream KEY只在channel；管理员认证独立。unlimited token不绕过用户余额检查。

### E4.4 固定一手来源

- [token.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/controller/token.go)：创建不返回key/id，专用取key。
- [auth.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/middleware/auth.go)：管理身份、New-Api-User。
- [setup.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/controller/setup.go)：root正额度及模式。
- [group_ratio.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/setting/ratio_setting/group_ratio.go)：0倍率合法。
- [model_ratio.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/setting/ratio_setting/model_ratio.go)：缺模型价格与显式映射。
- [text_quota.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/service/text_quota.go)、[billing_session.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/service/billing_session.go)：费用和余额门槛。
- [option.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/controller/option.go)、[api-router.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/router/api-router.go)：管理设置路径。

E4行为的源码论证不是本插件真实运行验收；必须以本机fake upstream测试零费率、预扣、token、SSE/工具/思考再决定可用。

## E5. 外部实施与完成门槛

E1/E2在各自owner实施，E3在fork独立PR；不得为方便把这些源码vendor进本插件，或把私有consumer代码变成本插件import依赖。

实施前确认：保留配置键、默认CLI credential桥接、部分成功语义、source发表后不再失败、单池及容量假设。所有函数的源实现/测试/契约文档同步；E1原生回归、E2旧团队查询及E3调度回归不可省。

已有依据：loader7项、基本runtime和文件登录探针。未运行：E1/E2产品修改、E3新增CLI/锁、私有new-api零费率链路、真实UI和并发控制。不得以本文完整、接口看起来合理或agent自述当作已正确实现。
