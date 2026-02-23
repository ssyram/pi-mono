# 辩题 5: 书记官角色 — Skill/MCP 管理
# Topic 5: Clerk Role

> 日期: 2026-02-23
> 参与模型: kimi-k2.5, claude-sonnet-4-6, gpt-5.2, qwen3.5-plus
> 评审模型: qwen3.5-plus

---

## 第一轮：初始立场

### Party A — 初始立场 (gpt-5.2)

### 方 A 核心主张  
**需要引入“书记官(Clerk)”角色，但必须把它做成“无常驻上下文的工具/Skill 生命周期控制面(Control-plane)”而不是新的常驻对话主体。**  
也就是说：书记官不承担推理与写作，不增加新的“长期说话者”；它负责**动态启用/禁用工具、隔离/裁剪 Skill system prompt、管理 MCP 工具可见性与压缩策略**。在 Pi 上用“事件/Hook + 强制工具白名单”落地；在 CC/OC 上降级为“工具可用性守门 + 上下文注入最小化”。

这样做的原因是：**丞相被原则约束为 read+delegate only，且“超然监督”不应背负大量运行时状态与细粒度工具治理**；而史官是零状态建议者，也不适合承担确定性的工具治理。书记官是硬约束的执行层控制面，能把“节省 token + 降低攻击面 + 减少遗忘”做成机制而不是习惯。

---

## 1) Skill 上下文生命周期：Pi 上能否清理？怎么做才“真省 token”
### 关键事实与结论
- Pi 的 `setActiveTools()` **只能限制工具调用集合**，并不能保证“Skill 的 system prompt 不再注入”。你给出的背景说明：**Skill prompt 一旦注入会留在上下文**，这意味着仅靠 setActiveTools 不一定省 token（工具不可用但 prompt 仍占 window）。  
- Pi 的 `context` 事件：**每次 LLM 调用前触发，可完整替换消息列表**（structuredClone）。因此，只要 Skill prompt 以可识别的 message 形式进入 messages，理论上可以**在 `context` 中删除/替换**，从而达到“真正不进本轮上下文”的效果。  
- 风险在于：不同 Skill 注入方式不一定稳定可识别；若注入在 systemPrompt 或某种不可见层，`context` 未必能删干净。**所以必须把书记官设计成“双通道治理”：优先用源头级禁用/隔离，其次用 context 过滤兜底。**

### Pi 具体实现（书记官治理链）
书记官不是一个“会话 Agent”，而是一组 Pi Extension 事件处理逻辑 + 最小状态存储：

**(A) 书记官状态存储（不进上下文）**  
- 用 `appendEntry()` 记录一个 `clerk_state`（例如 JSON）：  
  - `active_toolset`: 当前允许工具集合  
  - `active_skills`: 当前允许的 Skill 列表（逻辑概念）  
  - `skill_budget`: 每类任务最大允许注入的 Skill prompt token 上限（估算值）  
  - `mcp_visibility`: MCP 工具白名单/分组  
这些记录不进 LLM context，避免“治理信息本身变成负担”。

**(B) `before_agent_start`：硬注入“工具治理制度”到 systemPrompt（短且稳定）**  
每轮开始，书记官把一段极短的制度性 systemPrompt 注入（不是 Skill 说明），例如：
- “任何任务只允许使用书记官设定的工具白名单；如需新工具必须 delegate 给书记官申请；不要自行假设工具存在。”
这保证丞相/九卿不会“软约束遗忘”。

**(C) `setActiveTools()`：源头级限制（降低攻击面与误用）**  
- 丞相默认：`read + delegate`（已定）。书记官保证即使上下文里残留 Skill prompt，主进程也**物理上不能调用**多余工具。  
- 九卿/工人：由书记官为每个子任务生成“工具合同(tool contract)”——一个明确的 tool allowlist，交给 spawn 参数或上层 `setActiveTools()`。

**(D) `context` 事件：真正的“Skill prompt 清理/裁剪”执行点**  
- 书记官在 `context(messages)` 中做两类变换：  
  1) **剔除**：删除已完成子任务对应的 Skill system prompt（或 MCP 大段工具描述）消息；  
  2) **替换为摘要**：把必要但冗长的 Skill 规则替换为“书记官签发的短摘要指令”（例如 5-10 行），保留可追责性而非全文。  
- 实现上需要一个可识别策略：  
  - 若 Skill 注入消息带有固定前缀/role/metadata，直接匹配；  
  - 若不稳定，则以“超长 system 段落 + 特定关键词”启发式匹配，并把原文通过 `appendEntry()` 存档，确保可审计。  

**结论**：在 Pi 上，书记官能把“工具不可用”和“prompt 不进上下文”同时做到；仅靠 setActiveTools 很可能“安全但不省 token”。

---

## 2) 角色必要性：为何不能由丞相/史官/单一 Hook 兼任
### 丞相不适合  
- 丞相被硬约束为 read+delegate only：让它承担 Skill/MCP 生命周期治理，会迫使它在分析阶段做大量“运行时资源调度”，这既违背“纯监督”，又容易因推理漂移而遗忘清理步骤。  
- 丞相还承担全局调度，若再承载治理状态，会形成**单点复杂性**：任务复杂时最容易漏掉“卸载/裁剪”。

### 史官不适合  
- 史官是零状态、偏建议：它的优势是“不累积偏见”，但工具治理需要**确定性、可重放、可审计**（哪些工具何时可见、何时裁剪、裁剪依据）。  
- 史官运行在 `agent_end` 临时 spawn：生命周期与“每次 LLM 调用前的 context 过滤”并不对齐。

### 单一 Hook 不够  
- 仅用 `session_before_compact`：只能在压缩时省 token，无法解决“当前窗口立刻被 Skill prompt 占满”。  
- 仅用 `context`：能省 token但无法限制工具调用（安全面），且需要有稳定识别能力。  
- 书记官的价值在于把这些 hook 组合成**一套制度化流水线**（源头限制 + 上下文裁剪 + 归档 + 审计），并形成跨平台“统一语义”。

---

## 3) 实现复杂度 vs 收益：为什么收益大于成本
### 成本
- 多一个角色概念 + 一套“工具合同/申请协议”
- 需要写 context 过滤规则、状态存储、审计日志

### 收益（可量化）
1) **Token 成本下降**：  
   - 多 Skill 时常见 system prompt 合计上千到上万 token；每次调用都重复付费。书记官通过 `context` 剔除/替换，可把重复成本降到“短摘要 + 必要引用”。  
2) **性能提升**：  
   - 更短上下文意味着更快推理、更低延迟，且减少触发模型“注意力稀释”。  
3) **安全与稳定性**：  
   - `setActiveTools`/allowlist 让“即便 prompt 残留也无法调用”，降低工具滥用和 prompt injection 影响面。  
4) **架构一致性**：  
   - 把“资源治理”从推理角色剥离出来，符合多 Agent 系统常见的 control-plane/data-plane 分离。

---

## 4) 动态 Skill 加载流程：不过度设计的版本
你提出的流程“丞相判断→书记官加载→子任务使用→书记官清理”合理，但要避免把书记官做成“对话参与者”。推荐改成**两段式合同**：

1) **丞相只做声明**（不加载）：  
   - 在 delegate 给九卿/工人时附带 `requirements`：需要哪些能力类别（如 web、repo、db、mcp:github 等），以及期望输出与风险等级。  
2) **书记官在 spawn 前签发合同**：  
   - 将 `requirements` 映射为最小工具集（`setActiveTools` 或 `--tools`）+（若必须）一份极短的 Skill 摘要指令；  
   - 把“被裁剪的全文 Skill prompt”存入 `appendEntry()` 供审计，不进入 LLM。

3) **清理**：  
   - 子任务结束后不需要“卸载动作”，因为书记官在**每次 LLM 调用前的 `context`**都会强制执行“只保留合同摘要，不保留全文注入”。

这样丞相不需要记住清理，书记官也不需要频繁对话，只是控制面。

---

## 5) MCP 管理：是否需要动态控制丞相可见工具？
需要，而且比 Skill 更需要。原因：  
- MCP 工具定义往往“多且长”，并且工具面越大越容易误用。  
- 丞相原则上不执行工具，但它仍会“看到”工具描述从而影响推理；过多工具会增加噪音与误触发规划。

