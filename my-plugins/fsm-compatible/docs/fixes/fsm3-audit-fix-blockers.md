# fsm-3 实施对照差异修复

原报告：run487ceb60（audit-report-initial.md）；处置：audit-decisions.md。全部接受 P0-1+P1-2～P1-5 与 P2-1/2/4/5，P2-3 记录承接。

## 修复内容

1. **P0-1** judge-session：JudgeEntry 保存当前 Agent；run 期间 abort 执行 agent.abort() → 10 秒有界 waitForIdle，未确认抛 not-ready(503)，确认后才置 idle 并返回 true；无 Agent（本就 idle）直接 true。补运行中 abort 用例（可控 pending faux 响应，真等待终止后才 idle）。
2. **P1-2** oc-server readBody：零长度 body 返回 undefined，不再 JSON.parse("") 400；abort 忽略 body。补空 body abort 200 用例。
3. **P1-3** oc-handlers postMessage：parseJudgeInput 的 protocol-invalid 转为 OcHttpError(400)；记录投影坏关联的 503 不变。补 judge shape 400 用例。
4. **P1-4** judge-session run：解析 policy 后请求 webfetch/websearch 任一且 factory 未接线即抛 not-ready(503)；补用例。
5. **P1-5** capture-turn FailedCapture 记录真实 toolCallId；judge-envelope 失败 part 使用之；补 callID 断言。
6. **P2-1** 删除死代码 finish-turn.ts/judge-error.ts 及其测试；typed provider 分类由 fsm-5/安装单元按合同接线。
7. **P2-2** JudgeSessions 增加 maxJudges（默认64）容量与构造校验；create 超限 queue-full，handlers 转 503；补容量用例。
8. **P2-4** children 对 judge 返回 []；bashExecution 改为真实 bash tool part（callID=bash_+entry.id、state.input.command、exitCode 非零/cancelled→error、完整 metadata）；edit 特殊分支 stat/read/write 后各复查 signal。
9. **P2-5** 补齐用例（见上）。

## 结果

npm run test:judge 16/16、test:protocol 14/14、test:admission 22/22、test:runtime 37/37，npm run check 退出 0。无 provider key/网络/真实模型。实施偏离三条不变；P2-3（judge 会话持久化）在 fsm-5/安装单元显式承接。patch 已再生，待原审查者限定确认上述项。
