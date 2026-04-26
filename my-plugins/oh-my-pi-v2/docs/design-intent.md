# Design Intent — oh-my-pi v2

This document captures the core design philosophy and intent behind oh-my-pi v2's architecture.

## Core Philosophy

**Sisyphus = Orchestration, not execution.**

oh-my-pi v2 is a thin runtime that defines **how** an AI agent should think, delegate, and enforce quality — but delegates all **execution** to external extensions (pi-subagents, pi-web-access, etc.).

## Key Design Decisions

### 1. Sisyphus Persona — Orchestrator with Discipline

**Intent**: Create an agent that coordinates work through the right mix of self-execution and delegation, with built-in quality enforcement.

**Core Principles**:
- **Decompose → Order → Delegate → Verify** — structured workflow, not ad-hoc execution
- **Decisional vs Non-Decisional** — separate "needs user judgment" from "can proceed autonomously"
- **Forward motion bias** — ask only when truly unclear, default to reasonable interpretation
- **Evidence-based completion** — diagnostics + build + functional verification required

**Anti-patterns enforced**:
- No silent scope reduction
- No "should work" / "types check out" claims without functional verification
- No self-review (delegation for independent perspective)
- No shotgun debugging (root cause analysis required)

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
  Step 8-9: 汇报 Decisional → 用户决策 → 应用决策 → 重启循环

Stage 4: Completion Report
  ├─ Non-Decisional: 已自动修复，简要列出
  ├─ Decisional: 累积列出 (设计阶段 + 审计阶段)
  └─ Blocker (方向性问题): 突出标记
```

**Why Sisyphus pushes the loop, not a sub-agent**:
- 委托给另一个 agent → 流程过长 + 异步不可控 + 用户无法直接对话
- Sisyphus 是主 agent，循环推进是自己的工作
- Sub-agent 只负责单步 (dimension audit, confirmation)，结果写文件，Sisyphus 读文件衔接下一步

### 3. Audit Agents — Parallel Multi-Dimensional Review

**Intent**: Implement hoare-audit.md's multi-dimensional parallel audit strategy with independent agents.

**Agent Hierarchy**:

```
大循环 (Sisyphus 推进)
  └─ hoare-audit.md 9 步框架
      └─ 单步审计工具 (并列)
          ├─ Dimension Agents (用 hoare-prompt.md 方法论)
          │   ├─ crash-safety-auditor
          │   ├─ functional-correctness-auditor
          │   ├─ cross-boundary-auditor
          │   ├─ resource-auditor
          │   ├─ spec-impl-auditor
          │   └─ adversarial-auditor
          ├─ confirmation-auditor (fresh eyes, Step 4)
          └─ workflow-auditor (workflow.md 流程纪律)
```

**Why 6 dimension agents + 1 confirmation + 1 workflow**:
- hoare-audit.md Step 2 要求 3-6 个维度并行审计，避免群体思维
- 每个 dimension agent 专注一个角度 (crash safety, functional correctness, etc.)
- confirmation-auditor 提供独立视角 (不读原报告，fresh eyes)
- workflow-auditor 检查流程纪律 (根因分析、测试失败协议、回归防护)

**Task-specific selection**: Sisyphus 根据任务类型选择性派发 dimension agents:
- 算法密集 → crash/functional/adversarial
- API 改动 → cross-boundary/spec-impl
- 资源管理 → resource/crash

### 4. Methodology References — Immutable Ground Truth

**Intent**: Embed proven methodologies as immutable references, not inline rules.

**Four reference documents** (`references/`):
1. **workflow.md** — 总流程 (设计→实施→测试→修复→回归)
2. **hoare-design.md** — 设计阶段工具 (反向推理 / 正向设计)
3. **hoare-prompt.md** — Hoare logic 方法论 (静态推理、跨界契约)
4. **hoare-audit.md** — 审计执行循环 (9 步自动化框架)

**Why references/ not inline**:
- Sisyphus prompt 保持简洁 (orchestration logic only)
- 方法论可以独立演进、版本锁定
- Audit agents 直接引用完整方法论，无压缩损失

### 5. Verification — Functional, Not Just Static

**Intent**: Enforce functional verification as mandatory, not optional.

**Sisyphus `<Verification>` 段**:
```markdown
After changing files:
- Run diagnostics + build/test
- Functional verification (mandatory):
  | Change type             | Required verification              |
  |-------------------------|------------------------------------|
  | CLI command             | Run the command, show output       |
  | Build output            | Run build, verify output files     |
  | API behavior            | Call endpoint, show response       |
  | UI rendering            | Describe render / use browser tool |
  | New tool/hook/feature   | End-to-end test in real scenario   |
  | Config handling         | Load config, verify it parses      |
