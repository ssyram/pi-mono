所有凭证现已完成核验（SA delegation API、runtime-agent 注册事件、原始 hook 门禁，以及官方 Pi `agent_before_settle` / 嵌套 `tool_call` 有效载荷 —— 已在已发布的 1.0.3 d.ts 中确认）。最终报告如下。

## 审查 — fsm-4-child-gates 编码前设计确认（B6/B7/B8，workflow §4.4 六项标准）

对象：`subplans/fsm-4-child-gates.md` 对照 `audits/fsm-4-child-gates/expectations.md`，callee 一手依据逐项核对：`pi-subagents/src/api/delegation.ts`（事件名/三元组/status 枚举/边界）、`docs/extension-api.md` §Structured delegation + :142/:160-184/:285-344、`runtime-agent-events.ts`（`pi-subagents:runtime-agent-register:v1`）、原 hook `crates/hook/src/main.rs`（check-permission/stop 语义）、官方 Pi `agent_before_settle` 与 `tool_call`/`parentToolCallId`（官方源 + 1.0.3 发布 d.ts）。已 PASS 的首单元/fsm-2/fsm-3 未重开。全程只读。

### 逐项核验（正确项，附一手证据）

**B6 握手串行化 — 结构成立**。队列按 root、容量满在副作用前 queue-full、握手段（PendingLaunch→emit→等真实 child→initializeChild bind+gate+actor-acquire→出队）、失败/超时出队记录 failed 不阻塞、已 spawn 未知保留 unknown 不重发、resume 不入队、duplicate_node 原样上报——均与 expectations §4/5/7/8 一致，且 SA 侧依据属实：`duplicate_node` 为真实 status（delegation.ts:90），"second active attempt … without disturbing the original"（extension-api.md:330），cancel 影响精确三元组含 before-start（:331），至多一 terminal（:333）。边界 64KiB schema/1MiB 文本与 SA 原文一致（:343）。

**B7 调用者关联 — 结构成立**。三元组精确匹配有 SA 原文背书（文档示例按 requestId/ownerRunId/nodeId 三字段过滤，delegation.ts `SubagentDelegationStarted`/`TerminalResponse` 均携带全三元组）；"订阅先于 emit"与文档示例顺序一致；callerSessionId 取自已认证 principal 而非模型参数、死 caller 记 failed 不转投、cancel 等实际 terminal、deadline 未得为 unknown 不伪造 cancelled——符合 expectations §5/6 与 fsm-2 未知原则。至多一 terminal、第二份 protocol-invalid 拒绝有 SA "Each attempt emits at most one terminal response" 直接背书。status 枚举与 delegation.ts:82-94 完全对应。

**B8 normalizer 与门禁 — 主体成立**。/check-permission 四字段 body、`{allowed, reason?}`、除干净 200-allow 外一律 fail-close（exit2 语义）、拒绝 reason 原文——与 `main.rs:488-493,508-546` 逐点一致；/stop-check 软门禁（Connect/Timeout 放行、HTTP/parse fail-close、legal_pause=false 已知时 fail-closed）与 `main.rs:583-628` 一致，叶子 §5 的表述准确。新增两路由进 helper 固定 allowlist、每请求新 token、读实际响应不以 exit0 推断——与 fsm-2 已 PASS 的 helper 合同连续。Stop 接线与官方 Pi 精确吻合：事件名为 `agent_before_settle`（agent-session.ts:1984-1998，outcome 来自 `_lastActivityOutcome`），actionable boundary 契约 `{entries:[...event.entries, custom], continue:true}` 单次续跑（extensions.md:118），SDK 对排队消息期间的 continue 会 `_reportInvalidBoundaryContinuation`——叶子"outcome completed 且无已有 continuation 才评估"的守卫方向正确。嵌套门禁依据属实：1.0.3 d.ts 明文 tool_call 事件对嵌套调用携带 `parentToolCallId` 且 id 为 `<parent id>/<n>`、"never appear in the transcript, only in the parent result's nestedCalls"——按各实际事件独立门禁、父允许不放行子，可落地。FSM 投影工具不经 check-permission（broker 唯一入口）与 architecture §4.5 一致（沿用原 B 系列结论）。

### 发现 (Findings)

