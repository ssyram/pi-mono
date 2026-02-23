# 辩题 4: 史官子任务监督能力
# Topic 4: Historian Supervision

> 日期: 2026-02-23
> 参与模型: gpt-5.2, claude-sonnet-4-6, kimi-k2.5, qwen3.5-plus
> 评审模型: qwen3.5-plus

---

## 第一轮：初始立场

### Party A — 初始立场 (gpt-5.2)

### 一、核心主张（方 A）

史官**不应该具备对子任务过程的监督能力**；史官应当**仅审查丞相层的决策与最终对外输出**（方案 A）。  
理由不是“做不到”，而是：在 Court Architecture 里，史官的价值来自**独立、零状态、低耦合、低 token 成本**的“终审”；一旦让史官深入 delegate 链条，必然引入“过程偏见”（被中间噪声牵引）、耦合平台差异（Pi/CC/OC 的子任务隔离模型不同）、以及不可控的 token 膨胀，最终侵蚀系统的硬约束与清晰分层。

> 允许的妥协：史官可以在审查丞相输出时，**要求丞相对关键子任务结果进行最小化引用/对照**（但这仍属于“审查丞相决策质量”，而不是“史官直接监督子任务过程”）。这一点可通过丞相的硬编码模板实现，但史官本身不接入子任务日志流。

---

### 二、对三种方案的对比（站在 A 的立场评估）

#### 方案 A：仅审查丞相决策（推荐）
**优点**
- **角色纯净**：史官只对“最终决策与输出”负责，避免被子任务细节污染判断标准。
- **跨平台一致性最高**：Pi/CC/OC 都能稳定拿到“主 agent 的最后输出/决策文本”；不依赖子任务内部可观测性。
- **token 成本最低且可预测**：史官输入固定为“丞相终稿 + 少量元数据”，不会因任务复杂度指数膨胀。
- **硬约束更容易落地**：丞相 read+delegate only；史官 read only；流程简单，失败模式少。

**缺点**
- 史官可能错过“子任务执行中的明显偏差”（比如 worker 误读需求但丞相未察觉）。

> 方 A 的回应：这是“丞相的监督职责”，不应外包给史官。要加强的是丞相的 **delegation contract**（交付格式与校验点），而不是让史官越界。

#### 方案 B：审查丞相决策 + delegate 结果摘要（可作为丞相自证材料，但不提升史官权限）
**优点**
- 能发现“丞相引用子任务结果是否合理”的问题。
- token 成本仍可控（摘要而非全日志）。

**缺点（从方 A 角度）**
- 容易滑向“史官开始以摘要为依据反向指挥子任务”，角色边界变模糊。
- 摘要质量高度依赖丞相/九卿的自述，形成“自证循环”，未必更客观。
- 跨平台虽可做，但需要在 delegate 返回值上做强制格式化，工程复杂度上升。

> 方 A 的立场：可以作为“丞相输出的一部分”，但史官仍然**只审查丞相的输出是否自洽**；史官不应拥有“拉取/追溯子任务细节”的机制。

#### 方案 C：完整监督子任务执行细节（反对）
**问题**
- **平台机制天然不支持实时监督**：Pi 的子进程隔离、CC/OC 的 Sub-Agent 隔离都意味着史官无法可靠介入过程；只能事后拿日志，结果变成“高成本事后审计”。
- **token 成本灾难**：委托链越深，子任务消息越多；把它们喂给史官会让史官变成第二个丞相，甚至更臃肿。
- **破坏架构分层**：史官若能追溯并评判每层执行细节，九卿/丞相的监督职责被架空；系统从“分层委托”退化为“中心化审计”。

---

### 三、方 A 的具体实现方案（Pi 为主，CC/OC 兼容）

下面给出“仅审查丞相决策”的**可落地路径**：核心是让史官的输入严格受控，同时增强丞相对 delegate 的“硬格式交付”。

#### 1）Pi Extension：事件链与数据流

**(a) context 事件：压缩并塑形丞相上下文（不喂史官）**  
- 目标：让丞相在每次 LLM 调用前，context 中只保留“未完成任务 + 当前决策所需证据”。  
- 做法：在 `context` 事件里替换 messages：  
  - 已完成的 delegate 任务用“固定字段摘要块”替代（由丞相写入，见下）。
  - 只保留每个 delegate 的 `result` 与 `verification` 两段，不保留过程对话。
- 这一步的意义：**先控制丞相 token**，避免后续史官审查被迫扩大输入。

**(b) delegate 合同：让九卿/worker 返回强结构结果（让丞相容易自检）**  
- 丞相通过 `before_agent_start` 每轮强化 systemPrompt，硬规定：  
  - 九卿/worker 的交付必须包含：`Goal` / `Actions` / `Result` / `Risks` / `Evidence`（文件路径或关键片段）/ `OpenQuestions`。  
- 丞相只需 read+delegate，但可以在 prompt 中强制“Evidence 必须可被 read 工具验证”。  
- 这样“子任务偏差”主要由丞相在 read 阶段发现，而不是靠史官回看全链。

**(c) agent_end：史官审查触发点只看丞相终稿**  
- 在 `agent_end` 事件 spawn 史官子进程（`spawn("pi", ["--no-session","--mode","json", ...])`），保持零状态。  
- 输入材料严格限定：
  1) 丞相最终输出（对用户的 reply）
  2) 丞相的“决策摘要块”（例如：本轮做了哪些 delegate、采用了哪些 evidence、未解决风险）
  3) 可选：极少量“关键证据引用”（例如 1-3 个文件路径/片段 hash），但不包含 delegate 全量对话

史官输出两类结果：
- `advice_to_user`：对最终输出的风险、遗漏、逻辑矛盾提出修改建议
- `advice_to_chancellor`：提醒下一轮需要补的证据/验证动作（但不直接指挥子任务）

**(d) 双路注入（保持现有）**  
- 用 `sendMessage({deliverAs:"nextTurn"})` 把史官 advice 注入下一轮。  
- 用 `before_agent_start` 将史官 advice 作为 systemPrompt 的“审查意见区块”附加（注意：必须是“意见”而非“命令”，以免史官凌驾丞相）。

**(e) appendEntry：史官记录只做持久化审计，不进入上下文**  
- 史官把审查结论与“发现的问题类型”写入 `appendEntry()`，用于离线评估与回归分析。  
- 不进入 LLM 上下文，避免“史官累积偏见”。

#### 2）CC（Claude Code Hooks V11）适配：保持史官只审查主输出
CC 的优势是 hook 注入强，但 Sub-Agent 完全隔离，过程监督不现实且昂贵。方 A 的做法：

- **SessionStart**：注入“管家/丞相必须按交付合同组织 delegate 输出到一个固定区块（例如 DECISION.md 结构）”。  
- **PostToolUse exit 2 stderr**：当主 agent完成关键 tool（如写文件、delegate 返回）后，把“丞相决策摘要块”注入 context，但仍不注入子任务全日志。  
- **Stop hook exit 2**：确保主 agent 在退出前先生成终稿 + 决策摘要块，然后才允许 stop（这里的自循环是为了“补齐终稿”，不是为了让史官守护子任务）。  
- 史官 daemon（如果使用）只读取最终的 DECISION.md + 最终回答草稿；不介入 Sub-Agent。

#### 3）OC（OpenCode）适配：利用 messages.transform，但同样只塑形终稿输入
- 用 `messages.transform` 在每次 API 调用前把历史 delegate 过程压扁成“丞相决策摘要块”。  
- 用 `createClaudeCodeHooksHook` 复用 CC 的“终稿补齐”逻辑（如果团队已有 CC hook 资产）。  
- OC 的 `task(run_in_background=true)` 可跑一些“证据校验任务”（如 lint/grep），但这属于丞相的验证链，不是史官监督链；史官依旧只看终稿与验证结果摘要。

---

### 四、性能与 Token 成本（方 A 的关键优势）

1) **史官输入上限可硬编码**  
- 固定只喂：终稿 + 决策摘要块（例如 1-2KB）+ 少量证据引用。  
- 不随 delegate 链长度增长，避免 O(N×M) 的消息膨胀（N=层级，M=每层对话轮次）。

2) **并行 tool_use 的收益不被史官抵消**  
- Pi 原生并行 tool_use 的优势在于 worker 并发执行；若史官要看全日志，就必须序列化收集和压缩，抵消并发收益。方案 A 不需要。

3) **压缩点前移到丞相层**  
- 通过 `context` 事件把历史替换成摘要，让主 agent 本身 token 降下来；史官审查成本也随之稳定。

---

### 五、潜在风险与应对（方 A 也承认的问题）

**风险 1：丞相漏检子任务偏差，史官无法从终稿发现**  
- 应对：不是让史官看过程，而是强化“delegation contract + evidence 可验证”。  
  - 要求 worker/九卿给出 `Evidence`（文件路径/命令输出片段）。  
  - 丞相在 read 阶段抽查 1-2 个关键 evidence（仍符合 read+delegate only）。