### Pi 上的方案
- 书记官维护 `mcp_visibility` 分组（例如 `mcp:git`, `mcp:issue`, `mcp:db`）。  
- 主进程丞相默认看不到 MCP 工具（因为 setActiveTools=read+delegate），九卿/工人才按合同开放对应 MCP 子集。  
- `context` 继续裁剪掉多余 MCP 工具长描述，仅保留“本任务可用 MCP 工具清单（短表）”。

---

## 6) 与替代方案对比与推荐
### A) 不用书记官，丞相自己 setActiveTools  
- 优点：少一个概念。  
- 缺点：  
  1) setActiveTools 不保证 Skill prompt 不注入（不一定省 token）；  
  2) 丞相会被迫做细粒度资源治理，违背“纯监督”；  
  3) 容易遗忘清理与最小化原则。  
- 结论：适合小项目，不适合“朝廷架构”的硬约束目标。

### B) 不用书记官，Hook 自动管理（检测使用完毕清理）  
- 若“Hook=书记官的一部分”，那本质还是书记官。  
- 若你指的是零散 Hook 规则：容易变成不可审计的“魔法”，并且跨平台迁移难。

### C) 不用书记官，用 session_before_compact 清理  
- 优点：实现简单。  
- 缺点：只能在压缩点生效，**无法解决当轮上下文爆炸**，并且压缩策略通常更激进，可能丢失“工具合同”关键细节。  
- 结论：只能当兜底，不是主方案。

**推荐**：引入书记官，但实现为“控制面 Hook 组合 + 合同协议”，不是新增一个常驻说话者。

---

## 跨平台适配策略（Pi 为主，CC/OC 为辅）
### Pi（主实现）
- 书记官 = `before_agent_start` + `context` + `session_before_compact` + `setActiveTools` + `appendEntry` 的组合体。  
- 子进程隔离：spawn(`pi --no-session --mode json`) 可用于“合同生成器/静态分析器”之类的确定性子流程（不携带主上下文）。

### CC（能力受限）
- 无动态工具集：不能真正“卸载”。策略改为：  
  1) 用 **PreToolUse deny** 做工具守门（近似 allowlist）；  
  2) 用 **PreToolUse updatedInput** 给 subagent 注入“本任务可用工具清单（短）”，减少到处散落的长说明；  
  3) 通过 **PostToolUse exit 2 stderr** 把“本轮工具使用记录/合同状态”回注入父上下文（相当于书记官审计）。  
- 但 CC 无法像 Pi 的 `context` 那样全量改 messages，所以“token 节省”有限，书记官在 CC 更偏安全与秩序。

### OC
- OC 有 `messages.transform`（最强注入/修改）：可直接实现 Pi `context` 同级别的清理能力。  
- 工具管理有限：用 transform 做“工具描述裁剪”、并结合 OC plugin/桥接 `createClaudeCodeHooksHook` 做 deny/记录。  
- 结论：OC 上书记官效果接近 Pi（在上下文清理上甚至更强），在工具源头限制上略弱。

---

## 优势与潜在风险
### 优势
- 显著降低 Skill/MCP 带来的重复 token 成本  
- 形成可审计的“工具合同”与最小权限（least privilege）  
- 不破坏丞相/史官定位：丞相继续超然监督，史官继续零状态建议

### 风险与对策
1) **识别 Skill prompt 不稳定**：  
   - 对策：优先依赖 allowlist + 将全文存档到 appendEntry；context 里只保留合同摘要。  
2) **过度裁剪导致模型忘记关键使用规则**：  
   - 对策：合同摘要必须包含“关键限制/参数/禁忌”，并在每次相关子任务开始前通过 `before_agent_start` 或 `sendMessage(nextTurn)`再注入一次短摘要。  
3) **增加实现复杂度**：  
   - 对策：把书记官实现为“单文件策略模块”，输出固定结构：`{allowedTools, contractSummary, redactionRules}`，并写入审计。

---

### 最终立场  
**引入书记官是必要的，但书记官应被实现为“Hook 驱动的控制面”，用硬约束把 Skill/MCP 生命周期管理机制化**：Pi 上通过 `context` 真正清理/裁剪 + `setActiveTools` 最小权限；CC/OC 上分别用 deny/transform 降级实现。这样收益（token、性能、安全、可维护性）明显大于新增概念的成本，且不破坏现有四角色的设计原则。

---

### Party B — 初始立场 (kimi-k2.5)

## 方 B 立场：反对引入"书记官"角色，主张由丞相直接管理 + Hook 自动清理

---

### 一、核心主张

**书记官是过度设计**。Skill/MCP 的上下文管理应当通过两种机制解决：

1. **丞相直接控制**：利用 `setActiveTools()` 进行源头级工具限制
2. **Hook 自动清理**：利用 `context` 事件实现 Skill prompt 的无感知清理

引入第五个角色会显著增加系统复杂度、Token 开销和调试难度，而收益有限。现有 Pi Extension API 已提供足够的能力，无需新增角色。

---

### 二、技术事实澄清：Pi 的 Skill 机制

在深入方案前，必须明确 Pi Extension 的真实行为（基于题目给出的机制）：

| 机制 | 实际能力 |
|------|---------|
| `setActiveTools()` | **源头级限制**，决定哪些工具能进入 LLM 上下文 |
| `context` 事件 | `structuredClone` 深拷贝，**可完整替换消息列表**，每次 LLM 调用前触发 |
| `session_before_compact` | 自定义压缩逻辑，但触发时机不固定 |
| Skill system prompt | 由 Pi 平台注入，表现为 system message 或 tool definition |

**关键洞察**：Skill 的"污染"体现在两个层面：
- **工具定义层**：`setActiveTools()` 可直接切断
- **Prompt 注入层**：`context` 事件可过滤/替换 messages 数组中的 system message

---

### 三、具体实现方案："双闸门"模型

#### 3.1 架构图（无书记官）

```
┌─────────────────────────────────────────┐
│           丞相 (Chancellor)              │
│  ┌─────────────┐    ┌─────────────┐     │
│  │ 策略决策层   │───→│ setActiveTools│ ←── 闸门 A：源头限制工具集
│  │ (分析任务需求)│    │             │     │
│  └─────────────┘    └─────────────┘     │
│           ↓                             │
│  ┌─────────────────────────────────┐    │
│  │      context Hook (闸门 B)       │    │
│  │  - 检测当前激活的 Skill          │    │
│  │  - 过滤已过期的 Skill prompt     │    │
│  │  - 保留必要的上下文摘要          │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
                    ↓
            [LLM 调用，干净上下文]
                    ↓
        ┌─────────────────────┐
        │   九卿 / 执行层      │ ←── 继承丞相的工具配置
        └─────────────────────┘
```

#### 3.2 闸门 A：丞相的主动工具管理

```javascript
// 丞相的核心决策逻辑（硬编码约束）
const SKILL_REGISTRY = {
  'code-analysis': { tools: ['read', 'search_code'], ttl: 'task' },
  'web-search':    { tools: ['fetch_url', 'search_web'], ttl: 'turn' },
  'database':      { tools: ['sql_query', 'schema_read'], ttl: 'session' }
};

function chancellorAnalyze(task) {
  // 分析任务 → 确定所需 Skills
  const requiredSkills = selectSkills(task);
  
  // 计算最小工具集
  const minimalTools = ['read', 'delegate']; // 丞相基础工具
  requiredSkills.forEach(s => {
    minimalTools.push(...SKILL_REGISTRY[s].tools);
  });
  
  // 源头限制！多余的 Skill 工具根本不进入上下文
  pi.setActiveTools([...new Set(minimalTools)]);
  
  // 记录当前激活的 Skills（用于闸门 B）
  pi.appendEntry({
    type: 'skill_session',
    activeSkills: requiredSkills,
    expiresAt: calculateExpiry(requiredSkills)
  });
}
```

**关键设计**：丞相不加载 Skill 本身，只加载 Skill 对应的**工具子集**。这避免了 Skill system prompt 的注入。

#### 3.3 闸门 B：context 事件的自动清理

当必须使用 Skill（需要其 system prompt）时，用 Hook 实现生命周期管理：

