# 朝廷架构 — 修订版项目设计规格 (v2)

> 日期: 2026-02-23
> 基于: 5 场多模型对抗辩论结果 (gpt-5.2 / kimi-k2.5 / claude-sonnet-4-6 / qwen3.5-plus)
> 前置版本: pi-mono/reports/court-project-spec.md (v1)
> 辩论记录: debate/summary.md

---

## 1. 项目愿景

在 Coding Agent 之上构建多层委托系统，将单一 Agent 拆分为"监督-审查-管理-执行"四层角色，解决单 Agent 架构下上下文膨胀、职责混杂、无法自审的问题。系统以 Extension/Plugin/Hook 机制实现，支持 Pi Extension (首选)、Claude Code Hooks、OpenCode Plugin 三个平台，无需修改宿主核心代码。

**与 v1 的关键差异**: 引入分级闸门审查模型、锚点账本上下文管理、机械提取事实包、双层客观监督、声明式清单工具管理。

## 2. 架构概览

```
用户
 │
 ▼
┌─────────────────────────────────────────────────┐
│  丞相 (Chancellor) — 主进程                      │
│  [read, delegate]                               │
│  Court Anchor Ledger (CAL) ← 锚点账本            │
│  Court Manifest (MDC) ← 工具/Skill 清单          │
│                                                 │
│  ┌──── delegate ────┐   ┌──── delegate ────┐    │
│  ▼                  ▼   ▼                  ▼    │
│  九卿 (Minister)    九卿  执行层 (Worker)   执行层 │
│  [全部+delegate]    ...  [全部,无delegate]   ...  │
│  │                       ↓                      │
│  └── delegate ──▶ 执行层  ObjectiveNode 元数据     │
│                          (平台自动提取)            │
└─────────────────────────────────────────────────┘
         │ 分级闸门触发
         ▼
      史官 (Historian) — 临时子进程, 零状态
      输入: Fact Packet (机械提取事实包)
      输出: advice → CAL → context 事件注入丞相
            record → appendEntry 持久化
```

信息流向：用户 → 丞相 → (delegate) → 九卿/执行层 → 结果回传丞相 → 用户。
史官在分级闸门判定后按需触发，输入基于机械提取的事实包，建议通过 CAL 锚点注入丞相上下文。

## 3. 角色规格

### 3.1 丞相 (Chancellor)

- **身份**: 主进程的主 Agent，用户直接交互对象
- **职责**: 接收输入、分析任务、制定拆分策略、delegate 给下级、汇总结果、**生成 Court Manifest**
- **工具集**: `read` + `delegate`（源头限制，LLM 看不到其他工具 schema）
- **上下文**: 持久 session，跨轮保留，通过 CAL 管理上下文生命周期
- **触发**: 用户输入
- **新增职责**: 任务初始化时生成 `court-manifest.json`（一次性规划行为），定义各阶段的工具白名单和 Skill 摘要

### 3.2 史官 (Historian)

- **身份**: 分级闸门触发的临时子进程
- **职责**: 基于机械提取的事实包进行独立审查，输出检查建议 + 记录摘要
- **工具集**: 仅 `read`
- **上下文**: 零残留（每次全新进程）
- **触发**: 分级闸门判定（非每次 agent_end 必触发）
  - L0 无风险 → 跳过
  - L1 低风险 → 异步 spawn
  - L2 高风险 → 同步阻塞 spawn
  - L3 终局 → 同步深审
- **输入**: Fact Packet (机械提取事实包)，非 LLM 生成的摘要
  - tool_calls 统计
  - git_diff_stat
  - 最后 Assistant 消息截取
  - context.md 快照
  - ObjectiveNode 元数据树（含子任务客观指标）
- **输出**:
  - advice → 写入 CAL 锚点 → `context` 事件/`messages.transform` 注入丞相
  - record → `appendEntry` / 文件持久化（不进 LLM 上下文）
- **监督范围**: 双层客观监督
  - 第一层: 平台自动提取的 ObjectiveNode 元数据（工具统计、耗时、退出码）
  - 第二层: 仅对异常节点按需读取详细日志

### 3.3 九卿 (Ministers)

- **身份**: 丞相通过 delegate 创建的中间管理层
- **职责**: 执行复合子任务，可继续向下 delegate
- **工具集**: 完整内置工具 + delegate + Court Manifest 阶段限定的 Skill
- **上下文**: 隔离
- **角色定义**: 外部 `.md` 文件，通过角色注入机制加载
- **新增**: 完成时自动生成 ObjectiveNode 元数据（平台代码提取，非 LLM 自述）

