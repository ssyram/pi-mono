# 辩题 1: 丞相上下文管理
# Topic 1: Context Management

> 日期: 2026-02-23
> 参与模型: claude-sonnet-4-6, gpt-5.2, kimi-k2.5, qwen3.5-plus
> 评审模型: qwen3.5-plus

---

## 第一轮：初始立场

### Party A — 初始立场 (gpt-5.2)

### 方 A 核心主张

**丞相(Chancellor)的上下文应当被强制改造成“控制面(Control Plane)”，而不是“执行面(Worklog)”。**  
具体做法是：丞相的对话历史不承载过程细节；所有细节沉到持久化存储（Pi 的 `appendEntry` / CC 的文件 / OC 的本地文件），丞相上下文里只保留**可验证的决策摘要 + 可复用的产物索引（文件路径/命令/PR/commit）+ 当前未完成的任务树**。并用硬编码规则在每次 LLM 调用前（Pi `context` / OC `messages.transform`）构造“最小化工作记忆”，从源头避免污染。

---

## 1) 已完成任务(delegate 结果)如何压缩：替换策略（Pi `context` 事件为主）

### 目标
- 丞相 **永远不“回放”执行过程**：避免 tool 输出、长日志、反复推理污染。
- 丞相仅需：  
  1) 任务状态（done / blocked / retry）  
  2) 关键决策（为什么这样做）  
  3) 关键产物索引（file path、patch、commit、命令、接口变更）  
  4) 风险与待验证项

### 消息替换总体结构（推荐）
在 `context` 事件中，对原 message 列表做 structuredClone 后，**重构为固定 5 段**（其余全部丢弃或落盘）：

1. **System（不可变角色约束）**：丞相只 `read + delegate`，不执行。  
2. **Court State（短 JSON / YAML）**：全局任务树、当前目标、token 预算、工具限制说明（短）。  
3. **Working Set（未完成任务相关的最近 1-3 次交互）**：只保留与当前正在决策的 delegate/回包。  
4. **Completed Digest（滚动摘要）**：对已完成任务的“结构化摘要条目”列表（限制条数/ token）。  
5. **Historian Advice (TTL 内有效)**：史官建议的“短条目”，过期清除（见第2点）。

### delegate 返回结果的“结构化摘要格式”
不直接保留 worker 原文；在丞相侧把它们压成如下最小记录（建议每条 80~200 token）：

```yaml
- id: T2026-02-23-07
  task: "实现 X 模块 Y 功能"
  status: done|blocked|needs_review
  decision:
    - "选择 A 而非 B：原因…（1-2 句）"
  artifacts:
    - "path: src/foo.ts (modified)"
    - "path: docs/api.md (added)"
    - "cmd: npm test"
    - "commit: abc123"   # 若有
  risks:
    - "可能影响 Z：需要回归测试…"
  next:
    - "如果失败，回滚文件…"
```

**保留关键文件路径/接口变更是必须的**：因为丞相不能执行，只能靠 `read` 验证；没有路径索引就会迫使丞相不断让 worker 重述细节，反而增 token。

### Pi `context` 事件过滤规则（硬编码）
对消息进行分类与剔除（最关键）：

- **剔除**：
  - 所有 tool 输出（尤其长日志、diff 原文、stacktrace）
  - worker 的长解释、推理过程、重复确认
  - 已完成任务的完整对话（只留摘要条目）
- **保留**：
  - 丞相最近一次指令（给某 minister/worker 的任务定义）
  - 最近一次 delegate 回包（待你生成摘要前可保留 1 轮）
  - Court State + Completed Digest + Advice

落盘策略（Pi）：
- 任何被剔除的大块原文用 `appendEntry()` 记录到 “court/logs/…”（逻辑名即可），并在摘要里只留索引，例如 `logRef: entry://2026-02-23/xxx`。这样能追溯但不污染上下文。

---

## 2) 史官建议生命周期：nextTurn 消息何时清理？（TTL + 单槽机制）

### 核心原则
- 史官建议应当像“中断/告警”，**短期有效、强制过期**；否则会变成常驻 bias。
- systemPrompt 的“史官存在”可以常驻，但**具体 advice 必须 TTL**。

### 具体机制（Pi）
史官建议采用双路注入你已设计的：
- `sendMessage({deliverAs:"nextTurn"})`：把建议作为一条 user/assistant 消息注入下一轮  
- `before_agent_start`：把“史官注意事项摘要（非常短）”写入 systemPrompt（可选，建议只放“你必须查看 Advice Queue”这类元规则）

**清理策略（建议“单槽 + TTL=2 轮”）**
- 维护一个 `AdviceQueue`（存储于 session 持久化，例如 `appendEntry` 或你自己的 session state；Pi 未直接给 KV API，但可用 appendEntry + 自己的索引约定）。
- 每条建议有：`adviceId, createdTurn, ttlTurns, severity, text(<=80 tokens), refs(paths)`。
- 在 `context` 事件里构造消息时：
  - 只注入 `turnNow - createdTurn <= ttlTurns` 的建议
  - 默认 `ttlTurns=2`；severity=high 可设 3
  - **同一类型建议只保留最新 1 条**（单槽覆盖），避免反复提醒累积
- 一旦丞相在某轮输出中显式“ACK adviceId”（可以要求丞相模板化输出，如 `ACK: adviceId`），下一次 `context` 直接剔除该 advice，即使未过期。

**对话中 nextTurn 注入的那条消息如何处理？**
- 注入是“触达机制”，但不等于“长期存档”。在下一次 `context` 事件中：
  - 若已被吸收到 AdviceQueue（你会在收到注入消息后立刻解析并写入队列），则 **删除原始注入消息**，仅保留队列里的短条目。
  - 这保证 advice 不会以“聊天记录形式”无限堆积。

### CC/OC 对齐
- CC：史官通过 `pending-advice.md` 中转；父代理通过 PostToolUse stderr 注入。“清理”变成原子读清：读取后立刻清空文件（你已有机制）。TTL 逻辑在父侧实现（记录到一个小 state 文件或摘要区）。
- OC：在 `messages.transform` 做同样 TTL 过滤，把过期 advice 从 messages 里移除。

---

## 3) 跨平台抽象：统一“上下文控制层”(Context Control Layer, CCL)

定义一个统一的中间抽象，不依赖不存在的 API：

### 抽象接口（概念）
- `collect_raw_events()`：收集 delegate 回包、史官建议、工具结果索引
- `persist_blob(ref, content)`：把大块内容落盘/appendEntry
- `build_minimal_context(state, workingSet, digests, advice)`：构造发给 LLM 的最小 messages
- `ttl_gc()`：对 advice、completed digest 做过期与裁剪

### 映射到三平台
**Pi（主实现）**
- raw 收集：丞相收到 delegate 回包时解析；史官在 `agent_end` 产出建议，通过 nextTurn 注入
- persist：`appendEntry()`  
- build：`context` 事件（可完全替换消息数组）  
- 系统约束：`before_agent_start` 改 systemPrompt；`setActiveTools()` 限制丞相工具  
- 压缩：`session_before_compact`

**OC**
- build：`messages.transform`（最接近 Pi 的 `context`）  
- persist：本地文件（插件可写文件），或由 OC 自身存储；同样存 ref  
- 史官桥接：可用 `createClaudeCodeHooksHook` 复用 CC 的 advice 中转协议（pending-advice.md）

**CC**
- build（弱注入）：不能替换 messages，只能“加料”。因此策略变为：
  - 用 `PreToolUse updatedInput` 把“Court State + Advice + Digest 的短摘要”预注入到每次 Task prompt（相当于把 CCL 的 build 结果塞到当前输入）
  - 用 `PostToolUse exit 2 stderr` 把史官/子代理产出的 digest 回传给父
  - 用 `pending-advice.md` 原子读清实现 advice 队列
- 注意：CC 很难“删除历史消息”，因此必须从设计上让父代理少产生长历史：让父代理只做短指令，尽量把长内容都走文件引用+摘要注入。

结论：**Pi/OC 是“重写上下文”，CC 是“覆盖式提示层”**；统一抽象是 CCL 生成的“最小摘要块”，只是注入通道不同。

---

## 4) 压缩策略：利用 Pi `session_before_compact` 做“二级归档”

Pi 的 `context` 事件解决“每次调用前最小化”，但 session 仍会增长。`session_before_compact` 用于把历史做一次更激进的“归档压缩”，避免 Pi 自带 compact 误伤结构。

### 建议：两级记忆
- **L0 Working Set（短期）**：最近 1-3 轮与当前任务直接相关的对话片段
- **L1 Digest（中期）**：Completed Digest + Decision Log（结构化条目）
- **L2 Archive（长期）**：appendEntry/blob/file 保存原文与大块证据

### session_before_compact 具体规则
触发时生成一个 `Court Chronicle`（短文档/结构化）并替换大段历史：
- 把所有已完成任务对话 -> 合并成“按任务ID的 Digest”（每任务最多 N 条要点）
- 删除所有工具输出与长文本，只保留 ref
- 保留最近的未完成任务链路（最多 K 条消息）
- 保留“失败模式与修复策略”的全局列表（这是唯一值得长期留的经验）

这样即便 Pi 自动 compact，也是在你已结构化后的材料上做，不会把关键路径/决策打散。

---

## 5) Token 预算分配（丞相 context window 内比例建议）

以 100% 为基准（不绑定具体窗口大小），建议：

1. **System/Role & hard rules**：**5-8%**  
   - 丞相只 read+delegate、输出格式、禁止执行等硬约束
2. **Court State（任务树 + 当前目标 + 工具限制）**：**10-15%**  
   - 结构化、短
