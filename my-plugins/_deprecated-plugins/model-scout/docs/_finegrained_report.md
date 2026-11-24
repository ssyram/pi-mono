# model-scout 蓝图边界检查

## Phase 0：范围与判定标准

本轮仅分析，不实现、不修订被检查的两份文档。

- Docs：`architecture.md`（214 行）、`research.md`（134 行），共 2 文件、348 行。
- Code：插件尚无实现；Pi 官方源码和 `provider-profiles` 只作为机制事实依据。
- Config：不读取用户实际配置或凭据。
- Tests：尚无插件测试；不调用真实付费 provider。

判定标准来自用户：纯插件；R1 只补官方未支持；R2 官方接管后去掉插件补充；R3 每次 model refresh 全自动无感；R4 缓存先返回、后台自动更新。设计作者自行声明的“可接受”不视为用户授权降低保证。

证据标记：[源证] 一手源码/原始需求；[推导] 给定前提的失败轨迹；[未闭合] 缺少必要事实或契约。后续用户要求优先于旧调研的手动确认建议。

## Phase 1：原子命题

### 需求与蓝图命题

| 命题 | 原子陈述 | 来源 |
|---|---|---|
| P1 | 方案只能是插件，不修改 Pi 核心。 | 用户原始范围 |
| P2 | 只补当前 Pi 官方未支持的模型。 | 用户 R1；architecture.md:8 |
| P3 | 官方接管后应自动去掉补充。 | 用户 R2；architecture.md:9 |
| P4 | 每次 model refresh 都应自动完成插件那部分发现。 | 用户 R3；architecture.md:10 |
| P5 | 优先返回缓存，网络更新在后台。 | 用户 R4；architecture.md:12 |
| P6 | 发现调度只在 session_start / turn_start 触发。 | architecture.md:17、72 |
| P7 | cache fresh 时 scheduler 直接结束。 | architecture.md:18、78 |
| P8 | 后台 job 先取外部源，再判官方和增删。 | architecture.md:22–33 |
| P9 | 文档声称 P6 足以覆盖每次刷新，且滞后上界为 4h 加 job 时长。 | architecture.md:36–39、175–183 |
| P10 | managed 只记录 addedAt 与 source。 | architecture.md:43–49 |
| P11 | 缓存元数据只有全局 fetchedAt / etag。 | architecture.md:51–60 |
| P12 | models.dev 未收录 provider 时请求 baseUrl/models。 | architecture.md:90–94 |
| P13 | 官方基准为无参 getBuiltinModels() 与 models-store 原始条目之并集。 | architecture.md:24、96–103 |
| P14 | toAdd 排除官方及 models.json 已有全部 ID。 | architecture.md:123 |
| P15 | toPrune 为 managed 与官方基准的交集。 | architecture.md:124 |
| P16 | 写入与清理不触碰用户手工条目。 | architecture.md:117、195–196 |
| P17 | 原子 rename 加备份允许多会话 last-writer-wins，并声称丢轮可自愈。 | architecture.md:113、191–192、211 |
| P18 | 用户手改之后，该同 ID 条目不再由插件管理。 | architecture.md:205–206 |
| P19 | 元数据匹配失败也自动加入仅 id 的最小模型。 | architecture.md:105–109 |
| P20 | reconcile 只有 add / prune，没有更新已有补充元数据的动作。 | architecture.md:121–126 |
| P21 | 调研把模型映射为 chat 配置，并不映射 tool_call。 | research.md:64–73 |
| P22 | 调研主张 compat 主要靠 URL 探测，不需补充。 | research.md:73 |
| P23 | 所选主发现源是 models.dev 社区目录，不是 provider 官网 profile。 | research.md:56–60、105–108 |
| P24 | 设计因“替换整个 provider / 缓存互扰”排除 registerProvider + refreshModels。 | architecture.md:149–154 |

### 宿主事实命题

以下路径以仓库根为基准；均为源码证据，不代表已运行插件实测。

