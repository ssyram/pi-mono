# 辩论脚本架构设计

## 1. 概述

一个独立的 TypeScript 脚本，通过 OpenAI 兼容 API 编排多模型**树状递归辩论**。
运行方式: `npx tsx debate/run.ts --config debate/config.json --max-rounds 3`

核心思想: 辩论不是固定轮数的线性流程，而是**分歧驱动的递归树**——有分歧就继续拆分深入，达成合意就收敛。

## 2. 核心流程 — 树状递归辩论

```
                        ┌─────────────┐
                        │  议题 Topic  │
                        └──────┬──────┘
                               │
                    ┌──────────▼──────────┐
                    │  Round 1 (depth=0)  │
                    │  ① 并行: 初始立场    │
                    │  ② 并行: 反驳修正    │
                    │  ③ 裁判: 搜集        │
                    │     合意 → 记录      │
                    │     分歧 → 拆分      │
                    └──┬───────────┬───────┘
                       │           │
              ┌────────▼──┐  ┌────▼────────┐
              │ 分歧点 D1  │  │  分歧点 D2  │
              │ depth=1    │  │  depth=1    │
              │ ①②③ ...   │  │  ①②③ ...   │
              └──┬────┬───┘  └─────────────┘
                 │    │          (合意 ✓)
          ┌──────▼┐ ┌▼──────┐
          │ D1.1  │ │ D1.2  │
          │ d=2   │ │ d=2   │
          └───────┘ └───────┘
       (达到 max-rounds, 裁判强制裁决)
```

### 2.1 单轮 (Round) 内部流程

每个节点（无论是根议题还是分歧子议题）执行相同的三步:

```
Step ①  并行初始立场 (Position)
        ├─ 根节点: 每个辩方根据议题+批注生成立场
        └─ 子节点: 每个辩方根据分歧描述 + 自己在父节点的立场
                   → 要么坚持并补充论据
                   → 要么修正立场
                   → 如果此辩方在父节点未参与此分歧，
                     则选择加入某一方或提出独立第三方意见

Step ②  并行反驳修正 (Rebuttal)
        ├─ 每方看到其他方的 Step① 立场
        └─ 指出弱点 + 吸收合理点 + 修正自身

Step ③  裁判搜集 (Judge Triage)
        ├─ 裁判收到所有 Step①② 内容
        ├─ 输出结构化 JSON:
        │   {
        │     "consensus": [{ "point": "...", "detail": "..." }],
        │     "divergences": [{
        │       "id": "d1",
        │       "title": "分歧描述",
        │       "sides": {
        │         "party-a": "A 的核心主张摘要",
        │         "party-b": "B 的核心主张摘要"
        │       },
        │       "uninvolved": ["party-c"]  // 未明确站队的辩方
        │     }]
        │   }
        └─ 如果 divergences 为空 → 此节点收敛, 不再递归
           如果 depth >= maxRounds → 裁判对剩余分歧做强制裁决
           否则 → 每个 divergence 成为子节点, 进入下一轮
```

### 2.2 递归终止条件

| 条件 | 行为 |
|------|------|
| `divergences` 为空 | 自然收敛 — 裁判生成合意结论 |
| `depth >= maxRounds` | 强制终止 — 裁判对剩余分歧做推荐裁决 |
| 所有 API 调用失败 | 异常终止 — 记录到目前为止的结果 |

### 2.3 辩方参与分歧子议题的规则

当裁判拆分出分歧点 D1 时，D1.sides 可能只涉及 party-a 和 party-b。party-c 被列为 `uninvolved`。

进入 D1 的 Step① 时，party-c 收到的 prompt 包含:
- 分歧描述 + 双方摘要
- 指令: "你在上一轮未对此分歧明确表态。请选择:
  (a) 支持某一方并补充论据
  (b) 提出不同于双方的第三方意见"

这确保所有辩方都参与每个分歧的讨论，不会有人缺席。