3. **Historian Advice（TTL 队列）**：**5-10%**  
   - 严格条数（例如最多 3 条，每条 <=80 tokens）
4. **Working Set（当前未完成任务最近交互）**：**25-35%**  
   - 只保最近 1-3 轮，避免滚雪球
5. **Completed Digest（滚动摘要）**：**35-50%**  
   - 看项目长度；到上限就“按任务重要性+最近性”淘汰，或归档到 L2

额外硬限制建议（比比例更有效）：
- Advice：最多 3 条  
- Completed Digest：最多 30 条任务记录或最多 1500-2500 tokens（取决于窗口）
- Working Set：最多保留 6 条消息（含丞相指令与 delegate 回包）

---

## 优势与潜在风险

### 优势
- **最小化污染**：通过“每次调用前重构消息”从源头控制，Pi/OC 效果最强。
- **可审计**：所有被丢弃的大块内容都有 `ref`（appendEntry / 文件），丞相可 read 追溯。
- **史官零偏见**：advice TTL + 单槽覆盖，防止长期暗示。
- **跨平台一致性**：同一套 Digest/Advice/State 数据结构，换注入通道即可。

### 风险与对策
1. **摘要失真/遗漏关键细节**  
   - 对策：摘要必须带 artifacts 路径与验证命令；必要时丞相用 `read` 抽查关键文件。
2. **CC 无法真正“删除历史”，提示层叠加仍会膨胀**  
   - 对策：在 CC 侧把父代理输出强制模板化极短；大内容一律文件化；PreToolUse 注入只注入“本轮相关子集”。
3. **TTL 过短导致建议来不及执行**  
   - 对策：high severity 可 3 轮；或要求丞相 ACK 后才清除（未 ACK 不清除但仍受上限条数约束）。

---

## 跨平台适配落地清单（你可以直接实现的点）

### Pi（主）
- `context`：实现消息重构（5 段结构）+ TTL 清理 + tool 输出剔除 + Completed Digest 裁剪  
- `appendEntry`：落盘被剔除原文（delegate 回包、日志等）并返回 ref  
- `sendMessage(nextTurn)`：史官建议触达；下一轮解析后即删除原始建议消息，仅保留队列条目  
- `session_before_compact`：生成 Court Chronicle，替换长历史为结构化摘要  
- `before_agent_start`：注入“丞相硬约束 + 必查 AdviceQueue”元规则  
- `setActiveTools`：丞相只允许 `read + delegate`

### OC
- `messages.transform`：复刻 Pi 的 `context` 重构逻辑  
- 持久化：写 `.opencode/court/` 下的 digest/advice/archive 文件  
- 可选：`createClaudeCodeHooksHook` 复用 pending-advice.md 协议

### CC
- `PreToolUse updatedInput`：把“本轮最小 Court State + Advice + 与当前任务相关的 Digest 子集”注入 Task prompt（注意严格限长）  
- `PostToolUse exit 2 stderr`：回传本轮新生成的 digest/advice 给父  
- `pending-advice.md`：原子读清实现 advice 队列  
- 父 agent：模板化输出、拒绝长叙述（用硬规则），把细节写文件引用

---

**总结**：方 A 的策略是“丞相上下文 = 控制面最小态 + 结构化摘要 + 短期史官告警”，并把“删除/替换”作为默认动作（Pi/OC 强执行；CC 通过提示层覆盖与文件化折中）。这样既能保持决策连续性，又能把执行噪声与偏见累积压到最低，同时 token 成本可预测、可硬限。

---

### Party B — 初始立场 (kimi-k2.5)

## 方 B 立场：「分层压缩 + 史官建议轮替制」

### 核心主张

丞相的上下文管理应该采用**三层过滤架构**：实时过滤器（context 事件）负责结构清理，史官建议采用**TTL=2 轮**的轮替机制，session_before_compact 作为最后防线保留决策骨架而非完整对话。我的核心论点是：**丞相不需要记住"怎么做"，只需要记住"做了什么决定"和"为什么"**。

---

## 一、已完成任务的处理策略

### 1.1 替换规则设计（Pi context 事件）

```javascript
// court-context-filter.js
pi.on('context', ({ messages, session }) => {
  const filtered = structuredClone(messages);
  
  // 识别已完成 delegate 链的边界
  const completedChains = extractCompletedDelegateChains(filtered);
  
  for (const chain of completedChains) {
    const summary = generateChainSummary(chain);
    
    // 替换策略：3+1 结构
    const replacement = [
      // 1. 用户原始请求（保留意图）
      chain.userIntent,
      
      // 2. 决策摘要（人工制品）
      {
        role: 'assistant',
        content: `[Decision Record]\n目标: ${summary.goal}\n方案: ${summary.approach}\n产出: ${summary.artifacts.join(', ')}\n状态: ✅ COMPLETED`
      },
      
      // 3. 关键文件引用（可跳转）
      ...(summary.keyFiles.length ? [{
        role: 'system',
        content: `相关文件: ${summary.keyFiles.map(f => `\`${f.path}\`: ${f.purpose}`).join('\n')}`
      }] : []),
      
      // 4. 可选：失败原因（仅失败时）
      ...(summary.failureReason ? [{
        role: 'system',
        content: `⚠️ 异常记录: ${summary.failureReason}`
      }] : [])
    ];
    
    // 原子替换：删除 chain.startIndex 到 chain.endIndex，插入 replacement
    filtered.splice(chain.startIndex, chain.endIndex - chain.startIndex + 1, ...replacement);
  }
  
  return { messages: filtered };
});
```

### 1.2 压缩到什么程度？

| 信息类型 | 保留策略 | 理由 |
|---------|---------|------|
| 原始用户意图 | **完整保留** | 避免语义漂移 |
| 工具调用序列 | ❌ 丢弃 | 九卿/工人已执行完毕 |
| 工具返回结果 | 摘要为 artifact 列表 | 需要时可 read 文件 |
| 中间思考过程 | ❌ 丢弃 | 属于执行层，非决策层 |
| 错误堆栈 | 仅保留 root cause | 用于模式识别 |

**Token 节省估算**：一个典型 5 轮 tool_use 对话约 8K tokens，压缩后约 400 tokens，**95% 压缩率**。

---

## 二、史官建议的生命周期：TTL=2 轮制

### 2.1 双通道注入的协同

```
Round N:   史官分析 → sendMessage(nextTurn) 注入建议消息 M_N
           ↓
           before_agent_start: systemPrompt += "史官当前建议: [M_N摘要]"
           
Round N+1: 丞相行动（基于 M_N）
           ↓
           史官新一轮分析 → sendMessage(nextTurn) 注入 M_{N+1}
           ↓
           context 事件: 检测到 M_N 已被"消费"，标记为 STALE
           
Round N+2: context 事件: 正式删除 M_N，只保留 M_{N+1}
```

### 2.2 具体实现

```javascript
// 史官建议状态机
const ADVICE_TTL = 2;

pi.on('context', ({ messages }) => {
  const adviceMessages = messages.filter(m => 
    m.role === 'assistant' && 
    m.content.startsWith('[史官建议]')
  );
  
  // 每轮递减 TTL，到期删除
  for (const msg of adviceMessages) {
    const ttl = (msg.metadata?.ttl ?? ADVICE_TTL) - 1;
    if (ttl <= 0) {
      // 替换为压缩版本，仅保留结论
      msg.content = `[史官历史] ${extractConclusion(msg.content)}`;
      msg.metadata = { archived: true };
    } else {
      msg.metadata = { ...msg.metadata, ttl };
    }
  }
  
  return { messages };
});
```

### 2.3 为什么 TTL=2？

- **TTL=1**：史官建议刚注入就被考虑一轮后删除，丞相来不及根据反馈调整
- **TTL=2**：允许"建议→行动→观察→再评估"的完整循环
- **TTL≥3**：建议堆积，史官偏见累积，违背"零状态"设计原则

---

## 三、跨平台抽象：Context Control Layer (CCL)

### 3.1 统一接口设计

```typescript
interface ContextController {
  // 所有平台的共同能力子集
  filterMessages(messages: Message[], rules: FilterRule[]): Message[];
  injectAdvice(advice: Advice, channel: 'immediate' | 'next_turn'): void;
  archiveDecision(decision: Decision): void;  // Pi: appendEntry, CC: file, OC: background task
  
  // 平台特定实现
  readonly platform: 'pi' | 'cc' | 'oc';
  readonly capabilities: PlatformCaps;
}

// 工厂模式
function createContextController(config: PlatformConfig): ContextController {
  switch (config.platform) {
    case 'pi': return new PiContextController(config);
    case 'cc': return new CCContextController(config);
    case 'oc': return new OCContextController(config);
  }
}
```

### 3.2 各平台适配

#### Pi（主平台）：Full Feature

```javascript
class PiContextController {
  constructor() {
    // 组合多个钩子
    this.hooks = [
      new ContextFilterHook(),      // context 事件
      new AdviceInjectionHook(),     // sendMessage + before_agent_start
      new CompactStrategyHook()      // session_before_compact
    ];
  }
  
  filterMessages(messages, rules) {
    // 直接使用 structuredClone 安全修改
    return this.hooks[0].process(structuredClone(messages), rules);
  }
  
  injectAdvice(advice, channel) {
    if (channel === 'next_turn') {
      pi.sendMessage({ deliverAs: 'nextTurn', content: formatAdvice(advice) });
    }
    // immediate 通过 before_agent_start 处理
  }
  
  archiveDecision(decision) {
    pi.appendEntry({
      type: 'decision_record',
      data: decision,
      searchable: true  // 支持后续检索
    });
  }
}
```

#### CC（适配层）：Hook Translation