```javascript
// court-skill-manager.js - 作为 Pi Extension 的一部分
pi.on('context', (event) => {
  const messages = event.messages;
  const sessionState = loadSessionState(); // 从 appendEntry 读取
  
  // 识别 Skill 注入的 system messages（通过前缀标记或元数据）
  const skillMessages = messages.filter(m => 
    m.role === 'system' && m.metadata?.skillSource
  );
  
  // 策略：根据 TTL 清理
  const now = Date.now();
  const cleanedMessages = messages.filter(m => {
    if (m.role !== 'system' || !m.metadata?.skillSource) return true;
    
    const skill = m.metadata.skillSource;
    const expiry = sessionState.skillExpiry[skill];
    
    // 硬规则：超过 TTL 必定清理
    if (now > expiry) {
      // 可选：转换为轻量级摘要保留痕迹
      return false; // 完全移除
    }
    
    // 软启发：如果该 Skill 的工具未被使用超过 N 轮
    const lastUsed = sessionState.skillLastUsed[skill];
    if (now - lastUsed > SKILL_IDLE_TIMEOUT) {
      return false;
    }
    
    return true;
  });
  
  // 替换整个消息列表（structuredClone 保证安全）
  event.messages = cleanedMessages;
});
```

#### 3.4 MCP 的特殊处理

MCP server 的工具定义膨胀问题：

```javascript
// 丞相的 MCP 视图裁剪
function filterMcpToolsForChancellor(allMcpTools, taskContext) {
  // 丞相只需要知道"有哪些 MCP 可用"，不需要完整 schema
  return allMcpTools.map(t => ({
    name: t.name,
    description: t.description.slice(0, 100), // 截断描述
    category: t.category,
    // 完整 schema 仅在 delegate 给具体执行层时才加载
  }));
}

// 在 delegate 时按需展开
function expandMcpForWorker(toolName, fullRegistry) {
  return fullRegistry[toolName]; // 完整 schema
}
```

---

### 四、与"书记官"方案的对比分析

| 维度 | 书记官方案 | 双闸门方案（本方） |
|------|-----------|------------------|
| **角色数量** | 5个（+25%复杂度） | 4个（保持简洁） |
| **交互协议** | 需定义丞相↔书记官通信协议 | 无新增协议，Hook 自动执行 |
| **Token 开销** | 每轮多一次"请求-响应"对话 | 仅 context 事件处理，无 LLM 调用 |
| **延迟** | 引入额外进程/Agent 启动时间 | 同步 Hook 执行，零延迟 |
| **可靠性** | 分布式状态需一致性保障 | 单进程内状态，原子操作 |
| **调试难度** | 跨 Agent 追踪困难 | 单一日志流，可观测性强 |
| **CC/OC 适配** | 需重新实现书记官逻辑 | CC 用 PreToolUse 模拟，OC 用 messages.transform |

---

### 五、跨平台适配策略

#### 5.1 Pi Extension（主平台）
如上所述，完整实现双闸门模型。

#### 5.2 Claude Code（辅助平台）

CC 缺乏 `setActiveTools`，但有 `PreToolUse` 的 `updatedInput` 和 deny 能力：

```javascript
// CC hook 模拟"闸门 A"
const ALLOWED_TOOLS = new Set(['read', 'edit', 'bash', 'subagent']);

module.exports = {
  async PreToolUse({ toolName, input }) {
    if (!ALLOWED_TOOLS.has(toolName)) {
      // 模拟工具不存在
      return { 
        updatedInput: { 
          __blocked: true,
          reason: `Tool ${toolName} not in active set for this role`
        }
      };
    }
    // 正常执行
  }
};
```

CC 的 `Sub-Agent Task` 隔离特性天然支持"闸门 B"——子 Agent 的上下文独立，返回后父 Agent 可选择性吸收。

#### 5.3 OpenCode（辅助平台）

利用最强的 `messages.transform`：

```javascript
// .opencode/hooks/skill-cleanup.js
module.exports = {
  messagesTransform(messages, context) {
    // 比 Pi 更直接的修改能力
    const userConfig = context.workspace.get('skill-config');
    return messages.filter(m => 
      !isExpiredSkillMessage(m, userConfig)
    );
  }
};
```

---

### 六、潜在风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| context 事件处理耗时 | 异步化非关键路径，设置处理超时 |
| Skill 误清理导致功能中断 | 保守策略：宁可保留，不可错删；添加回归测试 |
| MCP 工具名冲突 | 命名空间隔离：`mcp-{server}-{tool}` |
| 跨平台行为不一致 | 核心逻辑抽离为共享库，平台特定部分最小化 |

---

### 七、结论

**拒绝书记官，拥抱机制**。朝廷架构的价值在于角色职责的清晰划分，而非角色的数量堆砌。Skill/MCP 管理是**基础设施能力**，应当下沉到 Hook 层自动处理，而非上浮为独立角色增加认知负担。

丞相的"超然地位"不应被稀释——若连工具选择都要委托他人，何谈"纯监督者"？双闸门模型让丞相保持决策权威，同时通过技术手段消除副作用，这才是架构设计的优雅之道。

---

### Party C — 初始立场 (claude-sonnet-4-6)

# 方 C 立场：书记官角色应被拒绝——职责下沉至执行层，Hook 承担清理

## 核心主张

**不引入书记官角色。** 书记官的所谓职责——Skill/MCP 上下文的加载与清理——是一个被高估的问题，其解决方案应该是**架构内嵌**而非**角色增殖**。引入第五个角色会带来真实的协调开销，而它解决的问题在 Pi Extension 的现有机制下根本不需要专职角色。

我的核心论点分三层：

1. **Skill 上下文清理是 `context` 事件的天然职责**，不需要独立角色
2. **动态 Skill 加载决策属于九卿的分解权限**，不需要上移到新角色
3. **书记官的引入会打破丞相的超然地位**，制造一个模糊的权力节点

---

## 技术前提澄清：Skill 注入的真实机制

在讨论清理之前，必须先厘清 Pi Skill 系统的注入方式。Skill 的 system prompt 是在 `before_agent_start` 或 session 初始化时注入的，它进入 LLM 的 system prompt 层而非消息历史层。这个区别至关重要：

- **消息历史层**：`context` 事件可以完整替换，structuredClone 深拷贝后随意修改
- **System prompt 层**：`before_agent_start` 可以在每轮修改，但这是替换整个 systemPrompt 字符串

这意味着 `context` 事件**可以**清理消息历史中 Skill 留下的 tool_result 和调用记录，但 Skill 的 system prompt 注入需要通过 `before_agent_start` 来控制。两者结合，现有机制完全覆盖清理需求。

---

## 方 C 的具体实现方案

### 方案一：Hook 内嵌清理（Pi 主平台）

**Skill 生命周期由两个 Hook 协作管理，不引入任何新角色：**

```
before_agent_start:
  读取当前轮次的 active_skills 状态（存于 appendEntry 的持久化区）
  根据状态动态构建 systemPrompt：
    - 任务未开始：注入所有可能需要的 Skill prompt（由九卿在 delegate 时声明）
    - 任务进行中：只保留当前子任务需要的 Skill prompt
    - 子任务完成：从 systemPrompt 中移除已完成任务的 Skill prompt

context 事件:
  扫描消息历史，识别已完成的 Skill 工具调用序列
  将完整的 tool_use + tool_result 对替换为单行摘要：
    "[Skill:web_search] 已完成 3 次调用，结果已整合到任务输出"
  保留 Skill 的最终输出，丢弃中间调用细节
```

**关键实现细节：**

```javascript
// context 事件处理器（伪代码，基于 Pi Extension API）
extension.on('context', (messages) => {
  const completedSkills = getCompletedSkillsFromPersistence(); // appendEntry 读取
  
  return messages.map(msg => {
    if (isSkillToolCall(msg) && completedSkills.has(msg.skillId)) {
      // 替换为摘要，不是删除——保留语义
      return createSkillSummaryEntry(msg);
    }
    return msg;
  });
});

// before_agent_start 处理器
extension.on('before_agent_start', (session) => {
  const activeSkills = getActiveSkillsForCurrentPhase();
  session.systemPrompt = buildSystemPrompt(basePrompt, activeSkills);
  // 已完成阶段的 Skill prompt 不再注入
});
```

**这个方案的关键优势**：`context` 事件在每次 LLM 调用前触发，清理是**即时的、自动的、无需任何 Agent 参与**。没有额外的 LLM 调用，没有协调开销，Token 成本接近于零（只有 Hook 本身的 CPU 计算）。

