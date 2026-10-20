# fsm-compatible 架构合同

阶段：workflow §4.2 架构已交付；用户在交付后回复“继续”，据此进入 §4.3 细化。当前细化见 `detailed-design.md`，首个子计划为 `subplans/fsm-1-admission-binding.md`。没有运行代码或运行成功声明。

Q 的唯一归属：`../../principles.md`。源码依据：`../../research/fsm-compatible-research.md`、`../../research/runtime-source-conclusions.md`。后续细化和实现只能承接本层分配的合同；不得根据第三方实现局限反写 Q。

## 1. 本层 P：目标与兼容含义

根目标是原理上达到当前 haokun-code OC-level 的 FSM 完全兼容，并实际运行在官方 Pi 上。

“原理上兼容”在本架构中的判定对象是 FSM 的可观察合同：身份及状态栈、工具权限、派发认领、迁移与 self-check、Review、Stop、Watcher、Evidence、取消与恢复。适配器的内部步骤可以不同，但不能丢能力、改变裁决权、把拒绝变成允许、把未结束工作变成完成，或把基础设施失败包装为成功。不是要求模型生成相同措辞、GUI 一样或所有时间戳相同。

实现必须提供与 OC 消费接口对应的输入、结果和生命周期含义；模型判定的非确定性不能被冒充为软件接口缺口，也不能用于免除证据忠实度责任。

| P | 必须满足的性质 | Q 来源 |
|---|---|---|
| P1 | 当前 FSM Client 发布的工具完整可用，含注册、进入、状态、变量、self-check、迁移、dispatch、退出；结果及错误保留 | Q.I-1 |
| P2 | root、parent、self 身份正确；同名并发 FSM 调用不串身份，恢复不换 actor | Q.I-1 |
| P3 | 主子会话实际工具效果均执行现行权限门禁，嵌套调用及其它 MCP 不绕过 | Q.I-1 |
| P4 | 只能派遣当前运行域固定准入集合内的子代理；每个子代理必须加载 fsm-compatible 及规定必载扩展，在任务执行前认领派发；前后台、嵌套、取消与恢复有真实会话和完成状态 | Q.I-1、Q.I-4 |
| P5 | Review/Stop/Watcher 使用独立受限 judge；schema、工具策略、失败、repair、abort 与现行 FSM 消费合同一致 | Q.I-1 |
| P6 | daemon 能取得真实会话树、原始执行记录及 live-work，terminal 发布先于 idle | Q.I-1 |
| P7 | 主子正常结束受对应 Stop 控制；block 续跑、error/abort 不伪装成功；Watcher 接收和投递有真实目标 | Q.I-1 |
| P8 | 重连与原会话恢复保留身份和已有 FSM；不重复认领、不自动重放交付未知的状态变更 | Q.I-1 |
| P9 | 只开发插件，官方 Pi/原 FSM/第三方无源码补丁；GUI 非当前要求 | 既有边界 |
| P10 | 核心完成后增加常用 Pi 插件命令的 OC/FSM 语义映射，不只换展示名称 | Q.I-2，mandatory |
| P11 | 常用 OC 工具扩展单独声明支持集合；AskUserQuestion 等未实现时不得误报支持，也不阻塞核心完成 | Q.I-3，optional |

核心正常工作所必需的 wire、基础工具名/参数规范化以及 judge 的 Read/Grep/Glob 是 P1/P3/P5 的组成部分，不延后到 P10/P11。P10 是面向常用插件命令的扩充；P11 不包括删掉核心判定所需的基础调查能力。

核心阶段完成不等于整条必需工作线完成：P10 尚未完成时，不能关闭包含 mandatory 翻译的根目标。P11 未被选择时，不成为完成门槛。

## 2. M：模块与所有权

单 feature 为 `fsm-compatibility`；共享类型暂归本架构，不建立无实际跨 feature 消费的 product 层。

```text
官方 Pi 根扩展
  runtime-owner
    ├─ actor-binding / session-records
    ├─ fsm-broker ── 原 Client / hook / daemon
    ├─ session-gate（permission / Stop / delivery gate）
    ├─ child-launch ── SA 公开 RPC / agent registration / required extensions
    └─ oc-protocol
         ├─ session-records：roster/messages/children/status
         ├─ judge-session：官方 Pi SDK
         └─ watcher-delivery：目标会话接收队列

官方 Pi 子扩展
  child-binding + session-gate + FSM 工具投影
    └─ 经根 broker 登记、申请判定、调用 FSM、启动后代
```

