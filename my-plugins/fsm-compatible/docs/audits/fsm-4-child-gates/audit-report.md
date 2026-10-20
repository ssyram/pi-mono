所有证据已在上下文中确认；根据指示，无需进一步阅读。

## 审查 — fsm-4-child-gates 实施对照修复限定确认（P1-1～P1-4 + P2 处置）

范围：仅核对四项 P1 修复与直接回归，及 P2-1/2/4/5 处置；P2-3（event.continue 保留，官方 BoundaryState 类型依据）、P2-6（required-child-extensions 一手源核实留组装单元）按记录处置，未重开。已核对正确部分未重开。全程只读。

### 逐项确认

- **P1-1 已闭合（waiter 跨行误解析）**。`child-runs.ts`：`Waiting` 增加 `nodeId` 键控；`onTerminal` 迭代副本仅 resolve 匹配行的 waiter；直接回归 "waiters are keyed per row" 断言 node-A 的 terminal 不 resolve 等待中的 node-B（`bSettled === false`），B 由自身 terminal 后续 resolve。符合 §5 三元组精确匹配与 §7 cancel 以实际响应为准。
- **P1-2 已闭合（容量终身封顶/队列无界）**。terminal 后行移入有界 `finished`（`finishedCapacity=64` FIFO 淘汰），`find()` 回落 finished 保留 terminal 供迟到查询/cancel；`activeSize` 暴露活跃数；`launch()` 以 `pending >= capacity || runs.activeSize >= capacity` 双计数在副作用前拒绝，`pending` 在 finally 递减——队列深度与活跃容量均有界。回归测试：容量 2 下第三次 open → queue-full，n1 terminal 后 `activeSize===1`、n3 可 open、finished 行 `find("n1").terminal.status==="completed"` 仍可查。第二 terminal：active 行与 finished 同 requestId 行均 protocol-invalid（源码确认）。符合 §2/§7/§8。
- **P1-3 已闭合（loadPayload 恒抛）**。`child-bootstrap.ts`：transformer 存 `this.bootstrapRef = split.bootstrapRef`；`loadPayload` 直用 ref 调 `readBootstrap(scope, this.bootstrapRef)`，无二次解析。决策记录的 child 取凭据链路恢复可用。
- **P1-4 已闭合（normalize 逃逸）**。`permission-gate.ts`：`normalizeToolCall` 移入 try，任何抛错（含坏 edit 条目与 transport）→ `{block:true, fail-close 消息}`；catch 覆盖 normalize 与 callCheckPermission 两段，语义为纯 fail-close，无第二裁决来源。
- **P2-1 已闭合**：`LaunchRequest.policy {allowedAgents, maxDepth, requiredExtensions}` 真实注入 payload 三字段；测试传真实 policy 对象——决策记录与实现一致。
- **P2-2 已闭合（主体）**：`launch()` 入口三查（queue-full→deadline→aborted）；握手预算 `min(Date.now()+childStartTimeoutMs, deadline)`；`request.signal` 传入 awaitTerminal。残留一处：排队未开始项在等待期间的 signal abort 不会移除该项（段内无二次检查），记录级残留，建议组装单元在段起副作用前补一次 `signal?.aborted` 检查。
- **P2-4 已闭合**：并发 waiter 隔离、容量饱和+释放、lifecycle 11 status 全断言（`Object.keys(expected).length === 11`，含 duplicate_node→unavailable、invalid_request/unavailable_context→failed）、check-permission body 四字段 deep-equal 断言（session_id/agent_id/tool_name/tool_input 映射保真）。残留未测（记录级）：launch 级 queue-full/deadline/entry-abort 用例、finishedCapacity 淘汰、awaitTerminal abort 路径。
- **P2-5 已闭合**：child-launch.test.ts 内联动态 import 已改顶层（`node:timers/promises` 顶层导入、rm 走 `t.after`），文件内无内联 import 残留。
- **P2-3/P2-6**：按指示按记录处置，未重核。

### 无削弱核对

既有用例全部保留且断言未弱化（FIFO 串行含任务正则、duplicate_node 原样、失败出队、单次真实通知+第二 terminal 拒绝、cancel 等实际响应、超时 unknown、bootstrap ref 校验）；gates 五路径（allow/deny 原文/fail-close/FSM 绕过/缺 binding block）与 stop 五路径不变。测试报告声称 104 项+tsc 0，按只读约束未独立复跑，以新增用例的存在性与断言内容核对为准。

### 合并判定

**PASS**。四项 P1 全部闭合且回归到位；P2-1/2/4/5 处置符合意见；P2-3/P2-6 按记录承接。残留仅记录级（排队项 signal 复查、launch 级容量/abort 用例、finished 淘汰、abort 路径），均不削弱固定准入、原 driver 裁决/repair 归属或 B6/B7/B8 机制合同。建议组装单元接线时顺手处理排队项 signal 复查并补 launch 级用例，无需专门回合。