# HC SubAgent over Nico：函数细化

状态：主线程定稿，2026-10-23。实现范围为 `architecture.md` 的 P1–P6。`test-contract.md` 的导出路径/类型/签名不得擅改；以下为其余生产模块的职责、调用顺序、退出及资源义务。不开展追加审查。

## 1. 复用及错误模型

- 复用 `vendor/pi-subagents/src/runs/shared/child-session.ts` 的独立 factory、ChildSession 与 JSON 事件投影；不走默认 index、global factory、完整 executor、async runner 的 stop/resume。
- 复用现有 broker/MCP、RecordStore、OcServer、permission gate、Stop-analysis/judge 原语；把 child 执行入口换成 Nico，不同时保留旧 worker、tmux、native proxy/file inbox。
- `HcAgentDomainError` 仅表示 HC 原本的域拒绝。四工具捕获它并返回 title/metadata={}/output=message；非域异常不伪装域结果，不截成通用成功或 stream unavailable。
- Promise 后台工作必须登记/观察失败。accepted/started 不等待最终 run，也不意味着失败可以无声丢失。异步失败进入目标实际错误事件/记录，不能改写已经给出的 accepted。
- SDK shutdown 使用上游既有有界 dispose；MCP/HTTP 调用沿现有 deadline/cancellation。没有新模型参数 timeout，没有隐式重试。

## 2. Session store 与 host 接口

实现模块按概念放在 `src/subagents/`。HC 固定类型见 test-contract §1；共享 SessionRecord 由独立 purpose-named 类型模块定义，consumer 为 directory、Nico host、lifecycle、HTTP projector、reports、UI。

`SessionDirectory` 负责 `get(sessionId)`、`list()`、`putCreated(record)`、`readTargetIdentity(sessionId)`、`locateOwner(sessionId)`；读不存在映 HC AgentNotFound。它的 SID 域包括任意存在的适配会话，不按 caller.root/cwd 过滤。身份/父链/文件/权限/模型/notify 在开始后台 prompt 前持久建立。

`NicoSessionHost` 拥有独立 factory 与活跃 handles，提供 create/open、deliver、cancel、observe、close；这些是本插件适配函数，不冒充 Nico 已导出的 API。每项调用都指向上游真实 create/prompt/steer/abort/dispose。constructor 不注册默认 extension，不引入另一套进程协议。

根 UI 会话使用真实宿主 handle；child 为 factory 创建的 SDK Session；恢复用同一真实 sessionFile。协议 SID 与 hostSessionId 不同则显式映射，投影/事件/actor 不得混用。模型/variant/权限读取目标自身记录，不从发件人或默认 Nico profile 补写。

### 2.1 create/open

前置：caller 已存在；definition/model/permission/instanceDirectory 已由 lifecycle 决定；Session 记录的 parent 链真实无环。

1. 选择既有 file storage 或为新 Session 准备持久 file；不使用 memory 代替可恢复会话。
2. `factory.create` 传 instanceDirectory、显式 model、parentSessionFile、父 provider registry、必要工具集合与本插件 inline hooks。`ambientExtensions:false`，不调用 Nico buildInProcessChildLaunch 的默认 fanout/prompt-boundary。
3. 工具来自 HC 定义、Pi 原生工具和 FSM 投影；不把 Nico codemode/workflow/supervisor/acceptance 工具自动带入。factory 的条件 codemode 行为通过实际 tools/excludeTools 对齐，不以“未注册默认入口”猜其不存在。
4. 成功保存实际 child.sessionId/sessionFile/provider/model 等事实、安装 subscribe；建立一致协议 ID 与真实父链；发布 created/actor 之后才允许 prompt。
5. 创建失败：只释放已取得的真实资源；不报告 Started；若目录已留下残余，按 HC WorktreeUnavailable 保留其路径，不自动删除证据。

正确性：显式输入排除了 Nico 默认模型/cwd/深度的替代；持久模型与权限先于调度，避免早到 send 采用缺省身份；同一 source record 为 HTTP/actor/工具生成同一 ID。副作用仅新 Session/其目录、catalog 与对应 SDK handle。

### 2.2 deliver、运行观察与尾部输入

前置：已解析存在的目标；发送内容/身份由 inbox 构造；接受调度后不要求同步消费。

