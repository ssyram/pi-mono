# 朝廷架构设计对比与决策报告

> 日期: 2026-02-23
> 文档目的: 原始设计与修订设计全面对比，援引辩论证据
> 涉及版本: Pi v1 (court-project-spec) / CC V11 (agent-design-003) / Revised v2 (revised-court-spec)

---

## 1. 执行摘要

以下是本次修订中最关键的变更:

- **史官触发机制重构**: 从「每次 agent_end 必触发」改为「分级闸门模型 (L0-L3)」，低风险操作直接跳过，高风险操作同步阻塞。这解决了低频任务下的冗余审查开销问题。
- **上下文管理范式转移**: 从简单的 `context` 事件替换改为「Court Anchor Ledger (CAL)」锚点账本，通过 DECISION / RISK_HIGH / TASK_ACTIVE 三类锚点实现生命周期管理。高风险建议的清除策略从 TTL 轮次计数改为语义事件驱动。
- **监督依据独立化**: 史官输入从 LLM 生成的摘要改为「机械提取事实包 (Fact Packet)」，由父进程代码直接提取 tool_calls、git_diff_stat、final_statement 等客观数据，消除对被监督者的信任依赖。
- **子任务监督增强**: 引入「双层客观监督」机制，第一层平台自动提取的 ObjectiveNode 元数据快速扫描异常，第二层按需深挖日志。解决了纯丞相决策审查的回音室效应。
- **书记官角色重新定义**: 从「独立 Agent」改为「Manifest-Driven Clerk (MDC)」—— 声明式清单 + Hook 机械执法。通过 `court-manifest.json` 声明阶段工具白名单，Hook 自动执行，拒绝 Skill prompt 识别这一脆弱点。

---

## 2. 设计维度对照表

| 设计维度 | Pi v1 (court-project-spec) | CC V11 (agent-design-003) | Revised v2 (revised-court-spec) |
|----------|---------------------------|--------------------------|--------------------------------|
| **丞相工具集** | `read` + `delegate` (setActiveTools) | 同 CC: `Task` + 自定义 tool | 同 Pi v1: `read` + `delegate` |
| **史官触发时机** | 每次 `agent_end` 必触发 | SessionStart hook 提醒 spawn + SubagentStop 自循环 | 分级闸门 (L0-L3): 纯 Read 跳过 / Write 异步 / Bash 同步 / Session End 深审 |
| **史官输入来源** | 从 `agent_end` messages 提取 | PreToolUse updatedInput 预构建 + 史官自读文件 | 机械提取事实包 (Fact Packet) |
| **建议清除策略** | 2 轮后移除 (TTL) | pending-advice.md 文件中转 + PostToolUse 注入 | 语义事件清除 ([RESOLVED: risk_id]) |
| **上下文管理** | `context` 事件简单替换摘要 | PostToolUse + 文件中转 | CAL 锚点账本 + 事件驱动更新 |
| **子任务监督** | 仅审查丞相输出 | SubagentStop exit 2 自循环 | 双层客观监督 (ObjectiveNode + 按需深挖) |
| **书记官形态** | 无专门机制 | 建议文件管理 | MDC: 声明式清单 + Hook 执法 |
| **工具限制方式** | `setActiveTools` 源头限制 | PreToolUse deny | 同 Pi v1: setActiveTools / Manifest 白名单 |
| **持久化机制** | `appendEntry` session 文件 | 文件系统 (.claude/historian/) | 同 Pi v1: appendEntry + 文件系统 |
| **跨平台支持** | Pi Extension 独占 | CC Hooks + OC 桥接 | 三平台: Pi Extension / CC Hooks / OC Plugin |

---

## 3. 逐题变更分析

### 3.1 辩题一: 丞相上下文管理

**原设计方案**

Pi v1 的做法是通过 `context` 事件过滤，将已完成 delegate 结果替换为简短摘要，将过期的史官建议移除。但这个机制有几个问题: 第一，过滤逻辑是简单的轮次计数，不区分建议的严重程度; 第二，`context` 事件每次 LLM 调用前都触发，全量替换消息数组的计算成本随对话长度线性增长; 第三，没有明确的任务状态追踪机制，无法区分「进行中」和「已完成」的任务。

