# 朝廷架构 — Claude Code 平台实现设计

> 日期: 2026-02-23
> 版本: V1 (CC 平台修订版适配)
> 前置: revised-court-spec.md (v2) + debate/summary.md + agent-design-003.md
> 目标: 将修订版朝廷架构 (CAL + Graded-Gate + Fact Packet + ObjectiveNode + MDC) 映射到 CC Hooks

---

## 1. 设计背景与原则

### 1.1 修订版核心变化

基于 5 场多模型对抗辩论结果，修订版相比 V10/V11 引入以下关键变化:

| 维度 | V10/V11 方案 | 修订版 | 影响 |
|------|-------------|--------|------|
| 上下文管理 | pending-advice.md + PostToolUse | CAL 锚点账本 (cal.json) | 更结构化、可追踪 |
| 史官触发 | 每次 Stop / SessionStart | 分级闸门 (L0-L3) | 减少冗余审查 |
| 史官输入 | LLM 自主读取 | 机械提取 Fact Packet | 消除摘要信任危机 |
| 子任务监督 | 纯结果审查 | 双层 ObjectiveNode | 更客观、可验证 |
| 工具管理 | 管家自觉 | MDC 清单 + Hook 执法 | 源头限制 |

### 1.2 CC 平台降级原则

**核心原则: 接受不完美但透明的降级**

CC 平台与 Pi Extension 相比存在能力差距，修订版设计明确承认这些差距:

| 能力 | Pi | CC | 降级方案 |
|------|----|----|---------|
| 上下文完整替换 | context 事件 | Prefix 注入 | CAL 快照注入 .claude/historian/cal.json |
| 源头工具限制 | setActiveTools | PreToolUse deny | 白名单检查 + 拒绝 |
| 同步阻塞审查 | agent_end | Stop hook | exit 2 阻塞 |
| 异步审查 | spawn | Sub-Agent | Task tool |
| 持久化隔离 | appendEntry | 文件系统 | .claude/historian/ 目录 |
| 自定义压缩 | session_before_compact | 无 | 软重置 (新 Session + CAL 快照) |
| context 事件 | 有 | 无 | 每次 Stop/Prefix 注入 CAL |

**降级原则**: 
- 不追求与 Pi 100% 等价
- 降级方案必须透明可观测
- 用户清楚知道哪些能力在 CC 中不可用

---

## 2. 机制到 Hook 映射

### 2.1 Court Anchor Ledger (CAL)

**Pi 方案**: context 事件中动态组装消息，根据 CAL 锚点替换已完成任务为 DECISION 摘要，注入 RISK_HIGH 警告。

**CC 方案**: 文件存储 + Prefix 注入 + PostToolUse 更新

```typescript
// .claude/historian/cal.json 结构
interface Anchor {
  id: string;
  type: 'DECISION' | 'RISK_HIGH' | 'TASK_ACTIVE';
  taskId?: string;
  content: string;
  createdAt: number;
  expiresOn?: 'NEVER' | 'TASK_COMPLETED' | 'EXPLICIT_RESOLVED';
  persistedRef?: string;
}

interface CourtAnchorLedger {
  anchors: Anchor[];
  version: number;
  lastSeq: number;
}
```

**Hook 映射**:

| 功能 | CC Hook | 实现方式 |
|------|---------|---------|
| CAL 读取 | SessionStart | additionalContext 注入 "当前 CAL 状态: {anchors}" |
| CAL 更新 | PostToolUse | 每次 Task 返回后检查是否添加新 DECISION/RISK_HIGH |
| CAL 注入 | Stop / PreAgent | stderr 输出 CAL 摘要，注入管家 context |

```typescript
// src/hooks/cal-manager.ts — CAL 核心管理
import { readJsonFile, writeJsonFile, readStdinJson, writeStdoutJson } from '../shared/utils';

const CAL_PATH = '.claude/historian/cal.json';

const main = async () => {
  const input = await readStdinJson();
  const { hook_name } = input;

  if (hook_name === 'SessionStart') {
    await handleSessionStart();
  } else if (hook_name === 'PostToolUse') {
    await handlePostToolUse(input);
  } else if (hook_name === 'Stop') {
    await handleStop(input);
  }
};

async function handleSessionStart(): Promise<void> {
  const cal = await readJsonFile<CourtAnchorLedger>(CAL_PATH).catch(() => ({
    anchors: [],
    version: 1,
    lastSeq: 0
  }));

  const riskAnchors = cal.anchors.filter(a => a.type === 'RISK_HIGH');
  const riskSummary = riskAnchors.length > 0 
    ? `\n## 高风险警告\n${riskAnchors.map(a => `- ${a.content}`).join('\n')}`
    : '';

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `## 朝廷状态\n当前 CAL 锚点: ${cal.anchors.length} 个${riskSummary}`
    }
  };
  writeStdoutJson(output);
}