原 daemon 拥有 FSM 状态、dispatch FIFO、Evidence 公共目录与裁决；原 Client 拥有 FSM 工具和 Watcher 调度；插件只拥有宿主事实、协议翻译与裁决落地。没有插件副本状态机或另一套 Review/Stop reducer。

每个根 runtime 的资源存于所属会话/扩展闭包。禁止插件自有跨会话全局可变 registry；同物理宿主身份槽的跨会话互斥通过明确的宿主级协调资源实现，不靠不同根各自的本地 mutex 假装隔离。

## 3. 核心数据结构合同

这些是语义类型，wire 的字段名在细化中按实际对端 schema 固定，不把 TS 内部命名误当外部协议。

### 3.1 ActorBinding

字段：rootSessionId:string、sessionId:string、parentSessionId:string|null、agentId:string、kind:execution-root|execution-child|judge、bootstrapRef:string|null。

不变量：root 的 sessionId=rootSessionId、agentId=main、parent=null；child 的 agentId=sessionId，不能占用根保留 agentId=main，且 parent 是真实调用父；judge 不进入执行 actor/dispatch/source 注册。ID 非空，执行父链无环，跨 root 不接受错误绑定。

唯一标识：执行 actor 为 (rootSessionId,agentId)，实际 Pi 会话为 sessionId；SA runId 只标识运行尝试。

生命周期：根 session_start 创建，child 在首个模型任务前建立；恢复从原 session header/custom entry 和原 launch binding 重建；关闭不删除已有 FSM 状态。

消费者：broker、gate、launch、records、protocol。写者：actor-binding；其它模块不能随意重定义 root/parent。

### 3.2 SessionRecord

字段：binding:ActorBinding、title:string、updatedAt:integer、lifecycle:starting|running|retrying|settling|idle|failed|aborted|unavailable、sessionFile:string|null、entries:原始执行记录来源。

不变量：updatedAt 因真实记录/生命周期改变而推进；settling 不等于 completed；failed/aborted 保留真实终结错误，unavailable 不能自动投影为 idle；judge 与执行树分开。

生命周期：登记到根 records；原始 SessionManager entries 或子会话实际事件/文件是证据来源；当前分支与全部历史分别可取，压缩不消除原始记录。恢复更新实时状态，不凭历史 completed 推当前 alive。

消费者：oc-protocol、Stop 的固定回合材料、通知路由。写者：session-records。

### 3.3 FsmInvocation

字段：binding、canonicalTool:string、input:JSON object、localInvocationId:string、deadline:绝对截止时间、outcome:未发出|等待响应|成功|失败|交付未知。

不变量：canonicalTool 是 Client 发布名；localInvocationId 只用于本插件关联，不冒充 daemon identity 槽或修改 FSM 协议。成功保留完整 CallToolResult；错误不转空成功。

生命周期：工具验证后创建；根 broker 先身份登记后调用，在响应/失败时释放调用资源。交付未知不能自动再发。

消费者：工具投影、broker；互斥键为实际宿主 AgentKey＋canonicalTool，不是 root ID。

### 3.4 ChildLaunchBinding

字段：rootSessionId、callerSessionId、agentName、bootstrapRef、executionMode:sync|async、resumeSessionFile:string|null、requiredExtensionIds:string[]、allowedToolNames:string[]。

不变量：秘密不进入此结构；每次嵌套 launch 显式携带 caller；resume 保留原 ActorBinding，不能用新 runId 换 actor；allowedToolNames 含实际发现的 FSM 工具和子运行入口且不越过明示 ceiling。

创建者：child-launch；消费者：SA 公开 launch、child session_start、actor-binding。

关联准入合同 ChildAdmissionPolicy：allowedAgents 为启动时从明确配置形成的固定 canonical agent 集合；requiredExtensions 为本运行域必载 ID/路径快照，必含 fsm-compatible；后代的 allowedAgents 只能等于或收窄父集合、requiredExtensions 不能缩减。空名单不允许派发，不回退为所有发现的 agent；模型、工具参数、别名或 agent defaults 不能修改此策略。恢复仍须满足当前准入和原必载合同；根/子binding都保存上次成功接线的非秘密mandatory id/path真路径快照，恢复从该原值与当前policy比较，缺失/替换拒绝，新增mandatory成功接线后进入新的恢复基线。root与child恢复分支分别核验身份，根不需要child parent或agent名单。策略冲突则拒绝，不能恢复为无门禁会话。该策略是 gate/launch/broker 的共同准入合同，不是 prompt 建议。

