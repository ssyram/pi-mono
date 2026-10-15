# 设计证据 — 更新至 2026-10-15

## E10 — 当前账号 key 与真实 Pi 验证

用户明确同一团队中各账号额度独立。2026-10-15 分别取 000/001 的 profile key、002/999 的 stored credential key（四把互不相同），带相同组织/项目请求国内 `?type=2`；四次均返回 HTTP 200、success=true、code=200 和两条 CREDIT_LIMIT。样本的 5h/week 已用比例为：000=76%/38%，001=100%/78%，002=1%/1%，999=1%/1%；后两者的已用计数为 151 和 0，百分比相同不等于相同账号数据。

已修正为团队全局字段仅保留组织/项目和 providers，每次通过 registry 解析当前 model 的 apiKey，不再使用脚本 key。通过 my-settings saveGlobalOnly 从实际全局配置删除 key，保留四个关联和其它设置；不改模型凭据。旧 key 字段现在返回 CONFIG，避免继续错误共用。

32 项插件测试通过，包括各 provider 分别发送自身 Authorization、返回不同额度，切换模型后 footer 随之更新，以及认证缺失/失败/取消不借用其他 key。已启动本机安装的真实 Pi（不是 mock）：只显式加载 provider-profiles 和本插件，四个账号逐个切换，footer 分别显示上述 5h/week；`/provider-usage` 四账号详情一致对应，`/reload` 后当前账号额度仍显示。无模型推理请求；宿主同时报告已有第三方主题 schema 警告，未修改主题。

## E9 — 旧实现（已证实不满足账号隔离）

用户提供的本地 Python 脚本包含独立团队 key、组织和项目，授权脱敏提取并写入全局 settings.json；未执行原脚本。此前已确认 `zai-000-g-l`、`zai-001-g-l` 为团队账号，本次由显式关联共同使用该三元组。通过 my-settings 的 `saveGlobalOnly` 写入单字段，保留其它全局设置并设当前文件权限为 0600；不写模型 auth/profiles 或 session log。

2026-10-15 用新 `executeUsageQuery` 入口、global settings client 和真实国内固定 `?type=2` 接口分别查询两个关联 provider，均返回 available；测试中的模型认证入口禁止调用。没有发起模型推理请求，没有保存原始服务响应或把密钥输出到日志/仓库。此证据只能证明同一把 key 被重复查询成功；将其解释成共享团队额度是错误假设，已由 E10 的逐账号实测纠正。

29 项插件直接测试通过，包括入口初始化、mock footer 和多 provider 命令共用团队凭据、修改全局设置后重读、忽略项目配置、不读写 session、重复关联/不完整字段拒绝、取消不发 HTTP、原路由保持，以及失败/空数据不回退模型 key。真实终端 /reload 后的显示仍由用户查看。

静态检查边界：新增模块、命令接线与测试等 11 个文件的定向 Biome 检查通过；已有 controller 的三个 void-return 风格诊断未在本轮顺手改写。插件严格 tsc 的诊断均位于引入的 my-settings 源文件（其尚未满足消费者启用的 exactOptionalPropertyTypes/noUncheckedIndexedAccess），未放宽类型选项或修改该工作线。`npm run check` 在 my-settings/e2e/index.ts 的既有 DemoState 未使用警告处停止；该根脚本带 --write，本次报告自动格式化 36 个文件，因此不能把根检查称为通过，也未对共享工作区做不安全回退。

以下 E1–E8 保留原调查时点，不能用早期无上下文失败覆盖 E10 的逐账号完整团队上下文成功证据。

证据仅支持下列命题；源码、外部样例和本账号实测分开记录。

| ID | 命题与来源 | 边界 |
|---|---|---|
| E1 | [ExtensionContext](../../../packages/coding-agent/src/core/extensions/types.ts) 提供 model/modelRegistry/mode；[ModelRegistry](../../../packages/coding-agent/src/core/model-registry.ts) 有 getApiKeyAndHeaders(model)；[ModelRuntime](../../../packages/coding-agent/src/core/model-runtime.ts) 按模型解析并合并认证 headers | 不等于捕获一次 LLM caller 的私有临时 override |
| E2 | [Codex](../../../packages/ai/src/providers/openai-codex.ts)、[Z.AI](../../../packages/ai/src/providers/zai.ts)、[CN](../../../packages/ai/src/providers/zai-coding-cn.ts) 定义协议和端点；[具名构造](../../provider-profiles/instantiator.ts) 保留这些模型属性 | profiles 仅是调查材料，不是运行依赖；未知代理不能据此还原供应商 |
| E3 | [FooterComponent](../../../packages/coding-agent/src/modes/interactive/components/footer.ts):141–146 生成费用段，再生成 context；status 在第三行，右侧名称取 model.provider；`(auto)` 取内部 `autoCompactionEnabled`。[ExtensionUIContext](../../../packages/coding-agent/src/core/extensions/types.ts) 提供 `setFooter` 工厂（tui/theme/footerData），可取得 branch/status/providerCount，但无自动压缩 getter。[公开示例](../../../packages/coding-agent/examples/extensions/custom-footer.ts) 用 `ctx.sessionManager` 重建 token 统计 | setFooter 完整替换而非包裹原组件；原生 FooterComponent 构造需要插件没有的 AgentSession；纯插件不能确知实时 `(auto)` |
| E6 | [扩展事件](../../../packages/coding-agent/src/core/extensions/types.ts) 定义 session_start/model_select/turn_end/session_shutdown；[交互宿主](../../../packages/coding-agent/src/modes/interactive/interactive-mode.ts) 的 `isUnknownModel` 定义 `provider=id=api="unknown"` 无模型占位符；[插件约定](../../CONVENTIONS.md) 记录启动时机、串行 await 与清理要求 | hasUI 包括 RPC；用 mode=tui；占位符不应被显示成 `(unknown: ERR)`；不采用旧文档的跨会话 globalThis 建议 |
| E7 | [AGENTS.md](../../../AGENTS.md) 限制开发改动在 my-plugins，官方源码只读 | 纯插件只使用已公开的 setFooter，不改宿主 |
| E8 | 本会话定向读取配置字段存在性：glm-000-gl→zai，当时无自身认证和配置 key | 未实测该实例；未输出凭据；不借用 zai 的认证 |

