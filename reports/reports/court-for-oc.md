# OpenCode 平台实现 — 修订版朝廷架构

> 日期: 2026-02-23
> 前置: revised-court-spec.md (v2) + debate/summary.md + agent-design-002-opencode.md
> 目标: 将辩论后的修订版架构 (CAL、分级闸门、机械事实包、MDC) 映射到 OpenCode 平台

---

## 1. 设计背景

辩论后的修订版朝廷架构引入了五个核心机制: Court Anchor Ledger (CAL)、分级闸门 (Graded-Gate)、机械提取事实包 (Fact Packet)、双层客观监督 (ObjectiveNode)、Manifest-Driven Clerk (MDC)。这些机制在 Pi Extension 平台可获得完整支持，在 Claude Code (CC) 平台需要通过 Prefix 注入等变通方案实现。

OpenCode (oh-my-opencode) 作为 CC 的开源替代，提供了独特的 `messages.transform` 钩子，其能力更接近 Pi 的 `context` 事件。本文档阐述如何在 OpenCode 平台上实现修订版架构，并分析其相较于 CC 的优势与相较于 Pi 的局限。

---

## 2. 平台能力映射

### 2.1 能力矩阵

| 机制 | Pi Extension | CC Hooks | OpenCode Plugin |
|------|:---:|:---:|:---:|
| CAL 上下文管理 | `context` 事件直接替换 | Prompt Prefix 注入 | `messages.transform` 替换 |
| 分级闸门触发 | `agent_end` 阻塞 | `Stop` hook | Plugin `stop` 事件 + `block` |
| 机械事实包提取 | 父进程代码提取 | Hook 代码提取 | Plugin event handler 提取 |
| 任务元数据 | 平台自动生成 | 需 Hook 手动提取 | 需 Plugin 手动提取 |
| MDC 工具限制 | `setActiveTools` | `PreToolUse` deny | 有限，需 Skill 配合 |
| 史官自循环 | `agent_end` exit 2 | `SubagentStop` exit 2 | Plugin 循环需外部调度 |
| 压缩钩子 | `session_before_compact` | 无 | 无 |

### 2.2 关键发现

OpenCode 的 `messages.transform` 是实现 CAL 的关键技术。该钩子在每次 API 调用前执行，允许直接修改 messages 数组，包括替换 System Message。这是 CC 平台完全不具备的能力。

```typescript
// OpenCode messages.transform 签名
type MessageTransform = (messages: Message[], context: TransformContext) => Message[];
```

CC 的最佳方案是 Prompt Prefix 注入，该方法只能追加内容，无法替换已有 System Message。OpenCode 可以在 messages 数组中定位 System Message 并完全替换为 CAL 聚合结果。

---

## 3. 核心机制实现

### 3.1 Court Anchor Ledger (CAL) — OpenCode 实现

CAL 的核心是锚点账本管理 + 上下文动态构建。在 OpenCode 中，通过 `messages.transform` 实现两层逻辑:

```typescript
// .opencode/plugins/ghw-cal.ts
import { Plugin, TransformContext, Message } from 'oh-my-opencode';

const CAL_ANCHOR_FILE = '.court/cal.json';
const ACTIVE_CONCERNS_FILE = '.court/context.md';

interface Anchor {
  id: string;
  type: 'DECISION' | 'RISK_HIGH' | 'TASK_ACTIVE';
  taskId?: string;
  content: string;
  createdAt: number;
  expiresOn?: 'NEVER' | 'TASK_COMPLETED' | 'EXPLICIT_RESOLVED';
}

interface CALState {
  anchors: Anchor[];
  version: number;
}

async function loadCAL(): Promise<CALState> {
  try {
    const content = await Bun.file(CAL_ANCHOR_FILE).text();
    return JSON.parse(content);
  } catch {
    return { anchors: [], version: 0 };
  }
}

async function saveCAL(state: CALState): Promise<void> {
  const tmpPath = `${CAL_ANCHOR_FILE}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(state, null, 2));
  await Bun.rename(tmpPath, CAL_ANCHOR_FILE);
}

