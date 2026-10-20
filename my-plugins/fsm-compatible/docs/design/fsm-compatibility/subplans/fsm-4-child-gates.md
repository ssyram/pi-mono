# fsm-4-child-gates：受控派发、permission/Stop 门禁与恢复

状态：闭合原审查 B6/B7/B8 的编码前叶子合同；本单元尚无生产代码。父合同：architecture P3/P4/P7/P8、I3/I4，detailed-design §5.5。fsm-1 准入/绑定、fsm-2 broker 通道、fsm-3 记录/judge 均已独立 PASS，直接复用不重开。

## 1. 目的与 callee 绑定

主/子会话的每个实际工具效果先过原 FSM check-permission 门禁；派发只能走固定准入集合且新 actor 认领握手串行；异步完成/取消按真实调用者关联；正常结束受 Stop 控制；恢复保留原 actor。裁决权全部留原 FSM；本单元不新增判定器。

callee（均为一手已核对）：

- SA 结构化委派 API（docs/extension-api.md §Structured delegation + src/api/delegation.ts）：emit `prompt-template:subagent:request` {requestId,ownerRunId,nodeId,agent,task,context:"fresh",cwd,result...}；订阅 `...:response` 按 (requestId,ownerRunId,nodeId) 精确关联，每个 attempt 至多一个 terminal response（status 含 completed/failed/timed_out/cancelled/.../duplicate_node/invalid_request）；取消 emit `...:cancel` 同三元组（含 cancel-before-start）。同一 node 二次 active 得 duplicate_node 不扰动原请求。任务/schema/文本有界（64KiB schema、1MiB 文本）。
- SA runtime agent 注册（src/agents/runtime-agent-registry.ts / runtime-agent-events.ts）：`registerAgent({pi, name, definition})` 把固定 canonical agent 定义注册到 SA 自身 owner；definition 的 tools/extensions/runner/machine 等由首单元 ResolvedAgent.definitionSnapshot 提供，本单元不放宽。运行时注册走已查明的 `registerAgentViaEvents` 事件路径（`pi-subagents:runtime-agent-register:v1`），注册结果/失败真实检查。
- SA required-child-extensions 公开导出：按真实 sessionId 注册 mandatory 扩展（requireForAllRunners=true），返回仅释放本注册的 disposer。
- 原 hook/daemon：POST `/check-permission` body {session_id,agent_id,tool_name,tool_input}，响应 {allowed,reason?}；transport/parse 失败 fail-close（exit2 语义），允许/拒绝二值，拒绝原文进 reason。POST `/stop-check`（外层 soft-gate：transport 失败按现行 OC soft-gate 放行；legal_pause=false 已知时 fail-closed）。两路由加入 broker helper 固定 allowlist，仍经每请求新 token 的根直连 helper 调用并读实际 HTTP 响应，不以 exit0 推断。

## 2. B6：新 actor 认领握手串行化

RootOwnedLaunches 持有 launch 串行队列（每 root 一个，容量=配置 queueCapacity，满时副作用前 queue-full）：

- requestChildRun：admitChildLaunch（首单元合同）→ 入队；队列按 FIFO 逐项执行「握手段」：建立 PendingLaunch/私有 bootstrap → emit delegation request → started 事件仅确认启动（SubagentDelegationStarted 只含三元组，不携带 runId/SID；runId 从后续 update/terminal 事件取得）→ 握手段完成以 child 侧 initializeChild 登记为准（bootstrap 捕获 + bind + gate + actor-acquire 确认），不依赖 started 携带 SID → 出队放行下一项。握手段失败/超时（childStartTimeoutMs）出队并记录 failed，不阻塞后续；已 spawn 但结果未知保留 unknown 记录，不重发。
- 已完成握手的 child 长期工作不占队列；同一 (ownerRunId,nodeId) 重复 active 请求被 SA duplicate_node 拒绝后原样上报，不重试。
- 恢复（resumeChild）不进入该队列：不认领新 dispatch FIFO，走 §5 恢复分支。
- 队列等待受 caller deadline/signal；取消在握手前移除未开始项，握手已开始的取消走 B7 cancel；实现时须直读 required-child-extensions 导出一手源核实必载不可缩减语义。

## 3. B7：真实调用者完成/取消接线

- ChildRun 表：runKey=(ownerRunId,nodeId) → {callerSessionId（来自已认证 principal，非模型参数）、binding、requestId、terminal|null}。订阅注册先于 emit（SA 合同要求）；response 事件按三元组精确匹配，不按文本猜。
- 同步请求：await terminal 后返回真实 status/result/usage；async 请求：入表即返回 runKey，terminal 到达时通知真实调用者——通过该 caller session 的记录/通知通道（fsm-3 RecordStore lifecycle + runtime 事件），不向 root 或其它 child 投递；caller 会话已失效则记录 failed 不转投。
- 取消：对 exact 元组 emit cancel；等待对应 terminal（cancelled/interrupted/completed 均可能，以实际响应为准）；deadline 前未得 terminal 为 unknown，不重发 cancel，不伪造 cancelled。工具结果未知路径同 fsm-2 原则。
- terminal 状态映射记录 lifecycle：completed→idle；failed/timed_out/tool_budget_exhausted/structured_output_failed/acceptance_failed/unavailable_context→failed（错误保留）；invalid_request→failed（属桥自身 bug，需记录诊断）；cancelled/interrupted→aborted；unknown 保持 unavailable，不投影 idle。穷举覆盖全部 SA status 枚举。