### 方案二：Skill 加载决策归属九卿

**动态 Skill 加载的决策链：**

```
丞相 → delegate("九卿-A", task, {required_skills: ["web_search", "code_exec"]})
                                    ↑
                              九卿在接受任务时声明
                              自己需要哪些 Skill
                              
九卿-A 启动时：
  环境变量 PI_COURT_SKILLS=web_search,code_exec
  Extension Hook 读取此变量，在 before_agent_start 注入对应 Skill prompt
  setActiveTools() 激活对应工具
  
九卿-A 完成时：
  agent_end 触发
  appendEntry 记录 {skill: "web_search", status: "completed", phase: "九卿-A"}
  父进程的 context 事件在下次 LLM 调用时自动清理
```

这个设计让**九卿负责声明自己的工具需求**，而**Hook 负责执行加载和清理**。丞相不需要知道 Skill 的细节，九卿不需要等待书记官，整个流程是声明式的。

### 方案三：MCP 工具可见性管理

MCP 工具定义的 Token 占用是真实问题，但解决方案同样不需要书记官：

```javascript
// setActiveTools 可以精确控制 MCP 工具可见性
extension.on('before_agent_start', (session) => {
  const currentPhase = getCurrentPhaseFromPersistence();
  
  // 丞相只看到 delegate 和 read——MCP 工具对丞相不可见
  if (session.role === 'chancellor') {
    session.setActiveTools(['delegate', 'read']);
    return;
  }
  
  // 九卿看到与其任务相关的 MCP 工具子集
  if (session.role === 'minister') {
    const relevantMcpTools = getMcpToolsForTask(currentPhase.taskType);
    session.setActiveTools([...coreTools, ...relevantMcpTools]);
  }
});
```

**丞相永远不看到 MCP 工具定义**，这本身就是最好的 MCP 上下文管理——不是清理，而是从源头隔离。

---

## 为什么书记官会破坏架构

### 问题一：权力节点模糊化

书记官如果能控制哪些 Skill 对丞相可见，它实际上在**过滤丞相的能力边界**。这是一个比史官更敏感的权力位置——史官只是建议，书记官在限制。谁来监督书记官？架构开始需要递归。

### 问题二：协调成本被低估

设想书记官存在的交互序列：
```
丞相 → 书记官: "我需要 web_search Skill"
书记官: [加载 Skill，注入 prompt，激活工具]
书记官 → 丞相: "已就绪"
丞相 → 九卿: delegate(task)
九卿完成 → 书记官: "web_search 可以卸载了"
书记官: [清理]
```

每次 Skill 生命周期涉及**至少 2 次额外 LLM 调用**（书记官的加载确认和清理确认）。如果项目有 10 个 Skill 加载/卸载周期，这是 20 次额外调用。相比之下，Hook 方案的成本是 0 次额外 LLM 调用。

### 问题三：解决的问题并不存在

Skill prompt 的 Token 浪费是真实的，但规模有限。一个典型 Skill 的 system prompt 在 200-500 Token 之间。在一个长项目中，这相对于工具调用历史的 Token 占用是次要的。用一个新角色（带来自身的 system prompt、协调消息、状态管理开销）来节省 Skill prompt 的 Token，可能是负收益。

---

## 跨平台适配策略

### Pi Extension（主平台）
完全按上述方案实现。`context` 事件 + `before_agent_start` + `appendEntry` 三件套覆盖所有需求。

### CC Hooks（辅助平台）
CC 没有 `setActiveTools`，但可以用 `PreToolUse` 实现软性过滤：

```
PreToolUse hook:
  检查当前 agent 的 role（从环境变量读取）
  如果 role=chancellor 且 tool 不在 [Task, Read] 白名单
  → exit 2，stderr: "此工具不在丞相权限范围内"
```

Skill prompt 清理在 CC 中退化为 `session_before_compact` 时的批量清理，不能做到实时清理。这是 CC 平台的已知限制，不需要书记官来弥补。

### OC（OpenCode）
`messages.transform` 是最强的注入点，可以在每次 API 调用前执行 Skill 摘要替换，相当于 Pi 的 `context` 事件。Skill 加载决策通过 `.opencode/agents/*.md` 的 YAML frontmatter 静态声明，动态性不如 Pi，但对于大多数场景足够。

---

## 潜在风险与应对

**风险一：Hook 逻辑过于复杂**

如果 `context` 事件的清理逻辑变得复杂（识别哪些 Skill 调用已完成，哪些还在进行中），代码维护成本上升。

**应对**：用 `appendEntry` 维护一个明确的 Skill 状态表，`context` 事件只做简单的状态查表，不做推断。复杂度集中在状态写入端（九卿完成时的 `agent_end`），而非读取端。

**风险二：Skill 状态跨进程同步**

九卿是独立子进程，它完成时的状态需要传递给父进程（丞相）的 Hook。

**应对**：`appendEntry` 的持久化存储是跨进程共享的（写入同一个 session 文件），这是它的设计用途。九卿在 `agent_end` 时写入，丞相的 `context` 事件在下次触发时读取。这是 Pi 架构的标准数据流，不需要额外机制。

---

## 结论

书记官是一个**用角色解决本该用机制解决的问题**的典型案例。Pi Extension 的 `context` 事件 + `before_agent_start` + `setActiveTools` 三件套已经提供了完整的 Skill 生命周期管理能力，缺的只是把这个逻辑写进 Hook 代码里。

引入书记官的真实代价：更多的角色定义、更多的交互协议、更多的 LLM 调用、更模糊的权力边界。换来的收益：把 Hook 代码移到了一个 Agent 里——这不是简化，这是用复杂性换复杂性。

**朝廷架构的优雅在于每个角色有且只有一个清晰的存在理由。书记官没有。**

---

## 第二轮：反驳与修正

### Party A — 反驳 (gpt-5.2)

我方 A：**不设“书记官”这个独立 Agent 角色**，但要承认 Skill/MCP 的“上下文膨胀”是硬问题；最佳解是把“书记官职能”**下沉为 Pi Extension 的基础设施层（Hook/Policy）**，并通过**声明式 skill scope + 强制工具白名单 + 系统 prompt 生成器**解决。也就是说：**需要 Clerk 的“功能”，不需要 Clerk 的“角色”**。

---

## 1) 逐点指出 B/C 方案的弱点与风险

### 弱点 A：把“Skill prompt 可清理”假设得过强（B 的 context 清理）
B 认为 `context` 事件可过滤 Skill system message，从而“清理 Skill prompt”。风险在于：题面只保证 `context` 可替换**消息列表**，但 Skill prompt 注入在 Pi 里可能发生在 **systemPrompt 层**（由平台注入，不一定以 message 形式出现）。  
- 若注入在 systemPrompt：`context` 删不掉；必须用 `before_agent_start` 重建 systemPrompt 才能实现“卸载”。  
- 若注入以 system message 表现：`context` 能删，但你得**可靠识别**哪些 system message 属于哪个 Skill；题面没有保证存在 `metadata.skillSource`。靠文本前缀/启发式会误删。

**结论**：仅靠 `context` 做 Skill prompt 清理不够稳，需要 `before_agent_start` 作为“硬闸门”。

### 弱点 B：把“丞相直接 setActiveTools”说成零成本（B/C 共同）
丞相是 read+delegate only。让丞相“每轮分析后 setActiveTools”会引入两个问题：  
1) **权责污染**：丞相不执行，但却要维护细粒度工具策略，事实上变成“工具管理员”。  
2) **策略漂移**：任务复杂时，丞相每轮都要更新 tool set，容易忘记收回，导致“工具窗口越开越大”。

**结论**：工具策略应由 Hook 强制执行，丞相只做“声明需求/批准范围”。

### 弱点 C：把 MCP 工具定义当成可随意裁剪（B 的“截断 schema”）
B 提到对 MCP tool schema 做截断/裁剪。这在 Pi/CC/OC 都存在一致性风险：  
- 工具定义是模型理解工具输入输出的唯一依据；截断可能导致 tool_use 生成错误参数，**失败率上升**，反而增加重试 token。  
- 在 Pi 里更靠谱的是：**从源头 setActiveTools 限制“哪些 MCP 工具进入上下文”**，而不是篡改 schema 内容。

