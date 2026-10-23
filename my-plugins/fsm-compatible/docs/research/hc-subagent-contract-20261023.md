# HC SubAgent 接口与 FSM 交互：一比一复刻基准

状态：源码调查与一次隔离工具格式捕获完成；不是 Pi 已兼容、同脚本已通过或所有场景协议相等的声明。原自拟 `fsm-8-subagent-interactions.md` 已停止推进，不作为此规格来源。

## 1. 基线与证据

- HC：`../haokun-code`，`dev-current`，HEAD `e81af70d789a33d67a25e158604e9bd6c9325bfd`。调查时 tracked clean，未读取未跟踪的 `packages/tui/tmux`。
- 安装的 HC：实际 `--version` 返回 `1.18.31-fmv2.1`；本地同名 tag 解析到上述 HEAD。版本与 tag 对应不代替二进制来源或全依赖可复现构建证明。
- FSM：`../use-fsm`，`master`，HEAD `158fba425f9a6d23c9bef9b41c0855c7bc944d47`，调查时工作树干净。
- 主线程读取了 HC 四工具定义、工具注册表、Agent inbox、run-end 回报及 FSM Stop 接缝；两项子代理提供更完整路径调查，均只读，未作为独立审查。
- HC 接口调查原 run `8be45ad1-375f-44ed-a9d4-e96ff8f48fc1` 在 30 分钟超时；以原会话续跑 `ec0a6598-bdf5-496c-96a6-4f93afae49dc` 后交付。保留原失败，不改写为一次运行成功。

完整调查材料：

- HC：`/Users/ssyram/.pi/agent/sessions/--Users-ssyram-workspace-ai-tools-pi-mono--/subagent-artifacts/outputs/e3231207-b8a2-49f0-b17c-8db537edd93a/research/hc-subagent-interface-catalog.ec0a6598.md`
- FSM：同目录 `fsm-hc-interaction-catalog.md`。

本稿收敛当前 SubAgent 与 FSM 所需合同，不把全部通用 HTTP 产品能力扩成新 SubAgent 工具。

## 2. 模型侧只有四个原生工具

源证：`../haokun-code/packages/opencode/src/tool/agent.ts`。

| 工具 | 声明参数 | 当前 HC 的效果 |
|---|---|---|
| `agent` | 必填 `description:string`、`prompt:string`、`subagent_type:string`；可选 `name:string`、`cwd:string` | 创建持久子会话，登记后台首次运行，立即返回会话与工作目录等确认，不等待最终结果 |
| `agent_list` | `{}` | 列自身、父、直接子与兄弟的瞬时邻域；非全树；状态仅 `running/idle` |
| `agent_send` | 必填 `target:string`、`message:string` | 向已有会话异步投递；busy 时后续步骤处理，idle／停止后可启动下一轮；回复不是返回值 |
| `agent_stop` | 必填 `target:string` | 只停止自己的直接 child 及其后代当前运行；不删除会话／历史，可由 `agent_send` 续行 |

复刻要求：保持真实工具名、字段、描述生成规则、默认行为、文本回执和效果；不向模型暴露 Nico workflow、任意 TS、运行器选择或额外派遣语言。

当前原生集合没有 `agent_resume`、`agent_wait`、`agent_result`、`agent_status`、`agent_abort` 或可执行 `task` 别名。不能从内部服务、旧权限名称或旧 transcript 显示逻辑推导这些模型工具存在。

模型也不能由四个 schema 指定 `async/background/wait/timeout`、provider/model/variant、sender/caller、run handle 或内部 notify/bypass 参数。

### 2.1 Schema 并非只有字段集合

`ToolJsonSchema.fromSchema` 没有将未知字段策略设置为 `additionalProperties:false`；不能自行加上该字段、`minLength:1`、description 词数校验或 subagent_type 静态 enum 并称为一比一。

最终定义还受模型、会话深度、权限、`tool.definition` 插件 hook 和 provider schema 投影影响。`agent` 的动态描述追加当前允许 Agent 类型及其描述，不是固定的静态全文。

源证：`packages/opencode/src/tool/json-schema.ts`；`tool/registry.ts:295-384`；`session/tools.ts:101-104`。

## 3. 派遣、模型、目录与可见性

