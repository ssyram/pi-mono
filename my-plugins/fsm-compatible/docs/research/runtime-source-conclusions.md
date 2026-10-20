# 当前 Pi / pi-subagents 调用链：仅插件适配的源码结论

范围：用户要求查清方案中被笼统留给实测的收尾、身份恢复、judge/Evidence/Watcher 问题。不进行实现或额外独立审查。本轮依据为已安装官方 Pi 1.0.3 的 JS/公开类型、当前 SA 源码及当前 FSM 源码；文件位置缩写沿用 `fsm-compatible-research.md`。

## 1. 直接结论

**推导：在这组当前接口上，OC-level 的 FSM 功能合同可以由插件实现；三个此前列作“能力待实测”的问题均已有源码闭合路径，没有查出必须修改 Pi、FSM Server 或 pi-subagents 的硬障碍。**

这不是“现成插件已 100% 跑通”。尚欠的是插件编码、合同测试与真实完整运行，不是继续等实测决定宿主是否有相应机制。实现必须满足下述具体组合条件，不能只按接口名称连线。

保持原推荐：OC 协议兼容桥＋根 FSM 调用代理＋公开 SA 接入＋主子会话门禁。当前不需要以“收尾或恢复可能不支持”为由重写 subagent 系统。

## 2. Stop 拒绝后续跑，会不会让父会话提前收到 completed？

**答案：正常路径不会，Stop continuation 已位于实际 prompt 等待链内。**

### 官方 Pi 调用链

源证：`PI/dist/core/agent-session.js:1352-1444`。

```text
prompt()
  → await _runAgentPrompt(messages)
      → await agent.prompt(messages)
      → while not aborted:
          await _handlePostAgentRun()       // retry/compaction/queued work
          await _runBeforeSettleBoundary()
              → await extensionRunner.emitBoundary(agent_before_settle)
              → commit entries
              → validate runnable context
              → return continue || queued messages
          await agent.continue()           // loop includes every continuation
      → finally await _emitAgentSettled()
  → prompt() resolves
```

`_emitAgentSettled()` 等待扩展事件、公开 settled 事件和 deferred actions，再释放 idle wait。来源 `agent-session.js:672-697`。`message_end` 持久化位于 `:739-772`，`turn_end` 是工具结果已追加之后的边界；因此 before-settle 能取得已落入 SessionManager 的完整本轮消息。

插件必须返回合法的 continuation draft，例如带 hook 原始 reason 的上下文消息及 `continue:true`。仅返回 continue、不新增可运行上下文，在 assistant 尾部没有队列时会被 Pi 拒绝；这不是缺少能力，而是接口前置条件。来源 `agent-session.js:580-605,1415-1444`。

### SA runner 调用链

源证：`SA/src/runs/shared/child-session.ts:529-550` 将 child.prompt 直接映射到真实 `session.prompt`；`SA/src/runs/background/run-child-session.ts:686-703` 等待 created.prompt，再调用 settle。

有一个看起来危险的 1000ms final-drain timer（`:164,325-350`）：terminal assistant message_end 会启动它（`:535-542`）。但不能只读这个局部分支就判断 Stop 被它中止：

- `SA/src/runs/shared/child-lifecycle.ts:12-30` 明确 **agent_end → cancel-drain**；
- `run-child-session.ts:352-368,432-439` 应用该投影，清除 timer 和 terminal/settled 标记；
- 官方 Pi 的低层 agent_end 在 post-run/before-settle 之前发出；
- 正常 before-settle Stop 因而没有这个 terminal timer 在后台倒计时；
- agent_settled 才再次 start-drain，且正常 prompt 返回后 settle 等待 dispose 完成再 resolve 结果（`run-child-session.ts:549-646,695-703`）。

所以不能把 SA 的 terminal message 当最终完成，也不能把它的 timer 单独当硬障碍。配置显式 run/tool timeout 或用户 abort 仍可终止运行，属于取消/失败路径，不是正常 Stop 获准。

**插件落实条件**：error/aborted 不注入续跑；等待 hook 的异常按既有 OC Stop transport 策略处理；有正常 block 必须提交 continuation 而非仅抛异常。Pi 的 emitBoundary 捕获 handler 异常并报告错误，不会自动形成 block（`PI/dist/core/extensions/runner.js:759-806`）。

## 3. 子会话身份、必载插件及恢复能否保持？

**答案：可以；恢复实际 session ID 的路径已经存在，插件补的是 root/parent 绑定。**

### 新启动