**风险 2：史官 advice 影响丞相自主性，形成“第二大脑”**  
- 应对：在 `before_agent_start` 注入时，把史官内容标注为“非强制审查意见”；并在丞相 systemPrompt 中硬写“史官不能下达执行指令，只能指出风险与缺口”。

**风险 3：跨平台行为不一致导致审查口径漂移**  
- 应对：统一“决策摘要块”格式（DECISION BLOCK），让三平台都生成同构材料；史官 prompt 只依赖该块与终稿。

---

### 六、结论（方 A 的最终立场）

史官不应拥有子任务监督能力；它的最佳定位是“对丞相最终决策与输出的零状态终审”。  
要提升质量，正确方向是：**把监督责任留在丞相/九卿层，用硬格式交付与 evidence 校验提高可控性**；史官则以低 token、低耦合、跨平台一致的方式，提供稳定的风险提示与遗漏检查。这样 Court Architecture 的分层才不会塌缩成中心化审计系统。

---

### Party B — 初始立场 (kimi-k2.5)

# 方 B：审查丞相决策 + Delegate 结果摘要

## 核心主张

**史官应当具备对 delegate 子任务结果的审查能力，但仅限于"结果摘要"层面，而非实时介入或深度追踪委托链。**

这一立场基于三个关键判断：

1. **信息完整性原则**：丞相的决策质量不仅取决于其自身推理，更取决于下属执行反馈的真实性。若史官仅见丞相"下令"而不见"结果"，则无法判断丞相是否被蒙蔽或是否存在系统性执行偏差。

2. **平台约束现实**：Pi/OC/CC 均不支持子进程与外部监督者的实时通信通道，强行追求实时监督将引入复杂的基础设施（如共享内存、消息队列），违背"硬编码约束优先"的设计原则。

3. **角色边界清晰**：史官仍保持"事后审查者"定位，不介入执行流程，不改变九卿/工人的工具权限，仅通过阅读丞相已接收的 delegate 返回值行使监督权。

---

## 技术实现方案（Pi Extension 为主）

### 架构调整

```
┌─────────────────────────────────────────┐
│           丞相 (Chancellor)              │
│    read + delegate (setActiveTools)      │
│         PI_COURT_ROLE=chancellor         │
└─────────────┬───────────────────────────┘
              │ delegate spawn
              ▼
┌─────────────────────────────────────────┐     ┌─────────────────┐
│        九卿/工人 (Minister/Worker)       │◄────│ 史官审查范围扩展  │
│   完整工具集 / 无 delegate (worker)      │     │  （新增：读取     │
│         --no-session --mode json         │     │   delegate 结果） │
└─────────────────────────────────────────┘     └─────────────────┘
                                                        ▲
┌─────────────────────────────────────────┐             │
│           史官 (Historian)               │─────────────┘
│   read only + 新增：解析 delegate 结果    │
│   agent_end 触发，零状态子进程            │
│   通过 messages 提取子任务返回值          │
└─────────────────────────────────────────┘
```

### 关键机制实现

#### 1. Delegate 结果的标准化封装

丞相在调用 `delegate` 时，要求子进程返回结构化数据：

```typescript
// 子进程（九卿/工人）的返回格式
interface DelegateResult {
  // 基础信息
  taskId: string;
  role: 'minister' | 'worker';
  delegatedBy: string; // 上级标识
  
  // 执行摘要（受 token 限制）
  summary: {
    objective: string;      // 任务目标
    approach: string;       // 采用方法（50字内）
    outcome: 'success' | 'partial' | 'failure';
    keyFindings: string[];  // 最多3条关键发现
    anomalies?: string[];   // 异常标记（供史官重点审查）
  };
  
  // 完整输出（可选，受长度限制）
  fullOutput?: string;      // 截断至 2000 tokens
  
  // 元数据
  toolsUsed: string[];
  durationMs: number;
  tokenUsage: { input: number; output: number };
}
```

**硬编码约束**：子进程通过 `--mode json` 强制输出上述结构，非结构化输出视为执行失败。

#### 2. 史官的上下文获取机制

史官在 `agent_end` 触发时，通过 `context` 事件访问本轮完整 messages：

```typescript
// pi-extension 史官 hook
on('agent_end', async ({ session, messages }) => {
  // 提取所有 delegate 结果（来自 tool_use/tool_result 对）
  const delegateResults = extractDelegateResults(messages);
  
  // 构建史官审查上下文
  const reviewContext = buildReviewContext({
    chancellorDecision: extractLastDecision(messages),  // 丞相最终决策
    delegateSummaries: delegateResults.map(r => r.summary), // 子任务摘要
    fullOutputs: delegateResults
      .filter(r => hasAnomaly(r))  // 仅异常任务保留完整输出
      .map(r => ({ taskId: r.taskId, fullOutput: r.fullOutput }))
  });
  
  // spawn 史官子进程进行审查
  const historian = spawn('pi', [
    '--no-session',
    '--mode', 'json',
    '--tools', 'read',  // 严格只读
    '--system-prompt', loadHistorianPrompt(reviewContext)
  ]);
  
  const advice = await historian.getOutput();
  
  // 双路注入（保持现有机制）
  sendMessage({ deliverAs: 'nextTurn', content: advice });
  beforeAgentStart(({ systemPrompt }) => 
    systemPrompt + '\n\n[史官进言]\n' + advice
  );
});
```

#### 3. 上下文压缩策略（Token 控制）

```typescript
function buildReviewContext({ chancellorDecision, delegateSummaries, fullOutputs }) {
  const budget = {
    decision: 800,      // 丞相决策保留
    perSummary: 200,    // 单个子任务摘要
    anomalyDetail: 600, // 异常任务详细输出
    maxSummaries: 5     // 最多审查 5 个子任务
  };
  
  // 优先级排序：含异常 > 九卿 > 工人 > 时间最近
  const prioritized = delegateSummaries.sort((a, b) => 
    (b.anomalies?.length || 0) - (a.anomalies?.length || 0) ||
    (b.role === 'minister' ? 1 : 0) - (a.role === 'minister' ? 1 : 0)
  ).slice(0, budget.maxSummaries);
  
  return {
    chancellorDecision: truncate(chancellorDecision, budget.decision),
    delegateReview: prioritized.map(s => formatSummary(s, budget.perSummary)),
    anomalies: fullOutputs.slice(0, 2).map(f => formatAnomaly(f, budget.anomalyDetail)),
    meta: {
      totalDelegates: delegateSummaries.length,
      reviewedCount: prioritized.length,
      anomalyCount: fullOutputs.length
    }
  };
}
```

---

## 跨平台适配策略

### CC (Claude Code) 适配

CC 的 Sub-Agent 完全隔离，但 `Task` 返回值可通过 hooks 拦截：

```typescript
// CC V11 适配：利用 PostToolUse 捕获 delegate 结果
const ccAdapter = {
  // 在管家（对应丞相）的 PostToolUse hook 中
  onPostToolUse: ({ toolName, result, exit }) => {
    if (toolName !== 'Task') return;
    
    // 将 Task 结果写入 pending-delegate-results.md
    // 史官 daemon 读取此文件进行审查
    appendToFile('pending-delegate-results.md', serialize(result));
    
    // 触发史官审查（通过 SubagentStop exit 2 自循环机制）
    if (shouldTriggerHistorian(result)) {
      stderr.write(JSON.stringify({
        type: 'HISTORIAN_REVIEW_REQUEST',
        taskCount: getPendingDelegateCount()
      }));
      exit(2); // 阻止停止，进入下一轮
    }
  },
  
  // 史官 daemon 的 PreToolUse：预注入 delegate 结果
  onPreToolUse: ({ toolName, input }) => {
    if (toolName === 'Read' && input.file === 'pending-advice.md') {
      // 同时注入 delegate 审查上下文
      const delegateContext = readFile('pending-delegate-results.md');
      input.additional_context = buildHistorianPrompt(delegateContext);
      clearFile('pending-delegate-results.md'); // 原子读清
    }
  }
};
```

**关键差异**：CC 无法像 Pi 那样在单次 `agent_end` 中同步 spawn 史官，需依赖史官 daemon 的自循环机制异步审查。

### OC (OpenCode) 适配

利用 `messages.transform` 的最强注入能力：

```yaml
# .opencode/agents/historian.md
---
name: court-historian
model: claude-sonnet-4-20250514
tools: [read]
hooks:
  messages.transform: |
    # 在每轮 API 调用前，注入 delegate 结果摘要
    ${DELEGATE_SUMMARIES_FROM_PARENT}
  createClaudeCodeHooksHook: true  # 桥接 CC 模式
---

你是一名朝廷史官。审查以下丞相决策及子任务执行摘要...
```

父 Agent（丞相）通过 `task(run_in_background=true)` 启动史官，并通过共享文件传递 delegate 结果：

