# Ultra Work steering-flow instance

## 目标

把 OMPv2 想要的 **Ultra Work（极限工作模式）完整流程** 具体化为一个可加载的 steering-flow 实例。

这个实例只负责**流程控制**，不内置具体的审查算法或 agent 编排。它依赖 steering-flow 已有能力：

- 顺序状态机
- epsilon 路由
- tape 持久化
- argv-only 条件执行
- stop hook 自动续流

## 设计原则

1. **流程优先**：先完成范围判断，再进入设计、实现、审查、决策和报告。
2. **tape 是唯一共享上下文**：每一阶段都通过 tape 记录可验证的阶段结果。
3. **分歧显式化**：非决策项自动回扫，决策项进入人工拍板门。
4. **重启可恢复**：如果规格因为决策发生变化，流程回到 Stage 0 重新判断。
5. **终态可审计**：只有在报告材料齐备后才允许到 `$END`。

## 状态机结构

| Stage | state_id | 作用 | 退出条件 |
|---|---|---|---|
| Bootstrap | `$START` | 记录本次 Ultra Work 的总目标/brief | `PLAN_TEXT` 写入 tape |
| 0 | `uw0_detect` | 判断 intent/spec 是否已足够完整 | `INTENT_STATUS=complete|incomplete` |
| 1 | `uw1_design` | 写设计文档，补齐缺失规格 | `DESIGN_DOC` 与 `DESIGN_DOC_STATUS` 齐备 |
| 2 | `uw2_implement` | 实现/编码阶段 | `IMPLEMENTATION_SUMMARY` 与 `IMPLEMENTATION_STATUS` 齐备 |
| 3 | `uw3_audit` | 记录本轮审查结论 | `AUDIT_ROUND`、`AUDIT_SUMMARY`、`NON_DECISIONAL_OPEN`、`DECISIONAL_OPEN` 齐备 |
| 3-router | `uw3_router` | epsilon 路由：先修非决策项，再进入决策门，否则收敛 | tape 驱动 |
| 3-fix | `uw3_fix` | 自动修复非决策项后重新审查 | `FIX_SUMMARY` 与 `NON_DECISIONAL_OPEN=0` |
| 4 | `uw4_decision` | 汇总所有需要用户拍板的点 | `DECISION_BATCH_SUMMARY` 与 `DECISION_BATCH_STATUS` 齐备 |
| 5 | `uw5_apply` | 执行用户决策，并在规格变化时重启 | `DECISIONS_APPLIED` 与 `RESTART_REASON` 齐备 |
| 6 | `uw6_report` | 产出最终审查/交付报告 | `FINAL_REPORT` 与 `FINAL_REPORT_STATUS` 齐备 |
| End | `$END` | 流程结束 | 无动作 |

## 关键路由

### Stage 0：intent / spec 判断

`uw0_detect` 只有两个分支：

- `INTENT_STATUS=complete` → 进入 `uw2_implement`
- `INTENT_STATUS=incomplete` → 进入 `uw1_design`

这一步对应 OMPv2 的“先判断是否需要设计阶段”。

### Stage 3：审查循环

审查阶段分成两步：

1. `uw3_audit`：把本轮审查结果写入 tape
2. `uw3_router`：根据 tape 决定下一步

`uw3_router` 的优先级是：

1. `NON_DECISIONAL_OPEN=1` → `uw3_fix`
2. `DECISIONAL_OPEN=1` → `uw4_decision`
3. 默认 → `uw6_report`

这保证了非决策项先自动收敛，决策项再交给用户拍板。

### Stage 5：决策后重启

`uw5_apply` 不直接收尾，而是把流程重导回 `uw0_detect`。

原因是：用户拍板后，规格、约束或验收条件可能改变，必须重新走一遍 intent/spec 判断，避免“按旧前提继续往下走”。

## tape 约定

这个实例约定以下 tape key：

- `PLAN_TEXT`：总目标或 brief
- `INTENT_STATUS`：`complete` / `incomplete`
- `DESIGN_DOC`：设计文档内容或文档指针
- `DESIGN_DOC_STATUS`：设计是否已准备好
- `IMPLEMENTATION_SUMMARY`：实现摘要
- `IMPLEMENTATION_STATUS`：实现是否已准备好
- `AUDIT_ROUND`：当前审查轮次
- `AUDIT_SUMMARY`：当前轮审查摘要
- `NON_DECISIONAL_OPEN`：是否仍有非决策项（`0` / `1`）
- `DECISIONAL_OPEN`：是否仍有决策项（`0` / `1`）
- `FIX_SUMMARY`：本轮自动修复摘要
- `DECISION_BATCH_SUMMARY`：待用户拍板的问题清单
- `DECISION_BATCH_STATUS`：决策材料是否已汇总完成
- `DECISIONS_APPLIED`：用户决策是否已落实
- `RESTART_REASON`：为什么要重启到 Stage 0
- `FINAL_REPORT`：最终报告正文或路径
- `FINAL_REPORT_STATUS`：最终报告是否准备完成

## 实现约束

- 条件命令全部使用 argv，不使用 shell。
- 设计文档、审查结果和最终报告都必须先落到 tape，再推进状态。
- epsilon 状态只能做路由，不承担实际工作。
- 这个实例不要求 steering-flow 本身理解 OMPv2；OMPv2 只是流程语义来源。

## 文件落点

- 设计文档：`my-plugins/steering-flow/docs/ultra-work-instance.md`
- flow 输入文件：`my-plugins/steering-flow/examples/ultra-work.yaml`

## 结果

这个实例的目标不是“让模型自动完成所有工作”，而是把 Ultra Work 需要的控制流固定下来：

- 先判断是否需要设计
- 再做设计 / 实现
- 再做审查循环
- 再处理决策点
- 决策落实后重新评估前提
- 最后才允许交付与结束