| 命题 | 原子陈述 | 来源 |
|---|---|---|
| P25 | getBuiltinModels 要求 provider 参数，且只返回该 provider 的静态 chat 目录。 | packages/ai/src/providers/all.ts:105–110 |
| P26 | 常规远程 overlay 只有 lastModified 新于本地生成时间才生效；404/501 可保留旧 models 但把 lastModified 设为 0。 | packages/coding-agent/src/core/remote-catalog-provider.ts:67–72、157–168 |
| P27 | OpenRouter 的个性化缓存替换目录，而非无条件并入静态目录。 | packages/coding-agent/src/core/remote-catalog-provider.ts:187–205 |
| P28 | 模型刷新先恢复缓存，再按 allowNetwork 执行网络阶段，并维护发布 generation。 | packages/ai/src/models.ts:507–609 |
| P29 | ModelRuntime.refresh 重读配置后等待目录和可用性刷新；默认网络许可来自运行时设置。 | packages/coding-agent/src/core/model-runtime.ts:885–926 |
| P30 | legacy ProviderConfig 组合可以先调用 base.refreshModels，再调用 extension.refreshModels。 | packages/coding-agent/src/core/provider-composer.ts:624–647 |
| P31 | models.json.models 的同 ID 替换不是元数据补丁；缺省 cost=0、reasoning=false，模型 compat 不从原模型继承。 | packages/coding-agent/src/core/provider-composer.ts:212–249、302–343 |
| P32 | 只留下 models:[] 的空 provider 配置会在组合时抛错。 | packages/coding-agent/src/core/provider-composer.ts:310–325 |
| P33 | provider-profiles 遇到同名 models.json 配置含 models 字段，将其判为冲突并跳过注册。 | my-plugins/provider-profiles/config-loader.ts:69–72；config-entry.ts:67–70 |
| P34 | profile 实例重绑定 provider ID，共享静态来源目录，自身无 refreshModels。 | my-plugins/provider-profiles/instantiator.ts:96–120；provider-source.ts:23–38 |
| P35 | Pi zai 端点是 Coding 路径；models.dev 同名 zai 是普通 API，另有 zai-coding-plan。 | packages/ai/src/providers/zai.ts:10；此前下载的 models.dev 快照，见 M1 |
| P36 | provider 鉴权结果可含 headers / env / baseUrl，不只有一个 Bearer key。 | packages/coding-agent/src/core/model-registry.ts:83–111、194–196 |
| P37 | 宿主解析带注释/BOM 的模型配置；任一 schema 错误使整份用户模型配置拒绝加载。 | packages/coding-agent/src/core/model-config.ts:169–204 |
| P38 | 模型配置/存储路径可注入，且运行时支持 PI_OFFLINE。 | packages/coding-agent/src/core/model-runtime.ts:219–248 |
| P39 | picker 先显示 snapshot，再 await 自己的后台 refresh；scoped 列表只更新已有 ID，不扩充成员。 | packages/coding-agent/src/modes/interactive/components/model-selector.ts:157–239 |
| P40 | 外部目录包含 embedding / audio-only 模型，且官方模型身份还包含类型维度。 | models.dev 公开快照，见 M5；packages/ai/src/models.ts:1164；remote-catalog-provider.ts:32–35 |

## Phase 2：矛盾与覆盖缺口

### Contradiction C1：P4/P5 vs P6/P7/P9 —— Medium，刷新并未驱动发现

[源证] `ModelRuntime.refresh()` 是可单独调用的目录生命周期（P29），不要求发生 turn；provider 的 `refreshModels` 已在这个生命周期内（P28/P30）。

[推导] 09:00 扫描，09:05 官方新增同 ID；用户只打开 `/model`，没有新 turn。蓝图没有执行 reconcile，插件配置继续覆盖官方。即便有 turn，P7 的 4h fresh 判断也会跳过清理。再如会话空闲超过 4h 后只刷目录，发现仍不运行，故“最多 4h + job 时长”没有依据。

最小方向：网络 TTL 与“每次刷新都执行缓存合并/官方去重”分开；不能用旧条目被重读代替发现生命周期。P30 说明此前排除 provider 生命周期接入的理由不充分，需重算两种接法，而不是直接改用另一个未验证接法。

