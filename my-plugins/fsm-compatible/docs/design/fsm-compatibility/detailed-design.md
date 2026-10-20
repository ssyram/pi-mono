# fsm-compatible 核心细化设计

阶段：workflow §4.3。用户在架构交付后回复“继续”，据此进入细化；本轮不编写运行代码。父合同为 `architecture.md`，用户 Q 为 `../../principles.md`。本设计覆盖核心 P1-P9，P10 mandatory 常用插件命令翻译及 P11 optional 常用工具不在本轮实现。

## 1. 范围、实施单元与文件归属

| 子计划 | 模块与本层义务 | 顺序 |
|---|---|---|
| `fsm-1-admission-binding` | 固定 agent 集合、不可缩减必载扩展、真实 root/parent/self、新建/恢复拒绝路径；P2/P4/P8 | 第一单元，具体合同及 expectations 已独立落盘 |
| `fsm-2-runtime-broker` | owner 初始化/回收、daemon helper、MCP、canonical 身份互斥与工具投影；P1/P2/P9 | 依赖 1 |
| `fsm-3-protocol-judge` | 原始记录、OC wire、独立 judge 和正常结构化收尾；P5/P6 | 依赖 2 |
| `fsm-4-child-gates` | 受控派发、子启动、permission、主子 Stop、恢复；P3/P4/P7/P8 | 依赖 1-3 |
| `fsm-5-watch-install` | Watcher 接收投递、等待接线、故障恢复、安装与完整运行；P7/P8/P9 | 依赖 2-4 |

首个单元没有启动 agent、调用模型或 FSM 的副作用，因此可以先机械验证范围与绑定不变量；不能把该单元完成当插件可运行。其余单元在实施前从本合同补齐各自 expectations，不从实现倒填。

源码全部位于插件 `src/`；`index.ts` 只重导出 extension；每个文件只负责一个具体概念，源码非空非注释行不超过 200。不设 utils/common/shared 桶文件，不用 inline import、any 或 strip-only 不支持的 TS 语法。本文的签名是拟实现接口，不伪装为外部库现有签名。

## 2. 已有能力与复用边界

- 官方 Pi ExtensionAPI：注册工具、tool_call、before-settle、settled、原始 session entries。工具执行与收尾必须 await 判定；不继承旧 conventions 中“重工作一律 fire-and-forget”或旧 prompt 结束语义，依据当前官方调用链。
- 官方 Pi SDK：createAgentSession、DefaultResourceLoader、工具工厂、Agent.finishTurn。SDK judge 不使用私有 _queue/_runAgentPrompt，也不把 abort 当正常输出终止。
- SA 公开 `agents`、`required-child-extensions`、`capability-ceiling` exports 与文档化 RPC 事件；禁止从私有 executor/runner 模块导入业务函数。代码依赖通过插件自己的包解析，来源固定到当前实际版本，不修改第三方目录。
- 原 Client：完整 MCP tools/list、tools/call、Watcher。原 hook：permission、Stop、delivery gate 的 reducer 和细分错误策略。
- 现有 daemon routes：身份/源登记、actor acquire、source-auth。broker 的权威接线由插件的直接子进程 helper 执行并读取实际 HTTP 响应；它使用已有路由和真实 peer，不新增 FSM wire、不提交伪 PID。需要 helper 是因为 root 直接 socket peer 的严格父链与 Client peer 不同，且身份 hook exit 0 不能证明响应成功。
- schema 机械测试使用现有根环境 Ajv 8.20.0，尚无依赖修改；首单元测试以 node:test 承载生成式/有限全集性质测试，不安装缺失的 fast-check，也不新建通用性质框架。分发插件自己的精确依赖在 package 单元确定，不能把根 node_modules 当安装合同。

## 3. 错误、资源与外部调用合同

### 3.1 错误模型

纯准入返回 `AdmissionResult<T> = {ok:true,value:T} | {ok:false,code:AdmissionErrorCode}`，不携带任意原始对象、秘密或调用者可写免检标记。配置/文件 IO 异常在对应边界转为明确定义错误，内部违反类型合同则保留异常，禁止全部 catch 后放行。

AdmissionErrorCode：invalid-input、agent-not-admitted、runner-not-admitted、required-extension-mismatch、policy-widened、binding-mismatch、parent-not-found、parent-cycle、depth-exceeded、restore-conflict。

