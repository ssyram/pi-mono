# throttle-zai：运行时 provider 来源与账号池接入调查

状态：历史调研记录，非当前规范。当前插件设计见 ../design/architecture.md 和 ../design/detailed-design.md；所有外部修改集中到 ../extern-dep-design.md。保留原实验、源码事实与候选沿革，不将旧方案继续视为实现要求。

后续补证：login-runtime-probe.json 已证明公开临时 ModelRuntime 登录、默认文件存储、主 registry 刷新可见及原生 logout。旧 §5 的 profile.apiKey 保存方案被 E1 标准凭据路径替代；这不改变 ctx 本身没有 login 的平台事实。

**后续方案更新**：根据用户提出的“new-providers 静态声明 + 来源服务”方向形成的代码级候选，已迁至 [`extern-dep-design.md`](../extern-dep-design.md)。真实 Pi 加载器的 7 项离线原型已证明该方向可在两种加载顺序下提前登记实例；本报告 §6 的缓存先行是前一轮候选，保留为历史依据，不再是推荐启动前提。

结论：运行时来源发现、API-key 实例创建、GLM 元数据复用和外部用量查询存在有源路径，其中关键机制已离线跑通。但“仅改来源表、输入一把上游 KEY、任意环境下完整无痛”不成立：独立目录恢复、服务管理身份、团队上下文、单调度器启动和真实总池容量都有必须明确的条件。以下给出实际可行路径和不能假装已经闭合的边界。

## 1. 目标与调查边界

用户目标：`/add-login my-zai throttle-zai`，交互输入 KEY，最终使用 `my-zai/glm-5.3`。`throttle-zai` 是来源 TYPE，`my-zai` 是 Provider.id；实例名不自动等于外部池名或池成员名。

要求：
- 新插件注册标准 Provider，不引入第二份 TYPE 注册表或 TYPE 发现服务。
- provider-profiles 通用地接受运行时注册来源；保存、恢复、认证、模型归属保持实例身份。
- 新插件负责连接/启动 quota-throttle 与 new-api、握手和模型适配。
- provider-usage 通过公开用量协议优先接受外部结果；没有认领才回退内置。
- 摘要显示当前绑定池的 5h/week，详细查询显示分 key 数据。
- Pi 官方源码只作参考，本轮不改业务代码、不 fork、不提交 PR、不使用真实凭据或付费模型。

本轮遵循 `/workflow` §4.1：调查基础设施、完整路径、候选差异、推荐与前提。没有进入 §4.2 架构批准、§4.3 函数细化或审查阶段。

## 2. 证据版本与强度

- 当前安装运行库：`/Users/ssyram/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/` 下 Pi 1.4.0。
- 工作区基线：`c4043bf103927d0f9838fa1be8f08fe7834c0c45`；相关原有插件开始调查时没有未提交改动。
- quota-throttle：`0b89c9611b60e439e0ed678a114ade72709f8c5e`。
- 它示例配置指定的 new-api：`v1.0.0-rc.20`。
- 探针执行环境：Node v26.8.1。探针的源文件解析 loader 是研究工具，不是对 Pi 最低支持 Node 版本的兼容性证明。

本文的“源证”指实际实现/公开声明；“离线通过”仅指隔离程序中的断言通过；“建议”是待实现方案，不能当成已有接口。

`evidence/source-sha256.txt` 固定了主要插件和运行库实现的文件哈希。实际安装库与工作区 node_modules 不可互相替代：本机安装目录确实包含 GLM-5.3，而先前读取工作区目录得到的缺失不能代表运行版。

## 3. 已运行的直接依据

运行：

```bash
node --import ./my-plugins/throttle-zai/docs/research/evidence/source-loader.mjs \
  my-plugins/throttle-zai/docs/research/evidence/runtime-probe.mjs \
  > my-plugins/throttle-zai/docs/research/evidence/runtime-probe.json
```

当前退出码为 0。另对三个 `.mjs` 文件执行 `node --check`，退出码均为 0。