function buildCALContext(cal: CALState): string {
  const decisions = cal.anchors.filter(a => a.type === 'DECISION');
  const risks = cal.anchors.filter(a => a.type === 'RISK_HIGH');
  const active = cal.anchors.filter(a => a.type === 'TASK_ACTIVE');
  
  const parts: string[] = [];
  
  if (active.length > 0) {
    parts.push('【进行中任务】');
    for (const task of active) {
      parts.push(`- ${task.taskId}: ${task.content}`);
    }
  }
  
  if (risks.length > 0) {
    parts.push('【风险警告】');
    for (const risk of risks) {
      parts.push(`- [${risk.id}] ${risk.content}`);
    }
    parts.push('如已解决，请在回复末尾标注 [RESOLVED: risk_id]');
  }
  
  if (decisions.length > 0) {
    parts.push('【已完成决策】');
    for (const decision of decisions.slice(-5)) {
      parts.push(`- ${decision.content}`);
    }
  }
  
  return parts.length > 0 ? parts.join('\n') : '';
}

export const ghwCALPlugin: Plugin = {
  name: 'ghw-cal',
  
  messagesTransform: async (messages: Message[], ctx: TransformContext): Promise<Message[]> => {
    const cal = await loadCAL();
    const calContext = buildCALContext(cal);
    
    if (!calContext) {
      return messages;
    }
    
    const systemIndex = messages.findIndex(m => m.role === 'system');
    
    if (systemIndex >= 0) {
      const existingSystem = messages[systemIndex].content;
      messages[systemIndex] = {
        ...messages[systemIndex],
        content: `${existingSystem}\n\n## Court Anchor Ledger\n${calContext}`
      };
    } else {
      messages.unshift({
        role: 'system',
        content: `## Court Anchor Ledger\n${calContext}`
      });
    }
    
    return messages;
  }
};
```

**Token 优化**: 仅注入 CAL 聚合结果 (~200-500 tokens)，而非全部历史。已完成任务使用 DECISION 摘要替换原始对话。

### 3.2 分级闸门 (Graded-Gate) — OpenCode 实现

分级闸门根据操作风险等级选择审查策略。在 OpenCode 中，通过 Plugin 的 `stop` 事件结合 `block` 参数实现:

```typescript
// .opencode/plugins/ghw-graded-gate.ts
import { Plugin, StopContext, StopResult } from 'oh-my-opencode';

const RISK_MATRIX = {
  LOW_RISK: ['read_file', 'list_dir', 'search_code', 'grep', 'glob'],
  MED_RISK: ['write_file', 'edit_file', 'delegate', 'task'],
  HIGH_RISK: ['bash', 'mcp_*', 'delete_file', 'interactive_bash'],
  SENSITIVE_PATTERNS: ['.env', 'secret', 'password', 'credentials']
};

type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3';

interface GateState {
  lastToolCalls: Array<{ name: string; path?: string; status: string }>;
  historianPending: boolean;
  historianBlockToken: string | null;
}

async function assessRisk(state: GateState): Promise<RiskLevel> {
  const recentCalls = state.lastToolCalls.slice(-10);
  
  for (const call of recentCalls) {
    if (RISK_MATRIX.HIGH_RISK.some(p => 
      call.name === p || (p.includes('*') && call.name.startsWith(p.replace('*', '')))
    )) {
      return 'L2';
    }
    
    if (RISK_MATRIX.SENSITIVE_PATTERNS.some(p => 
      call.path?.includes(p)
    )) {
      return 'L2';
    }
    
    if (RISK_MATRIX.MED_RISK.includes(call.name)) {
      return 'L1';
    }
  }
  
  const hasWrite = recentCalls.some(c => 
    c.name === 'write_file' || c.name === 'edit_file'
  );
  
  if (hasWrite) {
    return 'L1';
  }
  
  return 'L0';
}

async function triggerHistorian(sessionId: string, level: RiskLevel): Promise<void> {
  const stateFile = `.court/gate-state-${sessionId}.json`;
  const state: GateState = {
    lastToolCalls: [],
    historianPending: true,
    historianBlockToken: level === 'L2' ? 'BLOCK' : null
  };
  
  await Bun.write(stateFile, JSON.stringify(state));
}