## 4. initializeChild 与门禁安装

- 根在 SA 注册固定 runtime agents（definitionSnapshot 深冻结副本；tools=该 agent 的允许集含 FSM 工具投影；extensions=必载真路径含 fsm-compatible；runner 仅本机 native）。注册失败 not-ready，不降级。
- child session_start（fsm-compatible 在 child 内运行）按 fsm-2 managed bootstrap：读 bootstrap 凭据/环境 → 根登记校验 → restore 或 bindNewChild（首单元）→ 安装 §5 会话 gate → 真实 actor-acquire 成功 → 写 non-secret binding custom entry → ready。任一步失败抛 required startup error，任务不开始；损坏 saved 不当 new。
- 每级 child 的准入策略由 narrowAdmissionPolicy 单调收窄；child 内再派发走同一 requestChildRun/队列/门禁（本插件在 child 中同样加载），嵌套不旁路。

## 5. permission 与 Stop 门禁（B8 normalizer）

evaluatePermission：pi `tool_call` 事件（含 nested executeTool 的 parent 聚合前各实际调用）→ normalize → helper POST /check-permission → allowed→undefined 放行；denied→{block:true,reason:原文}；transport/parse 失败 fail-close block。FSM 投影工具（mcp__fsm__*）不走该门禁（broker identity 路径已是唯一入口）；原始 SA spawn/workflow 绕过入口的调用按架构 §4.5 拒绝。

Normalizer 映射（Pi 事件 → OC tool_name/tool_input；未知工具按原样名称发送，不猜语义；映射只重命名/搬运字段，不改值）：

| Pi tool_call | tool_name | tool_input |
|---|---|---|
| read {path,offset,limit} | read | {filePath:path, offset, limit}（缺省字段不造） |
| bash {command,timeout,workdir} | bash | {command, timeout, ...(workdir?{workdir}:{})} |
| edit {path,edits[]/oldText,newText} | edit | 单个 tool_call 恰好一次 check；多 edits 条目时以完整映射 input `{filePath, edits:[{oldString,newString}…]}` 原样搬运一次提交，denied 整体 block，不逐条拆分门禁 |
| write {path,content} | write | {filePath:path, content} |
| grep {pattern,path,glob,...} | grep | {pattern, ...(path?{path}:{}), ...(glob?{include:glob}:{})} |
| find {pattern,path} | glob | {pattern, ...(path?{path}:{})} |
| ls {path} | ls | {path} |
| powershell | bash | {command}（Windows 对应；无则原样名） |
| mcp__server__tool {…} | 原样全名 | 原样 input |
| 其它/自定义 | 原样名称 | 原样 input |

nested executeTool：Pi 对嵌套调用同样发带 parentToolCallId 的 tool_call 事件（id `<parent>/<n>`），gate 按各实际事件独立门禁，不因父已允许而放行子；聚合记录留 Pi nestedCalls。

Stop：pi agent_before_settle（outcome completed 且无已有 continuation 才评估）→ helper POST /stop-check {session_id,agent_id(main 或 binding.agentId),last_assistant_message:本turn完整assistant文本} → block→在 event.entries 后追加 custom_message(customType=fsm-compatible:stop、reason 原文、display:true)+continue:true；allow→undefined；transport 失败按 OC soft-gate 诊断后放行。subagent Stop 用同一入口，agent_id 取 child binding。不自行解释 FSM 状态。

## 6. 恢复

resumeChild：目标 run 的 persisted file 存在且属本 root；restoreActorBinding（首单元，含原 mandatory 基线）→ SA 侧恢复经原 session 文件（保留原 SID/绑定），不经 B6 队列、不认领新 dispatch；stopped/不匹配/损坏 file 拒绝；恢复后接同一 gate/Stop 通道。

## 7. 函数推导要点

- requestChildRun：principal 校验→admitChildLaunch→入队→（队列内）delegation emit→started/response 关联→initializeChild→actor-acquire→放行/失败出队。有限状态：allocated/registered/acquired/failed/cancelled（首单元 PendingLaunch）。
- onDelegationResponse：三元组匹配→runKey 查表→terminal 记录→按 callerSessionId 通知→lifecycle 映射。重复 terminal（违反 SA 至多一条）protocol-invalid 拒绝第二份。
- evaluatePermission/Stop：事件→normalize→helper→二值/soft-gate→Pi 返回形状；无本地缓存判定。
- 所有队列/表有界；timer unref；owner close 时取消未开始项、断开订阅、abort 进行中 delegation（记录 unknown/aborted，不假 completed）。

## 8. 测试计划

fake delegation 事件总线（emit/on 精确复刻 SA 事件合同）+ fake helper（/check-permission、/stop-check 可脚本化）+ 真准入/绑定模块 + faux child ctx：FIFO 串行（并发两 launch 握手不交错、失败出队不阻塞）、duplicate_node 上报、cancel 竞态（before-start/进行中/terminal 已发）、terminal→lifecycle 映射、unknown 不投影 idle、normalizer 全表+未知透传+nested 独立门禁、permission fail-close、Stop block 续跑 entries/soft-gate 放行、恢复保留 actor/坏 file 拒绝、容量/取消清理。无真实模型/网络；SA 真实集成烟雾留安装单元。

## 9. 退出

B6/B7/B8 经原 workflow 六项标准设计确认 READY 后编码；实现后全量直接测试+一次独立合同对照；fsm-5（Watcher/等待/安装/完整运行）与 mandatory 翻译责任不变。
