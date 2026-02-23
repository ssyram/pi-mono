# 辩题 3: 史官上下文管理
# Topic 3: Historian Context

> 日期: 2026-02-23
> 参与模型: claude-sonnet-4-6, gpt-5.2, kimi-k2.5, qwen3.5-plus
> 评审模型: qwen3.5-plus

---

## 第一轮：初始立场

### Party A — 初始立场 (gpt-5.2)

## 方 A 核心主张

**史官应采用“父进程预构建（prefetch + summarize）为主，史官自获取（read）为辅”的混合模式**：  
- **默认走预构建**：由丞相/九卿在“已知本轮发生了什么”的位置，低成本地把“最该看的增量”整理成结构化包，交给史官；史官尽量不读仓库、不跑大范围检索。  
- **允许受控自获取**：当预构建信息不足或出现疑点时，史官只在“白名单路径 + 严格预算 + offset 限定”的前提下 read 少量文件/片段做核验。

这等价于把 CC V11 的“PreToolUse 预构建 prompt”思想迁移到 Pi：**不是靠 hook 魔法把一切塞进 prompt，而是靠 Pi 的 `context` 事件/`before_agent_start`/`sendMessage(nextTurn)` 在“史官启动前”形成一个可控的上下文包**。这样既降低 token 浪费，又避免让史官为获取上下文到处读文件（高成本且容易越界）。

---

## 1) 预构建 vs 自获取：立场与实现

### 为什么预构建更优（默认）
史官是零状态，最大的成本来自“每次重建上下文”。如果让史官自获取，它必须：
- 扫 `context.md`、历史建议、delegate 产物、git 变更、甚至运行日志；
- 再自己判断哪些重要。  
这会造成**重复 read + 重复 token**，而且 read 的覆盖面难以硬约束。

### 为什么必须保留受控自获取（兜底）
预构建在边缘情况会漏信息：比如某个 worker 输出未进入汇总、或者 git diff 太大导致丞相摘要失真。史官需要**最小核验能力**，但只能是“点查”。

### Pi 上的具体实现（可落地）
把史官的输入拆成两层：

**A. 预构建的“史官包 HistorianPacket”（强制提供）**  
由丞相主进程在每轮结束前组装，存储为持久化条目（`appendEntry`）并通过 `sendMessage({deliverAs:"nextTurn"})` 给到下一轮丞相（用于注入史官）。史官启动时不必 read 仓库即可工作。

**B. 受控自获取（可选）**  
史官子进程只开 `read` 工具，但其 systemPrompt 强约束：只允许读取指定文件（例如 `.court/packets/*.json`、`context.md`、`.court/offsets.json`、`pending-advice.md`），且每次最多读 N 次、每次最多 M 行/字符（如果 read 工具支持范围参数就用；不支持则用分块文件）。

> 关键点：**史官优先读“预构建包文件”而不是全仓库**。即使“自获取”，也是读取“丞相已经裁剪过的二次材料”，而不是一手材料。

### CC / OC 对齐
- CC V11：预构建在 PreToolUse 完成，我们在 Pi 用 `context`/`before_agent_start` 达到类似效果；“自循环史官”在 Pi 不必照搬（Pi 有 `agent_end` 触发点），但“史官尽量不读文件”的精神一致。
- OC：用 `messages.transform` 直接把 HistorianPacket 注入史官消息数组；如需兼容 CC hooks，可用 `createClaudeCodeHooksHook` 桥接把 packet 放到 additionalContext。

---

## 2) context.md 格式：从“经验句子”升级为“可裁剪的分区记忆”

你现在的 `Details + Experiences(≤30字)`可作为“人读概要”，但对自动裁剪/增量注入不够友好。建议把长期记忆拆成**稳定结构 + 可滚动区**，并加上“重要性/过期策略”。

推荐 `context.md`（或拆成 `context.yml` + `context.md`）结构：

```markdown
# CourtContext v2

## Details (stable)
- repo: ...
- goal: ...
- constraints:
  - chancellor: read+delegate only
  - historian: read only, stateless
- architecture: ...
- non_goals: ...

## Policies (stable)
- coding_style: ...
- testing: ...
- security: ...
- tool_rules: ...

## Glossary (stable)
- term: definition

## Experiences (rolling, capped)
- id: exp_2026-02-23_001
  tags: [git, refactor]
  importance: high|med|low
  ttl: 30d
  text: "……(<=60字，允许略长但强制短句)"
```

并额外引入一个机器友好的裁剪索引文件（更关键）：

`.court/memory_index.json`
```json
{
  "stable_sections": ["Details","Policies","Glossary"],
  "rolling_cap": { "max_items": 80, "max_tokens": 1200 },
  "ranking": ["importance", "recency", "tag_match"]
}
```

史官每次不需要整份 context.md；只需注入：
- stable 的“极短摘要”（例如 300-600 tokens）
- rolling 的 topK（例如 10-20 条），且与本轮主题 tag 匹配

这能显著降低 token，并让“零状态史官”仍保持一致性。

---

## 3) Offset tracking：统一为“多源游标 CursorSet”

CC 的 `git_log_offset` 本质是“上次处理到哪里”。Pi 的 `appendEntry` 可以记录“上次史官看过的包/事件”。统一概念为：

`.court/cursors.json`
```json
{
  "git": { "last_commit": "abc123", "last_time": 1700000000 },
  "delegates": { "last_task_id": 812, "last_packet_seq": 45 },
  "advice": { "last_advice_id": "adv_..." },
  "context": { "memory_version": 2, "last_compact_at": 1700000000 }
}
```

### 更新规则（硬约束）
- **丞相负责写 cursor**（史官零状态不写仓库；史官子进程也不应产生副作用）。
- cursor 更新发生在两个确定点：
  1) 丞相收到所有 delegate 汇总后，生成 HistorianPacket 前；
  2) 丞相采纳/拒绝史官建议后，将结果写回 cursor（例如 `last_advice_id`）。

在 Pi 中，cursor 存储可用两种路径：
- 推荐：写入 repo 的 `.court/cursors.json`（可审计、跨平台一致）；
- 或：用 `appendEntry("cursors", ...)` 做 session 内持久化（不进 LLM），但跨运行迁移较弱。实际可以“双写”：repo 为准，appendEntry 为缓存。

---

## 4) 信息来源与“给多少”：基于分层采样与预算的 HistorianPacket

史官需要的信息来源你列得对，但关键是**每次给多少**要有硬预算。建议把输入分为 5 个必选区 + 2 个可选区，并每区设 token 上限。

### HistorianPacket（结构化，建议 JSON）
存为 `.court/packets/hist_pkt_<seq>.json`，并在启动史官时注入“文件路径 + 摘要头”。

```json
{
  "seq": 46,
  "time": 1700000000,
  "cursors_before": {...},
  "round": {
    "chancellor_decisions": [
      {"id":"d1","text":"本轮决定...","rationale":"...","risk":"..."}
    ],
    "delegates_summary": [
      {"task_id":812,"owner":"minister_x","status":"done","summary":"...","artifacts":["path1","path2"]}
    ],
    "worker_results": [
      {"task_id":813,"summary":"...","tests":"...","diffstat":"+120 -30"}
    ]
  },
  "git_delta": {
    "from": "abc123",
    "to": "def456",
    "high_level": "改动概述(<=200字)",
    "diffstat": "...",
    "hot_files": ["a.ts","b.md"],
    "risk_spots": ["migration.sql", "auth.ts"]
  },
  "memory_slice": {
    "stable_brief": "...(<=400 tokens)",
    "experiences_top": ["...","..."]
  },
  "previous_advice": [
    {"id":"adv_45","accepted":true,"text":"...","note":"..."}
  ],
  "budget": {
    "max_input_tokens": 2500,
    "allow_read": true,
    "allowed_paths": [".court/packets/...", "context.md", ".court/cursors.json", "pending-advice.md"]
  }
}
```

### 采样策略（决定“给多少”）
- **丞相/九卿就地汇总**：delegate 返回时就生成 1-2 句摘要 + 风险点，避免史官去读长输出。
- **git_delta 只给 diffstat + 热点文件 + 风险片段标题**：不要直接塞完整 diff（除非小于阈值）。
- **之前史官建议**：只给最近 1-3 条，且只给“被采纳/争议”的。

这样史官能在 2k-3k tokens 内形成高质量监督意见；只有当“risk_spots”命中高危文件时，才触发受控 read 做点查。

---

## 5) 增量 vs 全量：默认增量，全量只在“压缩/漂移”时触发

**默认增量**：史官每次只看：
- 本轮丞相决策
- 自上次 cursor 以来的 delegate 汇总
- git 从 `last_commit` 到 `HEAD` 的 delta 摘要
- memory_slice（稳定简述 + topK 经验）

