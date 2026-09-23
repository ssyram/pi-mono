# 设计证据 — 2026-09-23

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
