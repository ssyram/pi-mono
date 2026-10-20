# 官方 Pi 完整适配当前 FSM Server：调研与具体方案

状态：已补查收尾、身份恢复、judge/Evidence/Watcher 的实际调用链，源码支持仅插件实现当前 OC-level FSM 功能合同；用户已确认继续方向，进入正式架构设计；当前合同见 `../design/fsm-compatibility/architecture.md`。没有新增运行代码，没有声称插件已运行兼容。

功能归属：`my-plugins/fsm-compatible/`；本任务是该插件的根任务。目的见 `../principles.md`。所有后续实现、测试、设计及安装脚本均限于此目录，不修改 Pi、pi-subagents、use-fsm 或 haokun-code。

证据标记：**源证**为已读取的源码/文档；**推导**为由明确前提推出的架构判断；**候选**为尚未确认的设计；**未闭合**为需要具体运行或进一步细化的条件。源码存在不等于运行成功。

## 1. 结论

**推荐：插件提供 FSM 所消费的 OC HTTP 协议、根会话统一持有 FSM Client、主子会话加载同一 FSM 门禁；实际子任务优先复用当前 pi-subagents 的公开接口。**

不推荐先重写通用 subagent 系统，也不推荐只加 MCP 接线。后者遗漏了 FSM 主动反向调用宿主的 Evidence、judge 与 Watcher 通路；前者即使做好，也不能独自补齐这些通路。

这是 OC 协议兼容插件，不是启动真实 OC、修改 FSM 增加 `pi` 后端，或创建 haokun-pi。`agent_cli="opencode"` 在这里表示使用 FSM 已有的协议适配路径；`agent_cli` 会被工作流读取，因此不能再声称其值反映真实执行产品为 OC。

**源码结论**：当前接口具备仅插件实现完整功能合同所需的收尾、恢复、结构化 judge 与通知机制；此前把这些能力笼统留给实测是不充分的调研。实际调用链、组合条件和必要修正见 [`runtime-source-conclusions.md`](runtime-source-conclusions.md)。尚欠的是实现及运行证据，不是等待实测决定机制是否存在；不能把源码可实现性报成“插件已 100% 跑通”。

## 2. 用户要求的实际分解

- R1：当前 FSM 越来越重要，最终需要官方 Pi 完整运行它，不是修复旧 Steering-Flow。
- R2：重写 subagent 或绑定 pi-subagents 是候选，要求比较；不改第三方代码是重要接入条件。
- R3：`my-plugins/` 是唯一开发范围；其它项目只作行为依据。
- R4：先完成具体方案，GUI 延后；后续明确最终产物是插件，执行按 qpdi/workflow，WS 必须持续承接最终责任。

R1/R3 决定适配边界；R2 不能升格为重写授权；R4 不允许把“文档已交”当最终完成，也不允许未经设计确认开始实现。

## 3. 当前源码的决定性事实

路径缩写：`FSM` = `/Users/ssyram/workspace/ai-tools/use-fsm`；`OC` = `/Users/ssyram/workspace/ai-tools/haokun-code`；`SA` = 本仓库 `third-party-plugins/pi-subagents`；`PI` = 本机安装包 `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`。

