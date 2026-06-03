### 2. UltraWork Mode — Maximalist Quality Loop

**Intent**: Provide a "do it completely, exhaustively, with zero regrets" mode for critical work where speed and token cost are secondary to correctness.

**Philosophy**: 
- UltraWork ≠ "Grab a coffee, AI does everything" (that's普通 Sisyphus)
- UltraWork = "User participates in key decisions, AI exhausts all non-decisional work"

**Execution Model** (based on hoare-audit.md 9-step framework):

```
Stage 0: Design Intent Detection
  ├─派 2-3 explore agents 并行搜索设计意图
  │   ├─ 显式文档 (docs/design/, DESIGN.md, ADR, RFC)
  │   ├─ 代码内设计 (详细注释、契约标注、docstring)
  │   └─ 其他形式 (issue 讨论、commit message)
  └─ 综合判断：意图是否基本完整
      ├─ 完整 → Stage 2 (直接实施)
      └─ 不完整 → Stage 1 (强制设计阶段)

Stage 1: Design Phase (意图不完整时)
  ├─ Sisyphus 按 workflow.md §3 调查需求
  ├─ 用 hoare-design.md 正向设计产出 design.md
  ├─ Phase 5 分类: Non-Decisional 自动采纳 / Decisional 标记
  └─ 给用户过目 + 同时并行实施 Non-Decisional 部分
      └─ 用户确认大方向 → 实施 Decisional 部分

Stage 2: Implementation (按 workflow.md §4)

Stage 3: Audit Loop (Sisyphus 自己推进 hoare-audit.md 9 步)
  for round in 1..N:
    Step 1-2: 派 dimension agents + workflow-auditor 并行审计
    Step 3: 过滤 code nit (必须有 Pre/Post 违反 + 反例)
    Step 4: 派 confirmation agent (fresh eyes 独立确认)
    Step 4.5: 分类 Decisional/Non-Decisional + 根因隔离 (只诛首恶)
    Step 5: 自动修复 Non-Decisional (无需人工许可)
    Step 6: 测试 + 回归
    Step 7: 收敛判断
    if 收敛: break
    if 同一模块 3+ 轮: 熔断 → 根因分析

Stage 4: Completion Report
  ├─ Non-Decisional
  ├─ Decisional
  └─ Blocker
```

**Why Sisyphus pushes the loop**:
- Delegation to another agent is too long
- Async control becomes difficult
- User dialogue becomes indirect
- Sub-agents handle single steps; Sisyphus stitches the loop

### 3. Audit Agents — Parallel Multi-Dimensional Review

**Intent**: Avoid single-agent blind spots and increase audit coverage.

**Audit hierarchy**:
- **6 dimension auditors**: crash-safety, functional-correctness, cross-boundary, resource, spec-impl, adversarial
- **1 confirmation-auditor**: fresh-eyes independent confirmation
- **1 workflow-auditor**: checks workflow discipline and prompt compliance

**Selection examples**:
- Algorithm-dense work → crash-safety + functional-correctness + adversarial
- API change → cross-boundary + spec-impl
- Resource management → resource + crash-safety

**Why 6 dimension agents + 1 confirmation + 1 workflow**:
- hoare-audit.md Step 2 expects 3–6 parallel audits
- Multiple dimensions reduce groupthink
- Confirmation adds fresh eyes
- Workflow audit catches process drift

### 4. Methodology References — Immutable Ground Truth

These four documents are the source of truth:
- `workflow.md`
- `hoare-design.md`
- `hoare-prompt.md`
- `hoare-audit.md`

### 5. Verification — Functional, Not Just Static

**Rule**: "Types check out" only proves type correctness, not functional correctness.

**Manual QA Mandate**:
- Simple changes → minimal verification
- Complex changes → audit agents

**Required verification types**:
- CLI output
- Build outputs
- API responses
- UI rendering / visual inspection
- New tool/hook behavior
- Config handling

**Insufficient claims**:
- "should work"
- "types check out"
- "tests pass"
- "diagnostics clean"

For complex scenarios, use `/workflow` and `/hoare-prompt` for root cause analysis, structural reasoning, and cross-boundary contracts.

### 6. Scope Discipline — No Silent Downscoping

**Intent**: Prevent AI from quietly delivering reduced versions when hitting blockers.

**Sisyphus `<Scope_Discipline>` 段**:
```markdown
The user's request is a contract. Do not silently downscope.
- No "simplified version", "skeleton", "demo", "you can extend later" 
  unless the user explicitly accepts it.
- When you hit a blocker that prevents full delivery, surface it as a
  Decisional item — never quietly deliver a reduced version.
- Partial completion is acceptable ONLY when explicitly reported as such.
```

### 7. Delegation — Three Principles, Not Default

**Intent**: Delegate strategically, not reflexively.

**Three principles** (all must apply):
1. **Perspective** — Task requires unbiased judgment (e.g., self-review)
2. **Capability** — Task requires abilities you lack (e.g., PDF analysis)
3. **Efficiency** — Task is context-independent + multi-step complex

**When to delegate**:
- Use 2–5 explore agents in parallel for complex search
- Don’t delegate simple grep-style work

### 8. Task Management — Track Progress Explicitly

- Multi-step work requires todos
- Mark each step `in_progress` before work proceeds
- Mark completion with `done` immediately
- Update scope changes as they happen

### 9. Boulder Loop — Auto-Restart on Actionable Tasks

- Boulder auto-restarts while actionable tasks remain
- Actionable = `in_progress` or ready/unblocked `pending`
- `<CONFIRM-TO-STOP/>` is the escape hatch

### 10. Design Constraints

- oh-my-pi v2 does not do execution, web access, or MCP itself
- Those are delegated to `pi-subagents`, `pi-web-access`, and `pi-mcp-adapter`

### 11. Why Thin Runtime

- v1 was about 7700 lines and did everything in-house
- v2 is about 3300 lines and focuses on Persona, Behavioral hooks, and Task management

### 12. Evolution Path

- In-house tools → `pi-subagents`
- In-house web access → `pi-web-access`
- Category system → simplified delegation principles
- Keyword detector → explicit commands
- 286-line ultrawork prompt → 80-100 line maximalist loop

### 13. Future Considerations

- Audit agent nesting depth
- Workflow/Hoare fusion
- Design-intent detection accuracy

### 14. Summary

oh-my-pi v2 的设计意图：
- **Orchestration, not execution** — 定义思维方式，委托执行
- **Quality by default** — 验证、根因分析、scope 纪律内置
- **Maximalist when needed** — UltraWork 提供"做绝"选项
- **Thin runtime** — 专注独特价值，避免重复造轮子

### UltraWork State — Session Log Custom Entry

- UltraWork state is stored as a session-log custom entry (`omp-ultrawork-state`).
- On resume, the runtime walks upward through the current session branch to find the latest valid UltraWork entry.
- If no valid entry is found, UltraWork defaults to `false`.
