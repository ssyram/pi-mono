# fsm-1-admission-binding：固定准入与真实绑定

状态：叶子细化合同，待细化阶段确认及 workflow §4.4 审查后编码。本子计划不启动子代理、不接 MCP、不消费 dispatch、不调用模型，不能以其完成宣称完整插件已可运行。

父合同：`../architecture.md` 的 P2/P4/P8/I1/I3；函数合同：`../detailed-design.md §5.1`；用户来源：Q.I-1/Q.I-4。事前 expectations 位于 `../../../audits/fsm-1-admission-binding/expectations.md`。

## 1. P：本单元要保证什么

- A1：admitted agents 恰由明确配置的 canonical 名称选择，没有 discover-all/别名/模型参数扩大路径；空名单意味着不派发。
- A2：允许的 runner 仅本机 native Pi；mandatory 扩展含宿主真实 fsm-compatible 入口，路径经 realpath，不允许同 ID 指向其它文件。
- A3：后代名单和 depth 只能收窄、mandatory 扩展不能删或替换；定义本身保持父快照，不按同名重新发现其它 agent。
- A4：root/parent/self 来自真实 SessionManager 和认证宿主 principal；模型可写的 root/internal/runner/extension override 一律拒绝。
- A5：恢复只复用原 root/parent/self/agentId；无绑定、坏绑定和不匹配绑定有不同结果，坏绑定不能退化为新建。
- A6：失败不产生 launch、FSM mutation 或注册副作用；每次 new PendingLaunch 最多绑定一个实际 self。

这些是本单元的对上保证，不是全插件保证；没有对应函数实现/测试时不得称 A1-A6 已通过。

## 2. 公开输入、内部数据与错误

机械输入 schema：`fsm-1-admission-binding.schema.json`。入口使用 `definitions.PolicyInput`、`definitions.LaunchRequest`、`definitions.PersistedBinding` 分别校验；JSON Schema 不能表达的同 root/self、树关系、路径等价、策略集合包含由语义函数检查。

PolicyInput：allowedAgentNames、requiredExtensions、maxDepth。requiredExtensions 输入只允许 id/path；requireForAllRunners 标记由宿主输出，不接受外部伪造。fsm-compatible 扩展真实路径由宿主参数提供，配置同 ID 不同路径拒绝，缺席则加入真实项；加入后最终集合仍须≤32，否则拒绝，不以输入项数代替最终项数。

ResolvedAgent 仅来自明确配置候选：canonicalName、runnerType（缺席等于 pi，符合 SA）、machine（存在即禁止）、runtimeName、definitionSnapshot、declaredToolCeiling。所有输出深复制并冻结公开数组/普通对象；不公开可写 Map/Set。

PersistedBinding 使用 version=1、rootSessionId、sessionId、parentSessionId、agentId、kind（仅 execution-root/child）、agentName、bootstrapRef、requiredExtensions。root 的 agentName/bootstrapRef 为 null；child 必須非空。requiredExtensions为上次实际接线成功时保存的非秘密mandatory {id,path}真路径快照，根/子均必需且含fsm-compatible；由调用者从当前真实分支custom binding读取，不能用当前配置反推原值。root 相等式、child agentId=self且不占用根保留main、快照唯一性由语义检查，不以schema合格代替。

错误枚举承接 detailed-design §3.1。保持机器可判定 code，不把未经脱敏的任意输入回显到错误。文件不存在/不是file/realpath失败为 required-extension-mismatch；损坏的 persisted payload 为 binding-mismatch，合法但不属于当前 owner 为 restore-conflict。

## 3. I 计划与函数对应

| 拟新增文件（插件 src 下） | 单一责任 | 合同 |
|---|---|---|
| admission/admission-result.ts | 结果/错误集合 | detailed-design §3.1 |
| admission/admission-policy.ts | PolicyInput/AdmissionPolicy 语义类型 | §4 |
| admission/parse-policy-input.ts | 外部形状校验 | §5.1 parsePolicyInput |
| admission/canonicalize-required-extensions.ts | mandatory 真路径 | §5.1 canonicalizeRequiredExtensions |
| admission/build-admission-policy.ts | 固定 canonical agent 快照 | §5.1 buildAdmissionPolicy |
| admission/narrow-admission-policy.ts | 后代单调准入 | §5.1 narrowAdmissionPolicy |
| admission/admit-child-launch.ts | 请求准入及深度 | §5.1 admitChildLaunch |
| binding/actor-binding.ts | Actor/PersistedBinding 类型 | §4，架构 §3.1 |
| binding/create-root-binding.ts | 根等式 | §5.1 createRootBinding |
| binding/bind-new-child.ts | 一次 PendingLaunch 绑定 | §5.1 bindNewChild |
| binding/read-persisted-binding.ts | 原分支 binding 判读 | §5.1 readPersistedBinding |
| binding/restore-actor-binding.ts | 同 actor 恢复 | §5.1 restoreActorBinding |

实际 helper 仅在重复使用且有独立责任时拆文件；不先造通用抽象。上述文件均不超过源码 200 LOC。无 index 实现、无 inline import。schema 是规范源；常量由明确 schema/本合同定义，不按后缀猜字段或错误类型。

## 4. 主流程、分支和退出

