# FSM 兼容性独立设计审查

## 1. 范围与结论

本次只读审查采用 `/Users/ssyram/.claude/commands/workflow.md:551-562` 的 §4.4 六项标准，与用户列出的标准一致。未修改文件、启动子代理、调用 provider 或运行 daemon。

已完整读取用户指定的六类材料，并针对恢复、子启动、OC 响应及人类等待事件核对具体一手源。`expectations.md` 的自述及既往 schema 测试声明不作为审查通过证据。

**结论：**

- **首单元 `fsm-1-admission-binding`：BLOCKED。** 固定准入、新建绑定的设计基本可编码；恢复合同尚有 B1、B2 两处缺口。
- **其余核心单元：尚未全部达到可编码状态。** 实际缺口见 B3–B9；不要求现在实现这些单元，也不阻止完成首单元的局部设计修正。
- **架构路线可以保留。** 本次未发现必须修改 Pi、FSM 或第三方源码的证据；不建议重写架构或替换 SA。
- **整体设计放行判定：BLOCK。** 原因是合同细化缺口，不是缺少实现、运行测试或真实模型证据。

下文 P1 表示相应单元编码前应闭合的设计问题，并不表示已经发生运行故障。

## 2. 六项标准逐项判断

| 标准 | 判断 | 具体依据 |
|---|---|---|
| **1. 目标→模块映射、协作论证、关键假设** | **架构层通过，保留条件性边界** | `docs/design/fsm-compatibility/architecture.md:17-27` 将核心 P1–P9、mandatory P10、optional P11 分开；`:37-56` 明确模块和状态所有权；`:196-206` 给出接口及完整路径；`:247-267` 给出组合论证与外部前提。下层缺口不能据此视为已闭合。 |
| **2. 细化文档结构** | **通过** | `docs/design/fsm-compatibility/detailed-design.md:5-75` 包含范围、复用、错误、资源和数据；`:77-231` 包含模块函数细化；`:233-241` 包含完整性及证据状态说明。首单元另有文件分解、schema 和事前 expectations。 |
| **3. 推导、分支、出口、callee、循环、假设链六项完整性** | **未全通过** | 首单元恢复缺原 mandatory 比较基线及 root 分支，见 B1/B2。其余核心单元仍存在从“要求某保证”直接跳到“保证成立”的步骤，见 B3–B9。 |
| **4. 非平凡函数 pre→post 论证** | **论证覆盖就位，但部分推导未闭合** | `docs/design/fsm-compatibility/detailed-design.md:81-231` 各函数均附证明说明；`:101` 对根构造注明 trivial。恢复证明 `:113` 缺少产生比较事实的输入；并发及派发证明 `:135、193` 缺少落实互斥、握手顺序的具体步骤。 |
| **5. 函数与父模块合同一致** | **未全通过** | 恢复设计未充分承接架构 `:66、102`；根启动、FIFO 和真实调用者通知未充分承接 `:126、160`；协议及基础门禁映射未完成承接 `:29、150、172、180`。对应问题均在下文定位。 |
| **6. 无歧义、明确到可编码** | **首单元恢复及部分后续职责未通过** | 首单元其余流程已有明确输入、拒绝及状态修改边界；但 B1/B2 仍需实施者自行补合同。后续单元需要补的是具体参数、状态转换和接线，不是运行证明。 |

### 标准 3 的六个子项

| 子项 | 判断与依据 |
|---|---|
| 推导连续 | 准入及路径处理连续，见 `detailed-design.md:81-105`；恢复比较缺事实来源，见 B1；并发握手缺协调步骤，见 B6。 |
| 分支覆盖 | 缺失、损坏、错误 self 已分开，见 `:109`；恢复未显式区分 root/child，见 B2。 |
| 退出覆盖 | 已规定失败不产生未声明效果、资源按所属释放，见 `:75、119-135`；异步完成及实际子运行取消出口仍缺接线，见 B7。 |
| callee 契约引用 | 公共外部合同已汇总，见 `:37-48`；协议投影、规范化和任务问答事件尚缺具体输入/输出映射，见 B5/B8/B9。 |
| 循环刻画 | 有限数组、父链 seen、服务取消及 deadline 已说明，见 `:75、97、109、135、153、223`；不要求额外逐 AST 形式证明。 |
| 显式假设链 | 真实 SessionManager、认证 principal、required startup 等前提明确，见 `:43、63-65、97、105、197`；原策略基线及“这是任务问答”的事实生产者未明确，见 B1/B9。 |

## 3. 首单元：`fsm-1-admission-binding`

