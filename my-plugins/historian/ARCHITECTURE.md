# Historian Extension -- 架构文档

## 1. 概述

Historian 是一个 **hook-based 同步合规监控扩展**，通过拦截 Pi Coding Agent 的事件流来追踪用户意图（Intent）并对每次工具调用（Tool Call）执行合规检查。

### 解决的问题

Coding Agent 在执行任务时可能违反用户给出的约束，例如：
- 修改了用户明确说"不要动"的文件
- 执行了被禁止的危险命令（`rm -rf`、`git push --force`）
- 违反了用户声明的编码规范

Historian 在工具调用 **执行前** 进行拦截判定，对违规行为实施阻断或告警。

### 设计哲学

| 维度 | 选择 | 理由 |
|------|------|------|
| 集成方式 | Extension hook（非 MCP） | 零外部依赖、同步拦截、直接访问 session 上下文 |
| 检查策略 | 两阶段：确定性 + 语义 | 确定性规则 < 1ms 完成，仅在必要时启动 LLM |
| 持久化 | CustomEntry snapshot | 利用 Pi 原生持久化，跨 compaction 存活 |
| 容错 | fail-open（一般）/ fail-close（P0） | 不因监控系统故障阻碍正常工作流 |

---

## 2. 架构总览

### 文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | ~440 | 主入口：事件注册、生命周期编排、`/historian` 命令、`parseIntentResponse()` |
| `ledger.ts` | ~219 | 数据层：Intent/Rule/Decision 存储、Snapshot 序列化/恢复、ring buffer、dirty flag |
| `workers.ts` | ~270 | 检查层：Phase 1 RuleWorker（确定性）、Phase 2 SemanticWorker（LLM） |
| `prompts.ts` | ~165 | LLM prompt 构建：Intent 提取 prompt、Compliance check prompt |
| `logger.ts` | ~34 | 文件日志：4 级别（debug/info/warn/error）、写入 `/tmp/historian.log`、silent failure |

### 架构图

```
                          ┌──────────────────────────────┐
                          │       index.ts (入口)         │
                          │  - 事件注册 & 生命周期编排       │
                          │  - /historian 命令             │
                          │  - parseIntentResponse()       │
                          └──────┬────────┬────────┬──────┘
                                 │        │        │
                    ┌────────────┘        │        └────────────┐
                    ▼                     ▼                     ▼
          ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐
          │   ledger.ts     │  │   prompts.ts     │  │   workers.ts    │
          │                 │  │                  │  │                 │
          │ Intent 存储     │  │ Intent 提取      │  │ Phase 1:        │
          │ Rule 索引       │  │   Prompt         │  │   ruleCheck()   │
          │ Decision 环形   │  │ Compliance       │  │   (确定性)       │
          │   缓冲区        │  │   Check Prompt   │  │ Phase 2:        │
          │ Snapshot 序列化 │  │ Few-shot 示例     │  │   semanticCheck │
          │ 恢复 & 校验     │  │                  │  │   (LLM-based)   │
          └─────────────────┘  └──────────────────┘  └─────────────────┘
                                                              │
                                                     ┌────────┘
                                                     ▼
                                            ┌─────────────────┐
                                            │   logger.ts     │
                                            │ 文件日志 → /tmp/ │
                                            │ 4级别 silent-fail│
                                            └─────────────────┘
```

### 数据流

```
  ┌──────┐  input事件   ┌───────┐  LLM提取   ┌────────┐
  │ User │ ──────────→ │Prompts│ ────────→  │ Ledger │
  └──────┘             └───────┘            └───┬────┘
                                                │ rules
  ┌──────────┐  tool_call事件  ┌─────────┐     │
  │  Agent   │ ────────────→  │ Workers │ ←───┘
  │ Tool Call│                │ Phase1→2│
  └──────────┘                └────┬────┘
                                   │
                      ┌────────────┼────────────┐
                      ▼            ▼            ▼
                   block        warn         allow
                 (return)     (steer)      (log only)
```

---

## 3. 生命周期

### 完整事件链