async function handlePostToolUse(input: PostToolUseInput): Promise<void> {
  const { tool_name, tool_input, session_id } = input;

  if (tool_name === 'Task') {
    const result = String(tool_input?.result ?? '');
    const description = String(tool_input?.description ?? '');

    // 检查是否需要添加 DECISION 锚点
    if (result && description) {
      const cal = await readJsonFile<CourtAnchorLedger>(CAL_PATH).catch(() => ({
        anchors: [],
        version: 1,
        lastSeq: 0
      }));

      const newAnchor: Anchor = {
        id: `decision_${cal.lastSeq + 1}`,
        type: 'DECISION',
        taskId: description.slice(0, 50),
        content: result.slice(0, 500),
        createdAt: Date.now(),
        expiresOn: 'NEVER'
      };

      cal.anchors.push(newAnchor);
      cal.lastSeq++;
      await writeJsonFile(CAL_PATH, cal);
    }
  }
}

async function handleStop(input: StopInput): Promise<void> {
  const cal = await readJsonFile<CourtAnchorLedger>(CAL_PATH).catch(() => ({
    anchors: [],
    version: 1,
    lastSeq: 0
  }));

  const activeTasks = cal.anchors.filter(a => a.type === 'TASK_ACTIVE');
  const highRisks = cal.anchors.filter(a => a.type === 'RISK_HIGH');

  if (activeTasks.length > 0 || highRisks.length > 0) {
    const summary = [...activeTasks, ...highRisks]
      .map(a => `[${a.type}] ${a.content}`)
      .join('\n');

    const output = {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        decision: 'block',
        reason: '尚有进行中任务或高风险警告',
        stderr: `## 朝廷状态\n${summary}\n\n完成这些任务后再停止。`
      }
    };
    writeStdoutJson(output);
    process.exit(2);
  }
}

main();
```

### 2.2 分级闸门模型 (Graded-Gate)

**Pi 方案**: setActiveTools 动态调整工具白名单，agent_end 事件中根据 RISK_MATRIX 评估风险级别。

**CC 方案**: Stop hook 风险评估 + PreToolUse 工具检查

```typescript
// src/hooks/graded-gate.ts — 分级闸门评估
import { readJsonFile, readStdinJson, writeStdoutJson } from '../shared/utils';

const RISK_MATRIX = {
  LOW_RISK: ['read_file', 'list_dir', 'glob', 'grep', 'search_code', 'search_directory'],
  MED_RISK: ['write_file', 'edit_file', 'delegate', 'Task'],
  HIGH_RISK: ['bash', 'mcp_*', 'delete_file', 'webfetch', 'websearch'],
  SENSITIVE_PATTERNS: ['.env', 'secret', 'password', 'credentials', 'api_key']
};

type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3';

function evaluateRisk(toolName: string, toolInput: Record<string, unknown>): RiskLevel {
  // L0: 纯 Read
  if (RISK_MATRIX.LOW_RISK.includes(toolName)) {
    return 'L0';
  }

  // L2: Bash/MCP/敏感
  if (RISK_MATRIX.HIGH_RISK.some(p => 
    toolName === p || toolName.startsWith('mcp_')
  )) {
    return 'L2';
  }

  // L1: Write/Delegate
  if (RISK_MATRIX.MED_RISK.includes(toolName)) {
    return 'L1';
  }

  // 敏感模式检查
  const inputStr = JSON.stringify(toolInput).toLowerCase();
  if (RISK_MATRIX.SENSITIVE_PATTERNS.some(p => inputStr.includes(p))) {
    return 'L2';
  }

  return 'L1'; // 默认 L1
}