### 已正确的部分

- 固定 canonical 名单、空名单不派遣、禁止发现列表扩张：`docs/design/fsm-compatibility/subplans/fsm-1-admission-binding.md:9、51-57`。
- native Pi、真实 mandatory 路径、自动补 self 后再次检查 32 项上限：`docs/design/fsm-compatibility/detailed-design.md:85-89`。
- 后代名单、深度只能收窄，定义保留父快照：`subplans/fsm-1-admission-binding.md:11、57`。
- 身份来自 principal 和真实树，不接受模型提供的免检字段：`detailed-design.md:97、105`。
- 同 launch 不覆盖不同 self，损坏绑定不退化为未绑定：`detailed-design.md:105、109`。
- 不把路径存在当作插件已加载，不把本单元完成当作完整插件完成：`subplans/fsm-1-admission-binding.md:79`。
- schema 与树、路径、身份语义分层，性质测试范围已有界定：`docs/audits/fsm-1-admission-binding/expectations.md:28、66-83`。

### B1 — P1：恢复核对“原必载合同”缺少原策略基线

**位置：**

- `docs/design/fsm-compatibility/architecture.md:102` 要求恢复满足当前准入和**原必载合同**，冲突拒绝。
- `docs/design/fsm-compatibility/detailed-design.md:62-65` 的持久绑定和 principal 未包含原 mandatory 快照的读取合同。
- `:111-113` 的 `restoreActorBinding(policy, saved, actualSessionId, callerRoot, records)` 要求“当前 mandatory 路径一致”，但没有指定与什么原值比较。
- `subplans/fsm-1-admission-binding.schema.json:55-95` 只有身份、agentName、bootstrapRef，没有原 mandatory 基线。

**具体问题：**

原运行必载集合为 `{fsm-compatible, X}`，恢复配置变成 `{fsm-compatible}`。现有 `saved` 字段无法表达 X 曾经必载；`bootstrapRef` 也没有已定义的“取得原快照”合同。仅检查当前配置中的路径，不能推出原必载合同未被删除。

外部已有可用事实来源：SA 的 `src/shared/required-child-extensions.ts:106-114` 保存和读取原快照；`src/runs/background/async-resume.ts:261-395` 校验恢复描述符中的 requiredExtensions。但这些事实尚未接入首单元恢复接口；根恢复的基线来源也未规定。

**最小修正：**

给恢复函数增加明确的、已验证的原 mandatory 快照输入，并规定调用者如何取得它；缺失或与当前策略冲突时返回 `restore-conflict`。首单元仍可只接收不可变值，不增加 IO、spawn 或 daemon 调用。随后同步叶子合同及 expectations。

不需要新增秘密持久化、哈希协议或另一套 registry。

**违反：**原 P4/P8、ChildAdmissionPolicy；§4.4 第 3、4、5、6 项。

### B2 — P1：合法 root 恢复没有独立分支

**位置：**

- `architecture.md:66` 定义 root 的 `parent=null`。
- `subplans/fsm-1-admission-binding.schema.json:79-95` 明确允许 root 的 parent、agentName、bootstrapRef 为 null。
- `detailed-design.md:113` 在统一恢复步骤中要求“原 agent 仍准入”和“parent 存在且无环”，未限定这些步骤仅适用于 child。

**具体问题：**

合法 root saved 满足函数前置条件，却没有 child agentName 或 parent。按现有统一步骤，它无法通过；若实施者自行跳过这些步骤，又是在自行补充未写明的分支。

**最小修正：**

显式按 `saved.kind` 分支：

- root 检查真实 header、自身 root 等式、`agentId=main`、null 字段及 owner/原策略合同；不检查 child allowlist 或 parent 存在。
- child 检查原 canonical agent、真实同 root 父链、`agentId=self` 和原策略合同。

两路成功都只保留原身份，失败都不 fallback 为 new。

**违反：**原 P2/P8、ActorBinding 根等式；§4.4 第 3、5、6 项。

**首单元最终判定：BLOCKED。** 修正 B1/B2 即可补齐当前定位到的阻塞点，不需要扩展到运行通道或真实模型测试。

## 4. 其余核心单元的实际设计缺口

### `fsm-2-runtime-broker`

#### B3 — P1：根会话 mandatory 加载健康检查未接入 ready 提交

`docs/principles.md:9` 要求根、子、嵌套、恢复都加载规定必载扩展。`detailed-design.md:119` 的启动顺序只有策略解析、能力准入、进程建立和 required registration；后者是对子运行的注册，不等于根会话实际加载成功。