```
session_start          恢复 Ledger（从 CustomEntry 快照）
      │                  ↳ 顶层 try-catch 保护
      ▼
    input              截断输入(8000 chars) → 提取 Intent + Rules（LLM, 5s 超时）
      │                  ↳ 连续 3 次失败 → 降级模式
      ▼
   tool_call           Phase 1: ruleCheck（确定性, ReDoS 防护）
      │                Phase 2: semanticCheck（LLM, 3s 超时，仅在需要时）
      │                → block / warn / allow → recordDecision
      │                  ↳ 异常 → fail-open + recordDecision 审计
      ▼
   turn_end            dirty 时持久化 snapshot
      │
      ▼
session_before_compact dirty 时持久化 snapshot（确保 compaction 后存活）
      │
      ▼
session_shutdown       最终持久化 snapshot
```

### 各阶段详解

| 事件 | 处理逻辑 |
|------|----------|
| `session_start` | 整个 handler 被顶层 try-catch 保护（fail-open）。扫描 branch 中所有 `customType="historian-snapshot"` 的 entry，从最新到最旧依次尝试 `restoreFrom()`，首个成功即停止。全部失败则 `clear()` 并发送降级告警（sendMessage 有嵌套 try-catch 保护）。 |
| `input` | 跳过空消息和已降级状态。截断输入到 `MAX_INTENT_INPUT_CHARS=8000` 字符。使用 `AbortController` + 5s 超时调用 LLM 提取 Intent/Rules。成功则重置失败计数器，连续失败 3 次则进入降级模式（sendMessage 有嵌套 try-catch 保护）。 |
| `tool_call` | Ledger 为空时短路返回。否则取出所有 rules，先执行 `ruleCheck()`（确定性），再视需要执行 `semanticCheck()`（LLM）。根据结果执行 block/warn/allow 并 `recordDecision()`。整体 try-catch 包裹，异常时 fail-open 并记录审计决策。 |
| `turn_end` | 仅在 Ledger 非空且 dirty 时调用 `pi.appendEntry()` 写入 snapshot，然后 `markClean()`。 |
| `session_before_compact` | 同 `turn_end`，确保 compaction 前有最新快照。 |
| `session_shutdown` | 同上，最终兜底持久化。 |

---

## 4. 核心数据结构

### Severity（严重等级）

```typescript
enum Severity {
  P0 = 0,  // Critical — 永远阻断
  P1 = 1,  // High — 默认阻断（除非显式覆盖）
  P2 = 2,  // Medium — 通过 steer 消息告警，允许执行
  P3 = 3,  // Low — 仅记录日志（action="allowed"），无用户可见操作
}
```

### Rule（规则）

```typescript
type RuleType = "protect_path" | "restrict_command" | "require_pattern" | "custom";

interface Rule {
  type: RuleType;
  pattern: string;        // 正则表达式源串或路径 glob
  description: string;    // 人类可读的单行规则描述
  severity: Severity;     // 0-3
}
```

### Intent（意图）

```typescript
interface Intent {
  id: string;             // "intent-{N}"，自增
  text: string;           // 用户原始指令文本
  rules: Rule[];          // 从该意图提取的规则列表
  timestamp: number;      // 创建时间戳
}
```

### Decision（决策记录）

```typescript
interface Decision {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;  // 截断到 2000 字符（undefined 时回退到 {}）
  action: "allowed" | "blocked" | "warned";
  reason?: string;
  timestamp: number;
}
```

### LedgerSnapshot（快照）

```typescript
interface LedgerSnapshot {
  intents: Intent[];
  decisions: Decision[];
}
```

快照是 Ledger 的完整序列化形式，通过 `pi.appendEntry("historian-snapshot", data)` 写入 session branch，由 Pi 平台负责持久化。

---

## 5. 两阶段合规检查

每次 `tool_call` 事件触发后，检查分为两个阶段串行执行。

### Phase 1: RuleWorker（确定性检查）

**执行时间**: < 1ms，纯正则匹配，无外部调用。

#### 支持的 Rule Type