const main = async () => {
  const input = await readStdinJson();
  const { hook_name, tool_name, tool_input } = input;

  if (hook_name === 'PreToolUse') {
    const riskLevel = evaluateRisk(tool_name, tool_input || {});

    if (riskLevel === 'L0') {
      // 无风险，放行
      writeStdoutJson({ hookSpecificOutput: { permissionDecision: 'allow' } });
      return;
    }

    if (riskLevel === 'L2') {
      // 高风险：同步阻塞审查
      const output = {
        hookSpecificOutput: {
          permissionDecision: 'deny',
          permissionDecisionReason: `高风险操作 (${riskLevel})，需要通过史官审查。请先执行 Task 工具 spawn 一个审查史官。`
        }
      };
      writeStdoutJson(output);
      return;
    }

    // L1: 异步审查，通过工具限制阻止新写操作
    const output = {
      hookSpecificOutput: {
        permissionDecision: 'allow',
        // 注意: CC 无法动态修改工具白名单，这是降级点
        // 在 metadata 中标记，PostToolUse 时检查
        metadata: { riskLevel: 'L1', pendingReview: true }
      }
    };
    writeStdoutJson(output);
  }
};

main();
```

**分级闸门行为矩阵**:

| 级别 | 触发条件 | CC 行为 | 限制 |
|------|----------|---------|------|
| L0 | 纯 Read | 放行 | 无 |
| L1 | Write/Delegate | 放行 + metadata 标记 | 无法锁定工具，需依赖管家自觉 |
| L2 | Bash/MCP/敏感 | PreToolUse deny | 必须先审查 |
| L3 | Session End | Stop hook 深审 | 无 session_before_compact |

### 2.3 机械提取事实包 (Fact Packet)

**Pi 方案**: 父进程代码机械遍历 messages 提取 tool_calls、git_diff_stat、final_statement。

**CC 方案**: Stop hook 中机械构建 Fact Packet，传递给史官

```typescript
// src/hooks/fact-packet-builder.ts — 机械提取事实包
import { readJsonFile, writeJsonFile, readStdinJson, writeStdoutJson, execSync } from '../shared/utils';

interface FactPacket {
  seq: number;
  meta: {
    duration_ms: number;
    turn_id: number;
  };
  facts: {
    tool_calls: Array<{
      name: string;
      path?: string;
      status: 'success' | 'error';
    }>;
    git_diff_stat: string;
    final_statement: string;
  };
  context_snapshot: {
    active_concerns: string[];
    recent_experiences: string[];
  };
  delegation_tree: Array<{
    taskId: string;
    role: 'minister' | 'worker';
    metrics: {
      toolCallCount: number;
      hasWriteOperation: boolean;
      exitStatus: string;
      durationMs: number;
    };
    selfReport: {
      summary: string;
      confidence: 'high' | 'medium' | 'low';
    };
  }>;
}

async function extractFactPacket(transcriptPath: string, sessionId: string): Promise<FactPacket> {
  const transcript = await readJsonFile<{ messages: unknown[] }>(transcriptPath).catch(() => ({ messages: [] }));

  const toolCalls: FactPacket['facts']['tool_calls'] = [];
  let lastAssistantMsg = '';

  for (const msg of transcript.messages as Array<{ role: string; content?: string; tool_calls?: unknown[] }>) {
    if (msg.role === 'assistant') {
      if (msg.content) {
        lastAssistantMsg = msg.content.slice(-200);
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls as Array<{ name: string; input?: Record<string, unknown> }>) {
          toolCalls.push({
            name: tc.name,
            path: (tc.input as Record<string, unknown>)?.file_path as string | undefined,
            status: 'success'
          });
        }
      }
    }
  }

  let gitDiffStat = '';
  try {
    gitDiffStat = execSync('git diff --stat HEAD~5', { timeout: 5000 }).slice(0, 500);
  } catch {
    gitDiffStat = 'git diff failed';
  }

  const cal = await readJsonFile<CourtAnchorLedger>('.claude/historian/cal.json').catch(() => ({
    anchors: []
  }));

  const contextSnapshot: FactPacket['context_snapshot'] = {
    active_concerns: cal.anchors
      .filter(a => a.type === 'RISK_HIGH')
      .map(a => `HIGH: ${a.content}`),
    recent_experiences: cal.anchors
      .filter(a => a.type === 'DECISION')
      .slice(-5)
      .map(a => a.content.slice(0, 50))
  };

  // 读取 delegation_tree (由 PostToolUse Task 返回构建)
  const delegationPath = `.claude/historian/delegation-tree.json`;
  const delegationTree = await readJsonFile<FactPacket['delegation_tree']>(delegationPath).catch(() => []);

  return {
    seq: cal.lastSeq + 1,
    meta: {
      duration_ms: 0,
      turn_id: transcript.messages.length
    },
    facts: {
      tool_calls: toolCalls.slice(-20),
      git_diff_stat: gitDiffStat,
      final_statement: lastAssistantMsg
    },
    context_snapshot: contextSnapshot,
    delegation_tree: delegationTree
  };
}