运行层错误：not-ready、owner-unavailable、queue-full、deadline-exceeded、transport-failed、protocol-invalid、delivery-unknown、cancelled。它们不是 FSM verdict；permission 失败按原策略拒绝，Stop adapter transport failure 按现行 OC soft-gate。纯 errors 常量只共享枚举，判断留各责任模块。

### 3.2 外部 callee 保证

| callee | 前置/后置 |
|---|---|
| SA required registration | realpath 后现存扩展文件；同 session 不重复注册；返回仅释放本注册的 disposer；startup required errors 拒绝 child |
| SA RPC | ping 确认 protocol/method；监听 reply 在 emit 前登记；requestId 精确关联，success=false 为实际错误，不解析 text 猜完成 |
| Pi session_start | 取得实际 SessionManager；required handler 失败阻止 child factory 的任务启动；root 不能仅靠 throw 假装工具均不可用，另有 not-ready gate |
| Pi before-settle | outcome completed 且无已有 continuation 才新增 Stop；返回合法 custom_message draft+continue，原 prompt 等待全部续跑 |
| daemon helper | 根直接 spawn；读当次 auth.token，发 x-fsm-auth；HTTP success 和 body 通过各 route schema 才确认，不只看 helper exit |
| Client call | MCP requestId 匹配；完整 CallToolResult；超时/断线且已写出请求为交付未知，不自动重放 |
| SDK prompt | 等待实际执行结束；finishTurn 原回调先运行，完整 tool batch 后可正常 end；error/length/abort 优先 |

### 3.3 Deadline 和背压

Config 必需项：hookTimeoutMs（最低 900000）、mcpTimeoutMs（不小于 hookTimeoutMs，默认 910000）、childStartTimeoutMs（默认 30000，仅含本地绑定/actor acquire，不含长期任务）、queueCapacity（默认 64）、maxDepth（默认 8）。值必须有限正整数；配置能提高容量/深度，不由模型修改。这些是执行资源界限，不把达到界限变成 FSM Allow 或成功。

身份 helper 接线预算默认 15000ms，覆盖 daemon 同键至多 10000ms 的槽等待。登记/actor/source-auth 依调用者 deadline，分别不超过 10000ms。所有调用取 caller 的剩余时间，耗尽前不开始新操作。hook lifecycle 已包含最多 10000ms 的 cleanup 保留，不在外层再附加无限等待。

等待队列达到容量时在副作用前拒绝；cancel/deadline 删除尚未执行项。已发出的 state mutation 没有确认就保留 delivery-unknown。只重建连接，不自动重发 mutation/new launch/advisory。计时器 unref 且 finally 清理；shutdown 关闭全部本 owner handles，防止 print 模式因泄漏资源不退出。

## 4. 数据类型承接

ActorBinding、SessionRecord、FsmInvocation、ChildLaunchBinding、ChildAdmissionPolicy、JudgeTurn、AdvisoryDelivery 沿用架构 §3。新增本层类型：

- `PolicyInput`：allowedAgentNames:string[]、requiredExtensions:{id,path}[]、maxDepth:integer。self 扩展由宿主提供期望真实路径，不能由模型替换。
- `ResolvedAgent`：canonicalName、runnerType、machine、runtimeName、definitionSnapshot、declaredToolCeiling。它来自明确配置引用的定义；不能遍历 discovery 自动增补名单。
- `AdmissionPolicy`：上述集合/定义的不可变副本；公开列表/对象冻结，不能以 Object.freeze(Map) 冒充不能 set。私有索引不对调用者暴露可写引用。
- `PersistedBinding`：version:1、rootSessionId、sessionId、parentSessionId、agentId、kind、agentName:string|null、bootstrapRef:string|null、requiredExtensions:readonly {id,path}[]。requiredExtensions 是该会话在上次成功接线时的原 mandatory 真路径快照，必含真实 fsm-compatible，属于非秘密恢复基线；根和子均在写 binding 时保存。恢复从当前真实分支的该 custom entry 取得，不从当前配置反推原值；缺失/损坏不是未绑定。禁止记录 password/token。序列化 schema 见 `subplans/fsm-1-admission-binding.schema.json`。
- `AuthenticatedCaller`：broker 私有 principal，来自启动时分配的每 launch bootstrap 凭据与已登记 session；身份不是模型传入的 callerSessionId。same uid 仍不是 OS sandbox。
- `PendingLaunch`：私有 launchId、policy/caller snapshot、bootstrapRef、state:allocated|registered|acquired|failed|cancelled、registeredSessionId。一次凭据只关联该 launch/恢复 actor；避免使用根万能密码让子会话任意指定其它 actor。
- `DaemonReply`：status、已验证 JSON body；非成功响应为 transport/protocol 错误，无秘密。
- `OwnedRuntime`：当前 root/epoch、ready state、disposer 栈、broker/records/launch/queue。epoch 是本地 runtime 身份，不改变 FSM root/actor；会话替换后旧异步动作检查 owner 身份，不投递给新会话。