CC V11 的做法是通过 PostToolUse hook 在每次工具调用后检查 pending-advice.md 文件，通过 stderr 注入进言。这种方式避免了 `context` 事件的全局替换，但引入了文件读写 IO，且进言的时机依赖管家的工具调用频率——如果管家长时间纯思考，进言会延迟很久。

**辩论发现**

gpt-5.2 提出: 上下文管理应该采用「锚点账本」模式，在 Session 持久化区维护一个独立的状态结构，而不是直接操作消息数组。这个结构应该区分不同类型的上下文锚点，比如「已确认的决策」、「当前风险警告」、「进行中的任务」，每种类型有不同的过期策略。

> **批注**：我们也许可以强制有一段自总结 Hook —— 每当丞相停止，强行唤起，使其对这一段关键决策，执行这些锚点的新增/管理？

kimi-k2.5 指出: TTL (Time-To-Live) 轮次计数的问题是它无法区分重要和不重要的建议。一个高风险的架构决策建议可能被 2 轮后移除，而一个无关紧要的风格建议反而可能保留。应该改为语义事件驱动——当某个风险被解决时，相关的警告锚点才被清除。

> **批注**：是的，TTL 不应该被使用，同时应该考虑锚点清除之类的事情，锚点例如 SKILL 的锚点的清理将会将 SKILL 相关的操作性和过程性上下文清理，这里的问题是过程性上下文到底是通过丞相自行总结保留结果性记忆部分（高耗能），还是单纯只是将 SKILL 的说明从上下文清理掉即可（保留过程，但是省略了总结步骤，貌似降低成本？但是这些东西一直保留在上下文里是否成本角度更低？），丞相自身的执行过程不清理？这个也是下一个辩论议题。此外我们还要考虑手下（九卿/执行层）的返回到底应该如何反馈保留到丞相的上下文？我能考虑到的是： (1) 直接丞相总结保留到上下文；(2) 直接丞相总结但不保留到上下文；(3) 让手下保留简单总结，同时将自身的详细汇报放到文件，作为某种类似 SKILL 的东西，丞相可以选择展开某次汇报的细节，展开完当作为临时决策的依据已经完成就可以清理掉这个汇报的上下文……还有什么手段？这个也是重要的辩论点。

claude-sonnet-4-6 补充: 上下文压缩不应该每次 LLM 调用都做全量替换，而是应该在特定事件发生时 (如 delegate 完成、史官进言) 做增量更新。这需要设计一个事件驱动的锚点账本。

> **批注**：貌似例如 Pi 这种每次做增量筛选性批注容易累积上下文，每次清理的时间线性增长，导致最终运算复杂度 O(n^2) ？我们貌似可以全局性维持锚点账本，然后用丞相的最近一次的思考强行更新这个账本，这样每次新的丞相调用上下文仅限于账本本体了。不过相当于每次都在做 compress ，是否会造成精度问题？

**评审裁决**

qwen3.5-plus 的最终推荐是采用「语义锚点 + 协议化惰性压缩」模式，具体包括: (1) 在 Session 持久化区维护锚点账本 (CAL)，区分 DECISION / RISK_HIGH / TASK_ACTIVE 三类锚点; (2) 更新时机限定在 `agent_end` 事件，而非每次 LLM 调用; (3) 高风险建议基于「问题解决」语义事件清除，而非轮次计数; (4) 已完成任务使用协议化结构块 (COURT_TASK_RESULT) 替换原始对话。

> **批注**：不完全懂，结合上面的批注考虑一下这些问题？有需要再展开新议题辩论，然后解释的时候给一些**简短易懂**的例子，用人话说清楚整件事。不必要一定完全重新思考，特别是批注不一定对，因为我没有完全理解你们的意思，如果发现批注没道理就说清楚为什么没道理，你这个是更好的选择。

**修订决策**

Revised v2 采用 Court Anchor Ledger (CAL) 作为核心机制:

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

