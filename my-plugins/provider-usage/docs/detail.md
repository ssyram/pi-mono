# Detailed Design — 可直接实现的纯插件合同

以 [architecture.md](architecture.md) 的 P/共享类型为准。这里只指定函数签名、调用关系、分支、退出、副作用与 pre→post；全部文件位于 `my-plugins/provider-usage/`，`index.ts` 仅 re-export。各模块控制在 200 LOC（不计空行和注释），超出时按具体职责拆文件，不建 utils/helpers 桶。没有宿主文件改动。

建议顺序：纯解析/格式化 → HTTP/认证 → controller → footer → 入口与直接功能测试。标为“待证”的业务分支不能凭猜测写成已实现。

## 1. 选择与认证

### `captureSelection(ctx, model = ctx.model): Selection | undefined` — `selection.ts`

Caller：session_start/model_select/turn_end 的同步事件体；model_select 显式传 `event.model`。Callees：`ctx.sessionManager.getSessionId()`、`ctx.modelRegistry.getProvider(model.provider)`。Pre：有效的本会话 context；不得在 await 后用旧 context 重采选择。

无 model，或 Pi 的无可用模型占位符 `provider=id=api="unknown"`→undefined。其余模型取得 model.provider（NAME）、model.api、优先 model.baseUrl、否则 provider.baseUrl；缺失/非法端点由 `route()` 返回配置错误而非从 provider 名称补猜。返回持有同一 model 的 Selection，供认证和展示共用。Post：providerId=model.provider，同一个同步事件的快照；只读，无循环。同步快照排除“新名字＋旧认证”的拼接。

### `route(selection, effectiveUrl = selection.endpoint): Route | error(invalid-response)` — `route.ts`