P1 配置 unknown→parse；形状/未知字段/重复/空名拒绝。合法空 allowlist 继续，但后续所有派遣都拒绝。

P2 canonicalize mandatory；realpath/stat 每项检查，任何失败全失败；输出保证真实 self 及 requireForAllRunners=true。这里只做路径解析，不导入/执行扩展。

P3 build fixed policy；仅 allowedAgentNames 精确查询候选；任何名单项缺失或非 native 使整个配置失败，不部分承认，也不向 discovery 找同名替代。

P4 descendant policy；集合 subset、depth、mandatory id/path 不变及定义快照不变全部满足才输出。输入中的更多 discovered agents 不改变已固定 parent。

P5 request准入；caller从AuthenticatedCaller取得，树查 parent/depth并以seen拒绝循环；agent/runner/ceiling全满足才生成ChildLaunchBinding。结果尚无bootstrap秘密，真实launch另一个单元负责。

P6 真实 root/newchild 绑定；root按等式构造并保存policy mandatory真路径快照，不查询child allowlist；child先验证pending和parent、saved分支，再唯一登记self及当前mandatory基线。same-launch same-self重试可确认，same-launch different-self拒绝。

P7 persisted read/restore；没有custom binding返回null；损坏/错版本/错self/缺失mandatory基线明确错误。共同检查实际self/owner root及saved.requiredExtensions逐id/path仍包含于当前policy。root分支只核根等式、main/null字段及原mandatory，不检查child名单或parent存在；child分支核原agent仍准入、agentId=self、同root真实父链和depth；父链不能经过待恢复self，验证的是接入后的树不成环，而不只原父链自身无环。两路原身份不变；新增mandatory允许且返回更新快照，调用者只有在实际加载/接线成功后追加新binding成为下次比较基线。任何错误不fallback为new。new SA run ID不被读取为actor。

每个P步骤分别对应上表函数；字段迭代与父链迭代都有限，父环被seen捕获。只有P6合法成功分支修改传入PendingLaunch；错误在修改之前返回。文件读取在P2依赖注入，可用真实fixture与故障fixture测试，无外部认证secret。

## 5. R：为什么满足父合同

A1/A2：只有配置列出的 exact canonical 项能进入不可变 policy；native/mandatory检查发生在输出前，故既不能通过发现列表扩大，也不能接受缺门禁 runner。

A3：narrow 对允许集合做包含、depth做≤、mandatory做逐id/path保留；定义沿父快照而非重新discover。因此任意有限代后代仍不扩大名单或删门禁。

A4：admit 与 bind 使用宿主 principal、真实树和实际 sessionId，拒绝所有身份/策略免检字段；模型没有通过合法输入写这些真源的路径。

A5：read 将缺失和损坏分离；saved.requiredExtensions提供原mandatory比较事实，当前policy只能保留/增加不能删除/换路径。restore显式root/child两分支保留原身份，原合法root不被child parent/名单检查误拒；返回的非秘密mandatory基线单调增加，调用者实际接线成功后才持久化。失败没有new fallback，因此新run不会换FSM actor。

A6：注册/spawn/daemon不在本单元callee集合；PendingLaunch只在全检查后从allocated登记same-self，所以错误不消费外部工作，different-self不覆盖。

组合上，本单元向 runtime/launch 提供可用的固定政策与真实绑定；它不独自证明“门禁插件已加载”，实际 loading/start/acquire 的保证由后续单元履行。不得用 policy 中有 extensionId 就冒充 runtime 已加载。

## 6. 测试、机械约束与副作用边界

- 测试文件拟为 test/admission-policy.test.ts、test/actor-binding.test.ts、test/admission-binding-schema.test.ts；从插件目录用 node:test 逐文件执行，不跑全仓库 e2e。
- schema 与实际 parser 同表：valid、未知字段、重复、空值、错版本、root/child变体。语义关系另外测试，不能以 schema parse 通过冒充可派遣。
- 性质测试使用三项符号全集枚举全部父/子允许集对、mandatory删减/替换、depth与有限树变体；扩充确定性生成器覆盖字符串/重复/父环。node:test 为执行框架，不新增性质依赖。保持实际失败输入，修测试仅在证实用例错时。
- 真路径fixture使用插件 test 临时目录，包含同文件路径别名、symlink、不存在路径和directory；结束只回收本fixture。没有Rust/SA/Pi/provider调用。
- 除上述路径解析及PendingLaunch登记外，纯函数无效果；测试用call counters证明错误路径零spawn/零daemon/零注册。
- 实施前的JSON schema、共享错误常量和P1-P7流程注释明确可机械检查；只有适用的执行函数标相应Step Pn，不为纯type文件添加虚假步骤。
- 代码后的 npm run check 按项目规则执行；官方源码或他人变更的问题单独报告，不为过check越界修改。

## 7. 退出条件

叶子设计满足 workflow 六项完整性，进入编码前通过既定设计审查。实施后：对应测试/生成性质/schema通过、文件职责和200LOC符合、external零修改、无未解决契约critical，按workflow §6进行一次既定独立对照并处理明确差异。不增加无限审查轮次。

退出只关闭本子计划；根目标仍有原通道、协议、judge、子生命周期、门禁、Watcher、实际运行和mandatory命令翻译责任。
