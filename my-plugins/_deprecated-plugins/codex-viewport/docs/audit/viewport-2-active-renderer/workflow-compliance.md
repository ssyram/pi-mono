# QPDI / Workflow Compliance

状态：部分符合；已补资产缺口，历史时序缺口不可追溯改写。

## QPDI

- Q：`docs/design/principles.md`包含追求/保护/不接受、认知前提与经验材料，并来自用户多轮确认。
- D：research、architecture、detailed design、detail contracts与Hoare/SCCO proofs存在。
- I：实现仅位于`my-plugins/codex-viewport/`，不修改官方`packages/`。
- Trace：当前architecture/detail已覆盖variable `[top,bottom)`、demand growth、history、resize epoch和failure path。
- Evidence：59 tests / 12 suites、tsc、`npm run check`、global Pi normal/width smoke。

缺口：旧round-001..003审查的是已被真实使用否决的fixed-area模型；近期advisor review不是完整tribunal。故必须开round-004全栈终审。

## Workflow

符合：

- 用户先获得需求模型和修改方案，再明确下令`Change the shit.`；存在实现授权。
- 修复包含回归测试、代码、契约文档同步。
- 实现后执行自动测试、TypeScript、全仓check、真实Pi smoke和独立review。

不符合：

- Demand-driven重构属于架构级bug修复，但编码前没有按`/workflow §7.1`单独落八部分fix artifact。
- 最新架构与细化没有在编码前分别经过完整tribunal门禁。
- 实施不是workflow默认的每个模块完成后停下等待反馈；用户当时明确要求直接修改，但该偏离没有先记录。

处置：

- `docs/design/fixes/demand-driven-live-region.md`事后补录根因、方案、论证、测试/代码/文档清单；明确标记retrospective。
- round-004按完整tribunal执行C&P→Counter→Judge，多轮到SCCO收敛。
- 时序违规只能诚实记录，不能事后宣称“当时已符合”。
