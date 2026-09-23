# provider-usage

纯 Pi 插件：用现有 `ctx.ui.setFooter()` 绘制统计行，在费用段后显示当前 provider 账号的套餐用量。footer 不重复右侧模型旁的 provider 名称；详细命令按当前模型的 provider 标识选账号。路由只看协议与端点，不感知 provider-profiles。不修改宿主。

## 支持范围 — 2026-09-23

**当前状态：纯插件已实现，当前扩展目录已有入口；本轮未替用户 `/reload`。2026-09-23 实测 Codex 有效额度；Z.AI 两个团队具名 key 的 `?type=2` 响应为空对象，缺组织/项目上下文，不能宣称团队额度已接通。未发起模型推理请求。**

| 首版范围 | 服务端点 | 用量内容 | 当前证据 |
|---|---|---|---|
| OpenAI Codex（`openai-codex`） | `chatgpt.com/backend-api` | 服务实际返回的额度窗口、已用百分比与可信额度字段 | 原生账号（无 profiles）与具名账号（有 profiles）各完成一次真实 TUI 查询；本地 mock 覆盖 |
| Z.AI 国际 Coding Plan（`zai`） | `api.z.ai/api/coding/paas/v4` | 窗口额度、工具调用额度等 | 当前 API key 的额度接口返回业务 500；同账号订阅列表成功为空，按不适用隐藏；有效额度仍仅 mock 覆盖 |
| Z.AI 国内 Coding Plan（`zai-coding-cn`） | `open.bigmodel.cn/api/coding/paas/v4` | 个人响应按已知 quota schema；团队需 `?type=2`＋两项上下文头 | 当前 key 返回业务 500；模型认证未提供组织/项目头，团队路径只完成 mock，未实测成功 |

表内 provider 标识用于说明服务类别，不是名称匹配规则。普通内置 provider 与任意具名实例走相同路径；例如 `codex-002` 显示自己的名称、使用自己的认证，不要求安装 profiles 插件。

上述范围不自动涵盖任意代理地址、团队/组织套餐的额外协议，或未来接口格式。国际版与国内版分别适配，不假定二者所有字段和认证要求相同。

## 显示行为

- 支持且查询成功：在费用后用 `(百分比(周期))` **取代 `(sub)`**，例如 `(72%(week))`；右侧已有 provider 名称，左侧不重复，不显示重置时间或解析提示。
- 国际版仅在精确业务失败**且同一账号**订阅列表确认为空时，不显示；其它未知响应仍为错误。国内相同失败文案不足以排除团队套餐，不擅自隐藏。
- 未支持的服务：显示 `(N/S)`，例如首版范围外的 Claude、DeepSeek。
- 已支持但认证缺失或查询失败：显示失败状态，不冒充 `N/S`，也不当成“非套餐”隐藏。

例如，以下仅说明位置与格式，数值不是实时状态：

```text
↑109k ↓7.8k R775k CH98.5% $2.256 (72%(week)) 23.0%/272k …
```

## 详细查询

```text
/provider-usage                       # 立即查询当前 provider
/provider-usage --all                 # 逐个查询运行时可用的 provider
/provider-usage codex-002 codex-001  # 只查询指定账号
```

详情逐账号显示已用方向、实际窗口、重置时刻及服务确有的其他额度信息；支持对多参数中的 provider 名称按 Tab 补全（包括输入空格后直接按 Tab）。命令不更改当前模型，也不把结果发送给模型。

## 当前边界

- 只自动监控当前 provider；启动和模型切换立即查询，每个模型 `turn_end` 请求刷新（同一 provider 最多每 60 秒一次），闲置不轮询。同账号已有成功数值时刷新不显示 `…`；成功换新值，失败显示 `(旧值 (err))`。首次无值失败才显示 `(ERR)`；换账号不沿用旧值。右侧 thinking 读取宿主当前档位，不因 footer 重绘改变推理设置。详细查询命令不改变 footer。
- 使用原生认证解析，不增加用量插件专属登录或 profiles 兼容配置。
- `setFooter()` 替换整个原生 footer，插件重建统计行；扩展 API 未暴露实时 `(auto)` 标记，插件不伪造它。另一自定义 footer 不能自动与本插件并存。
- HTTP 200＋`success:false` 是业务拒绝，**不是已用 100%**。当前内置两地区及三个具名国际 key 的订阅列表均为空；其它服务面（如 ZCode）不能从这些 API key 自动推断。
- 国内团队套餐只有在当前模型的原生认证同时提供 `bigmodel-organization` 和 `bigmodel-project` 时才查询 `?type=2`。插件不读取 profiles，也不会凭 API key 猜组织/项目；当前账号没有这两个头，因此国内仍可能显示 ERR。个人 `?type=1` 尚未获成功实测证据，不作默认猜测。
- 团队套餐额度容后再议：目前无法仅凭这两把团队 key 读到非空额度，也没有团队账号专用的组织/项目配置入口。具名 profiles 与同名 `models.json` 的 `headers`（含 modelOverrides.headers）冲突；不能按先前建议在那里配头。插件仍不感知 profiles。
- Z.AI 两地区的有效额度响应尚待实际账号验证；未发布安装说明。

完整设计：[Q](docs/principles.md)、[Architecture](docs/architecture.md)、[函数级 Detail](docs/detail.md)、[证据](docs/evidence.md)、[完成门](docs/correctness.md)。

实现或支持范围变化时，应同时更新本节日期、能力状态和证据，不把“有设计”“有外部样例”“本账号实测成功”混为一谈。
