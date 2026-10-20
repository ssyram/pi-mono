# fsm-4 设计差异处置

原报告：run9efce024（承接bfe22049一次超时中断后完成），design-review-initial.md；结论BLOCKED（最小）：D4-1～D4-3，另两条记录项。

- **D4-1 同意**。edit 单 tool_call 恰好一次 check；多 edits 条目以完整映射 input `{filePath, edits:[…]}` 原样一次提交，denied 整体 block。叶子 §5 与 expectations §5/§7 已同步（消除与"同一 tool_call 恰好一次 check"的冲突）。
- **D4-2 同意**。SubagentDelegationStarted 仅含三元组；握手表述改为 started 仅确认启动、runId 取自 update/terminal、握手段完成以 child 侧 initializeChild 登记为准。叶子 §2 与 expectations P1 已同步。
- **D4-3 同意**。lifecycle 映射显式补 unavailable_context→failed（错误保留）、invalid_request→failed（桥 bug 记录诊断），穷举全部 SA status。叶子 §3 与 expectations §3/§7 已同步。
- 记录项采纳：事件名统一写 agent_before_settle；required-child-extensions 必载不可缩减语义在实现对照时直读导出一手源核实。

三条均为一句话级修订，未改机制结构/安全边界/测试计划；限定确认run a369b41c（承接d572306b一次超时中断）返回READY：D4-1/D4-2/D4-3全部闭合、事件名统一、无新缺口；报告design-review.md。可按叶子§8测试计划编码；实现后仍需一次独立合同对照；required-child-extensions一手源核实与SA真实集成烟雾留实现对照/安装单元。

## 实施决策记录（供对照审查核实）

bootstrap 传输：SA pi runner 无 env/args 通道，模型可见 task 不能携带桥密码。方案：root 在协调 scope 写 0600 launch 文件（rootSessionId/caller/agent/policy/桥地址+密码），task 前缀仅含一次性 bootstrapRef UUID；child 插件在 input 事件解析 `[fsm-bootstrap:ref]` 前缀→读取文件→transform 剥离前缀（模型不可见）→initializeChild（restore/bind+gate+actor-acquire）→经桥内部路由 launch-ack 回传真实 child SID；root 以 ack（或 terminal 失败）完成 B6 握手。launch-ack 复用桥 Basic 认证；文件与协调 scope 同 uid 0600。此为对叶子 §2/§4 的传输层落地，不改变 FIFO/准入/恢复合同。

## 结算

实施对照run21578871 BLOCK四项P1+P2×6；修复后限定确认run6dce4d94（承接13f4931e一次超时）返回PASS：P1-1～P1-4全部闭合、P2-1/2/4/5处置到位、P2-3/P2-6按记录承接；报告audit-report.md。记录级残留（排队项signal复查、launch级容量/abort用例、finished淘汰、awaitTerminal abort路径）由组装单元顺手处理。**fsm-4-child-gates技术结算PASS**；不关闭根目标，fsm-2最终结算、fsm-5/安装/mandatory翻译继续。