其它临时请求形状在相应函数下定义，不建立第二份全局状态账。

## 5. 函数级细化

通用出口：`return error` 不产生未声明副作用；有外部资源的函数在 finally 只释放本次取得的资源。所有有限数组循环有实际长度上界；无限服务循环受 owner.close/AbortSignal 与有界队列控制。每节的“证明”是该函数的 pre→post 推导，不声称独立审查已通过。

### 5.1 固定准入与身份（首单元）

#### parsePolicyInput(value: unknown): AdmissionResult<PolicyInput>

pre：边界输入可任意。callee：JSON schema 的字段/类型合同；不得以 TS cast 替代检查。步骤：判对象且无未知字段→逐项检查名字、扩展 id/path、正整数 depth→检查重复→复制规范字段；类型/未知/重复/空名称错误返回 invalid-input；空 allowed 集合合法且表示不派发。循环：字段/数组有限。post：只返回满足 schema 的独立值，无 IO。证明：每个必需字段通过唯一检查才入输出，未知值不被沿用；失败未触及状态。

#### canonicalizeRequiredExtensions(input, selfId, selfPath, files): AdmissionResult<readonly RequiredExtension[]>

pre：已解析 input，files 提供 realpath/stat。callee：真实路径+file 判定；SA 最多 32 项/id pattern 合同。步骤：验证实际 selfPath→为每项 realpath并要求 file→拒绝重复 ID/真实路径或配置 selfId 指向其它文件→补入真实 self→检查最终集合≤32，超限拒绝（不能拿输入32项冒充加self后仍≤32）→每项 requireForAllRunners=true→冻结输出。IO/缺失/不一致返回 required-extension-mismatch，无注册副作用。循环每项一次、文件有限。证明：唯一源 self 被加入且配置不能替换它；真实路径比较消解路径别名，任何不完整集合不能成功。

#### buildAdmissionPolicy(input, agents, extensions): AdmissionResult<AdmissionPolicy>

pre：合法 input 和 canonical extensions；agents 是明确配置解析的候选快照。callee：上面两函数输出合同。步骤：按 allowedAgentNames精确匹配canonicalName→缺少/重复/alias-only拒绝→runner缺席或pi合法、其它runner/machine拒绝→复制 definition/tool ceiling→不可写快照。空名单返回空快照，不默认全部。循环为名单有限长度。post：每个 admitted 项既在配置集合又可加载门禁。证明：admitted 是输入明确集合的子集且输出只在所有项满足时产生；失败不部分注册 agent。

#### narrowAdmissionPolicy(parent, requested): AdmissionResult<AdmissionPolicy>

pre：parent 合法，requested 先经 parser；callee：纯集合对比。步骤：检查 requested agents⊆parent、depth≤parent、每个 parent mandatory id/path保持→任一扩张/删减返回 policy-widened→冻结有效副本。禁止把 alias/同 ID 不同 path 当同项。循环集合有限。post：后代能派遣的项不增加，必载不减少。证明：每项 subset/含有比较直接建立单调性，遍历中不修改 parent。

#### admitChildLaunch(policy, caller, request, records): AdmissionResult<ChildLaunchBinding>

pre：caller 是已认证 principal，records 当前树合法。callee：records.find真实父；fixed policy包含；depth检查。步骤：拒绝模型控制的 root/caller/policy/runner/extension override→取principal的caller→精确名单查询→本机runner校验→从真实树算 depth，已达上限拒绝→交集工具ceiling不得排除FSM必需集→构造绑定并复制必载、bootstrapRef由宿主稍后赋值。new launch 和 resume 进入不同分支；resume 必须调用下述恢复检查后才准入。循环沿有限父链，每步记录seen并拒绝环。post：未授权请求没有 launch副作用。证明：绑定身份均来自principal/树，不来自可写params；名单/ceiling全通过才产生launch合同。