```typescript
// OC 丞相侧
const historianTask = await task('court-historian', {
  runInBackground: true,
  input: { delegateResultsFile: '/tmp/delegate-snapshot.json' }
});

// 每轮结束后更新快照
writeFile('/tmp/delegate-snapshot.json', JSON.stringify(extractDelegateResults(messages)));
```

---

## 优势分析

### 1. 缺陷检测能力显著提升

| 场景 | 仅审查丞相 (方案A) | 审查+Delegate摘要 (方案B) |
|:---|:---|:---|
| 九卿虚报执行结果 | ❌ 无法发现 | ✅ 交叉验证 summary vs 实际输出 |
| 工人工具使用不当 | ❌ 不可见 | ✅ 通过 `toolsUsed` 元数据标记 |
| 委托链信息丢失 | ❌ 丞相可能遗漏 | ✅ 史官追踪多层级摘要 |
| 系统性执行偏差 | ❌ 需长期累积 | ✅ 单轮即可识别模式异常 |

### 2. Token 成本可控

以典型任务为例（假设 Claude Sonnet 4，$3/$15 per MTok）：

| 项目 | Tokens | 成本 |
|:---|---:|---:|
| 丞相决策上下文 | 2,000 | $0.006 |
| 3× Delegate 摘要（各200 tokens） | 600 | $0.0018 |
| 1× 异常任务详细输出 | 600 | $0.0018 |
| 史官 Prompt + 输出 | 1,500 | $0.0045 |
| **总计** | **4,700** | **~$0.014** |

对比方案C（完整子任务输出）：假设每个子任务 3,000 tokens，3个子任务即 9,000 tokens，成本增至 $0.027，且易触发上下文窗口限制。

### 3. 平台兼容性最优

- 不依赖任何平台的未公开 API
- 不引入外部基础设施（数据库、消息队列）
- Pi/CC/OC 均可通过标准 hook/事件机制实现
- 子进程隔离性保持完整（史官仍为零状态）

---

## 潜在风险与缓解

### 风险1：史官角色膨胀

**表现**：史官开始主动建议"如何改进子任务执行"，而非仅审查丞相决策。

**缓解**：
- System Prompt 硬编码约束："你只向丞相进言，不得评价九卿/工人之执行细节"
- 输出格式强制限定：`{ "adviceToChancellor": "...", "concerns": [...] }`，不含对下级的指令

### 风险2：Delegate 结果篡改

**表现**：丞相过滤或修改子进程返回值后再呈现给史官。

**缓解**：
- Pi：史官直接从 `messages` 数组读取原始 `tool_result`，非经丞相处理
- CC/OC：利用 hook 在工具返回第一时间捕获，绕过丞相干预

### 风险3：摘要信息损失

**表现**：关键细节在 `summary` 压缩中丢失，史官误判。

**缓解**：
- 强制 `anomalies` 字段：子进程必须显式标记不确定/异常之处
- 分级摘要：正常任务 200 tokens，标记异常的可扩展至 800 tokens
- 保留 `fullOutput` 哈希：史官可抽查验证摘要准确性

---

## 结论

方案 B 在**信息完整性**与**系统简洁性**之间取得了最优平衡。它使史官从"形式审查者"升级为"实质监督者"，同时通过严格的摘要机制和 token 预算避免方案 C 的复杂性爆炸。跨平台实现均依赖各平台的原生 hook 能力，无需突破技术边界，符合"硬编码约束优先"的设计原则。

**关键设计决策回顾**：
- ✅ 史官看 delegate 结果，但只看摘要
- ✅ 事后审查，非实时介入
- ✅ 单层委托可见，不追踪完整委托链
- ✅ 异常驱动详细输出，常态保持精简

---

### Party C — 初始立场 (claude-sonnet-4-6)

# 方 C 立场：完整监督含子任务执行细节

## 核心主张

**史官必须看到完整的委托链，否则它的监督是无效的。**

当前方案（方 A）的史官只看丞相的最终决策，这本质上是在审查一份经过层层过滤的摘要报告。九卿如何分解任务、Worker 实际执行了什么、中间出现了哪些异常被静默处理——这些信息都在 delegate 链路中消失了。史官读到的是结果，不是过程。

一个只看结果的监察官，是权贵最喜欢的监察官。

我的主张是：**史官应当具备完整的委托链监督能力**，通过结构化日志聚合而非实时介入来实现，在不阻塞执行路径的前提下，保留完整的可审查性。

---

## 技术实现方案

### 核心机制：结构化执行日志（Structured Execution Log）

方 C 的实现不依赖"实时监控"——那确实不现实，三个平台都不支持子进程间的实时通信。我的方案是**异步日志聚合 + 事后深度审查**，但"事后"不等于"浅层"。

#### Pi Extension 实现

**执行层日志注入**

每个 delegate spawn 的子进程（九卿、Worker）在 `agent_end` 时，将自身的完整执行摘要写入共享日志文件：

```javascript
// 在每个子进程的 agent_end hook 中
agent.on('agent_end', async ({ messages, role, taskId }) => {
  const executionLog = {
    timestamp: Date.now(),
    role: process.env.PI_COURT_ROLE,       // "minister" | "worker"
    taskId: process.env.PI_TASK_ID,
    parentTaskId: process.env.PI_PARENT_TASK_ID,
    depth: parseInt(process.env.PI_DELEGATE_DEPTH || '0'),
    // 提取关键决策点，不是全量 messages
    decisions: extractDecisions(messages),   
    toolCalls: extractToolCalls(messages),   
    anomalies: detectAnomalies(messages),    // 静默失败、重试、降级
    finalResult: extractFinalResult(messages),
    tokenUsed: messages.reduce((sum, m) => sum + estimateTokens(m), 0)
  };
  
  // 原子写入，避免并发冲突
  await atomicAppend('./court-execution-log.jsonl', JSON.stringify(executionLog));
});
```

**丞相层聚合**

丞相的 `agent_end` 触发时，史官 spawn 已经能读到完整的 `.jsonl` 日志文件：

```javascript
// chancellor 的 agent_end 触发史官
agent.on('agent_end', async ({ messages }) => {
  const sessionLog = await readExecutionLog('./court-execution-log.jsonl');
  
  // 构建委托链树状结构
  const delegateTree = buildDelegateTree(sessionLog);
  
  // spawn 史官，传入完整上下文
  const historian = spawn('pi', [
    '--no-session', '--mode', 'json',
    '--tools', 'read',                        // 硬约束：只读
    '--system', buildHistorianPrompt(delegateTree),
    '--input', buildHistorianInput(messages, delegateTree)
  ]);
});
```

**史官收到的输入结构**

```
# 丞相决策摘要
[丞相的 messages 关键节点]

# 完整委托链 (深度优先)
## 任务 T-001 (丞相 → 九卿-财务)
  决策: 分解为3个子任务
  异常: 无
  ## 任务 T-001-A (九卿-财务 → Worker-查账)
    工具调用: read_file × 12, grep × 3
    异常: 文件 budget.xlsx 不存在，降级读取 budget.csv
    结果: 发现Q3支出异常
  ## 任务 T-001-B (九卿-财务 → Worker-报告)
    工具调用: write_file × 1
    异常: 无
    结果: 报告已生成

## 任务 T-002 (丞相 → 九卿-技术)
  ...
```

史官看到的不是原始 messages（那会爆炸），而是**经过结构化提取的执行语义**。

#### CC Hooks 实现

CC 的 Sub-Agent 完全隔离，但 Task 返回值是可控的。

**在 PreToolUse hook 中注入日志指令**

```python
# PreToolUse: 修改 Task prompt，要求子 Agent 在结果中附加执行日志
if tool_name == "Task":
    original_prompt = input["prompt"]
    input["prompt"] = f"""
{original_prompt}

[系统指令] 任务完成后，在返回结果末尾附加以下结构化日志：
<execution_log>
DECISIONS: [关键决策点列表]
TOOL_CALLS: [工具调用摘要]
ANOMALIES: [异常/降级/重试事件]
</execution_log>
"""
    return {"updatedInput": input}
```

**在 PostToolUse hook 中提取并持久化**

```python
# PostToolUse: 从 Task 返回值提取执行日志
if tool_name == "Task":
    log_data = extract_execution_log(result["output"])
    atomic_append("./court-execution-log.jsonl", log_data)
```

**Stop hook 触发史官审查**

```python
# Stop hook: 阻止主 Agent 停止，触发史官
if should_trigger_historian():
    full_log = read_execution_log()
    historian_advice = run_historian_subprocess(full_log)
    write_file("pending-advice.md", historian_advice)
    sys.exit(2)  # 阻止停止，下一轮注入建议
```

#### OC 实现

OC 的 `messages.transform` 是最强注入点：

```typescript
// 在 messages.transform 中，将执行日志注入为 system context
messages.transform = async (messages, context) => {
  if (context.isHistorianReview) {
    const executionLog = await readExecutionLog();
    const delegateTree = buildDelegateTree(executionLog);
    
    // 在 messages 前插入完整委托链上下文
    return [
      { role: 'user', content: buildDelegateTreeContext(delegateTree) },
      ...messages
    ];
  }
  return messages;
};
```