**触发全量（但仍裁剪）**的条件：
- `session_before_compact` 后（上下文被重整，可能丢细节）
- 连续 N 轮史官指出“信息不足/漂移”
- 发生大重构（diffstat 超阈值，或目录级迁移）

即便“全量”，也应是“全量摘要”（比如把最近 20 轮 packet 重新 summarize 成 1 个 `meta_packet`），而不是把所有历史原样灌给史官。

---

## 6) 上下文大小控制：两级预算 + 强制裁剪点

### 预算建议
- 史官单次输入（system+user+packet 摘要）控制在 **≤ 3k tokens**（更高会吞掉监督产出性价比）。
- 史官允许 read：最多 **3 次**，每次仅限指定小文件或 packet（避免扫 repo）。

### Pi 的具体控制点
- **`context` 事件**：对丞相主对话做裁剪（把已完成任务替换为摘要），并在这里生成“本轮给史官的摘要头”（不必把长内容放进主上下文）。
- **`agent_end`**：丞相循环结束时阻塞生成 packet 文件 + 更新 cursors，然后 spawn 史官子进程（`--no-session --mode json`）读取 packet 并输出 advice。
- **`before_agent_start`**：下一轮开始时，把史官 advice 用 systemPrompt 注入“必须回应/采纳或解释拒绝”（硬约束），同时用 `setActiveTools()` 确保丞相仍然 read+delegate only。

### CC / OC 的控制点
- CC：PreToolUse 构建 packet 摘要注入，PostToolUse 用 stderr 把 advice 送回；用 pending-advice.md 做原子读清（与 Pi 的 `.court/packets/` 类似）。
- OC：`messages.transform` 直接注入 packet 摘要；必要时后台 `task(run_in_background=true)` 生成 packet（模拟 Pi 的 agent_end 阻塞阶段）。

---

## 优势与风险

### 优势
1. **token 成本可控**：史官不再重复读/重复理解“全仓库”，主要消耗集中在高价值增量摘要。  
2. **硬约束更强**：史官 read 被限制到“二次材料 + 白名单路径”，不容易越权；丞相也不会被史官拉进执行细节。  
3. **跨平台一致**：HistorianPacket + CursorSet 是平台无关的数据协议；Pi/CC/OC 只是不同注入与传递手段。  
4. **审计性**：packet 与 cursor 落盘后可追溯“史官基于什么提出建议”。

### 风险与对策
- **风险 1：预构建摘要失真**  
  对策：risk_spots 命中时允许史官点查；同时要求 delegate 输出必须包含“可核验指标”（diffstat/测试结果/文件列表）。
- **风险 2：实现复杂度上升**（packet/cursor/裁剪逻辑）  
  对策：先做最小闭环：只记录 `chancellor_decisions + delegates_summary + git_delta(diffstat)`；逐步扩展 memory_slice 与核验读。
- **风险 3：阻塞与性能**（Pi 的 agent_end spawn 史官会延迟下一轮）  
  对策：把史官变成“软实时”：在 `agent_end` 生成 packet 并 spawn 史官，但 advice 用 `sendMessage(deliverAs:"nextTurn")` 注入下一轮即可；同时限制史官 read 次数，确保结束可预期。

---

## 跨平台适配策略（Pi 为主，CC/OC 为辅）

### 统一协议层（必须）
- `.court/cursors.json`
- `.court/packets/hist_pkt_<seq>.json`
- `pending-advice.md`（可选，用于兼容 CC 进言通道；Pi 可不必依赖）

### Pi 实现要点（主平台）
- `agent_end`：生成 packet、更新 cursor、spawn 史官子进程、拿到 advice → `appendEntry` 归档 + `sendMessage(nextTurn)` 注入。
- `context` + `session_before_compact`：负责主会话裁剪与 meta_packet 生成（当触发全量摘要时）。
- `before_agent_start`：把史官 advice 作为 systemPrompt 强制丞相回应；`setActiveTools` 维持硬限制。

### CC 实现要点（辅平台）
- PreToolUse：把 packet 摘要注入史官/管家 prompt（模拟 Pi 的“预构建”）。
- PostToolUse + pending-advice.md：回传 advice。
- git_log_offset 映射到 `.court/cursors.json.git.last_commit`，保持同一语义。

### OC 实现要点（辅平台）
- `messages.transform`：直接注入 packet 摘要（最强注入点）。
- 后台 task：生成/更新 `.court/packets` 与 `.court/cursors.json`（补齐无法 spawn agent 的缺口）。

---

**结论**：方 A 主张用“协议化的增量包（HistorianPacket）+ 统一游标（CursorSet）”取代“史官每轮自读全世界”。在 Pi 上用 `agent_end` 生成包、spawn 零状态史官、下一轮注入建议；在 CC/OC 上分别用 hooks / messages.transform 复用同一协议。这样在硬约束、token 成本、跨平台一致性三者之间取得最优折中。

---

### Party B — 初始立场 (kimi-k2.5)

# 方 B：「自获取 + 智能摘要」方案

## 核心主张

**史官应当自主获取上下文，而非依赖预构建。** 但这不是简单的"让史官自己读文件"，而是通过三层机制实现高效、可控、可审计的上下文管理：

1. **分层信息架构**：区分「必给」「按需」「历史归档」三类信息
2. **增量追踪协议**：统一 offset 概念，支持跨平台适配
3. **自适应摘要**：context 事件动态压缩，控制 token 成本

我的立场与 CC V11 预构建方案形成鲜明对比：拒绝复杂的 hook 编排，拥抱 Pi 的原生事件系统，同时通过结构化设计避免 token 浪费。

---

## 一、信息分层架构：五源三阶模型

### 五类信息来源（按优先级排序）

| 优先级 | 来源 | 内容 | 获取方式 |
|:---|:---|:---|:---|
| P0 | 本轮触发事件 | `agent_end` payload 含丞相决策摘要 | 事件参数直接传入 |
| P1 | 活跃子任务状态 | 进行中/刚完成的 delegate 结果 | 读取 `.court/pending-tasks.jsonl` |
| P2 | 项目记忆核心 | context.md 的 Details + 最近 Experiences | 读取固定路径，限制条数 |
| P3 | 代码变更快照 | 自上次 offset 以来的 git diff --stat | 执行 git 命令 |
| P4 | 历史归档 | 完整史官记录、早期经验 | 不直接读取，由 context 事件预过滤 |

### 三阶访问控制

```
┌─────────────────────────────────────────┐
│  TIER 1: 热数据 (必给, ~500 tokens)      │
│  - 本轮决策摘要                          │
│  - 活跃任务状态 (≤3个)                   │
│  - 项目核心元数据                        │
├─────────────────────────────────────────┤
│  TIER 2: 温数据 (按需, ~1500 tokens)     │
│  - 最近 Experiences (≤10条)              │
│  - 精简 git 变更概览                     │
│  - 上轮史官建议                          │
├─────────────────────────────────────────┤
│  TIER 3: 冷数据 (引用, 不计入)            │
│  - 完整历史记录 (appendEntry 持久化)      │
│  - 早期经验条目                          │
│  - 详细 commit log                       │
└─────────────────────────────────────────┘
```

---

## 二、Offset Tracking：统一增量协议

### 核心设计：`court-offsets.json`

```json
{
  "historian": {
    "lastRunAt": "2025-01-15T09:23:17Z",
    "taskCursor": 7,
    "experienceCursor": 12,
    "gitRef": "abc123def"
  },
  "chancellor": {
    "sessionStartAt": "2025-01-15T08:00:00Z",
    "totalTurns": 23
  }
}
```

### 各平台适配

**Pi Extension（主平台）**
- `appendEntry("court-offsets", json)` 持久化
- 史官 spawn 时通过 `--offset-json '{...}'` 传入
- 史官输出新 offset，父进程解析后更新

**CC V11（适配层）**
- 用 `pending-advice.md` 的 YAML frontmatter 携带 offset
- SubagentStop exit 2 时 stderr 输出 `OFFSET_UPDATE: {...}`
- 管家解析并写入 `.court/court-offsets.json`

**OC（适配层）**
- `messages.transform` 注入 offset 到 system message
- 史官作为 background task，输出写回共享文件

### Offset 语义对照

| 概念 | Pi 实现 | CC 对应 | 含义 |
|:---|:---|:---|:---|
| `taskCursor` | pending-tasks.jsonl 行号 | subagent 调用计数 | 已处理的任务边界 |
| `experienceCursor` | context.md Experiences 索引 | 同左 | 经验条目水位线 |
| `gitRef` | commit hash | git_log_offset | 代码变更锚点 |

---

## 三、技术实现：Pi 原生方案详解

### 3.1 史官启动流程（agent_end handler）