1. 拥有本地 handle 时，按真实 session event/run promise 判断当前 loop。空闲/已 abort：启动 `prompt(text)` 并立即观察该 promise；busy：调用 `steer(text)`，不用 followUp 改变 HC 下一步消费语义。
2. 消息路由到其他 owner 时使用现有 OC Session async/message 接口；不向调用者额外暴露 runner/runId，不建立新文件 inbox 或幂等键。
3. agent_start/auto_retry 等更新实际 busy/retry；tool/message 事件更新对话与 usage；agent_end 不是单独的最终完成依据。`agent_settled`/prompt 结局与排队事实共同决定该轮结束。
4. 在尾部与消息并发时，owner 维持一个 loop，排队输入尚未消费就不报告该轮 completed。对已入队输入使用 SDK 实际 re-arm/queue 行为，不重复提交同一 body、不用空 user turn 伪造唤醒。若上游窄接口不足，补宿主 SDK 输入适配并向主线程说明实际 callee，不捏造 factory 方法。
5. 正常结束更新 idle/结果事实并触发 run report；失败保留 error/partial history；取消保留 history。迟到的上一轮 promise 不覆盖已启动新一轮的事实。

正确性：单 owner loop 与真实事件保持同一 Session 的上下文和状态；模式只在 idle/busy 两路选择 SDK 对应原语；尾部排队是 pending turn，不被当作完成证据。accepted 只承诺调度，不增加消费/回复保证。所有等待继承实际 SDK/host 取消，所有后台 promise 有失败观察。

### 2.3 cancel/close

cancel 前置为该 Session 存在。调用真实 child.abort（根用宿主 abort）；等待该次取消完成，保留 Session record/文件/模型/权限，更新真实 idle 事实。不调用 dispose，不先问 normal FSM Stop，不把 idle 当异常；多次 cancel 可执行。

close 仅由 owning runtime shutdown 发起：注销订阅/投影回调 → 取消所属真实运行 → factory.dispose → 关闭其连接和监听。上游有界 shutdown 生效；不删除会话、run evidence 或调用未归属本 runtime 的进程。close UI/run-end/FSM exit 均不得调用它。

正确性：abort/dispose 两条职责互不替代，取消不销毁恢复资源；最终 shutdown 集中释放实际资源。子循环遍历有限 handle 集合，有界关闭按现有 deadline 返回，不靠无限等待退出。

## 3. HC facade 与纯函数

### 3.1 `registerHcAgentTools`

前置：directory、host、FSM gate 已组装。构造四个 HC schema，只有原字段/description，无 additionalProperties:false、minLength、静态 type enum。描述按当前 permitted definitions、mode/depth/provider 投影产生；最终深度集合用 `availableAgentTools`。普通 Pi 原生工具渲染不替换。

执行时从真实 toolCall/assistant 分支取 caller/model；非 assistant 的非法前置依 HC 原 Error，不自造参数回退。agent subtype ask 是单独责任；普通 FSM tool_call 仍按实际工具名/原参数上报。内部操作返回 `HcToolOutput` 后只投影成 Pi text content 和对应 metadata，不把整个对象 JSON.stringify 给模型。

成功、已知域错误、非域异常三路分别为正常 HC 回执、普通 HC 错误正文、真实工具失败。后两路不混同。所有工具返回路径无后台完成等待。

正确性：入口只取 schema 中的业务字段，真实 caller 不由模型指定；纯 formatter 唯一生成可见文本；三种结局保持 HC 分类。没有可执行 task/Agent/agent_status/resume/wait 旧入口。

### 3.2 tree、message、output、model/toolset

严格执行 test-contract §2–6。callees 是真实 directory 快照、字段转义和同模块纯 formatter。

- neighborhood 先查 caller 与父链，再收 self/parent/children/siblings，最后排序/映 running；缺 caller 提前域失败，无状态修改。
- resolve 先做 ses 前缀直通；否则查上述邻域和 scope，再分 0/1/多匹配返回/抛源消息。SID 直通不是存在性或 stop 授权证明。
- stop planner 先查 target 存在/直属，再收全部后代，按深度分组；有限真实树每成员只遍历一次，深度递减组数有限。同层没有额外全序保证。
- output formatter 按 HC 模板处理 truthy 可选行/failed 分块；metadata/title 与正文各有原职责，不从显示状态派生完成原因。
- message 只转义头字段，原 body 不变；model pin 优先，depth 默认 3。单步转换为 trivial，其余排序/遍历保持预述集合与次序，穷尽正常/域失败分支，无副作用。