## 3. 数据结构 — 辩论树

```typescript
/** 辩论树节点 */
interface DebateNode {
  id: string                      // "root" | "d1" | "d1.1" ...
  depth: number
  topic: string                   // 议题/分歧标题
  context: string                 // 背景描述(根=原始议题, 子=分歧描述)
  annotations?: string[]          // 仅根节点有

  // 三步结果
  positions: Record<string, string>    // Step① party-id → 立场内容
  rebuttals: Record<string, string>    // Step② party-id → 反驳内容
  judgment: JudgmentResult             // Step③ 裁判结果

  // 递归
  children: DebateNode[]               // 分歧子节点
  status: 'pending' | 'converged' | 'forced' | 'failed'
}

/** 裁判输出(结构化) */
interface JudgmentResult {
  consensus: Array<{ point: string; detail: string }>
  divergences: Array<{
    id: string
    title: string
    sides: Record<string, string>     // party-id → 核心主张摘要
    uninvolved: string[]              // 未站队的辩方 ID
  }>
  // 仅在 forced 终止时存在
  forcedVerdicts?: Array<{
    divergenceId: string
    recommendation: string
    reasoning: string
  }>
}
```

## 4. 配置文件结构 (config.json)

```jsonc
{
  // API 配置 — 支持 OpenAI 兼容接口
  "api": {
    "baseURL": "https://api.example.com/v1",
    "apiKey": "${DEBATE_API_KEY}",  // 支持环境变量引用
    "timeout": 120000,
    "maxRetries": 2
  },

  // 辩方模型 (3个)
  "debaters": [
    {
      "id": "party-a", "label": "方 A", "model": "gpt-5.2"
    },
    {
      "id": "party-b", "label": "方 B", "model": "kimi-k2.5"
    },
    {
      "id": "party-c", "label": "方 C", "model": "gemini-3.1-pro-preview",
      "fallback": "claude-sonnet-4-6"  // 不稳定时自动回退
    }
  ],

  // 评审模型 (1个)
  "reviewer": {
    "id": "reviewer", "label": "评审", "model": "qwen3.5-plus"
  },

  // 辩论参数
  "params": {
    "maxRounds": 3,                // 最大递归深度
    "maxTokensPerResponse": 4000,  // 每次回复上限
    "temperature": 0.7,
    "parallelCalls": true          // 同一步骤内辩方是否并行调用
  },

  // 模型回退配置
  "fallback": {
    "maxConsecutiveFailures": 2,   // 连续失败 N 次触发回退
    "retryDelay": 2000             // 重试间隔 (ms)
  },

  // 议题列表
  "topics": [
    {
      "id": "topic-6",
      "title": "丞相上下文管理 — 锚点维护时机与自总结",
      "background": "（从原始辩论和决策报告中提取的背景段落）",
      "annotations": [
        "（用户批注原文）"
      ],
      "coreQuestions": [
        "丞相停止时是否应该强制自总结 Hook 更新锚点账本？",
        "如何平衡总结质量与调用成本？"
      ]
    }
  ],

  // 公共背景文档
  "sharedContext": {
    "files": [
      "reports/reports/comparison-and-decisions.md",
      "reports/debate/summary.md"
    ],
    "inline": ""  // 可选: 精简摘要替代完整文件
  },

  // 输出配置
  "output": {
    "dir": "debate/output",
    "format": "markdown",
    "includeRawResponses": false
  }
}
```

### 4.1 API 多源支持

不同模型可能来自不同 provider。支持两种模式:

**模式 A: 单一端点** — 所有模型走同一个 baseURL（如 OpenRouter）
```jsonc
{
  "api": { "baseURL": "...", "apiKey": "..." },
  "debaters": [{ "model": "gpt-5.2" }, ...]
}
```