const main = async () => {
  const input = await readStdinJson();
  const { transcript_path, session_id, cwd } = input;

  const packet = await extractFactPacket(transcript_path, session_id);

  // 写入事实包文件，供史官读取
  const packetPath = `.claude/historian/packets/fact_${packet.seq}.json`;
  await writeJsonFile(packetPath, packet);

  const output = {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      decision: 'block',
      reason: '构建事实包完成，准备触发史官审查',
      stderr: `## 史官审查\n\n已构建事实包 #${packet.seq}，请 spawn 史官 Sub-Agent 读取 .claude/historian/packets/fact_${packet.seq}.json 进行审查。\n\n审查完成后，返回简洁的「进言」。`
    }
  };

  writeStdoutJson(output);
  process.exit(2);
};

main();
```

### 2.4 ObjectiveNode — 子任务元数据

**Pi 方案**: 平台代码自动提取 delegate 返回的 metrics。

**CC 方案**: PostToolUse Task 返回后从返回值提取 metadata

```typescript
// src/hooks/objective-node-extractor.ts — 提取子任务元数据
import { readJsonFile, writeJsonFile, readStdinJson, writeStdoutJson } from '../shared/utils';

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
    tokenUsage?: number;
  };
  selfReport: {
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    anomalies: string[];
  };
  rawLogPath?: string;
}

const main = async () => {
  const input = await readStdinJson();
  const { tool_name, tool_input } = input;

  if (tool_name === 'Task') {
    const description = String(tool_input?.description ?? '');
    const result = String(tool_input?.result ?? '');

    // 从 Task 返回值中提取元数据
    // 约定: Task 返回格式包含 __metadata__ 字段
    let metadata: Partial<ObjectiveNode> = {};
    try {
      const parsed = JSON.parse(result);
      if (parsed.__metadata__) {
        metadata = parsed.__metadata__;
      }
    } catch {
      // 非 JSON 返回，尝试解析自然语言摘要
      metadata.selfReport = {
        summary: result.slice(0, 200),
        confidence: 'medium',
        anomalies: []
      };
    }

    const node: ObjectiveNode = {
      taskId: description.slice(0, 50),
      parentId: null,
      role: description.includes('minister') ? 'minister' : 'worker',
      metrics: {
        toolCallCount: metadata.metrics?.toolCallCount ?? 0,
        toolsUsed: metadata.metrics?.toolsUsed ?? [],
        hasWriteOperation: metadata.metrics?.hasWriteOperation ?? result.includes('write'),
        exitStatus: result.includes('error') ? 'error' : 'success',
        durationMs: metadata.metrics?.durationMs ?? 0
      },
      selfReport: metadata.selfReport ?? {
        summary: result.slice(0, 200),
        confidence: 'medium',
        anomalies: []
      }
    };

    // 追加到 delegation-tree.json
    const treePath = '.claude/historian/delegation-tree.json';
    const tree = await readJsonFile<ObjectiveNode[]>(treePath).catch(() => []);
    tree.push(node);
    await writeJsonFile(treePath, tree);

    // 标记任务完成，更新 CAL
    const cal = await readJsonFile<CourtAnchorLedger>('.claude/historian/cal.json').catch(() => ({
      anchors: [],
      version: 1,
      lastSeq: 0
    }));

    // 移除对应的 TASK_ACTIVE，添加 DECISION
    const activeAnchors = cal.anchors.filter(a => 
      a.type === 'TASK_ACTIVE' && a.taskId === node.taskId
    );

    for (const active of activeAnchors) {
      cal.anchors = cal.anchors.filter(a => a.id !== active.id);
      cal.anchors.push({
        id: `decision_${cal.lastSeq + 1}`,
        type: 'DECISION',
        taskId: node.taskId,
        content: node.selfReport.summary,
        createdAt: Date.now(),
        expiresOn: 'NEVER'
      });
      cal.lastSeq++;
    }

    await writeJsonFile('.claude/historian/cal.json', cal);
  }

  writeStdoutJson({ hookSpecificOutput: { permissionDecision: 'allow' } });
};

