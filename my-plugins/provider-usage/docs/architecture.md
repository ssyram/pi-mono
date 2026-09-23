# Architecture — 纯插件用量监控

上游：[Q](principles.md)；全部实现限定在 `my-plugins/provider-usage/`。此文为候选设计，函数级合同见 [detail.md](detail.md)。

## P — 根性质

| ID | 可判定要求 | 来源 |
|---|---|---|
| P1 同实例 | 名称取当前 `model.provider`，认证用该模型的 registry 解析；旧选择不得覆盖新选择 | Q.I.1/3 |
| P2 识别 | 只按模型 API 协议和精确服务端点选择 Codex、Z.AI 国际或国内；其它显示 N/S，不根据实例名推测 | Q.I.3/7 |
| P3 内容 | 每家解码、格式化自身响应；窗口由响应确定，不补造零或时间窗 | Q.I.4 |
| P4 位置 | 费用后只显示不带 NAME 的短格式，有额度状态时取代 `(sub)`；重置时间和解析提示留给命令，原 token/cost/context 数值不变 | Q.I.5 |
| P5 状态 | 确认无套餐→隐藏；未支持→N/S；认证/查询/格式错误→可见错误，不互相代替 | Q.I.6 |
| P6 边界 | 纯插件、自动监控只查当前账号、不自动轮换或持久化凭据、事件回调不等待网络 | Q.I.1/2/7 |
| P7 按需查询 | 命令按当前／运行时可用全部／显式名称查询；详情按账号输出，多参数 Tab 可补全 | Q.I.8 |
| P8 刷新稳定 | 同账号已有成功值时刷新期间保留；成功换新值，失败显示 `旧值 (err)`；首次无成功值失败则只显示错误；换账号不沿用旧值 | Q.I.9 |

**Global P（全部组件）：**不得 import、检测、读取或依赖 provider-profiles；认证与原始服务响应不得进入 footer/日志/磁盘；共享可变状态只属于当前会话，不使用跨会话全局缓存。

## M — 组件、数据及接口

```
ExtensionContext.model → captureSelection → route(api,baseUrl)
                                  │ supported
                                  ↓
                registry.getApiKeyAndHeaders(model)
                                  ↓
              当前账号的固定域名 GET → adapter.parse → adapter.format
                                  ↓
                     controller 的当前世代门
                                  ↓
             ctx.ui.setFooter(自有 Component) → render
```