| 事实 | 一手依据 | 对设计的约束 |
|---|---|---|
| FSM 后端只有 Claude/Opencode；未知 token 默认 Claude | `FSM/crates/server/src/agent_cli.rs:27-52` | 不能传 `--agent-cli pi` 以为获得原生 Pi 支持 |
| OC judge 会建立 `title="fsm-gate"` 会话，向 message 路由发 system/tools/format/parts | `agent_cli.rs:665-691,1980-2110` | 必须能反向建立独立 judge 会话，不能只转发父模型文本 |
| judge 校验 terminal envelope 与 StructuredOutput tool part，error 优先 | `agent_cli.rs:1744-1960` | “返回能解析的 JSON 字符串”不等价于判定后端兼容 |
| Evidence 由 daemon 采集；读取 session list、每会话 messages | `FSM/crates/server/src/evidence.rs:2377-2465,2595-2690` | 插件暴露真实会话树与日志，不自己替 daemon 写公共 Evidence |
| live-work 查询 children 和 status | `evidence.rs:2504-2593` | 必须有真实 busy/retry/idle，不能从最后文本猜完成 |
| Watcher 通过 prompt_async 投递，严格要求 204 空 body | `FSM/crates/client/src/watcher.rs:471-504`；`agent_cli.rs:2281-2306` | 接收通知后必须实际排队到正确根会话 |
| hook 子命令包括权限、身份、主子 Start/Stop、delivery gate | `FSM/crates/hook/src/main.rs:1-1223` | 不能省掉 SubagentStart/SubagentStop 或用户等待门禁 |
| hook 及 Client 从严格父进程链取首个非 shell 祖先，不匹配 OC 二进制名 | `FSM/crates/server/src/identity.rs:18-105` | 不需要伪装进程名；hook 与 Client 必须有相同真实宿主归属 |
| 身份槽键为 AgentKey＋canonical_tool，仍有同键乱序窗口 | `FSM/docs/product/identity.md §4,§6.2` | 适配器必须保证身份登记到该工具调用完成的顺序，不把槽当 invocation ID |
| OC 插件判定权在 Rust hook/daemon，退出码 0/2 权威 | `FSM/opencode-plugin/fsm-plugin.js:551-652,1295-1358` | 插件只翻译和落地，不重写 FSM 的 Allow/Block reducer |
| OC 在子会话创建时执行 subagent-start 认领派发 | `fsm-plugin.js:1121-1140,1260-1271` | 子会话先确定身份、认领工作流，再执行任务 |
| 已安装 Pi 有工具事件和最终可行动边界 | `PI/dist/core/extensions/types.d.ts:719-817,1173-1178`；`PI/docs/extensions.md` | 可在插件内等待 Stop 判定、追加 continuation，不把 agent_end 当最终完成 |
| SA 公开注册必载子扩展，支持禁止不加载插件的 runner | `SA/src/shared/required-child-extensions.ts:74-108`；`SA/package.json exports` | 有不改第三方源码的强制门禁接入点 |
| SA 前台运行限制 extension-only MCP；绑定 JSON 只写入 runner 子环境 | `SA/src/runs/shared/child-launch.ts:154-171,217-223` | 不能依赖父进程全局 env 或假设每个前台 SDK child 自动继承 MCP |
| SA 提供 RPC spawn/status/steer/stop/resume 及运行扩展确认信息 | `SA/src/extension/rpc.ts:32-36,446-476,850-870` | 可做插件自有入口；公开通信协议能力须探测，不能 deep-import 私有实现 |

### 3.1 haokun-code 改革中必须继承的行为

本轮分析的是当前实现及已定位的改革文档，不是所有 fork commit 的完整清单。

1. **完成与错误分开**：`OC/packages/opencode/src/session/prompt.ts:1333-1369` 先处理 length/error，后接受 structured capture；`createStructuredOutputTool` 位于 `:1618-1642`。Pi 桥不能把截断但已调用 StructuredOutput 的回合包装成成功。
2. **terminal 持久化先于 idle**：`OC/docs/fixes/session-fix-incomplete-terminal-settlement.md:181,373` 规定 idle 蕴含 terminal persistence 已完成。插件发布 status 时必须承接此顺序。
3. **子会话是真实可恢复会话**：`OC/packages/opencode/src/tool/task.ts:234-307` 维护 parentID、恢复 session、深度限制；`:346-369` 把失败与正常文本区别；`:396-505` 实现后台运行、完成通知及前台转后台。不能以一次 LLM 调用冒充 subagent。
4. **门禁覆盖工具实际执行**：`OC/packages/opencode/src/session/tools.ts:107-122,403-421` 把普通工具和 MCP 调用都接入 before/after。Pi 中自有工具、嵌套工具及其它 MCP 同样需要受门禁管理。
5. **Stop 的实际基准**：当前 OC 插件仅在正常 settled turn 上调用 evaluator，被拒后原样 promptAsync 续跑；异常回合不据 idle 自动重启。来源 `fsm-plugin.js:864-984,1275-1283`。不把它描述成同步 Stop veto；Pi 可以用更明确的 before-settle 边界实现相同最终工作效果。

