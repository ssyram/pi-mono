# 内部架构：throttle-zai

状态：完整推荐设计，待用户批准；未实施、未作独立审查。

## D.root — 本插件整体

### P：本层性质

| ID | 可判定性质 | 来自 |
|---|---|---|
| P.R1 | 来源服务同步创建最终 id 的标准 Provider，初始目录本地可读，不依赖 daemon/旧缓存 | Q.I.1/2/4，Q.A.1/2 |
| P.R2 | 登录只把 gateway credential 交回标准 Provider.auth；不把上游 KEY 当模型调用 key | Q.I.4/5，Q.A.8 |
| P.R3 | 联网操作先确认本插件受管实例身份；不终止未知服务、不静默接管旧配置 | Q.I.5/7，H.3 |
| P.R4 | 模型 ID 来自网关，能力来自安装版官方国内目录；未知能力不编造，刷新可替换旧目录 | Q.I.5，Q.A.4/6 |
| P.R5 | source、实例、池、上游账号身份分离；并发实例不共享可变模型目录/凭据 | Q.I.1/6，Q.A.5 |
| P.R6 | 用量按绑定池分窗汇总，明细逐 key；缺数据不假报完整总池 | Q.I.6，H.6 |
| P.R7 | 外部组件仅通过 E1/E2/E3/E4 调用；不导入其私有状态/源码 | Q.I.7/8 |

### P.global：仅对本插件全部组件适用

- P.G1：秘密不进入 CLI 参数、模型上下文、公开日志或报错；私有文件 0600，目录 0700。
- P.G2：无模块级跨 session 可变表；跨实例后台连接由当前 extension factory 拥有的 BackendOwner 管理，跨 Pi 的同一 daemon 共享是明确设计目的。
- P.G3：caller 取消只取消该调用等待，不停止其他实例使用的 daemon/启动操作；会话关闭不调用 down。
- P.G4：不在源服务 create、offline refresh 或用量只读查询里启动网络/进程；推理流不增加模型重试层。
- P.G5：写请求超时是结果未知，不自动重放 token 创建等非幂等操作；部分成功明确返回。
- P.G6：所有外部 JSON、CLI 输出和配置在各自入口验证；内部已验证数据不反复复制、冻结或遍历防御。

### M：组成

```text
E1 来源消费者 → D.source → 标准 Provider(id=my-zai)
                            ├ auth.login → D.backend（初始化/导入/令牌）
                            ├ getModels/refresh → D.catalog
                            └ stream → D.request → new-api → GLM
E2 用量消费者 → D.usage → D.backend 的只读快照
```

外部规范及代码修改只见 [extern-dep-design.md](../extern-dep-design.md)。E1=provider-profiles，E2=provider-usage，E3=quota-throttle，E4=new-api 管理与转发。

### 根数据和身份

| 对象 | 主键/作用域 | 修改者 |
|---|---|---|
| 来源 TYPE | throttle-zai，本次加载注册一次 | D.source |
| Provider 实例 | E1 提供的最终 id；标准 auth/models 槽 | 对应 Provider/宿主 |
| BackendOwner | 本 extension factory 的对象；多个实例共享 | D.backend |
| Backend installation | 私有 state.instanceId；跨 Pi 共享一个目录/daemon | 本插件 + E3 独占进程 |
| 账号 | account tag，源于 KEY + 团队上下文的稳定标识 | E3 单写者 |
| Gateway client | instanceId + Provider.id 的稳定名称 | D.backend，E4 token API |

本版D选择单受管池。不同my-zai名称不创建不同池；它们持有独立调用凭据但总池额度相同。独立池不是隐含功能。客户端凭据隔离不禁止已授权池内的上游KEY调度：前者由Provider/auth拥有，后者由E3单写者拥有。

### R：组成为什么能满足根目标

