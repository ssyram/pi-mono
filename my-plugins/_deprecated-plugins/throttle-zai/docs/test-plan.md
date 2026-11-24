# 测试设计与证据状态

状态：实现用测试清单，不表示这些生产测试已执行。现有探针列在最后，不能用它们替代本表。

## 1. 依据与隔离

根性质见 design/architecture.md；函数见 detailed-design.md/backend.md；外部合同见 extern-dep-design.md。所有测试默认无真实 provider API/key、无付费调用；只使用临时目录、内存凭据、faux/native fake stream、本机 fake quota/upstream。

源码一文件一个机制测试，按概念组织。SDK与安装版1.4一致，不能让工作区旧目录误代表运行版。修改产品代码后运行本包具体测试及根 npm run check；需要 built 输出才 build。不得直接跑全量 vitest 或 npm test。

## 2. 需求到测试映射

| 性质 | 主要测试 |
|---|---|
| P.R1 初始模型 | T.Source/T.Loading/T.Catalog |
| P.R2 凭据分离 | T.Login/T.Token/T.SdkLogin |
| P.R3 受管服务 | T.Bootstrap/T.Daemon/T.Identity |
| P.R4 元数据和替换 | T.Catalog/T.NativeStream |
| P.R5 实例隔离 | T.Instance/T.UsageOwnership |
| P.R6 池计算 | T.Aggregate/T.Format/T.Snapshot |
| P.R7 边界 | T.PublicContracts，外部E1/E2/E3回归 |
| P.G1秘密 | T.Secrets/T.PrivateFiles |
| P.G2/G3 owner/取消 | T.Daemon/T.OwnerLifecycle |
| P.G4/G5无隐含IO/重放 | T.Source/T.UnknownWrites/T.NativeStream |

## 3. 纯函数与配置

### T.Config

- 完整 personal/team；缺一 selector、CR/LF、空值；equal、weighted。
- 缺/坏 JSON/错版本；CLI相对路径、非数字回环、userinfo/query/hash、错误path、端口冲突。
- weighted非法单位、非正/非安全容量、总和溢出；配置变更只经restart/reload。
- diagnostics不包含原JSON、key或管理password。

### T.Catalog

- 官方glm-5.3字段逐项继承，id/baseUrl改成实例；官方显式compat优先，localhost仍用Z.ai格式。
- 无缓存、本地初始目录可读；offline refresh零HTTP/零启动，不用stored空目录遮蔽基线。
- 两实例独立目录；联网列表增加/删除/空列表；用完整替换而不是baseline union。
- 无效data/id、重复/空白ID、未知模型；失败保留原列表，未知能力不猜128k。
- auth凭据只属该实例；force/60s新鲜度；取消前/后publish、generation false不更新。
- publish只update，不写模型磁盘副本；更换endpoint不继承旧缓存URL或headers。

### T.Aggregate（基本+性质测试）

- equal两把20/60→约40；所有50→约50，不是sum。
- weighted两窗口权重不同；已用0/100、disabled/exhausted、空池、某window缺失、缺weight、查询失败。
- partial不能丢分母后标完整；未知必须无数字总池；同账号多key的独立性不是算法能证明。
- property：成员置换不改变结果；容量在合法范围同倍缩放不改percent；used/capacity一致；结果有界[0,100]。
- observed精度为上游百分比，不能断言是精确请求/credit数。

### T.Format

- compact单行含两窗口、≈和必要不可调度标记；unknown含coverage。
- text逐key、不同reset独立、标签控制字符清除；不显示raw HTTP错误。
- 虚拟wallet/token额度/请求历史不被格式化成真实Coding Plan额度。

## 4. 后台与凭据

### T.Bootstrap / T.PrivateFiles

- 无state+无config、已有匹配state、坏state、state丢失但backend存在；最后一种拒绝接管。
- 并发bootstrap发布只采用一个完整身份，不读到半个JSON；私有文件0600/目录0700。
- E3.init created/existing/conflict/探活失败/版本错/超时/退出/超大stdout。
- secret只走stdin；argv、环境新增字段、日志、异常不含KEY/password；停止的仅是本次有限init子进程。

### T.Daemon / T.Identity / T.OwnerLifecycle

- ready复用、过期重查、冷启动、两同进程caller合并、已有跨进程锁转等待。
- wrong instanceId/endpoint/version/dry_run=true不发管理凭据；wild route不能假ready。
- 一caller取消另一caller仍成功；owner超时不kill共享daemon；会话退出/reload不调用down。
- controller活着但proxy已退出时走E3.ensure恢复，不重复up；starting完整快照前不假ready。
- 启动后内存状态收敛，没有已settled starting；订阅清理后无全局owner引用。
- E3实际并发up及异常退出锁释放在外部owner测试，不由mock代替。

