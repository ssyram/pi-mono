所有资料已对照完毕。正在撰写最终实施契约对比报告。

## 审查 — fsm-4-child-gates 实施后独立 contract 对照（路径B）

对象：`docs/audits/fsm-4-child-gates/expectations.md` 对照实际实现（src/gates/*、src/children/*、src/broker/daemon-request.mjs、oc-handlers/oc-server launch-ack）与测试（tool-normalizer/gates/child-launch/child-bootstrap）。SA 委派与 hook 一手合同沿用本系列已核验结论。全程只读；未执行命令。

### 正确项（核对通过，附证据）

- **B8 normalizer**：`tool-normalizer.ts` 与叶子 §5 映射表逐行一致（read→filePath、grep glob→include、find→glob、ls、powershell→bash、mcp/未知原样、不改值不造缺省字段）；D4-1 edit 语义精确落地：单 tool_call 恰一次 check、多 edits 以完整 `{filePath, edits:[{oldString,newString}…]}` 一次提交；全表 + edit 单/多 + 坏条目 + 未知透传 + FSM 前缀判定均有测试。
- **permission-gate**：fail-close 完整——transport 失败 block、binding 缺失 block、reason 原文透传、响应形状严格校验（非 exit0 推断）；每 tool_call 恰一次 check；`mcp__fsm__*` 在 binding 检查前绕过（broker 唯一入口）——均有测试。
- **stop-gate**：`agent_before_settle` 仅 outcome=completed 且未 continue 时评估；block→`custom_message(fsm-compatible:stop, reason原文, display:true)+continue:true`；allow→undefined；transport 失败 soft-gate 诊断后放行——与原 hook Connect/Timeout 放行、HTTP/parse fail-close 的分区一致；五条路径均有测试。
- **delegation-bus**：SA 事件族/三元组/status 枚举（11 个全）与 delegation.ts 一致；runId 取自 update（D4-2 闭合）；subscribe 先于 emit 可行；close 断订阅。
- **child-runs**：lifecycle 穷举映射含 `unavailable_context/invalid_request→failed`（D4-3 闭合）；第二 terminal protocol-invalid；notify 仅真实 callerSessionId 恰一次；cancel 等实际 terminal、超时→unknown 不伪造 cancelled。
- **root-launches**：0600 bootstrap 文件、task 前缀仅一次性 UUID ref（transform 后模型不可见，测试断言）、ref 格式/路径逃逸校验、FIFO 握手串行（测试：第二 launch 等第一 ack）、duplicate_node 原样上报、失败 terminal 出队不阻塞、ack/terminal 竞态。
- **daemon-request.mjs**：`/check-permission`、`/stop-check` 入固定 allowlist、每请求现读 token、返回真实 status+body、deadline/1MiB 有界。
- **launch-ack 内部路由**（oc-handlers extras + oc-server）：400 坏 shape、404 未知 ref、Basic 认证（HTTP 测试含 401）；OC 固定路由表未变。
- **child-bootstrap**：前缀恰剥离一次；initialize restore 优先且不依赖前缀（测试：restore 走 saved binding 同 SID；fresh 走 bindNewChild 父=root）。
- **三条实施决策评估**：bootstrap 传输（ref+0600+transform+ack）安全边界成立（密码不入 task、模型不可见、同 uid 0600），不削弱合同；restore 优先不依赖前缀成立；root 侧 ack 完成握手成立。决策本身无削弱——但见 P1-3/P2-1 的落地缺口。

### 发现 (Findings)

- **P1-1（BLOCK）waiter 池未按行键控，terminal 跨行误解析**。`child-runs.ts` `onTerminal` 对 `this.waiters` 中**所有** waiter 用当前响应 resolve 并清空集合；`awaitTerminal` 的 waiter 不校验响应是否属于自己的行。可达场景：对异步 run A 的 `cancel()` 等待期间，run B（或另一握手段）的 terminal 先到 → `cancel(A)` 被 B 的 terminal 误 resolve，返回错误确认（§7 "cancel 后 terminal 以实际响应为准"、§5 "按三元组精确匹配" 被破坏）；反向同理，握手段 awaitTerminal 可被他人 terminal 抢走 → launch 返回错误 outcome 而子进程实际已启动。测试从未并发两个 waiter（child-launch.test 无此用例），故未暴露。最小修复：waiter 按 nodeId 键控，`onTerminal` 只 resolve 匹配行。
- **P1-2（BLOCK）ChildRun 行永不清理，容量退化为终身上限；队列深度无界**。`rows` Map 在全文件无任何 delete；`open()` 的 `rows.size >= capacity → queue-full` 意味着第 capacity+1 次**累计** launch 起永久失败，与"已完成握手的 child 长期工作不占队列"（§2）矛盾。同时 `RootLaunches.launch` 的入队前检查是 `acks.size >= capacity`（串行下 acks≤1，几乎不触发），SerialQueue 是无界 promise 链——§8 "队列有界"、§7 "队列容量满在副作用前拒绝" 未按合同语义实现。最小修复：terminal 后有界保留/清理行；入队前按真实队列深度检查容量。
- **P1-3（BLOCK）`loadPayload` 双重剥离，恒抛 protocol-invalid**。`child-bootstrap.ts` `inputTransformer` 存 `this.stripped = split.task`（已去前缀），`loadPayload` 再对 `this.stripped` 调 `splitBootstrapTask` → 前缀必不匹配 → 恒 `protocol-invalid`。当前 src 无调用方、无测试触及（报告称已移除 fresh 路径的强制调用），但实施决策记录的 child 侧取桥凭据/launch-ack 链路依赖此读取——接线时即成 P0。最小修复：transformer 直接保存 `split.bootstrapRef`，`loadPayload` 用 ref 调 `readBootstrap`，不再二次解析。
- **P1-4（BLOCK）normalizer 解析错误逃逸门禁，未 fail-close**。`permission-gate.ts` 中 `normalizeToolCall(...)` 在 try 之外；模型可控的坏 edit 输入（如 edits 条目非字符串）抛 RuntimeError 直接穿出 tool_call handler，而非返回 `{block:true}`——§5 "transport/parse 失败 fail-close block" 的 parse 支路未闭合，handler 异常在 SDK 中不构成 block 裁决（无第二裁决来源要求被绕过）。最小修复：normalize 移入 try，catch 返回 block。
- **P2-1** `BootstrapPayload` 硬编码 `requiredExtensions: [], allowedAgents: [], maxDepth: 1` 且无 policy 字段，而 design-decisions.md 记录文件承载 "policy"——记录与实现不符，字段为残留。要么接真实值，要么删字段并修正记录。
- **P2-2** `launch()` 无 caller deadline/signal 参数；SerialQueue 无"握手前移除未开始项"的取消入口（§2/§8）。childStartTimeoutMs 覆盖了握手超时，但 caller 侧等待/取消管线缺失——部分可归因于未完成的 runtime 组装，需在该步补齐。
- **P2-3** stop-gate 以 `event.continue` 判"无已有 continuation"，但官方 `agent_before_settle` 事件不携带该字段（continue 是 handler 返回值字段；SDK 自身以 `_reportInvalidBoundaryContinuation` 兜底）——守卫为死检查，行为仍安全，建议删除或改为真实条件。
- **P2-4 测试缺口**：无容量饱和/queue-full 用例（报告 B6 条目暗示已覆盖）；lifecycle 枚举仅断言 4/11；无并发 waiter 用例（否则 P1-1 当场暴露）；无 awaitTerminal abort 用例；gates 测试不断言请求 body 四字段（hook 合同 body 保真未测）。
- **P2-5** `test/child-launch.test.ts` 清理 helper 使用内联 `await import("node:fs/promises")`，违反项目 no-inline-imports 规则。
- **P2-6 记录项确认未闭合**：`required-child-extensions` 导出一手源核实（leaf §2 记录项）本轮无对应实现/验证；runtime agent 注册（§4 registerAgent/definitionSnapshot）不在本单元实现文件与测试中，属已声明的 runtime 组装未完边界——PASS 不覆盖该面，接线时须按 §4 合同核对。

### 合并判定 (Merge verdict)

**BLOCK**。差异清单（文件/行为/期望条款）：
1. `child-runs.ts: onTerminal/awaitTerminal` — waiter 未按行键控，跨行 terminal 误解析 — §5 三元组精确匹配、§7 cancel 以实际响应为准。
2. `child-runs.ts: open` + `root-launches.ts: launch` — 行无清理致容量终身封顶、队列深度无界 — §2 容量语义、§7 容量满在副作用前拒绝、§8 队列表有界。
3. `child-bootstrap.ts: loadPayload` — 双重剥离恒抛错，决策记录的 child 取凭据链路不可用 — §2/§4 bootstrap 传输落地。
4. `permission-gate.ts: installPermissionGate` — normalize 抛错绕过 fail-close — §5 parse 失败 fail-close。

四项均为局部修复（键控 waiter、行清理+深度检查、ref 直读、try 包裹），不动机制结构。修复后需补 P2-4 所列用例（并发 waiter、容量饱和、lifecycle 穷举、body 字段断言）并重跑 test:gates/test:children+tsc。其余（B8 全表、fail-close/soft-gate、SA 事件合同、0600/模型不可见、穷举映射、restore 优先、launch-ack 认证）与 READY 合同一致，三条实施决策均不削弱合同。