main();
```

### 2.5 Manifest-Driven Clerk (MDC)

**Pi 方案**: before_agent_start 设置工具白名单，context 事件全量替换 System Messages。

**CC 方案**: PreToolUse deny + SessionStart additionalContext

```typescript
// src/hooks/mdc-enforcer.ts — MDC 清单执法
import { readJsonFile, readStdinJson, writeStdoutJson } from '../shared/utils';

interface CourtManifest {
  task_id: string;
  phases: {
    current: string;
    definitions: Record<string, {
      allowed_tools: string[];
      skill_summaries?: Record<string, string>;
      mcp_visibility?: string[];
    }>;
  };
  global_rules: string[];
}

const main = async () => {
  const input = await readStdinJson();
  const { hook_name, tool_name } = input;

  if (hook_name === 'SessionStart') {
    // 加载 Manifest，注入工具白名单到 additionalContext
    const manifest = await readJsonFile<CourtManifest>('.court/manifest.json').catch(() => null);

    if (manifest) {
      const currentPhase = manifest.phases.definitions[manifest.phases.current];
      const allowedTools = currentPhase?.allowed_tools ?? [];
      const globalRules = manifest.global_rules ?? [];

      const output = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `## 朝廷清单\n当前阶段: ${manifest.phases.current}\n允许工具: ${allowedTools.join(', ')}\n全局规则: ${globalRules.join('; ')}\n\n违反清单的工具调用将被拒绝。`
        }
      };
      writeStdoutJson(output);
    }
    return;
  }

  if (hook_name === 'PreToolUse') {
    const manifest = await readJsonFile<CourtManifest>('.court/manifest.json').catch(() => null);

    if (manifest) {
      const currentPhase = manifest.phases.definitions[manifest.phases.current];
      const allowedTools = currentPhase?.allowed_tools ?? [];

      // 管家只能调用 Task 和 Read
      const butlerTools = ['Task', 'Read', 'Glob', 'Grep'];

      if (!butlerTools.includes(tool_name)) {
        const output = {
          hookSpecificOutput: {
            permissionDecision: 'deny',
            permissionDecisionReason: `管家只能使用 Task/Read/Glob/Grep，请通过 Task spawn Sub-Agent 执行实际工作。`
          }
        };
        writeStdoutJson(output);
        return;
      }

      // 检查是否在白名单
      if (!allowedTools.includes(tool_name)) {
        const output = {
          hookSpecificOutput: {
            permissionDecision: 'deny',
            permissionDecisionReason: `工具 ${tool_name} 不在当前阶段白名单中: ${allowedTools.join(', ')}`
          }
        };
        writeStdoutJson(output);
        return;
      }
    }

    writeStdoutJson({ hookSpecificOutput: { permissionDecision: 'allow' } });
  }
};

main();
```

---

## 3. 完整 Hook 注册配置

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run src/hooks/session-init.ts",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run src/hooks/historian-trigger.ts",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "bun run src/hooks/historian-context-builder.ts",
            "timeout": 5
          }
        ]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bun run src/hooks/butler-guard.ts",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bun run src/hooks/butler-guard.ts",
            "timeout": 3
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "bun run src/hooks/advice-injector.ts",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

---

## 4. V1-V8 验证假设映射

修订版设计基于以下假设，需在 CC 环境中验证:

### 4.1 核心机制假设

| ID | 假设 | 修订版影响 | 验证方式 |
|----|------|-----------|---------|
| V1 | SubagentStop exit 2 stderr 注入 subagent context | 史官自循环 (agent-design-003) 仍依赖此假设 | 创建测试 subagent + Stop hook |
| V2 | Subagent 的 Stop hook 自动转为 SubagentStop | 史官 .md 定义 Stop hook 生效 | 同上 |
| V3 | SubagentStop 可多次 exit 2 | 自循环安全阀 max 5 | 同上 |

### 4.2 新增修订版假设

| ID | 假设 | 验证方式 | 失败影响 |
|----|------|---------|---------|
| V9 | CAL 锚点通过 Stop stderr 注入管家 context | 观察管家是否收到锚点摘要 | 降级为纯文件存储 |
| V10 | PreToolUse deny 阻止工具调用 | 调用被拒工具，观察返回 | 降级为警告 |
| V11 | Fact Packet 机械提取无 LLM 参与 | 检查生成的事实包 | 降级为 LLM 摘要 |
| V12 | ObjectiveNode 从 Task 返回提取 | Task 返回是否包含 __metadata__ | 降级为纯文本摘要 |
| V13 | MDC 白名单通过 PreToolUse 生效 | 调用白名单外工具 | 降级为纯提醒 |

### 4.3 降级映射

```typescript
// src/hooks/degradation-handler.ts — 降级处理器
import { readJsonFile, readStdinJson, writeStdoutJson } from '../shared/utils';