### 3.5 JudgeTurn

字段：judgeSessionId、system、allowedTools、schema、userParts、validatedCapture:JSON object|null、terminalOutcome:complete|length|error|aborted、message/part 身份及时间。

不变量：schema 通过且该完整回合无终结错误才产生成功 capture；tool part session/message ID 与 envelope 一致；独立 judge 不取得执行门禁；每次 HTTP message 对应一次真实会话执行，FSM caller 负责 repair/retry。

创建者：oc-protocol；写者：judge-session；消费者：FSM 原 judge driver。

### 3.6 AdvisoryDelivery

字段：targetSessionId、text、acceptedAt、state:accepted|scheduled|consumed|failed。

不变量：HTTP 204 只表示兼容宿主已接收进目标会话有界队列；不表示模型已经消费。目标未知/失效或队列满不得返回 204。无明确幂等键时不自动重复投递。

生命周期：Watcher POST 创建；所属 runtime 投递，记录消费或错误；root 切换不能把消息转到新 root。消费者：watcher-delivery、protocol、session-records。

## 4. 模块功能合同

### 4.1 runtime-owner

Requires：官方 Pi 所需公开 API 存在；实际 SA 能力与原 FSM wire/feature 准入成功；当前 session 身份可取得。

Ensures：建立本会话 bridge、Client、hook runner、必载扩展注册和服务路由；启动未完成时受控任务不可执行。关闭/替换会话注销相应可达入口并回收本 owner 的进程、订阅及定时资源，不销毁 FSM 持久状态、不触碰其它会话。

副作用：本插件运行目录、原 Client/hook 子进程、loopback listener；秘密仅经受控进程 env/权限限制凭据文件使用。禁止修改根 process.env、用户全局配置或隐式启动/重启 daemon。

### 4.2 actor-binding / session-records

Requires：真实 session header/事件或已验证 ChildLaunchBinding；记录能关联到当前 owner。

Ensures：提供唯一真实执行树与原始记录；恢复稳定 actor；有完整事实才提供 live-work 状态。外部派生字段不覆盖 actor 真源。

副作用：session custom entry 和插件归属的运行记录；不写 daemon-owned Evidence 公共文件。

### 4.3 fsm-broker

Requires：有效 execution binding；工具在 Client tools/list；输入满足发布 schema；本调用未过 deadline。

Ensures：登记源/身份后执行正确 actor 的 FSM 调用；同宿主同工具 acquire→response 区间互斥；完整保留响应/错误。只调用现有 daemon route，不发明 pi backend 或 request-id identity 协议。

副作用：FSM 本身承诺的状态修改。只对尚未发出的请求安全取消；已发未确认暴露交付未知。Client/hook 均由同根物理 Pi 进程直接 spawn，保持 AgentKey 一致；涉及 peer 归属的注册通过根直接 spawn 的 helper 调用现有 daemon 路由并检查真实响应；不把 best-effort hook exit 0 当登记确认，也不把 Pi 直接 socket peer 的父链误当 helper/Client 的宿主链。

### 4.4 session-gate

Requires：绑定与门禁在任务前已安装；真实工具名/完整 input 可取得，或正常 completed 的固定终结回合可取得。

Ensures：非 FSM 工具先 check-permission；block 阻止实际效果。FSM 工具走 broker 的 identity 路径。Stop 正常 block 提交合法 continuation entries+continue，allow 才正常 settled；error/abort 不自动复活。

Invariant：hook exit 0/2 是裁决权威；permission transport failure 拒绝、Stop transport failure 沿现行 OC soft-gate；handler throw 不能假装 Block。所有发生效果的受控入口，包括嵌套调用，必须经过相同门禁。

副作用：阻止执行/提交 continuation/移动 delivery gate；不自行解释 FSM 状态生成裁决。

### 4.5 child-launch

Requires：调用者有真实 binding；请求解析到 ChildAdmissionPolicy 固定集合内的 canonical agent，且为本机 native Pi runner；必载扩展与工具允许集可满足；深度/并发限制来自已接受配置。不能把可发现、可执行或权限允许直接等同于已获 FSM 派遣准入。

Ensures：每次 launch 显式 root/parent；task 开始前 gate/工具注册与 actor acquire 完成。FIFO 新 actor 握手逐个完成；已启动孩子随后可以并行工作。同步等待真实运行完成，异步返回真实运行身份并通知真实调用者；取消/恢复不换 actor。