| 组件 | Contract | 函数级位置 |
|---|---|---|
| Selection/router | 同步取得当前 model、providerId、协议及有效端点；精确匹配三路由 | [detail §1](detail.md#1-选择与认证) |
| Auth/HTTP | 用同模型认证访问固定服务域；国际版业务失败需确认套餐归属时允许同域第二次 GET；认证覆盖地址重判，不跨账号回退 | [detail §1–2](detail.md#2-http-边界) |
| Adapters | Codex/Z.AI 国际/国内各自返回已格式化用量或明确业务状态 | [detail §3](detail.md#3-供应商适配) |
| Controller | TUI 会话生命周期、限频、单查询、取消、当前结果发布 | [detail §4](detail.md#4-控制器与入口) |
| Footer | `ctx.ui.setFooter()` 重建统计行，用量短格式取代 `(sub)` | [detail §5](detail.md#5-纯插件-footer) |
| Command | 从运行时枚举 provider，逐个直接查询详细结果；自然参数补全和强制 Tab 共用候选 | [detail §6](detail.md#6-按需查询命令) |

### 跨组件数据（仅此处定义）

| 类型 | 内容、生产者→消费者 | 约束 |
|---|---|---|
| `Selection` | sessionId、model 快照、providerId=model.provider、api、endpoint；capture→router/controller | 不含凭据；一次事件同步捕获 |
| `Route` | codex / zai / zai-cn / unsupported；router→controller | 不按 providerId 匹配；无套餐不是 route |
| `RequestAuth` | 授权 header、Codex accountId、国内团队可选 organization/project、effectiveEndpoint；auth→query | 临时单 job；认证覆盖地址复判为相同 route 才可请求；组织头必须成对来自当前模型认证 |
| `UsageResult` | available(text, compact) / not-applicable / unsupported / error(auth/timeout/network/http/invalid-response)；adapter→controller/command | text 为详细文本，compact 为不含重置/解析提示的短文本；两者不含名称、凭据 |
| `DisplayState` | empty / loading(selection) / ready(selection,result,staleError?)；controller→footer | 只发布当前世代；失败时若当前账号有 available 则保留其数值并标 err；跨账号清空 |

**footer 显示映射：**empty/not-applicable 无用量片段；loading=`(…)`；available=`(<adapter compact>)`；旧值错误=`(<adapter compact> (err))`；unsupported=`(N/S)`；auth=`(AUTH)`；timeout=`(TIMEOUT)`；其它错误=`(ERR)`。非空用量片段取代 `(sub)`；右侧模型旁已显示 provider。命令仍按账号名称读取 `text`，不截掉有用详情。

### 供应商路由

| API | 精确模型端点 | 固定额度 GET |
|---|---|---|
| `openai-codex-responses` | `https://chatgpt.com/backend-api` | `https://chatgpt.com/backend-api/wham/usage` |
| `openai-completions` | `https://api.z.ai/api/coding/paas/v4` | `https://api.z.ai/api/monitor/usage/quota/limit` |
| `openai-completions` | `https://open.bigmodel.cn/api/coding/paas/v4` | `https://open.bigmodel.cn/api/monitor/usage/quota/limit` |

HTTPS、host、端口、pathname 规范化后全量匹配；不因同协议、相似域名或具名 provider 猜供应商。国内团队若当前模型认证同时提供 organization/project 头，则额度 URL 加 `?type=2` 并带这两头；缺一头不能当个人套餐查询。当前无头的国内请求维持原端点，未获证的个人 `?type=1` 不自动添加。国际版遇到精确 `code=500, success=false, msg="当前用户不存在coding plan"` 才用同账号 `subscription/list` 成功返回空数组来确认此 API key 不适用；其它失败保留 ERR。

## 原生 footer 数据边界

[原生实现](../../../packages/coding-agent/src/modes/interactive/components/footer.ts) 不提供追加插槽；`setStatus` 另起一行；`setFooter` 完整替换组件。不能直接实例化公开的 `FooterComponent`：其构造要求插件拿不到的 `AgentSession`。纯插件须实现自己的 `Component.render(width)`，用公开接口读 `sessionManager.getEntries()`、`getContextUsage()`、`ctx.model`、`ctx.thinkingLevel`、`footerData.getGitBranch()/getExtensionStatuses()/getAvailableProviderCount()`，用回调 `theme` 及 `pi-tui` 宽度函数排版。

复制原生统计的**现有语义**（usage entries、assistant、带 usage 的 toolResult、branch_summary/compaction；cache hit 只取最后一条 assistant）。没有用量片段时仍按原生条件保留 `(sub)`（`kimi-coding`，或 OAuth＋`isSubscription`）；有用量状态时以短片段取代 `(sub)`，不并列打印。`PI_EXPERIMENTAL=1` 时保留 xp。两行基线和 status 第三行按原生格式重建；theme/宽度处理按原生算法。

**不能保证完全相同的字段：**原生 footer 内部的实时 `autoCompactionEnabled` 没有扩展 getter/事件；插件不显示 `(auto)`，不能写死为开启或关闭。其它扩展的自定义 footer 也不能与本插件合并（`setFooter` 是独占替换）。这两项是真实纯插件边界，不虚构读取私有字段、不能反向要求宿主改源码。若用户把 `(auto)` 的保留也视为硬条件，需要另行取舍；本设计不悄悄伪造该状态。

## R — 接口与整体正确性

**Derivation：**Q.I.2 排除 profile bridge；Q.I.3 分离名称/路由；Q.I.4 排除固定百分比结构；Q.I.5 要求费用后短格式取代 `(sub)`；Q.I.6 排除把失败当“无套餐”；Q.I.8 要求独立详细命令与多名称补全。

**Composition：**Selection 后置的 model、api、endpoint 满足 route/auth 前置；auth 复判使 query 固定域与同实例认证一致；adapter 产出详细及短文本；controller 的世代门保证自动结果属于当前账号，同账号等候时不清空已有显示、失败仅对同账号旧成功值加 err、换账号清空；footer 仅取短文本；命令逐个读取显式选择的详细文本，不改变当前模型或 footer。组件合起来满足 P1–P8。

| 不变量 | 谁保持 |
|---|---|
| 身份、认证、显示属于同一个当前选择 | capture 同快照；认证同 model；controller 世代门；footer 从同一个 DisplayState 取 name/text |
| 凭据不送到未知服务 | 完整端点路由、认证后同 route 复判、固定额度/国际订阅列表 URL、禁止 redirect；团队头只随国内额度 URL 发送 |
| N/S / 不适用 / 失败不混淆 | router 只产 unsupported；业务解析才产 not-applicable；错误返回 error；footer 按变体映射 |
| 原生用量不和套餐用量混算 | footer 统计来自 session entries；额度仅作为费用后的独立片段 |

**SCCO：**Sound 依赖公开 API、Codex 成功实测及 Z.AI 当前账号的业务失败/空订阅列表实测；它们不证明 Z.AI 成功额度路径已现场验收。Complete 涵盖三路由、选择与退出、业务状态和原位显示；国内无团队上下文时的套餐归属仍无法证实。Concise 不增宿主 API、kind 字段、profile adapter、历史库或统一 metrics schema。Optimality：setFooter 是现有唯一能在纯插件内控制目标行位置的 API，代价是自维护复制的 footer 统计及上述不可观测字段边界；这些不由局部接口的可用性推导为无代价。

## 首版完成门

实现仅修改 `my-plugins/provider-usage/`；按 [detail.md](detail.md) 实现每个函数及直接功能测试。Codex、Z.AI 国际、国内分别使用自己的账号做脱敏真实查询；未取得确证的无套餐响应不实施关键词猜测，回到 adapter 合同补证据。此处不生成代码、不开展独立审查。