## 4. 完整兼容的判定性质 P

| ID | 必须满足的可判定性质 | 负责机制 |
|---|---|---|
| P1 | 当前 Client tools/list 所有工具可调用，包括 self-check、transition、隐式 `_fsm_exit`、dispatch；保留结构化结果及错误 | FSM 调用代理与工具投影 |
| P2 | 每次调用绑定正确 root/agent，主子状态隔离；同名并发工具不串身份 | 会话绑定＋根代理调度 |
| P3 | 未许可的实际工具效果被阻止；permission 基础设施失败按现行 hook 策略执行 | 主子工具门禁 |
| P4 | 派遣范围固定；根/子/嵌套/恢复均只允许准入 agent，并强制加载 fsm-compatible 及规定扩展；派发由真实新子会话认领，支持前后台、取消、恢复，不提前完成 | 固定准入策略＋子运行入口＋子插件 |
| P5 | Review/Stop/Watcher 的 judge 为独立受限会话，工具/schema/repair/abort 语义正确 | OC 协议桥＋judge SDK 会话 |
| P6 | daemon 能采集实际树、日志及 live-work；失败显式，不制造假 idle/假日志 | 会话记录投影＋状态发布 |
| P7 | 主子正常结束均经过对应 Stop；block 续跑，error/abort 不被改成成功；Watcher 投递到正确会话 | settle 接线＋通知入口 |
| P8 | daemon/MCP 重连、Pi 重开及子会话恢复重建真实绑定；不重置已有 FSM 或重复认领 dispatch | 恢复接线 |
| P9 | 安装运行只依赖官方 Pi、插件、当前 FSM 二进制与明确版本的第三方插件；不要求修改外部源码 | 包装/安装与版本准入 |

这组性质是候选实现的合同，不是已证明满足。完整指 FSM 当前消费的宿主功能合同，不指复刻 OC 全部 HTTP、数据库、GUI 或任意第三方 runner。

## 5. 方案比较

| 路线 | 能解决什么 | 未满足的当前义务 | 判断 |
|---|---|---|---|
| 只注册 FSM MCP＋工具 hook | 工具调用和部分门禁 | P4-P8 的反向宿主调用、judge、证据、Stop | 排除作为最终方案 |
| 延续旧 claude-fsm-compat | 有进程/MCP/锁的参考实现 | README 明确 SubagentStop 不支持，旧 CC Stop 非等价且契约陈旧 | 不作为本次基础；不删除旧插件 |
| 修改 FSM 增加 Pi 后端 | 长期原生协议最清楚 | 违反仅 my-plugins 开发边界 | 本轮排除 |
| 插件内完整重写 subagent＋OC 桥 | 可以自行掌控运行与门禁 | 额外承担 agent discovery、调度、恢复、通知、成本与工作树管理 | 当前源码没有给出需要全面重写的理由，不先实施 |
| OC 桥＋根代理＋SA 公开 API＋子门禁 | 复用成熟运行层，并补全 FSM 缺失宿主接口 | 收尾与原身份恢复已有源码路径，须落实工具白名单、逐次绑定与正常结束规则 | 推荐 |

删除 OC 桥会使现有 judge/evidence/watcher 失去可调用宿主；删除子门禁会使子任务绕过 P3/P7；删除根代理顺序保证会使 P2 暴露身份槽竞争。无需新增另一套 FSM 状态库、review reducer 或通用 workflow 引擎。

## 6. 推荐架构与完整路径