| Rule Type | 确定性处理 | 匹配逻辑 |
|-----------|-----------|----------|
| `protect_path` | 是 | 从 tool event 提取文件路径（edit/write/read/grep/find/ls），对每个路径执行 `new RegExp(pattern, "i").test(path)` |
| `restrict_command` | 是 | 仅匹配 bash 工具，对 `event.input.command` 执行正则匹配 |
| `require_pattern` | 否 | 跳过，交给 Phase 2 SemanticWorker 处理 |
| `custom` | 否 | 跳过，交给 Phase 2 SemanticWorker 处理 |

#### 路径提取覆盖范围

`extractPaths()` 识别以下工具的路径参数：
- `edit` → `input.path`
- `write` → `input.path`
- `read` → `input.path`
- `grep` → `input.path`（可选）
- `find` → `input.path`（可选）
- `ls` → `input.path`（可选）

#### ReDoS 防护

`isSafePattern()` 在构造 RegExp 前执行两项启发式检查：
1. **长度限制**: `pattern.length > MAX_PATTERN_LENGTH (500)` → 拒绝
2. **危险量词检测**: `/(\+|\*|\{)\)?(\+|\*|\{)/` 匹配嵌套量词（如 `(a+)+`）→ 拒绝

不安全的 pattern 返回 `invalidPattern: true`，不执行 regex，避免灾难性回溯。

#### 返回策略

- 遍历所有规则，收集所有匹配结果
- 返回 **severity 最高（数值最小）** 的匹配
- 无效正则模式不算作匹配，仅在没有任何有效匹配时返回以便调用方记录警告

### Phase 2: SemanticWorker（LLM 语义检查）

**执行时间**: ~200-800ms（LLM 调用），带 `AbortController` + 3s (`SEMANTIC_TIMEOUT_MS`) 超时保护。

#### 触发条件

`requiresSemanticCheck()` 返回 true 当且仅当活跃规则中存在 `type === "custom"` 或 `type === "require_pattern"` 的规则。

这意味着如果所有规则都是 `protect_path` / `restrict_command`（均可确定性判断），Phase 2 完全不会执行——零额外延迟。

#### 执行流程

1. 检测是否存在 P0 级别的 `custom`/`require_pattern` 规则，决定 fail 策略
2. 获取当前 session model 和 API key
3. 截断 tool input 到 `MAX_INPUT_CHARS=2000` 字符以控制 token 预算
4. 调用 `buildComplianceCheckPrompt()` 构建 prompt（包含活跃规则 + 最近 5 条 Decision 作为一致性参考）
5. 使用 `AbortController` + 3s `setTimeout` 设置超时
6. 调用 LLM `complete()`
7. 解析响应为 `{verdict, reason}`

#### 响应解析（双策略）

`parseSemanticResponse()` 使用两种策略依次尝试：
1. 清除 markdown 代码围栏，整体 JSON.parse
2. 提取第一个 `{...}` JSON 对象（注意：不支持嵌套 `}` 的 reason 字段）

两种策略均失败则返回 failVerdictOnParse（根据 hasP0 决定 warn 或 pass）。

### Severity 与响应策略

| Severity | Phase 1 行为 | Phase 1 Decision.action | Phase 2 verdict |
|----------|-------------|------------------------|-----------------|
| P0 (Critical) | `return { block: true }` | `"blocked"` | `"block"` |
| P1 (High) | `return { block: true }` | `"blocked"` | `"block"` |
| P2 (Medium) | steer 告警，继续 Phase 2 | `"warned"` | `"warn"` + steer |
| P3 (Low) | 仅记录，继续 Phase 2 | **`"allowed"`** | `"pass"` |

> **注意**: P3 的 Phase 1 action 是 `"allowed"` 而非 `"warned"`，因为 P3 定义为"log only"，实际未发送任何告警消息。

### 容错策略

| 场景 | 有 P0 custom/require_pattern 规则 | 无 P0 规则 |
|------|----------------------------------|-----------|
| LLM 调用超时（3s） | **fail-close**: verdict = "warn" | **fail-open**: verdict = "pass" |
| LLM 调用失败（网络/API 错误） | **fail-close**: verdict = "warn" | **fail-open**: verdict = "pass" |
| 无 model 或 API key | **fail-close**: verdict = "warn" | **fail-open**: verdict = "pass" |
| LLM 响应解析失败 | **fail-close**: verdict = "warn" | **fail-open**: verdict = "pass" |