探针验证了：
- 标准 Provider 可以进入实际 ModelRuntime/ModelRegistry。
- `getRegisteredProviderIds()` 不包含内置 provider；它不能单独用作全部来源列表。
- 扩展拿到的 ModelRegistry 有 `getProvider()`，没有 `getProviders()`、`login()`。
- 现有 `instanceProvider()` 对静态来源保留模型归属、上下文和输出上限。
- 公开 ModelRuntime.login 可以按实例 ID 向注入的内存凭据库写入，但这不证明扩展上下文能调用它。
- 直接调用 Provider 自己的 API-key login，取得返回 key 后，经现有 `upsertProfileEntry()` 保存，再重建实例，可以解析认证；不需要写 auth.json。
- 当前 `instanceProvider()` 确实丢弃来源的 `refreshModels`，不是理论风险。
- 标准 `RefreshModelsContext.stored/publish()` 可以发布实例目录，并在第二个独立 Runtime 中、来源尚未绑定时恢复目录和可用性。
- 官方 createEventBus 支持同步认领、异步 Promise 返回；未认领可以区分。
- 整个探针网络调用数为 0。

未做：真实 auth.json 写入、完整 CLI/扩展启动集成测试、真实网关或智谱请求、并发启动试验、真实模型的流式/工具/思考验证。

探针曾因自制认证 fixture 返回 `{apiKey}` 而非真实 `{auth:{apiKey}}` 失败；按公开 AuthResult 声明纠正 fixture 后通过。随后为读取现有 `.ts` 中的 `.js` specifier，增加了仅作用于 provider-profiles 的研究 loader；未改业务源码或放宽断言。

## 4. 运行时来源：发现成立，但不等于任意克隆成立

### 4.1 已有接口

源证：
- `PI/coding-agent/dist/core/model-runtime.d.ts`：ModelRuntime.getProviders/getProvider/login/refresh。
- `PI/coding-agent/dist/core/model-registry.js:66-68,137-142`：扩展 facade 的查找及已注册来源查询。
- `PI/coding-agent/dist/core/model-runtime.js:350-355`：getRegisteredProviderIds 合并扩展配置与原生扩展 ID，不含 builtins。
- `my-plugins/provider-profiles/provider-source.ts`：当前只调用 builtinProviders，并排除带 refreshModels 的来源。

这里 `PI/<package>` 指第 2 节安装目录中的 `@earendil-works/pi-<package>`。

最小发现策略建议：保留既有内置来源构造路径，增加运行时注册来源；按上下文查询，不把一个 Runtime 的动态来源放进模块级静态 sourceCache。扩展来源优先检查 `getRegisteredNativeProvider(id)`，避免把任意 models.json 配置或虚拟模型误当成可克隆来源。

### 4.2 认证和目录的实例绑定

源证：`my-plugins/provider-profiles/instantiator.ts:101-115` 重戳模型 provider、按 entry.name 绑定身份，但没有保留 refreshModels；`PI/ai/dist/models.js:586-610` 的目录闭包按原 input.id 恢复已存模型。

所以不能用“运行时找到一个对象 → spread 改 id → 复制所有回调”承诺通用实例化。也不能为了接入 throttle 删除现有动态目录限制，反过来破坏原来被隔离的来源。

本功能可将新 throttle 来源实现为共享同一池目录的 API-key 来源；由账号层的实例目录代理持有别名目录，认证仍按实例解析。这个范围不包含对所有第三方 OAuth、图片、分类、任意凭据专属目录的自动克隆保证。

## 5. 登录：有一条不调用私有 Runtime 的路径

源证：
- `PI/coding-agent/dist/core/extensions/types.d.ts:213` 的 ExtensionContext 只给 modelRegistry，没有 modelRuntime/login。
- `PI/coding-agent/dist/index.js` 导出 ModelRuntime，但没有导出默认 AuthStorage 写入入口；不能把新建类的公开方法误写成 ctx 可用方法。
- `PI/ai/dist/auth/types.d.ts:170` 的 ApiKeyAuth.login(interaction) 返回 ApiKeyCredential。
- `my-plugins/provider-profiles/config-writer.ts:19-47` 已支持保存实例配置 apiKey。

