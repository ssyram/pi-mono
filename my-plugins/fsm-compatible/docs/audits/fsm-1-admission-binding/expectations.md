# Contract Expectations — fsm-1-admission-binding

状态：事前从合同抽取，尚无实现源码；本文件不是审核报告，不标 pass，不回填实现位置。来源为用户 Q、已确认架构、当前叶子细化，未依据本插件实现倒推 expectations。

## 1. 契约源

- `docs/principles.md`：Q.I-1、Q.I-4，固定可派遣范围与必载门禁属核心。
- `docs/design/fsm-compatibility/architecture.md`：P2/P4/P8、ActorBinding、ChildAdmissionPolicy、I1/I3。
- `docs/design/fsm-compatibility/detailed-design.md`：§3.1错误模型、§4数据、§5.1函数。
- `docs/design/fsm-compatibility/subplans/fsm-1-admission-binding.md`：A1-A6、P1-P7、副作用/退出条件。
- 同目录 `fsm-1-admission-binding.schema.json`：输入与持久化机械shape。

约束以原目标/父合同为准；schema合格不替代树/策略/真路径语义。外部 SA 已有32项mandatory上限作为接入前提，不自行增加未讨论的 agent 业务限制。

## 2. Schema 字段（机械化）

| 类型 | 字段 | 谓词 |
|---|---|---|
| PolicyInput | allowedAgentNames | 有限字符串数组、无重复、可空；空表示所有派发拒绝 |
| PolicyInput | requiredExtensions | id/path对象数组，最多32输入项；不能含外部可写requireForAllRunners |
| PolicyInput | maxDepth | 正整数 |
| LaunchRequest | agentName/executionMode | exact配置名称；mode为sync/async |
| LaunchRequest | resumeSessionFile | 可缺席，存在为非空路径字符串；不是重新分配actor的许可 |
| PersistedBinding | version | 恰为1 |
| PersistedBinding | requiredExtensions | 非空原mandatory真路径id/path快照，含fsm-compatible；缺失/损坏拒绝，不从当前配置反推 |
| PersistedBinding | rootSessionId/sessionId/agentId | 非空标识；相等关系由语义检查 |
| PersistedBinding | parentSessionId/kind/agentName/bootstrapRef | root为null/execution-root/null/null；child对应非空/execution-child/非空/非空 |

所有外部对象 additionalProperties=false；Identifier拒绝前后空白与NUL。重复extension ID/realpath、root相等式、child agentId=self、actualheader匹配、树环均另列语义测试，不误称schema已覆盖。

schema不是内部所有数据结构的序列化；AuthenticatedCaller与秘密不向模型或持久binding暴露。实现位置：待编码，不在本文件事后补为审查前提。

## 3. 枚举与常量（机械化）

- executionMode：sync、async。
- persisted kind：execution-root、execution-child；judge不进入该schema。
- AdmissionErrorCode：invalid-input、agent-not-admitted、runner-not-admitted、required-extension-mismatch、policy-widened、binding-mismatch、parent-not-found、parent-cycle、depth-exceeded、restore-conflict。
- customType精确为fsm-compatible:binding；bindingversion=1。
- mandatory self ID精确为fsm-compatible；真实self path由宿主提供，不能由模型配置替换。

错误集合在一个具体责任文件定义，各消费者import；不能各写一份或从文件名猜错误类别。机械source检查在实施后执行，当前N/A（无source）。

## 4. 流程步骤（机械化）

P1 parse→P2 mandatory realpath→P3 fixed policy→P4 descendant narrow→P5 request admission→P6 actual root/newchild bind→P7 saved/read/restore。

对应执行函数保留 `Step Pn` 注释供直接检查；type/常量文件不伪造执行步骤。步骤内全部失败出口与合流按细化§5.1，拒绝不能绕回成功fallback。

## 5. 行为契约

- 发现、可执行、权限允许都不等于FSM准入；只精确canonical配置集能入policy。
- alias-only、错名、missing definition、非Pi runner、machine placement拒绝；空名单绝不自动变全部。
- mandatory self真实路径必须保留；同ID不同path、相同真实path重复、路径解析失败拒绝；自动加入self后的最终集合超过32也拒绝。
- definition快照不随child的同名重新发现而改变。
- 缺失saved返回null；损坏/错版本/错header必须返回错误而非null；合法但错owner为restore-conflict。
- 恢复保留原root/parent/self/agentId；SA runId不参与构造。child不能占用根保留agentId=main，冲突新建/恢复/父链均拒绝；root仍合法使用main。
- schema/key/value无效不回显原对象/凭据，不以any/ts-ignore掩盖。

## 6. 时序/状态契约