锚点账本在 `agent_end` 事件中根据 delegate 完成和史官建议更新。上下文构建时，根据 CAL 动态组装消息——已完成任务的原始对话替换为 DECISION 摘要，RISK_HIGH 锚点注入 System Prompt 或顶部消息。清除策略使用 `[RESOLVED: risk_id]` 标记检测。

选择理由: 事件驱动局部更新优于每轮全局重构; 语义事件清除优于 TTL 轮次计数，能够保留高风险警告直到真正被解决。

---

### 3.2 辩题二: 史官生命周期与触发时机

**原设计方案**

Pi v1 的设计是「每次 agent_end 必触发」—— 丞相的 Agent 循环结束后，自动 spawn 史官子进程进行审查。这个设计简单明确，但问题是: 即使是纯读取操作 (如用户只是问了一个问题，丞相调用 `read` 工具查文件)，史官也会被触发审查，造成不必要的计算开销和延迟。

CC V11 试图解决这个问题，提出了「自释放史官」模型: 史官通过 SubagentStop hook 实现自循环，管家只需 spawn 一次。但这个设计有几个未验证的假设: (1) SubagentStop exit 2 阻止停止后，stderr 是否真的会注入 subagent context? (2) 自循环是否有次数限制? (3) 预构建的上下文如何传递?

**辩论发现**

gpt-5.2 认为: 应该根据操作的风险等级动态选择审查策略，而不是一刀切地每次都触发。低风险操作 (纯读取) 应该跳过审查，高风险操作 (文件写入、系统命令) 应该同步阻塞审查。

kimi-k2.5 提出: 异步审查的体验问题需要解决。如果异步审查的结果要在下一轮才能生效，那么用户在看到审查结果前可能已经基于错误信息继续工作了。可以通过「工具锁定」机制来解决: 异步审查期间，阻止新的写操作，直到审查完成。

claude-sonnet-4-6 补充: 终局审查 (Session End / Compact) 是一个特殊场景，需要同步深审。因为 session 即将结束或压缩，如果不在这时全面审查，很多问题可能永远不会被发现。

**评审裁决**

qwen3.5-plus 的推荐是「分级闸门模型」:

| 风险级别 | 触发条件 | 审查模式 | 工具策略 |
|----------|----------|----------|----------|
| L0 无风险 | 纯 Read/只读 Delegate | 跳过史官 | 正常 |
| L1 低风险 | 常规 Write/Delegate | 异步史官 (后台 Spawn) | 下一轮工具解锁 |
| L2 高风险 | Bash/MCP/敏感操作 | 同步史官 (阻塞) | 强制工具锁 |
| L3 终局 | Session End/Compact | 同步深审 (阻塞) | N/A |

实现要点: 风险分级由硬编码矩阵决定，非 LLM 判断; 异步审查通过 setActiveTools 实现「逻辑同步、体验异步」; 终局审查利用 `session_before_compact` 钩子; 所有 Spawn 设置超时保护，超时视为 ALLOW_WITH_WARNING。

**修订决策**

Revised v2 采用分级闸门模型，通过硬编码的风险矩阵决定触发时机:

```typescript
const RISK_MATRIX = {
  LOW_RISK: ['read_file', 'list_dir', 'search_code'],
  MED_RISK: ['write_file', 'edit_file', 'delegate'],
  HIGH_RISK: ['bash', 'mcp_*', 'delete_file'],
  SENSITIVE_PATTERNS: ['.env', 'secret', 'password']
};
```

异步但不失控: L1 审查未完成时，通过工具限制阻止新的写操作。超时保护: 所有 spawn 设置 30s/60s 超时，超时视为 ALLOW_WITH_WARNING。

选择理由: 平衡安全性与用户体验，纯同步卡顿，纯异步不安全。分级闸门是务实的工程折中。

---

### 3.3 辩题三: 史官上下文管理 (输入设计)

**原设计方案**

Pi v1 的史官输入来自 `agent_end` 事件的 messages 数组，Extension 代码提取丞相本轮输出 + 最近几条历史记录作为 prompt。这本质上是一种 LLM 摘要——从 messages 中提取内容拼接到史官的 prompt 中。