可行建议：
1. 命令从运行时取得来源 Provider。
2. 对本功能的 API-key 来源调用其 `auth.apiKey.login(interaction)`。
3. interaction 使用扩展 UI，不把 KEY 放入用户消息或模型上下文。
4. TYPE 的登录实现完成上游账号导入和服务初始化，返回网关调用 key。
5. provider-profiles 把返回的网关 key 保存为 my-zai 的配置 apiKey；不保存为 TYPE 的凭据，不复制上游 key 到 profile。
6. 构造 my-zai，刷新并发布其实例目录，保存声明，成功后才报告可使用。

现有存储凭据仍优先于配置 apiKey，不能悄悄改变。这条新建路径必须确认没有同名旧 auth.json 凭据覆盖返回 key；否则明确要求清理旧登录或使用新实例名，不能保存后假报已切换。实例名还不能覆盖来源 TYPE 或其他已注册 provider。若返回凭据含必须保留的 env 或不是简单 API key，不能只截取 key 假装支持；需要明确支持的序列化/登录路径。旧内置 OAuth 流程不因本功能被替换。

现有 config-writer 没有跨进程写锁，最后 rename 胜出，且写入没有显式 mode。自动保存新生成调用令牌时，应明确私密权限；并行 /add-login 不丢配置若成为要求，需要补独立的写入保证，不能把它称为既有能力。

## 6. 启动恢复：真实的时序缺口与已跑通的机制

本节缓存方案已由后续静态来源服务候选替代；平台时序事实仍有效，但“无缓存必须改宿主”的判断不适用于服务能同步构造初始目录的新方案。详见同目录代码级细化及 source-loading-probe.json。

源证：
- `PI/coding-agent/dist/core/extensions/loader.js:138-180`：加载期注册排队，没有可用的会话上下文。
- `PI/coding-agent/dist/core/agent-session-services.js`：资源加载结束 → 提交 provider 队列 → offline refresh。
- `PI/coding-agent/dist/main.js:602-678`：上述服务初始化结束后，CLI 才解析模型并创建 session。
- `PI/coding-agent/dist/core/sdk.js:90-118`：SDK 会在 session_start 之前恢复/选择模型。

因此，“在 session_start 查运行时并第一次创建别名”不足以支持同次启动的 CLI/default 模型解析。

### 6.1 不改宿主的候选路径：缓存先行、来源后绑定

离线通过，见 `evidence/cached-alias-probe.mjs`：
1. 第一次 /add-login 已有上下文，找到真实来源并生成 my-zai 模型目录。
2. 使用标准 context.publish 将重戳后的完整目录持久化在 my-zai 的 ModelsStore 槽。
3. 重启加载期，provider-profiles 按已保存身份注册 my-zai 的目录/请求代理，不在此时假装拿到了运行时来源。
4. 服务初始化的 offline refresh 把 my-zai 的 context.stored 恢复进实例目录；配置 key 使它具备可用性。
5. CLI 此时已有目录和身份，可解析已缓存模型。
6. session_start 后，从当前 registry 绑定真实来源；请求只能在绑定成功后委托，失败明确报错，不借其他账号或来源。

这不是新增 TYPE 表或服务；目录缓存来自现有 ModelsStore，TYPE 查找仍用官方 registry。代价是要新增一个真正的别名目录/请求代理，不能声称只改补全函数。

### 6.2 边界

- 探针证明了底层缓存/可用性机制，不是完整 CLI 扩展组合已经实跑。
- 首次成功建号必须确保目录发布落盘；没有缓存、缓存被删或不含所选模型时，不能承诺同次冷启动的 CLI 解析。需要交互刷新；若要求无缓存也完全无痛，需要早于模型选择的公开宿主初始化能力，不能把 session_start 冒充它。
- 实现时必须定义 TYPE 变更、来源缺失、缓存过期与绑定失败时的行为；缓存不能成为另一个目录权威。
- 不能直接调用原来源的 refreshModels 闭包来假装已完成按实例隔离。