子路径已有明确保障：`detailed-design.md:197`，以及 SA `src/runs/shared/child-session.ts:443-530` 中的加载错误检查、await binding 和 required startup error 处理。根路径没有对应事实检查。

**最小修正：**在根 `ready=true` 前，明确取得实际加载集合及必载启动结果的公开来源，核对 mandatory 快照；失败维持 not-ready，并释放本次资源。不能以 realpath 成功或 SA registration 成功代替根加载成功。

**违反：**Q.I-4、P4，runtime-owner 任务前准入合同；§4.4 第 3、5、6 项。

#### B4 — P1：跨根 canonical 协调仍停留在机制占位

`detailed-design.md:135` 将 callee 写成“宿主级协调文件/OS 独占机制”。锁键、deadline、禁止删除他人锁等性质已明确，但没有选定建立唯一独占资源、释放及进程退出后清理的具体机制。该“独占已经存在”的假设正是其证明的关键。

**最小修正：**选定一个插件可实现的机制，写清共享位置、原子取得方式、持有者标识、取消/释放步骤，以及确认原持有者结束后才清理的规则。保留现有 pid+start+canonical 键和 acquire→response 区间，不改成 per-root mutex。

**违反：**P2/I2，`architecture.md:56、142、223`；§4.4 第 3、4、6 项。无需增加 OS sandbox 或对不遵守协议的外部调用者的保证。

### `fsm-3-protocol-judge`

#### B5 — P1：OC 投影及 judge 工具映射没有完成字段级细化

`architecture.md:60` 明确要求 wire 字段在细化阶段按消费者 schema 固定。现在：

- `detailed-design.md:149` 仍是“逐类型产 parts/time/error”；
- `:179` 仍是“形成 identity envelope”；
- `:167、179` 未给出 judge 工具名称、参数及 deny/allow 的具体映射。

路由目录已有依据，见 `docs/research/fsm-compatible-research.md:116-124`，因此不是缺少路由名称；缺的是数据转换规则。

原消费者确实依赖具体字段：FSM `crates/server/src/agent_cli.rs:1744-1899` 检查 `info.role/id/sessionID`、整数 `time.completed`、StructuredOutput part 身份、terminal state 及 object input，并区分错误尝试、相同重复 capture 和冲突 capture。仅写“合法 envelope”未说明怎样从 Pi 事实构造它们。

**最小修正：**补当前消费者实际读取字段的来源/转换表，以及 user、assistant、toolResult、错误和 StructuredOutput 各分支；补 Read/Grep/Glob 与已授权 Review extras 的工具及参数映射。可以直接引用具体一手 schema，不必复制整个 OpenCode 协议，也不要求支持所有未来 provider。

**违反：**P5/P6、`architecture.md:29、172、180`；§4.4 第 3、5、6 项。

### `fsm-4-child-gates`

#### B6 — P1：并发 new launch 的 FIFO 握手顺序未落实到函数步骤

`architecture.md:160、223` 要求逐个完成新 actor acquire 握手。`detailed-design.md:193、197` 只描述每次请求自己的 spawn→握手，没有负责跨请求排序的队列、协调对象及进入/退出点。

两个并发请求都可各自满足当前前置条件，却无法由这些步骤推出 A 子先认领第一条 dispatch、B 子后认领第二条。FSM 只按实际 acquire 顺序消费 FIFO，见 `docs/research/runtime-source-conclusions.md:90-96`；本次亦核对了 `crates/server/src/session.rs:1805-1939` 的恢复跳过、new 应用及失败保留逻辑。

**最小修正：**在 root owner 中明确 new-start 握手队列及串行区间，规定成功、明确失败、取消和结果未知时下一项何时可进入。长期 child 工作不持该协调资源；恢复不进入 new dispatch 认领流程。

**违反：**P4、child-launch 顺序合同；§4.4 第 3、5、6 项。

#### B7 — P1：异步完成通知及取消没有实际调用者接线

`architecture.md:160` 要求异步通知真实调用者、取消不换 actor。`detailed-design.md:193` 在 async 分支只返回 actual run；`:201` 细化恢复；没有描述异步 terminal 事件如何关联 `callerSessionId` 并通知嵌套调用者，也没有描述 signal 怎样停止已启动的 SA run。

根 broker 发起 SA RPC，不代表 SA 默认通知目标就是插件登记的真实嵌套 parent；这一身份区别已在 `docs/research/runtime-source-conclusions.md:86-88` 明确。

**最小修正：**补实际 completion/cancel 公共接口合同、run→binding/caller 关联、terminal 后通知和 owner 失效出口；cancel 等待并记录实际终结，不作为正常成功。