1. D.source 只构造对象，官方模型基线可同步提供；E1 的“先订阅后查询、同步登记”使其赶在初始模型解析之前，P.R1 成立。7 项离线原型验证了该机制，不证明业务驱动已完成。
2. D.backend 将输入 KEY 导入服务，再取得独立 gateway key，Provider.auth 返回标准 credential；E1 用公开 SDK 保存到实例槽，R2/R5 成立，不需要私有 ctx.modelRuntime。
3. owner identity/锁由 E3 提供，D.backend 先握手再管理/发请求，P.R3 在 H.3 下成立。端口响应或 PID 文件本身不足。
4. D.catalog 重建可信元数据并覆盖目录，D.request 只透传标准操作且明确 Z.ai compat，分别承接 P.R4 和模型请求义务；不使用会把动态项与基线永远求并集的辅助构造来冒充过滤。
5. D.usage 的数学聚合只在 H.6 成立时输出总池数；缺失窗口/权重明确为 unknown，不将错误当 0。Q.I.6 的无条件数字保证在缺数据环境下仍有根层缺口，不能藏在 formatter。
6. 所有跨边界调用引用 E 规范，令牌/账号/调度归属不穿透到 consumer 私有实现，P.R7 成立。

### 根不变量及维护

| 不变量 | 维护/承接 |
|---|---|
| provider.id、模型 provider、目录 publication、credential 槽为同一实例 id | D.source/D.catalog + E1/SDK |
| 上游 KEY、管理会话和 gateway key 不互换 | D.backend + E3/E4 |
| 只有 instanceId 和 endpoint 均匹配才使用管理凭据 | D.backend |
| 每个实例目录闭包独立，后台同池共享有明确 owner | D.source/D.catalog/D.backend |
| 失败/未知不伪装为另一来源或另一账号的成功 | 全部组件；无跨来源 fallback |
| pool 汇总涵盖当前 managed keys，百分比和绝对单位不混用 | D.usage |

## D.source — 来源与标准 Provider

**P.local**：实现 E1.create，返回完整 Provider；不用浅复制 TYPE 实例；注册失败或配置错误在发布前可见。

**M**：入口读取插件配置，构造 owner、官方 metadata index、source 对象；先挂 E2 查询，再以 E1 helper 发布来源作为 factory 最后步骤。create(profile) 构造 api-key auth、每实例 catalog 和两个请求包装，不联网。

**R**：所需初始资料都来自已读取配置/安装版 SDK，因此没有早期 Runtime 查询或等待未来插件的循环依赖。native auth/model/request API 已承载其余行为，不增加同义服务方法。

**限制**：READY 是构造器可用，不是 gateway 健康。提供者发布后再抛错违反 E1；没有跨扩展事务回滚承诺。

## D.backend — 受管后台与 onboarding

**P.local**：bootstrap 身份可重建；共享启动只产生一个调度器；client token 创建未知时不重复；只管理自己创建的私有 new-api。

**M**：
- plugin-config：静态位置、套餐上下文、容量政策。
- backend-bootstrap：不可变bootstrap身份/随机管理员凭据。
- backend-init：E3.init配置初始化，秘密走stdin，stdout仅manifest。
- backend-owner：E3.up、身份握手、proxy恢复、启动合并；外部OS锁承接跨Pi并发。
- control-client：snapshot、在线 add-key。
- newapi-session：管理登录、cookie/user header、受限管理请求。
- relay-policy：私有 default 组零倍率、已知模型显式倍率、正余额检查。
- client-token：稳定token名、持久journal、创建/定位/取key，不保存原始KEY或完整gateway key。
- provider-login：KEY输入、初始化/导入和返回标准credential的组合。

**R**：配置 seed 和 runtime mutation 都由 E3 承接，不让插件解析或编辑活跃 TOML；E4 管理只针对已握手的私有 endpoint。未知 token 创建进入 journal，未来只对账，不重放。生命周期 ownership 比文件时间租约更弱假设、更少竞态。

**限制**：串行 onboarding 是部署假设；不承诺多 Pi 同时改账号配置的事务。未知旧配置/2FA 管理账号不自动接管。CLI/binary 安装不属于模型请求流程。

## D.catalog — 目录与元数据

**P.local**：本地基线、实例独立目录、联网替换、未知模型不造能力、失败保留旧目录并报告。