### T.ManagementSession / T.RelayPolicy

- cookie+New-Api-User；管理root身份不符、2FA、success=false即使HTTP200。
- 同origin/无redirect；401已知pre-handler拒绝只重登一次；timeout/5xx不盲重放写。
- options GET/merge/PUT/readback；保留其它项；仅本插件私有root/default组。
- 正余额+零group/显式model ratio；缺价格、零余额、wild channel、不相关用户均报独立配置错误。
- 本机真实new-api+fake文本/视觉输入测试：前后wallet不因零倍率转发递减；仍验证零余额403门槛。

### T.Token / T.UnknownWrites

- 无journal先查唯一名；已有token取回、删除后确认重建、disabled不自动启用、多条同名阻止。
- 创建success不返回id/key，必须查id再专用取key；掩码不得当调用key。
- 创建前intent落盘，crash/timeout→uncertain；没有匹配也不自动第二次POST；找到唯一匹配可恢复。
- 远端创建成功本地保存失败，明确部分状态，不撤销共享token。
- 分页上限、错误group/owner/expiry/status/key；每条退出路径不记录secret。

### T.Login / T.SdkLogin

- KEY输入、空/取消、team预配置缺失、init两路、existing在线AddKey、幂等/冲突/unknown。
- 返回gateway key而非输入KEY；不上下游凭据互借；同profile恢复稳定client名。
- E1公开SDK桥：假文件落盘、env保留、主registry刷新可见、logout删除；默认文件路径与自定义store不混淆。
- profile身份先存后登录失败的未配置状态；CredentialSynchronizationError不重新导入KEY。

## 5. 请求、用量和组合

### T.NativeStream

- 两个stream入口均立即返回标准流，setup延后ensure；失败/取消标准error，无模型重试。
- forward完整context/options，observability hooks、AbortSignal、env、headers、usage、thinking、tool calls不丢。
- 本机fake upstream校验system角色、thinking.type、max_tokens；无管理cookie流入模型请求。
- 非流式/流式/工具往返/视觉输入/缓存计数；不以普通文本成功代替其余协议。

### T.UsageOwnership / T.Snapshot

- E2首次查询两加载顺序；新Source覆盖后旧owner不认领；native原对象+pure modelOverrides仍可正确匹配。
- profile ID相同但对象/endpoint/API不同不认领；未认领才内置回退，认领失败不fallback。
- 查询不启动daemon、不改priority；未初始化/离线/错误identity/过期snapshot/部分window。
- caller abort、Promise reject、controller deadline、staleError；不新建轮询器。
- 外部configuration提示不硬编码glmTeams，旧GLM团队错误提示保留；raw错误不进入message。

### T.Loading / T.PublicContracts

- E1配置拆分、重复声明新胜、声明缺服务不退旧源、构造错误隔离、返回id错误。
- 初始full offline refresh之后CLI解析成功；不能只在session_start补模型。
- source.publish后无可能失败的步骤；异步accept/网络create是违约，不声称跨扩展回滚。
- new-providers和manual apiKey保留，native API-key/OAuth/过滤/模型冲突回归在E1 owner执行。

## 6. 运行方式与实现门槛

生产测试按包的具体文件运行，例如在本插件目录：

```text
node <repo>/node_modules/vitest/dist/cli.js --run test/model-catalog.test.ts
node <repo>/node_modules/vitest/dist/cli.js --run test/backend-owner.test.ts
```

命令是未来测试入口，不是本轮已存在的test文件。长时多进程测试在批准实施后用一次性scheduled script收取退出码，不让模型轮询。

本机真实daemon/new-api测试必须使用独立端口、数据根、假凭据和fake upstream；没有用户授权不访问真实quota或模型。TUI采用项目interactive-testing约定，不能用notify stub冒充真实输入/取消验证。

完成实现的最短充分依据：对应代码/回归测试、类型/检查通过、外部E依赖版本可用、本机fake集成完整退出及产物。真实KEY场景单独授权与结算。不得删/弱化失败测试换绿，未执行项继续明确。

## 7. 当前已执行证据

| 产物 | 范围 | 状态 |
|---|---|---|
| research/evidence/runtime-probe.json | 标准注册、静态alias、目录字段、bus认领 | 通过；无真实网络 |
| source-loading-probe.json | Pi1.4真实loader/CLI，7场景及无关profile保留 | 通过；native部分为注入fixture，不是所有原生回归 |
| login-runtime-probe.json | public SDK假auth文件、refresh可见、logout、0600 | 通过；未测真实UI/自定义store |
| source-*.txt | 部分源码哈希 | 版本定位，不是正确性证明 |

本表之外的测试均待实现。文档完成不表示审查通过；本轮没有追加独立审查、真实服务上线、commit或PR。