## 7. 模型与请求协议

离线运行版确认：zai 和 zai-coding-cn 都已有 glm-5.3，contextWindow=1000000，maxTokens=131072。它们是当前 Pi 目录声明，不是本轮实测上游允许的极限。

建议：网关 `/v1/models` 决定可用 ID，安装版对应 GLM 目录提供完整元数据；交集中的已知模型重戳成 my-zai，并将所有请求地址改为网关。未知 ID 不猜上下文长度或输出上限，也不依赖默认 128k 假装与官方一致。

不需要为了 Pi 请求 quota-throttle 维护另一份模型数据库。其 `src/model_catalog.rs:24,60` 现在只返回 ID；一个详细接口本身不能产生缺失的权威数据。

请求路径：

```text
Pi openai-completions
  → new-api /v1/chat/completions（JSON / SSE）
  → 智谱 /api/coding/paas/v4/chat/completions
```

源证：`PI/ai/dist/api/openai-completions.js:1232-1296,1320-1340`。兼容检测依赖 provider 名称及上游 URL；改为 my-zai 和 localhost 会丢失 Z.ai 检测。因此适配器必须显式保留相应 compat，例如 supportsDeveloperRole=false、supportsReasoningEffort=false、maxTokensField=max_tokens、thinkingFormat=zai；不能只复制模型参数再改地址。其它 compat 字段以实际模型及协议实现为准，不盲目扩大覆盖。

复用原生请求实现还需保留取消、payload/response instrumentation、用量、工具和思考事件。真实网关在这些维度的完整兼容性仍需后续直接集成测试。

## 8. 服务初始化、调用令牌与握手

new-api 固定源码为 v1.0.0-rc.20 对应提交 `6ce7305cd36f16506fb6a2c3c524a5a318539ba7`。原始 token、认证及预扣实现已获取；以下区分服务已有 API 与插件尚需写出的调用代码。

### 8.1 四种凭据不可互换

- 智谱上游 KEY：配置渠道和查询 Coding Plan 额度。
- 管理登录 cookie：POST /api/user/login 后的管理员/用户会话。
- 系统管理 token：User.AccessToken；不是模型调用 token。
- 模型调用 token：model.Token.Key；提供给 Pi 的认证凭据。

固定版本的管理认证使用 cookie 或系统 token，且要求匹配的 New-Api-User。`middleware/auth.go:37-95,181-195` 处理这些条件。仅有上游 KEY 不能接管一个未知管理员凭据的既有服务；有 2FA 的服务也不能假装当前 root 登录流程已经支持。

### 8.2 调用 token 的实际创建路径

源证：`controller/token.go:65-95,167-234`、`router/api-router.go:232-253`。

1. 使用已知管理凭据建立有效 session/系统 token 身份。
2. POST /api/token/，传 name、group、过期和额度配置。
3. 成功响应只有 success/message，既不返回生成 key，也不返回新 token id。
4. 分页查询当前用户的 token 列表，以本次生成的唯一名称定位 id；普通列表/详情的 key 是掩码，不能拿它请求模型。
5. POST /api/token/:id/key，取返回 data.key。
6. 返回给 TYPE 登录调用方的是这个 gateway key，而不是智谱 KEY。

这个 API 路径在 new-api 中已存在；quota-throttle 当前 NewApiClient 没有相应创建/取回调用 token 的方法。适配器可以直接调用标准 new-api 管理面，或由上游补独立的通用客户端引导能力；不能把它写成 quota-throttle 已经替客户端做好了。

创建/取回超时需要先对账，不能直接再创建一枚。唯一名称用于定位，不等于服务端已保证幂等。

### 8.3 余额不是一个 token 开关能解决

源证：`service/pre_consume_quota.go:31-78` 明确先检查用户虚拟余额，<=0 或不足时 403；无限调用 token 仍经过该用户检查。quota-throttle `src/newapi.rs:742-759` 仅查询该余额，不充值。

因此默认初始化必须确保 new-api 的用户余额/计费设置确实允许转发；“给 token 设置 unlimited_quota”不是充分条件。本轮未验证自动维持余额或免费计费配置，不能承诺此后永久无需处理该层限制。