### 弱点 D：C 方案把“由九卿声明所需 Skill”推得过彻底
“九卿声明 skill”很对，但如果没有一个统一的 policy 层，九卿会出现：  
- 各自声明同义 skill（命名漂移）  
- 过量声明（为了方便把一堆技能都开了）  
- 生命周期不闭合（没写 completion 状态，导致不卸载）

**结论**：需要一个强制的“skill registry + scope 协议 + 自动回收”，但这依然不必是新 Agent。

---

## 2) 为什么我方方案更优：把“书记官”做成 Hook 层的强约束基础设施

核心思想：**将 Skill/MCP 管理从“对话型协调”改为“声明式策略 + 自动执行”**，避免新增角色带来的额外 LLM 轮次与协议复杂度。

### 我方三闸门（Pi 主平台）
1) **闸门 0（制度）：Skill/MCP Registry**  
   - 统一 skill 名称、对应 tool 列表、systemPrompt 片段、默认 TTL/scope（turn/task/session）。  
2) **闸门 1（工具源头）：setActiveTools 强制最小可见**  
   - 丞相永远仅 `read + delegate`（硬编码）  
   - 九卿/工人只拿到本任务声明的 tools（含 MCP 子集）  
3) **闸门 2（prompt 源头）：before_agent_start 重建 systemPrompt（实现“卸载”）**  
   - systemPrompt = base + 当前 scope 内 skills 的 prompt 片段（拼接生成）  
   - scope 结束自动移除片段（无需猜测平台注入位置）  
4) **闸门 3（历史清理）：context 事件压缩 tool_use/tool_result**  
   - 将已完成 skill 的中间调用替换为摘要，减少 token 回流

这套机制实现了：**不新增 Agent，不新增对话轮次，仍能实现动态加载/卸载与上下文瘦身**。

---

## 3) 承认对方优点并整合

- B/C 强调的“不要增加角色、用 Hook 自动化”是对的，我方完全吸收。  
- C 强调“由九卿声明需求”也对，我方吸收，但加上 **registry 校验 + 强制 scope 闭合**，避免漂移。  
- B 提到 “双闸门（tools + context）”也可用，但我方补上关键的 **before_agent_start systemPrompt 生成**，解决“context 未必能删 prompt”的不确定性。

---

## 4) 我方修订后具体实现方案（Pi 为主，兼容 CC/OC）

### 4.1 Pi：声明式 skill scope 协议（不引入书记官 Agent）
- 丞相/九卿在 `delegate` 时传入结构化需求（写入环境变量或任务文本约定段落）：
  - `required_skills: ["web_search","repo_grep"]`
  - `mcp_allow: ["mcp-github.search","mcp-jira.issue_get"]`
  - `scope: "task"`（默认）
- 九卿/工人在 `agent_end` 写入 appendEntry：`{skill_scope_close: ["web_search"]}`（或由 Hook 依据任务结束自动关闭）。

### 4.2 Pi：Hook 执行（关键）
- `before_agent_start`：  
  - 读取 appendEntry 中的 “当前角色 + 当前任务 scope + required_skills”  
  - **生成 systemPrompt**（base + skill prompt 片段），实现真正“卸载/不注入”  
  - `setActiveTools(core + skill.tools + mcp_allow)`，否则一律不可见
- `context`：  
  - 将已关闭 scope 的 tool_use/tool_result 链压缩成摘要（而非依赖识别 system message）
- `session_before_compact`：  
  - 作为兜底：若 scope 状态丢失，在 compaction 时按 registry 重建最小上下文

### 4.3 MCP 管理策略
- 不裁剪 schema，不改写 tool 定义；只做 **可见性管理**：`setActiveTools()` 选择性暴露 MCP 工具。  
- 丞相默认不见 MCP；九卿/工人按任务声明暴露 MCP 子集。

### 4.4 跨平台适配
- **CC**：无 `setActiveTools`，只能用 `PreToolUse` 做 deny（软闸门），并把“skill scope”写入 Task prompt（updatedInput）让模型自我约束；清理主要依赖 Sub-Agent 隔离与 Stop/SubagentStop 自循环史官机制，无法做到 Pi 级别的 prompt 卸载。  
- **OC**：用 `messages.transform` 实现与 Pi `context` 等价的历史清理；工具可见性较弱则退化为“deny/提示”，但仍可用 agents YAML frontmatter 静态声明 skills（动态性较差但可接受）。

---

## Token 成本与性能结论
- **不设书记官 Agent**：避免每次加载/卸载产生额外 LLM 往返（最省 token、最省延迟）。  
- 主要开销变为本地 Hook 计算（字符串拼接、消息过滤），CPU 级别，远低于一次 LLM 调用。  
- 真正的 token 节省来自两点：  
  1) `before_agent_start` 只注入当轮所需 skill prompt（不堆积）  
  2) `context` 将工具调用历史摘要化（削减长会话膨胀的主因）

---

## 最终立场
**反对把书记官做成第五个 Agent 角色**；但强烈建议把“书记官职能”固化为 Pi Extension 的 **Skill/MCP Policy Layer**（before_agent_start + setActiveTools + context + compaction 兜底）。这满足硬约束、最小 token、最小交互复杂度，同时跨平台可退化实现。

---

### Party B — 反驳 (kimi-k2.5)

## 方 B 立场：书记官作为"轻量控制面"，但非独立 Agent

### 核心主张

**引入"书记官"概念，但实现为"无对话状态的 Hook 策略模块"，而非第五个常驻 Agent。** 这与方 A 的"控制面"思路接近，但我强调**更激进的简化**：书记官甚至不应该有"申请-响应"协议，只保留**声明式配置 + 自动执行**。

我的关键修正：
- **反对方 A 的"合同申请"流程**：任何需要丞相与书记官对话的设计都是过度工程
- **反对方 C 的"九卿自声明"**：让九卿决定自己的 Skill 边界，违背最小权限原则
- **采纳方 C 的 Hook 自动化**：但增加硬约束层，防止九卿越权

---

## 三方方案对比分析

| 维度 | 方 A (控制面书记官) | 方 C (纯 Hook 无角色) | 方 B (轻量控制面) |
|:---|:---|:---|:---|
| **实现形态** | Hook 组合 + 合同协议 | 纯内置 Hook | Hook 组合 + 静态配置 |
| **丞相参与** | 需声明 requirements | 不参与 | 完全不参与 |
| **九卿权限** | 接收合同 | 自声明 Skill | 接收预绑定配置 |
| **动态性** | 高（运行时协商） | 中（阶段切换） | 低（spawn 时确定） |
| **跨平台成本** | 高（协议需适配） | 低 | 最低 |
| **安全边界** | 强（allowlist） | 弱（依赖九卿自律） | 最强（spawn 参数固化） |

---

## 对方案的具体批评

### 方 A 的关键弱点："合同申请"是伪需求

方 A 设计的两段式合同：
```
丞相声明 requirements → 书记官签发合同 → 子任务使用
```

**问题**：这要求丞相在 delegate 时做**能力推理**（判断需要什么 Skill），违背了"read+delegate only"的超然定位。丞相一旦开始分析"这个任务需要 web_search 还是 code_exec"，它就变成了**技术架构师**，而非**政治监督者**。

更严重的是，Pi 的 `delegate` 工具没有"requirements"字段。要实现这个协议，必须：
- 方案一：丞相在 task 描述中嵌入结构化文本（如 YAML），由书记官解析——**脆弱**
- 方案二：扩展 delegate 工具的 schema——**侵入平台**

两者都增加了真实复杂度。

### 方 C 的关键弱点：九卿自声明破坏最小权限

方 C 让九卿通过环境变量 `PI_COURT_SKILLS` 自声明所需 Skill：

```javascript
// 九卿启动时
PI_COURT_SKILLS=web_search,code_exec
```

**致命缺陷**：这是**自我授权**。九卿可以声明任何 Skill，包括超出其职责范围的。朝廷架构的核心是**权力制衡**，而方 C 的设计假设九卿可信——这与"尽量用硬编码约束"的设计原则直接冲突。

方 C 的回应可能是"Hook 可以验证"。但验证逻辑写在哪里？如果写在九卿进程的 Hook 里，九卿可以篡改；如果写在父进程，父进程需要预判九卿的行为——又回到了丞相需要理解 Skill 细节的问题。

