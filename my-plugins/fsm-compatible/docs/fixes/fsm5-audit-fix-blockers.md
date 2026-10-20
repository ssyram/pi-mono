# fsm-5 实施对照差异修复

原报告：run0e34cc9f（授权reviewer），audit-report-initial.md；结论BLOCK：1×P1 + 6×P2。全部接受并处置。

- **P1** 组装失败回收窗口在 try 之前（openScope/not-ready gate/listen 抛错泄漏 handler/临时目录/桥 socket）。修复：try 起点提前到 not-ready gate 安装前，launch scope 目录登记进 resources，return 移入 try；补组装失败路径测试（注入坏 daemon → 断言 0 工具残留、0 handler 残留）。
- **P2-1** index.ts session_start 重入先 close 旧 runtime 再重建。
- **P2-2** ask 工具改为 ctx.hasUI 才注册（无 UI 不注册，字面合同落实）；组装测试 ctx 补 hasUI。
- **P2-3** drain 树内 child 目标投递留组装边界（child runtime 的 isIdle/branch 谓词在 child 侧接线时接入），记录于 decisions。
- **P2-4** ask/drain 补字面 Step P1/P3 注释。
- **P2-5** plan.ts 补 managed-bootstrap 步骤（当前单 factory；companion manifest 为后续增强）与 overrides 说明。
- **P2-6** 补 recover 专项测试（复用 prepare、source-auth 恰一次、通道真实关闭）。

修复后全量 117 项（22+37+15+16+4+11+7+5）+ tsc 0。待原审查者限定确认后结算。