**模式 B: 每模型独立端点** — debater/reviewer 可覆盖 api
```jsonc
{
  "debaters": [
    { "model": "gpt-5.2", "api": { "baseURL": "https://openai...", "apiKey": "${OPENAI_KEY}" } },
    { "model": "kimi-k2.5", "api": { "baseURL": "https://kimi...", "apiKey": "${KIMI_KEY}" } }
  ]
}
```

### 4.2 模型回退机制

针对 gemini-3.1-pro-preview 等不稳定模型:

```
调用 gemini-3.1-pro-preview
  ├─ 成功 → 使用结果, 重置失败计数
  ├─ 失败 → 失败计数 +1
  │   ├─ 未达阈值 → 指数退避重试
  │   └─ 达到 maxConsecutiveFailures
  │       └─ 切换到 fallback 模型 (claude-sonnet-4-6)
  │          ├─ 本次议题后续全部使用 fallback
  │          └─ 日志记录回退事件
  └─ 超时 → 视为失败
```

回退是**议题级别**的: 一旦在某议题中触发回退，该议题后续所有轮次都用 fallback 模型，避免反复切换导致立场不一致。

## 5. Prompt 设计

### 5.1 Step① — 初始立场 (根节点)

```
System: 你是一个架构辩论专家，作为{方A/B/C}参与关于"{议题标题}"的技术辩论。
  请基于以下技术背景和用户批注，给出你的完整方案。
  要求:
  - 直接回应用户批注中的问题
  - 给出具体的技术方案（含伪代码/示例）
  - 用简短易懂的例子解释核心概念
  - 如果批注观点有误，直接指出并说明原因

User:
  ## 技术背景
  {sharedContext}

  ## 议题
  {topic.title}

  ## 用户批注
  {topic.annotations}

  ## 核心问题
  {topic.coreQuestions}
```

### 5.2 Step① — 初始立场 (分歧子节点 — 已参与方)

```
System: 你是{方A}。上一轮辩论中，裁判识别出以下分歧点，你是其中一方。
  请基于你之前的立场，针对此分歧进一步阐述:
  - 补充新论据支持你的观点
  - 如果你认为自己之前的立场需要修正，坦率说明
  - 保持简短: 只讨论此分歧点，不重复已有共识

User:
  ## 分歧点
  {divergence.title}

  ## 各方立场
  {divergence.sides}

  ## 你在上一轮的完整立场
  {your_previous_position + rebuttal}
```

### 5.3 Step① — 初始立场 (分歧子节点 — 未参与方)

```
System: 你是{方C}。上一轮辩论中，裁判识别出以下分歧点，你在此分歧上未明确表态。
  请选择:
  (a) 支持某一方并补充论据，说明为什么
  (b) 提出不同于任何一方的第三方意见
  保持简短，聚焦此分歧点。

User:
  ## 分歧点
  {divergence.title}

  ## 现有各方立场
  {divergence.sides}

  ## 你在上一轮的完整立场 (供参考)
  {your_previous_position + rebuttal}
```

### 5.4 Step② — 反驳修正

```
System: 你是{方A}。你已经对当前分歧表达了立场，现在看到了其他方的立场。
  请:
  1. 指出其他方方案的弱点
  2. 吸收合理观点修正自身方案
  3. 如果发现自己有误，坦率承认
  4. 保持简短: 只反驳关键分歧，不重复共识

User:
  ## 你的立场
  {your_step1}

  ## 其他方的立场
  {other_parties_step1}
```

### 5.5 Step③ — 裁判搜集 (Triage)

```
System: 你是独立评审裁判。三方已完成本轮的立场和反驳。
  你的任务是识别合意和分歧:
  1. 列出所有达成共识的要点 (consensus)
  2. 列出仍有分歧的要点 (divergences)，每个分歧标注参与方和核心立场
  3. 对于未参与某分歧的辩方，标记为 uninvolved

  **你必须输出以下 JSON 格式** (在 ```json 代码块内):
  {
    "consensus": [{ "point": "共识标题", "detail": "具体内容" }],
    "divergences": [{
      "id": "d1",
      "title": "分歧标题",
      "sides": { "party-a": "A的核心主张", "party-b": "B的核心主张" },
      "uninvolved": ["party-c"]
    }]
  }

  如果所有方都达成共识，divergences 应为空数组。