问题在于: 这个摘要过程是由父进程的代码完成的，但提取什么、不提取什么的决策可能是隐式地由代码逻辑决定的。更根本的问题是: 如果史官要审查丞相的输出，丞相可能会在输出中隐藏一些问题 (无论是有意还是无意)，导致史官基于不完整或不准确的信息做判断。

CC V11 尝试通过 PreToolUse updatedInput 来预构建上下文，目标是让史官在启动时就获得完整的上下文，不需要自己读文件。但这个方案依赖于 V4 假设 (PreToolUse 对 Task tool 的 updatedInput 可以修改 prompt) 的验证。

**辩论发现**

gpt-5.2 提出了一个根本性的设计原则: 「监督依据必须独立于被监督者」。父进程 (Hook 代码) 应该像书记员一样如实地记录客观事实，而不是生成摘要让史官去审查。如果让被监督者参与输入的生成，就引入了信任假设。

kimi-k2.5 同意这个原则，并进一步指出: 摘要过程本身就是一个信息折损。即使父进程代码「如实」提取，它也必须做选择——选择保留什么、丢弃什么。这个选择过程可能遗漏关键信息。

claude-sonnet-4-6 提议: 使用「机械提取」代替「LLM 摘要」。由平台代码直接提取客观数据 (tool_calls 列表、git diff stat、最后 assistant 消息截取)，不做任何语义理解或摘要生成。

**评审裁决**

qwen3.5-plus 的推荐是「机械提取事实包 + 协议化游标」:

- 信息获取: 纯代码机械提取 (遍历 messages 提取 tool_use、git diff stat)，严禁调用 LLM 生成摘要
- 事实包格式: JSON，含 tool_calls、git_diff_stat、final_statement、context_snapshot
- 游标: 单一序列号 (seq + git_ref)，关联所有事件源
- Token 控制: 事实包目标 ~1.6-2k tokens; 史官只能读取 `.court/packets/fact_*.json` 和 `context.md`
- 核验方式: 史官对比 metrics 与 selfReport 找不一致，而非重新审查完整对话

**修订决策**