### 双方共有的盲区：MCP 工具的动态分组

双方都未充分讨论 MCP 的特殊性。MCP server 可能暴露数十个工具（如 GitHub MCP 有 30+ 工具），但单次任务通常只需要 2-3 个。方 C 的 `setActiveTools` 按 role 过滤过于粗糙，方 A 的"合同"又过于动态。

---

## 方 B 的修订方案：Spawn-Time 固化配置

### 核心机制

**Skill/MCP 绑定发生在 spawn 时刻，之后不可变更。**

```
丞相 delegate(task, to="九卿-A") 
  ↓
Extension 拦截 delegate，查询预定义映射表：
  "九卿-A" → {skills: ["web_search"], mcp_tools: ["github:search_issues"]}
  ↓
spawn("pi", [
  "--no-session",
  "--mode", "json",
  "--tools", "read,write,web_search",           // 硬编码工具白名单
  "--skill-prompts", "web_search:summary_v2",   // 仅注入指定 Skill 的摘要版本
  env: {PI_COURT_ROLE: "minister", PI_COURT_MINISTER_ID: "九卿-A"}
])
  ↓
九卿进程内，before_agent_start 读取 env，确认配置不可更改
context 事件执行标准清理（已完成任务的 tool_result 摘要化）
```

### 关键设计决策

| 决策 | 理由 |
|:---|:---|
| **配置静态化** | 九卿的职责范围是架构设计时确定的，不应运行时协商 |
| **spawn 参数固化** | Pi 的 `--tools` 是源头级限制，比 `setActiveTools` 更强 |
| **Skill 摘要版本** | 每个 Skill 维护一个"精简版 system prompt"（50-100 token），替代完整版（500+ token） |
| **无运行时协议** | 丞相、九卿、Hook 都不需要理解"合同"概念 |

### 书记官的实现形态

```javascript
// clerk.config.js —— 纯静态配置，无运行时逻辑
export default {
  ministers: {
    "九卿-治粟": {  // 财政/数据
      skills: ["data_analysis", "csv_processing"],
      mcp: ["db:query", "db:schema"],
      maxTokens: 4000
    },
    "九卿-典客": {  // 外交/网络
      skills: ["web_search", "api_client"],
      mcp: ["github:read", "slack:post"],
      maxTokens: 3000
    }
    // ... 其他九卿
  },
  
  // Skill 摘要版本定义
  skillSummaries: {
    "web_search": "可使用 web_search 工具查询公开信息，每次调用消耗 1 次额度",
    "data_analysis": "可执行 Python 数据分析，禁止访问网络"
  }
};
```

**这就是"书记官"的全部实体**：一个 JSON 配置文件 + 一个读取它的 Hook 函数。没有对话状态，没有申请协议，没有运行时决策。

### 清理机制（整合方 C 的优点）

```javascript
// context 事件 —— 标准清理，所有子进程共享
extension.on('context', (messages, {env}) => {
  const ministerConfig = loadClerkConfig()[env.PI_COURT_MINISTER_ID];
  
  return messages.map(msg => {
    // 规则 1: 非本九卿授权的 Skill 调用记录 → 删除（异常，应不存在）
    if (isUnauthorizedSkillCall(msg, ministerConfig)) {
      appendEntry({type: "security_alert", msg}); // 审计
      return null;
    }
    
    // 规则 2: 已完成的 Skill 调用序列 → 摘要
    if (isCompletedSkillSequence(msg, messages)) {
      return createMinimalSummary(msg);
    }
    
    // 规则 3: 原始 Skill system prompt → 替换为摘要版本
    if (isFullSkillPrompt(msg)) {
      return replaceWithSummary(msg, ministerConfig.skills);
    }
    
    return msg;
  }).filter(Boolean);
});
```

---

## 跨平台适配

| 平台 | 书记官实现 | 降级策略 |
|:---|:---|:---|
| **Pi** | `clerk.config.js` + spawn 参数注入 + context 清理 | 完整功能 |
| **CC** | 同配置文件，但技能限制退化为 PreToolUse deny | 无法清理 Skill prompt（CC 无 context 事件），只能依赖 session_before_compact |
| **OC** | `.opencode/agents/*.md` frontmatter 嵌入配置 | `messages.transform` 实现 context 级清理，效果接近 Pi |

CC 的已知限制：无法实时清理 Skill prompt，但这是平台约束，任何方案都无法突破。方 B 的优势在于**配置层统一**，CC 和 OC 复用相同的 `clerk.config.js` 结构，只是执行引擎不同。

---

## 风险回应

**"静态配置不够灵活"**

九卿的职责边界确实可能变化，但这属于**架构演进**，不是**运行时动态性**。修改 `clerk.config.js` 并重启会话是合理成本。若真有极端动态需求（如临时授予某九卿特殊权限），丞相可通过 `delegate` 的 task 描述附加一次性覆盖标记——这是例外而非常态，不破坏整体简洁性。

**"Skill 摘要版本维护成本高"**

每个 Skill 只需维护一份 50-100 token 的摘要，相对于完整的 system prompt 开发，边际成本极低。且摘要可由 Skill 作者提供，或自动生成（提取前 3 条关键指令）。

---

## 最终立场

| 问题 | 答案 |
|:---|:---|
| 是否需要书记官？ | **需要概念，但非 Agent** |
| 书记官形态 | 静态配置 + 无状态 Hook |
| 核心机制 | Spawn-time 固化，零运行时协议 |
| 关键取舍 | 牺牲动态性，换取确定性和简洁性 |

方 A 的"控制面"方向正确，但"合同申请"流程过度设计；方 C 的 Hook 自动化正确，但"九卿自声明"破坏安全。方 B 取两者之长：**用方 C 的 Hook 执行方 A 的控制意图，但消除所有运行时协商，将配置静态化到 spawn 时刻**。

这不是"第五角色"，而是**架构的基础设施层**——如同 Linux 的 cgroups，对进程透明，但强制执行资源边界。

---

### Party C — 反驳 (claude-sonnet-4-6)

# 方 C：书记官作为"声明式清单" — 第三条路

## 先说两方的真实弱点

**方 A 的核心问题：控制面本身需要推理。**

方 A 把书记官描述为"Hook 驱动的控制面"，听起来很干净，但实现细节暴露了矛盾。"将 requirements 映射为最小工具集"——这个映射是谁做的？如果是硬编码规则，那跟方 B 的 `SKILL_REGISTRY` 没有本质区别；如果需要推理，那书记官就变成了一个隐藏的 LLM 调用，成本和复杂度都被低估了。方 A 承认"识别 Skill prompt 不稳定"是风险，但给出的对策是"启发式匹配"——这恰恰是架构中最脆弱的部分，因为它把一个本应确定性的操作变成了概率性操作。

**方 B 的核心问题：把决策责任放错了地方。**

方 B 说"丞相保持决策权威"，但丞相的约束是 `read + delegate only`，是**纯监督者**。让丞相调用 `setActiveTools()` 并维护 `SKILL_REGISTRY`，意味着丞相需要了解具体工具的实现细节——这违背了"超然地位"的设计原则。更根本的问题是：方 B 的 `context` Hook 依赖 `m.metadata?.skillSource` 这样的元数据，但 Pi 的 Skill 注入机制并不保证这个元数据存在。方 B 用"关键洞察"掩盖了一个假设：Skill prompt 是可识别的。如果不可识别，整个双闸门就只剩一扇门。

## 我的方案：书记官作为声明式清单，而非执行者

两方都在争"书记官是否应该存在"，但真正的问题是**书记官的形态**。

我的立场：**书记官存在，但它是一份数据结构，不是一个 Agent。**

### 核心设计

书记官的实体是一个 **`court-manifest.json`**，由丞相在任务分析阶段一次性生成，之后由 Hook 机械地执行：

```json
{
  "task_id": "feature-xyz",
  "phases": [
    {
      "phase": "analysis",
      "allowed_tools": ["read", "delegate"],
      "skill_summaries": {
        "code-analysis": "分析代码结构，关注 src/core 目录，禁止修改"
      }
    },
    {
      "phase": "implementation", 
      "allowed_tools": ["read", "write", "bash", "delegate"],
      "skill_summaries": {
        "code-style": "遵循 ESLint config，禁用 any 类型"
      }
    }
  ],
  "mcp_visibility": {
    "chancellor": [],
    "minister": ["mcp:git", "mcp:github"],
    "worker": ["mcp:git", "mcp:github", "mcp:filesystem"]
  }
}
```