R3 与 R4 本身不矛盾：合理组合是每次刷新先给缓存版补充，后台更新；但首次无缓存、官网刚发布、零网络等待三者不能同时保证拿到最新模型。

### Contradiction C2：P16/P17 vs 用户编辑与多文件提交 —— High，存在不可自愈的数据丢失

[推导] A 读旧 models.json；用户新增自己的模型；A 基于旧副本 rename 覆盖。JSON 完整，但用户刚加的内容消失。下轮只知道外部目录和当前配置，无法重建用户输入，“丢一轮自愈”不成立。

另一条轨迹：先写 models.json、尚未写 managed 时崩溃 → 新条目永远不被接管清理；先写 managed 再崩溃 → 所有权登记与文件不同步。进程内 single-flight 不保护多个 Pi 进程。

最小方向：若保留写配置方案，提交须串行化并校验读取版本，且 models.json 与所有权状态有明确恢复规则。原子 rename 只保证不出现半份文件；备份不是自动恢复证明。也可重新评估不把发现结果写进用户配置的插件自有层。

### Contradiction C3：P16/P24 的统一 models.json 方案 vs P33 —— High，profile 下次启动会失效

[源证] `provider-profiles/config-loader.ts:69–72` 将除 modelOverrides 外的任何同名字段判为冲突；`config-entry.ts:67–70` 对冲突 profile 直接跳过。

[推导] 插件给某 profile（例如 `zai-001`）补 `providers.zai-001.models` → 下次加载 provider-profiles 不注册 zai-001 → models.json 自身又只有 models、无该 profile 的认证和完整来源，不能替代原实例。故“对内置和 profile 统一写 models.json”当前不成立。

另一个共存分支：[源证] `provider-composer.ts:346–354、560–568` 对 legacy 扩展显式给出的 models 列表作整体替换，位于 models.json 合并之后；因此某些扩展还会遮蔽已写入的补充。这里不能与 profile 的 native Provider 注册混为同一种分支。

最小方向：发现结果必须经与现有 profile 身份/注册机制相容的通路提供；不能擅自放宽 provider-profiles 冲突检查，或把修改另一个插件当作已获授权。仅写 modelOverrides 也不解题，因为 unknown ID 不会新增模型。

### Missing M1：P12/P13/P23 依赖未定义的 provider 身份映射 —— Medium，正好会漏 glm-5.4

[源证] `packages/ai/src/providers/zai.ts:10` 为 `https://api.z.ai/api/coding/paas/v4`。此前从 `https://models.dev/api.json` 下载的公开快照显示：

| Pi/外部目录 | 端点/模型事实 |
|---|---|
| Pi `zai` | Coding 端点 |
| models.dev `zai` | `https://api.z.ai/api/paas/v4`，此快照无 glm-5.4 |
| models.dev `zai-coding-plan` | `https://api.z.ai/api/coding/paas/v4`，此快照有 glm-5.4 |
| models.dev `zhipuai-coding-plan` | 国内 Coding 端点，此快照有 glm-5.4 |

此证据只证明该快照的差异，不声称是本轮实时 API 可用性实测。快照位置：`/tmp/models-dev-api.json`；上表保留了本结论所需全部数据。

[推导] 按 provider 同名取目录会漏 glm-5.4；profile 实例 ID 更不可能直接等于上游目录 ID。canonical_model_id 表达模型谱系，也不证明不同服务的模型别名、价格、额度与权限一致。

默认 watched 只枚举 models.json 与内置认证状态，还会漏掉只在运行时注册的扩展/profile。不能把配置文件中的 provider key 集合当成全部实例集合。

最小方向：显式关联“Pi 实例 → 来源/端点/套餐 → 发现目录”，用 `(目标实例, 模型类型, 线上模型 ID)` 判重。不要用无条件去前缀/模糊匹配，也不重写现有认证和 baseUrl。

### Missing M2：P13/P15 依赖未定义的“当前官方生效集合” —— High，可能误删后无模型接管

