# HC SubAgent over Nico：架构

状态：主线程定稿，2026-10-23；实现与运行证明尚未完成。固定叶子接口见 `test-contract.md`，函数流程见 `detailed-design.md`。

## Q：目的、前提、边界

- Q.I：按用户最新要求，一比一复刻 HC 的四工具调用格式、回执、寻址、通信、持续会话、取消与 FSM 结合；不再设计一种“更合理”的 SubAgent 协议。
- Q.I：直接 build upon 免费可商用的 Nico，保留其源码；不注册默认 extension；无 TUI 必须能运行。旧 tmux 子进程、文件 inbox 与旧模型工具整体退出，不保留第二套运行路径。
- Q.I：不新增运行时 hash/版本锁、额外容量/深度/恢复门禁、隐式可靠交付或自动重试承诺。已有 FSM 门禁仍按原协议工作。
- Q.A：HC 基线 `e81af70d789a33d67a25e158604e9bd6c9325bfd`，Nico 子模块 `vendor/pi-subagents` gitlink `34e1651d97a29388aa62e97a3571b216f24b015f`，MIT、包版本 0.81.0。这里记录来源，不增加程序启动校验。
- Q.A：Nico factory 提供同一 ChildSession 的 prompt/steer/abort/dispose 和持久 sessionFile；完整 executor 每轮 dispose，async stopped 不可 resume，不能直接作为 HC 生命周期。
- Q.E：CCA6 发生一次 300 秒 transition timeout 后持续复用失效 broker，产生数千个 generic stream 错误；首次 timeout 原因未确定。换 SubAgent 框架不自动修复这条独立的 MCP 传输路径。

源证：`../../research/hc-subagent-contract-20261023.md`；Sol source-map 输出 `909d187c-6116-4764-a5dd-e44b68b37693/research/nico-hc-source-map.json`，其中原源码位置优先于结论描述。已撤回的 fsm-8 草案不是规范。

## P：本层保证目标

P1. 模型只获得 `agent/agent_list/agent_send/agent_stop` 的 HC schema、动态描述、文本和域错误；不暴露 Nico TS/workflow/管理工具，也不保留 agent_status/resume/wait 等别名。

P2. Session 与 run 分离：运行完成、失败或取消均不删除会话；send 使用同 SID、上下文、目标模型和权限开始下一轮，busy 输入在目标后续步骤处理。Accepted 不是已消费/回复保证。

P3. name 只在 HC 规定的邻域/直属范围查找；SID 寻址不限制同树。stop 必须是直接 child，逐层取消后代；idle/repeated stop 允许。

P4. FSM 工具上报、真实父链、created/idle、dispatch FIFO 认领、normal Stop 及 judge 区分均遵循 HC 接缝，不由文本猜测身份或完成。

P5. 默认深度 3，模型选择以实际调用 assistant turn 为准、child pin 优先。cwd 是建议而非沙箱；不会因 Nico cwd 真切换而偷偷强化合同。

P6. 核心不读取 hasUI 决定业务行为。UI 仅展示真实运行事实；没有子代理不显示 widget，存在时在 editor 上方显示，活跃项优先。

## M：模块与执行模型

| 模块 | 责任及复用点 | 不承担的事 |
|---|---|---|
| HC facade / `src/subagents/hc-agent-*.ts` | 四工具、原文回执、域错误、邻域、深度、消息、delegation 分类 | 不直接 spawn CLI，不暴露 Nico SubagentParams |
| Session catalog | 保存 HC 会话身份/父链/name/type/目录/模型/variant/permission/notify 与真实 SDK 文件位置；索引及定位任意存在 SID | 不把 job/run 当 Session，不以 root/cwd 缩小 SID 可达域 |
| Nico session host | 每个 owning runtime 创建独立 `createDefaultChildSessionFactory()`；持有 ChildSession、订阅事件、调用 prompt/steer/abort；按文件重开 | 不调用全局 activeFactory、不调用完整 executor stop/resume，不每轮 dispose |
| HC lifecycle / inbox / reports | create、异步消息调度、逐深度 cancel、单条取消通知、每轮结果通知、延期报告 | 不添加 await-child、可靠 mailbox 或 StopAllow 屏障 |
| FSM integration | 复用 broker、RecordStore、OcServer、权限与 Stop-analysis 原语，为各 Session 传真实 binding；修复失效 channel 缓存 | 不保留 native-child HTTP proxy/child stdin、tmux worker 协议 |
| Operator projection | 以运行事实投影 Nico Fleet 所需 state；只读查看、原 transcript、usage、上下文、耗时、时间戳 | 不伪造 async jobs 来骗取 Fleet 控制资格，不改变核心生命周期 |