- `agent` 始终异步；多次独立调用可以并行派遣，没有模型侧同步模式。
- 同一 Session 可以有多次运行；第一次后台 job 不等于会话的全部生命期。
- child 定义固定 model 时优先使用其 model；否则继承调用它的 assistant turn 正在使用的 model。发送消息时保留目标自身 agent/model/variant，不把发送方身份写进目标。
- name 可省略，不自动产生短名；禁止保留的 `ses` 前缀。名称不是强标识，并发可出现重名，按名称解析必须拒绝歧义。
- 省略 cwd 时准备新的建议工作目录；显式 cwd 是复用目录，不是复用会话。
- 当前兼容层工作目录标记 `enforced:false`，不构成沙箱，也不等于为该 child 自动切换 runtime cwd。不能把“更强目录隔离”当作 HC 已有保证。
- 默认深度 3，根为 0；到达上限不再向模型提供 `agent/agent_stop`，但保留 `agent_list/agent_send`，还要经过一般权限与工具启用过滤。
- `agent` 执行时按 subagent_type 请求宿主权限；list/send/stop 叶子没有同样的 ask 流程。仍需保留各自关系检查和外部 FSM 工具门禁，不能把它们混为一层。

源证：`agent-management/lifecycle.ts:293-397`；`agent-management/workdir.ts:20-104`；`tool/agent.ts:390-406`；`session/llm/request.ts:251-256`。

## 4. 通信协议与结果格式

### 4.1 `agent` 的启动回执

正文是 `Started ... agent...` 开头的文本，包含 `session_id:`、可选 `name:`、`working directory:` 和固定后台说明；不是 JSON。metadata 另包含 `parentSessionId/sessionId/model`。

返回时后台 job 可能尚未实际运行；不能用文案推出准确的 running 状态。完整模板源证：`tool/agent.ts:170-207`。

### 4.2 `agent_list` 的列表

正文是 TSV，列为 `session_id/name/agent_type/relation/status/title/workdir`，另有固定说明；metadata 为 count。名称、类型和标题做字段转义。

范围是邻域，不能扩大为全树。busy/retry 映成 running，其余为 idle；idle 不表示成功，也不提供完成原因。

源证：`tool/agent.ts:212-266`；`agent-management/tree.ts:121-145`；`agent-management/status.ts:18-29`。

### 4.3 `agent_send` 的寻址与接受

- 短名只在邻域解析；零匹配和歧义均拒绝。
- 通过 Session ID 可投递到任意存在的 Agent Session，不要求同树；接收方按自己的身份和权限执行。这不转移发送者权限。
- self-delivery 被拒绝；sender、sender_name、sender_agent 来自宿主上下文，模型不能传入。
- 发送的正文增加系统生成的 `[Agent message from ...]` 首行及指向真实 sender Session ID 的回复指令。名称／类型按既有规则转义，正文保留。
- 回执为 `Accepted for <target>.` 及固定单向消息说明，metadata 为 target。
- Accepted 只表示接受异步调度，不保证持久化、消费、将来执行或收到回复。异步执行错误发生在目标会话，不改写先前回执。
- 对自己 child 的正常自动报告与 parent/sibling 另发回复是不同机制，不能自动增加 RPC 式问答承诺。

源证：`tool/agent.ts:269-337`；`agent-management/tree.ts:148-177`；`agent-management/inbox.ts`；`agent-management/schema.ts:247-253`。

### 4.4 `agent_stop` 的效果与回执

- 即使用 Session ID，仍必须是 caller 的直接 child；后代自动级联，按深度取消。
- 返回正文列出 stopped Session IDs 和失败项，metadata 是 stopped/failed 计数。
- stopped 表示做过停止操作，不证明此前 busy；停止 idle 会话和重复停止是允许行为。
- 停止不删除会话和历史；继续仍使用 `agent_send`。
- 取消不是正常 FSM Stop：不等待正常停止审核批准。不能增加一次审核后，仍称与 HC 的 stop 行为一致。
- 级联内部不逐层发取消通知；完成遍历后向 caller 发一条来自 target 的取消消息，投递失败不加入 failed 集合。

源证：`tool/agent.ts:340-383`；`agent-management/lifecycle.ts:401-491`。

### 4.5 每轮结果消息

有 parentID 且 agentNotify 开启时，runLoop work 的 onExit 触发回报：