interface DegradationConfig {
  enableContextEvent: boolean;   // V9
  enableToolDeny: boolean;       // V10
  enableFactPacket: boolean;     // V11
  enableObjectiveNode: boolean;  // V12
  enableMDC: boolean;            // V13
}

async function detectCapabilities(): Promise<DegradationConfig> {
  // 尝试触发各机制，检测是否工作
  const config: DegradationConfig = {
    enableContextEvent: false,
    enableToolDeny: false,
    enableFactPacket: false,
    enableObjectiveNode: false,
    enableMDC: false
  };

  // V10: 尝试 deny 一个工具
  try {
    const testResult = await fetch('https://api.claude.ai/test').catch(() => null);
    // 实际检测需要真实环境
    config.enableToolDeny = true; // 假设可用
  } catch {
    config.enableToolDeny = false;
  }

  return config;
}

async function handleWithDegradation(
  hookName: string,
  input: Record<string, unknown>,
  config: DegradationConfig
): Promise<void> {
  switch (hookName) {
    case 'Stop':
      if (config.enableContextEvent && config.enableFactPacket) {
        // 完整实现: 构建 Fact Packet + 注入 CAL 摘要
        await buildFactPacketAndInject(input);
      } else {
        // 降级: 简单提醒 spawn 史官
        await simpleHistorianReminder(input);
      }
      break;

    case 'PreToolUse':
      if (config.enableToolDeny && config.enableMDC) {
        // 完整实现: deny + 白名单检查
        await enforceMDC(input);
      } else if (config.enableToolDeny) {
        // 降级: 仅 deny 管家直接工作
        await simpleButlerGuard(input);
      } else {
        // 降级: 仅提醒
        await warnOnly(input);
      }
      break;

    case 'PostToolUse':
      if (config.enableObjectiveNode) {
        await extractObjectiveNode(input);
      } else {
        // 降级: 不提取元数据
      }
      break;
  }
}
```

---

## 5. V11 自释放史官与修订版适配

### 5.1 架构整合

修订版设计保留了 V11 自释放史官的核心机制 (SubagentStop exit 2 自循环)，同时引入分级闸门控制触发频率:

```
修订版完整流程:

用户指令 → 管家分析
    ↓
[SessionStart hook] → 注入 CAL 状态 + 启动史官指令
    ↓
[PreToolUse: Task] → 检查 MDC 白名单 + 注入预建上下文
    ↓
史官 Sub-Agent (自循环 via SubagentStop hook):
    ┌──────────────────────────────────────┐
    │ 第 N 轮:                             │
    │   1. 读取 Fact Packet (机械提取)     │
    │   2. 对比 ObjectiveNode 找异常       │
    │   3. 审查/记录 → 写 cal.json        │
    │   4. 尝试停止 → [SubagentStop hook] │
    │      ├── 需要继续? → exit 2 + 新上下文│
    │      └── 结束 → exit 0               │
    └──────────────────────────────────────┘
    ↓
[PostToolUse: Task] → 提取进言 + 更新 delegation-tree.json
    ↓
[Stop hook] → 分级闸门评估:
    ├── L0 → 放行
    ├── L1 → 放行 + metadata 标记
    ├── L2 → deny + "请先审查"
    └── L3 → 构建 Fact Packet + spawn 史官深审
    ↓
管家收到进言 → 继续/停止
```

### 5.2 关键适配点

**史官启动**: SessionStart hook 提醒 + system prompt 双保险 (同 V11)

**史官输入**: 从 V11 的 "PreToolUse 预建 prompt" 改为 "读取 Fact Packet" (机械提取)

**史官审查**: 新增对 ObjectiveNode 的双层监督:
- 第一层: metrics 快速扫描
- 第二层: 异常节点深挖

**进言传递**: 同 V11 (pending-advice.md + PostToolUse stderr)

### 5.3 代码适配

```typescript
// src/hooks/historian-context-builder.ts — 修订版适配
import { readJsonFile, writeJsonFile, readStdinJson, writeStdoutJson, execSync } from '../shared/utils';