Caller：controller 初选、认证后复判。Callee：URL parser、[三行路由表](architecture.md#供应商路由)。Pre：Selection 存在。

URL 解析失败、缺失、非 HTTPS、有 userinfo/query/fragment、非默认端口→invalid-response；规范化尾 `/` 后比较完整 origin/path＋api。命中唯一项→该 adapter；其它合法地址→unsupported。Post：只依赖 api 与 endpoint，不依赖 providerId、provider.name、profiles 的有无；纯函数。三行互斥、有限比较保证确定性；不对开放代理猜底层公司。

### `resolveAuth(selection, route, registry, signal): Promise<AuthResult>` — `auth.ts`

Caller：`executeQuery`；callees：`registry.getApiKeyAndHeaders(selection.model)`、`route`、`codexAccountId`。Pre：route 是 supported；signal 来自该 job，不用 ctx.signal 代替（它可能只属于当前 agent turn）。

1. 已 abort→cancelled；否则调用宿主模型认证。拒绝或 ok=false→error(auth)，不传播原错误消息。
2. await 后再检查 abort；取消则不启动额度 GET。
3. 认证若给 baseUrl，以此覆盖模型端点并重新 `route`；只有 route 仍是原 adapter 才能继续，否则 unsupported；非法覆盖→invalid-response。
4. Authorization header 不区分大小写优先使用；否则按 adapter 规则从 apiKey 构造：Codex/Z.AI 国际 Bearer，国内原值。没有→error(auth)。其它自定义 headers 默认不转发到额度端点。
5. Codex 必须取得当前 token 的 account id；缺失→error(auth)；发送 `ChatGPT-Account-Id`。国内仅识别当前模型认证的 `bigmodel-organization`、`bigmodel-project`：两者非空才同时保留以查询团队额度；只出现其一→unsupported，不能静默查询个人账号。国际版出现组织/项目选择头仍 unsupported。
6. 成功返回仅本 job 使用的 RequestAuth：所需 header、accountId（Codex）、复判后的 endpoint；不放进 controller 长期状态。

Post：成功则凭据与 selection 同源、服务未改变；失败/取消均不发额度请求。副作用仅宿主既有认证解析/可能刷新；无手读 auth/profile。一次 await、有限分支。接口论证：解析后重新路由是“先判类别”与“随后取得实际请求认证/端点”之间必要的桥，防止凭据被错误带向别的域。

### `codexAccountId(authorization, resolvedHeaders): string | undefined` — `codex-account-id.ts`

Caller：resolveAuth；callee：本地 base64url/JSON 解码。Pre：当前选择的认证。非空 ChatGPT-Account-Id header 优先；否则 Bearer JWT 的第二段 payload 中取 `https://api.openai.com/auth` 对象中的 `chatgpt_account_id`；非法/缺失→undefined，绝不输出原 token。解码只读取 account id，不验证 JWT 签名或 entitlement。有限解析、无 IO；所得值只用于同实例 quota header。

## 2. HTTP 边界

### `requestJson(url, headers, signal): Promise<json(unknown) | error(code) | cancelled>` — `usage-http.ts`

Caller：三个 adapter query。Callee：`fetch`、`Response.json()`。Pre：URL 是路由表固定额度 URL、国内团队该 URL 的 `?type=2`，或国际版固定订阅列表 URL；headers 仅为当前模型认证中对应端点必需的字段；controller 为整 job 设 15 秒截止。

- signal 已取消→cancelled；否则一次 GET，Accept: application/json，redirect: error，no body。不得把 token 放 URL。
- fetch 抛错：signal.aborted→cancelled，其他→error(network)。HTTP 401/403→error(auth)，其它非 2xx→error(http)；3xx 不跟随。
- 2xx JSON 解码失败→error(invalid-response)；成功→json(unknown)，不能把 200 当作成功套餐。

Post：每次调用最多一次 GET，无登录、重试、地区回退、日志原文；仅国际版额度业务失败且精确匹配时，adapter 可在同一 job 中再发一次同域订阅列表 GET。共享 15 秒截止，失败不再重试；远端是否收到超时请求未知。

**网络接口七项合同：**单逻辑 GET、连接由 runtime 管；15 秒 job 可见截止（认证/HTTP 均含）；插件零重试；远端交付 best-effort、仅当前世代本地发布；网络/HTTP/JSON/业务失败分开；每次请求自带宿主认证、无插件远端会话；controller 单 job/单 latestPending 提供背压。没有 exactly-once 承诺。

## 3. 供应商适配

各 adapter 返回 `UsageResult | cancelled`，成功文本不含 NAME/外层括号。Parser 的参数一律 `unknown`，验证后才使用；formatter 的输入是私有已验证结构。数组遍历均以有限 JSON 数组长度为上界，每步消费一项。

### `parseCodexWindow(value, label): Window | absent | invalid` — `codex-window.ts`

Caller：parseCodex；无副作用。null/undefined→absent；其它必须是对象，used_percent 为有限且 0–100 的数，limit_window_seconds 若存在须正整数秒，reset_at 若存在须有效秒时间戳。非法→invalid，绝不 clamp；没有时长时保留“主/次窗口”标签。成功的 Window 有已用方向，不包含账号身份。有限字段判断保证 post。

### `parseCodex(value: unknown): CodexUsage | invalid` — `codex-usage.ts`

Caller：queryCodex；callee：parseCodexWindow。根非对象→invalid。按顺序读取 rate_limit、code_review_rate_limit 及 additional_rate_limits 的窗口；容器 null/缺失跳过，存在但结构错误或非 null 窗口缺必需百分比→invalid。附加额度 label 取 limit_name，其次 metered_feature，再退至本地“附加额度”；不同组不相加。credits.has_credits=true 时读取明确 unlimited 或非负 balance；没有可信货币单位不显示美元标识；false 且余额零则略过，矛盾数据→invalid。至少一个有效窗口/credit 才成功；空则 invalid，不推断无套餐。非空未解析的 quota 结构标 partial，原始身份字段忽略。

Post：每个输出组有对应合法输入、顺序不变，不伪造 null secondary 为 0。循环不变量是“已处理前缀的每个成功项均有已验证字段”；有限组数保证终止；无 IO。Q.E.1 的 primary=604800 秒反证固定 5h 推断。

### `formatCodex(data: CodexUsage): string` — `codex-display.ts`

Caller：queryCodex。逐组显示 `已用 34%(week)` 等；18000 秒=5h，604800 秒=week，其余只在整数单位精确表示时缩写，否则保留秒；未知时长用窗口标签。审查/附加额度保留组名，credits 追加“额度 <值>”或“不限量”，有效 reset_at 可显示绝对 ISO 时间；无值则不写。partial 追加“部分信息未解析”。服务 label 去控制字符；输出非空单行且不包含 NAME。有限遍历终止；每项来自已验证结构，不进行业务猜测。

### `formatCodexCompact(data: CodexUsage): string` — `codex-display.ts`

Caller：queryCodex。只保留主额度的实际窗口与已用百分比：`72%(week)` 或 `12%(5h), 72%(week)`；无主窗口则取首个已验证附加额度并带标签，无窗口但有 credits 则简写额度。绝不加入重置时刻、partial 或其它段落；时间长度仍由窗口秒数决定。返回非空单行；有限窗口遍历、无副作用。详细格式由 formatCodex 独立保持。

### `queryCodex(auth, signal): Promise<UsageResult | cancelled>` — `codex-query.ts`

Caller：executeQuery；callees：requestJson→parseCodex→formatCodex。Pre：route=codex、同实例 Bearer＋accountId。固定 GET `https://chatgpt.com/backend-api/wham/usage`，附 ChatGPT-Account-Id；HTTP 错误/取消直通，解析非法→error(invalid-response)，否则→available(text=formatCodex, compact=formatCodexCompact)。plan_type=free、无 rate_limit 或 credits=0 均不足以断言非套餐。一次请求、无额外状态；callee 后置逐项满足下一 callee 前置。

### `parseZaiQuota(value: unknown, region): ZaiQuota | invalid` — `zai-quota.ts`

Caller：queryZai/queryZaiCn。Pre：任意 JSON，region 是已固定的国际/国内入口。

1. 根非对象或 success=false→invalid。国际版在调用 parser 前只对 `success=false, code=500, msg="当前用户不存在coding plan"` 做精确候选判断；国内缺团队参数也可返回同文案，不能直接当 no-plan。
2. code 存在须表示成功（已知 code=200）；从 data.limits 或已见裸 limits 取数组，缺失/非数组/空数组→invalid，不是 no-plan。
3. 每行 type（缺失时接受 name）为 TOKENS_LIMIT/CREDIT_LIMIT 时，percentage 必须是有限 [0,100] 已用百分比；TIME_LIMIT 时 currentValue 和 usage 必须是有限非负数，分别为已用次数、总额；允许真实超额，零总额不做除法。
4. unit 3/4/5/6 为小时/天/月/周，number 若已知单位须正整数；缺失或未知单位标“周期未知”，不把月近似成 30 天。nextResetTime 存在时须为有效毫秒时间戳；TIME_LIMIT 的 usageDetails 若存在须按 modelCode/usage 验证，否则 invalid。
5. 未知类型若与合法行并存，设置 partial；全是未知类型→invalid。已知类型缺必需数值→invalid，不跳过。

Post：成功至少一个合法行、顺序/单位/已用方向保持；失败不推断套餐归属；无副作用。先验证业务 envelope、后解码每行，故不会把 200/error 或空列表解释为非套餐。循环有限且逐项推进。

### `formatZaiQuota(data, region): string` — `zai-display.ts`

Caller：queryZai/queryZaiCn。按服务顺序输出 `已用 17%(5h), 3%(week)`、`工具 12/1000(month)` 等；有效 reset 显示 ISO 绝对时间，分项仅在有合法 modelCode/usage 时追加；重复周期的不同类型要加类型标签，不能合并。partial 标“部分信息未解析”。不输出服务原文/账号标识。返回非空单行；有限遍历，每个显示值来自合法行。

### `formatZaiCompact(data: ZaiQuota): string` — `zai-display.ts`

Caller：两区域 query。只取至多两个已验证百分比窗口，格式为 `17%(5h), 3%(week)`；若只有次数额度，取首个计数段 `工具 12/1000(month)`。相同周期、不同类型须有短标签避免冒充同一额度。省略重置、工具分项和 partial；不更改已用方向与单位。有限遍历，非空单行；详细文本仍由 formatZaiQuota 负责。

### `isZaiNoPlanResponse(value: unknown): boolean` — `zai-no-plan.ts`

Caller：queryZai。仅当 `success===false`、`code===500` 且 trim 后的 `msg` **恰为** `当前用户不存在coding plan` 返回 true；不匹配其它字符串，尤其不把任意含 coding plan 的错误当无套餐。纯函数；此结果只是二次查询候选，不是最终判定。

### `queryZai(auth, signal)` / `queryZaiCn(auth, signal)` — `zai-query.ts` / `zai-cn-query.ts`

Caller：executeQuery；callees：requestJson→parseZaiQuota(region)→formatZaiQuota。国际额度 URL 固定、默认 `Bearer <key>`；国内无团队头维持旧额度 URL、默认 key 原值，有完整团队头时加 `?type=2` 并只随该请求发送这两头。显式 Authorization 尊重宿主结果。正常 quota 解码后→available(text,compact)。国际版遇到上述精确业务失败时，再 GET `https://api.z.ai/api/biz/subscription/list`：只有 HTTP/业务成功且 `data` 确认是空数组才 not-applicable；非空/未知结构仍 error(invalid-response)。国内版同文案不判无套餐。两次 GET 共用一个 signal/15 秒截止，不试另一区域或认证形式；任何失败不借另一个账号结果。

## 4. 控制器与入口

**私有状态** `Controller`：sessionId、selection?、generation、disposed、display、activeJob?、latestPending?、lastAttemptAt?、wakeTimer?、TUI?。`activeJob` 包含 generation、Selection、AbortController、15 秒 deadline timer、timedOut。state 只在该会话 controller 内；至多一个物理未 settle job 和一个覆盖式 pending。全局没有 session→controller Map。

### `register(pi): void` — `provider-usage-extension.ts`

Caller：扩展加载器；callee：pi.on、createController、controller 方法。factory 阶段只注册事件；非 TUI 的 session_start 不安装 footer、不查网、不设 timer。TUI session_start 建 controller 并安装 `ctx.ui.setFooter(factory)`，从 ctx.thinkingLevel 初始化显示；model_select 用 event.model 并同步 ctx.thinkingLevel，thinking_level_select 同步更新显示用快照；turn_end 先同步 ctx.thinkingLevel 再请求刷新；session_shutdown dispose。所有 handler 立即返回，不把 HTTP Promise 交给串行事件链；异步拒绝在 controller 内处理。注册次数有限，无跨会话静态可变状态。导出默认函数在自己的入口文件，index.ts 只 re-export。

### `createController(ctx): Controller` — `usage-controller.ts`

Caller：register 的 TUI session_start；callee：createUsageFooter、requestRefresh。Pre：会话 ready。创建本会话状态和 footer 组件；初次同步捕获 selection、开始刷新。Post：footer 工厂闭包只引用该 controller、会话 manager/registry/TUI，未捕获永久冻结的 ctx.model 值；以后 model_select/turn_end 更新选择快照。副作用限于安装组件和异步请求；有限初始化。

### `requestRefresh(controller, ctx, modelOverride?): void` — `usage-controller.ts`

Caller：session_start/model_select/turn_end/尾随 timer；callee：captureSelection、route、startJob。Pre：有效会话；disposed 时直接返回。

- 同步捕获新选择；model_select 即使标识相同也 generation++，取消旧 job、清旧数值，重置选择的限频。其它事件若 sessionId/providerId/modelId/api/endpoint 变化亦做相同动作；同选择 turn_end 保持世代与现有显示值；后台开始不写 loading。
- 无模型→empty；非法端点→ERR；合法未匹配→N/S。三者清 pending，不调认证。
- supported→覆盖 latestPending；同账号已有 ready 显示则不改成 loading，首次/新账号无值才显示 loading。activeJob 仍未 settle 时不启动第二个；超时有本账号旧成功值时显示 `旧值 (err)`，首次无值仍走 TIMEOUT。
- 无 active：若距 lastAttemptAt≥60 秒或新选择首次尝试→startJob；否则设置唯一 unref 的 wakeTimer 于到期时重调当前 pending。timer 不使用旧事件 ctx 重采会话。

Post：旧选择立即不可显示、pending≤1、active≤1；只启动本选择当前请求。所有本地分支有限，副作用只有状态/UI/timer/abort。

### `startJob(controller): void` — `usage-controller.ts`

Caller：requestRefresh/timer/finishJob。Pre：未 disposed、无 active、有当前 pending、限频已允许。取并清 pending、记 attempt 时间，建立 job＋unref 15 秒 timer；已有本账号 ready 显示时不写 loading，否则显示 loading；启动 `executeQuery(job)` 的 detached Promise；显式 `.then/.catch/.finally`，任何拒绝→ERR，不抛进事件链。Post：一个活动 job，调用立即返回。无循环。

### `executeQuery(job): Promise<UsageResult | cancelled>` — `usage-query.ts`

Caller：startJob；callees：resolveAuth、对应 queryCodex/queryZai/queryZaiCn。Pre：job 有固定 Selection、route、私有 signal。认证失败/unsupported/cancelled直通；成功后再检查 signal，再调用该 route 唯一 adapter；adapter 结果直通。异常交给 startJob 的 catch。Post：通常一次额度 GET；国际 Z.AI 在精确业务失败后可再查一次同域订阅列表；无 UI 写入、不保存凭据。认证可能触发宿主原生刷新。

### `onDeadline(controller, job): void` — `usage-controller.ts`

Caller：15 秒 timer。Pre：该 job 尚未 settle。置 timedOut、abort；当前 generation 仍按原错误路径显示 TIMEOUT。**activeJob 仍占槽直到 Promise settle**：宿主认证方法没有 abort 参数，提前释放会累积后台认证。任何晚来的 success 永远不能发布。常数步；副作用为状态/abort/UI。

### `finishJob(controller, job, result): void` — `usage-controller.ts`

Caller：job 完成／catch／finally。若 `!disposed && generation===job.generation && !job.timedOut && !job.signal.aborted`，available 换新值；not-applicable 清空；error 若当前账号已有 available，则保留该结果并附 `staleError`，否则显示原错误状态。cancelled/旧世代丢弃。finally 清 job timer、仅在 activeJob===job 时释放槽；若当前 pending 存在则启动或安排 60 秒尾随 timer。已 dispose 不写 UI。检查到写状态之间无 await，故当前世代不会被同步事件插入更改；job 身份检查阻止旧 finally 清理新 job。

### `dispose(controller): void` — `usage-controller.ts`

Caller：session_shutdown。幂等：先 disposed=true、generation++，清 wake/deadline timers、abort active、清 pending/display、取消 footer 的 branch 监听；不等待宿主认证。Pi session reset 自行还原默认 footer，dispose 不盲目 `setFooter(undefined)` 覆盖别的扩展。迟到完成因世代/标志不得写 UI。有限同步操作。

## 5. 纯插件 footer

**事实：**`setFooter((tui, theme, footerData) => Component)` 完整替换原 footer；`footerData` 提供 branch、extension statuses、provider count 和 branch 变更监听；`ctx.sessionManager.getEntries()` 提供累计 usage；`ctx.getContextUsage()` 提供 context；`ctx.model` 是事件快照，不能永远保留启动值。[原生 FooterComponent](../../../packages/coding-agent/src/modes/interactive/components/footer.ts) 构造依赖不可从插件取得的 AgentSession，不能直接包装它来“插个字符串”。

建议文件：`footer-usage.ts`（聚合）、`footer-stats.ts`（左侧）、`footer-layout.ts`（布局）、`footer-path.ts`（路径）、`footer-component.ts`（生命周期）；均仅一责任、各 ≤200 LOC。`@earendil-works/pi-tui` 导入 `visibleWidth`、`truncateToWidth`，主题从 setFooter 工厂回调获得。不得从私有源码深路径 import。

### `collectSessionTotals(entries): {input,output,cacheRead,cacheWrite,cost,latestCacheHitRate?}` — `footer-usage.ts`

Caller：render；callee：sessionManager.getEntries。Pre：当前会话的全量 entries。初始化全零；遍历每条：type=usage 加 usage；message.role=assistant 加 usage 并以 `(cacheRead/(input+cacheRead+cacheWrite))*100` 更新最后有效 prompt 的 CH（prompt 总数为零时置 undefined）；message.role=toolResult 且有 usage 加；branch_summary/compaction 有 usage 加；其它略过。cost 加各 usage.cost.total，不能只读 branch，不能把查询结果计入 token。Post：与原 footer 相同范围/求和；有限 entries 每步推进，累计不变量为已处理前缀之和；纯函数。

### `formatTokens(n): string` — `footer-stats.ts`

Caller：formatStats/formatContext。Pre：非负数。`<1000` 原数；`<10000` `(n/1000).toFixed(1)+'k'`；`<1000000` `Math.round(n/1000)+'k'`；`<10000000` `(n/1000000).toFixed(1)+'M'`；否则 `Math.round(n/1000000)+'M'`。按原生顺序比较，不改舍入；纯函数、常数步。

### `formatStats(totals, model, registry, usageText, context, thinkingOptions): StatsParts` — `footer-stats.ts`

Caller：render；callees：formatTokens、formatDisplayState。Pre：当前会话的 totals、当前 model 快照、provider registry 与 controller display。

按原生规则仅非零时添加 `↑input ↓output RcacheRead WcacheWrite`；`cacheRead>0 || cacheWrite>0` 且有最新有效 prompt 时添加 `CHxx.x%`。`usingSubscription = model.provider==='kimi-coding' || (registry.isUsingOAuth(model) && registry.getProvider(model.provider)?.auth.oauth?.isSubscription===true)`；cost>0 或 usingSubscription 才添加 `$cost.toFixed(3)`；有非空 usageText 时紧接金额添加它、**不添加 `(sub)`**，无 usageText 且 usingSubscription 时才保留 `(sub)`。费用段原本缺席时只添加 usageText，不创建假 `$0.000`。然后追加 context：`getContextUsage()?.percent===null` 时 `?`，否则对 undefined 按原生 0.0 后备；window=context?.contextWindow??model?.contextWindow??0；>90 红，>70 黄，否则普通，格式 `23.0%/272k`。`PI_EXPERIMENTAL=1` 追加原生 xp 样式。右侧用当前 model.id 或 `no-model`、reasoning 才追加宿主 ctx.thinkingLevel 的当前快照（初始值在 session_start 读取，之后 model_select/turn_end 更新；宿主未提供时仍按原生后备显示 off）。

**关键限制：**原生 `(auto)` 取自 `AgentSession.autoCompactionEnabled`，扩展上下文没有 getter，且 `/settings` 能在运行时改变它。这里**不显示 `(auto)`**，不能硬写为 true、读设置文件、反射私有 session，也不能宣称逐字等同原生。其它数值来源、顺序及颜色按原生规则。Post：左侧片段依次为 token/cache/cost/供应商用量/context/xp，右侧为 model/level；与 provider 额度语义隔离。纯本地计算，条件完整、有限步骤。

### `formatFooterPath(cwd, home, branch, sessionName): string` — `footer-path.ts`

Caller：render。Pre：有效 cwd。使用 `resolve/relative/sep/isAbsolute` 按原生路径边界判断 cwd 是否位于 HOME 内；在内显示 `~` 或 `~/relative`，否则原 cwd。再追加 ` (branch)`（存在时）和 ` • sessionName`（存在时）。没有 HOME 则不缩写；字符来自会话/branch，在终端前去 ANSI/控制字符，防止注入。Post：只改变显示，不做文件访问；固定本地操作。

### `layoutFooter(pathLine, statsLeft, modelRight, statuses, width, theme, footerData): string[]` — `footer-layout.ts`

Caller：render；callees：visibleWidth、truncateToWidth、theme.fg。Pre：width≥0；各动态字段已净化。

1. statsLeft 用空格 join；超宽先 truncate 到 width 并以 `...` 标尾。
2. rightWithoutProvider=model.id/level；只有 footerData.getAvailableProviderCount()>1 且 `(provider) right` 可与 left+最少两格同宽容纳时才显示 provider 前缀，否则只保留 model/level。
3. right 全宽能容纳则右对齐填空格；否则以 `width-leftWidth-2` 为剩余右侧宽截断，连两格也放不下则只留 left。
4. 分别对 left 和剩余 padding/right 上 dim，避免 context 自带颜色 reset 清掉整行 dim；path 也 dim＋截断。
5. 第三行只在 extensionStatuses 非空时出现：按 key 排序、文本去控制字符/折叠空格，join 后 truncate；不能吞掉其它扩展状态。

Post：2 行或 3 行，各宽不大于 width；从左到右的顺序不变。有限 statuses 排序与固定字符截断终止；所有长度用可见宽度处理，不用 JS length 假装终端宽度。

### `createUsageFooter(tui, theme, footerData, controller): Component` — `footer-component.ts`

Caller：session_start 里的 `ctx.ui.setFooter`。Factory 当场注册 `footerData.onBranchChange(() => tui.requestRender())`；返回 `{render(width), invalidate(), dispose()}`。render 只读当前 controller 的 model/level/display 与会话 entries、context、branch、statuses，调用上列函数，绝不网络请求。controller 新结果直接 `tui.requestRender()`；Pi 自身消息渲染亦能重绘同一组件。dispose 取消 branch 监听，幂等；无需持有 agent session 内部对象。所有输入属该 session；重新开会话重建 factory，不跨会话使用旧闭包。

### `formatDisplayState(state): string | undefined` — `footer-display.ts`

Caller：render/formatStats。严格按 [架构映射](architecture.md#跨组件数据仅此处定义) 分支；footer 不重复右侧 provider 名。服务返回 label/compact 去 ANSI、控制字符，换行归空格，不输出 secret/原 JSON；empty/not-applicable→undefined，unsupported→`(N/S)`，available→`(<compact>)`，带 staleError 的 available→`(<compact> (err))`，没有旧值的 error→本地短码。纯函数；有限变体穷尽，所以 footer 不会通过字符串猜套餐状态。

## 6. 按需查询命令

### `resolveUsageTargets(args, model, registry): Target[] | input-error` — `command-targets.ts`

Caller：命令 handler、参数补全。无参数且有当前模型→仅当前模型；无当前模型→提示没有当前 provider。`--all` 单独使用：从 `registry.getAvailable()` 按 provider id 去重，保留当前模型（若它尚未在快照内）；没有任何可用模型时提示空集合。显式空白分隔的 provider 名：每个名字在 `registry.getAll()` 的模型中找一项，当前 provider 优先采用当前 model，其余采用该 provider 的首个已注册模型；未知名字明确报错，不借其它 provider 的模型；重复名字只查询一次。`--all` 与具体名称混用是输入错误。有限模型与参数遍历，输出按出现顺序，纯函数，不读 profiles。

### `queryUsageTarget(target, registry): Promise<string>` — `usage-command.ts`

Caller：命令 handler；callees：captureSelection→route→executeUsageQuery。Pre：target 的 model/providerId 同源。对每个目标新建 AbortController，单次调用设置 15 秒 unref timer，`finally` 清 timer；取消的查询输出 TIMEOUT。支持成功输出 `${name}: ${result.text}`；不适用输出 `${name}: 无适用套餐`（仅有确证时）；未支持 N/S，认证 AUTH，其他错误 ERR。异常转 ERR，不输出凭据或原始响应。此函数不改当前模型、controller 世代或 footer；界内每目标最多一个 GET。

### `completeProviderUsageArgs(prefix, registry): AutocompleteItem[] | null` — `command-completion.ts`

Caller：`registerCommand.getArgumentCompletions` 与强制 Tab wrapper；参数前缀为整条命令参数。用 `getAvailable()` 中的 provider ids（以及当前模型），首参数还可提示 `--all`；拆出已完成的空白分隔 token 与正在输入的 token，过滤已选择名称和不匹配者。候选 value 保留完整已输入前缀再附当前补全名，保证第二、第三参数 Tab 不覆盖前面的名字。只读、有限遍历；不解析 profiles。

### `createProviderUsageCompletion(current, registry): AutocompleteProvider` — `command-completion.ts`

Caller：TUI session_start 的 `ctx.ui.addAutocompleteProvider`。仅对编辑器中 `/provider-usage ` 后当前光标处调用上述候选；getSuggestions 返回 items/prefix，applyCompletion 只替换当前 token，保留先前参数并追加空格；shouldTriggerFileCompletion 在该参数位置返回 true，使**直接按 Tab** 也能拿到候选；其它输入转交 current。session replacement/reload 由宿主清理 wrapper，下次 session_start 重装。无远程副作用。

### `/provider-usage` handler — `usage-command.ts`

Caller：`pi.registerCommand`。同步解析目标，再逐个 `await queryUsageTarget`，结束后通过 `ctx.ui.notify` 一次输出逐行结果，不发给模型上下文、不输出到 footer；每个目标的失败保留本行，不阻止下一目标。用户发起的命令可等待网络，每目标有独立截止；循环每步推进一个目标而终止。命令只读取 runtime registry；默认/--all/显式名称走同一身份-路由-认证链，不加 profile 专用分支。

## 7. 测试与剩余事实

**必须直接执行：**无 profiles 时内置 provider 和任意具名 provider 的同路由/不同凭据；三路由与相似域名；Codex 实测形状 primary=34%/week、secondary=null、附加额度；Z.AI 两区域旧新额度、TIME_LIMIT、未知 unit/空 limits；401/403/invalid JSON/超时/切换迟到；密集事件时单 job；shutdown 后无迟到 UI；footer 全 entries 的 R/W/CH/cost/context、费用后短文本取代 sub、窄屏、status、branch/theme；`/provider-usage` 当前/--all/多名称/未知名与参数 Tab；无费用时直接插用量；非 TUI 无自动请求。README 的日期和状态随实际功能更新。

**未闭合，不用猜：**Z.AI 两区域目标账号尚未实测；精确“无套餐”响应合同仍需一手依据/脱敏实际响应；组织套餐协议未覆盖；宿主认证 Promise 不可取消；纯插件拿不到实时 `(auto)`，同时装载另一自定义 footer 存在独占冲突。上述边界保留到全局论证，不以编写测试或模型自述冒充已完成。

**全局 SCCO：**identity/auth/query/footer 的 pre/post 顺接，并由世代门关闭异步时差，因此在已证输入范围内满足 Q.I.1–8；是否支持新的业务响应须回到供应商 adapter，不能改 Q。用量内容和 footer 布局彼此正交。除原生统计重建这项因纯插件硬边界而必要的复制外，不添加插件间桥接或通用度量框架。