- required-child-extensions 的公开 export 允许按父 session 注册强制路径；agent overrides 不移除 required paths，denyExtensions 与 required 冲突会拒绝。来源 `SA/src/shared/required-child-extensions.ts:74-108`；`child-tool-plan.ts:307-315,454`。
- background launch 将 extensionBindings 编码进该 runner 的启动环境，不依赖根进程永久全局 env。来源 `child-launch.ts:164-171,339`；`runner-child-launch.ts:57-63`。
- child factory 先应用环境、reload、检查必载路径错误、createAgentSession，再 **await bindExtensions**。必载 session_start 报错被收集并使启动失败；成功才返回 child、执行 prompt。来源 `child-session.ts:443-530`。

所以插件在 child session_start 完成 root/parent/self 登记、门禁初始化和 actor acquire；无需抢跑模型首个工具调用。必须在此同步步骤读出 binding 并存进本会话闭包，不能以后随意读取可能变化的全进程环境。

### 恢复

- `async-resume.ts:261-395` 读取并校验 recovery descriptor 的 extensionBindings/requiredExtensions，后续 resolveAsyncResumeTarget 拒绝错误父会话、stopped child、缺失/不存在的会话文件。
- `subagent-executor.ts:2162-2260` 创建新的运行 ID，但实际 sessionFile 仍为原 revivalSessionFile，同时传回原 extensionBindings/requiredExtensions。
- `child-session.ts:463-468` 调用官方 `SessionManager.open(originalFile, ..., cwd)`。
- `PI/dist/core/session-manager.js:666-731,1326-1351` 读取 header 并设置 `sessionId = header.id`，不会用新的 SA run ID 替换它。

**因此 actor ID 可稳定使用真实 Pi session ID；run ID 是恢复尝试，不是 FSM actor。** root/parent 用插件 launch binding 和 session custom entry 持久化；恢复时读取原值，不能用当前调用者猜历史 root。

### 必载插件不等于工具自动可见

源证：`child-tool-plan.ts:316-340,382-395` 从 tools/ceiling 构造明确白名单；`PI/dist/core/agent-session.js:1099-1101,2773-2788` 对扩展工具同样应用白名单。

当前 SA 接受普通工具名称（不是只接受固定 builtin 枚举），因此可通过公开 runtime-agent 注册配置/launch tools 把动态发现的 FSM 工具名及插件子运行入口加入允许集；来源 `child-tool-plan.ts:316-321` 与 `SA/src/api/agents.ts`、`agents/runtime-agent-registry.ts:14-55`。

**落实**：受控入口从 tools/list 得出完整名称集，生成 FSM-enabled agent 配置。若上游有明确 capability ceiling 禁止这些工具，必须报告冲突，不能以 required extension 绕过它。当前目标不要求支持任意与 FSM 合同矛盾的第三方 ceiling。

### 嵌套绑定

不假定 SA 自动继承插件私有 binding。每次插件自有子运行入口都明确提交 `{root,parent,bootstrapRef}`；child 的 root 请求经 broker 的公开 SA RPC 发起，root/parent 来自该次真实调用。需要的插件深度与 agent 选择可由受控入口/公开 runtime-agent 配置保留。SA run metadata 的 parent 若是 broker 根，不能覆盖插件记录的实际调用父会话；Evidence parentID 取插件登记的调用树。

### dispatch 与恢复

源证：`FSM/crates/server/src/session.rs:1810-1941,1984-2015`。

actor acquire 在创建锁内恢复已有磁盘 actor；`was_restored` 为真不消费 pending dispatch。新 actor 在发布到 actor_map 前 pop/apply FIFO。dispatch 应用失败会消费该条目并返回错误，不会重试认领下一条。

插件逐一等待 new child actor-acquire 握手再允许下一个新 child 认领，可确定 FIFO 对应；无需要求 daemon 提供“指定 child 的 dispatch”新协议。需要可靠获知 acquire 失败时，应由根 broker 调现有 `/actor/acquire` 并检查响应，不仅依赖 best-effort subagent-start 的成功退出码。root broker 是实际 socket peer 的宿主，保持既有 uid/token 准入，不传伪造 PID。

## 4. 独立 judge 能否受限、结构化输出后结束？

**答案：可以。官方工具结果已经有 terminate，不需要新核心接口。**

源证：`PI/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts` 的 AgentToolResult；`agent-loop.js:156-179,465-467`。