export const ghwGradedGatePlugin: Plugin = {
  name: 'ghw-graded-gate',
  
  stop: async (ctx: StopContext): Promise<StopResult> => {
    const stateFile = `.court/gate-state-${ctx.sessionId}.json`;
    let state: GateState;
    
    try {
      const content = await Bun.file(stateFile).text();
      state = JSON.parse(content);
    } catch {
      state = { lastToolCalls: [], historianPending: false, historianBlockToken: null };
    }
    
    if (state.historianPending && state.historianBlockToken) {
      return {
        block: true,
        injectPrompt: `【史官审查锁定】等待史官完成审查后方可结束。
        
请调用 task(subagent_type="historian", prompt="执行分级审查...")`
      };
    }
    
    const risk = await assessRisk(state);
    
    if (risk === 'L0') {
      return { block: false };
    }
    
    if (risk === 'L1' || risk === 'L2') {
      await triggerHistorian(ctx.sessionId, risk);
      
      return {
        block: risk === 'L2',
        injectPrompt: `【史官待触发】${risk === 'L1' ? '异步审查' : '同步阻塞审查'}
        
执行: task(subagent_type="historian", prompt="你是史官，基于以下事实包执行审查...")
        
审查完成后，继续工作或结束。`
      };
    }
    
    return { block: false };
  }
};
```

### 3.3 机械提取事实包 (Fact Packet) — OpenCode 实现

事实包由父进程代码机械提取，确保监督依据独立于被监督者。OpenCode 通过监听 `toolExecute` 事件构建事实包:

```typescript
// .opencode/plugins/ghw-fact-packet.ts
import { Plugin, ToolExecuteContext, Message } from 'oh-my-opencode';

const PACKET_DIR = '.court/packets';
const CURSOR_FILE = '.court/cursor.json';

interface FactPacket {
  seq: number;
  meta: {
    duration_ms: number;
    turn_id: number;
    git_ref: string;
  };
  facts: {
    tool_calls: Array<{
      name: string;
      path?: string;
      status: string;
      input_summary?: string;
    }>;
    git_diff_stat: string;
    final_statement: string;
  };
  context_snapshot: {
    active_concerns: string[];
    recent_experiences: string[];
  };
  delegation_tree: object[];
}

async function getGitRef(): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe' });
  const output = await new Response(proc.stdout).text();
  return output.trim();
}

async function loadCursor(): Promise<{ seq: number; git_ref: string }> {
  try {
    const content = await Bun.file(CURSOR_FILE).text();
    return JSON.parse(content);
  } catch {
    return { seq: 0, git_ref: await getGitRef() };
  }
}

async function saveCursor(seq: number, git_ref: string): Promise<void> {
  await Bun.write(CURSOR_FILE, JSON.stringify({ seq, git_ref }));
}