```typescript
// court-historian-spawn.ts
async function spawnHistorian(chancellorOutput: ChancellorDecision) {
  // 1. 读取当前 offset
  const offset = await readOffset();
  
  // 2. 准备 Tier 1 热数据（直接编码进启动参数）
  const hotContext = {
    decision: summarize(chancellorOutput, 200),  // 硬限制
    activeTasks: await getPendingTasks(3),        // 最多3个
    projectMeta: await getProjectDetails()        // Details 全量
  };
  
  // 3. spawn 零状态子进程
  const historian = spawn("pi", [
    "--no-session",
    "--mode", "json",
    "--tools", "read,execute_command",  // 史官只有读和 git
    "--role", "historian",
    "--hot-context", JSON.stringify(hotContext),
    "--offset", JSON.stringify(offset)
  ]);
  
  return historian;
}
```

### 3.2 史官内部自获取逻辑

```markdown
<!-- .court/agents/historian.md -->
你是史官，负责监督记录。你的上下文获取协议：

## 已接收的热数据（Tier 1）
{{hot_context}}  <!-- 从启动参数注入 -->

## 你需要自获取的温数据（Tier 2）
按以下顺序执行：

1. [READ] .court/context.md 
   - 只读取 Experiences 部分
   - 从 offset.experienceCursor 开始，最多 10 条
   
2. [EXECUTE] git diff --stat {{offset.gitRef}}..HEAD
   - 若输出超过 20 行，只保留前 15 行 + "..."

3. [READ] .court/advice-queue.jsonl
   - 只读取最后一行（上轮建议）

## 输出格式
```json
{
  "observations": ["...", "..."],  // 客观事实，≤5条
  "concerns": ["...", "..."],      // 风险警示，可选
  "advice": "...",                 // 给丞相的建议，≤100字
  "newOffset": { ... },            // 更新的游标
  "memoryUpdate": {                // 需要写入 context.md 的
    "newExperience": "..."         // ≤30字，或 null
  }
}
```
```

### 3.3 Context 事件：动态压缩（关键优化）

```typescript
// 在丞相主进程的 context handler 中
on("context", (event) => {
  const messages = event.messages;
  
  // 识别史官相关的历史消息
  const historianPattern = /\[史官记录\]|Historian output/;
  
  // 替换策略：保留摘要，丢弃详情
  const compressed = messages.map(m => {
    if (m.role === "assistant" && historianPattern.test(m.content)) {
      // 提取 advice 部分，其余丢弃
      const advice = extractAdvice(m.content);
      return {
        ...m,
        content: `[史官记录-归档] 建议: ${advice}`,
        _compressed: true  // 标记用于调试
      };
    }
    return m;
  });
  
  event.replaceMessages(compressed);
});
```

---

## 四、Token 成本控制模型

### 成本对比估算（单次史官调用）

| 方案 | 输入 Token | 说明 |
|:---|---:|:---|
| CC V11 预构建（全量） | ~8,000 | 管家预读所有文件，构建 mega-prompt |
|  naive 自获取（无优化） | ~6,500 | 史官自己读完整 context.md + git log |
| **本方案（分层+压缩）** | **~2,200** | Tier 1 注入 + Tier 2 限制读取 + 历史压缩 |

### 关键控制机制

```
1. 硬编码上限（不可配置，防止漂移）
   - 单文件读取: max 300 lines
   - git diff: max 20 files or 50 lines stat
   - experience 条目: max 10 条，每条 max 30 字
   - 最终 advice: max 100 字

2. 自适应降级
   - 若 Tier 2 读取后预估 token > 2500
   - 自动丢弃最旧的 experience 条目
   - 保留 git diff 的文件名列表，丢弃具体行数

3. 周期全量重置
   - 每 20 轮或 token 压力过高时
   - 触发一次 "史官大修"：完整重读 + 生成浓缩版 context.md
```

---

## 五、跨平台适配策略

### 适配矩阵

| 组件 | Pi（原生） | CC（桥接） | OC（桥接） |
|:---|:---|:---|:---|
| **史官触发** | `agent_end` spawn | `Stop hook` → spawn subagent | `task(background=true)` |
| **热数据传递** | `--hot-context` CLI arg | `additionalContext` + PreToolUse | `messages.transform` 注入 |
| **offset 传递** | `--offset` CLI arg | stderr `OFFSET:` 前缀 | 共享文件 + 文件锁 |
| **温数据获取** | 史官自读文件 | 史官自读文件（同） | 史官自读文件（同） |
| **建议回传** | stdout JSON | `pending-advice.md` + exit 2 | 共享文件 + 事件通知 |
| **历史压缩** | `context` 事件 | `PostToolUse` 清理 | `messages.transform` |

### CC 桥接的关键改造

CC V11 的 6-hook 架构过于复杂，我方主张**简化移植**：

```diff
- SessionStart: 注入启动指令
- Stop: 阻止停止，触发史官
- PreToolUse×3: 预构建上下文  ← 删除，改为史官自获取
- PostToolUse: 注入父 context  ← 简化为只传递 offset
- SubagentStop exit 2: 自循环   ← 改为单次执行，无循环

+ 保留: SessionStart（初始化）
+ 保留: Stop（触发史官 spawn）
+ 新增: PostToolUse（解析史官输出的 OFFSET_UPDATE）
+ 删除: PreToolUse 预构建逻辑（核心差异）
```

** rationale**: CC 的 PreToolUse 预构建是为了弥补 subagent 完全隔离的限制。但 Pi 的 spawn 已经天然隔离，且 `--hot-context` 足以传递必要信息。强行复制 CC 的复杂 hook 链是**过度工程**。

---

## 六、优势与风险分析

### 核心优势

| 维度 | 论证 |
|:---|:---|
| **简单性** | 无复杂 hook 编排，Pi 原生事件即可实现；史官逻辑自包含，可独立测试 |
| **可审计** | 每次史官的输入（hot-context）和输出（JSON）都是确定性的，便于 replay |
| **弹性伸缩** | 温数据读取量可根据当前 token 压力动态调整，预构建无法做到 |
| **跨平台一致** | 史官的自获取逻辑在各平台完全相同，只有"如何启动史官"需要适配 |

### 潜在风险与缓解

| 风险 | 概率 | 缓解措施 |
|:---|:---|:---|
| 史官读取过多文件导致 token 爆炸 | 中 | 硬编码上限 + 自适应降级；超限则报错而非静默截断 |
| offset 不一致导致重复/遗漏记录 | 低 | offset 更新原子化（write-then-rename）；启动时校验 checksum |
| 频繁 spawn 子进程性能损耗 | 低 | 史官执行时间 < 2s，spawn 开销占比 < 15%；必要时可缓存 warm data |
| 与 CC 生态兼容性争议 | 高 | 提供双向适配层：既支持本方案，也支持 CC 模式作为 fallback |

---

## 七、结论

我方主张的「自获取 + 智能摘要」方案，不是对 CC V11 的简单否定，而是**针对 Pi 平台特性的重新设计**：

- 放弃预构建的复杂性，换取运行时的灵活性
- 用分层架构替代全量/增量的二元对立
- 以 offset 协议实现跨平台统一，而非强制统一实现方式

最终目标：**史官应当是"聪明的读者"而非"被动的接收者"**——它理解自己的信息需求，懂得在约束下做取舍，这正是 LLM Agent 的核心价值所在。

---

### Party C — 初始立场 (claude-sonnet-4-6)

# 方 C：史官上下文管理方案 — 结构化增量自获取

## 核心主张

**史官应采用"结构化增量自获取"模式**：史官拥有极简但精准的读取工具集，通过标准化的 offset 机制自主拉取增量信息，而非由外部 hook 预构建完整 prompt。这不是"自获取"的简单辩护，而是基于一个根本判断：**史官的智能应体现在信息筛选上，而非信息搬运上**。

预构建方案（CC V11）将上下文组装逻辑固化在 hook 层，hook 决定史官"看到什么"。这导致 hook 越来越臃肿，且史官对信息的理解依赖 hook 作者的预判。自获取方案则让史官用自己的判断决定"需要看什么"——这与史官"独立监督者"的角色定位天然契合。

---

## 具体技术方案

### 1. 史官的工具集（硬约束）

史官通过 `setActiveTools()` 只获得以下工具（Pi Extension 实现）：

```javascript
// agent_end 事件中 spawn 史官子进程
pi.on('agent_end', async (event) => {
  const historian = spawn("pi", [
    "--no-session",
    "--mode", "json",
    "--tools", "read_file,list_dir,get_entries",  // 硬约束
    "--env", "PI_COURT_ROLE=historian"
  ]);
});
```

