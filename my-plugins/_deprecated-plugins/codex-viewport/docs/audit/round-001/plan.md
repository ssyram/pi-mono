# Round 001 Plan

审查对象：`principles.md`、`research.md`、`architecture.md`、`detailed-design.md`

Spec 来源：用户原始要求与 `principles.md`

运行档位：轻量档（用户此前禁止 subagent）；严格分为 challenger、counter、judge 三遍。

焦点：

- Round 1：Sound + Complete + Optimization，尤其 static-entry completeness 与实现可落地性。
- Concise：检查 principles 是否仍包含实现泄漏、架构是否有重复规则。
- 消费者：Pi lifecycle、TUI private renderer、session persistence、interactive commands。