> **注意**: fail-close 时的 verdict 是 "warn" 而非 "block"——即使在 P0 场景下也不会因监控系统自身故障而硬阻断工作流，而是通过告警让用户注意到异常。

> **注意**: `hasP0` 计算限定为 `custom`/`require_pattern` 类型的 P0 规则——因为 `protect_path`/`restrict_command` 的 P0 规则已由 Phase 1 确定性处理，不需要 Phase 2 的 fail-close 保护。

---

## 6. Prompt 设计

### Intent Extraction Prompt

**目标**: 从用户自然语言消息中提取可执行的约束规则。

**设计理念**:
- **只提取显式指令**: 明确要求"Only extract EXPLICIT instructions — do not infer implicit ones"
- **结构化输出**: 直接要求输出 JSON 数组（无 markdown 围栏）
- **4 种 Rule Type 引导**: 在 system prompt 中明确定义每种类型的适用场景

**Few-shot 策略（5 个示例）**:
1. `"不要修改 .env 文件"` → `protect_path` + P0（安全敏感文件）
2. `"不要执行 rm -rf 命令"` → `restrict_command` + P0（危险命令）
3. `"所有新函数都要加 JSDoc 注释"` → `require_pattern` + P2（编码规范，软性约束）
4. `"所有 API 响应都要包含 requestId 字段"` → `custom` + P2（语义约束，无法用简单正则表达）
5. `"帮我重构这个函数"` → `[]`（无约束的普通请求——**关键负例**）

**输入截断**: 用户消息超过 `MAX_INTENT_INPUT_CHARS=8000` 字符时截断后追加 `"..."`，控制 token 预算。

**调用方式**: 用 `<user_message>` XML 标签包裹原始用户消息，与 system prompt 清晰隔离。

### Compliance Check Prompt

**目标**: 判断一个具体的 tool call 是否违反活跃规则。

**设计理念**:
- **Severity → Verdict 映射**: 在 system prompt 中明确 P0/P1→block, P2→warn, P3→pass 的映射表
- **一致性参考**: user message 中附带最近 5 条 Decision（带操作和原因），引导 LLM 对类似操作给出一致判断
- **结构化上下文**: rules 以 JSON 数组呈现，tool call 以结构化字段（Tool Name + Arguments）呈现
- **截断说明**: Notes 部分说明 tool call 参数可能被截断（`_truncated: "..."`），截断时默认 "pass"

**Few-shot 策略（4 个示例）**:
1. `protect_path` + edit .env → `block`（直接命中 P0）
2. `require_pattern` + write 非测试文件 → `pass`（规则不适用——**教会 LLM 适用范围判断**）
3. `restrict_command` + git push --force → `block`（命中 P1）
4. `custom` + write API handler → `warn`（命中 P2——**展示 warn 路径**）

---

## 7. 持久化机制

### Dirty Flag

Ledger 维护一个 `dirty` 布尔标志：
- `addIntent()` 和 `recordDecision()` 将其设为 `true`
- `restoreFrom()` 中过滤掉条目时设为 `true`（确保清理后数据写回）
- `markClean()` 将其设为 `false`
- 所有持久化点检查 `!isEmpty() && isDirty()` 后才写入

这确保只在数据实际变化时才写入 snapshot，避免无意义的重复写入。

### Snapshot 时机

| 事件 | 目的 |
|------|------|
| `turn_end` | 每轮结束时保存，防止意外中断丢失数据 |
| `session_before_compact` | compaction 前保存，确保压缩后仍有最新快照可恢复 |
| `session_shutdown` | 最终兜底，确保关闭前数据不丢 |

### 多 Snapshot 回退恢复

`session_start` 时的恢复策略：
1. 线性扫描 branch 中所有 `customType === "historian-snapshot"` 的 entry
2. 按 **从新到旧** 的顺序依次尝试 `restoreFrom()`
3. **第一个成功恢复的 snapshot 即停止**（不合并多个 snapshot）
4. 全部失败则 `clear()` 并发送降级告警