正确性：集合筛选等于 HC 邻域定义，排序等于其 relation/time/id 关系；scope 在名字路径应用，SID 的更宽寻址留给调用方。头字段转义不触碰正文，formatter 的拼接分支与原模板一一对应。

## 4. lifecycle

### 4.1 create

前置：真实 caller 与 assistant turn 可取，type/name/cwd/prompt 来自 facade。

1. 查 caller；读 `subagent_depth ?? 3` 与真实 depth，达到上限返回原 DepthLimitReached。name truthy 时先检查 ses 前缀和同根已用名；不自动补名字、不为并发冲突添加唯一锁承诺。
2. 查 type；unknown available 取 HC 不 hidden 的 catalog 名称。动态描述过滤与 get(type) 不互相替代。
3. child pin model 优先；否则 caller 当次 assistant 模型。pin 时不继承 caller variant，否则继承；缺 variant 持久 default，对目标输入再转 undefined。不要改成继承 Nico default。
4. 按 HC 目录准备（显式 cwd 只 resolve，省略创建新目录）；按 HC 规则派生 child permission。失败返回源 WorktreeUnavailable，不启动/登记一个虚构 child。
5. host.create → 持久 child title=`description (@type subagent)`、parent、model、permission、name/workdir/description/notify=true → created/actor → 解析原 prompt parts，前置目录指令和受权限控制的 parent/running-sibling snapshot → 调度首轮。
6. 登记 delegation started；返回 `formatAgentStarted`，不读取是否已经 busy 来改文案。后台失败走真实目标错误/每轮分类，不把已回执伪装同步调用。

正确性：先检查后建目录/会话，错误不留虚构 Session；身份和模型在首次调度前确定，输入 snapshot 仅当时事实。loop 对有限 sibling 集合排序后取 HC 上限10，不把它当后续 agent_list。

### 4.2 send

前置：caller 实际存在。resolve neighbor → 目标存在 → self 拒绝 → 从 caller 注入 sender/name/type → `renderAgentMessage` → 读取目标自身 model/variant/permission → deliverAsync → `formatAgentAccepted(input.target,resolvedSID)`。

解析/查找/self 失败返回原域错误；异步调度后的失败不改写 earlier accepted。没有同树门禁，没有 model/provider/sender 覆盖参数，没有 target completion wait。

正确性：resolve 与存在性/关系的不同责任逐步承接；身份来自两个真实 Session 而非 message body；回复仍须目标另发 agent_send。

### 4.3 stop

`planAgentStop` 的深度组是有限输入。逐组由深到浅 `Promise.all` 执行 host.cancel；单项成功加入 stopped，失败记录 String(error)。不得在成功项中只选原先 busy 的成员；重复/idle 取消也 performed。

遍历后向 caller 发送一条来自 target 的 HC cancellation message；不向 stop set 中各父逐个唤醒。该通知失败不计入 failed。返回 `formatAgentStopped`。不调用 normal Stop judge、dispose、目录清理。

正确性：直属检查由 planner 完成，深度顺序令后代先取消；各组收集穷尽其成功/失败，不承诺同层返回次序；单条 caller 通知避免取消后又启动中间父。

## 5. 每轮报告与正常 FSM Stop

### 5.1 classify/report

按 HC `agent-management/delegation.ts:48-185` 实现分类，不发明模型结果：abort 优先 cancelled；assistant error/length → failed；末个 tool error → failed；missing/unknown finish 且无 usable output → failed；其余 completed，正文只取最后 text part，可为空。

length/error excerpt 按 HC escaped UTF-8 byte/line 限额，原始全文仍在真实 child file。缺失的 usage/error 信息不得猜造成源数据；若 Pi 投影缺字段，报告具体 SDK 缺口并实现适配，不能称已经等价。

report 前置为一次真实 run 已结束、parent_id 存在、notify=true。pending user turn 或 live descendant 时延后；子树后续 settled 再检查。cancelled 只发 delegation settled。completed/failed 重新读父身份，生成 HC renderOutput 与 synthetic agent_notification metadata，异步送父；finally 发布 settled，投递错误保留诊断。不能由 settled 推出消息已消费。

