# Contract Expectations — fsm-4-child-gates

事前源：architecture P3/P4/P7/P8、I3/I4、§4.4/4.5；detailed-design §5.5；subplans/fsm-4-child-gates.md；原审查 B6/B7/B8。本单元尚无生产代码，不倒填实施位置。

## 1. 契约源

SA 结构化委派 API（prompt-template:subagent:* 事件族、三元组身份、至多一 terminal、cancel 含 before-start）；SA registerAgent/registerAgentViaEvents 与 required-child-extensions 公开导出；原 hook /check-permission {session_id,agent_id,tool_name,tool_input}→{allowed,reason} fail-close、/stop-check soft-gate；首单元准入/绑定合同。判断基线仍是完整 OC-level 兼容。

## 2. 字段/Schema

delegation request：requestId/ownerRunId/nodeId/agent/task/context:"fresh"/cwd/result；agent 必须命中固定 canonical 名单。terminal response：status 枚举按 SA 原文，error/result/usage 原样保留。check-permission body 四字段精确；tool_input 为映射后的完整 JSON，不丢被检查路径。Stop body 含 last_assistant_message 真实文本。binding/PendingLaunch 沿首单元 schema，无新增模型可写权威字段。

## 3. 枚举

PendingLaunch：allocated/registered/acquired/failed/cancelled。terminal→lifecycle：completed→idle；failed/timed_out/tool_budget_exhausted/structured_output_failed/acceptance_failed/unavailable_context→failed（错误保留）；invalid_request→failed且记录桥bug；cancelled/interrupted→aborted；unknown→unavailable（不 idle）。穷举覆盖全部 SA status。normalizer 工具名映射表固定（read/bash/edit/write/grep/glob/ls/powershell→bash/原样 mcp/原样未知）；不发明新映射类别。

## 4. 流程

P1 principal→admit→FIFO 队列→delegation（started 仅确认启动，runId 取自 update/terminal，握手完成以 child 侧 initializeChild 登记为准）→放行下一项。
P2 订阅先于 emit→三元组匹配 terminal→按 callerSessionId 通知→lifecycle 映射。
P3 tool_call→normalize→/check-permission→allowed/denied(block+reason)/transport fail-close(block)。
P4 agent_before_settle→/stop-check→block 追加 custom_message+continue；allow/soft-gate 放行。
P5 resume 走恢复分支，不入队、不认领新 dispatch。

源码流程保留 Step Pn 注释。

## 5. 行为

- 同 node 重复 active 得 duplicate_node 原样上报，不重试不扰动原请求。
- 握手失败/超时出队记录 failed，不阻塞后续；已 spawn 未知结果保留 unknown，不重发。
- FSM 投影工具不经 check-permission（broker 路径唯一）；绕过受控入口的原始 spawn/workflow 拒绝。
- nested 调用按各实际 tool_call 事件独立门禁，父允许不放行子；同一 tool_call 恰好一次 check（edit 多 edits 条目以完整 input 一次提交，denied 整体 block）。
- normalizer 只重命名/搬运，不改值不造缺省字段；未知工具原样名+原样 input。
- 恢复保留原 actor/SID/mandatory 基线；stopped/不匹配/损坏 file 拒绝，不 new fallback。
- runtime agent 注册用深冻结 definitionSnapshot；失败 not-ready 不降级；后代策略单调收窄。

## 6. 时序/状态

订阅先于 emit；每 attempt 至多处理一个 terminal（第二份 protocol-invalid）；started 前取消按 SA cancel-before-start 合同等待实际回执。before_settle 仅在 outcome completed 且无已有 continuation 时评估。terminal 先于 idle 发布。owner 失效后旧异步动作不向新会话投递。

## 7. 不变量/性质

并发 N launch 握手两两不重叠（性质测试）；队列容量满在副作用前拒绝；同一 tool_call 恰好一次 check；denied 事件无第二裁决来源；cancel 后 terminal 以实际响应为准，未得为 unknown；lifecycle 映射枚举穷举全覆盖（含 unavailable_context/invalid_request）。恢复前后 agent/binding 相等。

## 8. 资源/界限

队列/ChildRun 表/订阅有界；等待受 caller deadline；timer unref+finally 清理；owner close 取消未开始项、断订阅、记录进行中项为 unknown/aborted。不新增性能 SLO；无真实模型/provider 测试要求。

## 9. 安全/副作用

仅 my-plugins；/check-permission、/stop-check 新增 helper 路由仍走每请求新 token、读实际响应、固定 allowlist，不以 exit0 推断；reason/错误文本非秘密但不含凭据。child bootstrap 凭据仅 env/进程边界；binding 无秘密。固定准入不放宽；必载不可缩减；本机 native runner 限定保留。

## 10. 一致性/退出

设计先按原 workflow 六项标准确认（限定 B6/B7/B8 及直接缺口）；实现按本表+明确 diff 独立对照一次；首单元/fsm-2/fsm-3 结论不重开。SA 真实集成与完整运行烟雾属 fsm-5/安装；mandatory 命令翻译责任不变。本单元通过不等于全系统完成。
