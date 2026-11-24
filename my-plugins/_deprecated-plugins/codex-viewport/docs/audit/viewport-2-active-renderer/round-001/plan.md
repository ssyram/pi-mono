# Round 001 Plan

审查对象：

- `docs/design/principles.md`
- `docs/design/research.md`
- `docs/design/architecture.md`
- `docs/design/detailed-design.md`
- `docs/design/detail/*.md`
- `docs/design/proofs/*.md`
- `docs/design/known-state.md`

Spec来源：用户确认的统一队列/连续完成前缀/运行期doRender接管意图 + Pi 0.83.0源码 + 当前Codex history insertion源码。

运行档位：轻量。用户明确禁止subagent，因此由主agent分离执行 challenger、prover、counter、judge；不声称独立审查。

本轮焦点：

- S：ownership、terminal物理状态、Hoare前提是否真实。
- C：进入managed、最终handoff、Ctrl+O、resize、image、failure是否覆盖。
- O：bounded takeover是否仍含可删除责任。
- Concise：模块是否单责，旧component bridge是否留下双轨。

产物：本目录五份角色记录 + 上级audit report/decisions。