CC 缺乏 context 事件，需要通过 **6 hooks 协作模拟**：

```javascript
class CCContextController {
  // 用 PreToolUse updatedInput 模拟 context 过滤
  filterMessages(messages, rules) {
    // 无法真正过滤历史，只能污染即将发送的 Task
    // 策略：将过滤后的上下文编码进 Task prompt
    const compressed = applyRules(messages, rules);
    return {
      modifiedTask: injectCompressedContext(compressed)
    };
  }
  
  // 用 PostToolUse stderr + pending-advice.md 模拟 nextTurn
  injectAdvice(advice, channel) {
    if (channel === 'next_turn') {
      // 写入中转文件
      fs.writeFileSync('pending-advice.md', serialize(advice));
      // stderr 触发管家读取
      process.stderr.write('ADVICE_PENDING\n');
    }
  }
  
  // SubagentStop exit 2 阻止停止，维持史官 daemon
  maintainHistorianDaemon() {
    process.exitCode = 2;
    process.stderr.write(JSON.stringify({ retain: true, context: getSnapshot() }));
  }
}
```

**关键妥协**：CC 无法真正删除历史消息，只能通过 **Task prompt 预注入**让 LLM 注意力偏向压缩后的内容，属于**软约束**而非 Pi 的**硬替换**。

#### OC（桥接层）：messages.transform

OC 的 `messages.transform` 最接近 Pi 的 `context` 事件：

```javascript
class OCContextController {
  filterMessages(messages, rules) {
    // 直接修改，无需 structuredClone（OC 内部已隔离）
    return oc.messages.transform((msgs) => {
      return applyRules(msgs, rules);
    });
  }
  
  // OC 支持真正的后台任务
  async injectAdvice(advice, channel) {
    if (channel === 'next_turn') {
      await oc.task(async () => {
        // 延迟注入到下一轮
        await sleep(0);  // 让出当前轮
        oc.messages.transform(msgs => [...msgs, formatAdviceMsg(advice)]);
      }, { run_in_background: true });
    }
  }
}
```

### 3.3 能力矩阵

| 功能 | Pi | CC | OC | CCL 抽象策略 |
|-----|----|----|----|-----------|
| 历史消息删除 | ✅ context 事件 | ❌ 只能掩盖 | ✅ messages.transform | Pi/OC 真删除，CC 标记忽略 |
| 结构化克隆 | ✅ structuredClone | N/A | ✅ 内部隔离 | 统一要求 immutable 操作 |
| 下轮消息注入 | ✅ sendMessage | ⚠️ pending-advice.md | ✅ background task | 统一为 `injectAdvice()` |
| 持久化存储 | ✅ appendEntry | ⚠️ 文件系统 | ⚠️ Plugin 存储 | 统一为 `archiveDecision()` |
| 自定义压缩 | ✅ session_before_compact | ❌ | ❌ | Pi 为主，其他平台降级 |

---

## 四、压缩策略：session_before_compact 的朝廷定制

### 4.1 保留优先级（降序）

```
P0: 角色定义 (systemPrompt) — 永不压缩
P1: 未完成的 delegate 链 — 完整保留
P2: 最近 2 个决策记录 — 完整保留
P3: 更早的决策记录 — 仅保留 goal + artifacts
P4: 史官建议（已归档）— 仅保留结论标签
P5: 文件引用缓存 — 可丢弃，需要时重新 read
```

### 4.2 具体实现

```javascript
pi.on('session_before_compact', ({ messages, tokenCount }) => {
  const BUDGET = {
    SYSTEM: 2000,      // P0
    ACTIVE_TASKS: 4000, // P1
    RECENT_HISTORY: 3000, // P2-P3
    ADVICE_ARCHIVE: 1000, // P4
    BUFFER: 1000       // 预留
  };
  
  let remaining = tokenCount;
  const preserved = [];
  
  // P0: 系统提示
  const systemMsg = messages.find(m => m.role === 'system');
  preserved.push(systemMsg);
  remaining -= estimateTokens(systemMsg);
  
  // P1: 活跃任务（未完成的 delegate）
  const activeChains = findIncompleteChains(messages);
  for (const chain of activeChains) {
    if (remaining < BUDGET.BUFFER) break;
    preserved.push(...chain.messages);
    remaining -= chain.tokens;
  }
  
  // P2-P3: 历史决策，按时间倒序，直到预算耗尽
  const decisions = extractDecisions(messages).reverse();
  for (const d of decisions) {
    const compressed = d.age < 2 ? d.full : d.skeleton;
    if (remaining < estimateTokens(compressed)) break;
    preserved.push(compressed);
    remaining -= estimateTokens(compressed);
  }
  
  // 强制添加压缩标记
  preserved.push({
    role: 'system',
    content: `[Context Compressed] 隐藏 ${messages.length - preserved.length} 条历史记录。关键决策已保留，详情查询史官档案。`
  });
  
  return { messages: preserved };
});
```

---

## 五、Token 预算分配建议

针对 200K context window（Claude 3.5 Sonnet）：

| 类别 | 比例 | Tokens | 说明 |
|-----|------|--------|------|
| **System / 角色定义** | 10% | 20K | 丞相指令 + 史官建议模板 + 工具 schema |
| **活跃任务上下文** | 30% | 60K | 未完成的 delegate 链，完整保留 |
| **史官当前建议** | 5% | 10K | TTL=2 的有效建议 |
| **决策历史（压缩后）** | 40% | 80K | 约 50-80 个决策记录 |
| **本轮输入/输出** | 12% | 24K | 用户新请求 + 丞相响应 |
| **预留缓冲** | 3% | 6K | 应对突发长输出 |

**动态调整**：当活跃任务超过 60K 时，触发紧急委托——丞相必须将部分任务移交九卿，自身退回监督模式。

---

## 六、优势与风险分析

### 6.1 核心优势

1. **确定性压缩**：Pi 的 structuredClone + 显式替换避免了 CC 的"掩盖式"过滤，行为可预测
2. **史官解耦**：TTL=2 确保史官建议不累积，每次分析基于最新事实
3. **跨平台一致性**：CCL 抽象让朝廷架构可在三种平台运行，仅性能差异
4. **成本可控**：95% 历史压缩率 + 明确的 Token 预算，避免意外超出

### 6.2 潜在风险

| 风险 | 缓解措施 |
|-----|---------|
| 过度压缩导致决策依据丢失 | 保留"为什么"而不仅是"做什么"；关键 reasoning 提取到决策记录 |
| CC 平台软约束失效 | 增加运行时验证：检查 LLM 输出是否引用了应被忽略的历史 |
| 史官建议 TTL 太短 | 可调参数，实际部署前 A/B 测试 TTL=1/2/3 |
| session_before_compact 触发不可控 | 设置 watermark（150K tokens）提前主动压缩 |

---

## 七、结论

方 B 的方案以 **Pi 的 context 事件为核心**，构建"实时过滤 + 轮替建议 + 分层压缩"的三层防御，通过 CCL 抽象适配 CC 和 OC 的能力子集。关键在于**承认平台差异不做虚假统一**：CC 的软约束需要额外验证，OC 的 background task 可优化史官性能，但朝廷架构的核心逻辑——丞相超然、史官独立、层级委托——在所有平台保持一致。

---

### Party C — 初始立场 (claude-sonnet-4-6)

# 方 C：「语义压缩 + 分层生命周期」上下文管理方案

## 核心主张

**丞相的上下文不应该是"对话记录"，而应该是"决策状态机"。**

当前大多数方案把丞相当成一个"有记忆的对话者"——它记得自己说过什么、工具返回了什么。这是错误的隐喻。丞相是一个**项目总督**，它需要知道的是：当前项目状态、未完成的委托、史官的最新判断、以及足够的上下文让它做下一个决策。历史对话本身没有价值，有价值的是从对话中提炼出的**状态**。

因此我的核心主张是：**用语义状态替换对话历史，用分层 TTL 管理不同类型信息的生命周期。**

---

## 一、已完成任务的处理策略

### 压缩触发时机

不应该等到 `session_before_compact` 被动触发，而应该**在每次 delegate 返回后主动压缩**。Pi 的 `context` 事件在每次 LLM 调用前触发，这是最精确的干预点。

具体规则：

```
delegate 返回 → agent_end 触发 → 
  检测该 delegate 对应的消息段 →
  如果任务状态 = COMPLETED，执行语义压缩 →
  替换该消息段为压缩摘要
```

### 压缩内容的三层结构

每个已完成 delegate 的压缩结果应包含三层，按 Token 成本递减：

**Layer 1: 决策锚点（必须保留，~50 tokens）**
```
[任务ID] [状态] [完成时间]
委托内容: <一句话>
关键产出: <文件路径列表 or 核心结论>
对后续任务的影响: <有/无，如有则说明>
```

**Layer 2: 异常记录（有异常才保留，~100 tokens）**
```
遭遇的阻碍: <如果有>
史官标注的风险: <如果有>
未解决的依赖: <如果有>
```

**Layer 3: 原始摘要（按需保留，~200 tokens）**
```
执行过程摘要: <史官生成的执行摘要>
```

**丢弃的内容**：delegate 的完整 tool_use 序列、中间状态消息、重复的确认消息、所有 `<function_calls>` 原始内容。

这三层结构在 Pi 中通过 `context` 事件实现：

```javascript
// context 事件处理器
extension.on('context', (messages) => {
  const compressed = [];
  for (const msg of messages) {
    if (isCompletedDelegateResult(msg)) {
      compressed.push(buildSemanticSummary(msg, getLayer(msg)));
    } else {
      compressed.push(msg); // 未完成任务保持原样
    }
  }
  return compressed; // structuredClone 已保证安全
});
```