---

## 方 C 的核心优势

### 1. 异常检测能力质变

方 A 的史官只能发现"丞相做了错误决策"。方 C 的史官能发现：

- **静默降级**：Worker 找不到文件 A，自动降级读了文件 B，丞相不知道，史官看到了
- **重试风暴**：某个工具调用失败了 5 次才成功，说明环境有问题
- **委托链断裂**：九卿分解了 5 个子任务，只有 3 个完成，另外 2 个结果被丢弃
- **权限蔓延**：Worker 声称"只读"，但工具调用日志显示它调用了 write_file

这些问题在方 A 的视角下完全不可见。丞相收到的是"任务完成"，史官也只看到"任务完成"。

### 2. 结构化日志 ≠ 全量 Token 爆炸

方 C 最大的误解是"监督子任务 = Token 成本翻倍"。实际上，`extractDecisions()` 和 `extractAnomalies()` 是语义提取，不是全量 messages 转发。

一个 Worker 执行了 50 轮对话，提取后可能只有：
```json
{
  "decisions": ["选择读取 CSV 而非 XLSX"],
  "anomalies": ["XLSX 不存在，降级"],
  "toolCalls": "read×12, grep×3",
  "result": "发现 Q3 异常"
}
```

这是 ~100 tokens，不是 5000 tokens。

Token 成本增量主要来自委托链的**宽度**（并行任务数）而非**深度**（单个任务内部）。对于典型的 3-5 个子任务场景，方 C 的额外 Token 成本约为 500-1500 tokens，完全可接受。

### 3. 历史可追溯性

`court-execution-log.jsonl` 是持久化的跨 session 记录。史官不仅能审查当前 session，还能对比历史执行模式：

- "这个九卿上次也在同样的文件操作上降级了"
- "Worker-财务在处理大文件时稳定重试 3 次，可能需要优化"

这是方 A 完全无法实现的能力。

---

## 潜在风险与缓解

### 风险 1：日志写入竞争条件

多个并行 Worker 同时写 `court-execution-log.jsonl`，可能产生写入冲突。

**缓解**：使用文件锁（`flock`）或进程级原子 append（写入独立文件 `task-{id}.log`，丞相 `agent_end` 时聚合）。Pi 的并行 tool_use 原生支持，需要确保每个 spawn 有唯一 `PI_TASK_ID`。

### 风险 2：史官被日志淹没

如果委托链很深（丞相→九卿→Worker→Sub-Worker），日志量可能超出史官上下文窗口。

**缓解**：实现**深度截断策略**——史官默认只看深度 ≤ 2 的节点，深度 3+ 的节点只保留异常记录。正常执行的深层节点不进入史官上下文。

```javascript
function buildHistorianInput(delegateTree, maxDepth = 2) {
  return pruneTree(delegateTree, {
    maxDepth,
    keepAnomalies: true,  // 无论深度，异常总是保留
    keepSummary: true     // 深层节点只保留结果摘要
  });
}
```

### 风险 3：史官角色蔓延

史官看到越多，越可能开始"建议具体实现"而非"审查决策"。

**缓解**：史官的 system prompt 硬约束审查维度：
```
你是史官。你的职责是：
1. 识别委托链中的异常模式
2. 评估丞相的决策是否与实际执行一致
3. 发现被静默处理的失败

你不应该：
- 建议具体的技术实现
- 评价 Worker 的执行效率
- 提出架构改进意见（那是下一个 session 的事）
```

---

## 跨平台适配策略

| 能力 | Pi Extension | CC Hooks | OC |
|------|-------------|----------|-----|
| 执行日志写入 | `agent_end` 直接写文件 | `PostToolUse` 提取 Task 返回值 | `messages.transform` 拦截 |
| 史官触发 | 丞相 `agent_end` spawn | `Stop hook exit 2` | 自定义 plugin 事件 |
| 日志注入史官 | spawn 时 `--input` 参数 | `pending-advice.md` + `PreToolUse` | `messages.transform` 前置注入 |
| 委托链追踪 | 环境变量 `PI_PARENT_TASK_ID` | Task prompt 注入追踪 ID | YAML frontmatter `parent_task` |

Pi Extension 是最干净的实现，因为它对 spawn 子进程有完整控制权，环境变量传递和 `agent_end` 钩子是原生支持的。CC 和 OC 的实现需要通过 prompt injection 和文件中转来模拟，复杂度更高但可行。

---

## 结论

方 C 不是"更复杂的方 A"，它是质变。史官从"读后感写作者"变成"真正的监察官"。

关键设计选择是：**结构化语义提取而非全量日志转发**。这使得方 C 的 Token 成本可控，同时保留了完整的可审查性。

史官的独立性不在于它看的信息少，而在于它的**视角独立**——它不是丞相的助手，它是整个委托链的观察者。给它完整的视野，才能让它真正独立。

---

## 第二轮：反驳与修正

### Party A — 反驳 (gpt-5.2)

### 结论（方 A）
史官**不应**具备对子任务执行过程的监督能力；史官应当**只审查丞相的决策与最终对外输出**（A），最多只允许“极窄的、由丞相显式呈交的证据附件”，且该附件应被视为**丞相决策的一部分**而非“史官可自由巡检的委托链”。原因是：跨平台可实现性、硬约束边界、token/性能、以及“独立审查者”角色纯净性在 A 下最稳。

---

## 1) 其他方案的具体弱点与风险

### 对方案 B（看 delegate 结果摘要）的批评
1. **监督权的对象漂移**  
   一旦史官常态化读取 delegate summaries，它的评价将不可避免地转向“九卿/工人做得好不好”，史官从“审查丞相”滑向“审查下属执行”。这在组织上等价于新增一条事实上的管理链路（史官→九卿/工人），与“丞相超然监督、史官独立审查”的分工冲突。

2. **摘要可信性与“二次摘要”失真**  
   B 要求子进程结构化 summary。现实是：  
   - 在 **Pi** 里子进程虽可 `--mode json`，但 summary 仍是模型生成，且不同角色会“迎合评分标准”而非真实反映执行风险。  
   - 在 **CC/OC** 里依赖 hook 注入 prompt 让 Sub-Agent 附加日志/摘要，属于“软约束”，越复杂越容易被模型忽略或格式漂移。史官最终审查的是“被提示词塑形后的报告”，不是事实。

3. **审查面扩大导致 token 常态增量**  
   B 的预算控制依赖“只取前 N 个摘要、异常才展开”，但“异常”本身又由子进程/提取器定义，容易漏报；为兜底只能提高覆盖面，成本最终变成**持续的上下文税**。

### 对方案 C（完整委托链监督/结构化日志）的批评
1. **跨平台落地成本与脆弱性**  
   - **Pi**：子进程 `agent_end` 写 `.jsonl` 可做，但并行写入、锁、聚合、ID 传递、截断策略都要工程化；这套机制越像“审计系统”，越接近引入外部基础设施。  
   - **CC/OC**：关键依赖 Pre/PostToolUse 把“日志协议”塞进 Sub-Agent 输出，再解析回收；这不是硬边界，是 prompt 协议，极易在长任务、多工具、多轮后破碎。
2. **角色污染与权力边界坍塌**  
   史官一旦拥有全链路日志，就会不可避免地产生“过程性优化建议”，进而影响丞相的委托方式与九卿的执行方式，史官从“独立审查者”变成“流程改进官/内控官”。这是组织设计上的根本改变，不是实现细节。
3. **性能风险不是 token，而是 I/O 与复杂度**  
   C 强调“语义提取不是全量转发”，但你仍要：提取→持久化→聚合→注入→再审查。高并发 delegate 时，瓶颈更可能出现在文件锁争用、聚合排序、以及失败恢复（日志丢失/半写入）上；这在 Pi 主打的“可插拔 Extension”里会显著提高维护成本与故障面。

---

## 2) 为什么 A 更优（在三平台真实机制下）

1. **完全硬边界：史官只对丞相负责**  
   - Pi：史官由丞相主进程 `agent_end` spawn（`--no-session --mode json`）天然零状态；只把“丞相最终输出/决策”喂给史官即可，边界清晰。  
   - CC：史官 daemon 也应只通过管家（丞相）的最终 stop/输出点注入 advice（Stop hook exit 2 / pending-advice.md），避免扩大 hook 协议面。  
   - OC：用 `messages.transform` 注入史官建议同样应只绑定“丞相输出节点”，不绑定 Task 返回值流。
2. **token 成本可预测、最小化**  
   A 的史官输入是单点：丞相最终答复（再加必要的任务目标）。不会随 delegate 数量线性增长，也不会在大规模并行时出现“监督成本爆炸”。
3. **避免把“审计系统”塞进 Agent 系统**  
   子任务监督本质是 observability/审计工程问题。把它做进史官职责，会让 Court Architecture 从“多 Agent 委托”膨胀为“多 Agent + 全链路审计平台”。A 保持系统核心目标：让丞相高质量决策与交付。