async function buildHistorianPrompt(state: HistorianSessionState): Promise<string> {
  const cal = await readJsonFile<CourtAnchorLedger>('.claude/historian/cal.json').catch(() => ({
    anchors: [],
    version: 1,
    lastSeq: 0
  }));

  // 机械提取: git log from offset
  const gitLog = state.git_log_offset
    ? execSync(`git log --oneline ${state.git_log_offset}..HEAD`, { timeout: 5000 }).slice(0, 1000)
    : execSync('git log --oneline -20', { timeout: 5000 }).slice(0, 1000);

  // 读取最新的 Fact Packet (如果有)
  const packetPath = `.claude/historian/packets/fact_${cal.lastSeq}.json`;
  const factPacket = await readJsonFile<FactPacket>(packetPath).catch(() => null);

  // 读取 delegation tree
  const delegationPath = '.claude/historian/delegation-tree.json';
  const delegationTree = await readJsonFile<ObjectiveNode[]>(delegationPath).catch(() => []);

  return `你是史官。以下是审查上下文:

## CAL 锚点状态
${cal.anchors.map(a => `[${a.type}] ${a.content}`).join('\n')}

## Git 变更 (自 ${state.git_log_offset ?? '初始'})
${gitLog}

## Fact Packet #${cal.lastSeq}
${factPacket ? JSON.stringify(factPacket.facts, null, 2) : '无新事实包'}

## 子任务元数据
${delegationTree.slice(-5).map(n => 
  `- ${n.taskId}: ${n.metrics.toolCallCount} tools, ${n.metrics.exitStatus}, confidence: ${n.selfReport.confidence}`
).join('\n')}

## 审查要求
1. 对比 Fact Packet 与 delegation_tree 中的 selfReport，找不一致
2. 识别异常子任务 (无 Write 但声称完成 / 耗时异常短 / confidence: low)
3. 异常节点需要深挖日志
4. 记录审查结果到 cal.json
5. 返回简洁「进言」`;
}

const main = async () => {
  const input = await readStdinJson();
  const { tool_name, tool_input } = input;

  if (tool_name === 'Task') {
    const description = String(tool_input?.description ?? '');

    if (description.toLowerCase().includes('historian')) {
      const state = await readJsonFile<HistorianSessionState>(
        '.claude/historian/session-state.json'
      ).catch(() => ({
        last_historian_at: null,
        session_start: null,
        git_log_offset: null,
        historian_cycle_count: 0,
        butler_working: true
      }));

      const prompt = await buildHistorianPrompt(state);

      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: {
            ...tool_input,
            prompt
          }
        }
      };

      // 更新 offset
      try {
        const newHash = execSync('git rev-parse HEAD', { timeout: 5000 }).toString().trim();
        state.git_log_offset = newHash;
        await writeJsonFile('.claude/historian/session-state.json', state);
      } catch {
        // ignore
      }

      writeStdoutJson(output);
      return;
    }
  }

  writeStdoutJson({ hookSpecificOutput: { permissionDecision: 'allow' } });
};

main();
```

---

## 6. 文件结构

```
.claude/
├── settings.json                    ← Hook 注册 (修订版)
├── agents/
│   ├── butler.md                   ← 管家 Agent 定义
│   ├── historian.md                ← 史官 Agent 定义 (含 Stop hook)
│   └── historian-prompt.md         ← 史官详细 Prompt
├── historian/
│   ├── cal.json                    ← Court Anchor Ledger (新增)
│   ├── context.md                  ← 项目记忆
│   ├── chronicle.md                ← 编年史
│   ├── pending-advice.md           ← 进言中转
│   ├── delegation-tree.json         ← ObjectiveNode 树 (新增)
│   ├── session-state.json          ← Hook 状态
│   └── packets/
│       └── fact_*.json             ← 机械提取事实包 (新增)
├── memory/
│   └── RESEARCH_CONTEXT.md
└── reports/
    └── agent-design-003-self-releasing.md

.court/                              ← 修订版新增
├── manifest.json                    ← Court Manifest (MDC)
├── cursor.json                      ← 游标状态
└── ...