### 8.4 两种实际 bootstrap

- 新建插件管理的服务：需要已安装 quota-throttle 可执行文件和可写私有数据目录；生成管理员配置、团队上下文、第一把 key，up 托管启动 new-api，管理认证后创建调用 token，再确认状态/模型入口。
- 连接已有服务：必须有其明确的管理认证或已提供的调用 token；不能凭上游 KEY 自动获得该权限。不得静默替换管理员密码、接管未知进程或重写现有配置。

`src/boot.rs:126-184` 已有 new-api 的健康复用、固定版本下载及校验、启动进程组、PID 和最多 60s 健康等待。但这些不是 quota-throttle 调度进程的独占锁。源证 `src/main.rs`、`src/status.rs` 允许面板端口绑定失败而调度继续；安全的并发自动启动仍需明确的单实例机制。

已核实的 quota-throttle 事实：
- 它是单 GLM Coding Plan 池调度器，代理由 new-api 提供。
- `src/main.rs:187-191` 在没有 key 时先退出，管理 HTTP 服务还没有启动。
- 已有配置可执行 up；首次可生成专属配置并以第一把上游 key 为 seed，再走 up。已有运行实例使用 POST /api/keys。
- 团队套餐的 org/project 不能从 KEY 凭空推出；支持全局默认及逐 key selector，缺少时探活会失败。
- `/api/status` 含更新时间、代理地址、new_api_healthy、逐 key 状态；HTTP 端口有响应不等于调度与代理均可用。
- `X-QT-Panel` 只检查头存在，不是身份认证。控制面仅限本机可信访问。

## 9. 用量查询：保留现有两种显示，不另建容量框架

源证：`my-plugins/provider-usage/src/usage-contract.ts:29-35` 已有 available.text/compact；`src/bootstrap.ts:8-18` 是 footer 与命令共用 query 的注入点。

建议公开 `provider-usage:query:v1` 一类版本化总线协议（名称未定稿，尚未实现）：
- 请求携带当前 providerId、模型/endpoint、session 身份、AbortSignal 和同步 accept 回调；不传上游 key。
- 服务只认领自己管理的连接；本功能按实例实际 endpoint → pool 绑定匹配，不按 TYPE 名称、实例名的字符串前缀或池成员名猜测。
- 认领时立即 accept(Promise<QueryResult>)，网络查询随后异步完成。
- 没有认领才调用原 executeUsageQuery。
- 已认领的失败、unsupported、not-applicable 均不触发内置认证回退。
- 直接复用 `{kind:"available",compact,text}`，text 可包含逐 key 多行。

外部 wrapper 必须位于原查询读取团队设置、处理内置 route 结果和解析认证之前。内置 route 不接受 localhost，不能让它先拒绝再尝试外部服务。

源证补充：`src/extension.ts:26-47` 为命令和 footer 注入同类 query；`src/usage-command.ts:23-25,53-55` 将详细 text 直接用于通知；`src/footer-display.ts:4-15` 只读取并规范化 compact。首轮查询不能依赖服务自身先收到 session_start，因此请求需有足够的模型/endpoint 与 owner 信息，让服务在不依赖事件先后次序的情况下判断是否属于自己管理的连接。

外部查询不能无限等待或自建 footer 轮询；保留现有 controller 的节流、取消、15s 上限、generation 和 staleError 行为。总线 handler 应在扩展加载时注册，但不在此时访问尚未存在的会话；用请求中的身份/上下文完成匹配。

## 10. 总池的含义与现有数据限制

源证：quota-throttle 的 `src/quota.rs:15-32`、`src/status.rs:31-70` 只有逐 key 的 5h/week 百分比、重置时间、套餐 level；没有统一的绝对总容量。new-api 的 used_quota 是内部计费量，不是套餐额度。

窗口必须分开聚合：poolUsed(window) = sum(used_i) / sum(capacity_i)。若只知道 percentage_i，只有各账号独立且同容量时才可等权平均。