---

## 3) 承认对方亮点，并如何吸收（不改变 A 的边界）

B/C 的合理点：**丞相可能被下属误导**、或 delegate 出现静默失败。我们吸收，但不让史官直接监督子任务，而是让丞相在“决策层”承担举证责任：

- 引入**硬编码的“Decision Evidence 附录”协议**：丞相在最终输出前，必须生成一个极短的证据块（例如 5 条以内），内容来自它已收到的 delegate 结果，但由丞相负责选择与背书。史官审查的是：**证据是否足以支撑丞相结论、证据选择是否偏置、是否存在关键缺失**。  
- 对“静默失败”采用**工具级元数据而非全链路日志**：在 Pi 的 `context` 事件里从 messages 中抽取 *仅丞相层可见* 的 delegate tool_result 计数、错误标记、超时标记，压缩成一行 meta（不包含过程细节）。史官看到的是“风险信号”，不是执行过程。

这两点能捕捉 B/C 想要的“反蒙蔽”效果，但仍保持史官不对下属过程作裁判。

---

## 4) 修订后方案 A’（仍属 A：不授予子任务监督权）

### 目标
史官只审查：**任务目标 + 丞相最终输出 + 丞相的证据附录 + 极简风险信号**。不看委托链、不看子任务细节、不做过程评价。

### Pi Extension 实现路径（可落地）
1. **context 事件：构建史官审查包（最小）**  
   在每次 LLM 调用前，你已能替换消息列表。做两件事：  
   - 把已完成 delegate 对话压缩掉（现有逻辑）。  
   - 额外生成一段 *RiskMeta*（例如：delegate 调用次数、失败/重试次数、最长耗时、是否出现空结果），来源是 messages 里 tool_use/tool_result 的统计，**不包含具体内容**。

2. **agent_end：spawn 零状态史官，只喂审查包**  
   - `spawn("pi", ["--no-session","--mode","json","--tools","read"])`  
   - 输入包含：`goal`, `chancellor_final_answer`, `decision_evidence_appendix`, `risk_meta`  
   - 史官输出严格 JSON：`{verdict, issues, questions_to_chancellor, suggested_rewrite}`

3. **双路注入维持**  
   - `sendMessage({deliverAs:"nextTurn"})` 注入史官进言  
   - `before_agent_start` 把最新史官进言附到 systemPrompt（但只保留最近一条，避免滚雪球）

### CC / OC 适配
- **CC**：继续走 V11 的 pending-advice.md + Stop hook exit 2 机制，但审查输入只来自“主 agent 最终草稿 + evidence 附录 + 风险统计”（风险统计可由 PostToolUse 对 Task 的 exit code/异常进行计数，而不采集详细输出）。  
- **OC**：用 `messages.transform` 在主 agent 输出前注入史官建议；同样只注入最小审查包，避免把 transform 变成全链路抓取器。

### token/性能
- 史官输入规模基本固定：最终输出（~几百到两千 tokens）+ 附录（~200 tokens）+ meta（~50 tokens）。  
- 不随并行子任务数线性增长；I/O 仅 appendEntry（可选）与一次 spawn，性能稳定。

---

### 立场总结
让史官监督子任务，看似“更强监督”，实则引入跨平台脆弱协议、持续 token 税、以及角色边界坍塌。更好的做法是：**把“执行可见性”留在丞相的举证义务与极简风险信号上**，史官只审查丞相是否“基于充分证据做出合理决策并正确对外表达”。这在 Pi/CC/OC 的真实机制下最稳、最省、最不走样。

---

### Party B — 反驳 (kimi-k2.5)

## 方 B 立场：审查丞相决策 + delegate 结果摘要

### 核心主张

**史官应当看到 delegate 的结果，但不应陷入执行过程的泥潭。**

方 A 过于保守，将监督责任完全压在丞相肩上，却忽视了丞相作为"纯监督者"的根本限制——它只有 read + delegate 工具，无法实时验证子任务的实际执行质量。当九卿返回一份看似合理的摘要时，丞相只能基于信任继续推进。

方 C 又过于激进，追求完整的委托链可见性，却低估了工程复杂度和 token 成本的非线性增长。结构化日志提取在纸面上优雅，实践中面临写入竞争、深度截断策略的调参困境，以及最关键的——**史官角色蔓延**风险。

我的方案是：**史官审查丞相决策 + 每个 delegate 返回的结构化摘要**。这不是妥协，而是精准定位史官的核心价值——验证"丞相是否基于可靠信息做出决策"，而非替代丞相成为第二执行层。

---

## 对方案的具体批判

### 方 A 的关键盲区：丞相的"信任陷阱"

方 A 假设强化 delegation contract 就能解决问题，但这忽略了 Court Architecture 的核心张力：

> 丞相被设计为"超然监督者"，read + delegate only。它不能执行代码、不能运行测试、不能验证 worker 的实际输出是否正确。

当九卿返回：
```
Result: Q3 财务分析完成
Evidence: /tmp/analysis.md
Risks: 无
```

丞相能做什么？它能 `read_file("/tmp/analysis.md")`，但它**无法判断这份分析是否正确**。它只能检查格式、完整性、自洽性——这正是方 A 所说的"自检"。但数据源的准确性、计算逻辑的合理性、异常值的处理方式，这些需要**跨任务视角**才能发现。

方 A 的回应是"这是丞相的职责"。但硬约束下的丞相没有这个能力。**史官的价值恰恰在于提供这种跨任务、零状态的独立验证视角**——但前提是它能看到 delegate 返回了什么，而不仅仅是丞相的最终整合。

### 方 C 的工程幻觉：结构化日志的隐性成本

方 C 的 `extractDecisions()` 和 `extractAnomalies()` 看起来很美，但存在三个未解决的难题：

**1. 提取逻辑谁定义？**

如果由子进程自己提取，就是"自我审计"，九卿可以选择性报告。如果由父进程（丞相）提取，丞相需要解析子进程的完整 messages——这违反了"read + delegate only"的硬约束，实际上让丞相变成了 parser。

**2. 并行写入的原子性**

方 C 提到 `atomicAppend` 或独立文件聚合，但 Pi Extension 的 `agent_end` 是阻塞事件。多个并行 Worker 同时触发 `agent_end` 时，文件锁或聚合逻辑会增加显著延迟，抵消并行 tool_use 的收益。

**3. 深度截断的策略困境**

方 C 提出"默认只看深度 ≤ 2"，但这个阈值是魔法数字。深度 2 的节点正常执行，深度 3 的节点出现异常——截断后史官看不到。反之，不截断则 token 爆炸。这个权衡没有通用解，必须 per-task 调参，引入不可预测的审查盲区。

更深层的问题是：**方 C 的史官开始评价"执行效率"、"重试模式"、"权限蔓延"**——这些确实是 valuable insights，但它们属于**系统优化范畴**，而非**单次决策审查**。史官的角色从"终审法官"滑向"运维分析师"，这与"零状态、低耦合"的设计原则冲突。

---

## 方 B 的技术实现

### 核心机制：Delegate 返回强制摘要块

不同于方 C 的事后日志聚合，方 B 在**委托契约层面**解决问题——delegate 的返回值本身就是结构化摘要，无需二次提取。

#### Pi Extension 实现

**Step 1: 强化 Delegate 契约（丞相 systemPrompt）**

```javascript
// before_agent_start: 每轮注入 delegate 格式要求
const DELEGATE_CONTRACT = `
[DELEGATE_OUTPUT_FORMAT]
所有子任务返回必须包含以下区块：

<result_summary>
  goal: 原始任务目标（复述）
  approach: 采用的方法/策略（1-2句）
  key_findings: 关键发现列表（最多3项）
  confidence: high|medium|low（对结果可靠性的自我评估）
</result_summary>

<evidence_package>
  primary_source: 主要证据文件路径
  verification_command: 可复现验证的命令（如有）
  data_quality_notes: 数据源限制或异常说明
</evidence_package>

<execution_metadata>
  subtasks_spawned: 创建的子任务数量（如适用）
  anomalies_encountered: 遇到的异常及处理方式
  open_questions: 未解决的不确定性
</execution_metadata>

[END_DELEGATE_OUTPUT_FORMAT]
`;

agent.on('before_agent_start', ({ systemPrompt }) => {
  return systemPrompt + '\n\n' + DELEGATE_CONTRACT;
});
```

**Step 2: 丞相层保留 delegate 结果（context 事件塑形）**