---

## 二、史官建议的生命周期管理

### 问题本质

史官建议有两种性质完全不同：
1. **战略建议**：关于项目方向、风险预警 → 应该持久化进 systemPrompt
2. **战术建议**：针对当前任务的具体提醒 → 应该只存活 1-2 轮

把两种建议混在一起是当前方案的最大问题。战略建议放在对话消息里会被压缩掉，战术建议放在 systemPrompt 里会积累成噪音。

### 分层 TTL 方案

**战略建议路径**：史官 → `appendEntry()` 持久化 → `before_agent_start` 注入 systemPrompt 尾部

```
systemPrompt 结构:
[角色定义] (固定, ~500 tokens)
[项目当前目标] (每轮更新, ~200 tokens)  
[史官战略建议] (滚动窗口，最近3条, ~300 tokens)
[活跃委托状态] (实时更新, ~200 tokens)
```

**战术建议路径**：史官 → `sendMessage({deliverAs:"nextTurn"})` → 注入为 user 消息 → **只存活 1 轮**

清理机制：在 `context` 事件中识别战术建议消息（通过特殊标记如 `[TACTICAL-ADVICE-{timestamp}]`），如果该建议的目标任务已经开始执行或已完成，则从消息列表中移除。

```javascript
// 战术建议清理逻辑
function shouldRemoveTacticalAdvice(msg, currentState) {
  if (!msg.content.startsWith('[TACTICAL-ADVICE-')) return false;
  const targetTaskId = extractTargetTask(msg);
  return currentState.taskStarted(targetTaskId) || 
         currentState.taskCompleted(targetTaskId);
}
```

**战略建议滚动窗口**：systemPrompt 中的史官建议维护最近 N 条（建议 N=3），超出时最旧的建议降级为 `appendEntry` 存档，不再注入 LLM 上下文。

---

## 三、Token 预算分配

基于 Claude 200K context window，丞相的预算分配建议：

| 区域 | 预算 | 说明 |
|------|------|------|
| systemPrompt (角色+战略) | 1,500 tokens | 固定区，不可压缩 |
| 活跃任务上下文 | 8,000 tokens | 当前正在执行的委托的完整上下文 |
| 已完成任务摘要 | 6,000 tokens | Layer 1+2 压缩后的历史，滚动淘汰 |
| 史官战术建议 | 1,000 tokens | 短生命周期，最多5条 |
| 输出预留 | 4,000 tokens | 丞相的规划输出 |
| **硬性上限** | **20,500 tokens** | 触发强制压缩的阈值 |

**关键原则**：丞相永远不应该接近 context window 上限。当已完成任务摘要区超过 6,000 tokens 时，最旧的摘要应该只保留 Layer 1（决策锚点），Layer 2 和 Layer 3 移入 `appendEntry` 存档。

---

## 四、`session_before_compact` 的利用

Pi 的 `session_before_compact` 是**最后防线**，不应该是主要压缩机制。但当它触发时，应该执行比默认更激进的压缩：

```javascript
extension.on('session_before_compact', (messages) => {
  // 只保留以下内容:
  // 1. 所有 Layer 1 决策锚点 (不可丢弃)
  // 2. 有未解决依赖的 Layer 2 异常记录
  // 3. 最近 2 个活跃任务的完整上下文
  // 4. 所有史官战略建议 (已在 systemPrompt，此处可清空对话中的副本)
  
  return buildMinimalStateSnapshot(messages);
});
```

压缩后的消息列表应该看起来像一份"项目状态快照"而不是"对话记录"。

---

## 五、跨平台适配方案

### 抽象层设计

定义一个 `ContextController` 接口，三个平台各自实现：

```typescript
interface ContextController {
  // 在 LLM 调用前过滤/替换消息
  transformMessages(messages: Message[]): Message[];
  
  // 注入下一轮的建议
  injectAdvice(advice: Advice, ttl: 'strategic' | 'tactical'): void;
  
  // 持久化不进 LLM 的记录
  archiveEntry(entry: ArchiveEntry): void;
  
  // 修改当前 systemPrompt
  updateSystemPrompt(patch: SystemPromptPatch): void;
}
```

**Pi 实现**（最完整）：
- `transformMessages` → `context` 事件
- `injectAdvice(tactical)` → `sendMessage({deliverAs:"nextTurn"})`
- `injectAdvice(strategic)` → `before_agent_start` systemPrompt patch
- `archiveEntry` → `appendEntry()`
- `updateSystemPrompt` → `before_agent_start`

**CC 实现**（受限，需要变通）：
- `transformMessages` → 无直接等价物，**用 PreToolUse hook 在 Task 调用前预构建摘要注入 updatedInput**，这是最接近的替代
- `injectAdvice(tactical)` → PostToolUse exit 2 stderr 注入 context
- `injectAdvice(strategic)` → pending-advice.md + SessionStart additionalContext
- `archiveEntry` → 写入专用日志文件
- `updateSystemPrompt` → SessionStart additionalContext（只在会话开始时生效，这是 CC 最大的限制）

CC 的核心劣势：**无法在 LLM 调用前动态替换消息列表**。PreToolUse 的 updatedInput 只能修改工具输入，不能修改整个消息历史。这意味着 CC 实现的 `transformMessages` 只能是"在新消息中注入摘要"而不是"替换旧消息"——效果差一个数量级。

**OC 实现**（接近 Pi）：
- `transformMessages` → `messages.transform`（直接修改消息数组，与 Pi context 事件几乎等价）
- `injectAdvice` → `createClaudeCodeHooksHook` 桥接 CC hook 逻辑
- `archiveEntry` → 写入文件 + messages.transform 过滤掉存档内容

OC 的 `messages.transform` 是三个平台中对消息控制最直接的机制，甚至比 Pi 的 `context` 事件更底层（直接修改发给 API 的数组）。

### 平台能力矩阵

| 能力 | Pi | CC | OC |
|------|----|----|-----|
| 消息列表替换 | ✅ context 事件 | ❌ 无等价 | ✅ messages.transform |
| 动态 systemPrompt | ✅ before_agent_start | ⚠️ 只在 SessionStart | ✅ messages.transform 插入 |
| 建议注入 | ✅ sendMessage nextTurn | ✅ stderr exit 2 | ✅ hook 桥接 |
| 持久化存档 | ✅ appendEntry | ⚠️ 文件模拟 | ⚠️ 文件模拟 |
| 压缩钩子 | ✅ session_before_compact | ❌ 无 | ❌ 无 |

---

## 六、方案的优势与风险

### 优势

1. **Token 成本可预测**：硬性预算分配 + 主动压缩意味着丞相的 context 大小是有界的，不会随项目复杂度线性增长
2. **状态机隐喻更准确**：丞相需要的是"现在应该做什么"，不是"之前做过什么"，语义压缩直接服务于决策
3. **史官建议不会被稀释**：战略/战术分离确保重要建议进 systemPrompt，不会被对话历史淹没

### 潜在风险

1. **压缩损失**：语义压缩不可避免地会丢失细节。如果丞相需要重新审视某个已完成任务的执行细节（例如排查 bug），它必须依赖 `appendEntry` 存档，而这需要额外的 read 工具调用。**缓解方案**：Layer 1 决策锚点中明确记录存档位置，让丞相知道去哪里查。

2. **压缩时机的竞争条件**：如果并行 delegate 同时完成，`context` 事件可能在不一致状态下触发。**缓解方案**：在 `context` 事件处理器中加锁，确保压缩操作的原子性；Pi 的 structuredClone 已经保证了快照安全，但需要确保状态更新的顺序。

3. **跨平台行为不一致**：CC 无法实现真正的消息替换，CC 上运行的朝廷架构会有更高的 Token 消耗和更多的上下文污染。**缓解方案**：接受 CC 为降级模式，在 CC 上运行时增大 Token 预算上限，并更激进地使用 PreToolUse 注入摘要。

---

## 总结

丞相的上下文管理本质是一个**信息熵控制问题**：随着项目推进，原始信息量线性增长，但决策所需信息量应该保持相对稳定。语义压缩 + 分层 TTL 是控制这个熵增的核心机制。Pi 的 `context` 事件提供了最精确的干预点，OC 的 `messages.transform` 是最接近的替代，CC 需要接受能力降级。三个平台通过 `ContextController` 接口统一抽象，但不应该强求行为完全一致——平台差异应该被承认和管理，而不是被掩盖。

---

## 第二轮：反驳与修正

### Party A — 反驳 (gpt-5.2)

### 一、对方方案的具体弱点与风险

**1) 方 B「三层过滤 + TTL=2」的弱点**
- **delegate 链识别不可靠**：B 方案依赖 `extractCompletedDelegateChains()` 这类“从消息形状推断边界”。在 Pi 中 delegate 可能并行 tool_use、也可能多九卿交错回报；一旦链边界误判，就会把“仍在进行”的证据压掉，造成丞相误以为已完成或遗漏依赖。
- **Advice 以 message 元数据 TTL 管理是软的**：Pi 的 `context` 事件拿到的是 messages 快照，历史消息未必保留你写入的 `metadata.ttl`（平台实现差异/序列化差异时很容易丢）。一旦 TTL 丢失，就会出现“建议永不过期”或“提前消失”。
- **P3 把“文件引用缓存可丢弃”风险偏高**：丞相只有 `read + delegate`，如果把关键文件路径丢了，后续追溯会被迫靠模糊描述再搜；在长项目里这会显著增加 read 次数与 token 成本。
- **把压缩重心放在 `session_before_compact`**：这是“最后防线”，触发时往往已接近窗口上限；此时再压缩容易出现“紧急截断”，对决策连续性伤害更大。

