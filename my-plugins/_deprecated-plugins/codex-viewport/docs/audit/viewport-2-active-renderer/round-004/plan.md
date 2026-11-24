# Round 004 Tribunal Plan

审查对象：当前`my-plugins/codex-viewport/`代码、tests、README、`docs/design/`与其消费者Pi 0.83 renderer/lifecycle接口。

Spec来源：

1. `docs/design/principles.md`：用户确认的意图层。
2. `docs/design/architecture.md`、`detailed-design.md`、`detail/`、`proofs/`：实现直接上游。
3. `docs/design/known-state.md`：明确边界与未验证风险。
4. `/workflow`：实现、测试、修复与契约同步门禁。

运行档位：完整终审。Main agent只派遣、收集、triage与执行judge裁定的非决策修复；攻击、证明、反驳、裁决均由fresh agents完成。

## Round 004-A：Sound + Optimization

- Challenger：攻击Q→D→I trace、terminal semantics、consumer contracts、race/failure paths；同时寻找更简单sound候选。
- Prover：逐条证明principles到architecture/detail/code/tests的覆盖并列隐含前提；同时证明为何当前复杂度必要。
- 本轮不完整审查：文档陈旧残留与完整边界矩阵留给004-B；O仍完整参与。

产物：`challenger-a.md`、`prover-a.md`、`counter-a.md`、`judge-a.md`。

## Round 004-B：Complete + Concise + Optimization

- Challenger：机械扫描声明→实现→test、消费者、文档镜像、dead/obsolete code和重复规则。
- Prover：证明边界穷尽、static/dynamic transitions、resize/lifecycle/hard-death覆盖及最小模块集合。
- O检查依赖面、private ABI、module count与可删除结构。

产物：`challenger-b.md`、`prover-b.md`、`counter-b.md`、`judge-b.md`。

## 收敛

每轮judge亲自核查关键事实。有效非决策问题修复后重跑相关测试并开新轮；触动principles、已接受风险或新增tradeoff才升格用户。最终需S/C/C/O全done且最新完整轮无新非决策有效问题。