- 成功但还有未消费 user turn 时暂不报告。
- cancelled 只发布 delegation settled，不走普通结果消息。
- 有 live descendant 时延后，等待子树安静。
- completed/failed 时生成 synthetic 父消息，正文使用 `agent_result/agent_error` envelope，另带 `agent_notification` metadata。
- 投递时重新读取父自身的 agent/model/variant。
- delegation settled 与消息投递不是同一事实；失败路径也执行 settled，不能据此证明消息已成功消费。

最终成功正文取最后一个 text part，不拼接全部 text parts。错误、length、cancelled、无有效输出分别按 HC 原有分类处理。

源证：`session/prompt.ts:1549-1667`；`agent-management/delegation.ts:48-202`；`packages/schema/src/agent-event.ts`。

## 5. FSM 实际如何结合

| 接缝 | 源码事实 | 必须对齐的要求 |
|---|---|---|
| 工具权限上报 | FSM 插件将 `agent` 规范为 `Agent`，保留参数字段；list/send/stop 保留原名 | 匹配的名称与工具输入必须同构；不是把所有工具都改名为 Agent |
| 预备派工 | `fsm_dispatch_subagent({fsm,vars?})` 只登记待认领帧 | 不由该调用自行创建执行 child；模型随后再调用 `agent` |
| requires_dispatch | 检查根队列非空，没有按 callID 预留某个 child | 不可冒称 HC 已有每次 spawn 与派工项的原子一对一绑定 |
| 帧认领 | 下一位 fresh actor 按 FIFO 消费；恢复已有 actor 不消费 | 子代理启动先取得实际帧，不重复 enter；失败可能已消费，不假定自动回队 |
| 身份 | root 为 `(rootSID,main)`；任意深度 child 为 `(rootSID,childSID)`，来自真实 parentID 链 | 模型不能传 caller 身份替代真实归属；created 事件而非返回文案承担登记 |
| 正常 Stop | idle 后异步等 assistant 的稳定 id/error/completed，再进入裁决 | error、stale、unavailable 不冒充正常完成；不能只看 idle |
| Stop 拒绝 | 向原 Session 追加 continuation，再次运行 | 当前 HC 是异步续投，不是宿主同步否决 idle 的 before-settle 屏障 |
| 父结果回报 | HC run-end 宿主逻辑产生，不由 FSM after 解析生成 | 当前所读链路没有等待 FSM Stop Allow 的回报屏障，不能宣称 HC 已保证先审后报 |
| Evidence/live-work | 读取 Session 名册、parentID、children/status/messages 等真实宿主事实 | `agent_list` 的文本不是这些查询的替代品；失败／未知不当作无工作 |
| judge | 独立无 parentID 的 `fsm-gate` 会话 | 不混入执行 child 树，不消费 dispatch 队列 |

源证：`../use-fsm/opencode-plugin/fsm-plugin.js`；`crates/server/src/session.rs:1734,1909,1984`；HC `session/prompt.ts:1549-1667`；完整 FSM 调查材料提供逐路径请求／返回及调用位置。

不预设每个 SubAgent 接口都直接调用 FSM：工具执行门禁、created/idle 等事件、Evidence 查询与直接 FSM 控制是不同接缝，均按实际链路复刻。

## 6. 宿主控制与观察接口，不新增为模型工具

当前相关兼容层能力包括：

- 创建：`POST /session`，只创建，不等同 `agent` 的目录准备、后台派遣与通知登记。
- 消息：`POST /session/:id/message`、`prompt_async`、`agent-message`；它们的等待和目标身份解析不同，不互换冒充。
- 观察：Session list/get/children/status/messages/message；status 仅 busy/retry/idle，不提供 completed 结论。
- 中断：`POST /session/:id/abort` 不具备 `agent_stop` 的直属 child 检查、整棵后代停止及取消通知合同。
- 用户/UI：选择子会话查看并向已有会话发消息；不改变四工具的调用格式。

另有 `/api/session` v2 执行链，不能与四工具所走兼容层混用。当前 v2 shipped builtins 未包含这四工具，v2 wait 返回 unavailable。SDK 名称中带 v2 也不证明走了 `/api/session`。

这些是适配所需宿主表面事实；本稿不要求把 HC 整个产品或 UI 像素级复制到 Pi。

## 7. 工具格式导出：已实际完成的范围

源证接口：

- `GET /experimental/tool/ids`：内置与自定义注册 ID 目录。
- `GET /experimental/tool?provider=<id>&model=<id>&directory=<cwd>`：id、description、parameters；使用 default Agent，不带 Session ID，所以不代表深层会话过滤后的实际工具集合。

