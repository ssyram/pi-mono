# provider-usage

纯 Pi 插件：用现有 `ctx.ui.setFooter()` 绘制统计行，在费用段后显示当前 provider 账号的套餐用量。footer 不重复右侧模型旁的 provider 名称；详细命令按当前模型的 provider 标识选账号。显式 GLM 团队配置优先，未关联时路由只看协议与端点；不感知 provider-profiles，不修改宿主。

## 支持范围 — 2026-10-15

**当前状态：纯插件已实现。GLM 团队全局设置只提供组织/项目，每个 provider 使用自己的原生认证 key 查询独立额度。32 项插件测试通过；2026-10-15 已在本机安装的真实 Pi 中逐个切换四个账号、运行详细查询及 `/reload`，确认 footer 按账号显示各自的 5h/week。未发起模型推理请求。**

| 首版范围 | 服务端点 | 用量内容 | 当前证据 |
|---|---|---|---|
| OpenAI Codex（`openai-codex`） | `chatgpt.com/backend-api` | 服务实际返回的额度窗口、已用百分比与可信额度字段 | 原生账号（无 profiles）与具名账号（有 profiles）各完成一次真实 TUI 查询；本地 mock 覆盖 |
| Z.AI 国际 Coding Plan（`zai`） | `api.z.ai/api/coding/paas/v4` | 窗口额度、工具调用额度等 | 当前 API key 的额度接口返回业务 500；同账号订阅列表成功为空，按不适用隐藏；有效额度仍仅 mock 覆盖 |
| Z.AI 国内 Coding Plan（`zai-coding-cn`） | `open.bigmodel.cn/api/coding/paas/v4` | 个人响应按已知 quota schema；团队需 `?type=2`＋当前账号 key/组织/项目 | 四把账号 key 带相同组织/项目已分别实测成功；全局关联的国际模型账号也可查询国内团队额度；个人额度成功响应仍待实测 |

表内 provider 标识用于说明服务类别，不是名称匹配规则。普通内置 provider 与任意具名实例走相同路径；例如 `codex-002` 显示自己的名称、使用自己的认证，不要求安装 profiles 插件。

未显式关联团队的任意代理地址、其它团队/组织协议及未来接口格式不自动涵盖在内。国际版与国内版分别适配，不假定二者所有字段和认证要求相同。

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

## GLM 团队配置

在全局 `<agent-dir>/settings.json`（默认 `~/.pi/agent/settings.json`）添加一个字段：

```json
{
  "provider-usage.glmTeams": [
    {
      "providers": ["zai-000-g-l", "zai-001-g-l", "zai-002-g-l", "zai-999-g-l"],
      "organization": "<组织 ID>",
      "project": "<项目 ID>"
    }
  ]
}
```

- 通过 `my-settings/index.ts` 自行初始化服务；仅查询 `scope: "global"`，默认 `[]`。不读项目覆盖或 session log，不保存 session 配置。
- `providers` 精确匹配运行时 provider ID；多个 ID 只共享组织/项目上下文，各账号额度独立，查询 key 分别由原生 registry 解析。多个团队用多个数组项表示，同一 provider 重复关联或条目不完整时报配置错误。
- 显式关联优先于模型协议/端点；读取当前模型的原生 apiKey，只向国内固定额度接口发送该 key 和两项团队头，不影响 profiles、auth.json 或模型推理请求。没有关联时维持原路径。
- 每次实际查询重新读取配置；手动 `/provider-usage` 可立即使用修改后的值，footer 仍按原有事件与 60 秒节流刷新。修改配置不会主动清空已有数值。
- 配置服务失败或条目校验失败：footer 为 ERR（已有数值则附 err），详情为 CONFIG；认证缺失显示 AUTH；团队额度请求失败或空响应不借用其它账号的 key。
- 此字段不再接受 `key`，旧配置中的共用 key 必须删除，否则显示 CONFIG；模型 key 沿用原生认证存储，不复制进团队字段。my-settings 顶层类型不符/坏文件仍按其公共协议诊断并忽略来源，可能回到默认空列表。

## 当前边界

- 只自动监控当前 provider；启动和模型切换立即查询，每个模型 `turn_end` 请求刷新（同一 provider 最多每 60 秒一次），闲置不轮询。同账号已有成功数值时刷新不显示 `…`；成功换新值，失败显示 `(旧值 (err))`。首次无值失败才显示 `(ERR)`；换账号不沿用旧值。右侧 thinking 读取宿主当前档位，不因 footer 重绘改变推理设置。详细查询命令不改变 footer。
- 未关联团队时使用原生认证解析；团队关联只读全局插件字段，不增加专属登录或 profiles 兼容配置。
- `setFooter()` 替换整个原生 footer，插件重建统计行；扩展 API 未暴露实时 `(auto)` 标记，插件不伪造它。另一自定义 footer 不能自动与本插件并存。
- HTTP 200＋`success:false` 是业务拒绝，**不是已用 100%**。当前内置两地区及三个具名国际 key 的订阅列表均为空；其它服务面（如 ZCode）不能从这些 API key 自动推断。
- 团队使用上述显式配置，或沿用模型原生认证中成对的 `bigmodel-organization`、`bigmodel-project`；不猜组织/项目。个人 `?type=1` 尚未获成功实测证据，不作默认猜测。
- 具名 profiles 与同名 models.json 的 headers 存在冲突，因此不以配置模型 headers 作为团队接入办法。插件仍不依赖 profiles。
- Z.AI 国际及国内个人套餐的有效额度响应仍待实际账号验证；团队查询成功不扩大为所有套餐均已实测。

完整设计：[Q](docs/principles.md)、[Architecture](docs/architecture.md)、[函数级 Detail](docs/detail.md)、[证据](docs/evidence.md)、[完成门](docs/correctness.md)。

实现或支持范围变化时，应同时更新本节日期、能力状态和证据，不把“有设计”“有外部样例”“本账号实测成功”混为一谈。