async function loadContextSnapshot(): Promise<FactPacket['context_snapshot']> {
  try {
    const content = await Bun.file('.court/context.md').text();
    const concernsMatch = content.match(/## Active Concerns\n([\s\S]*?)##/);
    const expMatch = content.match(/## Recent Experiences\n([\s\S]*?)$/);
    
    return {
      active_concerns: concernsMatch ? concernsMatch[1].trim().split('\n').filter(Boolean) : [],
      recent_experiences: expMatch ? expMatch[1].trim().split('\n').filter(Boolean) : []
    };
  } catch {
    return { active_concerns: [], recent_experiences: [] };
  }
}

export const ghwFactPacketPlugin: Plugin = {
  name: 'ghw-fact-packet',
  
  toolExecute: async (ctx: ToolExecuteContext): Promise<void> => {
    const packetFile = `${PACKET_DIR}/fact-${ctx.turnId}.json`;
    
    const lastMessages = ctx.messages.slice(-5);
    const finalStatement = lastMessages
      .filter(m => m.role === 'assistant')
      .pop()?.content
      ?.slice(0, 200) || '';
    
    const gitRef = await getGitRef();
    const cursor = await loadCursor();
    const contextSnapshot = await loadContextSnapshot();
    
    const packet: FactPacket = {
      seq: cursor.seq + 1,
      meta: {
        duration_ms: Date.now() - ctx.turnStartTime,
        turn_id: ctx.turnId,
        git_ref: gitRef
      },
      facts: {
        tool_calls: ctx.toolCalls.map(tc => ({
          name: tc.name,
          path: tc.input?.filePath || tc.input?.path,
          status: tc.status || 'success',
          input_summary: JSON.stringify(tc.input).slice(0, 100)
        })),
        git_diff_stat: '',
        final_statement: finalStatement
      },
      context_snapshot: contextSnapshot,
      delegation_tree: []
    };
    
    const diffProc = Bun.spawn(['git', 'diff', '--stat', 'HEAD~1'], { stdout: 'pipe' });
    packet.facts.git_diff_stat = await new Response(diffProc.stdout).text();
    
    await Bun.write(packetFile, JSON.stringify(packet, null, 2));
    await saveCursor(packet.seq, gitRef);
  }
};
```

### 3.4 双层客观监督 (ObjectiveNode) — OpenCode 实现

每个任务完成时，平台代码自动提取客观元数据。OpenCode 需要通过任务完成事件主动收集:

```typescript
// .opencode/plugins/ghw-objective-node.ts
import { Plugin, TaskCompleteContext } from 'oh-my-opencode';

const NODE_LOG_FILE = '.court/logs/objective-nodes.jsonl';

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
  selfReport?: {
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    anomalies: string[];
  };
}

function extractTaskId(task: TaskCompleteContext['task']): string {
  return task.id || task.description?.slice(0, 32) || `task-${Date.now()}`;
}

function analyzeAnomalies(node: Partial<ObjectiveNode>): string[] {
  const anomalies: string[] = [];
  
  if (node.metrics) {
    if (node.metrics.hasWriteOperation === false && 
        node.metrics.toolCallCount > 10) {
      anomalies.push('声称完成任务但无写操作');
    }
    
    if (node.metrics.durationMs < 1000 && node.metrics.toolCallCount > 3) {
      anomalies.push('执行时间异常短');
    }
    
    if (node.metrics.exitStatus === 'error') {
      anomalies.push('任务执行报错');
    }
  }
  
  if (node.selfReport?.confidence === 'low') {
    anomalies.push('执行者置信度低');
  }
  
  return anomalies;
}

export const ghwObjectiveNodePlugin: Plugin = {
  name: 'ghw-objective-node',
  
  taskComplete: async (ctx: TaskCompleteContext): Promise<void> => {
    const task = ctx.task;
    
    const node: ObjectiveNode = {
      taskId: extractTaskId(task),
      parentId: task.parentId || null,
      role: task.role === 'historian' ? 'worker' : (task.role || 'worker'),
      metrics: {
        toolCallCount: task.toolCalls?.length || 0,
        toolsUsed: task.toolCalls?.map(tc => tc.name) || [],
        hasWriteOperation: (task.toolCalls || []).some(tc => 
          tc.name === 'write_file' || tc.name === 'edit_file'
        ),
        exitStatus: task.status === 'completed' ? 'success' : 
                    task.status === 'interrupted' ? 'interrupted' : 'error',
        durationMs: task.durationMs || 0,
        tokenUsage: task.tokensUsed || 0
      },
      selfReport: task.result ? {
        summary: task.result.slice(0, 200),
        confidence: 'medium' as const,
        anomalies: []
      } : undefined
    };
    
    node.selfReport!.anomalies = analyzeAnomalies(node);
    
    const logLine = JSON.stringify(node) + '\n';
    await Bun.file(NODE_LOG_FILE).writer().write(logLine);
  }
};
```

### 3.5 Manifest-Driven Clerk (MDC) — OpenCode 实现

MDC 通过 `messages.transform` 全量替换 System Messages，将清单摘要注入:

```typescript
// .opencode/plugins/ghw-mdc.ts
import { Plugin, TransformContext, Message } from 'oh-my-opencode';

const MANIFEST_FILE = 'court-manifest.json';

interface ManifestPhase {
  allowed_tools: string[];
  skill_summaries: Record<string, string>;
  mcp_visibility?: string[];
}

interface CourtManifest {
  task_id: string;
  phases: {
    current: string;
    definitions: Record<string, ManifestPhase>;
  };
  global_rules: string[];
}

async function loadManifest(): Promise<CourtManifest | null> {
  try {
    const content = await Bun.file(MANIFEST_FILE).text();
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildManifestSystem(manifest: CourtManifest): string {
  const currentPhase = manifest.phases.definitions[manifest.phases.current];
  
  if (!currentPhase) {
    return '';
  }
  
  const parts: string[] = [
    `## Court Manifest (阶段: ${manifest.phases.current})`,
    '',
    '### 允许工具',
    currentPhase.allowed_tools.join(', '),
    '',
    '### Skill 摘要'
  ];
  
  for (const [skill, summary] of Object.entries(currentPhase.skill_summaries)) {
    parts.push(`- ${skill}: ${summary}`);
  }
  
  if (manifest.global_rules.length > 0) {
    parts.push('', '### 全局规则');
    for (const rule of manifest.global_rules) {
      parts.push(`- ${rule}`);
    }
  }
  
  return parts.join('\n');
}

export const ghwMDCPlugin: Plugin = {
  name: 'ghw-mdc',
  
  messagesTransform: async (messages: Message[], ctx: TransformContext): Promise<Message[]> => {
    const manifest = await loadManifest();
    
    if (!manifest) {
      return messages;
    }
    
    const manifestSystem = buildManifestSystem(manifest);
    
    if (!manifestSystem) {
      return messages;
    }
    
    const systemIndex = messages.findIndex(m => m.role === 'system');
    
    if (systemIndex >= 0) {
      messages[systemIndex] = {
        ...messages[systemIndex],
        content: messages[systemIndex].content + '\n\n' + manifestSystem
      };
    }
    
    return messages;
  }
};
```

---

## 4. OpenCode 优势分析

### 4.1 相比 Claude Code 的优势

**messages.transform vs Prompt Prefix**:

CC 的最佳上下文注入方案是 Prompt Prefix，该方法将额外内容追加到 System Prompt 末尾。问题在于:

1. 无法替换已有内容，只能追加
2. 累积导致 System Prompt 膨胀
3. 无法精确控制注入位置

OpenCode 的 `messages.transform` 允许:

```typescript
// 精确定位并替换 System Message
const systemIndex = messages.findIndex(m => m.role === 'system');
messages[systemIndex] = {
  ...messages[systemIndex],
  content: newSystemContent  // 完全替换，非追加
};
```

这使得 CAL 的实现更接近 Pi 的 `context` 事件，是 OC 平台最接近 Pi 能力的特性。

**Plugin 架构 vs Hook 命令**:

CC 的 hooks 是独立进程，通过 stdin/stdout 通信。OpenCode 的 Plugin 是同进程函数调用，性能更好且调试更方便。

### 4.2 相比 Pi Extension 的局限

**无法直接 spawn agents**:

Pi Extension 可以通过 `agent.start` 直接启动子 Agent。OpenCode 的 Plugin 只能返回 `injectPrompt` 字符串，由主 Agent 决定是否调用 `task()` 函数。这意味着史官触发依赖主 Agent 的配合，无法强制执行。

**experimental API**:

OpenCode 的 Plugin API 标注为 `experimental`，稳定性可能不如 Pi 的成熟 API。

**缺少 session_before_compact**:

Pi 的 `session_before_compact` 钩子允许在上下文压缩前执行深审。OpenCode 无此机制，L3 终局审查无法实现。

---

## 5. 配置文件

### 5.1 oh-my-opencode.json

```json
{
  "plugins": [
    "./.opencode/plugins/ghw-cal.ts",
    "./.opencode/plugins/ghw-graded-gate.ts",
    "./.opencode/plugins/ghw-fact-packet.ts",
    "./.opencode/plugins/ghw-objective-node.ts",
    "./.opencode/plugins/ghw-mdc.ts"
  ],
  "agents": {
    "historian": {
      "prompt": "./.opencode/agents/historian.md",
      "description": "GHW Historian — 执行分级审查、记录事件、返回进言",
      "mode": "subagent",
      "hidden": true
    },
    "minister": {
      "prompt": "./.opencode/agents/minister.md",
      "description": "GHW Minister — 中间管理层，可继续 delegate",
      "mode": "subagent"
    }
  },
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "bun run src/hooks/historian-trigger.ts"
      }
    ]
  }
}
```

### 5.2 CC Hook 桥接

`createClaudeCodeHooksHook` 函数可将 CC 格式的 hook 命令转换为 OpenCode Plugin 事件:

```typescript
// .opencode/plugins/ghw-bridge.ts
import { Plugin, createClaudeCodeHooksHook } from 'oh-my-opencode';