```text
官方 Pi 根会话
  └─ fsm-compatible 根插件（会话所有）
       ├─ 工具门禁 / Stop / 用户等待接线
       ├─ FSM 根代理 ── 官方 mcp-server-fsm-client ── 原 daemon
       ├─ OC-compatible HTTP ── session/tree/messages/status
       │                     └─ judge SDK sessions / prompt_async / abort
       └─ FSM 子运行入口 ── SA 公开 RPC / 必载扩展
                           └─ 官方 Pi 子会话 + fsm-compatible 子插件
                                  └─ 向根代理登记、申请门禁与调用 FSM
```

### 6.1 根代理：一个真实宿主拥有 FSM 通道

- **候选**：根插件在当前会话生命周期内拥有 Client、hook runner、桥接服务及请求调度；进程由根 Pi 直接 spawn。不让独立 Node sidecar 变成两者的不同非 shell 父进程。
- 主子身份统一为 `{rootSessionId, agentId}`；根为 `main`，子为真实 Pi session ID。另保留实际 parentSessionId，不拿 SA run ID、模型名称或 session file 路径冒充 actor ID。
- 子插件不另起 FSM Client/Watcher。它向根桥提交请求，由根 spawn hook，保证 hook 与 Client 的 AgentKey 一致。每个根会话只拥有本会话资源，不设插件自有跨会话全局可变状态。
- tools/list 动态发现并投影为插件工具，不手写残缺工具白名单；工具发布名使用稳定命名空间，identity-acquire 的 `tool_name` 必须是 FSM canonical 发布名。
- 对同一个宿主的同 canonical tool，从 identity-acquire 到对应 MCP 响应结束维持互斥。不同 canonical tool 可并行，单 actor 串行义务仍交 daemon。错误后明确清理本地等待者，不能自动重放已可能生效的迁移。
- 不持有身份调度锁去等待子任务完成、Stop 或 Watcher。transition 的 Review 可回调 HTTP judge；judge 不调用 FSM，不反向索取该锁，避免组合死锁。
- 根代理负责协议收发，不解析 FSM 状态来自己作 permission/Stop 决策。完整 CallToolResult，包括 structuredContent/isError，不得只返回字符串。

### 6.2 OC HTTP 桥：仅实现 FSM 实际使用的协议面

| 方法与路由 | 必须完成的行为 |
|---|---|
| `GET /session` | 当前 broker 管辖的真实会话集合，含 id/parentID/title/time.updated；Evidence 从 root 构造全树 |
| `GET /session/:id` | 已登记会话 metadata；未知 ID 报错，不临时制造会话 |
| `GET /session/:id/message` | oldest→newest OC message-v2 投影，包含文本、工具参数、结果、失败与时间 |
| `GET /session/:id/children` | 真实直接孩子，不把 run/进程数冒充会话树 |
| `GET /session/status` | 实时 busy/retry/idle，记录不可用时返回失败，不能缺席即伪装 idle |
| `POST /session` | 新建独立 `fsm-gate` judge 会话，返回稳定 id；不加载执行任务的 FSM 门禁 |
| `POST /session/:id/message` | 在同一 judge 会话执行 system/tools/json_schema/text；返回合法终结 envelope |
| `POST /session/:id/prompt_async` | 把 Watcher 文本排入对应主会话；成功严格为 204 空 body，拒绝不返回假成功 |
| `POST /session/:id/abort` | 实际中止 judge，确认后返回 JSON true，保留会话与日志 |

这不是整个 OC server 的复制品。不需要 SSE、OC GUI、OC 配置服务或 OC 数据库迁移。

- loopback 服务有认证；密码只给 FSM-owned 子进程，不修改根 `process.env`，不写日志/普通绑定/报告。密码刷新接入 FSM 的 source-auth 路径。
- 子会话注册使用插件私有协议；它不暴露为无认证远程调度 API。绑定信息可携带地址和 bootstrap 文件引用，秘密由限制权限的本地凭据文件取得，不把秘密放进可能持久化的 launch 参数。
- 映射以 Pi SessionManager 与真实生命周期为权威。会话树分支与上下文压缩不能删掉 Evidence 所需的执行记录；具体投影与恢复策略在细化中定义。
- `time.updated` 在真实消息/生命周期变化时推进；消息终结数据发布先于 idle。正常 child 在 Stop 获准且运行真正结束前，不发布 completed 给父会话。