### restoreFrom() 校验

**isValidRule 6 项校验**:
1. `r != null`
2. `typeof type === "string"` 且 type 在白名单 `["protect_path", "restrict_command", "require_pattern", "custom"]` 中
3. `typeof pattern === "string"`
4. `typeof description === "string"`
5. `typeof severity === "number"`
6. `severity >= 0 && severity <= 3`

**Intent 校验**: id (string) + text (string) + rules (array)，过滤后 rules 为空的 intent 被丢弃。

**Decision 校验**: toolCallId (string) + toolName (string) + action (string) + timestamp (number)。

**损坏检测**: 如果输入 snapshot 有非空数据但过滤后全为空，抛出 `"snapshot corrupt"` 异常。

**nextIntentId 恢复**: 从已有 intent id 中解析最大编号，设置 `nextIntentId = max + 1`（含 NaN 防护）。

### Ring Buffer（环形缓冲区）

| 缓冲区 | 容量 | 裁剪时机 |
|--------|------|----------|
| `intents` | `MAX_INTENTS = 50` | `addIntent()` 和 `restoreFrom()` |
| `decisions` | `MAX_DECISIONS = 100` | `recordDecision()` 和 `restoreFrom()` |

- `recordDecision()` 中 `decision.input` 序列化超过 2000 字符时截断为 `{_truncated: "..."}`
- `decision.input` 为 `undefined` 时回退到 `{}` 防止 `JSON.stringify(undefined)` 崩溃

---

## 8. 安全防护

### ReDoS 防护

用户提供的 regex pattern 可能包含灾难性回溯（如 `(a+)+`）。`isSafePattern()` 在 `matchProtectPath` 和 `matchRestrictCommand` 中的 `new RegExp()` 之前执行：
- **长度限制**: `MAX_PATTERN_LENGTH = 500`
- **危险量词检测**: `/(\+|\*|\{)\)?(\+|\*|\{)/` 检测嵌套量词

不安全 pattern 返回 `invalidPattern: true`，跳过 regex 执行。

### 空 Pattern 过滤

`parseIntentResponse()` 中 `!r.pattern.trim()` 检查拒绝空 pattern——`RegExp("")` 会匹配一切字符串。

### 无效 Pattern 处理

`new RegExp(rule.pattern, "i")` 包裹在 try-catch 中，无效正则返回 `invalidPattern: true`。

### undefined Input 防护

`recordDecision()` 中 `JSON.stringify(decision.input ?? {})` 防止 `JSON.stringify(undefined)` 返回非字符串值导致 `.length` 抛 TypeError。

---

## 9. 错误处理

### 顶层 try-catch

| Handler | 保护级别 |
|---------|---------|
| `session_start` | 顶层 try-catch（getBranch() 可能抛异常），fail-open |
| `tool_call` | 顶层 try-catch，catch 中 recordDecision(action: "allowed") 审计 + log |
| `turn_end` / `session_before_compact` / `session_shutdown` | 各自 try-catch |

### sendMessage 嵌套保护

以下两处 catch block 中的 `pi.sendMessage()` 调用有额外 try-catch 包裹，防止 sendMessage 失败导致未处理异常：
1. `session_start` 中 `if (!restored)` 分支的降级告警
2. `input` catch block 中 `if (intentFailCount >= INTENT_FAIL_THRESHOLD)` 的降级告警

### tool_call 异常审计

catch block 中执行 `ledger.recordDecision({ action: "allowed", reason: "handler error (fail-open): ..." })`，外层包 try-catch（event 可能缺字段），确保异常不会产生审计缺口。

### AbortController 超时

| LLM 调用 | 超时 | 清理 |
|----------|------|------|
| Intent extraction | 5000ms | `finally { clearTimeout(timer) }` |
| Semantic check | 3000ms (`SEMANTIC_TIMEOUT_MS`) | `finally { clearTimeout(timer) }` |

---

## 10. Logger

### 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `HISTORIAN_LOG_PATH` | `/tmp/historian.log` | 日志文件路径 |
| `HISTORIAN_LOG_LEVEL` | `info` | 最低日志级别（debug/info/warn/error） |