[源证] P25 要求 `getBuiltinModels(provider)`，无参并非全量接口。P26 的版本门槛和 P27 的个性化替换又表明：缓存文件内容不等于当前 provider 生效目录。

[推导] models-store 中仍留 X，但 `lastModified=0`（404/501 分支）或旧于当前 bundled generation，Pi 不采用它；插件却把 X 当官方已有并删掉自己补的 X，最终 X 消失。另一种情况是把 OpenRouter 未向当前 key 提供的静态模型重新当成补充。

最小方向：去重/接管依据必须是该实例本次刷新真正采用的官方基线，包含版本、类型和可用性政策；官方状态未知不能解释为“官方为空”。注意 checkedAt/TTL 只控制再抓取时间，不决定已有目录是否生效，不应把 TTL 过期目录一律排除。外部联网失败时，已经确定的官方接管清理仍应能用本地数据完成，不应被 P8 的源请求前置阻断。

### Missing M3：P16/P18 依赖未定义的所有权移交与结构清理 —— High，可能删用户修改

[推导] 插件添加 X 后用户修改 X 的 context/compat，managed 只有 ID 和时间/来源（P10），仍登记 X。官方接管时 P15 直接删除 X，P18 的“手改后不再管理”没有实现依据。用户删掉 X 也会被下轮 P14 自动加回，未定义这是拒绝发现还是暂时删除。

[源证] 最后一个补充被删除后若留下插件创建的 `{ models: [] }`，P32 会产生组合错误。`enabled=false`、卸载插件或将 provider 移出 watched 也不会自动撤掉已持久化条目；之后再无自动收敛者。

最小方向：若坚持写配置，定义条目是否仍保持插件最后写入内容、何时交给用户，以及只删除插件创建且已无有效内容的容器。不要误删用户原有的 provider 字段。卸载/禁用的语义要明确；不是增加人工必做的清理步骤。

### Missing M4：P19/P21/P22 依赖未定义的“可供 Pi 正常调用”条件 —— High，列入不等于支持

[源证] P31 表明仅 id 会落到猜测式默认：128K context、16K 输出、reasoning=false、cost=0，而且不会继承原模型 compat。P37 表明一个无效模型配置可导致整份用户配置被拒绝加载。

[推导] 新模型需要不同 thinking 参数、回传 reasoning_content、特定工具历史或 Responses API；仅按 URL 配置可能能发第一条文本，却在带工具/历史的下一轮失败。外部目录有 ID、甚至 /models 中列出 ID，都不能证明这些请求语义已获 Pi 支持。

最小方向：自动启用仅限已有 transport/compat 规则能覆盖、元数据可解释的模型；缺少依据的候选不伪装成原生可用，不捏造 128K/零价格。工具、模态、输出上限、分层价格和 API 类型应由发现适配的实际证据支持；未知能力不靠收费探测强行“验证”。

### Missing M5：P12/P21 依赖未定义的目录协议与模型类别 —— Medium

[源证] 公开快照中 `nearai/openai/whisper-large-v3` 为 audio→text、tool_call=false；`vercel/openai/tts-1` 为 text→audio；`vercel/openai/text-embedding-3-small` 的模态也可标成 text→text，但不是聊天模型（P40）。因此只检查文本模态不够。

[未闭合] 蓝图没有定义原生列表的分页、认证头、API 路径或 operation 类型；chat 协议兼容不保证支持同一个 `/models` 列表协议（P36）。

最小方向：目录解析按已支持的 provider 协议实现，处理明确分页，保留真实 ID；仅将能承载当前 Pi operation 的模型送进对应列表。不把 embedding/语音 ID 一律塞进聊天 picker。

### Missing M6：P23 依赖未证明的发现时效与源事实 —— Medium

[未闭合] “models.dev 一定比 Pi 官方快”“官网上线后数小时到一天就收录”没有时效承诺证据。它是另一个目录，不是官网实时发现。GLM-5.4 的快照样本只能证明这次有数据，不能推出所有 provider 都更快。

[转述] research.md:60 把“智谱免费模型不在列表”标为实测；此前材料实际来自网页转述，本轮没有原生请求/响应证据，不能用作已经验证的全局事实。旧研究中的手动确认建议也已被用户 R3 覆盖，不是现行要求。