### 6.3 judge：Pi SDK 承接，而不是调用真实 OC/Claude

- 使用官方 SDK 的 `createAgentSession` 和显式 ResourceLoader；独立模型上下文，不继承父 agent 的自述或 FSM 工具。按请求设置 system、工具 deny/allow 和 JSON schema。
- 基础 Read/Grep/Glob 与 Review 的 extras 闭集逐项接入；把 OC 的 `read/grep/glob/bash/edit/webfetch/websearch` 映射到实际 Pi 工具。不能静默去掉 YAML 请求的工具，也不能把 wildcard deny 误当 allow。
- 用 schema 约束的 StructuredOutput 工具捕获对象。官方工具结果有 terminate，但它要求整批结果均终止；多工具批次由私有 judge SDK 会话公开的 Agent.finishTurn 包裹现有回调后返回 action:end，正常结束本轮。tool_result handler 不支持补 terminate，不能假设存在该接口或用 abort 冒充成功。调用链见 `runtime-source-conclusions.md §4`。
- 成功需要无 error 的完整回合和已验证 capture；真实 length/error/abort 不转换为成功。OC response 的 `info.sessionID`、part.sessionID/messageID、整数 time.completed、state.status/input 必须一致。
- daemon/client 的 run_judge 已拥有 repair/retry/total-turn 契约，桥只执行一次请求并返回真实结果；不叠加第二套“无限修复”流程。
- 同 sid 续跑保留历史，abort 不 delete；judge 根与后代明确隔离，不覆盖真实执行根的 source registration，不占 dispatch FIFO，不递归触发 FSM Stop。

### 6.4 subagent：复用运行层，自有受控入口

**推荐不直接把整个 SA 工具开放后寄希望于提示词约束。** 插件入口负责每次 launch 的准确身份与必载扩展，并让 FSM dispatch 与真实 child 的创建关联。

1. 探测 SA RPC 与 exported required-child-extensions 的能力，绑定当前实际版本/路径。代码只依赖 package exports 和公开事件协议，不导入 `src/runs/*` 私有模块。
2. 注册必载子扩展，`requireForAllRunners=true`，防止把受控任务送到无法加载门禁的 external/machine runner。当前目标为本机官方 Pi，不声称已经支持远端 runner。
3. 通过自有子运行入口提交 native Pi background launch，并加入本次 launch 的非秘密 binding。使用 background 是运行实现选择，不是用户只得到异步功能：同步调用等待该实际运行完成，异步调用及时返回并保留完成通知；取消/恢复指向同一真实会话。
4. child `session_start` 先登记 root/parent/self，加载门禁与 FSM tools，调用 subagent-start；首个任务模型请求必须发生在该接线完成之后。实际扩展确认回执不是健康证明，仍须功能测试。
5. 同一根的 dispatch FIFO 有先后义务。若连续 dispatch 两份工作后并发启动孩子，必须定义认领顺序；最简做法是逐一完成 child start/acquire 握手再启动下一个。不能以 shell 启动顺序替代真实握手顺序。
6. child gate 向根代理申请 check-permission；FSM 调用也经根代理。正常 child settle 先执行 subagent-stop，block 在该 child 内续跑，不让父工具提前 completed。
7. child 的 nested launch 走同一入口与根代理；深度、取消与恢复由受控入口和 SA 的真实约束共同承接，不能仅传播 root 环境变量就假设知道实际 parent。
8. FSM 管辖期间，绕过该入口的直接 SA launch 必须受控或拒绝，并给模型具体理由；不静默改写用户本来在运行的非 FSM 任务。框定的是 FSM 运行域，不是删除 SA 原有功能。