### 共享数据与所有权

HC 公共投影 `HcAgentSession/Member/Workdir/Model/Message/StopOutcome/ToolOutput` 以 `test-contract.md` §1 为本层数据定义。它们分别供 facade/tree/lifecycle/inbox/reports/UI 使用。

运行时另持有 SessionRecord：HC session_id、真实 hostSessionId/sessionFile、parent_id、definition、model/variant、permission、description、notify、workdir、instanceDirectory、真实 ChildSession handle（若已打开）、运行事实/最后 outcome。SessionRecord 的 identity/model/permission 在启动后台工作之前建立；status 不能从旧 background job 推导。

- 协议 SID 必须可按 HC `ses` 前缀寻址；若 SDK ID 形式不同，在 Session catalog 显式保存稳定映射，不把 SDK ID 与协议 ID混用。所有四工具、FSM actor、HTTP Session 与父消息使用同一个协议 SID；SDK 原始 ID 只用于宿主操作/文件定位。
- parent_id 是真实创建关系，根 depth=0。created 登记先于 child 首次 FSM 调用；任意深度 child 的 actor 都为 `(rootSID, childSID)`，不是每层另开 root。
- 会话事实与对话历史分别由 catalog 和 Nico/SDK sessionFile 持有；UI 仅派生，不设第二个 authoritative lifecycle。
- 任意 SID 寻址需要跨会话定位，这是用户要求的跨会话通信，允许共享定位索引；不引入未按 session/runtime 标识隔离的模块级业务状态。拥有活跃 handle 的 runtime 执行目标操作；其他入口通过现有 OC Session 消息接口转交，不另造 intercom/inbox 协议。
- 所有历史和失败证据保留。关闭 UI、run 结束、FSM exit 均不删除会话；root shutdown 才释放其 factory/连接/监听，文件不删除。

### 主流程

1. facade 取得真实 caller、当前 assistant turn、toolCallId；按原规则做宿主权限/FSM 工具门禁，不信模型提供 sender/model。
2. create 检查 depth/name/type → 准备建议 workdir → 派生 child 权限/模型 → Nico factory 创建文件会话 → 持久登记 parent/name/模型/notify → 发布真实 created/取得 FSM actor → 追加 HC 初始 parts/目录指令/邻居快照 → 调度首轮 → 原 Started 文本返回。
3. send 解析目标 → 拒 self、查存在 → 从目标记录读身份/权限 → 异步投递 Agent message。busy 用 steer；idle/已 abort 用 prompt。返回原 Accepted 文本，不等待 run completion。
4. stop 查直属关系 → target+后代按深度降序 cancel，同层并发 → 收集 performed/failed → 向 caller 投递一条 target 取消消息 → 原 stopped 文本。abort 不经过正常 FSM Stop 审批，不 dispose/删除。
5. 每轮终结按 HC classify；pending turn/live descendant 暂缓报告；cancelled 只 settled；completed/failed 重新读取父身份并投递原 envelope 和 agent_notification metadata。
6. 正常 idle 触发独立异步 FSM Stop 判决；拒绝时向原 Session 追加 continuation，开始/继续其运行。没有 StopAllow 才能上报父结果的新增屏障。

### agent definitions 与权限

HC 原生 general/explore 及其描述、mode、permission 由 HC `agent/agent.ts` 给定；配置扩展遵循 HC `agent` 定义和 `subagent_depth` 语义。Nico 只执行这些定义，不把其 agent-scope、默认 depth=2、allowNestedSubagents、acceptance、resumeContract 自动带进来。

动态描述只列 mode 非 primary 且 caller 对 agent(type) 非 deny 的定义，按 name 排序。实际 type 查找与 unknown-type available 列表按 HC 原代码，不以描述表代替整个 catalog。agent 执行有 subtype 权限请求，其余三个没有该额外 ask；普通工具权限与 FSM 黑白名单仍各自在原边界生效。