三个工具的职责：
- `read_file`: 读取 `context.md`、`pending-advice.md`（如有）
- `list_dir`: 扫描项目结构（仅限 `.pi/` 目录）
- `get_entries`: **关键工具**，读取 appendEntry 持久化的结构化记录，支持 offset 参数

`get_entries` 是方案的核心。它不是通用文件读取，而是专门面向 Pi Extension 的 appendEntry 日志系统设计的查询接口：

```typescript
// get_entries 工具签名
interface GetEntriesParams {
  from_offset?: number;    // 从哪条记录开始读
  limit?: number;          // 最多读多少条（默认 20）
  type_filter?: string[];  // 只看特定类型: ["delegate_result", "decision", "error"]
}

interface EntryRecord {
  offset: number;
  timestamp: string;
  type: "decision" | "delegate_result" | "git_commit" | "historian_advice";
  content: string;
  metadata?: Record<string, unknown>;
}
```

### 2. Offset Tracking 机制

**统一 offset 概念**：offset 是 appendEntry 日志的全局序列号，单调递增，跨平台语义一致。

史官每次运行结束前，通过 appendEntry 写入自己的 offset 记录：

```json
{
  "type": "historian_checkpoint",
  "offset": 47,
  "timestamp": "2025-01-15T10:30:00Z",
  "advice_summary": "建议丞相关注 API 错误率上升趋势"
}
```

下次史官启动时，第一步就是读取最新的 `historian_checkpoint`，获得上次处理到的 offset，然后调用 `get_entries({ from_offset: 47 + 1, limit: 30 })`。

这解决了 CC V11 方案中 `git_log_offset` 的问题：git offset 只追踪代码变更，而 appendEntry offset 追踪**所有决策事件**，包括非 git 的纯对话决策。

**跨平台 offset 适配**：

| 平台 | Offset 存储 | 读取方式 |
|------|------------|---------|
| Pi Extension | appendEntry 原生 | `get_entries` 工具 |
| CC | `pending-advice.md` 末尾附加 offset 行 | 读文件解析 |
| OC | `messages.transform` 注入 offset 到 system prompt | 史官从 system 读取 |

### 3. context.md 格式重设计

当前格式（Details + Experiences ≤30字）**不够用**，需要增加结构层次：

```markdown
# Project Context

## Identity
- project: court-demo
- chancellor_session: sess_abc123
- created: 2025-01-10

## Current State
<!-- 丞相最近一次写入，描述项目当前状态 -->
正在实现用户认证模块，API 设计已完成，等待数据库 schema 确认。

## Active Concerns
<!-- 史官写入，丞相下次启动时 before_agent_start 注入 -->
- [HIGH] 数据库连接池配置未设置上限，高并发风险
- [MED] 测试覆盖率低于 60%，建议在完成认证前补测试

## Experiences
<!-- 每条格式: [类型] 内容 (offset范围) -->
- [PATTERN] 九卿并行委托时需要明确边界，否则产生重复工作 (off:12-18)
- [DECISION] 选择 JWT 而非 session cookie，理由：无状态扩展性 (off:23)
- [ERROR] delegate 超时未处理导致丞相卡住，已修复 (off:31)

## Historian Log
last_checkpoint_offset: 47
last_run: 2025-01-15T10:30:00Z
```

关键改动：
- `Active Concerns` 是史官写给丞相的**下次建议**，格式化便于 `before_agent_start` 直接注入
- `Experiences` 带 offset 范围，史官可以用 offset 快速定位详细记录
- `Historian Log` 显式存储 checkpoint，即使 appendEntry 系统故障也有降级方案

### 4. 史官运行时的信息获取流程

史官 spawn 后，按以下顺序自主获取信息：

```
Step 1: read_file("context.md")
  → 获取项目全局状态、上次 checkpoint offset

Step 2: get_entries({ from_offset: last_offset+1, limit: 30 })
  → 获取自上次以来的所有事件（增量）

Step 3: [条件] 如果增量中有 git_commit 类型
  → read_file(".pi/git-summary.md")  # 丞相每次提交后更新的摘要
  → 不直接跑 git log（史官无 shell 工具）

Step 4: [条件] 如果 Active Concerns 已有 HIGH 级别且未解决
  → 检查增量中是否有相关的 decision 记录
  → 判断是否需要升级或降级关注级别

Step 5: 生成分析，更新 context.md 的 Active Concerns 和 Experiences
Step 6: appendEntry({ type: "historian_checkpoint", offset: current_max })
```

**大小控制**：`get_entries` 的 `limit: 30` 是硬上限。30 条结构化记录约 3000-5000 tokens，加上 context.md（约 1000 tokens），史官单次运行总输入控制在 **8000 tokens 以内**。

如果增量超过 30 条（说明丞相工作量很大），史官优先处理最新的 30 条，并在 checkpoint 中记录"存在未处理记录"，下次运行时优先补处理旧记录。

### 5. Token 成本分析

**预构建方案（CC V11）的隐藏成本**：
- Hook 逻辑本身是 TypeScript 代码，维护成本高
- 每次 PreToolUse 都运行 hook 逻辑，即使不需要史官
- Hook 预判错误导致史官获得错误信息，且无法自我纠正

**方 C 方案的实际成本**：

| 阶段 | Token 消耗 | 说明 |
|------|-----------|------|
| context.md 读取 | ~1000 | 固定成本 |
| 增量 entries 读取 | ~3000-5000 | 30条上限 |
| 史官 LLM 推理 | ~2000 (output) | 生成建议 |
| **总计** | **~6000-8000** | 每次史官运行 |

相比预构建方案，自获取增加了 1-2 次工具调用（约 500 tokens），但换来了：
- 史官可以根据情况决定是否需要读额外文件（避免不必要的 context 膨胀）
- 无需维护复杂 hook 逻辑

### 6. 跨平台适配策略

**Pi Extension（主平台）**：完整实现，`agent_end` spawn + `get_entries` 工具 + appendEntry offset。

**CC 适配**：
- `get_entries` 降级为读取 `pending-advice.md`（文件格式兼容 JSON Lines）
- offset 存储在文件末尾的 `# CHECKPOINT: 47` 注释行
- `SubagentStop exit 2` 实现史官自循环，但 offset 机制保持一致

**OC 适配**：
- `messages.transform` 在 system prompt 中注入当前 offset
- 史官作为 `.opencode/agents/historian.md` 定义的 subagent
- `get_entries` 通过读取本地 JSON Lines 文件实现

---

## 方案优势

1. **史官保持真正的独立性**：史官自己决定看什么，不被 hook 作者的预判限制。这与"独立监督者"角色一致——如果史官的视野由别人决定，它的独立性就是假的。

2. **增量机制天然防止上下文膨胀**：offset 追踪保证史官只处理新信息，项目越大越重要。

3. **故障降级有路径**：即使 appendEntry 系统出现问题，context.md 中的 `last_checkpoint_offset` 提供了降级读取点。

4. **工具约束即角色约束**：史官只有 read 类工具这一事实，从硬约束层面保证它不会"越权行事"。

## 潜在风险及应对

**风险1：史官读取顺序错误导致分析偏差**
→ 应对：在史官的 system prompt 中明确规定读取顺序（Step 1-6），这是软约束，但 system prompt 每次通过 `before_agent_start` 注入，相对可靠。

**风险2：30条 limit 在高强度工作时丢失信息**
→ 应对：`historian_checkpoint` 记录"存在未处理记录"标志，下次优先处理。丢失的是细节，不是决策——决策会在 context.md 的 `Current State` 中体现。

**风险3：context.md 并发写入冲突（丞相和史官都写）**
→ 应对：Pi Extension 中，`agent_end` 是阻塞事件，史官 spawn 时丞相已停止，不存在并发。CC 中通过文件锁或分离文件（`context-historian.md` vs `context-chancellor.md`）解决。

---

## 结论

预构建方案是一种**工程上的过度控制**——它试图通过 hook 逻辑来代替史官的判断力。方 C 的结构化增量自获取方案，将 hook 的职责限制在"触发史官运行"，而非"决定史官看什么"。这不仅更符合史官的角色定位，也在工程上更可维护、更容易跨平台迁移。史官的价值在于它的分析，不在于它获取信息的效率——而精准的 offset 机制已经把获取成本压到了合理范围。

---

## 第二轮：反驳与修正

### Party A — 反驳 (gpt-5.2)

### 一、对方方案的具体弱点与风险