**源码已闭合**：正常 runner 等待真实 session.prompt；低层 agent_end 取消 terminal-drain，before-settle continuation 仍在 prompt 等待链内；恢复重新打开原会话文件并保留 session ID/binding/required extensions。嵌套 binding 由每次插件入口显式传递，不假定自动继承。必载扩展与工具白名单分别处理，动态 FSM 工具和插件入口通过公开 agent 配置加入允许集；可靠 actor-acquire 握手检查现有 daemon 路由响应，不把 best-effort hook 退出码当确认。详见 `runtime-source-conclusions.md §2-3`。这些路径不要求修改第三方代码。

### 6.5 permission、Stop、Watcher、用户等待

- check-permission 输入携带实际工具 JSON，Pi read/edit/write 的 `path` 转 `file_path`，bash.command 保留，find/grep 等逐项按真实工具语义映射；不把所有文件工具粗略叫 Read。
- 其它 MCP、嵌套 ctx.executeTool 也经过门禁。自有调用的信任域由真实调用关联确定，不能靠模型可传的 `internal=true` 绕过。
- FSM 工具先 identity-acquire；非 FSM 工具先 check-permission。0/2 exit code 为裁决权威；无效 JSON 不反转退出码。permission transport 失败拒绝；Stop adapter transport 失败沿 OC soft-gate 放行并诊断，不悄悄重写为另一策略。
- `agent_before_settle` 仅在正常 completed、无既定 continuation 时进入主/子 Stop；固定本回合的完整 assistant 数据。block 原样注入 hook reason 并请求 continuation；allow 才允许最终 settled。error/aborted 不自动唤醒。
- `agent_settled` 只发布真实最终状态，不在通知边界里重新安排 Stop。单会话 single-flight，turn 身份去重；会话切换/关闭不能把迟到 verdict 发给新会话。
- 基本提问入口需同时支持用户等待和结束 release。Pi 已有 UI prompt 事件，但不能把任意 UI（例如配置选择）一概当 AskUserQuestion。headless 的人类回答通道与取消行为在细化中明确，不以 GUI 延后为理由假装回答。
- Watcher 仍由原 Client 调度判定。桥接 prompt_async 入队到正确根会话，busy 时遵循 Pi steering/follow-up 语义；失败返回 transport 可识别错误。204 只代表接收入队，不声称模型已经消费。

## 7. 组合论证与共享不变量

**推导**：FSM 的所有反向宿主调用均落在 §6.2 的已定位协议面；若桥保持请求/响应与真实会话含义，原 daemon/client/hook 可继续承担原裁决逻辑。根代理保证请求身份与通道归属，子门禁保证 P3/P7 不止在根成立；因此这些组件共同覆盖 P1-P8，而包装准入覆盖 P9。

这只是架构条件论证：协议覆盖来自已读消费者，具体实现是否满足仍需直接运行。

- I1：同一执行 root 只有一个活的 broker/source owner；重开会话先完成 ownership 恢复，不双写 source。
- I2：root/parent/self 分别保留；root ID 稳定、子 agent ID 为真实 session ID。
- I3：同 AgentKey/canonical_tool 的 acquire→call 完成区间互斥；所有受控 FSM 调用只能走该代理。
- I4：任何 child 第一项任务执行前，门禁就位且 start/acquire 握手完成；任何正常 completion 通知前，Stop 允许且运行收尾完成。
- I5：judge 与执行树职责隔离，不注册为执行 root、不认领 dispatch、不递归门禁。
- I6：terminal 持久化先于 idle；错误优先于 structured capture；日志、状态、结果从同一真实会话取得。
- I7：外部调用失败不能制造空成功、已完成或没有工作；保留原 FSM 的明确失败方向。

前提：本机同 uid 是当前 FSM 的信任边界，不是 OS sandbox；所有受控工具必须穿过插件管线。用户手动 shell、外部进程自行调用 daemon、卸载门禁不在该管辖保证内。YAML 若根据 agent_cli 精确区分真实客户端产品，需明确这是 OC 协议路径；不能同时承诺不改 Server 又让其产生原生 `pi` intrinsic。