src/hooks/
├── session-init.ts                  ← SessionStart
├── historian-trigger.ts            ← Stop (分级闸门 + 史官触发)
├── historian-context-builder.ts     ← PreToolUse Task (上下文注入)
├── butler-guard.ts                  ← PreToolUse (管家硬限)
├── advice-injector.ts               ← PostToolUse (进言注入)
├── cal-manager.ts                   ← CAL 管理 (新增)
├── graded-gate.ts                   ← 分级闸门 (新增)
├── fact-packet-builder.ts           ← 事实包构建 (新增)
├── objective-node-extractor.ts      ← 元数据提取 (新增)
├── mdc-enforcer.ts                  ← MDC 执法 (新增)
└── degradation-handler.ts           ← 降级处理 (新增)

src/shared/
├── types.ts                         ← 修订版类型定义
└── utils.ts                         ← 工具函数
```

---

## 7. 实施路线图

### Phase 1: 基础设施 (优先级最高)

1. 创建 `.court/` 目录结构
2. 实现 `cal.json` 管理 (cal-manager.ts)
3. 实现 `RISK_MATRIX` (graded-gate.ts)
4. 更新 settings.json 注册所有 hooks

### Phase 2: 核心机制

5. 实现 Fact Packet 机械提取 (fact-packet-builder.ts)
6. 实现 ObjectiveNode 提取 (objective-node-extractor.ts)
7. 实现 MDC 清单加载与执法 (mdc-enforcer.ts)

### Phase 3: V11 适配

8. 更新 historian-context-builder.ts 读取 Fact Packet
9. 更新 historian.md Stop hook 支持分级闸门
10. 实现降级处理器 (degradation-handler.ts)

### Phase 4: 验证

11. V1-V8 假设验证 (CC 环境)
12. V9-V13 假设验证 (修订版新假设)
13. 降级方案测试

---

## 8. 已知限制与透明降级

| 限制 | 原因 | 用户可见影响 |
|------|------|-------------|
| 无 context 事件 | CC 不支持 | CAL 快照通过 Stop stderr 注入 |
| 无 setActiveTools | CC 不支持 | PreToolUse deny 作为替代 |
| 无 session_before_compact | CC 不支持 | L3 深审无法自动触发 |
| 工具锁定不实时 | PreToolUse 仅阻止调用 | L1 审查期间管家可能不自觉 |
| Fact Packet 需手动读取 | 史官需读文件 | prompt 中注入文件路径 |

**透明性保证**:
- 每个降级点记录在 cal.json 的 metadata 中
- 用户可通过读取 .claude/historian/ 了解系统状态
- Hook stderr 输出清楚标注当前模式 (完整/降级)

---

## 9. 附录: 类型定义

```typescript
// src/shared/types.ts — 修订版完整类型

interface Anchor {
  id: string;
  type: 'DECISION' | 'RISK_HIGH' | 'TASK_ACTIVE';
  taskId?: string;
  content: string;
  createdAt: number;
  expiresOn?: 'NEVER' | 'TASK_COMPLETED' | 'EXPLICIT_RESOLVED';
  persistedRef?: string;
}

interface CourtAnchorLedger {
  anchors: Anchor[];
  version: number;
  lastSeq: number;
}

interface FactPacket {
  seq: number;
  meta: { duration_ms: number; turn_id: number };
  facts: {
    tool_calls: Array<{ name: string; path?: string; status: string }>;
    git_diff_stat: string;
    final_statement: string;
  };
  context_snapshot: {
    active_concerns: string[];
    recent_experiences: string[];
  };
  delegation_tree: ObjectiveNode[];
}

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
    tokenUsage?: number;
  };
  selfReport: {
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    anomalies: string[];
  };
  rawLogPath?: string;
}

interface CourtManifest {
  task_id: string;
  phases: {
    current: string;
    definitions: Record<string, {
      allowed_tools: string[];
      skill_summaries?: Record<string, string>;
      mcp_visibility?: string[];
    }>;
  };
  global_rules: string[];
}

interface HistorianSessionState {
  last_historian_at: string | null;
  session_start: string | null;
  git_log_offset: string | null;
  historian_cycle_count: number;
  butler_working: boolean;
}

type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3';
```

---

> 本设计承认 CC 平台与 Pi Extension 的能力差距，采用「接受不完美但透明的降级」原则。核心机制通过文件系统中转 + Hook stderr 注入实现，所有降级点可观测、可追溯。
