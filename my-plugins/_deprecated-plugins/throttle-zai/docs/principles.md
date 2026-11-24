# QPDI：throttle-zai 的意图、前提和经验

状态：设计基线待用户批准。Q.I 只记录用户已经表达的方向；方案选择不倒写成用户要求。P、D、I 分别位于架构、细化和未来实现，不在本文件重复。

## Q.I：用户意图

| ID | 内容 | 来源与状态 |
|---|---|---|
| Q.I.1 | `/add-login my-zai throttle-zai` 后使用 `my-zai/glm-5.3`；throttle-zai 是 TYPE，my-zai 是实例身份 | 用户明确纠正，confirmed |
| Q.I.2 | provider-profiles 使用统一来源列表；静态 new-providers 只登记 id，通过约定服务取得新来源 | 用户最新方案与确认请求，confirmed 方向；具体 schema 为 D |
| Q.I.3 | 同名来源新覆盖旧并警告；实例和凭据不是可静默覆盖的对象 | 用户明确规定来源覆盖；后半是身份目标的 P 推导，不另造覆盖授权 |
| Q.I.4 | 提供者在模型初始化前提供服务；创建后走正常 Pi Provider/API，不维护专用模型请求体系 | 用户多轮明确要求，confirmed |
| Q.I.5 | 新插件管理服务启动、握手、模型目录和官方一致的能力信息 | 用户最初能力清单，confirmed；不等于要求任意新模型元数据凭空出现 |
| Q.I.6 | 池 5h/week 汇总，详细用量显示分 key；查询与展示插件只通过公开协议合作 | 用户明确要求，confirmed |
| Q.I.7 | 解耦、最小设计；潜在 quota-throttle PR 只能提供通用服务，不含 Pi/本插件专属需求 | 用户明确设计原则，confirmed |
| Q.I.8 | 本插件完成全部设计；其他插件及外部功能设计统一放 docs/extern-dep-design.md，之后共同实施 | 本轮明确授权，confirmed；不授权现在改实现、fork 或发布 |

“先注册 TYPE 再浅复制所有回调”“必须用缓存代理启动”“把 my-zai 当池成员”等是历史 D 候选或 AI 误解，不是 Q.I。

## Q.A：源码及部署前提

### 已有源证

| ID | 内容 | 证据 |
|---|---|---|
| Q.A.1 | Provider 是实例单元，含 auth、同步 getModels、可选动态刷新和操作实现 | Pi 1.4 `pi-ai/dist/models.d.ts` |
| Q.A.2 | 扩展 factory 顺序 await；总线事件在 factory 内即时触发；provider 登记先排队，初始 offline refresh 后才解析 CLI 模型 | `loader.js:420-451,526-575`；`agent-session-services.js:71-111`；`main.js:602-683` |
| Q.A.3 | ctx.modelRegistry 不暴露 login；公开 ModelRuntime 类提供 login/logout，默认存储可指定 authPath | Pi 1.4 public declarations 与 login-runtime-probe |
| Q.A.4 | 内置目录的 glm-5.3 当前声明 contextWindow=1000000、maxTokens=131072；这不是实测上游极限 | runtime-probe.json |
| Q.A.5 | 原 instanceProvider 丢弃 refreshModels；旧 createProvider 动态闭包捕获 input.id | 现有 instantiator.ts、Pi models.js |
| Q.A.6 | quota-throttle 是单 GLM Coding Plan 池调度，new-api 是模型代理；现有模型发现只给 ID | 固定上游 `0b89c961...` 的 main/model_catalog/status |
| Q.A.7 | 现有状态给逐 key 百分比与重置时间，updated_at 与窗口 reset 为 epoch ms；不是绝对容量 | status.rs、quota.rs；RequestLog.created_at 则为秒 |
| Q.A.8 | new-api 创建 token 不返回 key/id；普通列表掩码，专用接口取得完整 key | 固定 new-api `6ce7305c.../controller/token.go` |
| Q.A.9 | root setup 给正虚拟额度；零 GroupRatio 合法，零 ratio 不触发最低扣费 1；用户余额正值检查依然存在 | setup.go、group_ratio.go、text_quota.go、billing_session.go |
| Q.A.10 | 默认 ModelRuntime 的登录变更能被另一个运行时刷新读到，logout 能删除该槽 | 本机离线文件级探针，非真实用户文件 |