## 8. 超时、交付、恢复：细化必须继承的约束

| 接口 | 生命周期/顺序 | 失败与重试 |
|---|---|---|
| hook 子进程 | stdin JSON、stdout/stderr 排空、总生命周期含 kill/reap；现行 OC 默认/最低 900s | 0/2 权威；permission 拒绝、Stop soft-gate 依原路径；不凭错误文本作裁决 |
| MCP | 根插件持有持久 stdio transport；调用与 identity 的互斥区完整 | 接线/断线可恢复，但状态改变请求未确认时不自动重放 |
| OC judge message | HTTP 请求有明确 deadline，执行同 sid 会话；abort 独立清理，保留日志 | repair/retry 由 FSM driver 控制；投递不确定不伪装可安全重试 |
| prompt_async | 严格 204，正确 session 的消息先入队再响应 | at-most-once 接收尝试，不声明 exactly-once；断线可能交付未知 |
| child 私有桥 | 会话绑定、有认证、顺序明确；注册/心跳/终态来自实际生命周期 | 失联不是 idle；恢复重建绑定，不重复认领既有 dispatch |

具体队列容量、拒绝行为、七项分布式契约与函数 pre/post 在确认后的细化中给出。不得默认无限队列或隐式网络重试。

## 9. 推进顺序与退出条件

按用户引用 workflow：当前交付调研和候选方案，确认后进入架构/函数细化，设计通过后才写运行代码；每次只推进一个明确模块，完成直接测试后反馈。不得在本轮偷偷实现“试验插件”。

| 顺序 | 子计划（候选） | 实际产物/直接运行依据 | 不可偷换的退出条件 |
|---|---|---|---|
| 0 | 方案确认 | 本报告、Q、WS | 用户确认推荐架构或提出具体修改；不能以无回复当采用 |
| 1 | `fsm-1-runtime-seams` | 按已查明的调用链细化并实现必载扩展、工具白名单、bindings、settle、judge finishTurn、取消/恢复测试 | 源码组合条件落实并直接测试；不是靠试验发现接口是否存在，不动外部代码 |
| 2 | `fsm-2-broker-identity` | 根 Client、工具投影、hook/Client 同宿主、主子同名并发调用 | 状态隔离、canonical 名、进程归属成立 |
| 3 | `fsm-3-host-protocol` | HTTP 会话投影和 judge、schema/tool policy、错误/abort、Evidence 路由 | 使用真实消费者所需 wire，非空壳接口 |
| 4 | `fsm-4-child-lifecycle` | 子入口、start/acquire、FIFO、前后台、嵌套、取消与恢复 | child 开始即有 FSM，完成通知不早于 Stop |
| 5 | `fsm-5-stop-watch` | 主子 Stop、提问 gate、Watcher 真实队列、daemon 重启 | block 真续跑、allow 真收尾、未知不假 idle |
| 6 | `fsm-6-install-run` | 插件安装入口、版本准入、运行说明和完整场景证据 | 官方 Pi＋当前 FSM 二进制实际运行，无源码补丁 |

每个带契约子计划在实施前完成 workflow §6 expectations，不能从实现倒填。获授权的独立审查只按已确定的原始目的/标准执行，先按 recalibration 回到该目的，不新增无界审查轮次。

### 9.1 测试依据与范围