**丞相只做一件事**：在任务开始时，基于 `read` 到的项目信息，生成这份清单，然后 `delegate`。清单生成之后，丞相不再参与工具管理。这符合"纯监督者"的定位——它做的是**规划**，不是**执行**。

### Pi Extension 的具体实现

**`before_agent_start`**：读取清单，调用 `setActiveTools()`，注入对应阶段的 `skill_summaries` 作为 systemPrompt 片段（短，确定性，不依赖 Skill 原始 prompt 的识别）。

**`context` 事件**：不做启发式识别。策略简单粗暴：**删除所有 system message，重新注入清单中的 `skill_summaries`**。这避免了"Skill prompt 是否可识别"的问题——我们不识别，我们替换。

```javascript
pi.on('context', (event) => {
  const manifest = loadManifest(); // 从 appendEntry 读取，不进 LLM
  const currentPhase = getCurrentPhase();
  
  // 不识别，直接替换：清除所有 system，重注入清单摘要
  const userMessages = event.messages.filter(m => m.role !== 'system');
  const systemMessages = Object.entries(manifest.phases[currentPhase].skill_summaries)
    .map(([skill, summary]) => ({
      role: 'system',
      content: `[${skill}] ${summary}`
    }));
  
  event.messages = [...systemMessages, ...userMessages];
});
```

**`appendEntry()`**：清单本身通过 `appendEntry` 持久化，不进 LLM 上下文。

### 跨平台适配

**CC**：PreToolUse 读取清单的 `allowed_tools`，deny 不在列表中的工具。清单通过 `pending-advice.md` 传递（复用已有的文件中转机制）。`skill_summaries` 通过 SessionStart 的 `additionalContext` 注入。

**OC**：`messages.transform` 直接实现 context 事件的逻辑，甚至更简洁。清单放在 `.opencode/agents/` 目录下作为 frontmatter。

### MCP 管理

清单中的 `mcp_visibility` 按角色分层。丞相的 MCP 可见性为空数组——它不需要看到任何 MCP 工具，因为它不执行。九卿和工人在 spawn 时通过 `--tools` 参数或 `setActiveTools` 获得对应子集。这是硬约束，不依赖推理。

## 整合两方的合理观点

**方 A 正确的地方**：工具治理需要机制化，不能依赖软约束。我整合了这一点——清单是硬数据，Hook 是硬执行，没有"习惯"可言。

**方 B 正确的地方**：不应引入新的 LLM 调用或常驻 Agent。我的书记官是一份 JSON，没有自己的上下文，没有推理开销。方 B 的 `context` 替换思路也是对的，但它依赖元数据识别；我的方案改为全量替换，更鲁棒。

## 为什么第三条路更优

| 维度 | 方 A | 方 B | 方 C |
|------|------|------|------|
| 丞相职责边界 | 模糊（书记官也做推理） | 违反（丞相管工具细节） | 清晰（丞相只生成清单） |
| Skill 识别依赖 | 启发式，不稳定 | 元数据，假设存在 | 不识别，全量替换 |
| Token 开销 | 书记官 LLM 调用 | 零额外调用 | 零额外调用 |
| 可审计性 | appendEntry 存档 | 日志 | 清单本身即审计日志 |
| 跨平台 | 需重实现控制面 | Hook 逻辑各平台不同 | 清单格式统一，执行层各自适配 |

**最关键的一点**：清单是丞相在任务开始时一次性生成的，这是规划行为，符合丞相的监督者定位。之后的所有清理、限制、过滤都是机械执行，不需要任何推理。这才是"尽量用硬编码约束"原则的真正落地——不是硬编码规则，而是硬编码**流程**：规划一次，执行到底。

---

## 第三轮：评审裁决

> 评审模型: qwen3.5-plus

# 多 Agent 系统架构评审报告：书记官（Clerk）角色设计辩论

## 1. 各方优劣总结

### 方 A (gpt-5.2)：控制面书记官 (Control-Plane Clerk)
*   **核心主张**：引入“书记官”概念，但将其实现为**Hook 驱动的控制面**而非独立对话 Agent。通过“合同协议”动态管理 Skill/MCP 生命周期，强调源头限制 (`setActiveTools`) 与上下文裁剪 (`context`) 的双重治理。
*   **优势**：
    *   **架构清晰**：明确区分了“推理层”（丞相/九卿）与“控制层”（书记官），符合 Control-Plane/Data-Plane 分离的经典架构原则。
    *   **安全性高**：提出了“工具合同”概念，强制最小权限原则，有效降低攻击面。
    *   **Token 优化**：双通道治理（源头禁用 + 上下文替换）能最大程度节省 Token。
*   **弱点**：
    *   **过度工程化风险**：提出的“两段式合同申请流程”（丞相声明→书记官签发）在 Pi 现有 `delegate` 机制下缺乏原生支持，需侵入式扩展或脆弱的文本解析，增加了实现复杂度。
    *   **识别依赖**：依赖对 Skill prompt 的启发式识别进行清理，若平台注入方式变更，策略易失效。

### 方 B (kimi-k2.5)：静态配置书记官 (Static Config Clerk)
*   **核心主张**：反对运行时协商，主张将书记官固化为**静态配置文件 (`clerk.config.js`)**。在 `spawn` 时刻通过参数固化技能包和工具白名单，彻底消除运行时协议开销。
*   **优势**：
    *   **确定性最强**：Spawn-time 固化配置完全消除了运行时状态同步和协商的不确定性，符合“硬编码约束”原则。
    *   **零运行时开销**：无额外 LLM 调用，无动态推理，性能最优。
    *   **职责边界清晰**：丞相无需理解工具细节，仅需按预定义角色委托，避免了权责污染。
*   **弱点**：
    *   **灵活性不足**：对于非标准任务或临时性需求，静态配置显得僵化，缺乏应对突发场景的动态调整能力。
    *   **维护成本转移**：虽然运行时简单，但需要预先为每种可能的任务类型维护详细的配置映射，前期架构设计成本高。

### 方 C (claude-sonnet-4-6)：声明式清单书记官 (Declarative Manifest Clerk)
*   **核心主张**：书记官是一份**数据结构 (`court-manifest.json`)**。丞相在任务启动时一次性生成该清单（规划行为），后续由 Hook 机械执行清单中的限制和替换策略（全量替换 System Message）。
*   **优势**：
    *   **完美平衡**：既保留了方 A 的动态适应性（针对具体任务生成清单），又继承了方 B 的运行时零开销（Hook 机械执行）。
    *   **鲁棒性极高**：提出“不识别，直接全量替换 System Message"的策略，彻底规避了 Skill prompt 识别不稳的技术风险。
    *   **符合角色定位**：将清单生成定义为丞相的“规划”职责（符合监督者定位），而非“执行”职责，逻辑自洽。
*   **弱点**：
    *   **初始延迟**：任务启动时需先生成清单，可能增加首轮响应时间（但在可接受范围内）。
    *   **清单格式约束**：需要严格定义清单 Schema，否则 Hook 执行可能出错。

---

## 2. 共识点提取

经过三轮辩论，三方在以下关键技术上达成高度一致：
1.  **拒绝独立 Agent 形态**：一致反对将书记官设计为拥有独立上下文、参与对话循环的第五个 Agent 角色。书记官必须是**基础设施层**或**数据层**。
2.  **双重治理机制**：均认可单一手段不足，必须结合**源头工具限制**（`setActiveTools` / `--tools`）与**上下文清理**（`context` / `messages.transform`）。
3.  **丞相超然地位**：丞相不应陷入细粒度的工具调度细节，其职责应局限于高层监督与规划。
4.  **硬约束优先**：倾向于使用代码逻辑、配置文件或强制参数来落实安全策略，而非依赖模型的自觉或软提示。
5.  **跨平台降级策略**：承认 CC/OC 平台能力差异，同意在 Pi 上实现完整功能，在其他平台上采用 Deny/Transform 等降级方案。

---

## 3. 分歧点分析