User:
  ## 议题/分歧点
  {current node topic}

  ## 原始用户批注
  {annotations}

  ## 方 A: 立场 + 反驳
  {partyA_position + rebuttal}

  ## 方 B: 立场 + 反驳
  {partyB_position + rebuttal}

  ## 方 C: 立场 + 反驳
  {partyC_position + rebuttal}
```

### 5.6 Step③ — 裁判强制裁决 (达到 maxRounds)

```
System: 你是独立评审裁判。辩论已达到最大轮数限制 ({maxRounds} 轮)。
  以下分歧未能在辩论中达成共识，你需要做出最终裁决。
  对每个分歧:
  1. 给出你的推荐方案
  2. 说明选择理由
  3. 用**简短易懂的例子**解释
  4. 如果用户批注有误，直接指出为什么

  输出 JSON (在 ```json 代码块内):
  {
    "consensus": [...],
    "divergences": [],
    "forcedVerdicts": [{
      "divergenceId": "d1",
      "recommendation": "推荐方案",
      "reasoning": "选择理由"
    }]
  }

User:
  ## 原始议题与批注
  {root topic + annotations}

  ## 未解决的分歧
  {remaining divergences with full debate history}
```

## 6. 输出格式

### 6.1 单议题 Markdown (`debate/output/topic-N-title.md`)

输出是树状结构，反映递归辩论的真实路径:

```markdown
# 辩题 N: {title}

> 日期: {date}
> 参与模型: {debaters} (含回退信息)
> 评审模型: {reviewer}
> 最大轮数: {maxRounds}
> 实际深度: {actualDepth}

---

## Round 1 (根议题)

### 立场

#### 方 A — {model}
{position}

#### 方 B — {model}
{position}

#### 方 C — {model} (回退自 gemini → sonnet)
{position}

### 反驳

#### 方 A 的反驳
{rebuttal}
...

### 裁判搜集

**合意:**
- {consensus points}

**分歧 (2 个):**
1. D1: {title} — 方A vs 方B
2. D2: {title} — 方A vs 方C

---

## Round 2 — 分歧 D1: {title}

### 立场
...
### 反驳
...
### 裁判搜集
**合意:** ...
**(已收敛 ✓)**

---

## Round 2 — 分歧 D2: {title}

### 立场
...
### 反驳
...
### 裁判搜集
**合意:** ...
**剩余分歧:**
1. D2.1: ...

---

## Round 3 — 分歧 D2.1: {title} (强制裁决)

**裁判推荐:** ...
**理由:** ...

---

## 最终结论

### 合意要点
(从所有节点的 consensus 汇总)

### 裁决要点
(从 forcedVerdicts 汇总)

### 辩论路径概览
(树状结构的简图)
```

### 6.2 汇总文件 (`debate/output/summary.md`)

```markdown
# 辩论汇总

> 日期: {date}

| # | 议题 | 轮数 | 合意数 | 分歧数 | 强制裁决 |
|---|------|------|--------|--------|---------|
| 6 | ... | 2 | 5 | 1 | 1 |

## 各议题结论
### 议题 6: ...
- 合意: ...
- 裁决: ...

## 需要更新到 comparison-and-decisions.md 的内容
（具体修改建议）
```

## 7. 代码结构

```
debate/
├── ARCHITECTURE.md          ← 本文件
├── config.json              ← 辩论配置（模型、议题）
├── run.ts                   ← 主入口 (CLI 解析 + 流程编排)
├── lib/
│   ├── types.ts             ← DebateNode / JudgmentResult / Config 类型
│   ├── api.ts               ← OpenAI 兼容 API 调用 + 回退逻辑
│   ├── prompts.ts           ← 按节点类型/步骤构建 prompt
│   ├── round.ts             ← 单轮执行: position → rebuttal → triage
│   ├── tree.ts              ← 递归树遍历: 分歧展开 + 终止判断
│   └── output.ts            ← 树 → Markdown 渲染
└── output/                  ← 生成的辩论记录
    ├── topic-6-xxx.md
    └── summary.md
```

### 7.1 模块职责

| 模块 | 职责 | 依赖 |
|------|------|------|
| `types.ts` | 纯类型定义，无运行时代码 | 无 |
| `api.ts` | `callModel(model, messages)` — fetch + 重试 + 回退 | types |
| `prompts.ts` | `buildPositionPrompt(node, party)` 等 — 纯函数 | types |
| `round.ts` | `executeRound(node)` — 编排单轮三步 | api, prompts |
| `tree.ts` | `debateTopic(topic, config)` — 递归入口 | round |
| `output.ts` | `renderTree(root)` — 深度优先遍历生成 Markdown | types |
| `run.ts` | CLI 入口: 读 config → 逐议题调 tree → 输出 | 全部 |

## 8. 关键设计决策

### 8.1 为什么树状递归而不是固定轮数

固定 3 轮的问题:
- 简单议题 1 轮就能达成共识，后 2 轮是浪费
- 复杂议题 3 轮可能不够，某些分歧被忽略
- 各分歧深度不同，强制对齐轮数不合理

树状递归的优势:
- 有分歧才深入，无分歧早停 → 成本弹性
- 每个分歧独立深度 → 精力聚焦
- 裁判做 triage 而不是直接裁决 → 延迟判断，减少偏见

### 8.2 裁判为什么输出结构化 JSON

- 程序可解析: 自动判断是否需要递归
- 明确边界: JSON schema 强制裁判区分 consensus/divergence
- 可验证: 如果 JSON 解析失败，重试或人工介入

### 8.3 为什么回退是议题级别

如果 gemini 在一个议题的 Round 2 回退到 sonnet:
- Round 1 用的是 gemini 的观点
- Round 2 开始用 sonnet
- sonnet 需要"继承" gemini R1 的立场，但它是不同模型，理解可能不一致

更好的做法: 一旦回退，这个议题后续全部用 sonnet，立场一致性优先。
如果 gemini 在议题间恢复稳定，下一个议题可以重新尝试 gemini。

### 8.4 上下文膨胀控制

递归越深，累积的辩论内容越多。控制策略:
- 子节点只继承**本分歧相关**的立场摘要，不继承兄弟分歧的内容
- 裁判 triage 输出的 `sides` 是摘要（非全文），作为子节点的输入
- 每个辩方在子节点中只看到自己的历史全文 + 其他方的摘要

### 8.5 零依赖 API 调用

只用 `fetch`，不需要安装任何 SDK。OpenAI 兼容 API 的 chat completion 格式:

```typescript
const response = await fetch(`${baseURL}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model,
    messages,
    max_tokens: maxTokensPerResponse,
    temperature
  })
})
```

## 9. 执行示例

```bash
# 基本用法
npx tsx debate/run.ts --config debate/config.json

# 指定最大轮数
npx tsx debate/run.ts --config debate/config.json --max-rounds 4

# 只运行某个议题
npx tsx debate/run.ts --config debate/config.json --topic topic-6

# 干运行 (只生成 prompt，不调用 API)
npx tsx debate/run.ts --config debate/config.json --dry-run
```

## 10. 待确认

1. **模型列表**: gpt-5.2 / kimi-k2.5 / gemini-3.1-pro-preview (回退 sonnet) + qwen3.5-plus 评审？
2. **API 端点**: 单一网关还是多端点？
3. **批注议题拆分**: 合并相关批注为 1-2 个议题还是逐条？
4. **输出后处理**: 辩论后自动更新文档还是先人工审核？
