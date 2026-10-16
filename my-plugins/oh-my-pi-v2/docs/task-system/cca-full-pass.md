# 完整 task 系统 CCA — 本轮合同与交付责任

## Q：用户本轮裁决

用户确认：OMP-v2 整个 task 系统沿现有 CCA 一次全扫，发现确认的潜在问题/bug就修，尤其公共运行路径不能向Pi抛出exception。现有304定义是Boulder/loop混合清单，不代表完整task系统，不把该数字作为排除其他task源码的上限。

沿用 principles.md、architecture.md 与 exception-safety-scope.md 的业务及异常合同；其旧dormant/旧授权阶段文字为历史，当前授权包含task实际入口和最小修复，不包含官方Pi源码、无关插件功能、自动reload/提交/发布。旧Hoare/CCA报告是版本化证据，不认证当前代码。

## P：可判定标准

- 每个选入函数有作用、caller/callee、Pre/Post、异常退出及状态效果；循环和共享状态按原CCA SP/[SELF]纪律推理。普通I/O、getter、显示、logger和异步拒绝不能被无依据假定永不失败。
- 每个真实公共command/tool/event/timer/renderer/completion回调自己的边界消解异常和Promise拒绝，诊断/格式化/catch臂不再次抛；内部throw要明确由哪个实际外围捕获。Pi吞错不等于插件满足合同。
- 保留任务图/依赖/生命周期、稳定ID、批量尽力执行与单操作原子发布、list全状态和显示过滤分离、session/branch隔离与门禁fail-closed。
- 持久化前失败不发布部分候选；持久化/展示失败诚实区分已生效与不确定，不能宣称native日志已回滚、假成功或伪空任务状态。
- 完整task消费面及可达闭包不得静默遗漏；所有选入定义有覆盖/分析/不可达理由的可定位对账。不能把所有拓扑根伪装为公共入口，也不以工件数证明语义正确。
- 问题须有源码锚点和可达反例或明确未闭合义务。无根据的预防性加强不自动成为bug；unknown不假称pass。

## M：范围和执行

目标包括 tools/task-system、tools/task*.ts、commands/task*.ts、task-gate、Boulder相关hooks/协议、任务状态compaction消费，以及extension中的task注册、widget与生命周期。其直接本地task依赖按源码/进口闭包对账。loop已有接入保留为相关协作范围，绝不据它的函数数宣称整个task已覆盖。extension含其他子系统，只有task归属职责在本轮合同内；其他注册的源作为context而非无边界全插件审计。

独立fresh-context OpenCode reasoner，固定tmp-haokun/glm-5.3-flash，通过原CCodeAnalyze-decoupled/analyze-batch流程，只读源快照。旧cca3冻结图不被改写；旧checkpoint保留并记为范围变更移交，不假标COMPLETED。完整快照与最终manifest、源hash、root、运行/权限回执落task-owned run目录，不把运维脚本塞产品源码。

当前完整快照：`~/cca-runs/boulder-ts-cca4/`，74个目标文件预检565定义/152外部/0跳过，含既有loop协作代码，数字不是全部归属OMP本体。146份引用callee只作context。源hash/范围与工具绑定在 `~/.local/share/boulder-ts-cca4/run-manifest.json`。旧cca3 root已abort并停task-owned server，checkpoint保留在 `~/.local/share/boulder-ts-cca3/scope-handoff-checkpoint`，不是COMPLETED。

完整run：root `ses_ecb040554ffeYDMKB7uqxk3xuO`，4220，`tmp-haokun/glm-5.3-flash`，实际模型冒烟OK后正式prompt HTTP 204。2026-10-14 原生 committed transition 接受 A_DONE 并退出；绑定 interval 已取消、任务专属 tmux 已停止、共享 daemon 未动。权限、历史失败与接续回执保留在 events.jsonl。本体覆盖账存在实际挂载函数被误列不可达的反例，不能把流程终态当全系统已证。逐项裁定、已落实修复、首次 task/恢复直接测试及剩余门禁恢复策略见 [cca4-findings.md](cca4-findings.md)。

用户在结果回程后进一步强调：后续修复不得主动 throw/rethrow，错误改成显式结果；task 创建/启动、失败重试和人工恢复不得被 no-task-no-tool 自锁。普通有效会话、可用 SDK/append 与合法输入下的首次 task 通路须直接测试，存储失败不能伪造成功。用户后续已取消独立的应急 off 补丁，要求 task 全部设置含 show 直接相对 import my-settings，字段 `omp-task:XXX`；默认 session，--persistent 额外local，--global 额外global，两标记可组合。迁移与真实故障通路测试见 [settings.md](settings.md)。坏文件不被覆盖，文件失败仍尝试session，但session/SDK故障不能虚假保证成功。既有全部内部函数零抛出和完整覆盖未被本轮证明。

一个有界全扫后父级按原合同逐项裁定：确认bug→最小修复与直接回归；误报→源码理由；unknown→准确缺失前提/证据。不追加相互审查或全轮重复审核。对实际修复保持函数级合同和调用处一致，运行受影响测试、专项类型检查及必需根check。真实加载/验收和提交权留用户。

## R：为何这样足够且必要

原无异常外逸和诚实状态合同直接给出P，不从现有catch数量或旧通过结论倒造标准。完整消费入口→caller/callee/SP及异常出口→实际捕获owner建立组合检查；直接故障测试确认修复触及反例，而不是统计throw被减少。源快照/范围对账防止把外部参考与受析目标混同，冻结图换scope保留旧证据避免并发改工作集。内部helper保留合法throw，最短修复位于拥有失败责任的公共外围，不设计新registry/重试/假rollback。

CCA为自然语言推理和风险证据，不是机械证明；正常资源与SDK合法调用为界，进程终止/OOM不作JS返回承诺，不能以此排除普通可达异常。最终交付仍需具体问题、修复、直接运行依据及未完成边界。