- config/paths/definitions全验证后才产生policy，失败无部分agent注册。
- PendingLaunch只在完整parent/identity/policy检查后登记actualSessionId；same-launch same-self重复确认可接受，不同self不能覆盖。
- request admission在launch副作用之前；child实际loaded/acquire保证不属于本单元，后续单元必须承接，不能用required ID列表冒充运行健康。
- parent从当前真实树取，caller来自AuthenticatedCaller，不从模型可写字段取。
- owner/policy变化冲突拒绝resume，不销毁saved后悄悄new。
- 原mandatory基线由实际分支的saved.requiredExtensions提供；当前policy必须保留每个原id/path，删除或替换拒绝。允许新增mandatory，但只有实际接线成功后的binding写入才能推进持久基线，首单元不冒充加载成功。
- root恢复单独核header/root=self/main/null字段及原mandatory，不走child名单/parent检查；child恢复走原agent和真实父链。

## 7. 不变量契约（生成式性质测试）

以node:test承载有限全集/确定性生成器，不安装新的通用性质框架；测试需保留实际失败输入。有限集合试验不冒充所有未知场景证明。

| 性质 | 生成空间与拒绝反例 |
|---|---|
| admitted⊆explicit | 三项canonical全集的全部allowlist；追加发现项不改变输出；alias不扩张 |
| descendant⊆parent | 所有父/子子集对；子含任何父外项必须policy-widened |
| mandatory不缩减 | 三项mandatory全集的删减、同ID换路径、重复真实文件变体 |
| depth不增大 | child depth≤parent及maxDepth边界；超出必须拒绝 |
| restore identity不变 | 合法root/child均有成功分支；root无需child名单/parent；任一root/self/agentId/parent非法替换拒绝 |
| original mandatory不丢 | saved含self+X、当前仅self拒绝；同ID换路径拒绝；缺原基线拒绝；新增Y可返回更大基线，下一次删Y拒绝 |
| damaged≠missing | 任意binding字段删除/错类型/错version时不能返回null |
| one launch→one self | 相同/不同actual ID重复调用，后者不覆盖既有登记 |
| outputs不可变 | 操作输出数组/对象不能改变后续admission；冻结Map不可当替代 |
| failure零外部效果 | 生成每个拒绝分支，spy计数spawn/daemon/registration必须0 |
| tree有界 | 有限无环树/重复ID/环/缺parent：成功或明确错误，不无限遍历；旧树r→c→d中恢复c.parent=d必须拒绝接入后的父环 |

随机seed及样本量在test文件固定，不由当前时间决定；穷举部分无随机。

## 8. 性能契约（机械化）

纯集合/字段检查按实际输入长度执行；父链用seen在有限树中结束。没有网络等待、模型调用或daemon轮询，因此测试不能等待外部service。

本单元不新增武断wall-clock阈值；循环终止及有限fixture完成是必须项。时间数值断言N/A：没有来自用户/父合同的延迟SLO，不能因流程模板凭空发明性能目标。

路径解析每输入项一次，realpath失败直接返回；不递归扫描项目或全部agent目录。

## 9. 安全与副作用契约

- 实现/测试/产物仅my-plugins/fsm-compatible；无Pi/FSM/third-party源码修改，无commit操作。
- 模型/root/internal/runner/extension/policy override均不能进入合法LaunchRequest；边界unknown字段拒绝。
- binding和错误不含token/password；凭据引用不是秘密正文。
- 不导入/执行mandatory扩展文件，只检查真路径；required ID不冒充loaded。
- 本单元不调用真实provider、hook、MCP、daemon或subagent；fixture文件只归本测试并独立回收。
- 源码每file≤200LOC、barrel只重导出、无bucket/inlineimport/any/suppress；必要文件拆分只承接同一概念。
- schema测试与语义测试分别成立；JSON parser通过不表示agent可派遣。

## 10. 跨实现一致性与后续审核安排

外部对齐：SA native runner默认/mandatory id/path规范及真实Pi header ID语义；不要求复刻第三方私有registry实现。该单元没有跨语言算法或数值bit-exact需求，相关N/A。

实施后路径A：对应node:test/schema测试、步骤/枚举import/LOC检查及明确范围diff；根npm run check另按项目执行，官方预存问题不混入本diff。

路径B：按workflow既定过程由独立reasoner只读原始Q/架构/叶子合同＋本单元diff及本expectations的规范列，不以实现位置/实现者辩解作标准。实施前先recalibration回到固定名单/必载门禁/稳定身份原目的。不得临时添加审查标准或形成无限交叉审查。

本轮只准备事前合同，尚未启动审查、尚未产生audit-report/decisions，不制造空pass文件。设计schema已用Ajv 8.20.0严格编译，PolicyInput/LaunchRequest/PersistedBinding的9个正反形状用例通过；检查脚本已回收。这只确认shape可机械检验，未执行实现/树/准入语义测试。编码前先通过workflow§4.4设计审查；实施后按已定标准完成一次对照，明确critical/差异及处置，不以agent自述冒充正确性。