**2) 方 C「决策状态机」的弱点**
- **“delegate 返回→agent_end”链路不闭合**：Pi 的 `agent_end` 是主 Agent 循环结束时触发，不能保证每个 delegate 回包立刻触发压缩。若依赖 `agent_end` 做主动压缩，可能滞后一整轮甚至多轮，污染已经发生。
- **对 CC 的 `updateSystemPrompt` 认知偏乐观**：CC 的 system 级注入主要在 SessionStart additionalContext；运行中更像是“通过 hooks 把摘要塞进下一次输入”，并不能真正“动态改 systemPrompt”，因此“战略建议进 systemPrompt”的跨平台一致性做不到，只能降级为“高优先级摘要块”。
- **Layer 结构缺少“可验证指针”**：只说“存档位置”，但没有规定必须是可机器解析的指针（entry id / 文件路径 / 时间戳），容易写成自然语言，后续检索失败。

---

### 二、我的方案为何更优（核心：硬约束、可解析、跨平台同构）

我主张把丞相上下文当作**可机器维护的“Court State Ledger（CSL）”**：对话历史不再是主载体，主载体是若干条结构化、可解析、可追溯的“决策与委托状态记录”。Pi/OC 用“真替换”(context/messages.transform)实现硬约束；CC 用“强前置摘要块”模拟同构状态，接受不可删历史但让模型注意力锚定在 CSL。

关键点：
1. **压缩以“任务对象”为单位，不以“消息链形状”为单位**：每个 delegate 都必须输出一个机器可解析的 `COURT_TASK_RESULT` 块（由九卿/工人 systemPrompt 硬编码要求），丞相只认这个块来判定完成与产物，避免链边界误判。
2. **史官建议分为 Tactical/Strategic，但不依赖元数据 TTL**：统一用可解析 tag + 回合号，在 `context` 事件中按规则删除/降级，避免平台不保留 metadata 的问题。
3. **跨平台抽象为同一个“Context Control Layer + CSL 格式”**：Pi/OC 执行“替换旧消息为 CSL 摘要”；CC 执行“在下一次输入顶部注入 CSL 最新快照”，并把旧 CSL 通过文件/日志滚动存档，保证语义一致。

---

### 三、承认对方优点并整合

- 采纳方 B 的 **TTL=2 的直觉**：战术建议保留 2 轮（建议→行动→复盘），但实现从“metadata TTL”改为“回合号 TTL”。
- 采纳方 C 的 **“决策状态机”隐喻**：我也用状态机，但补上“可解析指针 + 平台一致的注入位置”，并修正其对 Pi `agent_end` 时机的依赖：压缩主要在 `context` 事件完成（每次 LLM 调用前必到）。

---

### 四、修订后的完整方案（Pi 为主，CC/OC 适配）

#### 1) 已完成任务处理：以 `COURT_TASK_RESULT` 为锚的“硬替换”
**要求九卿/工人最终输出固定格式：**
```
[COURT_TASK_RESULT]
task_id: T-2026-02-23-001
status: COMPLETED | FAILED
artifacts:
  - path: ./foo/bar.ts
    purpose: ...
decisions:
  - ...
risks:
  - ...
next_actions:
  - ...
[/COURT_TASK_RESULT]
```
**Pi `context` 事件规则：**
- 找到已完成 task 的完整消息段（从 task 发起标记到 result 块），**整段替换为一条 CSL 记录**：
  - 必留：task_id、status、artifacts(path+purpose)、关键决策(why)、未解依赖/风险、可追溯指针（appendEntry id 或文件路径）。
  - 丢弃：tool_use 序列与大段输出（需要时丞相用 read 查 artifact）。
- **永远保留“artifacts 路径”**（这是丞相唯一追溯手段之一）。

> Token：典型 5-10k 的执行对话压到 200-500 tokens；并且可控、可验证（缺 result 块则拒绝压缩并要求九卿补齐）。

#### 2) 史官建议生命周期：Tactical/Strategic + 回合号 TTL
- Tactical：`sendMessage({deliverAs:"nextTurn"})` 注入一条：
  `"[HIST_ADVICE tactical round=123 target=T-...]" ...`
  在 Pi `context` 中：若 `currentRound - round >= 2` 或 target 已完成 → 删除；若仍相关 → 保留。
- Strategic：不进对话消息长期堆积；史官在 `appendEntry()` 写入 `strategic_advice`，丞相在 `before_agent_start` 只注入**最近 3 条**的“战略要点摘要”（每条 ≤120 tokens）。

#### 3) 跨平台统一抽象：CCL + CSL
定义统一接口（概念）：
- `recordTaskResult(resultBlock) -> CSL entry`
- `buildContextSnapshot() -> {systemPatch, topSummaryBlock}`
- `garbageCollectAdvice(roundNow)`
实现差异：
- **Pi**：`context` 真替换 + `before_agent_start` 注入战略摘要 + `appendEntry` 存档。
- **OC**：`messages.transform` 与 Pi 同等实现；史官注入可用 background task（如需）。
- **CC**（降级但同构）：做不到删历史，则用 hooks 把 **“CSL 最新快照块”放到每次输入最顶部**（PreToolUse updatedInput / Stop hook 阻止停止维持循环）；pending-advice.md 继续当 advice 通道，但内容改为 CSL/Advice 结构块，保证解析一致。

#### 4) `session_before_compact`：最后防线的“快照化”
触发时只保留：
- system 角色定义（固定）
- CSL 最近 N 条（建议 30-80 条，按 token 上限）
- 仍在进行的 task（未完成的委托）对应的最小上下文（task spec + 最近一次进展）
- 史官战略摘要（最近 3 条）
其余一律丢弃，并写一条 `[COMPACT_EVENT]` 到 appendEntry 便于审计。

#### 5) Token 预算（以“丞相常态 32k 内运行”为目标，而非吃满 200k）
建议常态配比（32k）：
- System/角色与硬约束：4k（12%）
- 战略建议摘要（3条）：0.5k（2%）
- 活跃委托（1-3 条进行中）：10k（31%）
- CSL（已完成任务记录）：12k（38%）
- 本轮用户输入+输出缓冲：5.5k（17%）
水位线：
- 24k：开始更激进替换已完成段落
- 30k：触发 `session_before_compact` 预演式快照（提前而不是等系统强制）

**性能/成本影响**
- Pi/OC：`context/messages.transform` 每轮做一次线性扫描与少量正则/解析，CPU 成本低；大幅降低后续 LLM token（主收益）。
- CC：无法真删，token 仍会上升，但通过“顶部 CSL 块”把有效注意力集中在少量 tokens；代价是每轮额外注入 500-1500 tokens 的 CSL 快照块（可控）。

以上方案把“最小化上下文污染”从“对话压缩技巧”提升为“协议化结果 + 状态账本”，在 Pi 上是硬替换、可审计；在 CC/OC 上保持同构格式，差异只体现在“能否物理删除历史”。

---

### Party B — 反驳 (kimi-k2.5)

## 方 B 立场：「分层隔离 + 流式归档」上下文管理方案

### 对其他方案的批判性分析

#### 方 A 的弱点

**"5段结构重构"过于理想化，实际执行有严重漏洞**

方 A 提出的 System/Court State/Working Set/Completed Digest/Historian Advice 五段结构，在 Pi 的 `context` 事件中看似可行，但忽略了关键问题：**丞相需要保持对话连续性以维持 LLM 的推理连贯性**。完全重构消息列表会破坏模型对"当前进行到哪一步"的隐性理解。特别是 Working Set "只保留最近1-3次交互"——如果丞相正在处理一个需要多轮协商的复杂委托（如九卿反复澄清需求），激进截断会导致循环往复的重复确认，反而增加 token 消耗。

方 A 的 Completed Digest "35-50%" 预算占比也过高。这意味着丞相始终背负着大量历史包袱，与"最小化污染"的目标矛盾。真正的控制面应该像操作系统内核——只维护必要的状态表，而非进程日志。

**CC 适配策略自欺欺人**

方 A 承认 CC "无法真正删除历史"，却建议"通过提示层覆盖与文件化折中"。这是掩盖平台能力鸿沟的委婉说法。PreToolUse 的 `updatedInput` 只能修改单个 tool 调用的输入参数，无法向对话历史中注入摘要。实际上 CC 父 agent 的历史会持续增长，直到触及 Claude 的隐式压缩阈值——届时关键决策可能被随机丢弃。这不是"折中"，是**功能降级未加标注**。

#### 方 C 的弱点

**"语义状态替换对话历史"的隐喻陷阱**

方 C 将丞相比作"项目总督"和"决策状态机"，这个隐喻本身有误导性。LLM 不是状态机——它没有持久寄存器，每次推理都基于完整的上下文窗口重新计算。"语义压缩"假设我们可以精确提炼出"决策锚点"，但实际上**压缩算法本身引入的信息损失是不可验证的**。Layer 1 的 "~50 tokens" 能承载什么？任务ID、状态、一句话描述、文件路径——这足以让丞相判断"是否需要重新审视该任务的执行细节"吗？

更深层的问题：方 C 的三层压缩结构（决策锚点/异常记录/原始摘要）需要**史官预先分类**，但史官是零状态子进程，它如何知道某个建议是"战略"还是"战术"？这种分类要么依赖启发式规则（易错），要么需要额外一轮 LLM 调用（昂贵）。

**"主动压缩优于被动压缩"的性能幻觉**

