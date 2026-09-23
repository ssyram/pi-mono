# Q — 当前账号的套餐用量

## Task Overview

**问题对象：**在 Pi 的当前模型上，看见该账号的服务端套餐用量，而不是再看一份本地 token 累计。

**当前状态：**用户认可已有调查并要求先设计、再实施。首版为 Codex、Z.AI 国际 Coding、Z.AI 国内 Coding；实现必须是纯插件。下列 Q.I 界定正确结果；技术事实与样本分别列在 Q.A/Q.E。实现机制与尚未解决的接口限制属于 [Architecture](architecture.md) 和 [Detail](detail.md)，不反写成 Q.I。

**整体关切：**观察的账号必须与当前选择一致；供应商决定怎样查询，账号身份决定结果归谁。这个组织说明不新增独立的规范条目。

## Q.I — 正确结果与边界

### Q.I.1 — 显示当前账号的套餐用量

**采纳：confirmed。** 正确的用量来自当前生效模型所属 provider 的账号；不能把本地 token 计数、另一个账号或同供应商其它实例的额度当成它的用量。启动后无需另选监控账号。

**来源：**用户要求“启动的时候……把 provider 拿到”，并以 `codex-002`、`glm-000-gl` 指定了两个账号实例。**判断力：**从 A 切到 B 后继续显示 A 的额度，不合格。由 D.root 的 P1/P6 承接。

### Q.I.2 — 纯插件且独立于 profiles

**采纳：confirmed。** 功能只能作为插件实现；无论 provider-profiles 是否存在，监控行为相同，不能以其安装、配置或命名为前提，也不能修改 Pi 宿主。

**来源：**“this plugin should work no matter the profile plugin exists OR NOT”“NO additional matching on whether the plugin exists or not”；其后用户明确纠正“不是我要纯插件”。**判断力：**需要读取 profiles 配置或改宿主源码的方案不合格。由 D.root 的 Global P/P6 承接。

### Q.I.3 — 查询类别和展示身份各有依据

**采纳：confirmed。** 查询按实际供应商类别的对应信息选择，不按 provider 的自定义名称猜类别；显示名称自然对应当前 provider 的身份，不把类别名冒充账号名。`kind` 在这里是语义，不要求代码存在同名字段。

**来源：**“kind（NOT provider name）”；用户以 `codex-002 → openai-codex` 纠正对字面 `kind` 字段的误读，并追问没有 profiles 是否也能自然取得 name。**判断力：**把 `codex-002` 这个字符串用来猜接口，或把它显示成 `openai-codex`，均不合格。由 P1/P2 承接。

### Q.I.4 — 供应商信息真实且因地制宜

**采纳：confirmed。** 用量内容随服务真实返回的信息而异；凡显示百分比、周期、余额或次数，语义和单位必须正确。示例 `5h/week` 不是必有字段或固定版式；缺失不能伪造为零。

**来源：**“反正有啥有用的就写啥”“因地制宜……具体打印信息模式还是得自定义”。**判断力：**服务只返回一周窗口却显示另一个 5h/0% 的结果，不合格。由 P3 承接。

### Q.I.5 — 就地进入底部统计行

**采纳：confirmed。** 底部统计行只显示简短额度，例如 `(72%(week))`；右侧模型旁已有 provider 名，不在额度中重复。有额度状态时它取代 `(sub)`，位于费用金额之后。重置时刻及解析提示不挤占该行，原 token、费用和 context 统计的含义不变。

**来源：**用户先要求“在 $... 后面加上这个用量信息”，后来明确嫌 `(codex-002: 已用 72%(week) 重置…部分信息未解析)` 太长，要求替换 `(sub)` 并缩成 `(codex-002: 72%(week))`；最新要求删去重复的 NAME，仅留下 USAGE。**判断力：**费用后同时出现 `(sub)` 和长串重置细节，或把额度计入本地 token/cost，均不合格。由 P4 承接；原生 `(auto)` 的不可观测性仍是 D 的残余差异。

### Q.I.6 — 不适用、不支持与失败不可混同

**采纳：confirmed。** 已确认不是适用套餐时不显示；尚未支持查询的服务显示 `N/S`。认证或查询失败不等于这两种情况，不能以隐藏或 N/S 掩盖失败。

**来源：**“non-applicable 就不显示（不是套餐）但是 not support 就显示 N/S”；Claude、DeepSeek 被用户作为未支持的例子。**判断力：**把 401 或陌生响应判成“无套餐”，不合格。由 P5 承接。

### Q.I.7 — 首版范围有限

**采纳：confirmed。** 首版承诺 Codex、Z.AI 国际 Coding 与 Z.AI 国内 Coding 这三类服务的用量展示；其它类别按未支持处理。不把账号自动轮换或全部供应商支持混入本功能。

**来源：**“第一次只实现 zai / zai-chnXXX 什么的 / codex 这仨的支持”。**判断力：**宣称支持三类却将其中一类无条件返回 N/S，不满足首版范围；这项义务的账户/套餐证据缺口须显式暴露，不能偷偷降低范围。由 P2/P6 承接。