Pi 的原生 read/edit/write/bash 等继续使用宿主工具；只在 FSM 权限上报边界翻译名称和参数。`agent→Agent` 参数原样；另外三个名不变；没有 task→Agent 入口。

### cwd 与 prompt parts

Nico `launch.cwd` 使用 HC instance execution directory，不切换为建议 child workdir。显式 cwd 只 resolve，省略则按 HC 在 `.opencode/worktrees` 准备目录并生成 enforced:false 提示。不得自动新增存在性/沙箱检查。

HC 初始 prompt 的 @file/附件 parts 不得静默 flatten/drop。factory 的 `prompt(string)` 是真实窄接口；输入 hooks/宿主 SDK 输入适配负责保持 HC 对应语义。若宿主不能表达某类 parts，必须向主线程报告具体缺口，不能称已经一比一或用假文本替代；这不是已批准的范围缩减。

### UI

Nico Fleet 普通 foreground 项不具备其 async stop/steer 控制资格，actions 注入也不绕过筛选。因此本轮 Fleet 是只读观察层；模型四工具才是 HC 控制入口。投影使用真实 foreground/history 数据、sessionFile/正式 artifact 路径，不生成虚假 async 状态。

若上游组件无法展示某个所需真实字段，保留现有只读列表实现该字段并报告组件限制，不修改上游、重写全屏 transcript 接管或暴露第二套控制。widget 惰性按生命周期事件更新；仅查看器打开时可用上游刷新 timer。`done` 只表示已结束一轮，不是 FSM 已退出、成功或会话被销毁。

## R：组合论证与实现义务

- P1→facade 的 schema/formatter/domain-error；四个受控入口使后端自由度不泄漏给 FSM 模型。字符串和参数集合由独立单测及 HC 同脚本检查，不靠 Nico 原生结果适配两种 parser。
- P2/P3→catalog + Nico session host + HC lifecycle：查找产生真实目标，目标 handle 的 abort 与 dispose 分离，因此停止不销毁上下文；send 重用目标而非新 run ID 冒充新 Session。SID 定位不加同树门禁，stop planner 单独维持直属边界。
- P4→同一 SessionRecord 同时生成 actor binding、HTTP facts 与事件；FSM query 与消息不会观察互相矛盾的身份。judge 独立无 parent，不进入执行树或 dispatch 队列。
- P5→显式传递 caller turn model 和 instance cwd，避免继承 Nico 不同的默认策略；建议目录事实与执行 cwd 分离。
- P6→所有业务模块不依赖 UI；投影只读同一事实，所以关闭/缺失 TUI 不改变消息与生命周期。

跨模块不变量：ID 映射稳定；parent 链真实无环；每个活跃 Session 只有 owning host 的一次 prompt loop；observer 不改 status；结束一轮不移除 catalog/sessionFile；父通知与 FSM normal Stop 是不同链路。各修改点在 detailed-design 中承担保持义务。

以上是可实现义务的组合，不是运行证明。SDK 附件表达、provider/model 继承、尾部排队、跨 Session 定位和 Fleet 文件读取需直接功能测试给出依据；若任一不能承接，回到本层报告保证缺口，不在叶子放宽 P。

## 取舍与交付判据

选择 factory 而非完整 executor，是因为后者固有的每轮 dispose/async stopped 禁令与 HC 不同；为了使用它再覆写整套恢复合同，比直接复用其实际 Session 原语增加了依赖和语义分叉。不是认为 Nico 全框架已被本插件复用或其可靠性已经得到证明。

按最新“一比一 HC”要求，正常 Stop 采用 HC 的 idle 后异步判决；此前更强的“必先审后报”不作为本轮同时成立的保证。两者并非等价，不得在 README/报告继续承诺额外屏障。

完成必须包括：真实 Nico/headless 启动、聚焦单元测试、原 HC 剧本原样 Pi 执行、最终计算 message 相同、成功剧本无 FSM 错误、协议 trace 按批准身份绑定判据一致。独立 HC collect/replay 包仍由原 reference agent 负责；它或本轮单测未完成时不能宣称全局兼容。没有 commit/push 授权。