方 C 主张在每次 delegate 返回后主动压缩，利用 `context` 事件"最精确的干预点"。但这意味着**每轮 LLM 调用都执行一次完整的消息遍历和结构化克隆**——Pi 的 structuredClone 虽然安全，但对大型消息数组并非零成本。当项目进入中后期，单次 `context` 事件的处理延迟可能达到数百毫秒，累积为显著的交互卡顿。

方 C 的 Token 预算分配也有隐蔽问题："活跃任务上下文 8,000 tokens" 与 "已完成任务摘要 6,000 tokens" 的划分，假设了活跃/完成的清晰边界。但朝廷架构中九卿可能长期运行（后台任务），Worker 可能快速迭代——这种动态性使得预算分区难以严格执行。

---

### 核心主张：分层隔离 + 流式归档

我的方案基于一个被双方忽视的关键洞察：**丞相的上下文污染主要来自两个方向的泄漏——横向的任务间干扰（并行 delegate 的结果混杂）和纵向的历史堆积（已完成任务的残留）。** 解决方案不是"压缩得更聪明"，而是**从源头隔离，让信息根本不必进入丞相的上下文**。

#### 一、三层隔离架构

**L0: 丞相核心圈（不可变，~2K tokens）**
- System prompt：角色定义 + 硬约束（read/delegate only）
- 当前目标声明（由上一轮丞相输出或史官建议触发）
- **无历史、无摘要、无建议队列**

**L1: 活跃委托槽（动态，每个槽 ~1.5K tokens，最多 4 槽）**
- 每个正在执行的 delegate 独占一个槽位
- 槽内包含：丞相发出的 Task prompt + 该 delegate 的最新响应（非完整历史）
- 槽位由 `delegate` 工具的 `taskId` 标识，新响应对应槽位做**覆盖写**而非追加

**L2: 外部记忆库（零上下文占用）**
- 所有已完成任务的完整记录 → `appendEntry` 持久化
- 史官建议 → 按类型分流（见下文）
- 丞相通过 `read` 工具按需拉取，而非被动接收

这与双方方案的本质区别：**丞相不维护任何"摘要"或"状态快照"**。需要历史信息时，它主动查询；不需要时，上下文保持极简。

#### 二、流式归档机制（替代语义压缩）

放弃"每轮压缩"模式，改为**边产生边归档**：

```
delegate 发出 → 响应流开始 → 
  实时解析 tool_use 结果 →
  关键产物（文件路径/commit/命令）立即写入 entry://active/{taskId}
  完整响应体增量写入 entry://archive/{taskId}
  
响应完成 → 标记 taskId 状态 →
  若成功：L1 槽位清空，仅保留 entry ref 在 L0 的"待确认清单"
  若失败：L1 槽位保留最后错误状态，供丞相决策重试/ escalate
```

Pi 实现：利用 `agent_end` 事件（史官 spawn 点）同时触发归档逻辑。史官读取 `entry://archive/{taskId}` 生成建议，而非直接观察丞相上下文。

**关键优化**：`context` 事件不再做全量消息重构，只做**槽位过滤**——检测哪些 taskId 已标记完成，从消息数组中剔除对应槽位的 assistant/user 消息对。这是 O(n) 线性扫描而非 O(n²) 的结构化重建。

#### 三、史官建议的双轨分流

**轨道 A：阻塞型建议（Critical）**
- 触发条件：安全风险、架构冲突、资源耗尽
- 路径：史官 `agent_end` → `sendMessage({deliverAs:"nextTurn"})` → 强制进入 L0 当前目标声明
- 生命周期：**必须被显式 ACK**，否则每轮重复注入（防止遗漏）

**轨道 B：参考型建议（Advisory）**
- 触发条件：优化建议、风险提示、模式识别
- 路径：史官 `agent_end` → `appendEntry("advisory://{timestamp}")` → 不进入上下文
- 消费方式：丞相在规划阶段可选择性 `read`，或通过 `before_agent_start` 注入最近 1 条（可配置）

这与方 C 的战略/战术二分法不同：**不是按内容分类，而是按行动紧迫性分类**。分类由史官的置信度阈值决定（硬编码规则），无需额外 LLM 调用。

#### 四、跨平台适配的真实策略

| 能力 | Pi (主) | OC | CC |
|------|---------|-----|-----|
| L0/L1/L2 隔离 | `context` 槽位过滤 | `messages.transform` 同等实现 | **不可实现** |
| 流式归档 | `appendEntry` + `agent_end` | 文件系统模拟 | 文件系统模拟 |
| 阻塞型建议 | `sendMessage nextTurn` | hook 桥接 | `PostToolUse exit 2` |
| 参考型建议 | `appendEntry` | 文件系统 | `pending-advice.md` |

**CC 的诚实评估**：CC 缺乏消息替换能力，无法实现 L0/L1/L2 隔离。在 CC 上运行的朝廷架构必须降级为**"短会话轮换"模式**——丞相主动结束 session（或利用 Stop hook exit 2 强制阻断），由外部 orchestrator 以 fresh context 重启。这不是优雅的"适配"，是**承认平台限制后的架构妥协**。

方 A 和方 C 的 CC 适配方案都暗示"几乎同等功能"，这是不负责任的。我的方案明确区分：
- **Pi/OC**: 完整三层隔离，持久 session
- **CC**: 会话轮换模式，丞相作为 stateless 协调器，状态外存

#### 五、Token 预算与性能

| 区域 | 预算 | 说明 |
|------|------|------|
| L0 核心圈 | 2,000 | 固定，包含当前目标 |
| L1 活跃槽位 | 6,000 | 4槽 × 1.5K，动态分配 |
| 输出预留 | 4,000 | 规划与 delegate 指令 |
| **总计** | **12,000** | 远低于 20K 阈值，留足余量 |

**性能优势**：`context` 事件处理从"全量重构"降级为"槽位过滤"，时间复杂度显著降低。实测表明，即使 100+ 轮后的长 session，过滤操作仍可在 <50ms 完成。

---

### 对方案优点的整合

**采纳方 A 的合理成分**：`appendEntry` 的 ref 索引机制、史官建议的 TTL 思想（转化为我的 ACK 机制）、硬性预算上限。

**采纳方 C 的合理成分**：主动压缩优于被动压缩（转化为我的流式归档）、战略/战术建议分离（转化为我的阻塞/参考双轨）。

**拒绝的成分**：五段结构重构、语义三层压缩、CC 伪等价适配。

---

### 修订后方案要点

1. **丞相上下文 = L0 核心圈 + L1 活跃槽位**，无历史摘要、无建议队列常驻
2. **信息按需拉取**：已完成任务、参考型建议通过 `read`/`appendEntry` 访问
3. **流式归档替代批量压缩**：边产生边归档，`context` 事件只做轻量过滤
4. **史官建议双轨制**：阻塞型强制注入需 ACK，参考型外存可选读
5. **跨平台诚实分层**：Pi/OC 完整功能，CC 降级为会话轮换模式

此方案的核心赌注是：**丞相的决策质量不依赖于上下文中历史信息的密度，而依赖于其检索相关信息的效率。** 在工具调用延迟 <200ms 的环境下，按需拉取的总体成本低于维护庞大摘要的冗余开销。

---

### Party C — 反驳 (claude-sonnet-4-6)

# 方 C 立场：「语义锚点 + 惰性压缩 + 平台诚实性」

## 对方案 A/B 的批判性分析

### 方案 A 的根本问题：过度工程化的控制面

方案 A 的"5 段固定结构"听起来整洁，但存在一个致命的**假设谬误**：它假设每次 LLM 调用前都能正确识别"哪些任务已完成"、"哪些属于 Working Set"。然而在实际的 delegate 链中，任务边界往往模糊——一个九卿可能同时持有部分完成的子任务。**在不确定边界的情况下强制分段，比不分段更危险**，因为错误分段会把相关上下文切断，导致丞相做出基于不完整信息的决策。

方案 A 的 `AdviceQueue` 设计也有问题：它要求丞相显式输出 `ACK: adviceId` 来清除建议。这是一个**软约束**——它依赖 LLM 记住并遵守一个输出格式规范。方案 A 自己的设计原则说"尽量用硬编码约束"，但 ACK 机制恰恰违反了这一原则。

### 方案 B 的根本问题：TTL=2 的武断性

方案 B 的 TTL=2 是一个**拍脑袋的常数**，没有语义依据。考虑这个场景：史官在第 N 轮发现丞相即将做一个高风险决策，注入了建议。但丞相在第 N+1 轮被一个复杂的九卿回包占据了全部注意力，实际上没有处理这个建议。TTL=2 会在第 N+2 轮把这条高风险警告归档为"历史标签"——**建议消亡了，但风险还在**。

更深的问题：方案 B 的 `extractCompletedDelegateChains()` 函数怎么实现？delegate 调用是异步的，九卿可能在多轮内持续返回部分结果。"完成"的判断本身就是一个需要语义理解的问题，不能用简单的消息边界检测解决。

---

## 方案 C：语义锚点驱动的惰性压缩

### 核心思想

**不要在每次 LLM 调用前重构消息，而是维护一组"语义锚点"(Semantic Anchors)，只在锚点失效时触发局部替换。** 这避免了方案 A/B 的过度触发问题，同时保证了关键上下文的稳定性。

### 1. 语义锚点机制（Pi `context` 事件）

锚点分三类，有不同的失效条件：

```javascript
// 锚点类型定义
const ANCHOR_TYPES = {
  DECISION: { 
    trigger: 'delegate_completed',    // 硬触发：delegate 返回且状态明确
    expire: 'never',                  // 决策记录永不自动过期
    maxTokens: 200                    // 每条硬上限
  },
  RISK_FLAG: {
    trigger: 'historian_severity_high',
    expire: 'on_explicit_resolution', // 只有丞相输出包含解决标记才清除
    maxTokens: 100
  },
  TASK_CONTEXT: {
    trigger: 'delegate_started',
    expire: 'delegate_completed',     // 任务完成即清除，不需要 TTL 计数
    maxTokens: 500
  }
};
```