| 分歧维度 | 方 A (动态协议) | 方 B (静态配置) | 方 C (声明式清单) | **评审观点** |
| :--- | :--- | :--- | :--- :--- |
| **配置时机** | 运行时动态协商 (Request-Response) | 启动前静态绑定 (Spawn-time) | 任务启动时一次性规划 (Plan-once) | **方 C 胜出**。动态协商太慢且复杂，静态配置太僵化。一次性规划兼顾灵活与高效。 |
| **清理策略** | 启发式识别并删除特定 Message | 依赖元数据过滤 | **全量替换** System Messages | **方 C 胜出**。识别逻辑是系统的脆弱点，全量替换是最稳健的“重置”机制。 |
| **丞相职责** | 声明需求 (Requirements) | 仅选择角色 (Role Selection) | **生成清单** (Manifest Generation) | **方 C 胜出**。生成清单是高级规划行为，符合丞相“运筹帷幄”的定位，且不涉及执行细节。 |
| **实现复杂度** | 高 (需解析协议、维护状态机) | 低 (读配置即可) | 中 (需定义 Schema + 生成逻辑) | **方 B 最简单，但方 C 性价比最高**。 |

**核心冲突根源**：
方 A 试图用软件工程的“控制面”思维解决 AI 问题，导致协议过重；方 B 试图用运维的“配置管理”思维解决动态任务，导致灵活性缺失；方 C 找到了中间态——**用数据结构（清单）承载策略，用 Hook 执行策略**，实现了“规划与执行”的完美解耦。

---

## 4. 最终裁决

**裁决结果：采纳方 C 的“声明式清单”架构，融合方 B 的“静态兜底”与方 A 的“审计思想”。**

**推荐方案名称**：**Manifest-Driven Clerk (MDC) 架构**

**核心理由**：
1.  **稳健性**：全量替换 System Message 的策略彻底解决了 Skill prompt 识别难的问题，是工程上最可靠的方案。
2.  **效率**：清单生成仅需一次 LLM 调用（或在丞相初始化时完成），后续所有轮次均为零开销的 Hook 执行，性能最优。
3.  **合规性**：完美契合“丞相超然、史官独立、九卿执行”的设计原则。丞相负责“立法”（生成清单），Hook 负责“执法”（执行清单），九卿负责“行政”（完成任务）。
4.  **可审计性**：清单本身即为审计日志，记录了任务全周期的权限规划，便于追溯。

---

## 5. 具体实现建议

### 5.1 核心数据结构：`court-manifest.json`
该文件通过 `appendEntry` 持久化，**严禁**进入 LLM 上下文。

```json
{
  "task_id": "uuid-v4",
  "generated_at": "timestamp",
  "phases": {
    "current": "implementation",
    "definitions": {
      "analysis": {
        "allowed_tools": ["read", "delegate", "search_code"],
        "skill_summaries": {
          "code-analyzer": "只读分析代码，禁止修改，关注 src/ 目录"
        },
        "mcp_visibility": [] 
      },
      "implementation": {
        "allowed_tools": ["read", "write", "bash", "git_commit"],
        "skill_summaries": {
          "code-analyzer": "同上",
          "test-runner": "运行 npm test，失败需修复"
        },
        "mcp_visibility": ["mcp:git", "mcp:github"]
      }
    }
  },
  "global_rules": [
    "禁止访问外网除非显式授权",
    "所有写操作必须先 read 确认"
  ]
}
```

### 5.2 Pi Extension 实现逻辑

#### A. 丞相阶段：清单生成 (Plan)
在丞相启动后的第一轮（或检测到新任务时），触发一次专门的推理：
*   **Input**: 用户任务描述 + 项目结构概览。
*   **Process**: 丞相分析任务，划分阶段，确定各阶段所需工具和 Skill 摘要。
*   **Output**: 生成 `court-manifest.json` 内容。
*   **Action**: 调用 `appendEntry({ type: 'manifest', content: ... })` 保存。**不**将此 JSON 放入后续对话上下文。

#### B. Hook 执行阶段：机械执法 (Enforce)

**1. `before_agent_start` (工具锁)**
```javascript
pi.on('before_agent_start', async (session) => {
  const manifest = await getManifestFromStorage(); // 读取持久化数据
  const currentPhase = manifest.phases.current;
  const config = manifest.phases.definitions[currentPhase];
  
  // 1. 强制设置工具白名单 (源头阻断)
  // 合并全局基础工具 (如 read) 和阶段特定工具
  const finalTools = [...BASE_TOOLS, ...config.allowed_tools];
  session.setActiveTools(finalTools);
  
  // 2. 记录当前配置供 context 使用 (内存或临时存储)
  session.locals.currentManifestConfig = config;
});
```

**2. `context` 事件 (上下文清洗 - 核心创新)
```javascript
pi.on('context', async (event) => {
  const config = event.session.locals.currentManifestConfig;
  if (!config) return event.messages; // 无清单则放行（或报错）

  // 【关键策略】全量替换 System Message，不进行任何识别
  // 1. 保留所有 user/assistant/tool_result (非 system) 消息
  const conversationHistory = event.messages.filter(m => m.role !== 'system');
  
  // 2. 构建新的 System Messages (仅包含清单中的摘要)
  const newSystemMessages = Object.entries(config.skill_summaries).map(
    ([skillName, summary]) => ({
      role: 'system',
      content: `[SKILL:${skillName}] ${summary}`
    })
  );
  
  // 3. 注入全局规则
  if (config.global_rules) {
     newSystemMessages.unshift({
       role: 'system',
       content: `GLOBAL RULES:\n${config.global_rules.join('\n')}`
     });
  }

  // 4. 重组消息列表
  event.messages = [...newSystemMessages, ...conversationHistory];
  
  return event.messages;
});
```

**3. 阶段切换机制**
*   当九卿完成任务汇报时，丞相判断是否进入下一阶段。
*   若切换，丞相更新 `appendEntry` 中的 `manifest.phases.current` 字段。
*   下一轮 `before_agent_start` 自动读取新阶段配置，实现无缝切换。

### 5.3 跨平台适配

*   **CC (Claude Code)**:
    *   利用 `SessionStart` 注入清单内容到 `additionalContext`。
    *   利用 `PreToolUse` 检查工具名是否在清单允许列表中，不在则 `exit 2` 拒绝。
    *   由于无法全量替换 System Prompt，退化为在每次 `updatedInput` 前追加清单中的 Skill 摘要指令。
*   **OC (OpenCode)**:
    *   利用 `messages.transform` 完美复刻 Pi 的 `context` 全量替换逻辑。
    *   清单可作为 `.opencode/agents/*.md` 的 frontmatter 存在。

---

## 6. 开放问题与后续验证

尽管 MDC 架构在理论上最为完备，但仍需在实施中验证以下问题：

1.  **清单生成的准确性**：
    *   *问题*：如果丞相生成的清单遗漏了关键工具或 Skill 摘要过于简略，会导致子任务失败。
    *   *对策*：在清单生成后、执行前，增加一个“自检”步骤（可由史官介入，作为建议而非阻断），或者允许九卿在遇到权限不足时发起“特许申请”（触发丞相重新生成清单）。

2.  **长上下文中 Tool Result 的膨胀**：
    *   *问题*：MDC 主要清理 System Prompt，但如果工具调用次数极多，`tool_result` 依然会撑爆上下文。
    *   *对策*：在 `context` 事件中增加第二道防线：检测连续的 `tool_use` + `tool_result` 对，若属于已完成步骤，将其压缩为单行摘要（如方 A 所述）。这需要简单的启发式规则，但不涉及 Skill 识别。

3.  **并发任务的状态隔离**：
    *   *问题*：若多个九卿并行执行不同阶段的任务，单一的 `currentPhase` 字段可能不够用。
    *   *对策*：将 Manifest 结构升级为 Map 结构，Key 为 `agent_id` 或 `sub_task_id`，实现细粒度的权限隔离。

4.  **Skill 摘要的自动化生成**：
    *   *问题*：手动维护每个 Skill 的摘要版本成本高。
    *   *对策*：建立自动化脚本，从 Skill 的完整 System Prompt 中提取前 N 行关键指令作为默认摘要，允许人工微调。

**结论**：本次辩论成功地将一个模糊的“角色需求”转化为具体的“数据驱动架构”。**Manifest-Driven Clerk** 方案不仅解决了 Token 和安全问题，更提升了系统的可维护性和可解释性，是构建大规模多 Agent 系统的最佳实践路径。