### 3.4 执行层 (Workers)

- **身份**: 最底层执行单元
- **职责**: 执行原子任务
- **工具集**: 由 Court Manifest 或 CLI 参数限定，无 delegate
- **上下文**: 隔离
- **新增**: 完成时自动生成 ObjectiveNode 元数据

### 3.5 书记官 (Clerk) — 非独立角色

- **身份**: 声明式清单 (`court-manifest.json`) + Hook 机械执法
- **职责**: 管理 Skill/MCP 的上下文生命周期
- **形态**: 数据结构 + Hook 逻辑，非对话 Agent
- **清单生成**: 丞相在任务初始化时生成
- **执法方式**: Hook 在每轮根据清单设置工具白名单 + 全量替换 System Messages

### 3.6 角色对比总表

| 属性 | 丞相 | 史官 | 九卿 | 执行层 | 书记官 |
|------|------|------|------|--------|--------|
| 进程 | 主进程 | 临时子进程 | 子进程 | 子进程 | N/A (Hook) |
| 触发 | 用户输入 | 分级闸门 | delegate | delegate | Hook 自动 |
| 工具 | read + delegate | read | 全部 + delegate | Manifest 限定 | N/A |
| 可委托 | 是 | 否 | 是 | 否 | N/A |
| 上下文 | 持久 + CAL | 零残留 | 隔离 | 隔离 | N/A |
| LLM 参与 | 是 | 是 | 是 | 是 | 否 |

## 4. 核心机制

### 4.1 Court Anchor Ledger (CAL) — 上下文管理

CAL 是锚点账本，在 Session 持久化区维护，控制丞相上下文的内容和生命周期。

**锚点类型**:
- `DECISION`: 已完成任务的结构化摘要，永不过期
- `RISK_HIGH`: 高风险警告，基于"问题解决"语义事件清除
- `TASK_ACTIVE`: 进行中任务的状态追踪

**数据结构**:
```typescript
type AnchorType = 'DECISION' | 'RISK_HIGH' | 'TASK_ACTIVE';

interface Anchor {
  id: string;
  type: AnchorType;
  taskId?: string;
  content: string;
  createdAt: number;
  expiresOn?: 'NEVER' | 'TASK_COMPLETED' | 'EXPLICIT_RESOLVED';
  persistedRef?: string;
}
```

**更新时机**: `agent_end` 事件
- delegate 完成 → 移除 TASK_ACTIVE，添加 DECISION
- 史官进言 → 高风险添加 RISK_HIGH，低风险仅持久化

**上下文构建**: `context` 事件 / `messages.transform`
- 根据 CAL 动态组装消息
- 已完成任务的原始对话替换为 DECISION 摘要
- RISK_HIGH 锚点注入 System Prompt 或顶部消息
- 解决标记检测 (`[RESOLVED: risk_id]`) 清除风险锚点

### 4.2 分级闸门模型 (Graded-Gate Model) — 史官触发

风险分级由硬编码矩阵决定，非 LLM 判断:

```typescript
const RISK_MATRIX = {
  LOW_RISK: ['read_file', 'list_dir', 'search_code'],
  MED_RISK: ['write_file', 'edit_file', 'delegate'],
  HIGH_RISK: ['bash', 'mcp_*', 'delete_file'],
  SENSITIVE_PATTERNS: ['.env', 'secret', 'password']
};
```

| 级别 | 触发 | 审查 | 工具策略 |
|------|------|------|----------|
| L0 | 纯 Read | 跳过 | 正常 |
| L1 | Write/Delegate | 异步 spawn | 下一轮锁定直到审查完成 |
| L2 | Bash/MCP/敏感 | 同步阻塞 | 强制工具锁 |
| L3 | Session End/Compact | 同步深审 | N/A |

**异步但不失控**: L1 审查未完成时，通过工具限制阻止新的写操作（"逻辑同步、体验异步"）。
**超时保护**: 所有 spawn 设置超时 (30s/60s)，超时视为 ALLOW_WITH_WARNING。

### 4.3 机械提取事实包 (Fact Packet) — 史官输入

**核心原则**: 监督依据独立于被监督者。父进程代码机械提取客观事实，严禁调用 LLM 生成摘要。

