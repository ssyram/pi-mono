# D.root — Script task infrastructure

本frame的纯基础设施完成“结构化任务→全脚本结果→唤醒判定与共用正文”。用户后续批准的调度/投递/widget接线由外层dispatcher/runtime承担，详见v2设计；不混入底层进程函数。

## 研究与真实候选

已有 v2 scheduler 管理 schedule/注册/会话进度，但回调为同步 prompt 投递；初始基础设施阶段未更改它，后续接线保持调度核心同步并增加执行桥。已有 Boulder 提供自动消息来源句与专属 renderer，不复制其任务续跑/CONFIRM-TO-STOP 指令，因为本任务不管理 Boulder。save-msg原先缺少~展开，现已另行接入共享路径函数。原生 exec 的进程终止契约不足；另一插件 OwnedProcessRunner 包含 stdin 上限、输出上限、取消、宽限、外部 survivor 和 reconciliation，导入它会把不属于当前合同的策略一起引入。

推荐独立小模块：顺序 for-of、直接 spawn、超时立即强杀、纯函数聚合/格式化。真实替代是复杂进程框架或要求 AI 先调用 bash；前者引入无任务依据的状态，后者破坏 NoWakeUp。使用 Node 已安装 API，不新增依赖或研究无关外部调度系统。

## Upstream / P

Root 引用 overview Q1–Q9。

- P1：有效输入归一化为 scripts + wakeUp；默认 cwd='.'、params=[]、timeoutSeconds=1800、on-error aggregation='or'。绝对 cwd 基准由调用者提供，路径先解析再执行；argv 保持条目边界，不经 shell。
- P2：never + [] 与 on-error + [] 返回明确输入错误；always + [] 是纯提示任务。字符串 prompt 可为空；不凭设计偏好新增非空限制。
- P3：顺序尝试每项脚本，结果数量等于输入数量，顺序与脚本一一对应。普通执行失败/启动失败/超时均为结果，不抛给批次，不自动重试。
- P4：success 等价于正常退出码 0 且无 timeout/start failure；其它结果为失败。on-error or iff 存在失败，and iff 全部失败且数量>0。always=true，never=false。
- P5：每脚本独立计时；null 不建 timer。超时向拥有的进程组直接强杀，无额外宽限；等待退出事件和流结束后回收 timer。超时状态不能被后续 exit=0 覆盖。
- P6：输出包含 Boulder 风格来源句、prompts 与每项 script 块；失败标记 *** FAILED ***。脚本标签采用 `<script="...", exit-code="...">`。未知退出码用 unavailable，不伪造数值。cwd、argv、signal、错误原因以及 stdout/stderr 可辨认。
- P7：单次执行 ID 由调用者传入；基础设施不管理历史/会话身份。短展示有 ID 和 successCount/total；展开直接使用同一 content 字符串。never 同样产生展示正文，但无投递。
- P8（global，作用域本次新源码）：无模块级可变会话状态、无入口注册、无 import 时执行、基础设施目录不负责production注册，后续授权的外层接线另有生命周期；文件职责单一且源码<200非空非注释行。校验外部结构，不在每个内部函数重复验证 pre。
- P9（global，路径消费者）：~ 或 ~/ 在 resolve 前展开；其他相对路径基于显式 cwd，绝对路径保持。只展开当前用户 ~，不展开环境变量/通配符/~user。

## 数据结构（跨本基础设施模块共享）

`WakeUpSetting`：never；always{prompt:string}；on-error{prompt:string,aggregation:'and'|'or'}。输入 on-error 可省 aggregation。

`ScriptSpec`：cwd:string（绝对），path:string（绝对可执行文件路径），params:readonly string[]，timeoutSeconds:number|null。timeout>0且毫秒转换安全，允许小数；null=无限。path 总是文件路径，不搜索 PATH；/bin/sh 等解释器可作为 path，脚本位置可在 params 中。params 不做路径或 shell 展开。

`ScriptTask`：wakeUp + readonly ScriptSpec[]，输入准备期间创建快照，执行期间调用者不得修改；生命周期局限于一次调用。

`ScriptResult`：script、status(success|failed|timeout|start-failed)、exitCode:number|null、signal:string|null、stdout、stderr、error:string|null。未知 code 为 null；start-failed 不可能 success；timeout 具有失败优先级。script 引用准备后的规格。