正确性：分类顺序保持 cancellation 优先；延后条件避免漏 pending work；每个真正结束轮次的报告资格与父当前身份分离，因此 send 续行也有报告，不依赖首次 job。

### 5.2 normal Stop

idle/稳定 assistant terminal 是触发信号，不是同步否决位置。按 HC FSM plugin 的 Stop controller 顺序判决；复用已有 hard/soft analysis 与同模型 judge，拒绝向原 Session 续投 continuation。judge 无 execution parent，不消费 dispatch。

当前 HC 的父报告链没有 StopAllow 屏障；按本轮最新一比一选择，不保留旧 before-settle 的更强 child 上报承诺。显式 stop 是取消，跳过正常 Stop 审批。不得把未 exit FSM 的 Session 自动关闭。

正确性：FSM controller 与 report 是独立事件链，匹配原系统实际时序而不是理想化先后；触发使用同一 Session/actor，拒绝后续跑仍是原 ID。

## 6. FSM 与 HTTP facts

caller/binding 从同一 SessionRecord 派生：根 `(rootSID,main)`，所有后代 `(rootSID,childSID)`。首建 actor 走服务端真实 acquire/FIFO，已恢复 actor 不重新 enter/消费帧。fsm_dispatch_subagent 仅排队，之后 agent 才创建执行者；不加 callID 队列预留。

保留 `agent→Agent` 名称映射和原参数，其他三名不变；native file tools 仅在上报边界映射。HTTP Session/children/status/messages 读取同源事实，不能解析 agent_list TSV 当查询实现；judge 保持独立。

修复已观察到的失效 channel 缓存：初始化 rejection 与已建立 broker unusable 分别处理；仅当前 cache entry 仍指向失败实例时移除，避免旧调用删除后来实例。root/child 均不得永久复用 dead broker。原请求保留原错误/delivery-unknown，不自动 replay mutation；以后显式调用才可取得新 channel。已有 deadline/signal 继续贯穿，关闭时释放每个实际取得的 channel，不重开已 shutdown runtime。

连接模型：Nico child 为同进程直接方法，无 child MCP-over-HTTP proxy；FSM 仍走既有长寿 MCP transport，OC facts/跨 owner 消息走现有 HTTP 接口。断链不删除服务端帧/Session，不声称 exactly-once。MCP timeout 已发送请求可能结果未知，不把重连当重放授权。现有 source 注册/身份 acquisition 是 FSM 协议所需，不另加 hash、版本或恢复契约。

正确性：cache ownership 比较针对已观察并发 eviction 风险；删除的是失效连接引用，不是业务状态。重新连接只影响下一次明确调用，因此不会把一次不确定 mutation 执行两遍。

## 7. UI、替换与直接测试

核心运行不依赖 hasUI。需要 UI 才组装真实事实到 Nico foreground/history state；Fleet 为只读，不造 async/workflow 记录去绕过其 selectors。sessionFile/artifact 路径必须是实际可读取的原日志；若有组件限制向主线程报告，不把空详情当真实无输出。

保留 above-editor 的按需 widget，无 child 隐藏，活跃项优先；展示真实 model/context/tokens/elapsed/recent timestamp，未知字段不编零。widget 按事件更新，查看器的上游 timer 在关闭时释放。

整体切换调用点：extension/openOwnedRuntime、四工具注册、RecordStore/OC handlers、FSM projection/gates、UI/root shutdown。删除旧子进程/tmux/bootstrap/file inbox/native proxy 和不再使用的旧模型工具接线；历史 evidence 不删，旧实验不用改期望来证明新实现。

直接测试层级：独立 Sol 的纯合同单测 → Nico factory 与假 provider 的实际 headless/abort-resume/消息/关闭测试 → reference package 给出的同一 HC/Pi 剧本和 FSM traces。使用 fake/本地mock，不调用真实LLM。新增或修改测试必须实际运行；不跑全套Vitest/npm test/npm build，不因单位测试通过声称全协议兼容。

实现按上述模块推进；需要改导出签名、降低保证或增加新政策时返回主线程决定，不让实现者与单测作者互加要求。根检查脚本带写入官方源码的风险必须向主线程报告，不自行扩大可写范围。