- mock/faux provider 测试：协议形状、工具 gate 阻止实际文件变更、StructuredOutput/error 优先、abort、同名并发身份、Stop continuation、消息先于 idle、child mandatory-extension 失败、恢复不重复 dispatch。
- 当前真实 FSM 二进制＋官方 Pi 的 provider-free 测试：能力准入、注册/进入/状态/SELF CHECK/_fsm_exit、typed permission、dispatch 认领与 Evidence 接口；使用临时数据目录，不影响现有 daemon 状态。
- 真实模型 E2E：Review、Stop judge、Watcher 与实际子任务完整跑完，核实工作流迁移、真实拒绝与恢复。此层需要明确账号/预算/数据发送范围；不把存在环境变量当授权消耗 token，也不把 fake provider 测试称为真实模型运行。
- 运行目标包含 interactive 和 print/headless。官方版本必须以实际 npm 安装包执行，而非本仓库源码 runner；所需版本不支持时明确拒绝，不靠修改核心补接口。
- 不跑全仓库 build 或泛化 e2e。新增测试运行对应文件；代码变更后依项目要求执行 npm run check，报告非本插件问题，不顺手改官方源码。

## 10. 源码结论与后续实施责任

已闭合：Stop continuation 的正常等待顺序、原 session ID 恢复、必载扩展准入、judge 的公开正常结束接口、dispatch 恢复不重新认领、Evidence 原始记录访问、Watcher 的插件通知入口。依据与具体前置条件见 `runtime-source-conclusions.md`。

后续实施仍须完成：

1. 固定实际包含这些公开接口的 SA 版本/来源；不能拿当前有修改的工作树代表任意同版本发行包。
2. 将源码已经确定的有效 continuation、工具白名单、每次绑定、actor-acquire 握手、judge finishTurn 与消息持久化顺序写入函数级合同，再编码测试。
3. 将原始记录和真实运行状态投影到 Evidence，区分模型压缩上下文、原始执行记录和实际分支，不靠日志更新时间猜 busy。
4. Watcher 204 由插件的有界会话接收队列承诺；普通 pi.sendUserMessage 返回 void，不把调用它冒充 Pi 的同步接收回执。
5. 对完整插件进行协议、故障及真实 FSM 运行测试；真实 LLM 账号/预算/数据范围尚未明确，届时集中说明。

这些是确定的实现与运行义务，不再包装为“也许宿主不支持”；也不授权降低为只有后台或只有根会话。

## 11. 用户已接受的方向与当前阶段

用户已回复“可以，开始按照 workflow 继续 proceed”，接受继续 **“OC 协议兼容桥＋根 FSM 代理＋pi-subagents 公开 API＋强制子门禁”** 的方向。新明确的核心合同还包括固定可派遣 agent 范围及不可绕过的必载扩展；见正式架构。该回复不是对后续未知函数设计或实际运行结果的预先验收。

推荐采用：它复用 FSM 的现成判定和 SA 的现成运行能力，新增代码集中在真正缺失的宿主合同；比全面重写 subagent 少承担一套调度系统，又不牺牲 FSM 的完整功能义务。

确认后依据已查清的接口交付函数级细化，再实现和直接测试；若实现发现真实合同冲突，定位具体失败链并修订设计，不越界修改 third-party-plugins。

## 12. 用户确定的后续优先级（不抢占核心实现）

来源：用户在本次源码补查期间新增要求。这是已知潜在 compatibility 问题与后续功能义务，不是已复现的运行故障。

- **已有能力的翻译**：Pi 的常用插件命令/工具需要映射到 OC/FSM 识别的名称、参数与结果格式。不能只改展示名称，必须保留实际执行语义；具体常用集合与字段映射在后期适配时列清。
- **缺失能力的实现（optional）**：用户最新明确常用 OC 工具支持是可选，排在最后；此前的“必须实现常用工具”口径已被这一裁决修订。`AskUserQuestion` 是候选例子；若选择实现，就必须有真实提问、答案返回和等待/结束接线，不能只声明不存在的入口。
- 命令翻译与新增工具分别处理；已有等价工具才翻译，没有等价工具才补实现，不用统一 alias 掩盖功能缺失。
- 当前顺序确定为：FSM 核心完整支持→常用插件命令翻译（mandatory）→常用工具支持（optional）。先后与必需程度以 `../principles.md` 的用户 Q 为准；核心必要的 wire/gate/judge 基础映射不算可延后的常用命令扩展，optional 工具不能反向成为核心完成条件。