事实用于论证不自动成为新增规范授权。具体时间、源码链接及实验强度见测试设计和外部依赖文档。

### 待批准的部署假设，不冒充既定事实

| ID | 假设 | 若不成立 |
|---|---|---|
| H.1 | Pi 1.4 默认 CLI 使用 getAgentDir 下 auth.json；不是自定义 SDK CredentialStore | E1 登录桥不得使用默认路径；需宿主公开桥接 |
| H.2 | 对应来源插件正常加载，履行同步工厂及最后发布 READY 的契约 | 初始模型保证失效，不能回退别的来源 |
| H.3 | 已安装受信任、满足 E3 的 quota-throttle；backend 目录由本插件独占管理 | 初始化失败，不接管旧实例或执行未知程序 |
| H.4 | 单个本机池是本版范围；多 provider 实例使用该池 | 独立池需要额外显式绑定设计，不以名称推断 |
| H.5 | 配置变更/账号 onboarding 按安装串行；推理并发不受此限制 | 不能保证跨 Pi 配置合并与 token 创建 exactly-once |
| H.6 | equal 模式的各 key 确有独立、同容量额度，或 weighted 模式提供真实统一容量权重 | 数字总池目标暂不成立，显示明确未知并要求配置；不以假平均补齐 |
| H.7 | 本机受信任、数字回环地址、私有目录权限可执行；部署基线 macOS/Linux | 不承诺对不可信本地进程、远程控制面或 Windows ACL 的安全保证 |
| H.8 | new-api 私有实例由本插件管理，默认组可作零费率订阅转发；无不相关用户/资金 | 禁止自动改其分组倍率/模型倍率/管理凭据 |

H 是设计保证的条件；用户尚未确认的限制不改写 Q.I。尤其不能把“当前只有百分比”写成“用户只想看平均数”。

## Q.E：经验与实验的地位

### 用户已经陈述的经验

- Q.E.1：具名 providers 已成功扩展，配置后模型信息自动继承。来源为用户开场说明，confirmed。
- Q.E.2：provider-profiles 已有静态配置加载，用户指出这可用于简化启动。现有源码也支持这一判断，confirmed 方向。

### 可供采纳的实验，不冒称用户已确认的正式经验

- E.L1：7 个 loader/CLI 离线场景，含反向加载、覆盖、缺服务不回退、错误 ID、失败后无关实例保留。是受控样本，不证明所有扩展行为。
- E.L2：公开临时 Runtime 写入假 auth.json，主 Runtime 刷新可见且原生 logout 清除。未测自定义 SDK 存储、真实 UI 或跨进程同时登录。
- E.L3：先前探针 fixture 的 AuthResult 层级错误、selected refresh 不等于实际启动 full refresh；修正测试接线后通过，不据此指认 SDK bug。
- E.L4：前次 provider 子任务曾超时，留下材料但未记作执行通过；主会话证据是直接源码和独立离线程序，不是 agent 自述。

## 设计传播规则

- P.global 只在架构中定义一次，其适用范围必须列明。
- 内部 D 只承接架构分配的义务，不能拿一条 Q.I 绕过父层合同直接添加脚本、全局状态、重试或 API。
- 外部 E1/E2/E3/E4 的未实现是依赖状态，不伪装成内部已完成；外部机制及修改只在 extern-dep-design.md 规范化。
- 若权重、binary、凭据存储或目录覆盖假设失效，先把实际根保证写明，再由用户决定接受边界或扩大设计；不在叶子备注中藏 guarantee narrowing。
- 本轮没有独立审查授权，不报告 SCCO pass 或设计审查通过。函数论证属于设计本身，不替代运行和用户批准。
