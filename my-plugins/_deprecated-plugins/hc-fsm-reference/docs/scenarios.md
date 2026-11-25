# 声明式剧本与真实前后关系

所有 step 序号从 0 开始。行为定义在 JSON PLOT，而非 runner、启动包装或 collect/replay 分支。`scripts/author_*_plot.py` 只是生成静态 JSON 的编写工具，运行时无需执行生成器。

## 综合：Reference / WorkerAlpha / WorkerBeta / Nested

PLOT：`plots/reference.json`。四个普通 HC actor，各自实际模型请求含 26 个完整工具定义；68 次工具调用全部逐步采集/匹配。

| actor | 步骤 | 目的与依赖 |
|---|---|---|
| root | 0 | 从预注册 `Reference` 新建 frame；从真实 FSM 回执绑定根 session，验证 invariant 中 `35` 的运行时展开。 |
| root | 1–4 | 声明合法负例：不可用目标、缺 self-check、Bash blacklist、没有 dispatch 队列时启动 Agent。后两项必须由真实 hook/daemon 拒绝。 |
| root | 5–9 | const `tag` 不可重写；mutable `increment` 的 committed 初始缺席、pending 写入并读到 `7`。 |
| root | 10–13 | 先排入 `WorkerAlpha(ticket=first)`、`WorkerBeta(ticket=second)`，再依次启动原生 `agent`；不是让 child 再 enter 来伪造 dispatch。 |
| alpha / beta | 各 0 | 第一次 `fsm_get_state` 必须已持有自己的 dispatched frame、正确 ticket 和 agent_id；同时验证启动 hook 真实回执。 |
| alpha | 1–6 | 实际 Bash 算 `15+6=21`；嵌套进入 `Nested` 后深度 3，退出恢复 `WorkerAlpha` 深度 2；再启动嵌套原生 gamma。 |
| gamma | 0–4 | 首次处于 `_default`（持久 stack 合法缺席，但只读 actor API 存在）；自行首次 enter `Nested`；实际算 `3*7=21`，向 alpha 发消息。 |
| alpha / beta | 7–12 / 1–6 | alpha 发 sibling 消息给 beta；beta 忙碌时下一轮消费它，回 ACK 并向 root 发送值；alpha 必须消费 beta ACK 与 gamma 值后才向 root 报值。 |
| alpha | 10 | 对 sibling beta 调 `agent_stop` 必须被 HC 的直属子约束拒绝，不误算 FSM 门禁拒绝。 |
| root | 14–15 | root 在真实 Bash 工具中等待两个发送完成信号；下一模型轮必须持有两条实际已消费消息及宿主附加 sender header。send 接受回执不替代消费。 |
| root | 16–24 | 正常 self-check → hard check 读 pending=7 → finish `ensure-const finished=yes` → commit；读取 committed=7 和 finished=yes；验证 terminal 的 enter/dispatch admission 拒绝；显式 self-check `_fsm_exit` 后释放 frame。 |
| workers | 收尾 | 各自准备 mutable result=21、hard check、迁移 Done、自检并显式退出；gamma 也退出。所有最终 FSM actor 必须 `_default/S_default`、深度 1。 |
| root | 25–27 | 等待真实收尾；`agent_list` 是 native TSV，直属 alpha/beta 为 idle；停止 idle alpha 必须级联包含 gamma，共 2 个会话，保留可恢复上下文并产生一份 cancellation 通知。 |

固定数学输出不是任意 sentinel：叶子 Bash 真正执行算术且回执必须精确等于 21；兄弟/嵌套消息内容必须被目标 HC 下一轮看到；root 从收到的两条数值消息绑定 `root.alpha` / `root.beta`，基础设施按声明的 `sum` 运算计算最终消息 `21 + 21 = 42`，并验证两个输入均为 21 和最终消息逐字一致。Reference 的 35/7 另用于变量提交子场景，不冒称聚合算法从这两个字段取数。

时序信号文件只用于让宿主在工具边界前有机会完成异步消息持久化；它们不作为消息消费、算术值、FSM 结束或 Stop Allow 的替代证明。所有文件写入都来自真实预声明工具动作。

### 预声明的全部负例

| step | 必须观察到的拒绝 |
|---|---|
| root/001 | MCP JSON `blocked / transition_unavailable` |
| root/002 | MCP JSON `blocked / self_check_required` |
| root/003 | daemon `blacklist_matched`、hook exit 2、HC 工具状态 error |
| root/004 | daemon `requires_dispatch_queue_empty`、hook exit 2、HC 工具状态 error |
| root/006 | const 重新赋值被 FSM 拒绝；HC 工具状态 error |
| root/021 | `allow_enter_fsm:false` 的真实拒绝；HC 工具状态 error |
| root/022 | `allow_dispatch_subagent:false` 的真实拒绝；HC 工具状态 error |
| alpha/010 | HC 原生 stop 直属子约束的文本拒绝；工具本身 completed，FSM permission 仍 allow |