- **P1-D4-1（编码前必须闭合）：edit 单次调用含多条 edits 的门禁语义未闭合，且与 expectations §7 不变量冲突**。叶子 §5 edit 行："单条 edits→{filePath,oldString,newString}；多条并行调用逐条独立门禁（每条一次 check）"。两种读法均不闭合：若"多条"指同一 tool_call 的多条 edits 条目→"每条一次 check"违反 expectations §7 "同一 tool_call 恰好一次 check"；若指多个并行 tool_call→则"单 tool_call 多 edits 条目"这一真实可达输入（SDK Edit execute 读取非空 edits 数组，fsm-3 D3-1 已核）未规定行为——是 1 次 check（完整映射 input）还是逐条，未定。这是权限门禁路径上的具体歧义，不是措辞问题。最小闭合：在叶子 edit 行明确——单个 tool_call 恰好一次 check；多 edits 条目时以完整映射 input（如 `{filePath, edits:[…]}` 原样搬运，不改值不造字段）一次提交 /check-permission，denied 整体 block。一手来源：fsm-3 D3-1（SDK edits 数组）、expectations §7。
- **P2-D4-2：握手段"从 started/response 首事件取得真实 child session（runId/child SID）"措辞与 SA 载荷不符**。`SubagentDelegationStarted` 仅含三元组（delegation.ts:53-57），无 runId；runId 随 foreground 进度 `:update` 事件出现（extension-api.md:142 "progress updates carry `runId` as soon as foreground execution allocates it"），terminal response 亦带 runId。握手等待/绑定完成信号应改述为"started 仅确认启动，runId 取自 update/terminal；握手段完成以 child 侧 initializeChild 登记（bootstrap/actor-acquire 确认）为准，不依赖 started 携带 SID"。一句话修订，不动结构。
- **P2-D4-3：lifecycle 映射未点名 `unavailable_context` 与 `invalid_request`**。SA 枚举共 11 个 status（delegation.ts:82-94）；叶子/expectations 映射以"…"省略后二者，而 expectations §7 要求"lifecycle 映射枚举全覆盖（穷举 status）"。最小闭合：在 §3 映射表显式补两行（建议 `unavailable_context→failed` 保留 error；`invalid_request→failed` 且属桥自身 bug 需记录），使穷举性质测试可直接断言。

记录项（不阻塞）：`required-child-extensions` 导出（`requireForAllRunners=true`、disposer 仅释放本注册）本轮按任务材料引用，未直读该导出源码——实现后对照时须以该导出一手源核实"必载不可缩减"。叶子中"pi before_settle"应写全名 `agent_before_settle`（实现按此注册）。

### 六项标准映射

1. 契约源一手可核：B6/B7/B8 的 SA/hook/Pi 依据全部核实为真，唯 D4-2 的 started 载荷表述与一手不符（一句修订）。2. 闭合/限定：D4-1 一处未闭合，其余闭合。3. 流程可推导：requestChildRun/onDelegationResponse/evaluatePermission/evaluateBeforeSettle/resumeChild 状态与分支有限可推导。4. 可测试：§8 测试计划覆盖 §7 全部性质（FIFO 不交错、失败出队、duplicate_node、cancel 三竞态、穷举映射、nested 独立、fail-close、soft-gate、恢复保留 actor）；D4-1/D4-3 闭合后即可写断言。5. 资源/失败：队列/表/订阅有界、timer unref、owner close 断订阅记 unknown/aborted、安全边界（principal caller、fail-close、秘密不入 binding）完备。6. 不冒充完成：SA 真实集成烟雾留安装单元、mandatory 翻译与 fsm-5 责任边界明确。

### 合并判定

**BLOCKED（最小，三条均为一句话级闭合，无结构性缺口）**：
1. D4-1：叶子 §5 edit 行——单 tool_call 多 edits 条目恰一次 check 的行为未定，且与 expectations §7 "同一 tool_call 恰好一次 check" 冲突（一手：fsm-3 D3-1 / SDK edits 数组）。
2. D4-2：叶子 §2/§4 — runId 不在 `:started` 载荷中（一手：delegation.ts:53-57、extension-api.md:142），握手表述需改为 update/terminal 取 runId。
3. D4-3：§3 映射表补 `unavailable_context`/`invalid_request` 两行，满足 §7 穷举要求（一手：delegation.ts:82-94）。

三条按 D3 先例修订叶子并同步 expectations 后即可 READY 编码；B6/B7/B8 的机制设计、安全边界、测试计划与责任边界均无需变更。