#### createRootBinding(sessionId, policy): PersistedBinding

pre：真实非空sessionId、已验证policy。callee：policy.requiredExtensions 的不可变真路径快照。步骤按根等式构造version=1、root=self=sessionId、agentId=main、parent=null、kind=execution-root、agentName/bootstrapRef=null，并复制原mandatory id/path快照；没有allowlist/parent查询。post：身份等式和恢复基线同时成立，无IO/FSM副作用。循环为有限mandatory数组复制；证明：真实ID与已验证policy是唯一来源，新增非秘密快照不改变根身份。

#### bindNewChild(policy, pending, actualSessionId, entries, records): AdmissionResult<PersistedBinding>

pre：真实child SessionManager ID和已认证pending launch。callee：树登记前父验证、readPersistedBinding。步骤：pending已registered但不同self拒绝→actual ID空/等于root/等于保留main/已属于其它binding拒绝→检查parent存在且同root→检查当前required/policy→若已有persisted binding走restore分支，不当new→构造child agentId=self并保存本次policy.requiredExtensions真路径快照→登记pending.self并原子转registered。写session entry由调用者确认返回成功后执行，函数不改FSM。post：一次launch不会登记两个self。证明：所有冲突在改变pending前处理，合法转变只有allocated→registered或同self重复确认，不在失败处消费dispatch。

#### readPersistedBinding(entries, actualSessionId): AdmissionResult<PersistedBinding | null>

pre：原始entries可含任意其它custom data；callee：binding schema。步骤：只筛customType=fsm-compatible:binding→按当前真实分支取最后一项→没有返回null→不合法/version不符/record.self≠actual返回binding-mismatch→返回不可变值。不以字符串前缀匹配其它entry。循环分支有限。post：null只表示确实没有绑定，损坏不是null。证明：分离“未绑定”和“无效”，防止恢复失败时新建actor。

#### restoreActorBinding(policy, saved, actualSessionId, callerRoot, records): AdmissionResult<PersistedBinding>

pre：saved schema及其非空原mandatory真路径快照已验证，callerRoot为实际owner。callee：readPersistedBinding 的原快照、当前policy、parent树。两路共同先检查 actualSessionId=saved.sessionId、callerRoot=saved.rootSessionId；再逐项要求 saved.requiredExtensions 的每个id/path在当前policy中仍存在且path完全相同，缺失/替换返回restore-conflict，不能拿当前配置当原比较基线。

root分支：要求saved.kind=execution-root、root=self、agentId=main、parent/agentName/bootstrapRef均null；不查询child allowlist，也不要求null parent存在。

child分支：要求saved.kind=execution-child、agentId=self≠root且≠保留main、原canonical agent仍在当前名单、parent/bootstrapRef非空；从当前真实树验证同root父链、存在、无环及depth；把待恢复actualSessionId作为禁止祖先传入parentDepth（seen先含self），避免旧父链无环但接入self后成环。失败restore-conflict，没有new fallback。

两路成功保留原root/parent/self/agentId/agentName/bootstrapRef，并把已确认加载合同所对应的当前mandatory快照作为返回的requiredExtensions，以后由调用者在实际接线成功后追加binding；因此允许新增mandatory，但它成为后续恢复的新基线，不能再被删除。首单元只返回值，不写entry或声称扩展已loaded。有限快照/父链循环都有长度/seen界。证明：原快照建立不可缩减比较前提，kind分支消除root空parent误拒绝；身份只复制原值，非秘密基线单调增加，失败不消费dispatch或改saved。

### 5.2 owner、helper与原FSM通道

#### openOwnedRuntime(pi, ctx, config, deps): Promise<OwnedRuntime>