HTTP 目录不等于某次模型收到的完整工具表：MCP、provider 变换、Agent/Session 权限、深度与 hook 都会影响实际请求。

隔离运行 `1.18.31-fmv2.1 + 当前 FSM 插件 + 本地 mock`，未使用真实模型：

- 成功采集：`.runtime/hc-schema-export-20261023/native-QwYZdO/`。
- `hc-tool-directory.json`：该配置下目录 15 项。
- `hc-model-tools.json`：真实 OpenAI-compatible 请求中 tools 数组 25 项，包含四个 SubAgent 工具。
- `wire-requests/`：转发前原始请求 body；观察器原样转发请求与响应，不改工具定义。
- `captures/`：mock 解码后的请求；`hc-server.log` 与 daemon 数据保留。
- 临时采集程序：`.runtime/framework-research-20261023/hc-export.test.ts`、`hc-schema-capture.mjs`。
- 直接测试结果：1 passed，0 skipped，约 3.9 秒。

原失败 `.runtime/hc-schema-export-20261023/native-BXwB7I/` 保留：错误地期待 mock 解码输入包含 context.tools，脚本退出，HC 重试后请求超时。当前 mock 解码不保留该字段；第二次改在原始 HTTP 请求上观察，工具表断言未删除。该失败是采集器输入假设错误，不是已经定位了用户的派遣故障。

这不是“所有配置、所有模型、所有深度的全部工具”导出，更不是 SubAgent 行为或 FSM 一致性验证。HC 的依赖安装／宿主警告也不能因本次采集通过而被抹去。

## 8. 同脚本 HC/Pi 测试合同

用户要求：先根据 HC 制定并跑通完整脚本，再把同一个文件原样用于 Pi。只允许宿主启动方式不同。

固定条件：

1. 脚本文件内容与哈希相同；调用顺序、工具名、参数构造、结果解析、断言和最终计算逻辑相同。
2. 不读取宿主标志来选分支，不把 HC 工具名改为 Pi/Nico 名称，不兼容两套回执。
3. 动态 Session ID 由同一脚本按 HC 原格式提取并在该次运行使用；不接受 Pi 专用解析格式。
4. 最终真正计算得到的结果 message 相同，不用 fixture 自写 marker、进程退出或只存在产物代替。
5. 正常成功剧本全程没有 FSM 报错；重试成功不能抹掉中途错误。故意验证拒绝的负例另列，不混成“全程无错”的成功证明。
6. FSM 业务请求、响应、状态变化和协议顺序按已确认判据比较，禁止删字段或宽松匹配来跑绿。
7. 原始 trace、首次失败、脚本身份、宿主版本与二进制身份保留；mock 只替代模型，不替代宿主／FSM 判定。

现有 `test/fixtures/oc-pi-parity-scenario.mjs` 同时解析 HC 文本和 Pi JSON 启动回执，不符合这里的严格口径。旧已通过测试还使用过 `fmv3-beta.14`，不能据其结果声称当前基线一比一。

目前尚未制定／执行新的完整同脚本比较。现有 Pi 仍暴露额外别名／agent_status、严格 additionalProperties:false，以及 JSON 回执；仅凭源码即可确认其不是当前 HC 模型侧合同，但具体运行差异应由新脚本如实记录，而不是先改期望。

## 9. 必须显式处理的两个边界

### 9.1 动态运行身份

两次独立运行的 session ID、PID、端口、鉴权值等不可能天然逐字相等。是否允许仅为这些身份建立明确的一一对应仍待用户确认；不自行做归一化，也不因它们难比较就删掉业务字段。秘密不进入公开报告或普通日志。

### 9.2 HC 与此前更强停止要求不等同

用户此前要求停止审核未通过前不向 Main 报最终结果；当前 HC 的正常 Stop 是 idle 后异步判决／续投，run-end 父报告链未等待 Stop Allow。显式 agent_stop 也直接取消，不等待正常 Stop。

这不是靠“相同工具 schema”能消除的差别。严格照 HC 复刻，与额外保留同步的先审后报屏障，不能同时被称为没有差异。后续适配前需要明确采用哪种行为；本稿不擅自替用户选择或把限制改写为用户意图。

本轮未修改产品源码、HC 或 FSM 源码，未执行新同脚本比较，也未实施 Nico 内部 API 适配。