```javascript
// context 事件：替换已完成 delegate 的详细对话为摘要块
agent.on('context', ({ messages }) => {
  return messages.map(m => {
    if (m.role === 'assistant' && m.tool_calls?.some(t => t.name === 'delegate')) {
      // 找到对应的 tool_result
      const resultIdx = messages.findIndex(
        msg => msg.role === 'tool' && 
        msg.tool_call_id === m.tool_calls[0].id
      );
      if (resultIdx > 0) {
        const result = messages[resultIdx];
        // 提取并验证摘要块格式
        const summary = extractSummaryBlocks(result.content);
        // 替换原消息为压缩版本
        return {
          role: 'tool',
          tool_call_id: m.tool_calls[0].id,
          content: `[DELEGATE_RESULT_COMPRESSED]\n${formatSummary(summary)}\n[ORIGINAL_LENGTH: ${result.content.length} chars]`
        };
      }
    }
    return m;
  });
});
```

**Step 3: agent_end 触发史官，输入包含 delegate 摘要链**

```javascript
agent.on('agent_end', async ({ messages }) => {
  // 提取本轮所有 delegate 结果摘要
  const delegateSummaries = extractAllDelegateSummaries(messages);
  
  // 构建史官输入
  const historianInput = {
    chancellor_final_output: extractFinalReply(messages),
    decision_rationale: extractChancellorReasoning(messages), // 丞相的决策推理过程
    delegate_chain: delegateSummaries, // 关键：每个 delegate 的返回摘要
    session_metadata: {
      total_delegates: delegateSummaries.length,
      confidence_distribution: summarizeConfidence(delegateSummaries)
    }
  };
  
  // spawn 零状态史官
  const historian = spawn('pi', [
    '--no-session', '--mode', 'json',
    '--tools', 'read',
    '--system', HISTORIAN_SYSTEM_PROMPT,
    '--input', JSON.stringify(historianInput)
  ]);
});
```

**Step 4: 史官的双路注入（保持现有机制）**

```javascript
// 史官输出处理
const advice = await historian.output;

// 路径1: sendMessage 注入下一轮用户上下文
sendMessage({
  deliverAs: 'nextTurn',
  content: `[史官进言] ${advice.to_user}`
});

// 路径2: before_agent_start 注入 systemPrompt 区块
// （由主进程记录 advice.to_chancellor，下轮读取）
await appendEntry('historian_advice_log', {
  timestamp: Date.now(),
  advice_to_chancellor: advice.to_chancellor
});
```

#### CC Hooks 适配

CC 的 Sub-Agent 隔离是挑战，但可以利用 Task 返回值通道：

```python
# PreToolUse: 强制子 Agent 按格式返回
if tool_name == "Task":
    input["prompt"] = f"""
{input["prompt"]}

[CRITICAL] 你的返回必须包含 <result_summary>, <evidence_package>, <execution_metadata> 三个区块。
缺少任何区块将被视为任务失败。
"""

# PostToolUse: 验证格式，不合格则标记
if tool_name == "Task":
    if not validateSummaryBlocks(result["output"]):
        # 写入警告，供史官后续审查
        atomic_append("./delegate_format_violations.jsonl", {
            "task_id": result["task_id"],
            "violation": "missing_required_blocks"
        })
```

史官在 Stop hook 触发时，读取：
- 主 Agent 的最终输出
- 所有 Task 返回值的摘要区块
- format_violations 记录（如有）

#### OC 适配

利用 `messages.transform` 在史官审查前注入 delegate 摘要：

```typescript
// 自定义 plugin 检测史官审查模式
if (context.mode === 'historian_review') {
  const delegateSummaries = await loadDelegateSummaries();
  messages.unshift({
    role: 'system',
    content: `DELEGATE_CHAIN_SUMMARIES:\n${formatForHistorian(delegateSummaries)}`
  });
}
```

---

## 方 B 的核心优势

### 1. 精准的问题发现能力

对比三种方案的异常检测覆盖：

| 异常类型 | 方 A | 方 B | 方 C |
|---------|------|------|------|
| 丞相决策逻辑矛盾 | ✓ | ✓ | ✓ |
| 丞相遗漏关键风险 | ✗ | ✓ | ✓ |
| 九卿返回与目标偏离 | ✗ | ✓ | ✓ |
| 九卿 confidence=low 但丞相未重视 | ✗ | ✓ | ✓ |
| Worker 静默降级读错文件 | ✗ | ✗* | ✓ |
| Worker 重试风暴 | ✗ | ✗ | ✓ |

\* 方 B 的缓解：若九卿诚实报告 `anomalies_encountered`，史官可发现；若九卿隐瞒，则无法发现。这是**委托信任边界**的固有约束，方 C 的结构化日志同样依赖子进程的自我报告。

### 2. Token 成本可预测且可控

- 方 A：史官输入 ≈ 终稿 + 决策摘要（固定 ~2KB）
- 方 B：史官输入 ≈ 终稿 + 决策摘要 + N × 摘要块（N=delegate 数量，每块 ~300 tokens）
- 方 C：史官输入 ≈ 终稿 + 完整委托树（随深度和宽度指数增长）

典型场景（丞相 → 3 九卿 → 各 2 Workers）：
- 方 A：~800 tokens
- 方 B：~800 + 3×300 = ~1700 tokens
- 方 C：~800 + 3×(九卿详情) + 6×(Worker 详情) = ~4000+ tokens，或需复杂的深度截断

方 B 的成本与**委托宽度**线性相关，与**执行深度**无关——这是关键设计选择。

### 3. 角色边界清晰

史官的审查维度被严格限定：

```
史官审查清单：
□ 丞相的决策是否基于充分的 delegate 结果？
□ 各 delegate 的 confidence 评估是否合理？
□ 是否存在 confidence=low 但被忽略的结果？
□ evidence_package 是否支持丞相的结论？
□ 各 delegate 报告的 anomalies 是否在最终决策中被考虑？

史官不审查：
- Worker 的具体执行步骤
- 工具调用的效率
- 代码实现的优劣
- 系统架构建议
```

---

## 整合与修订

### 承认方 A 的正确之处

方 A 强调的"硬约束优先"是正确的。方 B 完全采纳：
- 丞相 read + delegate only
- 史官零状态 spawn
- 双路注入机制

### 承认方 C 的正确之处

方 C 指出的"丞相可能基于不可靠信息决策"是关键洞察。方 B 通过**强制 delegate 返回结构化摘要**来回应，而非事后日志聚合。

方 C 的"历史可追溯性"需求可以通过 `appendEntry` 持久化史官输入来实现，不影响实时审查流程。

### 修订后的方 B 方案

**新增：Delegate 契约强制执行**

```javascript
// 在 delegate 工具调用前，验证子进程的 systemPrompt 包含格式要求
function validateDelegatePrep(toolCall) {
  const targetRole = toolCall.input.role; // "minister" | "worker"
  const requiredSnippet = `[DELEGATE_OUTPUT_FORMAT]`;
  
  // Pi: 通过环境变量传递格式要求
  // CC: 通过 PreToolUse 修改 Task prompt
  // OC: 通过 YAML frontmatter 注入
  
  return ensureFormatEnforced(targetRole, requiredSnippet);
}
```

**新增：史官的"置信度不一致"检测**

```javascript
// 史官 systemPrompt 中的专项检测
const HISTORIAN_CONFIDENCE_CHECK = `
特别关注以下模式：
1. 任一 delegate 声明 confidence=low，但丞相未在决策中提及此不确定性
2. 多个 delegate 的 confidence 分布为 [high, high, low]，但丞相仅引用 high 的结果
3. evidence_package 中的 data_quality_notes 包含限制条件，但丞相结论未体现这些限制

发现以上情况时，必须在 advice_to_chancellor 中明确标注 [CONFIDENCE_MISMATCH]。
`;
```

---

## 结论

方 B 的定位是**增强型终审**：史官不仅审查丞相如何整合信息，还审查丞相**整合的信息本身是否可靠**。这通过强制 delegate 返回结构化摘要实现，无需侵入执行过程，保持了跨平台可行性和 token 成本可控性。

史官的独立性不在于信息的绝对完整，而在于**视角的不可替代**——它是唯一同时看到"丞相的整合逻辑"和"各来源的原始评估"的零状态观察者。给它恰到好处的视野，让它专注于决策质量而非执行细节，这才是 Court Architecture 分层设计的精髓。

---

### Party C — 反驳 (claude-sonnet-4-6)

# 方 C 的回应：为什么完整监督链才是正确答案

## 先承认对方的合理之处

方 A 和方 B 都提出了值得认真对待的约束条件。方 A 关于"token 成本可预测性"的担忧是真实的工程问题；方 B 的"摘要 + 异常驱动"策略是一个务实的妥协。我会整合这两点到方 C 的修订版中。

但两方都回避了一个根本问题：**在分层委托系统中，信息损耗是结构性的，不是偶发的。**

---

## 方 A 的致命弱点：把监督责任推给了最没能力履行的角色

方 A 的核心论点是"子任务偏差应由丞相发现，不应外包给史官"。这听起来合理，但在实践中是一个循环论证：

**丞相的工具是 read + delegate only。** 丞相没有执行能力，它看到的子任务结果完全依赖九卿/worker 的自述。方 A 提出的"delegation contract + evidence 可验证"方案，要求丞相用 read 工具抽查 evidence 文件——但这意味着丞相需要知道去读哪个文件，而这个信息来自九卿的返回值。