pre：session_start真实ctx、依赖可调用。具体B3/B4及通道合同以subplans/fsm-2-runtime-broker.md为本层细化。prepare先parse/build policy→SA ping/通过实际owner事件注册agent→daemon capability→实际HostIdentity→helper/Client/bridge/mandatory child注册→tools，逐项push disposer但ready=false；不在该startup handler里等其它串行handler。managed bootstrap记录实际factory初始化及本session startup tokens；只有healthy且完整受控运行所需资源全部prepared，才由commit提交ready，尚未实现的protocol/gate/child不能用noop标prepared。失败not-ready并逆序释放。循环有限。post：无半就绪执行域。证明：真实加载/启动与资源准备各有事实生产者，最后提交点同时检查二者；只释放本runtime资源，不启动daemon。

#### closeOwnedRuntime(runtime): Promise<void>

pre：属于本owner；callee：各resource disposer幂等。步骤close标记→拒绝新请求→取消未发送项→中止/回收本进程与judge→关闭HTTP和订阅→释放注册与协调句柄。已经close返回；异常逐项记录但继续处理剩余已拥有资源，不抹除已有FSM。有限disposer队列。post：无本owner活handle，新请求失败。证明：入口先撤销消除资源关闭期间新工作；各唯一资源只由自身disposer释放。

#### daemonRequestViaHelper(owner, route, body, deadline): Promise<DaemonReply>

pre：owner有效，route在broker内部固定集合。callee：根直接spawn mjs helper，Node HTTP socketPath，与原data_dir()/auth.token/x-fsm-auth。步骤剩余预算检查→stdin发送JSON→helper新读token→每请求短连接→返回status/JSON→route schema校验；session/register成功null只表示attempt结束，必须再GET session/source?session读回并核对实际root/pid/kind/cwd/URL，不能据null或source-auth提交登记成功；spawn/write/http/parse/deadline失败非成功；finally bounded kill/reap。helper自身PID不传给daemon，stdout不包含token。循环N/A，事件有deadline。post：只有实际route响应才确认。证明：peer父链与Client同源；identity响应在实际await写槽后，source登记则由现有读回route的存活过滤与owner字段建立确认，消除hook exit0或register null冒充事实；非幂等请求不重试。

#### invokeFsm(broker, principal, publishedName, input, signal): Promise<CallToolResult>

pre：authenticated execution principal、schema有效、owner ready。callee：固定tools/list索引→有界宿主canonical锁→register/identity helper→Client.callTool。步骤任何前置失败不写MCP→持锁完成session register尝试并source读回匹配实际owner→POST identity/acquire明确agent_cli=opencode、canonical tool→成功后write Client请求→验证reply→返回完整result。取消前未发送可取消，已发送异常delivery-unknown；finally释放锁；锁不等待child完成。锁等待及transport有deadline。post：所消费身份属于本调用关键区。证明：同physical AgentKey/canonical互斥跨完整区；identity失败不向Client发调用；未知不重放。

#### coordinateCanonicalCall(hostKey, tool, deadline, run): Promise<T>

pre：已验证实际pid/startId、catalog工具、run未发请求。callee：subplans/fsm-2-runtime-broker.md §3的共同私有coord scope、atomic mkdir及owner token。Linux从实际proc stat取ticks，macOS身份helper读同原FSM的timeval微秒；不以ps秒值/Date替代。取唯一目录lease→查owner/deadline→run→仅在响应完成或本Client已确认终结后释放自己token；unknown先等close，未确认则保留锁并错误，不抢stale或删其它lease。等待仅到signal/deadline。新宿主代际key不同，旧目录不冒充新owner。post：同键run不重叠，未获锁零run效果。证明：原子取得＋完整持有区间＋确切代际身份共同保证，不能先放锁再处理迟到响应。

#### registerProjectedTools(pi, broker, catalog): void

pre：完整经schema验证catalog，SDK工具名无冲突。callee：pi.registerTool。步骤每canonical生成稳定mcp__fsm__名称及原schema→执行回调使用真实principal并invokeFsm→保留content/structuredContent/isError/details。注册失败使owner not-ready，不吞掉个别工具。finite catalog。post：发布集与已发现工具一一对应。证明：来源唯一且不硬编码11工具清单，结果结构不降为文本。额外常用命令alias不在该函数偷偷增加。

### 5.3 记录与OC wire