**对方 B（“自获取 + 智能摘要”）的问题**
1) **offset 语义不统一、实现割裂**：B 把 offset 拆成 `taskCursor/experienceCursor/gitRef` 三套水位线。结果是：同一轮史官要维护多处一致性（文件行号、experience 索引、commit hash），一旦任一源缺失/重写（比如 context.md 重排、rebase）就会出现重复或漏读，且跨平台迁移成本高。  
2) **史官工具集过宽**：B 允许史官 `execute_command` 跑 git。史官是“独立监督者”，但也是“零状态且硬约束”，给 shell 会把“监督”变成“准执行者”，风险包括：读到过多 diff、命令失败噪声、在 CC/OC 上难以等价实现。  
3) **把压缩责任放在丞相的 context 事件**：B 的核心降本依赖主进程 `context` 事件对历史“史官输出”再压缩。问题是：史官本身零状态、每次重建上下文，真正的 token 杀手常常来自“史官读取的原始材料”（diff/log/context.md），而不是史官输出；压缩史官输出对下一次史官重建帮助有限。  

**对方 C（“结构化增量自获取 + get_entries”）的问题**
1) **假设了不存在的 Pi 原生工具**：`get_entries` 在给定事实里并不存在。Pi 只有 `appendEntry()`（写）而无“结构化查询 API”。可以用“读 appendEntry 存储文件”去模拟，但那又回到文件 IO，必须明确实现路径，否则方案落空。  
2) **单一全局 offset 的诱惑与陷阱**：如果把所有事件塞进一个全局序号，跨平台可统一，但现实是不同平台的事件源不一致（CC 走 pending-advice.md 中转、OC 有 messages.transform），全局 offset 的生成点必须明确“谁写、写什么、何时写、原子性如何保证”，否则会出现竞争写入或缺口。  
3) **context.md 承载过多职责**：C 把 checkpoint、Active Concerns、Current State 都写入 context.md。好处是可读，但风险是：更新频繁、易冲突、且一旦史官要“写回”就与“只读监督”角色张力增大（哪怕通过父进程代写）。

---

### 二、我的方案为何更优（方 A：**预构建热上下文 + 结构化增量自获取（无 shell）** 的折中）

我方坚持两点硬原则：**丞相只监督（read+delegate）**、**史官零状态且尽量硬约束**。因此选择“混合式”：

- **热上下文（Hot）由父进程预构建**：利用 Pi 的 `agent_end`、`context` 事件可拿到“本轮决策/已完成委托摘要/关键错误”，这部分最确定、最该给，而且预构建几乎不增加 token（父进程已有这些信息）。  
- **温上下文（Warm）由史官增量自获取，但禁止 shell**：史官只 `read`，从标准化的 **Court Event Log**（JSONL 文件）按 offset 拉取增量；git 变更不让史官跑 git，而是由九卿/工人提交时写入事件 log（或由丞相 read 后写入事件 log）。这样 CC/OC 也能等价实现。  
- **冷数据（Cold）只归档不入 prompt**：用 `appendEntry()` 做持久化归档，但不指望史官能“查询 appendEntry”，因为平台没给读接口；史官只需要增量事件 log + context.md 的极简记忆即可。

这比纯预构建更简单（不用 CC 那套多 hook 编排），也比纯自获取更省 token（史官不需要读散落文件、跑 git、扫描目录）。

---

### 三、吸收对方优点并整合

- 采纳 B 的**分层思想与硬上限**：明确 Hot/Warm/Cold，且对 Warm 增量条数、字段长度做硬限制。  
- 采纳 C 的**“增量优先”**与“史官独立判断排序”：史官拿到增量事件后，自行决定关注点；但“获取渠道”必须标准化，不依赖不存在的 `get_entries`。

---

### 四、修订后完整方案（可落地、跨平台）

#### 1) 信息来源与每次给多少
**Hot（父进程预构建，≤600 tokens）**
- 丞相本轮 decision 摘要（从本轮 assistant 输出提取，或在 delegate 结果汇总时生成）
- 本轮完成的 delegate 结果摘要（最多 3 条，每条≤80字）
- 本轮错误/超时告警（最多 5 条）

**Warm（史官增量自获取，≤1800 tokens）**
- `.court/events.jsonl` 自上次 offset 以来的事件（最多 N=30 条，超出则只取最新 30，并标记 backlog）
- `.court/context.md` 只读两个区块：Identity + Experiences（Experiences 最多 20 条）

**Cold（不进史官 prompt）**
- 史官完整输出：`appendEntry("historian.archive", ...)`
- 旧 events 分卷归档：`.court/events-0001.jsonl` 等（史官默认不读）

#### 2) context.md 格式（够用但要“可机器裁剪”）
保持你现有 Details/Experiences，但改为更可裁剪的结构：

```md
## Identity
- repo: ...
- goal: ...
- invariants: (硬约束列表)

## Experiences (max=20, each<=30字)
- [PATTERN] ...
- [ERROR] ...
- [DECISION] ...
```

不把 checkpoint 写进 context.md（避免频繁改），checkpoint 放到单独文件。

#### 3) Offset tracking 统一：**Court Cursor**
统一成一个概念：**cursor = events.jsonl 的行号/事件序号**（不是 git hash、不是多游标）。
- 存储：`.court/cursor.json`  
  ```json
  { "historian": { "cursor": 128, "backlog": false } }
  ```
- 更新：由父进程在 `agent_end` 阻塞阶段原子写入（write temp + rename），避免并发。

**git offset 如何纳入统一 cursor？**  
不再单独维护 gitRef。每次产生 git 相关信息时，写入 events.jsonl 一条：
```json
{"id":129,"type":"git","summary":"M src/a.ts, +20 -3","commit":"abc123"}
```
这样史官增量读取自然包含 git 信息，跨平台一致。

#### 4) Pi 主平台实现要点
- 在丞相侧：所有关键事件（delegate result、errors、git summary、decision）都写入 `.court/events.jsonl`（这是“可读日志”，不同于 appendEntry）。  
- `agent_end` 时：
  1) 读取 `.court/cursor.json` 得到 historian.cursor  
  2) 组装 HotContext  
  3) spawn 史官：`spawn("pi", ["--no-session","--mode","json","--tools","read", ...])`（史官仅 read）  
  4) 史官输出 JSON（advice + newCursor + optional memoryUpdate）  
  5) 父进程负责：`sendMessage({deliverAs:"nextTurn"})` 注入建议；必要时更新 context.md（由父进程写，史官不写）；`appendEntry` 归档史官输出；更新 cursor.json

#### 5) CC / OC 适配
- **CC**：用 `pending-advice.md` 只做“回传通道”，但事件源统一落到 `.court/events.jsonl`（由管家/主进程写）。PreToolUse 不再负责拼 mega-prompt，只需在触发史官前把 HotContext 作为 additionalContext 注入一次即可。  
- **OC**：用 `messages.transform` 注入 HotContext + cursor 值；史官作为 agent 读取 `.court/events.jsonl` 和 `.court/context.md`。

#### 6) Token 与性能
- 史官输入：Hot ~600 + context.md(裁剪后~400-800) + events 增量(30条、每条压到1-2行，~800-1200) ⇒ **约 2k-3k tokens/次**。  
- 性能：额外 I/O 仅两次 read（cursor+events）+ spawn。无 git 命令、无目录扫描，跨平台最稳定。  

以上方案在 Pi 上完全基于已知机制可实现；在 CC/OC 上也只依赖“写一个共享 events.jsonl + 注入 HotContext”的最小桥接，不需要 CC V11 那种复杂 hook 编排，同时避免“史官自跑 git/读一堆文件”的 token 浪费与不确定性。

---

### Party B — 反驳 (kimi-k2.5)

## 方 B：史官上下文管理方案 — 协议化预构建与受控自获取的融合

### 对其他方案的批判性分析

**方 A 的核心弱点**：HistorianPacket 协议虽然精致，但将"预构建"责任完全压在丞相/九卿身上，违背了"丞相超然、只读不执行"的设计原则。Packet 的组装需要理解 delegate 结果的结构化摘要，这本身就是**轻量级执行**。更严重的是，当 packet 失真时，史官的"受控自获取"白名单仍依赖预构建阶段的路径决策——如果风险文件未被标记为 `risk_spots`，史官无法发现。

**方 C 的核心弱点**：`get_entries` 工具假设 appendEntry 日志是完整信息源，但实际 delegate 子进程的详细输出（如 worker 的 tool_use 原始结果）往往超出 appendEntry 的存储粒度。30 条 limit 在复杂场景下会截断关键因果链——比如一个 bug 的根源在第 31 条之前的某个决策，而史官只看到后续症状。此外，史官自主决定"是否需要读额外文件"引入了**不可预测的 token 消耗**，与"硬约束优先"原则冲突。

---

### 我的核心主张

**"双轨制"：强制预构建最小包 + 史官按需点查，但点查范围由协议硬性限定**

这不是简单的折中，而是基于 Pi Extension 机制特性的精确设计：