### Q.I.8 — 按需查看详细用量

**采纳：confirmed。** `/provider-usage` 直接查询当前账号；`--all` 查询当前可用的全部账号，显式给出一批 provider 名则只查询这些账号，并提供类似 impression 的 Tab 名称补全。详情可长于 footer，但各行必须对应实际查询账号，不借用别的账号数据。

**来源：**用户指定 `/provider-usage`、`--all` 和 `/provider-usage codex-002 codex-001`，并要求“像 impression 一样可以有 Tab 补全”。**判断力：**命令只返回当前账号、或按 Tab 无法补全提供的 provider 名称，不合格。由 D.root 的 P7 承接。

### Q.I.9 — 同账号刷新不闪烁

**采纳：confirmed。** 同一个 provider 刷新开始时，不把已有数值重置成 `…`；成功后换新值，失败则继续显示旧数值并加 `(err)`。若此前只有首次查询的 `…`，失败就直接显示错误。切换账号不能沿用旧账号数值。

**来源：**用户要求“when refreshing, do not show `...`, show the original number”，并明确“simply remove the setting that when it starts running, reset the number to `...`”；随后补充“when failed, simply show NAME: OLD (err), when OLD is `...`, then show NAME: err as usual”。**判断力：**每次 `turn_end` 都把已有的 `(NAME: 72%(week))` 暂时变成 `(NAME: …)` 不合格。由 D.root 的 P8 承接。

## Q.A — 当前推理使用的事实前提

以下是从本地源码与已有调查整理出的 **candidate Q.A**；`verified` 仅指所列对象和时点的证据，不代表用户已逐条确认。证据位置见 [evidence.md](evidence.md)。

### Q.A.1 — 运行时提供当前身份与认证

**事实：verified（E1/E2，当前安装/仓库版本）。** 当前模型有 `provider` 注册标识、API 协议和服务端点；model registry 能按所选模型解析认证。已调查的具名实例保留基础模型的协议和端点。

**用途：**D.identity 用这些属性区分展示身份与供应商路由。不推出所有代理端点都能识别真实公司。

### Q.A.2 — 底部统计位置受现有 UI 接口限制

**事实：verified（E3）。** 当前费用行由 Pi 的 FooterComponent 绘制；`setStatus` 在另起行显示，`setFooter` 能由插件替换整个组件，但不暴露原生内部的实时自动压缩开关。

**用途：**D.footer 选择插件重建同一行；不能从可重建布局推出可完整读取全部原生状态。

### Q.A.3 — 三种服务响应并不共用一份固定额度格式

**事实：verified 到 Codex 单次请求及供应商源码/外部样例层（E4/E5）。** Codex 的窗口可能缺失；Z.AI 已见百分比和次数两类额度、旧新类型，国内新版套餐的额外上下文协议尚未完整确认。

**用途：**D.providers 分服务解析。源码与他人样例不证明目标账号已查询成功；失败文案不证明没有套餐。

### Q.A.4 — 代码的责任边界

**事实：verified（E7）。** 本仓库开发改动限定于 `my-plugins/`，宿主源码仅供接口核对。

**用途：**D.root 将全部实施限制在插件中；不以修改宿主作为前提。

### Q.A.5 — 命令与补全的公开接口

**事实：verified（当前 Pi 扩展接口）。** `registerCommand` 提供 handler 与参数补全；TUI 的强制 Tab 路径还需 `addAutocompleteProvider`。模型 registry 提供当前可用模型与全部已注册模型列表。

**用途：**D.command 不维护第二份账号配置；`--all` 以运行时可用集合为准，显式名称以已注册 provider 为准。

## Q.E — 已观察的样本

### Q.E.1 — Codex 的单窗口样本

**采纳：candidate；事实：verified（E4，一次请求）。** 本次调查中 `codex-002` 的额度请求返回 HTTP 200：主窗口已用 34%、时长 604800 秒，次窗口为 null。

**经验所及：**窗口不能按“primary 必是 5h”或“secondary 缺失即 0%”解释；不证明所有 Codex 账号都只有周额度。由 D.providers 的窗口解析使用。

### Q.E.2 — 国际 Z.AI 实例尚未完成实测

**采纳：candidate；事实：verified（E8，调查当时）。** `glm-000-gl` 当时没有自己的存储凭据或配置 key，故未获得该实例的真实额度结果。

**经验所及：**不能用 `zai` 的凭据/别人的样例替代该实例验证；不说明 Z.AI 端点不可用。由实现的真实账号测试边界使用。

### Q.E.3 — 两地区的业务拒绝不等于额度百分比

**采纳：candidate；事实：verified（E5，本次目标环境）。** `zai`、`zai-coding-cn` 的现有 key 对额度接口收到 HTTP 200、业务 `success:false/code:500`，没有百分比字段；两地区同账号订阅列表成功为空。

**经验所及：**这些 key 在已查询的套餐接口没有可显示的额度；不能把业务失败写成已用 100%，也不能仅凭国内错误文案排除需要额外组织/项目上下文的团队套餐。由 D.providers 的状态分类与地区请求使用。