本单元字段/工具/生命周期细化以`subplans/fsm-3-protocol-judge.md`为具体callee合同。header/entry的ISO timestamp先解析并校验为非负安全整数毫秒，保留raw字符串；message/event数值时间独立验证，非法拒绝不以now填充。全部wire时间和max用归一化整数。Judge Read目录采用真实readdir排序/offset||1/limit??2000窗口，不用无offset的SDK ls；Edit原生参数为path+edits数组，并显式承接空oldString新建与replaceAll分支。

#### publishSessionRecord(store, principal, facts): void

pre：principal有效、facts来自实际事件/SessionManager。callee：树合法检查及持久发布。步骤检查owner/绑定→合并本session真实facts→updated推进→先完整消息后terminal lifecycle；未知不按空状态覆盖。会话初建/变化/恢复/终结各使用实际事件，旧epoch拒绝。finite raw entries。post：没有跨root或假idle。证明：principal与事实同源，发布顺序决定daemon看到的每个完整snapshot。

#### projectOcMessages(record): OcMessage[]

pre：有效record和已捕获原始记录来源。callee：getEntries/getBranch，不用仅压缩后的messages。步骤选真实分支并保留必要原始工具history→按时间/记录顺序遍历→user/assistant/toolResult关联messageID/toolCallId→逐类型产parts/time/error→无法关联显式protocol-invalid，不制造缺失结果。finite entries。post：oldest→newest完整OC消息。证明：每工具结果关联实际call；压缩只是模型视图不删执行史；时间和错误来自事实。

#### projectOcRoster(store, root): OcSession[]

pre：root真实登记。callee：store snapshot。步骤验证root存在→执行树BFS，seen查环/重复→输出id,parentID,title,time.updated；judge单独root不挂到execution tree。源失效返回error不空数组。finite sessions。post：唯一root及真实全树。证明：parent来自binding、BFS覆盖可达后代，无runId冒充session。

#### projectOcStatuses(store): OcStatusMap

pre：当前runtime事实。callee：lifecycle映射。running/settling→busy；retrying→retry；真实idle/failed/aborted→idle且错误仍在messages；starting尚未ready→busy；unavailable导致503，不省略条目假装idle。循环记录有限。post：None live-work只在没有真实活孩子时可推出。证明：失联不等于停止，真实异常终结与正常完成由日志区分。

#### handleOcRequest(owner, request): Promise<HttpResponse>

pre：HTTP边界可任意。callee：auth验证→明确method/path parser→records/judge/delivery。步骤认证失败401→shape错400→目标不存在404→满队列/失效503→合法GET/POST交责任函数→JSON response或严格204空body。未知route404，无自动创建execution session。请求body/队列有明确上限，超过拒绝。post：每个原FSM消费route有真实行为，非成功不吞掉。证明：只有matched route才能执行唯一callee，GET无FSMmutation。

### 5.4 独立judge

#### createJudgeSession(owner, request): Promise<JudgeHandle>

pre：合法fsm-gate create请求、owner active。callee：SDK resource loader与工具factory。步骤构造独立目录/session→只装judge tool wrappers/provenance/capture→禁execution extensions与FSM tools→bindExtensions→登记独立judge metadata。失败dispose本次session，不返回假id。post：实际可续跑judge。证明：工具来源显式闭集，隔离源/dispatch，创建失败不影响execution root。

#### captureStructuredOutput(turn, schema, value): ToolResult

pre：本次judge turn、value任意。callee：schema validator。无效抛工具校验错误，不加入成功capture；有效追加本turn真实toolCallId/已验证object/时间到成功列表→返回真实tool result+terminate:true（terminate:true是execute返回值上由agent-loop在持久化前消费的批级早终止hint；持久化ToolResultMessage与OC wire part无terminate字段）。不同capture保留两份实际parts，交原driver判conflict/repair，不选择一个覆盖另一个。N/A循环。post：成功capture只来自有效调用，列表忠实保留重复/冲突。证明：validation是唯一写入口，旧turn捕获不沿用，正常收尾不在桥内消解冲突。

#### finishJudgeTurn(handle, turn, signal): Promise<FinishTurnDecision | undefined>

pre：SDK公开finishTurn wrapper已安装、原callback已捕获。callee：先await原callback保留turn_end/persistence。原error/length/aborted不成功；本正常完整批次至少有一条validcapture且无终结error→action:end，包含多个不同成功capture的conflict批次，否则返回原decision。conflict实际parts交原driver判定和repair，不留给桥继续模型回合消解。无新continuation，abort不作为正常结束。post：multi-tool batch也正常结束，失败优先。证明：调用点在整个批次结束，避免单工具terminate不能结束其它同批结果；没有写不存在的tool_result.terminate字段。