- Insufficient claims: "should work", "types check out", 
  "diagnostics clean", "tests pass" — none prove the feature works.

For complex scenarios, see /workflow and /hoare-prompt for:
- Root cause analysis (workflow §5.1)
- Structural reasoning (hoare-prompt)
- Cross-boundary contracts (hoare-prompt)
```

**Why this matters**: 
- "Types check out" 只证明类型正确，不证明功能正确
- UltraWork 的 Manual QA Mandate 提升到默认行为
- 简单改动 → 最小验证；复杂改动 → 派 audit agents

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

**Why this matters**:
- 默认 AI 遇到困难时倾向降低目标而不上报
- UltraWork 的 "100% delivery" 原则提升到默认行为
- 用户的请求是契约，不能默默打折

### 7. Delegation — Three Principles, Not Default

**Intent**: Delegate strategically, not reflexively.

**Three principles** (all must apply):
1. **Perspective** — Task requires unbiased judgment (e.g., self-review)
2. **Capability** — Task requires abilities you lack (e.g., PDF analysis)
3. **Efficiency** — Task is context-independent + multi-step complex

**Why not "default delegate"**:
- 过度委托浪费 token (简单 grep 不需要 explore agent)
- 委托有成本 (sub-agent 启动、上下文传递)
- Sisyphus 应该能自己做简单工作

**When to delegate**:
- 独立视角 (review 自己的代码)
- 专门能力 (multimodal-looker 看 PDF)
- 复杂搜索 (2-5 explore agents 并行，不同角度)

### 8. Task Management — Real-Time Progress Tracking

**Intent**: Make progress visible to user, prevent drift.

**Mandatory workflow**:
1. Multi-step task → 立即创建 todos
2. 开始每步前 → mark `in_progress`
3. 完成每步后 → mark `done` 立即 (不批量)
4. Scope 变化 → 更新 todos 再继续

**Why this matters**:
- 用户实时看到进度，不是黑盒
- Todos 锚定实际请求，防止漂移
- 中断后可以无缝恢复

### 9. Boulder Loop — Auto-Restart on Actionable Tasks

**Intent**: Keep agent running until all actionable work is complete.

**Mechanism**: After agent stops, if tasks remain `in_progress` or ready `pending`, auto-restart.

**Why this matters**:
- 防止 agent 中途停下，留下未完成工作
- 用户不必手动 "continue"
- 明确停止点：所有 actionable tasks 完成

**Escape hatch**: `<CONFIRM-TO-STOP/>` tag — agent 明确表示需要等待外部输入

## Design Constraints

### What oh-my-pi v2 Does NOT Do

1. **Execution** — 不实现 subagent 调用、并行管理、session 运行。委托给 pi-subagents。
2. **Web access** — 不实现搜索、fetch、GitHub clone。委托给 pi-web-access。
3. **MCP** — 不实现 MCP 协议。委托给 pi-mcp-adapter。

### Why Thin Runtime

v1 实现了所有功能 in-house (~7700 lines)。v2 专注于 Sisyphus 独特价值 (~3300 lines):
- Persona (orchestration logic)
- Behavioral hooks (quality enforcement)
- Task management (progress tracking)

执行层委托给社区扩展，避免重复造轮子。

## Evolution Path

### From v1 to v2

| v1 | v2 |
|---|---|
| In-house delegation tools | pi-subagents |
| In-house web access | pi-web-access |
| Category system (8 categories) | Simplified (delegation principles) |
| Keyword detector (300+ regex) | Explicit commands |
| 286-line ultrawork prompt | 80-100 line maximalist loop |

### Future Considerations

1. **Audit agent 嵌套深度** — 当前 Sisyphus 推进循环，派 dimension agents。如果 dimension agents 需要再派 sub-agent，是否支持？
2. **Workflow vs Hoare 融合** — 当前 workflow-auditor 和 dimension agents 并列。是否需要更深度融合？
3. **设计意图探测准确性** — Stage 0 的"基本完整"判断依赖 Sisyphus 综合 explore 结果。是否需要更明确的量化标准？

## Summary

oh-my-pi v2 的设计意图：
- **Orchestration, not execution** — 定义思维方式，委托执行
- **Quality by default** — 验证、根因分析、scope 纪律内置
- **Maximalist when needed** — UltraWork 提供"做绝"选项
- **Thin runtime** — 专注独特价值，避免重复造轮子