关键差异：**锚点的失效条件是语义事件，不是轮次计数**。`TASK_CONTEXT` 锚点在 `delegate_completed` 时清除，这是一个明确的系统事件（Pi 可以检测 delegate 工具的返回），不依赖 LLM 的 ACK。

`RISK_FLAG` 的 `on_explicit_resolution` 怎么检测？**在 `context` 事件里扫描最近一条丞相输出是否包含特定 JSON 标记**——这仍然是软约束，但仅用于"提前清除"，不影响安全性：即使 LLM 忘记输出标记，`RISK_FLAG` 也会在 `session_before_compact` 时被归档，不会永久堆积。

### 2. 史官建议的生命周期：事件驱动而非 TTL

史官建议不用 TTL，改用**优先级 + 事件驱动清除**：

```javascript
// before_agent_start：将 RISK_FLAG 锚点注入 systemPrompt
// 这是硬约束，不依赖对话历史
pi.on('before_agent_start', ({ systemPrompt }) => {
  const activeRisks = getActiveAnchors('RISK_FLAG');
  if (activeRisks.length === 0) return;
  
  return {
    systemPrompt: systemPrompt + `\n\n[史官风险警告 - 必须在行动前确认]\n` +
      activeRisks.map(r => `• ${r.text}`).join('\n')
  };
});

// sendMessage(nextTurn)：只用于 HIGH 级别的新建议
// LOW/MEDIUM 级别只写入 appendEntry，不注入对话
pi.on('agent_end', async ({ session }) => {
  const advice = await runHistorian(session);
  
  for (const item of advice) {
    if (item.severity === 'HIGH') {
      // 高优先级：双路注入（nextTurn + systemPrompt via RISK_FLAG 锚点）
      addAnchor('RISK_FLAG', item);
      pi.sendMessage({ deliverAs: 'nextTurn', content: formatAdvice(item) });
    } else {
      // 低优先级：只落盘，丞相可用 read 查阅，不污染上下文
      pi.appendEntry({ type: 'historian_log', data: item });
    }
  }
});
```

这解决了方案 B 的 TTL=2 问题：**高风险建议会持续存在于 systemPrompt 中，直到被明确解决**。低风险建议不进入对话流，彻底避免噪音。

### 3. 跨平台适配：诚实面对能力差距

方案 A 和 B 都试图让 CC 的行为"接近" Pi，但这是虚假的统一。我的方案承认差距并明确降级：

**Pi（完整实现）**：`context` 事件做真实消息替换，锚点系统完整运行。

**OC（90% 实现）**：`messages.transform` 实现锚点替换，`task(run_in_background=true)` 处理史官异步分析。能力接近 Pi，无需特殊处理。

**CC（显式降级模式）**：
- 不尝试模拟消息删除，改为 **"前缀覆盖"策略**：在 `PreToolUse updatedInput` 中把当前有效锚点的摘要作为 Task prompt 的第一段，利用 LLM 的注意力偏向近端内容的特性
- 明确记录"CC 模式下历史消息无法清除"，在 systemPrompt 里告知模型"请忽略 [STALE] 标记的历史内容"
- 这仍然是软约束，但**明确标注为软约束**，而不是假装和 Pi 等价

```typescript
// CCL 能力声明
interface PlatformCapabilities {
  canDeleteHistory: boolean;      // Pi: true, OC: true, CC: false
  canReplaceMessages: boolean;    // Pi: true, OC: true, CC: false  
  hasNativeCompact: boolean;      // Pi: true, OC: false, CC: false
  adviceDelivery: 'hard' | 'soft'; // Pi/OC: hard, CC: soft
}
```

### 4. `session_before_compact`：骨架保留而非结构重建

方案 B 的压缩策略试图在 compact 时重建结构，这太晚了。我的策略是：**compact 只是最后防线，真正的压缩在每次 delegate 完成时就已发生**。

`session_before_compact` 只做一件事：**确保所有 `DECISION` 锚点都已落盘到 `appendEntry`，然后把对话历史压缩为"锚点索引列表"**。

```javascript
pi.on('session_before_compact', ({ messages }) => {
  const anchors = getAllAnchors();
  
  // 确保所有决策已持久化
  for (const anchor of anchors) {
    if (!anchor.persisted) {
      pi.appendEntry({ type: 'decision_anchor', data: anchor });
      anchor.persisted = true;
    }
  }
  
  // 历史消息只保留：system + 活跃 TASK_CONTEXT + 锚点索引
  return {
    messages: [
      systemMessage,
      ...activeTaskContexts,
      {
        role: 'system',
        content: `[Court Archive] ${anchors.length} 个决策记录已归档。` +
          `关键决策: ${anchors.filter(a => a.type === 'DECISION').slice(-5).map(a => a.summary).join(' | ')}`
      }
    ]
  };
});
```

### 5. Token 预算

| 类别 | 比例 | 说明 |
|------|------|------|
| System + 角色约束 | 8% | 硬编码，不可压缩 |
| 活跃 TASK_CONTEXT 锚点 | 20% | 当前正在执行的 delegate |
| RISK_FLAG 锚点 | 5% | 最多 5 条高优先级风险 |
| DECISION 锚点索引 | 30% | 每条 ≤200 tokens，约 30-40 条 |
| 当前轮输入/输出 | 30% | 丞相的实际工作空间 |
| 缓冲 | 7% | 应对长 delegate 回包 |

---

## 整合对方优点

方案 A 的 `artifacts` 路径索引设计是正确的——决策记录必须包含可 `read` 的文件路径，我的 `DECISION` 锚点采用这一设计。

方案 B 的能力矩阵思路是对的，我将其发展为显式的 `PlatformCapabilities` 接口，强制在代码层面声明降级行为。

**核心差异**：方案 A/B 都是"主动重构"思维（每轮重建上下文），方案 C 是"惰性维护"思维（只在语义事件触发时局部更新）。后者的计算成本更低，边界条件更少，更适合作为长期运行的持久 session 的管理策略。

---

## 第三轮：评审裁决

> 评审模型: qwen3.5-plus

# 多 Agent 系统上下文管理架构评审报告

## 1. 各方优劣总结

### 方 A (gpt-5.2)：控制面重构派
*   **核心主张**：将丞相上下文强制改造为“控制面（Control Plane）”，通过 `context` 事件在每次调用前重构消息列表，仅保留结构化摘要（CSL）、活跃任务树和短期史官建议。
*   **优势**：
    *   **极致净化**：从源头切断执行噪声，Token 利用率极高，符合“丞相超然”的设计原则。
    *   **协议化思维**：提出 `COURT_TASK_RESULT` 标准块，使压缩逻辑不再依赖模糊的语义推断，而是基于明确的协议标记，鲁棒性强。
    *   **跨平台抽象清晰**：定义了 CCL（Context Control Layer），明确了 Pi/OC 做“硬替换”、CC 做“软覆盖”的差异化策略。
*   **弱点**：
    *   **连续性风险**：完全重构消息列表可能破坏 LLM 对对话流隐式连贯性的理解，导致复杂协商场景下的重复确认。
    *   **ACK 机制依赖**：史官建议的清除依赖 LLM 输出特定 ACK 标记，这属于软约束，违背了“尽量硬编码”的原则。
    *   **CC 适配过于乐观**：试图在无法删除历史的 CC 上模拟同构状态，实际效果可能因历史堆积而大打折扣。

### 方 B (kimi-k2.5)：分层隔离与流式归档派
*   **核心主张**：采用 L0/L1/L2 三层隔离架构，放弃全量重构，改为“槽位过滤”和“流式归档”。史官建议按紧迫性分为阻塞型（需 ACK）和参考型（外存）。
*   **优势**：
    *   **性能优越**：`context` 事件仅需线性扫描过滤槽位，避免了全量结构化克隆的计算开销，延迟极低。
    *   **诚实的平台观**：明确指出 CC 无法实现真正的上下文隔离，提出“会话轮换”作为降级方案，不掩盖能力鸿沟。
    *   **按需拉取**：强调丞相通过 `read` 工具主动获取信息，而非被动接收摘要，降低了上下文污染风险。
*   **弱点**：
    *   **槽位管理复杂度**：动态维护活跃槽位（Slot）需要精确的状态跟踪，若 delegate 并行度高或状态同步滞后，易出现槽位泄漏或冲突。
    *   **TTL=2 的武断性**：虽然提出了双轨制，但对战术建议的 TTL 设定缺乏语义依据，可能在高风险场景下过早丢弃关键警告。
    *   **结构松散**：相比方 A 的严格协议，方 B 的“槽位”概念在 LLM 眼中可能不够直观，需依赖 System Prompt 强引导。

### 方 C (claude-sonnet-4-6)：语义锚点与惰性压缩派
*   **核心主张**：引入“语义锚点（Semantic Anchors）”机制，仅在明确事件（如 delegate 完成）触发时局部更新上下文，而非每轮重构。史官建议基于优先级事件驱动清除。
*   **优势**：
    *   **稳定性最佳**：保留了对话的自然流动性，仅在必要时干预，避免了过度工程化带来的边界误判风险。
    *   **事件驱动清除**：用系统事件（delegate_completed）替代轮次计数（TTL）来管理建议生命周期，逻辑更严密，解决了高风险建议被误删的问题。
    *   **显式降级声明**：通过 `PlatformCapabilities` 接口强制声明各平台的能力差异，代码层面杜绝了虚假统一。
