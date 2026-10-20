# C1 限定修正确认

**C1：已闭合。首单元 `fsm-1-admission-binding`：PASS。**

本次仅核对已知局部修正及其直接回归；此前其余契约对照结果保留。

## Review

- **Correct：父环检查已包含待接入 self。** `src/binding/parent-chain.ts:8-14` 用 `forbiddenSessionId` 初始化 seen，祖先链遇到 self 即拒绝。对应 `implementation.patch:627-633`。
- **Correct：调用点已接线。** `restore-actor-binding.ts:25-26` 传入 `actualSessionId`，将失败转换为 `restore-conflict`；`bind-new-child.ts:26-27` 同样传入待绑定 self，检查仍发生在 PendingLaunch 修改之前。对应 patch `:557-558、749-750`。
- **Correct：原反例已有回归。** patch `:856-868` 构造旧树 `r→c→d`、saved `c.parent=d`，断言恢复拒绝、saved 不变、当前 c 的 parent 仍为 r。
- **Correct：未发现直接同合同回归。** 普通 callerDepth 未传禁止节点，原深度计算不变；root 恢复仍不查询父链；合法 child 恢复、相同 self 重试的既有用例保留。依据 patch `:177、742-750、815-823、843-854、870-889`。
- **Fixed：**本次未修改文件；仅确认修正。
- **Finding：**No issues found.
- **Merge verdict：OK，仅限首单元。** critical/unresolved 项为 0。

父线程报告修正后 **22/22 测试通过、插件 tsc 无诊断**；本次未独立执行。此前全仓 check 中止的限制仍保留，不能宣称全仓检查通过。

B3–B9 未重查，仍属后续责任；本单元 PASS 不代表完整系统放行。无文件修改、provider/daemon 调用或新子代理。