**这是一个自证循环**：九卿说"我把结果写到了 output.txt"，丞相 read output.txt 验证——但如果九卿根本没有完成任务，只是伪造了一个合格的 output.txt，丞相的 read 验证毫无意义。方 A 自己也批评方 B 存在"自证循环"问题，但方 A 自身的 evidence 校验机制正是最典型的自证循环。

方 A 的另一个问题是：它把"丞相的监督职责"当作理所当然，但**丞相的核心价值是决策和协调，不是审计**。让丞相承担深度审计职责，会迫使丞相在每次 delegate 后都做大量 read 验证，实际上增加了丞相的 token 消耗，而且验证质量远不如专职的史官。

---

## 方 B 的真实问题：摘要机制在哪里生成？

方 B 的方案看起来很合理，但有一个被掩盖的关键问题：**那个结构化的 `DelegateResult` 是谁生成的？**

方 B 要求子进程通过 `--mode json` 强制输出标准结构。但 `--mode json` 是 Pi 的输出格式控制，不是内容结构控制——它控制的是 Pi 进程本身的 stdout 格式，不能强制 LLM 输出特定字段。

实际上，方 B 的摘要生成依赖 LLM 自觉遵守 systemPrompt 中的格式要求。这是一个**软约束**。当九卿面对复杂任务时，它可能输出不符合 schema 的内容，或者在 `anomalies` 字段填写"无"来掩盖问题。方 B 自己也承认了"摘要信息损失"的风险，但提出的缓解措施（`anomalies` 字段、哈希验证）都依赖子进程的诚实配合。

更根本的问题是：**方 B 的史官只能看到摘要，但无法判断摘要是否准确。** 方 B 提到"保留 fullOutput 哈希"让史官可以"抽查验证摘要准确性"——但史官只有 read 工具，它能读什么？读哈希值然后和什么比较？这个设计在实现层面是不完整的。

---

## 方 C 修订版：基于 Pi 原生机制的完整监督链

我承认原始方案 C 的"完整监督"如果理解为"把所有子任务对话全部喂给史官"确实是 token 灾难。修订版方案 C 保留完整监督链的理念，但采用**结构化日志 + 选择性深挖**的实现策略。

### 核心机制：委托链日志树

```typescript
// 每个 delegate 子进程在 agent_end 时写入共享日志
// 路径: .pi-court/delegation-log/{session_id}/{task_id}.json
interface DelegationNode {
  taskId: string;
  parentTaskId: string | null;
  role: 'chancellor' | 'minister' | 'worker';
  depth: number;
  
  // 关键：这些由平台机制保证，不依赖 LLM 自述
  toolCallsCount: number;        // 实际 tool_use 次数
  toolsActuallyUsed: string[];   // 从 messages 中提取，非 LLM 声明
  exitStatus: 'completed' | 'interrupted' | 'error';
  durationMs: number;
  
  // LLM 生成部分（允许不可靠，史官会交叉验证）
  selfReportedSummary: string;
  
  // 原始数据引用（史官可按需 read）
  rawOutputFile: string;  // appendEntry 写入的完整输出路径
}
```

**关键差异**：`toolsActuallyUsed`、`exitStatus`、`durationMs` 这些字段**不是 LLM 声明的**，而是从 `agent_end` 事件的 `messages` 数组中机械提取的。这是 Pi Extension 的真实能力——`agent_end` 事件可以访问完整的 messages，其中 `tool_use` / `tool_result` 对是结构化数据，不依赖 LLM 诚实。

### 史官的两阶段审查

**第一阶段（快速扫描，低 token）**：史官读取整个委托链的 `DelegationNode` 树，这是纯 JSON，token 成本极低。史官用这些客观数据识别异常模式：
- 某个 worker 声称"完成了代码重构"但 `toolsActuallyUsed` 里没有任何 write 工具调用
- 某个九卿的 `durationMs` 异常短，但声称做了大量分析
- `exitStatus: 'interrupted'` 但丞相的决策中没有提到任何失败

**第二阶段（选择性深挖，按需 token）**：对第一阶段标记的异常节点，史官用 read 工具读取 `rawOutputFile`，获取完整的原始输出。这里的 read 是**有目标的**，不是盲目喂入所有内容。

这个设计整合了方 B 的"异常驱动详细输出"思路，但解决了方 B 的根本缺陷：**异常识别基于客观的平台数据，不依赖 LLM 的自我申报。**

### Token 成本的真实估算

典型任务（1 个九卿 + 3 个 worker）：
- 委托链 JSON 树：~800 tokens（纯结构化数据）
- 丞相最终决策：~1000 tokens
- 异常节点原始输出（假设 1 个异常）：~1500 tokens
- 史官 prompt + 输出：~1200 tokens
- **总计：~4500 tokens**

与方 B 的 4700 tokens 估算相当，但方 C 的异常识别是基于客观数据的，不是基于 LLM 自述的摘要。

### 跨平台适配

**CC**：`agent_end` 对应的是 `SubagentStop` hook。在 Stop hook 中，史官 daemon 读取 `.pi-court/delegation-log/` 目录（通过文件系统共享），执行相同的两阶段审查。每个 Sub-Agent 在停止前通过 `PostToolUse` hook 写入自己的 `DelegationNode`。

**OC**：通过 `messages.transform` 在每次 API 调用前注入委托链状态。`task(run_in_background=true)` 启动史官，史官读取共享日志文件。

---

## 设计纯净性的真正含义

方 A 担心方 C 会"模糊史官角色"。但我认为这个担忧混淆了两件事：**监督范围**和**执行介入**。

史官具有完整监督链的可见性，不等于史官会介入执行。史官的输出依然只是"向丞相进言"——但进言的质量会有根本性的提升，因为史官看到的是整个委托链的客观执行数据，而不是经过丞相过滤和九卿美化的摘要。

**角色纯净性应该体现在史官不能做什么（不能 write，不能 delegate，不能直接指挥任何人），而不是史官不能看什么。** 一个只能看丞相终稿的史官，在复杂系统中提供的监督价值是虚假的——它审查的是一个已经被层层过滤的信息，无法发现真正的系统性问题。

这才是方 C 的核心主张：**监督的独立性来自信息来源的独立性，而不是信息量的最小化。**

---

## 第三轮：评审裁决

> 评审模型: qwen3.5-plus

# 多 Agent 系统架构评审报告：史官子任务监督能力辩题

## 1. 各方优劣总结

### 方 A (gpt-5.2)：仅审查丞相决策（保守派）
*   **核心主张**：史官应严格限定为“终审法官”，仅审查丞相的最终输出与决策逻辑，完全隔离子任务细节。通过强化丞相的举证责任（Delegation Contract）来弥补信息缺失。
*   **优势**：
    *   **架构最纯净**：严格遵循分层原则，史官零状态、低耦合，角色边界清晰如刀切。
    *   **成本可控性最强**：Token 消耗固定，不随任务复杂度指数膨胀，性能可预测。
    *   **跨平台兼容性最高**：不依赖各平台对子进程内部状态的深度暴露，落地阻力最小。
*   **弱点**：
    *   **“信任陷阱”**：过度依赖丞相的自查能力。若九卿/Worker 伪造证据或静默降级，丞相因缺乏执行能力（Read+Delegate only）难以识破，导致史官审查流于形式。
    *   **防御被动**：将发现深层执行偏差的责任完全推给丞相，违背了设立独立监察官（史官）的初衷。

### 方 B (kimi-k2.5)：审查决策 + Delegate 结果摘要（务实派）
*   **核心主张**：史官应看到每个 Delegate 返回的结构化摘要（Summary），特别是置信度（Confidence）和异常标记（Anomalies），以验证丞相决策的信息基础是否可靠。
*   **优势**：
    *   **性价比最优**：在信息完整性与 Token 成本之间取得了最佳平衡。既能发现“丞相被蒙蔽”的情况，又避免了全量日志的爆炸。
    *   **针对性强**：引入“置信度不一致检测”，能有效识别丞相忽略低风险信号的问题。
    *   **实现可行**：利用现有的 `--mode json` 和 Prompt 约束即可实现，无需复杂的底层基础设施改造。
*   **弱点**：
    *   **软约束风险**：摘要生成依赖 LLM 的自觉性。若子进程恶意隐瞒或格式漂移，史官看到的仍是“美化后”的数据。
    *   **验证闭环缺失**：史官虽能看到摘要，但缺乏客观手段验证摘要的真实性（除非额外引入哈希校验等复杂机制）。