const historianTriggerHook = createClaudeCodeHooksHook({
  command: 'bun run src/hooks/historian-trigger.ts',
  events: ['stop']
});

export const ghwBridgePlugin: Plugin = {
  name: 'ghw-bridge',
  ...historianTriggerHook
};
```

桥接层让现有 CC Hook 实现可在 OpenCode 中复用，无需重写逻辑。

---

## 6. Agent 定义

### 6.1 史官 Agent

```yaml
---
description: "GHW Historian — 基于事实包执行分级审查、记录事件、返回简洁进言"
mode: subagent
hidden: true
model: anthropic/claude-sonnet-4-20250514
tools:
  read_file: true
  grep: true
  glob: true
---

你是史官 (Historian)，GHW Framework 的审查与记录者。

## 核心职责

1. **分级审查**: 根据事实包评估操作风险
2. **记录摘要**: 将事件追加到编年史
3. **返回进言**: 提供简洁的改进建议

## 输入

从 `.court/packets/fact-{turn_id}.json` 读取事实包。

## 输出格式

```json
{
  "risk_level": "L0|L1|L2|L3",
  "advice": "简洁进言 (50字以内)",
  "record": "追加到 chronicle.md 的摘要"
}
```

## 执行流程

1. 读取最新事实包
2. 分析 tool_calls 和 metrics
3. 评估是否需要进言
4. 写入 chronicle.md (如需要)
5. 返回 JSON 格式输出