例如两把等容量账号分别 20%、60%，池已用 40%，不是 80%；也可以表达为已用 0.8/2 个账号份额。不同档套餐在没有真实容量权重时只能显示明确命名的归一化账号份额，不能称作真实总容量。

- 同一额度账号的多把 key 不能重复计入容量。
- 查询失败的 key 不能计作 0%，也不能悄悄从分母删除后仍声称完整池。
- 各账号重置时间独立，池没有天然统一的 resetAt。
- `/api/usage` 的请求历史及 new-api 内部用户余额均不能充当 5h/week 总池额度。

## 11. 实例与池的对应必须显式

当前 quota-throttle 是一套配置、一批 key、一个全局 active/pin。Provider 实例化并不会自动增加外部池隔离。

可行的不同产品语义：
- 多个实例连接同一 endpoint/同一池：不同 my-zai 名称仍看到同一个总池。最接近现有服务能力。
- 每实例连接不同的既有 endpoint/池：按显式连接配置隔离，服务进程、端口和数据目录也必须隔离。
- 同一服务内多组独立调度：当前不是现成功能，需要上游多池设计；不能把 new-api 的 group 字段等同于 quota-throttle 已有多池调度。

本报告不擅自裁定用户要哪一种。TYPE、实例、池、池成员四个身份必须保持分开。

## 12. 改动位置建议

| 模块 | 位置 | 必要变化 |
|---|---|---|
| provider-profiles | provider-source.ts | 内置来源保留、加入运行时原生扩展来源；按 Runtime 查找 |
| provider-profiles | commands.ts | 通用来源补全、API-key 登录交互、成功后持久化和目录发布 |
| provider-profiles | config-entry.ts | 分离结构校验与需要运行时才能完成的来源校验 |
| provider-profiles | provider-profiles-extension.ts | 加载期恢复实例缓存代理，会话阶段绑定来源 |
| provider-profiles | 新的实例目录/委托模块 | 使用标准 stored/publish；不复制原来源的动态闭包 |
| provider-profiles | config-writer.ts | 自动令牌落盘的私密权限；现有并发边界需明确 |
| throttle-zai 新插件 | provider 注册/认证 | clone-safe 来源、启动与账号导入、返回网关调用 key |
| throttle-zai 新插件 | 模型适配 | ID 与元数据匹配、实例归属、地址与 compat |
| throttle-zai 新插件 | 池客户端与用量 | 状态读取、池绑定、聚合及 text/compact；不 import usage 私有实现 |
| provider-usage | bootstrap.ts + 公开协议/client | 外部优先 wrapper，旧 query 保留 |

registrar.ts 已接收标准 Provider，可复用。现有静态内置实例化路径不必为了新功能整体替换。相关 README、architecture/principles 必须同步来源范围、登录行为、缓存及失败边界；这些是未来实施内容，本轮未修改。

## 13. 跨进程契约要点（调研级，不是已实现保证）

| 维度 | 已知事实 / 推荐约束 |
|---|---|
| 连接 | 管理和推理分别使用 HTTP；推理流式 SSE；连接关闭不等于删除池成员或停止服务 |
| 超时 | provider-usage 现有总体 15s；AddKey 服务端可等待 60s，客户端不能沿用 15s 后假装添加失败且无副作用 |
| 重试/幂等 | 状态 GET 可重新读；账号/令牌创建超时为“结果未知”，先对账，不能自动重放非幂等写入 |
| 交付/顺序 | 本机管理命令进入调度器队列，不能声称跨进程 exactly-once；登录成功前应确认服务端结果及本地声明/目录持久化 |
| 失败 | 导入、创建调用令牌、本地保存可部分成功；不能用一个失败响应掩盖已创建渠道或令牌 |
| 状态 | 池状态由 daemon 持有，Pi 会话退出不应关闭共享服务；服务重启应使用其已保存配置 |
| 背压 | 管理命令队列容量为 8，满时 503；调用方明确报告，不堆无限重试 |