| 机制 | 用途 | 约束 |
|------|------|------|
| `agent_end` 阻塞 spawn | 生成 **Mandatory Packet**（强制包） | 丞相必须完成，不可跳过 |
| `context` 事件裁剪 | 控制主会话大小，提取本轮 **Decision Summary** | 自动触发，无人工判断 |
| 史官 `read` 工具 | 读取 **Protocol-Defined Files**（协议定义文件集） | 白名单硬编码在 systemPrompt |

关键洞察：**Pi 的 `agent_end` 是天然的分界点**——丞相循环结束、下一轮未开始，此时阻塞生成 packet 不会延迟用户体验，同时保证史官拿到的是"已完成的闭环信息"，而非中间状态。

---

### 具体实现：三层信息架构

#### Layer 1: Mandatory Packet（强制预构建，≤1500 tokens）

由 `agent_end` 事件处理器自动生成，写入 `.court/packets/mandatory_<seq>.json`：

```json
{
  "seq": 47,
  "closed_round": {
    "decision_count": 3,
    "delegate_spawned": 2,
    "delegate_completed": 2,
    "tool_calls_total": 12
  },
  "outcomes": [
    {"type": "file_created", "path": "src/auth.ts", "by": "worker_812"},
    {"type": "test_result", "passed": 8, "failed": 0, "by": "worker_813"}
  ],
  "git_head": "def456",
  "parent_packet": 46
}
```

**极简原则**：只记录"发生了什么"，不记录"为什么"。`why` 留给史官通过 Layer 2 自行探索。

#### Layer 2: Protocol-Defined Files（协议定义文件集，白名单）

史官拥有 `read` 工具，但 systemPrompt 硬约束：

```
你只能读取以下路径的文件：
1. .court/packets/mandatory_*.json — 当前及最近2个packet
2. .court/snapshots/decision_*.md — 丞相重大决策的完整记录（由 context 事件自动归档）
3. .court/snapshots/delegate_*/summary.md — 九卿任务的结构化摘要
4. context.md — 项目记忆
5. .court/cursors.json — 游标状态

禁止读取：
- 源代码文件（除非在 outcomes 中明确列出且需要验证）
- 测试日志原始文件
- 任何不在上述白名单的路径
```

**关键设计**：`snapshots/` 目录由 `context` 事件自动维护——当检测到 `session_before_compact` 或决策关键词（"我决定"、"确认采用"）时，自动将相关消息归档为 markdown。这不是 hook 预判，而是**事件驱动的被动归档**。

#### Layer 3: Cursor-Driven Delta（游标驱动的增量）

`.court/cursors.json` 统一追踪：

```json
{
  "packets": {"last_processed": 46, "last_seq": 47},
  "snapshots": {
    "decisions": {"last_id": "dec_2025_0123_001"},
    "delegates": {"minister_x": {"last_task": 812}}
  },
  "historian": {
    "last_run": "2025-01-15T10:30:00Z",
    "attention_queue": ["auth.ts coverage", "delegate_812 timeout"]
  }
}
```

史官启动时读取 cursor，确定 Layer 1 和 Layer 2 的读取范围。**cursor 由史官写入**（通过 `appendEntry` 持久化，实际落盘由 `agent_end` 后的父进程代理），这与方 C 不同——史官零状态是指"无 LLM 上下文累积"，而非"无持久化副作用"。监督者必须留下监督痕迹。

---

### Token 成本控制：硬预算分层

| 层级 | 预算 | 超限处理 |
|------|------|---------|
| Mandatory Packet | 1500 tokens | 截断 outcomes，保留计数 |
| Snapshots 读取 | 3000 tokens | 只读最新2个 decision + 相关 delegate |
| context.md | 1000 tokens | 只读 Details + Policies + top 5 Experiences |
| **总计** | **≤5500 tokens** | 硬上限，systemPrompt 声明 |

对比方 C 的 8000 tokens，节省 31%；且上限可预测，无"史官自主决定读更多"的不确定性。

---

### 跨平台适配：以 Pi 为锚，CC/OC 降级兼容

**Pi Extension（完整版）**：
- `agent_end` → 生成 Mandatory Packet → spawn 史官 → 史官读取白名单文件 → `appendEntry` 写 advice → 父进程 `sendMessage(nextTurn)` 注入

**CC V11（降级版）**：
- 无 `agent_end` 阻塞点，改用 `Stop hook exit 2` 拦截
- Mandatory Packet 生成移至 `PreToolUse`（当检测到 `stop` intent 时）
- 史官作为 Sub-Agent，`additionalContext` 注入 packet 路径
- `PostToolUse stderr` 回传 advice，格式与 Pi 的 `appendEntry` 一致

**OC（降级版）**：
- `messages.transform` 注入 Mandatory Packet 内容（而非路径，因无法保证文件系统状态）
- 史官定义为 `.opencode/agents/historian.md`，无独立 `read` 工具，依赖 `transform` 预加载
- `task(run_in_background=true)` 模拟 `agent_end` 的后处理

**关键妥协**：CC/OC 无法实现真正的"史官点查"，因为缺乏 Pi 的子进程隔离 + 工具白名单机制。此时退化为"预构建全量包"，但通过 Mandatory Packet 的极简设计，控制包大小在 4000 tokens 以内，优于方 A 的完整 HistorianPacket。

---

### 对方优秀观点的整合

| 来源 | 观点 | 整合方式 |
|------|------|---------|
| 方 A | HistorianPacket 结构化协议 | 采纳为 Mandatory Packet，但极度精简 |
| 方 A | CursorSet 多源游标 | 采纳，但简化字段，史官负责更新 |
| 方 C | offset 追踪增量 | 采纳，但基于 packet seq 而非 appendEntry 全局 offset |
| 方 C | context.md 的 Active Concerns | 采纳，但改为 `historian.attention_queue` 存入 cursor |

---

### 修订后方案总结

```
┌─────────────────────────────────────────┐
│ 丞相主循环（read + delegate only）        │
│  ↓ agent_end 阻塞                        │
│ 生成 Mandatory Packet（极简，≤1500t）     │
│  ↓ spawn 史官子进程                       │
│ 史官：                                   │
│   - read cursor → 确定增量范围            │
│   - read mandatory packet（当前+父）      │
│   - [条件] read snapshots（白名单限定）    │
│   - [条件] read context.md（分区限定）     │
│   - 生成 advice                          │
│   - appendEntry 持久化                   │
│   - 更新 cursor（attention_queue）        │
│  ↓ 子进程结束                             │
│ sendMessage(nextTurn) 注入 advice         │
│ before_agent_start 强制丞相回应           │
└─────────────────────────────────────────┘
```

此方案的核心优势：**用 Pi 的 `agent_end` 阻塞点换取确定性**，避免方 A 的"hook 预判复杂性"和方 C 的"史官自主不可控"。在 CC/OC 上优雅降级，保持协议一致性。史官的独立性体现在"解读权"而非"获取权"——它决定如何理解 Mandatory Packet，但无法突破白名单读取无关信息，这正是"独立监督者"与"越权干预者"的边界。

---

### Party C — 反驳 (claude-sonnet-4-6)

# 方 C：「结构化预构建 + 极简自验证」方案

## 我的核心立场

两方都陷入了一个共同的误区：**把上下文管理当成信息检索问题，而不是约束设计问题**。

史官的核心价值不是"获取最完整的信息"，而是"在有限信息下提供独立判断"。一个需要大量上下文才能工作的史官，本质上已经失去了独立性——它的判断会被"预构建者"或"自获取路径"所左右。

我的方案：**父进程承担摘要责任，史官只做结构化核验**。

---

## 批判方 A 的具体弱点

方 A 的 HistorianPacket 设计精良，但存在一个根本性矛盾：**谁来保证 packet 的质量？**

方 A 说"丞相负责写 cursor"、"delegate 返回时就生成摘要"。但丞相是 LLM，它对"什么值得摘要"的判断本身就需要监督。如果丞相的摘要失真，史官基于失真摘要给出建议，这个监督闭环就断了。

方 A 的对策是"risk_spots 命中时允许史官点查"，但 risk_spots 也是丞相标注的——这是循环依赖。

更具体的实现风险：`.court/packets/hist_pkt_<seq>.json` 这个文件需要丞相在每轮结束时生成，这意味着丞相的 LLM 输出必须包含结构化 JSON。在 Pi 的 `agent_end` 事件里，丞相已经完成了本轮 LLM 调用，这个 packet 只能由 hook 代码（非 LLM）生成——那 hook 代码怎么知道"chancellor_decisions 的 rationale"？这部分要么从对话历史解析（脆弱），要么需要额外一次 LLM 调用（成本翻倍）。

---

## 批判方 B 的具体弱点