Revised v2 设计了机械提取事实包:

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
  "delegation_tree": [...]
}
```

选择理由: 消除 LLM 摘要的信任危机。监督依据独立于被监督者——父进程代码是机械的、客观的、不包含语义判断的。

---

### 3.4 辩题四: 史官子任务监督能力

**原设计方案**

Pi v1 的史官只审查丞相的输出，不涉及对九卿和执行层的直接监督。丞相通过 delegate 工具将任务分配给下级，下级的执行结果通过 delegate tool 的返回值传回丞相。史官如果要审查子任务的执行，只能通过审查丞相的输出来间接进行。

这引出了一个「回音室」问题: 丞相告诉史官「我分配了任务 X 给九卿，九卿完成了，结果是 Y」。史官没有直接验证手段，只能选择相信丞相的描述。如果丞相的描述有误 (无论是有意隐瞒还是无意遗漏)，史官无法发现。

CC V11 的 SubagentStop 自循环机制试图让史官更加主动，但核心问题仍然是: 史官基于什么信息做判断? 如果信息来自管家的转述，就存在信息不对称。

**辩论发现**

gpt-5.2 认为: 应该引入「客观元数据」作为第一层监督依据。平台代码可以在每个子任务完成时自动提取执行统计 (工具调用次数、耗时、退出码、是否有写操作)，这些是客观数据，不受任何 Agent 的控制。

kimi-k2.5 补充: 第一层元数据应该用于快速扫描异常。比如: 声称完成但无 Write 操作 → 深挖; 耗时异常短 → 深挖; 置信度低 → 深挖。这种「双层视图」可以大幅降低审查成本，同时保持异常发现的敏感性。

claude-sonnet-4-6 强调: 第二层按需深挖时，史官应该读取的是平台生成的原始日志，而不是 Agent 的自述。Agent 可能为了美化自己的表现而隐瞒问题，但平台日志是客观记录。

**评审裁决**

qwen3.5-plus 的推荐是「增强型客观监督 (双层视图)」:

- 第一层 (默认): 平台自动提取的客观元数据树 (ObjectiveNode)
  - 工具调用统计、耗时、退出码、是否有写操作
  - 由平台代码 (非 LLM) 生成，不可篡改
  - 成本极低，用于快速扫描异常
- 第二层 (按需): 仅当第一层发现异常时，史官通过 `read` 工具获取详细日志
  - 声称完成但无 Write 操作 → 深挖
  - 耗时异常短 → 深挖
  - 置信度低 → 深挖
- 深度截断: 默认 Depth ≤ 2 展示完整元数据，更深层仅保留 metrics

**修订决策**

Revised v2 设计了 ObjectiveNode 元数据:

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

双层监督: 第一层 metrics 快速扫描异常，第二层仅对异常节点读取详细日志。

选择理由: 防止回音室效应。平台代码提取的元数据是客观的，史官可以对比 metrics 与 selfReport 找不一致。

---

### 3.5 辩题五: 书记官角色 — Skill/MCP 管理

**原设计方案**

Pi v1 没有专门的书记官角色。Skill 和 MCP 的管理是通过丞相的系统提示词和环境配置隐式处理的。丞相需要知道有哪些 Skill 可用、它们的 prompt 是什么，然后根据任务需求选择使用。

这个设计的问题在于: (1) Skill 的系统提示词是嵌入在 System Messages 中的，丞相可能修改或忽略它们; (2) 当多个 Skill 同时激活时，它们的 prompt 可能冲突或产生意外行为; (3) Skill 的上下文生命周期没有明确管理——它们可能被错误地保留到不该保留的任务中。

CC V11 提出了通过文件中转 (pending-advice.md) 和 hook 注入的方式，但这更多是关于史官进言的管理，而不是 Skill/MCP 的管理。

**辩论发现**

gpt-5.2 提出: 书记官应该是一个声明式的配置机制，而不是一个独立的 Agent。它的职责是根据当前任务阶段，动态配置可用的工具和 Skill 白名单。这类似于一个「配置驱动的守门人」。

kimi-k2.5 指出: 不应该尝试去识别 System Messages 中的 Skill prompt——这是脆弱的，因为 Skill 的实现可能在不同时期有不同格式。正确的做法是: 在任务初始化时，丞相生成一个明确的清单，声明本任务各阶段允许使用的工具和 Skill。

claude-sonnet-4-6 补充: 书记官的执法应该是机械的、由 Hook 自动执行的，而不是依赖丞相的自觉。Hook 在每轮根据清单设置工具白名单，甚至可以全量替换 System Messages。

**评审裁决**

qwen3.5-plus 的推荐是「Manifest-Driven Clerk (MDC)」:

- 不引入第五个独立 Agent。书记官 = 声明式清单 + Hook 机械执法
- 清单生成: 丞相在任务初始化时生成 `court-manifest.json` (一次性规划行为)
- 清单内容: 任务阶段定义、各阶段允许工具白名单、Skill 摘要 (非完整 prompt)、全局规则
- 执法方式: `before_agent_start` 设置工具白名单，`context` 事件全量替换 System Messages
- 关键创新: 不识别 Skill prompt，直接全量替换 System Messages 为清单中的摘要
- 阶段切换: 丞相更新 `appendEntry` 中的 phase 字段，Hook 自动读取新配置

**修订决策**

Revised v2 设计了 Manifest-Driven Clerk:

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

执法: `before_agent_start` / Hook 起始设置工具白名单; `context` / `messages.transform` 全量替换 System Messages 为清单摘要; 阶段切换时丞相更新 phase 字段，Hook 自动读取新配置。

选择理由: 非独立 Agent 是正确的——书记官不需要 LLM 推理能力，只需要机械执行配置。声明式清单易于理解和调试。

---

## 4. 保留的设计决策

以下设计从原始方案中被刻意保留，它们经过辩论验证仍然是正确的:

### 4.1 丞相超然地位

丞相通过 `setActiveTools(["read", "delegate"])` 从源头限制工具集，LLM 看不到其他工具的 schema。这是最可靠的隔离方式——不是在 tool_call 时拦截，而是让 LLM 根本不知道那些工具存在。辩论各方对此无异议，保留不变。

### 4.2 史官零状态

史官每次 spawn 都是全新进程 (`--no-session`)，不携带累积上下文。这确保审查者的独立性——不会因为之前的审查结论而对当前任务产生偏见。保留不变。

### 4.3 九卿可委托

九卿拥有完整工具集 + delegate 工具，可以继续向下委托。这支持了任务分解的递归性——复杂的复合任务可以层层分解。保留不变。

### 4.4 setActiveTools 源头限制

丞相的工具限制通过 `setActiveTools` 在 session_start 时设置，是运行时限制而非配置限制。辩论确认这是比拦截 tool_call 更可靠的方式。保留不变。

### 4.5 appendEntry 持久化

史官的记录通过 `appendEntry` 写入 session 文件，不进入 LLM 上下文。这利用了平台内置机制，天然实现了「可追溯但不影响当前决策」的隔离。保留不变。

### 4.6 --no-session 隔离

所有子进程 (九卿、执行层、史官) 都通过 `--no-session` 启动，每次都是干净的上下文。这避免了在长周期任务中上下文膨胀的问题。保留不变。

### 4.7 角色区分环境变量

通过 `PI_COURT_ROLE` 环境变量区分角色，spawn 时通过 `env` 参数传递。最简单且最直接的方案，辩论无异议。保留不变。

### 4.8 CC SubagentStop 自循环 (CC 特有)

虽然 Revised v2 采用了分级闸门模型，但 CC V11 的 SubagentStop exit 2 自循环机制被保留作为 CC 平台的特有实现。Pi 有更好的 `agent_end` 阻塞机制，但 CC 没有——SubagentStop 是 CC 实现异步史官的关键手段。

---

## 5. 新增机制

以下机制是辩论后新增的，它们不是简单的修改，而是引入了全新的设计概念:

### 5.1 CAL (Court Anchor Ledger)

**引入原因**: 辩论发现简单的 `context` 事件替换缺乏生命周期管理能力，无法区分不同严重程度的上下文条目。

**机制**: 在 Session 持久化区维护锚点账本，区分 DECISION (已完成决策，永不过期)、RISK_HIGH (高风险警告，基于语义事件清除)、TASK_ACTIVE (进行中任务)。

**收益**: 精确的上下文生命周期控制，高风险建议不会因 TTL 误删。

**成本**: 需要维护额外的状态文件 (cal.json)，更新逻辑比简单替换复杂。

### 5.2 Graded-Gate Model (分级闸门)

**引入原因**: 辩论发现「每次 agent_end 必触发」在低风险场景下造成不必要的开销和延迟。

**机制**: 根据硬编码风险矩阵 (LOW_RISK / MED_RISK / HIGH_RISK / SENSITIVE_PATTERNS) 决定触发级别和审查模式 (跳过 / 异步 / 同步 / 终局深审)。

**收益**: 减少低价值审查，提升用户体验，高风险操作得到足够的安全保障。

**成本**: 风险矩阵需要维护和调优，可能需要用户自定义能力。

### 5.3 Fact Packets (机械提取事实包)

**引入原因**: 辩论发现 LLM 摘要存在信任危机——监督依据不应该由被监督者参与生成。

**机制**: 父进程代码机械提取 tool_calls、git_diff_stat、final_statement、context_snapshot，不调用 LLM 生成任何摘要。

**收益**: 监督依据完全客观，消除信息折损和信息不对称。

**成本**: 事实包有 token 限制 (~1.6-2k)，需要精确的截断策略; 单一游标设计增加了同步复杂性。

### 5.4 ObjectiveNode (双层客观监督)

**引入原因**: 辩论发现纯丞相决策审查存在回音室效应——史官只能看到丞相愿意展示的内容。

**机制**: 第一层平台自动提取元数据 (metrics: toolCallCount、toolsUsed、hasWriteOperation、exitStatus、durationMs)，用于快速扫描异常; 第二层按需读取 rawLogPath 详细日志。

**收益**: 发现纯文本审查无法发现的异常 (如声称完成但无写操作)。

**成本**: 需要平台代码配合提取元数据; 深度截断策略需要调优。

### 5.5 MDC (Manifest-Driven Clerk)

**引入原因**: 辩论发现尝试识别 Skill prompt 是脆弱的——Skill 实现可能变化，识别逻辑需要同步维护。

**机制**: 丞相在任务初始化时生成声明式清单 (court-manifest.json)，Hook 根据清单全量替换 System Messages，不依赖任何 prompt 识别。

**收益**: 简化实现，易于理解和调试; 声明式配置支持版本控制和审查。

**成本**: 丞相需要准确估计任务阶段和工具需求; 遗漏关键工具时的特许申请机制需要额外设计。

---

## 6. 复杂度权衡

### 6.1 新增复杂度

CAL 的引入增加了状态管理的复杂性。原始设计的 `context` 事件替换是简单的: 传入 messages，返回过滤后的 messages。CAL 则需要: 维护锚点账本 → 在特定事件触发时更新锚点 → 根据锚点类型决定上下文组装策略。这个链路上有多个可能失败的地方 (如并行 delegate 的竞态条件)。

分级闸门模型引入了风险矩阵的概念。虽然矩阵本身是硬编码的，但调优需要实际使用数据支撑。低风险操作可能被误判为高风险 (导致过度审查)，或高风险操作被误判为低风险 (导致安全隐患)。

Fact Packets 和 ObjectiveNode 的机械提取增加了 IO 开销。每次史官触发需要构建事实包、提取元数据，这些操作发生在 critical path 上 (尤其是同步审查时)。需要性能测试验证是否在可接受范围内。

### 6.2 复杂度 vs 收益评估

| 机制 | 复杂度 | 收益 | 评估 |
|------|--------|------|------|
| CAL | 中 | 高 | 值得: 精确的生命周期控制解决根本问题 |
| 分级闸门 | 低 | 中 | 值得: 性能优化显著，逻辑简单 |
| Fact Packets | 中 | 高 | 值得: 解决信任危机，收益显著 |
| ObjectiveNode | 中 | 中 | 可接受: 回音室问题确实存在 |
| MDC | 低 | 中 | 值得: 简化实现，移除脆弱识别逻辑 |

### 6.3 诚实评估

有几个复杂度是我们有意引入的，但也是我们承认需要更多工作来验证的:

1. **CAL 的语义事件清除**: `[RESOLVED: risk_id]` 标记的生成和检测逻辑需要精确设计。如果丞相没有正确生成标记，风险警告可能永远不会清除。

2. **分级闸门的风险矩阵**: 硬编码矩阵是保守的，但可能无法覆盖所有用户场景。需要提供用户自定义配置能力，但配置错误可能导致安全漏洞。

3. **Fact Packets 的 token 控制**: ~1.6-2k tokens 是一个预算限制。简单的截断可能切断代码逻辑。关键词高亮和按需优化提取规则是未来工作。

4. **MDC 的清单准确性**: 丞相可能遗漏关键工具。自检步骤和特许申请机制是缓解手段，但不是根本解决方案。

---

## 7. 开放问题与后续工作

### 7.1 待验证假设

以下假设需要实际环境验证:

- **V1-V3 (CC 自循环)**: SubagentStop exit 2 + stderr 是否真的会注入 subagent context? SubagentStop 可以多次 exit 2 吗? 这些是 CC V11 方案的核心假设。

- **V4-V5 (CC 上下文注入)**: PreToolUse 对 Task tool 的 updatedInput 是否可以修改 prompt? PostToolUse 对 Task 触发且 stderr 注入管家?

- **OC messages.transform**: OC 的 `messages.transform` hook 稳定性如何? 是否能可靠地在每次 API 调用前注入进言?

### 7.2 工程实现问题

1. **并行 Delegate 的状态竞态**: 多个九卿同时完成时 CAL 更新的原子性如何保证? 需要文件锁或版本号合并策略。

2. **CC Token 膨胀极限**: 长周期项目中，CAL 和 context 的累积可能导致 Token 超限。需要设计「软重置」机制 (新 Session + CAL 快照)。

3. **机械提取的粒度边界**: 简单截断可能切断代码逻辑。关键词高亮 + 按需优化提取规则需要迭代。

### 7.3 长期演进方向

1. **记忆归档**: context.md 膨胀时的自动压缩机制——专门的「史官大修」任务。

2. **多模型分配**: delegate 扩展 `model` 参数，允许为不同任务指定不同模型。

3. **动态风险矩阵**: 用户自定义 `court-config.json` 覆盖默认 RISK_MATRIX。

---

## 8. 跨平台权衡矩阵

| 能力 | Pi Extension | CC Hooks | OC Plugin | 备注 |
|------|:---:|:---:|:---:|------|
| **上下文完整替换** | ✅ `context` | ❌ 仅 Prefix | ✅ `messages.transform` | CC 最大短板 |
| **源头工具限制** | ✅ `setActiveTools` | ⚠️ `PreToolUse` deny | ⚠️ 有限 | CC 需要 hook 拦截 |
| **同步史官 (阻塞)** | ✅ `agent_end` | ✅ `Stop` hook | ⚠️ 需模拟 | OC 需 workaround |
| **异步史官 (后台)** | ✅ spawn | ✅ Sub-Agent | ✅ background task | 三平台均可 |
| **持久化隔离** | ✅ `appendEntry` | ✅ 文件系统 | ✅ 文件系统 | 一致 |
| **自定义压缩** | ✅ `session_before_compact` | ❌ 无 | ❌ 无 | Pi 独有 |
| **子进程隔离** | ✅ `--no-session` | ✅ Task 隔离 | ✅ task 隔离 | 一致 |

### 8.1 Pi (首选实现平台)

**获得**: 完整 CAL + `context` 替换 + `setActiveTools` 源头限制 + `session_before_compact` 自定义压缩。

**失去**: 无。

**评价**: 最佳实现平台，所有机制都可完整表达。

### 8.2 CC (需要降级)

**获得**: 分级闸门 + Fact Packets + ObjectiveNode + MDC 核心机制。

**失去**: `context` 完整替换 → 只能 Prefix 注入 CAL 快照; `setActiveTools` → 需要 PreToolUse deny 模拟; 自定义压缩 → 无。

**降级策略**: Prefix 注入 + PreToolUse deny + 文件中转。不完美但是透明的降级。

### 8.3 OC (接近 Pi)

**获得**: `messages.transform` 接近 `context` 能力，可直接修改发给 API 的消息。

**失去**: `setActiveTools` 源头限制能力有限; 同步史官需要模拟; 无自定义压缩。

**降级策略**: 通过 `messages.transform` 复刻 Pi 的上下文注入逻辑。messages.transform 是 OC 独有优势。

---

## 9. 结论

本次修订通过五场多模型对抗辩论，系统性地审视了原始设计的每一个核心假设。修订不是否定过去，而是在经过验证的基础上向前演进。

保留的设计决策 (丞相超然、史官零状态、九卿可委托等) 是经过辩论确认的基础架构，它们不会被轻易改动。新增的 CAL、分级闸门、Fact Packets、ObjectiveNode、MDC 机制是对原始设计的增强，解决的是辩论中暴露的根本性问题。

跨平台支持是设计一开始就考虑的目标。Pi 是参考实现，CC 和 OC 的降级策略是透明的、可接受的。三平台用户都能获得核心价值，只是能力边界有所不同。

开放问题仍然存在，需要在实现过程中逐步验证和解决。但方向是清晰的: 事件驱动的锚点账本替代简单替换，机械提取的客观事实替代 LLM 摘要，双层客观监督替代纯文本审查，声明式清单替代脆弱的 prompt 识别。

这些改进将使朝廷架构更加健壮、更易维护、更能满足长周期、高复杂度项目的需求。