副作用：通过 SA 公共 API 注册本运行域固定 agent 配置、启动及控制子运行。未知/已停止恢复目标按 SA 明确合同拒绝；不存在的 session file 不偷偷建新 actor 冒充 resume。

准入顺序：核实真实 caller→按固定快照解析 canonical agent/runner→检验名单及不可缩减必载扩展→检验 FSM tools/ceiling→提交 launch→验证 child session_start 的绑定、门禁和 acquire→允许首个任务。名单外、外部 runner、缺失必载扩展、启动失败或恢复冲突均拒绝，不降级。

覆盖范围：插件 facade、根 broker 接收的 child 请求、批量/并行、嵌套及 resume 都应用同一策略。FSM 管辖域内原始 SA spawn/workflow/其它插件派发不能成为旁路；未经受控入口建立 binding 的 mandatory child 在 startup 拒绝。不得允许用户可写的 internal=true 免检，不允许模型调用配置/agent 管理动作扩大准入集合。

### 4.6 oc-protocol

Requires：请求认证与目标存在；路由请求满足原消费者 shape。

Ensures：FSM 所消费的 session list/get/messages/children/status、judge create/message/abort、prompt_async 有真实实现；未知/不支持路由显式失败。不会因为 OC caller 请求而创建伪执行 root。

副作用：judge 创建、通知入队、judge abort；GET 没有 FSM mutation。

### 4.7 judge-session

Requires：有效 JudgeTurn、已确定模型与所需工具实现；wildcard deny＋明确 allow 策略可落实。

Ensures：执行同一独立 SDK 会话；StructuredOutput 正常捕获后通过公开 Agent.finishTurn 结束整个批次，先承接原 finishTurn 保留 Pi 的 turn_end/持久化。合法 OC terminal envelope 只基于真实结果生成。length/error/abort 优先；abort 真等待取消完成并保留日志。

副作用：请求允许的调查工具及模型调用；Review extras 仅实际授权集合；不继承执行任务的 FSM/source/dispatch/Stop 接线。

### 4.8 watcher-delivery

Requires：有效 target 和尚有容量的会话队列。

Ensures：收妥才发 204；按本会话 runtime 路由，真实排队/启动由官方 API 进行，消费/失败有记录；不误报 pi.sendUserMessage 的 void 返回为同步确认。目标失效、满队列或接收失败显式非 204。

副作用：上下文通知和可能的新回合，不作 Watcher 判定；判定、周期与重复发现抑制留原 Client。

## 5. 接口与全路径

| 接口 | 输入→输出 | 双方责任 |
|---|---|---|
| Pi tool→gate→broker | ActorBinding＋工具 JSON→门禁 verdict / CallToolResult | Pi 边界给真实 input；gate 不漏效果入口；broker 不重定义裁决 |
| child→根 bridge | ChildLaunchBinding/ActorBinding＋请求→登记/判定/工具结果 | child 用启动时捕获绑定；根校验 owner 和真实 parent，认证不在模型参数内 |
| broker→hook/Client | 已归一 stdin / MCP 请求→exit verdict / MCP response | 同物理父链；按 canonical tool 串行关键区；不能重放交付未知 |
| 根→SA | 强制扩展＋allowed tools＋binding→真实 child session/run | 公共 API；runner 启动成功并完成 child 接线才任务执行 |
| FSM→OC bridge | 原 OC HTTP request→原 shape response | bridge 保持完整协议含义，不把 200/空对象替代严格 204/terminal envelope |
| protocol→judge | JudgeTurn→OC terminal message | judge 实际执行受限工具；FSM driver 自己 repair/retry，桥不追加第二套 |
| records→Evidence GET | 真实树/记录/状态→OC roster/messages/status | daemon 拥有采集与固定目录；插件不得提供伪 idle 或压缩后残缺执行史 |

主调用：Pi 验证工具输入→gate→root broker 身份关键区→原 Client/daemon→可能反向 judge→完整工具结果→原始消息写入→正常 before-settle Stop→allow 或 continuation→最终 settled。

子调用：dispatch 入原 FIFO→受控 launch→child bind/gate/tools→确认现有 actor-acquire route 成功→允许 prompt→上述工具/Stop 路径→真实完成通知。恢复打开原 session 文件，先重建同 actor，再继续；恢复 actor 不消费新的 FIFO 条目。

Watcher：原 Client tick→daemon Evidence→HTTP 独立 judge→原 Client 决定投递→prompt_async→目标接收队列→官方 runtime 消费。

## 6. 并发与不变量