其它工具默认要求 HC completed，非 FSM 工具默认要求真实 gate allow。不能把这些错误泛化成允许任意错误。

## Idle → stop → resume

PLOT：`plots/idle-resume.json`；FSM：`workflows/idle-resume.yaml`。23 个声明动作＝22 次工具＋1 次普通文本暂停。

worker 进入 `Await`、写 const `remembered=6`，产生一次普通完成文本 `Awaiting verified resume`。FSM 的 `allow_user_interaction:true` 使它合法 Stop，但 frame 没有退出。root 先看到 worker idle，再对它执行 native stop，然后按名称 `agent_send` 唤醒。

第二个 run 必须在同一 session、相同 FSM Await frame、相同 const=6 上消费 root 的宿主身份消息；随后真实算 `6*7=42`、正常退出 frame、把结果发给 root。root 必须消费 `RESUME_VALUE=42` 才交付 `Idle-resume result: 42`。

单独匹配两份 native completion 报告、一次中间合法 Stop、两次最终正常 Stop、一份 cancellation 通知。Stop 被执行不等于它当时正在忙，也不等于正常 FSM Stop；本 case 不声称测试了忙碌子树取消。

## 两个并行 soft gates

PLOT：`plots/soft-review.json`；FSM：`workflows/soft-review.yaml`。root 实际算 `6*7` 并通过 tee 写 `arithmetic.txt`，绑定工具回执 42，设 immutable amount。

FSM 层 `soft_mode:sequential` 被该 guard 的 `soft_mode:parallel` 覆盖。两个 `single` gates 各自使用独立 internal `fsm-gate` HC session。它们的 PLOT 首步互相等待 actor readiness，因此错误的串行执行不能偷偷通过：必须同时真正启动两个模型请求，才能释放屏障。collect/replay 的模型请求峰值均为 2。

两个 reviewer 都实际调用 HC `read`，要求文件行精确为 `1: 42`；再调用真正的 `StructuredOutput`，字段为 checks / overall_passed / blocking_issues / summary。HC 在 structured 输出后不再请求下一模型轮，因此框架从被动 `message.part.updated` 的 completed part 结算该工具，完整保留 input/output/metadata/身份/时间而非制造 toolResult。

每份 reviewer 请求只获 4 个模型工具：read / glob / grep / StructuredOutput。它们没有 FSM/native-agent hook；全部 9 个生产 hook 属于 root 的 8 次工具＋最终 Stop。accept 的 `review_feedback` 必须按 YAML 顺序为 A、B，之后 finish const 出现且 commit 成功，最终 `Soft-review result: 42`。

这证明当前 HC 结构化接口与固定 FSM reviewer 路径可实际互操作，不证明真实 LLM 判断质量、vote、repair、API retry 或所有 reviewer tool opt-in。

Shared Evidence 确实被该生产路径调用。收集轮的原始 index 在 `runs/c504eb525/tmp/fsm-watch-501/.../index.json`，人工读取确认 version 2、frontend opencode、根 session 一致、discovery complete、main JSONL 9301 bytes、未截断；该额外检查不是全 index 的 golden 匹配，也不证明多 child Evidence 完备性。

## 宿主通知与正常 FSM Stop

HC 原生 completion 通知不等待插件的 FSM Stop Allow；源码链和实测分别取证，不要求二者之间更强的全局顺序。每个最终 actor 必须同时满足：真实最终持久消息、所有声明工具/通信完成、FSM 释放、唯一最终 Stop hook exit 0 + JSON Allow、无在途模型请求、HC status 空。中间 pause 则单列，不冒充释放。

普通 actor/native-agent 与 reviewer 是不同协议：前者返回文本/TSV；后者通过 HC 的 structured-tool completed part 完成。PLOT 不接受两个不兼容格式来“保绿”。

## 扩展 PLOT 的边界

框架支持有限声明：tool、pause、wait_actors/wait_bindings/wait_for、逐字段 expect/capture、显式绑定与最终 sum。它不是通用编程语言。FSM 产品字段、观测只读接缝和 native host 消息形状在目的明确的基础设施模块中；业务数值和步骤只在 PLOT。

新剧本应选新的 golden 路径，完整预声明允许错误、动态身份、观察策略及完成条件。现有 source/binary/YAML/PLOT hash 改变后，旧 replay 必须失败；不得修改旧 golden 或用手工工具补写被测状态。