#### runJudgeMessage(handle, ocInput, deadline): Promise<OcTerminalMessage>

pre：现有judge id、合法system/tools/format/parts。callee：配置工具deny/allow、install capture/finishTurn、SDK prompt、project terminal。步骤reset本turn capture/provenance→执行→等待完整回合→失败分类优先→形成相同session/message/part identity envelope。missingcapture返回可被原driver识别的不完整，不在桥内部追加repair。deadline到期abort并保留日志，不delete。post：一个请求对应一个真实turn轨迹，callerside repair同sid继续。证明：终结后才投影，typed errors与capture分离；外部不会把半截内容当schema成功。

#### classifyJudgeFailure(terminal, provenance): OcNamedError | null

pre：真实stopReason/原异常，以及after_provider_response.status和provider_stream_event的原解析数据；不包含认证头。步骤：aborted→MessageAbortedError；length→MessageOutputLengthError；明确auth/context/content-filter语义→对应namederror；真实API错误按实际status/typed源分类；原源无法判断时返回unknown typed namederror（由FSM既有unknown有界重试处理），不凭含secret的error字符串猜isRetryable、不凭capture抹error。post：data是object，statusCode/isRetryable仅真实可判时给出；不捏造retryable事实。证明：有原事实才进入对应分支，无来源使用原consumer明确unknown路径而非假API成功。具体provider raw shape映射只作用于实际configured模型API，不宣称所有未来provider；映射用例在该子计划expectations固定。

#### abortJudge(handle): Promise<boolean>

pre：existing handle。callee：SDK abort/wait idle。已idle返回true；active→awaitabort→确认settled；未确认/deadline失败为503，不返回true。保存session/transcript不dispose当前可继续judge；owner shutdown另负责dispose。post：true是真的停止generation。证明：响应跟在取消等待之后，无“先答true再尝试kill”。

### 5.5 子派发与门禁

#### requestChildRun(owner, principal, params, signal): Promise<ChildResult>

pre：owner ready，params未获授权前任意。callee：admitChildLaunch→建立PendingLaunch/私有bootstrap→root SA RPC spawn，always native async runner→child握手→实际run completion。步骤名单失败零spawn→按受控definition注册固定runtimeName和FSM工具允许集→监听reply先于emit→握手前失败撤销pending→握手成功sync等待/async返回实际run。超时已spawn但未知结果不重spawn，保留failed/unknown记录。post：sync/async是表现差异，不改变受控执行。证明：SA spawn前和child任务前两层检查，不能从RPC文本推completed。

#### initializeChild(pi, ctx, startup): Promise<ChildRuntime>

pre：required child extension正在session_start，实际sessionId可取得。callee：捕获binding环境/凭据→根登记→restore或new绑定→registerFSMtoolsubset/gate→可靠actor acquire。步骤无bootstrap/owner/principal拒绝→策略不符拒绝→ready=false期间任何工具blocked→全接线/acquire成功写nonsecretcustombinding→ready=true。catch抛required startup error，根记录失败，task不开始。post：不是仅发ack就当健康。证明：awaitedstartup使firstprompt happens-after gate/acquire；损坏saved不能当new。

#### resumeChild(owner, principal, request): Promise<ChildResult>

pre：真实ownedrun目标，persistedfile存在。callee：restoreActorBinding与当前policy→SA resume保留原binding/required snapshot。stopped/不匹配拒绝；原file存在但invalid拒绝；通过则把原file/ID继续，不给新binding参数偷换。post：新runId不换actor，不认领新dispatch。证明：resume branch没有newactor allocation；daemon was_restored不popFIFO。

#### evaluatePermission(gate, event, ctx): Promise<ToolCallEventResult | undefined>

pre：真实tool_call含原JSON，gate ready。callee：基础normalize→原hook check-permission；FSM工具身份路径另走broker。FSM所属namespace走broker，其它包括nestedcalls/MCP按真实canonical/input；block返回block+reason，transport失败block；allow undefined。原始SA spawn/workflow bypass直接拒绝，read-only管理不允许修改准入。post：效果前阻断。证明：工具执行pipe await beforehook；gate不自行判FSMstatus。