### 设计原则

- **Silent failure**: 日志写入失败（如文件权限不足）被静默忽略，永远不会导致 historian 崩溃
- **同步写入**: `appendFileSync()` 确保日志顺序正确
- **全局使用**: 所有模块（index/ledger/workers）统一通过 `log.info/debug/warn/error` 记录

---

## 11. 降级与容错

### Intent Extraction 降级

| 状态 | 行为 |
|------|------|
| `intentFailCount < 3` | 每次 input 事件正常尝试提取，失败则 +1，成功则重置为 0 |
| `intentFailCount >= 3` | 设置 `intentDegraded = true`，发送 steer 告警，此后所有 input 事件直接跳过提取 |

降级是**单向的**——一旦进入降级模式，当前 session 不会恢复。连续 3 次失败通常意味着 model/API 存在持续性问题。

### Snapshot 恢复失败

- 逐个尝试从新到旧的所有 snapshot
- 全部失败则 `ledger.clear()` 重新开始
- 发送 steer 告警通知用户
- 不会因为恢复失败阻止 session 启动

---

## 12. 命令

### `/historian`

**描述**: Show historian ledger: active intents, rules, and recent decisions

**输出内容**:
- **状态行**: 显示 Active 或 DEGRADED 状态，含 failure 计数（如 `2/3`）
- **Intents 列表**: 每个 intent 的 id、原始文本、关联 rules（含 severity 和 pattern）
- **Recent Decisions**: 最近 10 条决策，含图标（🚫/⚠️/✅）、tool name、action、reason、input summary（截断到 100 字符）

**通知方式**: `ctx.ui.notify(text, "info")`

---

## 13. 已知限制与未来方向

### 已知限制

1. **不追踪 LLM 推理决策**: 只监控工具调用，不监控 LLM 的推理过程。如果 LLM 在回复中违反了用户意图但未通过工具执行，Historian 无法捕获。

2. **Intent 不可手动编辑/删除**: 一旦 Intent 被提取并写入 Ledger，用户无法通过命令手动修改或移除。

3. **降级不可恢复**: `intentDegraded` 一旦设为 true，当前 session 不再尝试 Intent 提取。需要新 session 重置。

4. **parseSemanticResponse Strategy 2 不支持嵌套 `}`**: `/{[^}]*}/` 正则无法匹配 reason 字段中包含 `}` 的 JSON，会截断并解析失败。实际触发概率低（LLM 通常不在 reason 中使用大括号）。

5. **单 Session 作用域**: Intent 和 Rule 仅在当前 session branch 内有效。跨 session 的规则需要用户重新声明。

6. **无规则冲突检测**: 如果用户先说"不要修改 foo.ts"又说"重构 foo.ts"，两条规则会同时存在且矛盾。

7. **require_pattern 无确定性路径**: `require_pattern` 类型完全依赖 LLM 语义判断，没有确定性检查路径。

8. **Phase 1 P2/P3 + Phase 2 可产生重复 Decision**: 当 Phase 1 匹配 P2/P3 并 fall through 到 Phase 2 时，同一个 toolCallId 会有 2 条 Decision 记录。这是有意设计——分别记录确定性和语义检查的结果。

9. **Prompt 仅中文示例**: Intent extraction 的 few-shot 全部使用中文，可能影响纯英文用户的提取质量。

### 未来方向

- **Intent 管理命令**: `/historian remove intent-3`、`/historian edit intent-1` 等
- **规则冲突检测**: 新 Intent 写入时检查与已有规则的潜在冲突
- **降级自动恢复**: 定时重试 Intent 提取，成功后退出降级模式
- **确定性 require_pattern**: 对 write/edit 工具的内容做正则匹配，减少对 LLM 的依赖
- **跨 Session 规则持久化**: 将核心规则写入全局配置，新 session 自动加载
- **英文 few-shot**: 添加英文/混合语言示例，提高多语言场景的提取质量
- **Prompt injection 防护**: 在 compliance prompt 中明确要求 LLM 忽略 tool arguments 中类似规则的文本