## E4 — Codex

设计调查时曾对 `codex-002` 发出一次 `GET https://chatgpt.com/backend-api/wham/usage`，返回 HTTP 200：primary.used_percent=34、limit_window_seconds=604800、secondary=null。实现后在 2026-09-23 以真实 Pi TUI 只加载本插件及原生 `openai-codex`，再单独加载 profiles 与 `codex-002`，两次均在费用后显示各自的 week 用量；具名实例与原生实例的百分比不同，未调用模型。这些数值均为当时样本，不是当前用量。

[官方客户端](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) 和 [测试](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/rate_limits.rs) 支持主额度、credits、additional_rate_limits 的 limit_name/metered_feature/rate_limit 结构。[本地 OAuth 实现](../../../packages/ai/src/auth/oauth/openai-codex.ts) 从 JWT 的 `https://api.openai.com/auth` **对象**中提取 `chatgpt_account_id`；已按该结构修正插件和回归测试。没有保存含身份的完整响应或凭据。

## E5 — Z.AI

[供应商查询脚本](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs) 在 api.z.ai/open.bigmodel.cn 上 GET `/api/monitor/usage/quota/limit`，Authorization 使用 authToken 原值；处理 TOKENS_LIMIT.percentage、TIME_LIMIT.currentValue/usage/usageDetails。其固定 5h/month 文案不作为本插件的窗口依据。

[OpenUsage client](https://github.com/robinebers/openusage/blob/main/Sources/OpenUsage/Providers/ZAI/ZAIUsageClient.swift) 在国际端点使用 Bearer；[mapper](https://github.com/robinebers/openusage/blob/main/Sources/OpenUsage/Providers/ZAI/ZAIUsageMapper.swift) 和 [样例](https://github.com/robinebers/openusage/blob/main/Tests/OpenUsageTests/ZAILiveResponseMappingTests.swift) 记录：

- TOKENS_LIMIT/CREDIT_LIMIT 的 percentage 是已用百分比。
- unit 3/4/5/6 分别为小时/天/月/周，number 为数量；nextResetTime 为毫秒。
- TIME_LIMIT：currentValue 是已用次数，usage 是限额。
- 新 CREDIT_LIMIT 响应可不含重置时间。

**本地只读实测（2026-09-23）：**`zai`、`zai-coding-cn` 及三个已配置的国际具名账号，对额度端点均无法得到有效 limits；内置两地区的响应为 HTTP 200、业务 `code=500, success=false`，消息匹配“当前用户不存在coding plan”。两地区的 `/api/biz/subscription/list` 均返回业务成功、空 data；三个具名国际账号亦为空。国际版 raw/Bearer 与国内版试 `?type=1` 均未把上述账号变为成功额度响应。只记录状态与形状，未保留或输出凭据/身份字段。这些账号没有在对应 API key 的已查询服务面呈现付费 Coding Plan；不排除其它服务面或国内团队上下文另有套餐。

国际 Bearer、国内原值认证分别有依据；不自动跨形式重试。[pi-glm-quota 的运行说明](https://pi.dev/packages/pi-glm-quota) 与 [CC Switch 团队套餐实现说明](https://github.com/farion1231/cc-switch/pull/5128) 报告：国内团队套餐的同一额度 URL 需 `?type=2` 和 `bigmodel-organization`、`bigmodel-project` 头；缺上下文可返回“当前用户不存在coding plan”或空 data。因此同一消息**不能单独判无套餐**：国际版须再从同一账号订阅列表确认空数组，国内版没有完整团队头仍保持错误而非错误隐藏。个人 `?type=1` 尚无目标账号成功证据，不能当万能回退。