开始工作。
```

---

## 7. 目录结构

```
.court/                          # 运行时数据
├── cal.json                     # CAL 锚点账本
├── context.md                   # 项目记忆
├── cursor.json                  # 游标状态
├── manifest.json                # Court Manifest
├── gate-state-{session}.json    # 分级闸门状态
├── packets/                     # 事实包
│   └── fact-{seq}.json
└── logs/
    └── objective-nodes.jsonl    # ObjectiveNode 日志

.opencode/
├── agents/
│   ├── historian.md             # 史官 Agent 定义
│   └── minister.md              # 九卿 Agent 定义
└── plugins/
    ├── ghw-cal.ts               # CAL 上下文管理
    ├── ghw-graded-gate.ts       # 分级闸门
    ├── ghw-fact-packet.ts       # 事实包提取
    ├── ghw-objective-node.ts    # 任务元数据
    ├── ghw-mdc.ts               # Manifest 驱动 Clerk
    └── ghw-bridge.ts            # CC Hook 桥接

oh-my-opencode.json              # OpenCode 主配置

src/hooks/                       # 复用 CC Hook 实现
└── historian-trigger.ts
```

---

## 8. 实施建议

### Phase 1: 核心机制

1. 实现 CAL 插件 (`ghw-cal.ts`)，验证 `messages.transform` 替换 System Message
2. 实现分级闸门插件 (`ghw-graded-gate.ts`)，验证 `stop` 事件拦截
3. 配置 `oh-my-opencode.json` 加载插件

### Phase 2: 事实提取

4. 实现事实包插件 (`ghw-fact-packet.ts`)，验证 `toolExecute` 事件捕获
5. 实现 ObjectiveNode 插件 (`ghw-objective-node.ts`)，验证任务完成追踪

### Phase 3: 集成

6. 创建史官 Agent 定义
7. 实现 MDC 插件
8. 配置 CC Hook 桥接 (可选)

---

## 9. 已知限制

| 限制 | 影响 | 缓解 |
|------|------|------|
| Plugin 无法强制 spawn | 史官触发依赖主 Agent 配合 | 通过 `injectPrompt` 提示调用 task() |
| experimental API | 稳定性不确定 | 关注版本更新，及时适配 |
| 无 session_before_compact | L3 终局深审无法实现 | 依赖分级闸门的 L2 审查 |
| 无源头工具限制 | Skill 权限控制依赖约定 | 明确文档约定工具使用规范 |

---

## 10. 总结

OpenCode 平台的 `messages.transform` 钩子是实现修订版 CAL 的关键，其能力更接近 Pi 的 `context` 事件。对比 CC 的 Prompt Prefix 方案，这是显著优势。

分级闸门、事实包、ObjectiveNode 等机制在 OpenCode 中可通过 Plugin 事件实现，但受限于 Plugin 无法直接 spawn agents，史官触发需要主 Agent 配合。

总体而言，OpenCode 是介于 Pi 和 CC 之间的方案，比 CC 更接近 Pi 的能力，但比 Pi 少了些强制执行的手段。

---

(End of file - 约 450 lines)