**事实包格式**:
```json
{
  "seq": 1024,
  "meta": { "duration_ms": 5000, "turn_id": 45 },
  "facts": {
    "tool_calls": [
      {"name": "write_file", "path": "src/auth.ts", "status": "success"}
    ],
    "git_diff_stat": "src/auth.ts | 20 ++--, src/test.ts | 5 +",
    "final_statement": "(最后 Assistant 消息前 200 字)"
  },
  "context_snapshot": {
    "active_concerns": ["HIGH: DB pool limit"],
    "recent_experiences": ["..."]
  },
  "delegation_tree": [
    {
      "taskId": "t1", "role": "worker",
      "metrics": { "toolCallCount": 5, "hasWriteOperation": true, "exitStatus": "success", "durationMs": 3000 },
      "selfReport": { "summary": "...", "confidence": "high" }
    }
  ]
}
```

**游标**: 单一序列号 (`seq` + `git_ref`)
**Token 控制**: 事实包目标 ~1.6-2k tokens

### 4.4 ObjectiveNode — 子任务监督

每个九卿/执行层完成时，平台代码自动提取客观元数据:

```typescript
interface ObjectiveNode {
  taskId: string;
  parentId: string | null;
  role: 'minister' | 'worker';
  metrics: {
    toolCallCount: number;
    toolsUsed: string[];
    hasWriteOperation: boolean;
    exitStatus: 'success' | 'error' | 'interrupted';
    durationMs: number;
    tokenUsage: number;
  };
  selfReport: {
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    anomalies: string[];
  };
  rawLogPath?: string;
}
```

**双层监督**:
- 第一层 (默认): metrics 快速扫描异常
- 第二层 (按需): 仅对异常节点读取详细日志

### 4.5 Manifest-Driven Clerk (MDC) — 工具/Skill 管理

丞相生成声明式清单，Hook 机械执法:

```json
{
  "task_id": "uuid",
  "phases": {
    "current": "implementation",
    "definitions": {
      "analysis": {
        "allowed_tools": ["read", "delegate", "search_code"],
        "skill_summaries": { "code-analyzer": "只读分析" }
      },
      "implementation": {
        "allowed_tools": ["read", "write", "bash"],
        "skill_summaries": { "test-runner": "运行测试" },
        "mcp_visibility": ["mcp:git"]
      }
    }
  },
  "global_rules": ["禁止访问外网"]
}
```

**执法**:
- `before_agent_start` / Hook 起始: 设置工具白名单
- `context` / `messages.transform`: 全量替换 System Messages 为清单摘要
- 阶段切换: 丞相更新 phase 字段，Hook 自动读取新配置

### 4.6 任务委托 (delegate)

自定义 Tool，参数: `role` (minister/worker), `agent` (角色名), `task` (描述)。
spawn 独立子进程:
- `--no-session`: 不持久化
- `--mode json`: 结构化输出
- `--append-system-prompt <file>`: 角色注入
- Court Manifest 限定工具白名单

LLM 可并行调用多个 delegate。

### 4.7 角色区分

单一 Extension 通过环境变量/角色标识判断当前进程角色:
- `worker`: 跳过所有注册（零开销）
- `minister`: 仅注册 delegate 工具
- `chancellor`: 注册完整事件链、工具、命令

## 5. 技术选型

### 为什么选 Extension/Plugin/Hook 路线

- 零 fork: 不修改宿主核心代码
- 完整生命周期覆盖: 30+ 事件钩子 (Pi) / 6+ Hooks (CC) / Plugin 事件 (OC)
- 热重载: `/reload` 即时生效 (Pi)
- 子进程隔离: spawn 独立进程，Extension 自动加载

### 平台能力矩阵

| 能力 | Pi Extension | CC Hooks | OC Plugin |
|------|:---:|:---:|:---:|
| 上下文完整替换 | ✅ `context` | ❌ Prefix | ✅ `messages.transform` |
| 源头工具限制 | ✅ `setActiveTools` | ⚠️ `PreToolUse` deny | ⚠️ 有限 |
| 同步阻塞审查 | ✅ `agent_end` | ✅ `Stop` hook | ⚠️ 需模拟 |
| 异步审查 | ✅ spawn | ✅ Sub-Agent | ✅ background task |
| 持久化隔离 | ✅ `appendEntry` | ✅ 文件系统 | ✅ 文件系统 |
| 自定义压缩 | ✅ `session_before_compact` | ❌ | ❌ |

### 降级策略

- Pi: 完整实现（参考实现）
- OC: `messages.transform` 接近 Pi 能力，部分降级
- CC: 不完美但透明的降级 — Prefix 注入 + PreToolUse deny + 文件中转

## 6. 事件钩子放置