| 不变量 | 维护者与保持理由 |
|---|---|
| I1 真实 actor 身份不变 | binding 是唯一写者；恢复先读原 header/binding，再登记，runId 不参与替换 |
| I2 acquire 与实际调用不串身份 | broker 以实际 AgentKey/canonicalTool 协调所有根/子调用；跨根同宿主也不能各持独立无关锁 |
| I3 固定准入及子开始前门禁/认领完成 | launch/broker 都检查固定 agent 集合；后代策略只能收窄，必载扩展不能减少；required session_start 被 awaited，失败拒绝；可靠 acquire 响应是任务准入条件；工具白名单独立保证 FSM tools 可达 |
| I4 未获 Stop allow 不正常 completed | 官方 prompt 等待全部 before-settle continuation；SA agent_end 取消提前 drain，最终 settled/返回才完成 |
| I5 judge 不递归管辖自己 | judge 明确 kind，独立 ResourceLoader；不 register execution source、不启动 FSM Client、不给 FSM 工具 |
| I6 terminal 数据先于 idle | records 在完整回合持久化边界取数据，最终 settled 后发布 idle；failed/aborted 保留类别 |
| I7 交付未知不变成功 | broker/protocol/delivery 独立标记接收与执行；错误、超时、失联不由空结果清除 |
| I8 原 FSM 仍是判定真源 | gate 落地 exit verdict，judge 返回证据，原 reducer 决定状态；插件没有另一套 reducer |

锁顺序：宿主 canonical 调用协调→identity acquire→对应 MCP response→释放。该锁不用于 Stop、child-completion 等待或通知队列。Review 反向 judge 不申请 FSM 调用锁，消除该路径的循环等待。新 child 认领握手顺序独立于长期任务并发。

Rely：当前原 FSM 按 actor 串行、FIFO 和磁盘恢复合同工作；本插件不能和不遵守该身份关键区的外部调用者承诺同槽隔离。Guarantee：本插件域内所有实际 FSM 调用都经过同一规则，包括 child/嵌套/恢复。

## 7. 跨进程合同（workflow 附录 A）

| 维度 | 合同 |
|---|---|
| 连接 | 根 Client 为持久 stdio；hook 一次调用一次子进程；daemon HTTP-over-Unix 为原有每请求短连接；OC/child HTTP 可重建连接，disconnect 不注销 FSM actor |
| deadline | hook 使用现行默认/最低 900s，含 cleanup；能力准入按原 10s；collect/live/judge 等保持原消费者预算。所有本插件请求从真实 caller deadline 派生，不新增更短隐藏 timeout；具体 connect/write/read 和数值在细化固定 |
| retry/幂等 | judge repair/retry 由 FSM driver；插件不重试改变状态的交付未知请求。actor 登记恢复同身份；new launch/notification 没有幂等键就不自动重放 |
| 交付/顺序 | 同宿主同工具关键区及新 actor 握手有顺序；通知 204 只确认接收，未承诺 exactly-once 或模型消费；状态持久化先于 idle |
| failure | fail-stop 的进程/连接故障显式可见；permission fail-close、Stop adapter transport soft-gate 沿原行为；失联状态 unavailable。无认证跨主机服务不是本架构对象，不能以网络分区为由继续错 root 写入 |
| session/恢复 | root/actor 身份持久，源地址为可变路由；新会话不能承接旧消息。恢复原 file/ID/binding；失效 owner 不从旧日志猜存活；不要自动删除原 FSM 栈 |
| 背压 | notification、child-start、broker 等待队列容量均有限、配置必须正且在细化确定默认。满时显式拒绝/阻塞至 caller deadline，不静默丢掉新请求；不是无限缓存 |

秘密传播限 root-owned FSM 进程 env 和权限限制凭据文件；binding/日志/模型参数不得携带认证秘密。same uid 为原 FSM 的信任边界，不宣称插件实现 OS sandbox。

## 8. R：为何组成后满足 Q

源证前提来自源码补查，不重复一份代理报告作为证明：官方 Pi prompt 包含 before-settle continuation；SA 正常等待 prompt 且恢复原会话文件；公开 Agent.finishTurn 能结束 judge 批次；SessionManager 暴露原始记录；原 FSM 消费固定 OC 路由、使用已有裁决和 FIFO。