最小方向：区分“元数据源”和“上线发现源”；若要求跟随官网，须对目标 provider 的官方目录/结构化 profile 建立具体来源。models.dev 可补元数据，但不能宣称替代所有官方实时源。

### Missing M7：P5/P7/P11 依赖未定义的缓存失效与失败语义 —— Medium

[推导] 快照被删除/损坏但 etag 留着，304 无正文可恢复；一个 provider 成功拉目录但另一个 401/429，单个全局 fetchedAt 无法同时表达两者新鲜度；新增 provider/换 key/切 Coding 端点后，旧缓存仍可能被当成 fresh。失败不推进 fetchedAt 而每个 turn 重试，又可持续放大 429/离线失败。

最小方向：缓存有效性绑定来源与端点/实例语义，刷新失败保留最后有效快照；304 必须有可用正文，损坏/缺体不提交空目录；失败有下一次重试条件。尊重宿主 `allowNetwork=false` / `PI_OFFLINE` 和取消（P28/P38），不因插件独立 fetch 绕开离线模式。官方去重与外部缓存 TTL 解耦（C1/M2）。

### Missing M8：P20 依赖未定义的已有补充更新规则 —— Medium

[推导] 第一次只发现 X 的 ID，自动登记 sparse；第二天补齐上下文、修正定价，X 已在 models.json，于是 P14 永远排除 X，稀疏/错误元数据不再更新。源撤回模型或官方回滚时，文档也没有处理政策；“official 单调增长”不是宿主保证。

最小方向：插件仍拥有的条目可以更新为新可信元数据；用户已接管的条目保持不动。区分“本轮请求失败/分页不全”与“源明确撤回”，不要把暂时缺失直接当删除证据。

### Missing M9：P28/P29 与插件自发 refresh 的组合未定义 —— Medium

[源证] `registry.refresh()` 默认可能联网（P29），并非纯热载；Models 的新 refresh 会 supersede 旧 generation（P28）。

[推导] 插件在一个宿主刷新仍执行时落盘并再调 refresh，可能取消/替换前一个刷新；未来若接入 refreshModels，又在回调里递归调用 registry.refresh，会形成重入/取消链。会话关闭或 reload 后旧后台结果若仍落盘，也缺少有效代次约束。

最小方向：明确发布与重新触发刷新的边界；采用 provider publish 时不递归 refresh，采用配置写入时只做必要的缓存/目标刷新。完成后若生命周期已过期，不允许旧结果覆盖新状态。不能只靠“有 AbortSignal”就声称所有写盘都已受取消保护。

### Missing M10：P4/P5 与实际 UI/启动时序缺少覆盖 —— Medium

[源证] P39 的 picker 在构造和自己那次 refresh 完成时读取 snapshot，并未因任意 registry 更新持续订阅重建；scoped 模型集合不会自动纳入新 ID。CLI 在 session_start 之前已进行模型选项解析（packages/coding-agent/src/main.ts:872–908）。

[推导] picker 自己的刷新已结束后，插件后台才发布 X，当前 picker 仍可能不出现 X；冷启动配置默认 X 或 `--model X`、但首次发现尚未完成，也不能靠 session_start 事后修好先前选择。

最小方向：保证缓存模型在首次解析前可用；区分后台发布到 registry 与当前 UI 已刷新。保留用户 enabledModels/--models 的过滤意图，不因“无感”擅自扩展白名单。首装无缓存的等待/退回现有模型边界必须如实说明。

### Missing M11：P17/P37/P38 与文件权限、格式、实际路径缺少覆盖 —— High，含配置和凭证风险

[源证] 用户模型配置支持 apiKey；宿主接受注释/BOM（P37）且 modelsPath 可注入（P38）。

[推导] 新建 temp/backup 若采用不同于原文件的权限，可能让原本仅用户可读的含密钥配置变成其他本机用户可读。硬编码 `~/.pi/agent` 还可能写错隔离实例的配置；严格 JSON.parse 会误拒绝宿主可读的注释文件。首装不存在 models.json 也不应被当作损坏而永久停止发现。