| 钩子 | 功能 | Pi | CC | OC |
|------|------|----|----|-----|
| 启动 | 设置工具限制 + 加载 Manifest | `session_start` | `SessionStart` | Plugin 初始化 |
| 每轮开始 | 注入角色 + 锁定/解锁工具 | `before_agent_start` | N/A | `messages.transform` |
| 上下文过滤 | CAL 替换 + MDC System 替换 | `context` | N/A | `messages.transform` |
| 轮结束 | 风险评估 + 史官触发 + CAL 更新 | `agent_end` | `Stop` | Plugin 事件 |
| 工具拦截 | Manifest 工具白名单执法 | `setActiveTools` | `PreToolUse` deny | N/A |
| 压缩前 | L3 终局深审 | `session_before_compact` | N/A | N/A |

## 7. 设计决策表

| # | 决策 | 选择 | 理由 | 辩论来源 |
|---|------|------|------|----------|
| 1 | 上下文管理 | CAL 锚点账本 | 事件驱动 > 每轮重构 > 简单 TTL | Topic 1 |
| 2 | 建议清除 | 语义事件清除 | TTL 可能误删高风险警告 | Topic 1 |
| 3 | 史官触发 | 分级闸门 (L0-L3) | 平衡安全性与用户体验 | Topic 2 |
| 4 | 阻塞策略 | 异步优先 + 高危同步 | 纯同步卡顿，纯异步不安全 | Topic 2 |
| 5 | 史官输入 | 机械提取事实包 | 消除 LLM 摘要信任危机 | Topic 3 |
| 6 | 游标设计 | 单一序列号 | 多维游标同步复杂度过高 | Topic 3 |
| 7 | 子任务监督 | 双层客观监督 | 防止回音室 + 控制 Token 成本 | Topic 4 |
| 8 | 元数据来源 | 平台代码提取 | LLM 自述不可信 | Topic 4 |
| 9 | 工具管理 | Manifest-Driven Clerk | 非独立 Agent，声明式清单 | Topic 5 |
| 10 | System 清理 | 全量替换 | 识别 Skill prompt 是脆弱点 | Topic 5 |

## 8. 扩展点

| 方向 | 说明 | 实现路径 |
|------|------|---------|
| 新增九卿 | 新建角色 `.md` 文件 | 零代码修改 |
| 自定义风险矩阵 | 用户配置 `court-config.json` | 覆盖默认 RISK_MATRIX |
| 多模型分配 | delegate 扩展 `model` 参数 | spawn 时添加模型参数 |
| 记忆归档 | context.md 膨胀时自动压缩 | 专门的"史官大修"任务 |
| 特许申请 | 九卿遇权限不足时申请 | 触发丞相重新生成 Manifest |
| 自定义压缩 | 保留朝廷关键上下文 | `session_before_compact` 钩子 |

## 9. 约束与风险

| 类别 | 描述 | 缓解 |
|------|------|------|
| 并行状态竞态 | 多个九卿同时完成时 CAL 更新 | 原子操作或版本号合并 |
| 机械提取粒度 | 截断可能切断代码逻辑 | 关键词高亮 + 按需优化提取规则 |
| 清单准确性 | 丞相可能遗漏关键工具 | 自检步骤 + 特许申请机制 |
| CC Token 膨胀 | 长周期项目历史累积 | 超阈值触发"软重置"（新 Session + CAL 快照） |
| 风险矩阵覆盖 | 静态矩阵无法覆盖所有场景 | 允许用户自定义 + 默认保守 |
| 史官超时 | 审查卡死阻塞主流程 | 超时自动 ALLOW_WITH_WARNING |

## 10. 文件结构

```
.court/
├── manifest.json          ← Court Manifest (Skill/工具清单)
├── cal.json               ← Court Anchor Ledger (锚点账本)
├── cursor.json            ← 游标状态 (seq + git_ref)
├── packets/               ← 机械提取事实包
│   ├── fact_1024.json
│   └── fact_1025.json
├── logs/                  ← ObjectiveNode 执行日志
│   └── {session_id}.jsonl
└── context.md             ← 项目记忆 (Details + Experiences)

extension/
├── index.ts               ← 入口 (角色路由 + 事件/工具/命令注册)
├── historian.ts           ← 史官 spawn + 事实包构建
├── delegate.ts            ← delegate 工具 + ObjectiveNode 提取
├── cal.ts                 ← Court Anchor Ledger 管理
├── manifest.ts            ← Manifest-Driven Clerk 逻辑
├── risk-matrix.ts         ← 风险分级矩阵
├── state.ts               ← 运行时状态
└── types.ts               ← 类型定义

prompts/
├── historian.md           ← 史官 prompt (用户可编辑)
└── agents/*.md            ← 九卿/执行层角色定义
```