#### evaluateBeforeSettle(gate, event, ctx): Promise<BoundaryResult | undefined>

pre：真实boundary。已有continue/pending上下文或outcome!=completed则pass；其余固定本turn完整assistant→single-flight stop/subagent-stop→allowpass；block返回在event.entries后追加custom_message(customType=fsm-compatible:stop、reason原文、display=true)并continue:true；transport失败依OCsoftgate诊断后pass。owner失效不向新ctx写entry。post：真实block可继续且不提前completed。证明：custommessage使context可继续，原prompt循环及SAagent_end cancel-drain保持等待，exception不能当阻止结果。

#### observeUserWait(gate, event, binding): Promise<void>

pre：明确本session的人类任务问答开始/结束，不是任意配置UI。callee：原gate suppress/release或ask-end，固定main身份守卫留daemon。无对应问答工具时不创造AskUserQuestion；普通prompt输入恢复实际等待状态，失败诊断而不改变permissionverdict。post：主等待抑制，child活动不能释放main。证明：事件与实际等待匹配且agentId来自binding，optional工具若后续增加只复用这条接线。

### 5.6 Watcher投递、恢复与安装

#### acceptAdvisory(owner, target, text): HttpResponse

pre：authenticated原Watcher请求。callee：当前ownedsessionlookup＋有界queue。未知404，失效/满503，合法push唯一deliveryrecord后204空body。无模型调用await，无自动replay。post：204确认接收而非消费。证明：唯一成功出口在入本owner队列之后，Pi void接口不被伪装成ACK。

#### drainAdvisories(runtime): void

pre：非空本会话队列，owneractive。callee：官方pi.sendMessage/发送用户消息，选择能够包含deliveryId details的custom message及triggerTurn/deliverAs。逐项scheduled；记录context/message事件消费；旧owner立即failed而不转新session；发送错误记录failed，不静默重发。loop每次取一项且owner取消停止，队列有限。post：目标正确且accepted/scheduled/consumed分离。证明：details关联本地delivery而不是以模型输出相似文本猜已读；私有方法/internal preflight不作为依赖。

#### recoverRuntime(owner, source): Promise<void>

pre：root原ID可确认。callee：刷新实际secret/routeregistration→重新openClient/capability→重新注册发现tools→records从rawheader/binding恢复。owner不匹配拒绝；mutation未知不回放；Clientrootreconcile继续使用原机制。post：同actor/新地址，不从旧pid日志推活跃。证明：stablebinding和freshrouting分离，状态所有权始终在daemon。

#### planInstallation(config): InstallationPlan

pre：明确实际官方Pi/SA/FSM来源与插件位置。callee：路径/version/capability静态解析。返回插件包入口、所需配置/名单和运行命令；不会自动改~/.pi或外部源码；有缺失给具体阻塞。post：安装依据可执行且无越界副作用。证明：所有写计划只归插件，runtime配置和账户授权显式；GUI/optionaltools不新增要求。

## 6. 完整性与证据状态

本文件按模块给出：函数签名、调用者所在模块、callee合同、成功/拒绝/异常分支、返回/副作用、循环终止及非平凡函数的pre→post论证。首子计划只承接5.1，完整核心仍须5.2-5.6依次实现。

- 分支、资源和数据合同为设计规定，不声称已经有对应代码或测试通过。
- 禁止用源码存在或上述条件论证冒充插件已运行；真实功能测试覆盖拒绝、失联和恢复，而不仅happy path。
- 依赖registration/defaults等外部行为使用实际公开版本能力；发生真实冲突先定位direct-owner合同，不修改官方源码或降级根Q。
- 本轮尚未执行workflow §4.4独立设计审查；阶段确认后按既定六条标准完成审查，不自行追加对抗评审或循环审核。

## 7. 首单元交付与下一步

首单元叶子合同：`subplans/fsm-1-admission-binding.md`。

事前expectations：`../../audits/fsm-1-admission-binding/expectations.md`。

机械schema：`subplans/fsm-1-admission-binding.schema.json`。

本轮无运行源码，无模型/FSM真实调用。用户确认细化后，先按workflow §4.4完成一次既定设计审查，再只实施首单元及其直接测试；不一次性跨所有模块编码。