方 B 的"史官自获取"在概念上很优雅，但有一个 Pi 平台的硬约束问题：**史官子进程是 `--no-session` 的零状态进程，它的 `read` 工具读到的是文件系统，不是丞相的 LLM 上下文**。

这意味着方 B 的史官永远无法知道"丞相这一轮做了什么决策、为什么这样决策"——除非这些决策被写入文件。但写入文件又需要额外步骤。方 B 的方案里，`--hot-context` CLI arg 承担了传递丞相决策的职责，这其实已经是预构建了——只是方 B 没有承认这一点。

方 B 的分层架构（Tier 1/2/3）很好，但"自适应降级"逻辑放在史官 LLM 内部是不可靠的：LLM 不擅长精确计算 token 数，降级判断本身就会消耗 token。

---

## 方 C 的方案：最小可信预构建

### 核心原则

**父进程（hook 代码，非 LLM）负责组装，史官负责独立核验**。

关键区别：不是让丞相 LLM 写摘要，而是让 `agent_end` hook 代码从对话历史机械地提取结构化信息。这避免了"摘要失真"问题，因为提取规则是确定性的。

### Pi 实现：三步流程

**Step 1：`agent_end` hook 机械提取**

```typescript
on("agent_end", async (session) => {
  // 从对话历史机械提取，不调用 LLM
  const packet: HistorianInput = {
    // 1. 提取所有 tool_use 调用记录（结构化，不需要 LLM 理解）
    toolCalls: session.messages
      .filter(m => m.type === "tool_use")
      .map(m => ({ name: m.name, input_summary: truncate(m.input, 100) })),
    
    // 2. 提取最后一条 assistant 消息（丞相的最终输出）
    finalOutput: truncate(lastAssistantMessage(session), 500),
    
    // 3. 机械读取 git diff --stat（确定性，不依赖 LLM）
    gitStat: await exec("git diff --stat HEAD~1..HEAD"),
    
    // 4. 读取上次 offset
    cursor: readCursor()
  };
  
  // spawn 史官，注入 packet（不超过 1500 tokens）
  const advice = await spawnHistorian(packet);
  
  // 史官输出注入下一轮
  sendMessage({ deliverAs: "nextTurn", content: advice });
  updateCursor(advice.newCursor);
});
```

**Step 2：史官的核验工具极度受限**

史官只有两个工具：
- `read`：白名单限定为 `context.md`、`.court/cursors.json`
- `bash`：只允许 `git show <hash>` 和 `git log --oneline -5`

史官的 systemPrompt 硬编码：
```
你是史官。你收到的 packet 是机械提取的，不是丞相的主观摘要。
你的任务是：
1. 核验 packet 中的 toolCalls 是否符合丞相角色约束（不应有写文件操作）
2. 核验 git 变更是否与 finalOutput 声称的一致
3. 如发现不一致，读取 context.md 中的相关 Experiences 做对比
4. 输出 advice（≤80字）和 newExperience（≤30字，可为 null）
```

**Step 3：cursor 统一为单一 git ref**

```json
// .court/cursor.json
{
  "gitRef": "abc123",
  "lastAdviceAt": "2025-01-15T09:23:17Z",
  "sessionTurn": 23
}
```

不需要 `experienceCursor`——context.md 的 Experiences 由史官决定是否追加，读取时只读最后 N 条（硬编码 N=8）。

### 为什么这比两方都更可靠

方 A 的 packet 依赖 LLM 摘要（可失真），方 B 的自获取依赖 LLM 判断读什么（不可控）。我的方案：**packet 生成是纯代码逻辑**，史官的自获取是**有限核验**而非主要信息来源。

token 成本：
- 史官输入：~1200 tokens（packet 机械提取，密度高）
- 史官自获取：最多 2 次 read，~400 tokens
- 总计：~1600 tokens，低于方 A（~2500）和方 B（~2200）

### 我承认并整合的好观点

**方 A 的 CursorSet 概念是对的**，但不需要那么多维度。git ref 是最可靠的单一锚点，其他维度（task_id、advice_id）增加了维护复杂度而收益有限。我采用简化版。

**方 B 的三层分层架构是对的**，热数据必须通过启动参数注入，温数据才自获取。我的方案本质上也是这个结构，但把"热数据生成"从 LLM 摘要改为代码提取，这是关键改进。

**方 B 关于 CC V11 过度复杂的批评是对的**。6 个 hooks 协作确实是过度工程，但原因不是"预构建错了"，而是"CC 的 hook 系统不适合做预构建"——Pi 的 `agent_end` 是更干净的预构建触发点。

### 跨平台适配

Pi 是主平台，`agent_end` hook 做机械提取是最干净的实现。

CC 适配：用 `Stop` hook 触发，从 `CLAUDE.md` 读取对话历史（CC 会写入），机械提取 toolCalls，其余逻辑相同。不需要复杂的 PreToolUse 链。

OC 适配：`messages.transform` 在每次 API 调用前都会触发，可以在最后一次调用后（检测到停止意图时）触发提取逻辑，注入 background task。

---

## 总结

史官的独立性来自**信息来源的可信度**，而不是信息量。机械提取的 packet 比 LLM 摘要的 packet 更可信；有限核验比全量自获取更可控。在 token 成本、实现可靠性、跨平台一致性三个维度，方 C 都优于方 A 和方 B。

---

## 第三轮：评审裁决

> 评审模型: qwen3.5-plus

# 多 Agent 系统史官上下文管理设计评审报告

## 1. 各方优劣总结

### 方 A (gpt-5.2)：协议化预构建 + 受控自获取
*   **核心主张**：建立标准化的 `HistorianPacket`（历史包）和 `CursorSet`（游标集）。由父进程在 `agent_end` 阶段预构建结构化数据包，史官优先读取该包，仅在白名单内做极少量核验。
*   **优势**：
    *   **确定性最强**：通过 JSON 协议严格定义了输入输出，消除了 LLM 对“读什么”的随机判断，完美契合“硬约束”原则。
    *   **Token 效率极高**：强制裁剪和摘要机制确保史官只处理高价值增量信息（~2k-3k tokens）。
    *   **跨平台兼容性好**：数据层（Packet/Cursor）与实现层（Hooks/Events）解耦，易于在 CC/OC 上降级适配。
*   **弱点**：
    *   **信任链闭环风险**：预构建逻辑若依赖 LLM 生成摘要，存在“丞相自我辩护”的风险；若依赖代码提取，则难以捕捉非结构化的决策意图（Rationale）。
    *   **实现复杂度**：需要维护一套完整的 Packet 生成、版本管理和 Cursor 同步逻辑，工程负担较重。

### 方 B (kimi-k2.5)：分层自获取 + 智能摘要
*   **核心主张**：采用“热数据注入 + 温数据自获取”的分层架构。史官拥有 `read` 和有限的 `execute_command` (git) 能力，自主决定读取哪些文件来补全上下文。
*   **优势**：
    *   **灵活性最高**：史官能主动发现预构建方案可能遗漏的边缘情况（如未标记的风险文件）。
    *   **角色独立性**：真正赋予史官“调查权”，符合其“独立监督者”的定位，不依赖丞相的视角。
    *   **架构简洁**：减少了复杂的预构建 Hook 逻辑，利用 Pi 原生的 spawn 机制即可实现。
*   **弱点**：
    *   **不可控风险**：LLM 的“自适应降级”往往不可靠，容易导致 Token 爆炸或读取无关文件，违背“硬约束”原则。
    *   **工具集过宽**：赋予史官 `execute_command` 增加了安全风险，且在 CC/OC 上难以等价实现（特别是 git 命令的执行权限）。
    *   **一致性难题**：多源游标（task/experience/git）的维护成本高，容易出现状态不一致。

### 方 C (claude-sonnet-4-6)：结构化增量 + 机械提取核验
*   **核心主张**：折中方案。父进程通过**纯代码逻辑**（非 LLM）机械提取对话历史和 Git 变更生成“最小可信包”，史官仅进行有限核验（Read + 受限 Bash）。
*   **优势**：
    *   **可信度最高**：解决了方 A 的“摘要失真”问题，因为数据包是机械提取的客观事实，而非 LLM 的主观总结。
    *   **成本最优**：Token 消耗最低（~1.6k），且实现了真正的“零状态”启动。
    *   **职责清晰**：明确了“父进程负责搬运事实，史官负责判断真伪”的分工。
*   **弱点**：
    *   **信息密度损失**：机械提取可能丢失上下文中的隐含意图（Why），导致史官只能核对"What"，难以评估决策合理性。
    *   **解析脆弱性**：从对话历史中机械提取结构化数据（如区分 Decision 和 Chat）依赖于消息格式的稳定性，鲁棒性较差。

---

## 2. 共识点提取