| 目标 | 模块组合 | 论证 |
|---|---|---|
| P1/P2/P8 | binding＋broker＋runtime | 实际 ID 与调用通道一一对应；互斥覆盖原身份槽关键区；恢复保持 actor，未知 mutation 不重放，因此迁移/退出等仍由同一原 FSM 决定 |
| P3 | gate＋broker＋受控 launch | 每个实际效果入口之前有同一真实 permission input 和原 verdict；mandatory child gate 与白名单分别成立，因此不止根会话受管辖 |
| P4/P7 | launch＋gate＋records＋官方运行链 | 在首任务前完成 acquire；Stop block 留在真实 prompt 循环，完成通知在该循环后；取消和异常保留错误而非正常完成 |
| P5 | protocol＋judge | 原 consumer 所需的独立上下文、工具策略、结构化 envelope 和 abort 都由实际 SDK 会话支撑；不改变原 driver 的 repair/reducer |
| P6 | binding＋records＋protocol | parent 来自真实调用树，消息来自原始执行史，idle 来自实际 settled；daemon 可沿原 OC 路由得到等价证据结构 |
| P7 Watcher | protocol＋delivery＋runtime | 204 有真实接收点，路由守 owner，官方消息 API 驱动会话；原 Watcher 判定与节流不变 |
| P9 | 所有模块 | 每个新增责任都在插件内，有公开 Pi/SA 接点；不以外部源码补丁消解任何未完合同 |
| P10/P11 | 后续独立适配工作 | mandatory 命令映射排核心之后；optional 工具按明确选择实现，不反向改变核心保证 |

本层是条件正确性论证，不是已运行证明：只有下层实现全部履行分配合同，组合才满足本层 P。任何局部缺口先由直接 owner 重算组合保证；若根 P 变弱，明确向用户报告，不藏在测试备注中。

Optimality：仅接 MCP 缺反向宿主通路；全面重写 SA 增加无必要调度责任；修改原 FSM/Pi 违反边界。当前组合新增的 bridge、broker、child gate 分别消除具体已知缺口，删除任何一个会断掉 P2/P3/P5-P7；不新增替代 FSM、判定器或通用 workflow。

## 9. 外部前提与未完边界

- 使用实际具备所查公开接口的官方 Pi 和当前 SA；版本/来源在实施时固定，包的 version 字符串不能代替 capability 准入。
- 当前 FSM wire 2/schema 2 和现行 source/identity/judge 合同为版本基准；原产品后续协议变更需要适配，不静默承诺任意未来版本。
- 本机官方 Pi 为执行宿主；FSM 核心要求固定可派遣范围并必载 fsm-compatible，SA 的外部 runner、未准入 agent、任意发现/别名/恢复均不能绕开。其它必载扩展的具体集合由明确运行配置指定；架构不擅自发明名单或扩展。支持任意 remote runner 不是现有核心功能合同。
- 原判定器对 Evidence/错误类别所需字段都必须忠实投影；不可取得的事实显式失败，不能推测字段来维持表面成功。具体错误来源与映射在细化逐项对应源 API。
- 真实 provider、预算和数据发送范围需在真实运行前明确；当前设计推进不是 token 消耗授权。
- GUI 延后；AskUserQuestion 等常用工具属于 optional 后续选择。现有 UI/用户输入触发的 FSM waiting/release 接线仍需核心支持。

## 10. 后续推进顺序

当前已进入函数级 detailed-design，首个准入/绑定子计划及其事前 expectations 已准备。细化阶段确认后按 workflow §4.4 的既定标准完成设计审查，再逐模块编码、直接测试、契约审核；后续子计划在编码前补齐各自 expectations。尚未进行审查，不因文档齐全声称审查通过。

核心实施次序：绑定/原通道与工具投影→protocol/records/judge→受控 child 生命周期→主子 gate/Watcher/恢复→安装和完整运行依据。按依赖实施，不交付不可运行骨架冒充核心完成。

随后执行 mandatory 的常用命令翻译；最后由用户选择 optional 常用工具支持。`AskUserQuestion` 不先于核心抢占当前焦点。

## 硬依赖声明：pi-subagents

本插件的子代理派发机制架构在 `third-party-plugins/pi-subagents/` 的公开事件 API 上（`prompt-template:subagent:request/response/cancel` 事件族、`registerAgentViaEvents`、`required-child-extensions`）。这是架构审查接受的取舍：用公开 API 而非重写 subagent 系统。

后果：
- SA 事件名或语义变更时本插件需跟进适配
- 无法在不改插件代码的情况下替换为其他 subagent 实现
- 准入控制（固定名单、必载扩展、递归收窄）是本插件自身逻辑，不受 SA 变更影响；但实际 spawn/运行/完成回执依赖 SA 执行