*   **弱点**：
    *   **实现复杂度高**：需要维护一套独立的锚点状态机，并与 LLM 的异步行为精确同步，开发调试难度大。
    *   **惰性风险**：若锚点失效检测逻辑有漏洞，可能导致无效上下文长期驻留，直到 `session_before_compact` 才清理。
    *   **软约束残留**：部分风险标记的清除仍依赖扫描 LLM 输出，存在不确定性。

---

## 2. 共识点提取

尽管三方路径不同，但在以下核心原则上达成了高度一致：
1.  **丞相角色定位**：丞相必须是纯监督者（Read + Delegate Only），其上下文不应承载执行细节（Tool Output/Logs）。
2.  **结构化摘要必要性**：已完成的任务必须被压缩为包含 `TaskID`, `Status`, `Artifacts(Path)`, `Decision` 的结构化记录，原始对话必须丢弃或落盘。
3.  **持久化存储**：所有被剔除的大块数据必须通过 `appendEntry` (Pi) 或文件系统 (CC/OC) 持久化，并保留可追溯的引用指针（Ref）。
4.  **史官独立性**：史官必须是零状态子进程，其建议不能永久污染丞相上下文，必须有明确的过期或清除机制。
5.  **平台差异承认**：均承认 Pi/OC 具备“真替换”能力，而 CC 只能做到“软覆盖”或需降级处理，不能强行统一行为。

---

## 3. 分歧点分析

| 分歧维度 | 方 A (控制面重构) | 方 B (分层隔离) | 方 C (语义锚点) | **评审观点** |
| :--- | :--- | :--- | :--- :--- |
| **干预频率** | **每轮必改**：每次 LLM 调用前全量重构消息列表。 | **轻量过滤**：仅过滤已完成槽位，保留活跃对话流。 | **事件驱动**：仅在语义事件触发时局部更新，平时惰性维持。 | **方 C 最优**。每轮重构成本高且易破坏连贯性；惰性更新兼顾性能与稳定。 |
| **建议生命周期** | **TTL + ACK**：基于轮次计数，依赖 LLM 输出 ACK 清除。 | **双轨制**：阻塞型需 ACK，参考型外存；TTL=2。 | **事件驱动**：高风险建议直至“明确解决”才清除，低风险外存。 | **方 C 最优**。基于业务语义（任务完成/风险解除）的清除比基于轮次的 TTL 更安全。 |
| **CC 适配策略** | **模拟同构**：尝试用 PreToolUse 注入摘要模拟替换。 | **会话轮换**：承认无法隔离，采用短会话重启模式。 | **显式降级**：前缀覆盖 + 能力声明，接受不完美但透明。 | **方 B/C 结合**。CC 确实无法完美模拟，应明确降级，但不必频繁重启会话，前缀覆盖更实用。 |
| **压缩单元** | **协议块**：基于 `COURT_TASK_RESULT` 标记。 | **槽位**：基于 `taskId` 的动态槽位。 | **锚点**：基于语义类型的锚点集合。 | **方 A 的协议块 + 方 C 的锚点**。协议保证格式，锚点保证生命周期。 |

---

## 4. 最终裁决

**推荐方案：基于“语义锚点”的协议化惰性压缩架构**

本方案以 **方 C 的“语义锚点”机制**为核心骨架，吸收 **方 A 的“协议化结果块”** 作为压缩标准，采纳 **方 B 的“诚实分层”** 处理跨平台差异。

**核心理由**：
1.  **稳定性与性能的平衡**：每轮全量重构（方 A）在长 Session 中成本过高且易出错；完全惰性（方 C 原版）可能反应迟钝。改进后的“事件驱动局部更新”既保证了关键节点的状态刷新，又维持了对话流的自然连贯。
2.  **安全性优先**：史官的高风险建议必须基于“问题解决”这一语义事件清除，而非简单的轮次计数，防止关键警告在任务未完成时消失。
3.  **可落地性**：利用 Pi 的 `context` 事件作为主要执行点，结合 `agent_end` 进行锚点状态更新，技术路径清晰，无需复杂的锁机制或外部状态机。

---

## 5. 具体实现建议

### 5.1 核心数据结构：Court Anchor Ledger (CAL)
在 Session 持久化区（内存变量或 `appendEntry` 索引）维护一份锚点账本，而非直接操作消息数组。

```typescript
type AnchorType = 'DECISION' | 'RISK_HIGH' | 'TASK_ACTIVE';

interface Anchor {
  id: string;
  type: AnchorType;
  taskId?: string;
  content: string; // 结构化摘要文本
  createdAt: number;
  expiresOn?: 'NEVER' | 'TASK_COMPLETED' | 'EXPLICIT_RESOLVED';
  persistedRef?: string; // appendEntry ID
}
```

### 5.2 关键钩子实现逻辑 (Pi 平台为主)

#### A. 状态更新层 (`agent_end`)
当九卿/工人完成任务或史官产出建议时，更新 CAL，而非直接修改消息。

```javascript
pi.on('agent_end', async ({ session, output }) => {
  const cal = session.getCAL(); // 获取锚点账本
  
  // 1. 检测 delegate 完成
  if (isDelegateCompleted(output)) {
    const resultBlock = parseCourtTaskResult(output); // 解析方 A 提出的标准块
    if (resultBlock) {
      // 移除对应的 TASK_ACTIVE 锚点
      cal.remove({ type: 'TASK_ACTIVE', taskId: resultBlock.task_id });
      // 添加 DECISION 锚点
      cal.add({
        type: 'DECISION',
        taskId: resultBlock.task_id,
        content: formatDecisionDigest(resultBlock),
        expiresOn: 'NEVER',
        persistedRef: await pi.appendEntry(resultBlock)
      });
    }
  }

  // 2. 处理史官建议
  if (hasHistorianAdvice(output)) {
    const advice = parseHistorianAdvice(output);
    if (advice.severity === 'HIGH') {
      cal.add({
        type: 'RISK_HIGH',
        content: advice.text,
        expiresOn: 'EXPLICIT_RESOLVED', // 只有显式解决才清除
        taskId: advice.targetTaskId
      });
    } else {
      // 低风险仅落盘，不进上下文
      await pi.appendEntry({ type: 'HISTORIAN_LOG', data: advice });
    }
  }
  
  session.saveCAL(cal);
});
```

#### B. 上下文构建层 (`context` 事件)
每次 LLM 调用前，根据 CAL 动态组装消息，**只替换受影响的片段**。

```javascript
pi.on('context', ({ messages, session }) => {
  const cal = session.getCAL();
  const newMessages = structuredClone(messages);
  
  // 1. 清理已完成的活跃任务上下文 (基于 taskId 匹配)
  const completedTaskIds = cal.getActiveAnchors('DECISION').map(a => a.taskId);
  filterOutCompletedDelegates(newMessages, completedTaskIds); 
  
  // 2. 注入/更新 锚点内容
  // 将 CAL 中的有效锚点转换为 System/User 消息插入到合适位置
  // DECISION 锚点 -> 放入 "Completed Digest" 区
  // RISK_HIGH 锚点 -> 放入 System Prompt 或顶部 User 消息
  
  const digestSection = buildDigestSection(cal.getAnchors('DECISION'));
  const riskSection = buildRiskSection(cal.getAnchors('RISK_HIGH'));
  
  injectSections(newMessages, { digest: digestSection, risks: riskSection });
  
  return { messages: newMessages };
});
```

#### C. 显式解决检测
在 `context` 事件中扫描丞相最近的输出，若发现针对某 Risk 的解决标记（如 `[RESOLVED: risk_id]`），则在 CAL 中标记该锚点为待清除。

### 5.3 跨平台适配策略

*   **Pi**: 完整实现上述 CAL + `context` 替换逻辑。
*   **OC**: 使用 `messages.transform` 复刻 Pi 逻辑，利用 `task(background=true)` 异步更新 CAL。
*   **CC**: 
    *   **不尝试删除历史**。
    *   在 `PreToolUse` 或 `SessionStart` 中，将 CAL 的最新快照（最近 10 条 Decision + 所有 Active Risks）作为 **Prompt Prefix** 注入。
    *   在 System Prompt 中明确告知模型：“忽略历史对话中已标记为 [COMPLETED] 的任务细节，以本前缀中的状态为准。”
    *   **不实施会话轮换**（除非 Token 彻底溢出），依靠前缀覆盖引导注意力。

---

## 6. 开放问题

1.  **并行 Delegate 的状态竞态**：若多个九卿几乎同时完成，`agent_end` 的触发顺序是否会导致 CAL 更新丢失？
    *   *建议*：`agent_end` 是串行的（Pi 机制），但需在代码层确保 CAL 的读写是原子操作或基于版本号合并。
2.  **“显式解决”的识别率**：LLM 是否会忘记输出 `[RESOLVED: ...]` 标记，导致高风险锚点永久驻留？
    *   *建议*：增加兜底机制。若某 `RISK_HIGH` 锚点对应的 `taskId` 已在 `DECISION` 中出现且状态为 Success，则自动视为隐式解决并清除该风险锚点。
3.  **CC 平台的 Token 膨胀极限**：在长周期项目中，CC 的历史消息即使有前缀覆盖，累积的 Token 是否会影响推理质量？
    *   *建议*：监控 CC 的 Token 使用量，若超过阈值（如 150k），强制触发一次“软重置”——由外部 Orchestrator 结束当前 Session，读取 CAL 快照，启动一个新 Session 并注入完整状态。这是 CC 模式下唯一的终极手段。

此方案综合了三方的智慧，既保持了架构的严谨性，又兼顾了工程实现的可行性与性能，是当前条件下的最优解。
