# Decisions — loop-1-naming-and-display

对 audit-report.md（路径 B，E1–E28）中 ❌/⚠️ 的处置。修复后全量验证：`node --import ./test/script-task-register.mjs --test test/*.test.ts` 191/191 通过，`test/check-types.mjs` 通过。

| 项 | 级别 | 处置 | 依据 |
|---|---|---|---|
| F1 rename 未按合并候选集判跨 kind 重名 | ❌ P1 | 已修复：`renameTarget` 改为一次 `resolveTarget` 于 `[...sessionTaskCandidates, ...definitionCandidates]`，按 id 前缀分派 session/catalog rename | subplan §2.2/§2.3；新增回归 `test/rename-command.test.ts`（同名跨 kind → warning + 列举两 id，双方 name 不变） |
| W1 dispatcher 空结果分支硬编码 shouldWake=true | ⚠️ P2 | 已修复：改传 `shouldWakeUp(task.wakeUp, [])` | 该分支合成的是 always 任务，计算值恒为 true，行为不变；改为单一口径来源，消除推导缺口 |
| W2 shared catalog name 往返缺直接 diff 证据 | ⚠️ P2 | 闭环，不改代码 | `shared-catalog-codec.ts` 的 `parseSharedDefinition` 复用 `session-state-codec.ts` 的 `parseDefinitionBase`（同一补丁点）；`writeSharedCatalog` 全量序列化。`test/v2-core.test.ts` 用独立 journal 的第二个 core 从磁盘读回 `name === "shared name"` 并在 rename 后读回 undefined；既有 nameless 定义用例（v2-shared-delete 等）证明旧 catalog 兼容 |
| W3 删除注册行 `(definition available)` 后缀 | ⚠️ P2 | 已恢复后缀 | 契约外可见行为变化；按最小变更原则恢复，未采纳"顺手清理" |
| W4 摘要"否则原样"与返回 trim 后行的措辞出入 | ⚠️ P2 | 修订契约措辞：subplan §2.4 明确"返回该 trim 后的行" | 用户原始要求是"只取第一行、超 80 字符才 ...，不合并"；trim 是判空的伴随选择，与"不合并/阈值截断"两条硬约束不冲突；以测试固化（80/81 边界用例） |

§5.2 五维度兜底（v1）：一致性由 E1–E28 对照 + 全量测试覆盖；风格与现有 tab/单文件单概念结构一致；正确性 191/191；性能仅新增 O(n) 候选过滤与常量次字符串拼接，无新 IO；可维护性——解析规则收敛在 `resolve-target.ts` 单点，slash 与 AI 面共用。

附注（审计备注 3 的三项记录）：AI add 成功消息附带 `(name)` 属展示增强，已随 README AI tool 段更新文档；`createSessionTask` 对空串 name 抛错而 AI 边界先规范化为 undefined，两层与"统一 readTaskName"自洽；`rename --clear` 作为 target 字面量按普通目标解析失败（missing），符合单 token target 规则，不特判。