最小方向：使用宿主实际配置归属路径与解析语义，保留配置/备份的访问权限；只读取必要字段且日志脱敏。若接口无法获知注入的路径，则声明适用范围，不能声称覆盖全部启动模式。不要以 schema 公开为由推定重写用户配置无副作用。

### Missing M12：模块私有契约尚未闭合 —— Low

[源证] architecture.md:108、140 分别写入 `metadata: "sparse"` 和 `state.lastError`，但 P10/P11 的数据结构没有这两个字段。`metadata-map` 声称输出 ProviderModelConfig（要求 name/input/cost 等），同时 P19 又只输出 id；用户 JSON 定义和运行时 provider 定义并非同一种类型。

最小方向：细化前统一数据归属和返回类型；只保留确有用途的状态。这个缺口不需要新一套抽象或额外流程。

## Phase 3：设计点交互覆盖

8 个设计点：D1 刷新生命周期；D2 当前官方基线；D3 来源/实例身份；D4 缓存与后台发布；D5 增删更新归并；D6 provider/profile 共存；D7 配置写入与所有权；D8 启动选择与 picker。

以下覆盖仅指已有明确交互声明，不表示声明已经成立；有声明但错误的情况由 Phase 2 的矛盾/缺口处理。N/A 表示没有额外的独立交互义务，不要求为凑矩阵新增机制。

| A | B | 覆盖？ | 依据 / 缺口 |
|---|---|---|---|
| D1 | D2 | yes | architecture.md:22–25 有顺序；刷新触发错误见 C1 |
| D1 | D3 | yes | architecture.md:22–29 调度 job 取源 |
| D1 | D4 | yes | architecture.md:76–82 声明 SWR 调度；失败细节见 M7 |
| D1 | D5 | yes | architecture.md:30–33 串起 reconcile |
| D1 | D6 | **no** | 与 provider 原有刷新组合的契约未定义，C3/M9 |
| D1 | D7 | **no** | 取消/reload 后提交代次未定义，M9 |
| D1 | D8 | **no** | CLI 初始解析/打开中 picker，M10 |
| D2 | D3 | **no** | 来源 provider 与目标实例/套餐不同，M1 |
| D2 | D4 | **no** | 原始缓存与生效基线不等价，M2 |
| D2 | D5 | yes | architecture.md:123–126 给差集；输入错误见 M2 |
| D2 | D6 | **no** | profile/动态目录/个性化目录未统一，C3/M2 |
| D2 | D7 | yes | architecture.md:124 声明官方接管删除；所有权问题见 M3 |
| D2 | D8 | N/A | 经 D5/D6 进入 registry，无单独 UI 判定规则 |
| D3 | D4 | yes | architecture.md:51–60、84–88 给快照保存路径 |
| D3 | D5 | **no** | operation 过滤、可调用性和 metadata 更新，M4/M5/M8 |
| D3 | D6 | **no** | 目录认证/协议与实例映射，M1/M5 |
| D3 | D7 | **no** | 外部数据到全局配置的验证/安全边界，M4/M11 |
| D3 | D8 | N/A | 源数据不能直接驱动 UI，须先经过归并与 registry |
| D4 | D5 | **no** | 外部 TTL 与官方接管未解耦，C1/M2/M7 |
| D4 | D6 | **no** | 账号/端点切换及刷新代次，M7/M9 |
| D4 | D7 | **no** | 快照/登记/配置多文件提交，C2/M7 |
| D4 | D8 | **no** | 缓存何时恢复到首次选择前，M10 |
| D5 | D6 | **no** | 扩展 models 列表遮蔽补充，C3 |
| D5 | D7 | yes | architecture.md:111–125 给单一写入点；事务与移交问题见 C2/M3 |
| D5 | D8 | yes | architecture.md:128–131 声明变更通知 |
| D6 | D7 | **no** | profile 禁止同名 models 配置，C3 |
| D6 | D8 | N/A | 本任务不新增 provider 专属 picker；走宿主 registry |
| D7 | D8 | yes | architecture.md:119 给写后 refresh；及时可见性见 M10 |

