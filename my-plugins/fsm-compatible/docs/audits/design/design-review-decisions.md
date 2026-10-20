# 设计审查处置

原审查：run `5caa847c-bcae-433b-8b32-f8eb41a1303c`，workflow `83bfdf10-cac5-4dac-adc6-ff0fdcbe6d42`。原始报告保存于 `design-review-initial.md`，报告结论为首单元/整体 BLOCK，不把工具任务 completed 当设计通过。

授权与原目的：用户已“全面推进”，允许按原 workflow 标准修正设计并实施；根目标仍是 OC-level 完整 FSM 兼容，固定名单/必载扩展属核心。当前处置仅对应原审查定位的问题，不增加新审查标准。

| Finding | 判断 | 最小处置 | 当前证据状态 |
|---|---|---|---|
| B1 原 mandatory 基线缺失 | 同意；现有saved确实无法检验恢复时删除X | PersistedBinding新增非秘密requiredExtensions id/path快照；根/子上次接线成功后持久化，恢复与当前policy逐项比较；缺失/删除/替换拒绝；新增项成功接线后成为新基线 | 合同/schema/事前expectations已修订，尚未由独立审查者确认闭合 |
| B2 root恢复无独立分支 | 同意；root的null parent/agentName不能走child验证 | restore按kind分支：root验证root=self/main/null+原mandatory，不查child名单/父存在；child验证原agent/同root父链/depth；两路不换actor、不fallback new | 合同/事前expectations已修订，尚未确认闭合 |
| B3 根 mandatory 加载健康 | 同意这是runtime ready的真实义务 | 在fsm-2编码前补公开/插件owned根加载确认路径，不能用文件存在或SA子注册冒充 | 待具体单元细化修正 |
| B4 canonical跨根协调机制 | 同意当前机制占位不够编码 | 在fsm-2选定并细化原子持有/退出/清理，不改per-root无关mutex | 待具体单元细化修正 |
| B5 wire/judge映射 | 同意必须字段级转换 | fsm-3补实际消费者字段来源与工具参数表 | 待具体单元细化修正 |
| B6 FIFO握手排序 | 同意需要跨请求区间 | fsm-4补root new-start队列与成功/失败/取消/未知出口；长期任务不持队列 | 待具体单元细化修正 |
| B7 异步通知/取消调用者 | 同意不能借SA根通知冒充真实嵌套parent | fsm-4补run→caller绑定、公共completion/cancel接线 | 待具体单元细化修正 |
| B8 基础normalizer | 同意这是核心而非后期命令扩展 | fsm-4补确定性name/input及unknown/MCP/nested分支 | 待具体单元细化修正 |
| B9 人类任务等待事件 | 同意UI kind不能证明问答语义 | fsm-5补session-owned语义标记、产生者及开始/回答/取消/输入/恢复接线；不升格optional AskUserQuestion | 待具体单元细化修正 |

顺序：先限定确认B1/B2的实际修正是否满足原标准；首单元放行即编码/直接测试。其余finding在相应单元编码前闭合，不以文档变长或重复审查替代实现，也不要求首单元先运行整个系统。