### 方 C (claude-sonnet-4-6)：完整监督含执行细节（激进派）
*   **核心主张**：史官必须拥有完整的委托链视野。通过平台侧自动提取的“结构化执行日志”（工具调用次数、耗时、退出状态等客观元数据），结合按需读取的原始输出，实现真正的独立监督。
*   **优势**：
    *   **监督效力质变**：能够发现静默降级、重试风暴、权限蔓延等深层问题，打破了“自证循环”。
    *   **数据客观性**：强调利用平台事件（如 `agent_end` 中的 messages 数组）提取客观元数据，而非依赖 LLM 自述，解决了方 B 的信任问题。
    *   **历史可追溯**：持久化的执行日志树为长期系统优化提供了数据基础。
*   **弱点**：
    *   **工程复杂度高**：需要处理并发写入锁、日志聚合、深度截断策略等分布式系统难题。
    *   **潜在性能瓶颈**：若控制不当，日志聚合可能抵消并行执行的优势；深度过深时仍需精细的剪枝策略。

---

## 2. 共识点提取

尽管三方立场不同，但在以下核心设计原则上达成了高度一致：
1.  **角色硬约束**：丞相必须是纯监督者（Read + Delegate），史官必须是零状态只读观察者（Read Only），严禁角色越界执行任务。
2.  **事后审查机制**：史官不应实时介入执行过程，而应在 `agent_end` 或等效节点触发，进行异步审查。
3.  **双路注入反馈**：均同意通过 `sendMessage` (NextTurn) 和 `before_agent_start` (SystemPrompt) 将史官建议反馈给丞相。
4.  **反对全量转发**：三方均反对将子任务的原始对话记录（Raw Messages）直接喂给史官，认同必须进行某种形式的压缩或提取。
5.  **平台适配必要性**：均承认需针对 Pi Extension、CC Hooks、OC Transform 的不同机制做适配，不能强行统一代码。

---

## 3. 分歧点分析

**核心分歧：史官的“视野边界”在哪里？**

*   **方 A vs. 方 B/C**：
    *   **焦点**：是否信任丞相的过滤能力？
    *   **原因**：方 A 认为系统复杂性应通过简化接口来控制，相信“契约 + 举证”能解决问题；方 B/C 则认为在 LLM 不可靠的现实下，必须引入第三方视角打破信息不对称。
    *   **本质**：是追求**架构的极简主义**（A），还是追求**系统的鲁棒性**（B/C）。

*   **方 B vs. 方 C**：
    *   **焦点**：数据的来源是“主观摘要”还是“客观元数据”？
    *   **原因**：方 B 倾向于利用 LLM 生成的结构化文本，实现成本低但存在欺骗风险；方 C 坚持利用平台底层事件提取客观指标（如 Tool Count, Exit Status），实现成本高但可信度高。
    *   **本质**：是**工程实用主义**（B）与**审计严谨性**（C）的博弈。

---

## 4. 最终裁决

**裁决结论：采纳“增强型客观监督”方案（基于方 C 理念，融合方 B 的摘要机制，保留方 A 的成本控制）。**

**理由陈述：**
1.  **否定纯方案 A**：在 Multi-Agent 系统中，丞相作为“非执行者”，天然无法验证下属汇报的真实性。若史官也只看丞相提供的材料，整个系统将形成一个封闭的“回音室”，无法防御内部节点的幻觉或偷懒。**独立的监督必须建立在独立的信息源之上。**
2.  **修正纯方案 C**：全量日志确实会导致 Token 爆炸和工程过载。必须引入方 B 的“摘要优先”策略，但摘要的内容不能仅靠 LLM 生成。
3.  **推荐路径**：构建**“双层监督视图”**。
    *   **第一层（默认视图）**：由平台自动提取的**客观元数据树**（任务拓扑、工具调用统计、退出码、耗时）。这部分数据不依赖 LLM 诚实，成本极低，用于快速扫描异常。
    *   **第二层（深挖视图）**：仅当第一层发现异常（如：声称完成但无 Write 操作、耗时异常短、置信度低）时，史官才通过 `read` 工具读取该节点的详细摘要或原始输出。

此方案既保留了方 C 的“防欺骗”能力，又继承了方 B 的"Token 经济性”，同时避免了方 A 的“盲目信任”。

---

## 5. 具体实现建议

### 5.1 核心数据结构：客观执行节点 (Objective Execution Node)

不再依赖 LLM 生成 Summary，而是由 Host 进程在 `agent_end` 时机械提取：

```typescript
interface ObjectiveNode {
  taskId: string;
  parentId: string | null;
  role: 'minister' | 'worker';
  
  // 【关键】平台侧自动提取，LLM 无法篡改
  metrics: {
    toolCallCount: number;       // 实际调用次数
    toolsUsed: string[];         // 去重后的工具列表 ['read_file', 'bash']
    hasWriteOperation: boolean;  // 是否包含写操作
    exitStatus: 'success' | 'error' | 'interrupted';
    durationMs: number;
    tokenUsage: number;
  };
  
  // LLM 自述部分（供参考，需交叉验证）
  selfReport: {
    summary: string;             // 简短摘要 (<200 tokens)
    confidence: 'high' | 'medium' | 'low';
    anomalies: string[];         // 自报异常
  };
  
  // 指针，仅在需要深挖时使用
  rawLogPath?: string;           
}
```

### 5.2 平台适配实施路径

#### A. Pi Extension (首选参考实现)
利用原生事件钩子实现最干净的解耦。

1.  **子进程埋点 (`agent_end`)**：
    *   所有 Spawn 的子进程（Minister/Worker）在结束时，解析自身 `messages` 数组。
    *   统计 `tool_use` 和 `tool_result` 数量，提取 `exit` 状态。
    *   生成 `ObjectiveNode` JSON，原子追加写入共享文件 `.pi-court/logs/{session_id}.jsonl`。
    *   *注意*：不阻塞主流程，写入异步化或使用文件锁。

2.  **丞相聚合 (`agent_end`)**：
    *   丞相结束时，读取上述 JSONL 文件，根据 `parentId` 重建委托树。
    *   筛选出“可疑节点”（例如：`hasWriteOperation=false` 但 `selfReport.summary` 声称生成了报告）。

3.  **史官审查 (`spawn`)**：
    *   输入 = 丞相终稿 + **委托树元数据** + **可疑节点的详细日志**。
    *   Prompt 指令：“对比 metrics 与 selfReport，找出不一致处。仅对异常节点进行深入分析。”

#### B. CC (Claude Code) Hooks V11
利用 Hook 拦截和文件中转模拟。

1.  **PreToolUse / PostToolUse**：
    *   在 `Task` 工具调用前后，记录时间戳。
    *   在 `PostToolUse` 中，解析 Sub-Agent 的返回内容，尝试提取结构化字段。若失败，标记为 `format_error`。
    *   将元数据写入 `pending-delegate-meta.json`。

2.  **Stop Hook (触发点)**：
    *   读取 meta 文件，构建简略树。
    *   若检测到异常，启动史官 Daemon 或通过 `exit 2` 强制进入下一轮并注入建议。

#### C. OC (OpenCode)
利用 `messages.transform` 和后台任务。

1.  **Plugin 监听**：
    *   编写 Plugin 监听 `task` 事件的开始与结束，维护内存中的任务树。
2.  **Transform 注入**：
    *   在史官 Review 模式下，`messages.transform` 将任务树的 JSON 表示注入 System Prompt。
    *   利用 `run_in_background=true` 并行运行日志收集任务，避免阻塞主线程。

### 5.3 成本控制策略
*   **深度截断**：默认只展示 Depth ≤ 2 的完整元数据。Depth > 2 的节点仅保留 `metrics` 和 `exitStatus`，除非标记为异常。
*   **懒加载详情**：史官 Prompt 中明确：“你只拥有元数据视图。若需查看某节点详细内容，请输出 `<READ_REQUEST path="..."/>` 标签，系统将自动读取并补充上下文。”（需框架支持二次交互或预读取前 N 个最可疑节点）。

---

## 6. 开放问题

尽管方案已趋完善，以下问题仍需在实战中验证：

1.  **并发写入的性能损耗**：在高并发 Delegate 场景下（如 10+ Workers 同时结束），文件锁竞争是否会显著拖慢整体响应时间？是否需要引入轻量级消息队列或内存映射文件？
2.  **“客观指标”的误报率**：仅凭工具调用列表（如没有 `write_file`）能否准确判断任务失败？是否存在“只读分析但产出极高价值结论”的合法场景被误判？如何调整启发式规则？
3.  **跨 Session 的历史学习**：如何利用持久化的 `jsonl` 日志训练或微调特定的“异常检测模型”，让史官从“规则驱动”进化为“模式识别驱动”？
4.  **CC/OC 的元数据提取精度**：在非 Pi 平台上，由于缺乏原生的 `messages` 访问权，依靠 Prompt 诱导子进程上报元数据的可靠性究竟有多少？是否需要开发专用的 Wrapper 脚本？

**结语**：
本裁决旨在构建一个**“看得见黑箱，但不被黑箱淹没”**的监督体系。史官不再是盲目的盖章机器，也不是事必躬亲的监工，而是一位手持“客观数据仪表盘”的睿智御史，精准地指向那些被粉饰太平所掩盖的裂痕。
