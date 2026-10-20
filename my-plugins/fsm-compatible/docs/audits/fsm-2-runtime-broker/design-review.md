# fsm-2 限定修正确认

**D2-1、D2-2 均已闭合。`fsm-2-runtime-broker`：READY，可进入本单元编码。**

本次仅确认原两项问题及直接同合同回归，保留此前其余设计判断。

## Review

### D2-1：已闭合

`docs/design/fsm-compatibility/subplans/fsm-2-runtime-broker.md:84-94` 已明确：

- POST 登记的 HTTP 成功、JSON null 仅表示尝试完成。
- 随后通过现有 GET source 路由核对 root、实际 Pi PID、kind、cwd、URL 和 null transcript。
- 404、错值、非法 shape 或超时不能提交 ready 或发出本次 MCP。
- source-auth 不作为登记证明。
- 读回确认位于同一调用租约内、identity acquire 和 MCP 之前。

`docs/design/fsm-compatibility/detailed-design.md:133、137` 与 `docs/audits/fsm-2-runtime-broker/expectations.md:16、40、58` 已同步。未新增 FSM 协议或自动重放未知 mutation。

### D2-2：已闭合

叶子合同 `:26-38` 已区分活跃注册集合与当前 epoch 冻结快照：

- 启动前 off：同步真实注销，token 不进入快照。
- 本轮 off：不删除已被 Pi 事件快照捕获的义务。
- 本轮新增 on：仅参与下一轮，不造成本轮虚假等待。
- off 幂等；begin 先于 managed callbacks；实际 SID/epoch、失败记录和单次 commit 规则保留。

expectations `:36、54` 已同步三类快照反例测试计划。

### 直接回归与放行边界

**No issues found.**

此次修正没有削弱 ready 前准入、原 handler 返回/异常语义、完整资源 prepared 条件或未知调用不重放的合同。`detailed-design.md:125` 仍禁止用 noop 将缺失 protocol/gate/child 标为 prepared。

- **Correct：**两项原缺口均有明确事实来源、分支和失败出口。
- **Fixed：**本次未修改文件；仅确认修正。
- **critical/unresolved：**0。
- **Merge verdict：OK，仅限本单元设计；READY。**

尚未编码或执行测试，不代表 Root bootstrap、MCP 或完整系统已运行。首单元 PASS 保留；未重查其他机制或后续单元。无 provider/daemon、子代理调用或文件编辑。