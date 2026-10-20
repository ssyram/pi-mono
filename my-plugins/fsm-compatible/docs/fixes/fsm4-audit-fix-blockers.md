# fsm-4 实施对照差异修复

原报告：run21578871（授权reviewer），audit-report-initial.md；结论BLOCK：P1-1～P1-4 + P2×6。全部核实后接受。

- **P1-1** child-runs waiter 池未按行键控（terminal 解析所有 waiters）。修复：Waiting 带 nodeId，onTerminal 只解析本行 waiters；新增并发行隔离测试（A 的 terminal 不得解析 B）。
- **P1-2** 行永不清理致容量退化/队列无界。修复：terminal 后行移入有界 finished（64，FIFO 淘汰）；activeSize 只计活跃行，terminal 释放容量；RootLaunches 以 pending+activeSize 双计数在副作用前拒绝；新增容量饱和/释放测试。
- **P1-3** loadPayload 二次剥离恒败。修复：transformer 直接保存 bootstrapRef，loadPayload 以 ref 调 readBootstrap。
- **P1-4** normalizeToolCall 在 try 外，坏 edit 输入逃逸门禁。修复：移入 try，一切异常按 fail-close block。
- **P2-1** BootstrapPayload 硬编码空 policy。修复：LaunchRequest.policy{allowedAgents,maxDepth,requiredExtensions} 注入真实收窄策略写入文件。
- **P2-2** launch 无 caller deadline/signal。修复：LaunchRequest 可带 deadline/signal；握手预算取 min(childStartTimeout, deadline)；入队前检查取消/过期。
- **P2-3** stop-gate event.continue 死检查：官方 BoundaryState 类型确有 continue 字段（types.d.ts:757），保留为防御性检查并在此记录类型依据。
- **P2-4** 测试缺口补齐：并发 waiters 隔离、容量饱和释放、lifecycle 11 状态全断言、check-permission body 四字段精确断言。
- **P2-5** 测试清理 inline import 违规：改为顶层 import。
- **P2-6** required-child-extensions 一手源核实与 runtime agent 注册属未完组装边界，PASS 不覆盖——由 fsm-5/安装单元承接（已在 decisions 记录）。

修复后全量：admission22+runtime37+protocol14+judge16+gates5+children10 共104项 + tsc 0。第二 terminal 对 finished 行同样 protocol-invalid（P1-1 修复时同步补上）。待原审查者限定确认后结算。