尽管三方路径不同，但在以下核心设计原则上达成了高度一致：
1.  **触发时机**：均同意利用 Pi 的 `agent_end` 事件作为史官启动的最佳切入点，此时本轮任务闭环，信息最完整。
2.  **零状态原则**：史官必须是 `--no-session` 的临时子进程，不累积长期记忆，每次运行基于持久化存储重建上下文。
3.  **增量优先**：反对全量重读，必须引入 Offset/Cursor 机制追踪处理进度，仅处理新增量。
4.  **硬约束导向**：都认同必须限制史官的工具集（主要是 Read）和输入上限，防止越权和 Token 浪费。
5.  **持久化分离**：同意将详细历史记录存入文件系统（appendEntry 或 JSONL），而不直接放入 LLM 上下文。

---

## 3. 分歧点分析

| 分歧维度 | 方 A (协议预构建) | 方 B (自主获取) | 方 C (机械提取) | **评审洞察** |
| :--- | :--- | :--- | :--- :--- |
| **信息来源主导权** | **父进程主导**：父进程决定史官看什么。 | **史官主导**：史官自己决定看什么。 | **混合**：父进程给事实，史官定焦点。 | **方 C 胜出**。完全由父进程主导易失真，完全由史官主导易失控。机械提取事实 + 史官聚焦是最佳平衡。 |
| **摘要生成方式** | **LLM 摘要**：依赖丞相或九卿生成语义摘要。 | **动态裁剪**：史官运行时自行裁剪。 | **代码提取**：Hook 代码机械截取关键片段。 | **方 C 胜出**。LLM 摘要有幻觉风险，代码提取虽粗糙但绝对真实，适合做审计底稿。 |
| **工具权限** | **仅 Read (白名单)** | **Read + Execute (Git)** | **Read + 受限 Bash** | **方 A/C 融合**。生产环境应严禁 Agent 执行 Shell 命令，Git 信息应由父进程采集后注入。 |
| **游标复杂度** | **多维游标** (Task/Git/Advice) | **多维游标** (Task/Exp/Git) | **单维游标** (Git Ref) | **方 C 胜出**。单一锚点（Git Commit 或 Event ID）足以串联所有事件，降低同步复杂度。 |

**根本矛盾**：在于**“信息的完整性”与“控制的确定性”之间的权衡**。方 A 牺牲了部分探索性换取控制，方 B 牺牲了控制换取探索性，方 C 试图通过改变信息生产方式（机械提取）来同时满足两者。

---

## 4. 最终裁决

**推荐方案：基于“机械提取事实包 + 协议化游标”的混合模式（改良版方 C）**

**理由**：
1.  **解决信任危机**：史官的核心价值是监督。如果监督依据（上下文）是由被监督者（丞相/LLM）生成的摘要，监督就失去了意义。**机械提取**（方 C 的核心贡献）保证了输入数据的客观性。
2.  **规避不可控风险**：方 B 的“自主读取”在生产环境中是定时炸弹，LLM 很难精准控制 Token 预算。必须回归到方 A 的**协议化约束**，但将协议内容从"LLM 摘要”改为“原始事实片段”。
3.  **工程可行性**：利用 Pi 的 `agent_end` 阻塞特性，在内存中完成机械提取和打包，无需复杂的文件系统锁竞争，性能最优。

**核心设计理念**：
*   **父进程（Hook 代码）** = **书记员**：负责如实记录（机械提取 Tool Use、Git Diff、最后结论），不做任何理解或总结。
*   **史官（Agent）** = **法官**：基于书记员提供的案卷（事实包），结合少量背景知识（Context.md），做出独立判决（Advice）。
*   **游标** = **案卷编号**：单一递增序列，确保不重不漏。

---

## 5. 具体实现建议

### 5.1 数据结构定义

**A. 统一游标 (`.court/cursor.json`)**
简化为单一序列号，关联所有事件源。
```json
{
  "seq": 1024,
  "git_ref": "abc123...",
  "last_historian_run": "2025-01-15T10:00:00Z"
}
```

**B. 机械事实包 (`.court/packets/fact_<seq>.json`)**
由 `agent_end` Hook 代码生成，**严禁调用 LLM**。
```json
{
  "seq": 1024,
  "meta": { "duration_ms": 5000, "turn_id": 45 },
  "facts": {
    "tool_calls": [ 
      // 机械提取：只保留工具名、输入摘要（截断）、输出状态
      {"name": "write_file", "path": "src/auth.ts", "status": "success"},
      {"name": "delegate", "task": "fix_bug_101", "result_summary": "done"}
    ],
    "git_diff_stat": "src/auth.ts | 20 ++--, src/test.ts | 5 +",
    "final_statement": "已完成认证模块重构，并补充了单元测试。" // 提取最后一条 Assistant 消息的前 200 字
  },
  "context_snapshot": {
    "active_concerns": ["HIGH: DB pool limit"], // 从 context.md 机械读取
    "recent_experiences": [...] // 最近 5 条
  }
}
```

### 5.2 执行流程 (Pi Extension)

1.  **监听 `agent_end`**：
    *   读取当前 `.court/cursor.json` 获取 `last_seq`。
    *   **机械提取**：遍历本轮 Session 的 `messages` 数组：
        *   过滤出 `tool_use` 类型消息，提取关键字段。
        *   执行 `git diff --stat` (由 Node.js child_process 执行，非 Agent)。
        *   截取最后一条 Assistant 消息。
    *   生成 `fact_<new_seq>.json` 并写入磁盘。
    *   更新 `cursor.json`。

2.  **Spawn 史官子进程**：
    *   命令：`pi --no-session --mode json --tools read --env PI_COURT_ROLE=historian`
    *   **System Prompt 注入**：
        *   明确角色：“你是独立法官，依据提供的《事实包》进行核验。”
        *   **硬约束**：“你只能读取 `.court/packets/fact_*.json` (最近 3 个) 和 `context.md`。禁止执行 Shell 命令。总输入不得超过 2000 tokens。”
    *   **User Prompt 注入**：直接传入新生成的 `fact_<new_seq>.json` 的路径或内容摘要。

3.  **史官内部逻辑**：
    *   读取 Fact Packet。
    *   对比 `final_statement` 与 `tool_calls` 是否一致（例如：声称写了测试，但 tool_calls 中没有写文件操作）。
    *   检查 `git_diff_stat` 是否包含高风险文件（如 `auth`, `db`）。
    *   输出 JSON：`{ "verdict": "pass/warn", "advice": "...", "new_concern": "..." }`。

4.  **结果回传**：
    *   父进程解析史官输出。
    *   调用 `sendMessage({deliverAs:"nextTurn"})` 将 Advice 注入下一轮 System Prompt。
    *   若有 `new_concern`，由父进程原子更新 `context.md`。

### 5.3 跨平台适配策略

*   **CC (Claude Code)**：
    *   利用 `Stop` Hook 拦截结束信号。
    *   由于 CC 难以在 Hook 中访问完整的 Message History 进行机械提取，退化为：读取 CC 自动生成的 `CLAUDE.md` 或 `transcript` 文件，用正则提取关键行作为 Fact Packet。
    *   史官作为 Sub-agent 运行，通过 `additionalContext` 传入 Packet 路径。
*   **OC (OpenCode)**：
    *   利用 `messages.transform` 在最后一次调用前拦截，缓存关键信息。
    *   触发后台 Task 生成 Packet 并运行史官 Agent。

---

## 6. 开放问题

1.  **机械提取的粒度边界**：
    *   如何定义“关键片段”？简单的字符截断可能会切断代码逻辑或重要参数。是否需要引入轻量级的 AST 解析或特定的 Prompt 模板来指导提取（但这又引入了 LLM 成本）？
    *   *建议*：初期采用固定长度截断 + 关键词高亮（如保留 JSON 中的 key），后续根据 Bad Case 优化提取规则。

2.  **长周期记忆的衰减**：
    *   当前的 Cursor 机制主要解决短期增量。对于数月前的 `Experience` 或 `Concern`，如果一直保留在 `context.md` 会导致膨胀，如果删除则丢失智慧。
    *   *建议*：引入“记忆归档”机制。当 `context.md` 超过阈值时，触发一次专门的“史官大修”任务，将旧经验压缩合并，而非在每轮常规运行中处理。

3.  **异常处理与死循环**：
    *   如果史官连续 N 轮提出相同警告而丞相未处理，系统该如何反应？是升级报错、强制停止还是自动修复？
    *   *建议*：在 `cursor.json` 中增加 `unresolved_alert_count` 字段，当计数超标时，父进程抛出异常或切换至“安全模式”（仅允许 Read 操作）。

本方案通过**剥离 LLM 的信息组装权**，从根本上保障了史官的独立性与系统的可控性，是在当前技术条件下最稳健的架构选择。