**违反：**P4/P7/P8、child-launch 接口合同；§4.4 第 3、5、6 项。

#### B8 — P1：核心 permission normalizer 只有名称，没有转换合同

`detailed-design.md:205` 引用“基础 normalize”，但没有独立函数合同或完整映射表。研究材料只规定方向和部分例子：`fsm-compatible-research.md:159-160`。

例如 Pi 文件工具使用 `path`，原门禁需要相应工具语义和 `file_path`。若输入未经映射，可能丢掉受检查路径；若把所有文件工具映成 Read，则改变权限含义。这是核心 gate 输入问题，不是后续常用命令翻译。

**最小修正：**补当前基础工具与 FSM/MCP namespace 的确定性名称、参数映射、保留字段和未知工具出口；说明 nested executeTool 复用同一 hook。公开 Pi 合同已经支持该复用，见 `PI/dist/core/extensions/types.d.ts:262-280`。

**违反：**P3、`architecture.md:29、150、152`；§4.4 第 3、5、6 项。

### `fsm-5-watch-install` 与人类等待接线

#### B9 — P1：任务问答语义及 headless 结束事件没有生产者

`detailed-design.md:213` 的前置条件是“明确本 session 的人类任务问答”，但没有定义谁提供这个事实、如何与配置 UI 区分，以及取消/普通输入怎样结束等待。

Pi 的 `ui_prompt_start/end` 只提供 kind、title 等信息，见 `PI/dist/core/extensions/types.d.ts:772-788`；相同 input/editor 可以属于任务问答或配置操作，不能直接从 kind 推出业务语义。

**最小修正：**定义 session-owned 的任务问答标记及其设置/清除者，将实际开始、回答、取消和恢复事件接到 suppress/release；补 print/headless 的输入结束合同。只承接现有问答/输入通道，不新增 mandatory AskUserQuestion 工具或 GUI。

**违反：**`docs/principles.md:15`、P7、`architecture.md:267`；§4.4 第 3、5、6 项。

### 后续单元判定汇总

| 单元 | 当前判定 | 应在该单元编码前闭合 |
|---|---|---|
| fsm-2-runtime-broker | BLOCKED | B3 根 mandatory 健康检查；B4 具体跨根协调机制 |
| fsm-3-protocol-judge | BLOCKED | B5 wire 投影和 judge 工具转换合同 |
| fsm-4-child-gates | BLOCKED | B6 握手排序；B7 完成/取消接线；B8 基础 normalizer |
| fsm-5-watch-install | 尚不能整体放行 | B9 等待事件接线；并依赖前序单元合同闭合 |

Watcher 接收后才返回 204、accepted/scheduled/consumed 分离、旧 owner 不转投新会话等合同已正确写出，见 `detailed-design.md:219-227`。本次没有因它尚未实现或尚未实测而增加阻塞项。

## 5. 边界与最小修正顺序

1. **先修首单元 B1/B2。** 不引入 MCP、provider、SA 启动或 daemon 副作用。
2. **其余 B3–B9 在各自单元编码前细化。** 不要求为了首单元放行一次性实现全部核心。
3. **保留已接受架构和状态所有权。** 修正集中于输入事实、分支、协调步骤及协议映射。
4. **核心完成后仍必须做 P10 命令翻译。** `architecture.md:26、31` 已明确它不是 optional；本轮未细化不阻塞首单元。
5. **不增加额外放行条件。** 本报告不要求设计阶段真实 provider/e2e 运行、逐 AST 形式证明、任意 remote runner、OS sandbox、GUI 或 optional 常用工具。
6. **不接受 scope 降低替代修正。** 不能删除恢复 mandatory 核对、FIFO、嵌套通知或人类等待来消除上述问题。

`expectations.md:111` 声称已有九个 schema 形状用例通过；本次未复跑，也未把它当作恢复语义已验证的证据。版本绑定、实现测试和授权后的完整运行仍是后续责任，不是本次新增的设计阻塞条件。

## 6. 审查结语

- **Correct：**目标分配、架构边界、固定准入、不可缩减策略、新建真实绑定、Stop continuation、独立 judge 收尾及 Watcher 接收语义已有明确依据。
- **Fixed：**无；本次严格只读。
- **Finding：**B1–B9，均定位到原合同和最小修正，不包含“尚未实现”或“缺运行证据”类问题。
- **Merge verdict：BLOCK。** 首单元先闭合 B1/B2；其余核心单元按依赖分别补齐上述实际缺口。