- tools 的 JSON schema 在实际执行前验证；插件仍对 FSM 要求的对象做 schema 检验。
- StructuredOutput 成功返回 `terminate:true`。
- **整批 finalized result 都为 terminate:true 才提前终止**。只有 StructuredOutput 自己返回 true，而同批 Read 返回 false，不足以停止。
- 不能通过 tool_result handler 补 terminate：其公开返回类型与 runner reducer 没有此字段（`PI/dist/core/extensions/types.d.ts:1077-1084`；`extensions/runner.js:900-954`）。也不能用 abort 冒充正常完成。
- 确定路径是私有 judge 的官方 SDK 会话：`AgentSession.agent` 是公开字段，Agent.finishTurn 是公开可设置回调。包裹并先执行现有 finishTurn，以保留 Pi 的 turn_end/持久化接线；本轮完整、无 assistant error 且结构化结果已验证时返回 `{action:"end"}`。来源 `PI/dist/core/agent-session.d.ts:209`、`PI/node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:50`；`PI/dist/core/agent-session.js:466-490`；`agent-core/dist/agent-loop.js:169-179`。它在整个工具批次结束后退出，不依赖单个 terminate flag 或修改核心。
- 因此 StructuredOutput 的 terminate 作为单工具批次快捷路径，SDK finishTurn 作为多工具批次完整路径；错误/截断不能被升格为成功。
- 禁止用预先 queued follow-up 人为延长 judge；FSM repair 是下一次 HTTP message 请求，同 sid 续跑。
- 同批长度截断不正常执行工具；error/aborted 是 hard exit。来源 `agent-loop.js:134-161`。桥保留这些失败类别，不能凭曾有 capture 包装成功。

当前 SA 自己的结构化工具也使用 terminate，作为可见复用例，不作为本论证唯一依据：`subagent-prompt-runtime.ts:413-452`。

独立 session、模型、system prompt、工具集、resource loader、订阅、abort 都是官方 SDK 能力，来源 `PI/docs/sdk.md` 和 `PI/examples/sdk/05-tools.ts,06-extensions.ts`。OC 响应 envelope 的合成是插件的数据投影工作，不需要 OC 正在运行。

## 5. Evidence、Watcher 是否有只能改核心才能接通的缺口？

**答案：没有；都有插件入口，但必须纠正“调用 API 就等于已接收入队”的说法。**

### Evidence

公开 SessionManager.getEntries/getBranch 提供 append-only 原始记录与真实分支，压缩后的模型上下文由另外的 buildSessionProjection 构造。来源 `PI/dist/core/session-manager.js:1062-1110`。

因此插件可以按真实 session tree 构造 OC roster/message/status，不需要让 daemon 学习 Pi 的 JSONL 格式。以 raw entries/真实事件记录保留工具/失败/时间，不能只导出压缩后的 session.messages。发布 terminal 与 idle 的顺序来自 §2，故能承接 OC terminal-before-idle 合同。失联、退出、失败各有实际状态，不通过文件更新时间猜 busy。

### Watcher

官方 API `pi.sendUserMessage` 能排队/启动，但返回 void；实现捕获异步错误并报告，不给调用者同步 acceptance receipt。来源 `PI/dist/core/agent-session.js:1812-1842,2676-2683`；普通 ExtensionContext 没有可等待 sendUserMessage，`ReplacedSessionContext` 才有 Promise 接口（`PI/dist/core/extensions/types.d.ts:220-341`）。

所以 HTTP route **不能调用 pi.sendUserMessage 后直接把 204 称为“Pi 已确认入队”**。正确组合为：插件在验证当前目标会话后接收进自身有界会话队列，再返回 204；队列投递器通过 pi.sendMessage/sendUserMessage 驱动对应 runtime，并记录排队/消费与异常。204 只承诺兼容宿主接收，和 FSM `deliver()` 文档的 transport accepted 一致，不承诺模型已经执行。队列满、目标失效则非 204。

Pi 内部 prompt() 对 streaming 分支在 queue 完成后返回，对 idle 分支先报告 started 后等待执行；来源 `agent-session.js:1471-1595`。这是调用机制的源码依据，不授权插件调用私有 _queue 或依赖类型标为 internal 的 preflightResult。

## 6. 对推荐设计的必要修正

1. before-settle 必须提交有效 continuation entries；异常不自动等于阻止结束。
2. mandatory extension 与 FSM 工具白名单分别处理，不能混为自动继承。
3. 每次嵌套启动明确绑定；broker 负责启动时，Evidence 的实际 parent 以插件调用树为准。
4. actor acquire 需要可靠响应时，直接用已有 daemon route；best-effort hook 不被冒充握手确认。
5. judge terminate 是批次规则；多工具批次用官方 SDK 的公开 Agent.finishTurn 包裹现有回调后正常结束，不能让 tool_result handler 返回不存在的 terminate 字段。
6. Watcher 204 是插件接收队列的回执，不冒充 Pi 的 void API 具备同步回执。

以上都是 `my-plugins/fsm-compatible` 内的实现义务，没有一项要求修改外部源码。跨根进程/会话的身份互斥、失联恢复、工具映射等仍须按完整设计落实；它们不是源码能力未知，也不是已经完成的实现。

## 7. 当前状态与下一责任

源码调查已给出原问题所需的可实现性结论，并纠正了旧方案的能力不确定表述。下一步是把这些具体条件纳入架构与函数细化，再按用户指定 workflow 实现和运行。用户没有通过“查”授权编写运行插件；不在本轮越过该边界，也不把源码结论称为插件已完成。