**M**：官方 zai-coding-cn metadata index；buildModel(id, profileId, endpoint)；每实例 list 闭包；标准 refreshModels/publish(update)。不持久化模型成员缓存，也不从 context.stored 缩减初始基线；offline refresh 是无网络的保留操作。

**R**：基线保证无缓存启动，也不会被旧空缓存遮蔽；成功网关列表和 metadata 的交集是新的完整目录，直接替换而不是 union，因此可以删除已不可用项。host publish 的 generation 检查承接取消/旧刷新，不需要另一份磁盘目录权威；模型 never restamp to TYPE。

**限制**：未知 gateway ID 跳过并以受控诊断报告；若全部未知则目录为空，不能降到猜测 128k。SDK 基线是安装版，不是本轮验证的上游实际极限。

## D.request — 标准请求与启动

**P.local**：同步返回事件流，异步确保受管 backend，保留 native 事件/取消/usage/tool/thinking 与观测 hooks，不自行重试模型。

**M**：公开 lazyStream(model, setup)；setup 等待 owner.ensureRunning 后调用内置国内 Provider 的 stream/streamSimple。model 已经写入 alias、gateway endpoint 和显式 compat；options 原样传递，管理 cookie 从不进入该路径。

**R**：SDK 已提供异步 setup 后转发机制，不需要自写 SSE/parser。模型 API 与 metadata 同源；原生探测在 localhost 下丢失的五类 Z.ai 默认 compat 被补回，显式官方 model.compat 优先。

**限制**：真实 new-api 对工具/思考/用量字段的等价性仍需 T 集成用例验证。setup 失败返回标准流错误，不称为模型回答。

## D.usage — 只读池用量

**P.local**：按原始 Provider 对象及 endpoint/实例绑定认领 E2；不启动服务、不改变调度；在上游百分比精度内按声明容量加权，逐 key 错误不隐藏，不声称得到精确绝对余额。

**M**：只读 snapshot → 校验身份/采样时间 → normalize managed keys → aggregateWindow(5h/week) → format compact/text。

**R**：两种显示来自同一份计算结果，不从字符串截取；E2 outer controller管理取消/节流/stale，无新增轮询。equal等价于容量均为1的weighted；缺任何成员数据就不是完整池。数字是最近报告百分比的汇总，不是所有key同刻采样；snapshot时间只检查最近完成的一轮，不证明逐key实时精度。

## 当前设计取舍及根层限制

- 选择静态服务声明和同步工厂，而非宿主早期新 hook、缓存代理或手抄模型参数：已有 loader 实验支持且依赖面更小。
- 选择公开临时 Runtime 登录桥而非手改 auth.json 或默认把新 token 写 profile：已有文件级实验支持标准 logout。该方法只在 H.1 下适用。
- 选择单池而非未实现的多池调度；选择显式容量政策而非百分比直接相加。两项是待批准 D，不写成用户已确认 Q。
- 选择新 backend.init 契约，而非插件私改 TOML/借未知管理员凭据；E3 尚需实现，因此当前产品不可上线。
- 私有零倍率是本地账务，不是“真实模型免费”或用户额度校验消失。余额归零、group 被外部改动等仍作为明确配置错误。
- Q.I.5/6 的完整实际保证依赖 binary、E1/E2/E3 更新、团队上下文、容量数据、目录覆盖和真实集成测试；缺失任一条件时 root guarantee 不是无条件完整。设计可交付，不等于这些缺口已被用户接受。

## 实施顺序（批准后）

1. 先按外部依赖设计交付 E1/E2 公共契约及 E3 单实例/身份/init；不在本插件内临时兼容旧私有代码。
2. 内部配置/状态/纯目录与用量计算；用 fixture 直接测试。
3. backend 与管理会话、登录、原生流包装；只接本机 fake upstream。
4. loader/CLI/TUI/标准凭据集成；用户授权后才测试真实 KEY。

每步只实现确认范围；不追加独立审查或声称已有审查通过。外部修改在别的 owner 实施时，以 extern-dep-design.md 为该边界的统一设计输入。