合计：28 个组合，10 yes、15 no、3 N/A。15 个矩阵缺口不是 15 个额外问题，同一根因已归并到 Phase 2。

## Phase 4：结论

### 判断

**当前蓝图不满足进入实现的条件。** 四项需求可以相容，但“写 models.json + 在 turn 上搭车”尚未证明能满足它们；不能继续沿用“纯插件链路已全部打通”“全自动原生效果已经成立”的表述。

最先处理的不是新增一套手动命令，而是三项架构义务：刷新生命周期接线、当前实例官方基线、与现有 profile/用户配置的隔离。其后才是发现源协议和缓存失败分支。

### 严重性与统计

- 目标：2 份文档，348 行；无插件实现。
- 原子命题：40 条。
- 矛盾：3 项（C1–C3）；覆盖缺失：12 项（M1–M12）。
- 核心设计点：8 个；交互组合：28 个；缺口：15 个。
- High：6 项，C2、C3、M2、M3、M4、M11；Medium：8 项；Low：1 项。
- 上述统计是本轮检查范围内的结果，不代表所有 provider/模式已被穷尽或实测通过。

高严重性逐项摘要：
- C2：完整 JSON 仍可覆盖用户编辑，多文件提交中断还会丢失所有权。
- C3：给现有 profile 写 models 字段会使该 profile 下次加载被拒绝。
- M2：把未生效的官方缓存当接管证据，可能删到当前唯一可用的模型条目。
- M3：缺少用户修改后的所有权移交规则，会误删用户配置。
- M4：ID/元数据不证明请求协议兼容，非法映射还可能使整份模型配置失效。
- M11：重写/备份带凭据配置的权限和实际归属路径尚无契约。

### 独立检查的采纳边界

本轮另有 1 个独立 reasoner 按同一组原始要求检查。其输出仅是分析材料，不作为事实来源的替代；原始产物保存在宿主 subagent artifacts 的 `41419e70-01bc-4721-8455-95bdc5b667aa/.pi/subagent-outputs/oracle.md`。

- 采纳其有源码支撑的方向：官方缓存 generation 门槛、个性化目录不等于并集、空闲刷新与 picker 更新缺口、legacy 扩展遮蔽写入。对应 M2、C1、M10、C3。
- 不采纳“没有 refresh 事件，所以纯插件无法满足”的推断：P28/P30 已证明存在 provider.refreshModels 生命周期入口；缺少事件不证明缺少接法。
- 不采纳“provider 路径必然两次 persist 同一个槽，故必须选 models.json”的定论：`provider-composer.ts:629–647` 的扩展返回结果通过仅含 update 的 publish 安装；扩展自己是否持久化是可选政策。独立缓存并非被接口禁止。替换模型清单也不等于必须丢弃整套原 provider 鉴权与传输行为。能否用这个路径完整覆盖本任务仍须另行设计证明，当前不宣布它已经可行。
- 不采纳将 `provider-profiles` 的 native Provider 注册误当成 legacy models 数组覆盖的例子；本轮通过 config-loader/config-entry 找到的是另一条明确冲突路径（C3）。
- 不采纳把旧报告的“智谱免费模型实测”直接升级为事实（M6），也不新增“连续两轮接管才清理”等未经用户授权、会主动延迟 R2 的策略。

### 必须明确、但不能由作者擅自接受的边界

- R3/R4 应合成为：每次 refresh 用缓存补充、按本次官方基线去重；网络发现后台更新。不能承诺无缓存的首次运行也零等待取得刚上线模型。
- “Pi 已有兼容 transport 的新模型”与“需要新增协议实现的模型”不是同一能力范围。后者不能靠填配置假称原生支持。
- models.dev 可作来源之一，但没有证据保证它永远快于 pi.dev，更不等于官网实时抓取。

本轮只提交检查报告与插件目录内的学习记录，不修改原蓝图、不修改任何代码、不执行 npm/build/provider 调用。没有把风险声明反写成用户已接受的要求，也不继续细化或实现。