服务启动还有实际并发问题：当前看板 bind 失败允许调度继续，不能把“第二个进程端口失败”当作已阻止第二个调度器。客户端先查再启动也不能单独消除竞态。应由单实例运行约束或通用 daemon 独占机制闭合；本轮未验证并发启动。

## 14. 上游 PR 边界

- 不为 Pi 增加第二套模型参数表；安装版已可提供需要的元数据。
- 空池启动管理 API 是独立有价值的候选，但首 key seed 可以避免它成为本功能的必需改动。
- 单调度器实例与可判定 readiness 是真实的通用外部管理需求；若需增强，PR 应仅涉及 daemon 自身，不出现 Pi 类型、命令名、插件协议或客户端专属字段。
- 账号/令牌创建幂等若当前版本缺失，客户端应诚实处理未知结果；不能把“可以重试”写成已有保证。
- 本轮未创建 fork/PR。需要上游代码时按用户要求在 fork 独立准备，不能和 Pi 插件改动混成一个指向性补丁。

## 15. 实施前仍需明确的事项

1. my-zai 等实例是共享一个池，还是各自绑定不同池。
2. 账号是否同档、额度是否独立；异档池的容量权重来源。
3. 后续已找到不依赖旧缓存的方案：提供者在加载期提供同步实例工厂及初始目录。相关服务发布、保留配置键、登录交互与覆盖语义应按代码级细化明确批准；不再要求为此新增宿主早期初始化接口。
4. 团队 org/project 与 daemon/binary 的一次性初始化前提；“只输 KEY”不是从空白机器自动获得所有上下文的证明。

这些事项不是让用户代做源码调查；它们分别改变池隔离、额度含义与启动保证，不能由实现者静默选择。

## 16. 交付与未完成边界

调查产物均在本目录：主报告、三个离线探针/loader、JSON 结果、假凭据 fixture 和源码哈希。无业务代码、宿主代码、真实账号配置、依赖或锁文件变更。

并行调查中，用量和网关方向正常返回；provider 方向任务在 1800000ms 限制处超时，但留下了源码定位报告。没有将该子任务计为执行通过、没有重派，也没有因此切换到其他执行 CLI。其材料与主会话直接读取的安装版实现一致；缓存先行、认证保存等机制由主会话自己的离线程序提供依据。

不能把本报告、子任务自述或离线机制通过称为真实网关已上线、完整 CLI 恢复已验收或生产实现完成。下一步应先确认本报告中的产品语义与边界，再按 workflow 进入架构阶段；不应直接编码。

## 17. 可定位的一手来源

- 安装版 Provider/Models/RefreshModelsContext：`PI/ai/dist/models.d.ts`；发布/恢复实现 `PI/ai/dist/models.js:143-209,586-610`。
- 扩展公开上下文：`PI/coding-agent/dist/core/extensions/types.d.ts:213-260`；注册时序 `PI/coding-agent/dist/core/extensions/loader.js:138-180`。
- 初始注册和模型解析：`PI/coding-agent/dist/core/agent-session-services.js:53-111`、`PI/coding-agent/dist/main.js:602-683`。
- quota-throttle 主流程：[main.rs](https://github.com/lihaokun/quota-throttle/blob/0b89c9611b60e439e0ed678a114ade72709f8c5e/src/main.rs)。
- 逐 key 探针：[quota.rs](https://github.com/lihaokun/quota-throttle/blob/0b89c9611b60e439e0ed678a114ade72709f8c5e/src/quota.rs)；状态和管理接口：[status.rs](https://github.com/lihaokun/quota-throttle/blob/0b89c9611b60e439e0ed678a114ade72709f8c5e/src/status.rs)。
- new-api 调用 token：[controller/token.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/controller/token.go#L65-L95)、[创建响应](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/controller/token.go#L167-L234)。
- new-api 管理认证：[middleware/auth.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/middleware/auth.go#L37-L95)。
- new-api 用户余额门槛：[service/pre_consume_quota.go](https://github.com/QuantumNous/new-api/blob/6ce7305cd36f16506fb6a2c3c524a5a318539ba7/service/pre_consume_quota.go#L31-L78)。