`TaskRun`：wakeUpId:string、results:readonly ScriptResult[]、successCount:number、shouldWake:boolean、content:string。0≤successCount≤results.length。生产者 executeScriptTask；消费者展示与当前dispatcher投递；SDK将它作为custom message details保存，不另建运行历史库。

`PreparationResult`：ok + task，或 ok=false + error；外部无效输入不得启动进程。

## M / goal → component mapping

| Component / 分配合同 | 目标 | 去向 |
|---|---|---|
| D.path：无副作用路径展开 | Q5,Q9 / P9 | implemented-by `my-plugins/file-path/resolve-user-path.ts`；修复接线详见 save-msg-path-fix.md |
| D.prepare：结构校验、默认值、路径快照 | Q1,Q3,Q4,Q5 / P1,P2 | expands-to detailed-design.md#准备与路径 |
| D.process：一个脚本一个进程组、真实输出、超时收尾 | Q2,Q4 / P3,P5 | expands-to detailed-design.md#单脚本执行 |
| D.aggregate：顺序全部运行、聚合失败 | Q2,Q3 / P3,P4 | expands-to detailed-design.md#批次执行与聚合 |
| D.presentation：来源明确、结果框、共用正文 | Q6,Q7 / P6,P7 | expands-to detailed-design.md#正文与展示 |

组合：prepare 建立所有 ScriptSpec pre；executeScriptTask 顺序 await runScript，累积一一对应 results；全部结束后计算成功数、shouldWake，并一次生成 content。展示只读 TaskRun。当前runtime/手动run经dispatcher调用该链；模型与共同decoder保存/恢复完整ScriptTask，原周期、作用域与共享索引不变。

## R

Derivation：Q2 排除依赖处理与 fail-fast，推出 P3；Q3 要求独立失败聚合，推出 P4；Q4 要求有限/无限两路，推出 P5；Q6/Q7 要求正文和视觉同源，推出 P6/P7；Q8 规定边界和可推理性，推出 P8。共同路径 P9 承接 Q5/Q9，不把 Loop 的调度策略泄漏给 save-msg。

Satisfaction：prepare 的成功出口建立类型及路径 pre；runScript 将外部执行的正常/错误/超时全部映射为终态；批次不因结果失败跳过后续项，故结果列表覆盖全部已终止的脚本；纯聚合由结果定义推出 P4；content 一次构造且 renderer 原样复用，推出 P6/P7。组合的终止性依赖每项运行终止；None 的非终止是 Q4 明确允许的，不声称无条件总正确性。

Optimality：不复制 scheduler、无运行历史库、无依赖图、无重试、无输出限额、无软杀宽限；只为当前任务引入必要状态。路径是唯一跨插件公用模块，不创建通用 utils 桶。

## 外部契约 / 生命周期（workflow 附录 A）

1. 连接：一次脚本创建一个子进程与 stdout/stderr pipes；无连接池，stdin忽略。
2. 截止：默认1800s，null无限；timer超时不是精确实时抢占，依赖事件循环可推进和 OS 能终止拥有的进程。
3. 重试/幂等：无重试；脚本可非幂等；每次基础设施调用仅尝试一次每项。未来 scheduler 崩溃语义另议。
4. 交付/顺序：列表顺序执行，成功返回包含同序全结果；无跨会话 exactly-once 保证。
5. 失败：spawn错误成为 start-failed，非零/信号为failed，timeout优先。宿主崩溃无法返回结果；不承诺逃离进程组的后代被清理。
6. 状态：每次调用私有闭包与timer；无会话缓存和重启恢复。
7. 背压：顺序执行一个进程，完整输出存内存；输出规模须适合宿主内存，未授权加入截断/kill-on-overflow。

进程执行以当前项目的 POSIX/sh 环境为前提，使用 detached 进程组与 SIGKILL；Windows 明确返回 start-failed，不伪装支持。路径纯函数遵循宿主 Node path 语义。普通结束也清理仍留在拥有进程组内的成员；终止调用错误必须在结果中可见，不能冒充已清理。平台扩展和自行脱组后代不属于本阶段的保证。
