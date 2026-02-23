# F - Context 管理

## 概述

Pi-mono 的上下文管理系统包含四个核心子系统：**压缩系统**（compaction）、**会话持久化**（session-manager）、**包管理器**（package-manager）和**资源加载器**（resource-loader）。压缩系统是增量式的——支持基于前次摘要的迭代更新，而非每次从零重建；会话以 JSONL append-only 树结构持久化，天然支持分支和断点恢复；包管理器统一处理 npm/git/local 三种源类型；资源加载器实现了四种资源类型的统一发现、合并和去重。

系统的关键设计决策：
1. 压缩不是"丢弃消息"，而是"用 LLM 摘要替换旧消息"
2. 会话树结构用 id/parentId 链表实现，分支是移动 leaf 指针，不修改历史
3. 扩展可以通过 `session_before_compact` 钩子完全替换默认压缩逻辑
4. 文件操作（read/write/edit）被跟踪并附加到摘要中，确保压缩后仍知道哪些文件被访问过

## 文件树

```
packages/coding-agent/src/core/
├── compaction/
│   ├── index.ts                      # 模块导出
│   ├── compaction.ts                 # 压缩核心算法（810行）
│   ├── branch-summarization.ts       # 分支摘要（353行）
│   └── utils.ts                      # 共享工具函数（155行）
├── session-manager.ts                # 会话持久化（1402行）
├── package-manager.ts                # 包管理（1770行）
├── resource-loader.ts                # 资源加载（872行）
├── agent-session.ts                  # 集成层，调用压缩和会话管理
├── settings-manager.ts               # 设置管理，含压缩参数
└── messages.ts                       # 消息类型转换
```

## 压缩系统

### 触发条件

压缩有两种触发场景，在 `_checkCompaction()` @ `agent-session.ts:1565` 中实现：

**Case 1 — Context Overflow（溢出触发）**
- 条件：LLM 返回 context overflow 错误 + 同一模型 + 非已压缩后的错误
- 行为：移除错误消息 -> 压缩 -> **自动重试**（`willRetry: true`）
- 代码：`isContextOverflow(assistantMessage, contextWindow)` @ `agent-session.ts:1591`

**Case 2 — Threshold（阈值触发）**
- 条件：`contextTokens > contextWindow - reserveTokens`
- 默认参数：`reserveTokens = 16384`（预留 16K tokens）
- 行为：压缩 -> **不自动重试**（用户继续手动操作）
- 代码：`shouldCompact()` @ `compaction.ts:212`

```typescript
// compaction.ts:212
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
    if (!settings.enabled) return false;
    return contextTokens > contextWindow - settings.reserveTokens;
}
```

**默认设置** @ `compaction.ts:114`：
```typescript
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
    enabled: true,
    reserveTokens: 16384,    // 触发阈值：contextWindow - 16384
    keepRecentTokens: 20000,  // 保留最近约 20K tokens 的消息
};
```

**手动压缩**：用户可通过 `/compact` 命令或扩展 API `compact()` 手动触发。

### 切割点检测

切割点检测的目标是：在保留最近 `keepRecentTokens`（默认 20000）tokens 的前提下，找到一个安全的分割位置。

**算法** @ `findCutPoint()` @ `compaction.ts:376-438`：

1. **找到所有有效切割点**：`findValidCutPoints()` @ `compaction.ts:292-327`
   - 有效切割角色：`user`, `assistant`, `bashExecution`, `custom`, `branchSummary`, `compactionSummary`
   - **永远不在 `toolResult` 处切割**（toolResult 必须跟随其 toolCall）
   - `branch_summary` 和 `custom_message` entry 也是有效切割点

2. **从后向前累积 token**：从最新消息向旧消息遍历，使用 `estimateTokens()` 累积，直到超过 `keepRecentTokens`

3. **找最近的有效切割点**：在累积超过预算的位置，向前找到最近的有效切割点

4. **向前包含非消息 entry**：切割点前的非消息 entry（settings change 等）被包含进来

5. **检测分裂 turn**：如果切割点不是 user 消息，则标记为 `isSplitTurn`，记录该 turn 的起始 user 消息索引

**token 估算** @ `estimateTokens()` @ `compaction.ts:225-283`：
- 使用 `chars / 4` 的保守启发式方法（会高估 token 数量）
- 图片估算为 1200 tokens（4800 chars / 4）
- assistant 消息计算 text + thinking + toolCall 的字符数

```typescript
// compaction.ts:225
export function estimateTokens(message: AgentMessage): number {
    // ... 按 role 处理不同消息类型
    return Math.ceil(chars / 4);
}
```

### 摘要生成

摘要生成涉及三个层面，全部使用 LLM 完成。

**1. 历史摘要** — `generateSummary()` @ `compaction.ts:520-573`

- **模型**：使用当前会话的同一模型（通过参数传入）
- **系统 prompt**：`SUMMARIZATION_SYSTEM_PROMPT` @ `utils.ts:152-154`
  ```
  You are a context summarization assistant. Your task is to read a conversation
  between a user and an AI coding assistant, then produce a structured summary
  following the exact format specified.
  Do NOT continue the conversation. Do NOT respond to any questions in the conversation.
  ONLY output the structured summary.
  ```
- **用户 prompt**（首次）：`SUMMARIZATION_PROMPT` @ `compaction.ts:444-475`
  - 要求生成结构化摘要：Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context
- **用户 prompt**（增量更新）：`UPDATE_SUMMARIZATION_PROMPT` @ `compaction.ts:477-514`
  - 要求在已有摘要基础上合并新信息，保留已有 context
- **maxTokens**：`0.8 * reserveTokens`（默认 ~13107 tokens）
- **reasoning**：首次摘要使用 `reasoning: "high"`，turn prefix 不使用额外 reasoning
- **输入格式**：对话被序列化为纯文本 `[User]: ...` / `[Assistant]: ...` 格式（`serializeConversation()` @ `utils.ts:93-146`），包裹在 `<conversation>` 标签中

**2. Turn Prefix 摘要**（分裂 turn 时） — `generateTurnPrefixSummary()` @ `compaction.ts:776-809`

- 当切割点在一个 turn 的中间时，为被切掉的前半部分生成独立摘要
- 使用 `TURN_PREFIX_SUMMARIZATION_PROMPT` @ `compaction.ts:683-696`
- maxTokens = `0.5 * reserveTokens`（约 8192）
- **与历史摘要并行生成**（`Promise.all`） @ `compaction.ts:728`

**3. 文件操作列表** — 自动附加到摘要末尾
- 从 assistant 消息的 tool calls 中提取 `read/write/edit` 操作
- 从上次压缩的 `details` 中继承历史文件操作
- 格式化为 `<read-files>` 和 `<modified-files>` XML 标签 @ `utils.ts:72-82`

### 压缩前后消息结构对比

**压缩前** — 从 root 到 leaf 的完整消息链：
```
[user msg] [assistant msg] [toolResult] [user msg] [assistant msg] ... [user msg] [assistant msg]
```

**压缩后** — `buildSessionContext()` @ `session-manager.ts:307-414`：
```
[compactionSummary msg]  <-- 替代所有被压缩的消息
[kept msg 1]             <-- firstKeptEntryId 开始的保留消息
[kept msg 2]
...
[new msg after compaction]
```

关键变化：
1. `compaction` entry 被插入到树中，作为 leaf 的新子节点
2. `buildSessionContext()` 检测到 compaction entry 后：
   - 先 emit compaction summary 消息
   - 再 emit `firstKeptEntryId` 到 compaction 之间的消息（保留区域）
   - 最后 emit compaction 之后的新消息
3. Agent 的消息列表通过 `agent.replaceMessages()` 整体替换

**会话文件不变**：压缩是 append-only 的——旧消息仍在文件中，只是 `buildSessionContext()` 从压缩点开始重建上下文。

### 多级/增量压缩？

**是增量压缩，但不是多级**。

核心机制 @ `prepareCompaction()` @ `compaction.ts:597-677`：
- 如果存在前次压缩（`prevCompactionIndex >= 0`），提取 `previousSummary` = `prevCompaction.summary`
- `generateSummary()` 接收 `previousSummary` 参数后，使用 `UPDATE_SUMMARIZATION_PROMPT` 而非 `SUMMARIZATION_PROMPT`
- 更新 prompt 要求 LLM "PRESERVE all existing information" + "ADD new progress"

```typescript
// compaction.ts:651-654
let previousSummary: string | undefined;
if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
}
```

这意味着每次压缩只处理 **上次压缩之后的新消息**，但会把前次的摘要作为上下文传入，让 LLM 合并出新的摘要。这是一种 **滚动摘要**（rolling summary）策略。

边界设定 @ `compaction.ts:612`：
```typescript
const boundaryStart = prevCompactionIndex + 1;  // 从上次压缩之后开始
const boundaryEnd = pathEntries.length;          // 到最新消息
```

**不是多级**：没有 L1/L2/L3 等分层压缩机制。所有压缩产出的都是同一层级的 `CompactionEntry`，后一次替换前一次的语义位置。

### 选择性遗忘能力？

**当前没有按 scope 的选择性遗忘机制**。

但存在几个相关的设计点：

1. **CustomEntry 不参与上下文**：`CustomEntry`（`type: "custom"`）明确标注 "Does NOT participate in LLM context"。扩展可以通过它存储数据而不占上下文。

2. **CustomMessageEntry 可控显示**：`CustomMessageEntry`（`type: "custom_message"`）有 `display` 字段控制 TUI 渲染，但 **总是参与 LLM 上下文**。

3. **扩展钩子可实现选择性遗忘**：通过 `session_before_compact` 钩子，扩展可以提供自定义的 `CompactionResult`，理论上可以在摘要中选择性忽略某些内容。

4. **分支摘要是一种"离开即遗忘"**：`branchWithSummary()` 在导航到不同分支时生成当前分支的摘要，相当于"离开即压缩"。但这是树导航的副产品，不是主动遗忘。

**实现 Skill scope 化遗忘的可能路径**：
- Skill 执行的消息可标记为特殊 `customType`
- 在 `session_before_compact` 钩子中识别这些消息，将其从摘要中排除或特殊处理
- 或者在 Skill 执行完毕后，手动触发压缩，在自定义摘要中只保留结果，丢弃过程

## 分支摘要

分支摘要系统 @ `branch-summarization.ts` 处理树导航时的上下文保留。

### 触发时机

当用户从一个分支导航到另一个分支时，系统会为被离开的分支生成摘要。

### 流程

1. **收集 entries** — `collectEntriesForBranchSummary()` @ `branch-summarization.ts:96-134`
   - 找到旧分支和新分支的最深公共祖先
   - 从旧 leaf 向上收集到公共祖先的所有 entries
   - 不在 compaction 边界处停止（compaction summary 会作为上下文包含进来）

2. **准备消息** — `prepareBranchEntries()` @ `branch-summarization.ts:182-233`
   - 从最新到最旧遍历，受 token 预算限制
   - 第一遍：从所有 entries 收集文件操作（包括嵌套分支摘要的 details）
   - 第二遍：从最新向最旧添加消息，直到 token 预算耗尽
   - compaction/branch_summary 类型的 entry 即使超预算也尽量包含（如果还在 90% 以内）

3. **生成摘要** — `generateBranchSummary()` @ `branch-summarization.ts:280-352`
   - 使用 `BRANCH_SUMMARY_PROMPT`：Goal / Constraints / Progress / Key Decisions / Next Steps
   - maxTokens = 2048
   - 前缀 `BRANCH_SUMMARY_PREAMBLE`："The user explored a different conversation branch..."
   - 附加文件操作列表

4. **写入会话** — `branchWithSummary()` @ `session-manager.ts:1132-1149`
   - 创建 `BranchSummaryEntry`，包含 `fromId`、`summary`、`details`
   - 在新分支的起点作为第一个 entry

### 与压缩的区别

| 维度 | 压缩 | 分支摘要 |
|------|------|----------|
| 触发 | token 超阈值 / 手动 | 树导航 |
| 作用 | 替换旧消息 | 注入到新分支上下文 |
| 增量 | 是（滚动更新 previousSummary） | 否（一次性生成） |
| maxTokens | 0.8 * reserveTokens (~13K) | 2048 |
| 文件追踪 | 从前次 compaction details 继承 | 从嵌套 branch_summary details 继承 |

## 会话持久化

### 存储格式

**JSONL（JSON Lines）**，每行一个 JSON 对象，append-only。

文件路径格式：
```
~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl
```

示例：
```
~/.pi/agent/sessions/--Users-john-myproject--/2025-01-15T10-30-00-000Z_a1b2c3d4-....jsonl
```

**第一行是 SessionHeader**：
```json
{
  "type": "session",
  "version": 3,
  "id": "a1b2c3d4-...",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "cwd": "/Users/john/myproject",
  "parentSession": "/path/to/parent.jsonl"
}
```

**后续行是 SessionEntry**，每个都有 `id` 和 `parentId` 形成树结构：
```json
{"type":"message","id":"abc12345","parentId":null,"timestamp":"...","message":{...}}
{"type":"message","id":"def67890","parentId":"abc12345","timestamp":"...","message":{...}}
{"type":"compaction","id":"ghi11111","parentId":"def67890","timestamp":"...","summary":"...","firstKeptEntryId":"abc12345","tokensBefore":50000}
```

**Entry 类型** @ `session-manager.ts:136-145`：
| type | 描述 | 参与 LLM 上下文 |
|------|------|:---:|
| `message` | 用户/助手/工具结果消息 | 是 |
| `compaction` | 压缩摘要 | 是（作为摘要消息） |
| `branch_summary` | 分支摘要 | 是（作为用户消息） |
| `custom_message` | 扩展自定义消息 | 是（作为用户消息） |
| `custom` | 扩展自定义数据 | **否** |
| `thinking_level_change` | thinking 级别变更 | 否（但影响设置） |
| `model_change` | 模型变更 | 否（但影响设置） |
| `label` | 用户书签 | 否 |
| `session_info` | 会话元数据（名称） | 否 |

### 分支树结构

**核心设计**：每个 entry 都有 `id`（8 字符 hex）和 `parentId`，形成有向树。

```
root(null) --> entry1 --> entry2 --> entry3 --> entry4 (leaf)
                                 \-> entry5 --> entry6 (另一个分支)
```

**Leaf 指针**：`SessionManager.leafId` 指向当前活跃路径的最末端。新消息总是作为 leaf 的子节点追加。

**分支操作** @ `branch()` @ `session-manager.ts:1111-1116`：
```typescript
branch(branchFromId: string): void {
    if (!this.byId.has(branchFromId)) {
        throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafId = branchFromId;  // 仅移动指针，不修改历史
}
```

**上下文构建** @ `buildSessionContext()` @ `session-manager.ts:307-414`：
- 从 leaf 向 root 遍历 parentId 链，收集路径
- 沿路径提取 thinkingLevel、model、compaction 设置
- 如果路径上有 compaction：先 emit summary -> 再 emit kept entries -> 再 emit post-compaction entries
- 如果无 compaction：直接 emit 所有消息类 entries

### 加载/保存流程

**保存（Append-only）** — `_persist()` @ `session-manager.ts:791-809`

关键的 **延迟写入** 机制：
1. 在第一条 assistant 消息到来之前，不写入文件（避免写入无内容的会话）
2. 一旦有 assistant 消息，flush 全部积累的 entries
3. 之后的每条新 entry 立即 append

```typescript
_persist(entry: SessionEntry): void {
    if (!this.persist || !this.sessionFile) return;

    const hasAssistant = this.fileEntries.some(e => e.type === "message" && e.message.role === "assistant");
    if (!hasAssistant) {
        this.flushed = false; // 标记为未写入
        return;
    }

    if (!this.flushed) {
        // 一次性写入所有积累的 entries
        for (const e of this.fileEntries) {
            appendFileSync(this.sessionFile, `${JSON.stringify(e)}\n`);
        }
        this.flushed = true;
    } else {
        appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    }
}
```

**加载** — `setSessionFile()` @ `session-manager.ts:691-721`

1. 调用 `loadEntriesFromFile()` 逐行解析 JSON
2. 验证第一行是 `SessionHeader`
3. 检查版本号，必要时执行迁移（v1->v2->v3）
4. 调用 `_buildIndex()` 构建 `byId` Map 和 `labelsById` Map
5. leaf 指针指向最后一个 entry

**恢复最近会话** — `continueRecent()` @ `session-manager.ts:1271-1278`
- 在会话目录中找最近修改的 `.jsonl` 文件
- 验证文件头（读取前 512 字节）
- 按 mtime 排序，选最新的

**Fork 会话** — `createBranchedSession()` @ `session-manager.ts:1156-1239`
- 从指定 leaf 到 root 提取路径
- 创建新文件，写入新 header（包含 `parentSession` 指向源文件）
- 复制路径上的所有 entries（排除 LabelEntry 后重新生成）

### 锁机制

会话管理器本身 **没有文件锁**。它使用 append-only 语义和单进程假设来避免冲突。

但 `SettingsManager` 使用了 `proper-lockfile` 库 @ `settings-manager.ts:4`：
```typescript
import lockfile from "proper-lockfile";
```
这用于设置文件（`settings.jsonl`）的并发写入保护，不用于会话文件。

会话文件的并发安全性依赖于：
- 每个 CWD 目录有独立的会话目录
- 每个会话有唯一的 UUID 文件名
- append-only 写入模式天然支持追加不冲突（同一进程内）

### 版本迁移

当前版本号 `CURRENT_SESSION_VERSION = 3` @ `session-manager.ts:27`

| 版本 | 变更 |
|------|------|
| v1 -> v2 | 添加 `id/parentId` 树结构；将 `firstKeptEntryIndex` 转换为 `firstKeptEntryId` |
| v2 -> v3 | 将 `hookMessage` 角色重命名为 `custom` |

迁移在 `loadEntriesFromFile` 后自动执行，并重写文件。

## 包管理器

### npm/git 安装流程

`DefaultPackageManager` @ `package-manager.ts:627` 支持三种源类型：

**1. npm 包**（前缀 `npm:`）
- 解析：`npm:@scope/pkg@version` -> `NpmSource { name, spec, pinned }`
- 全局安装（user scope）：`npm install -g <spec>`
- 项目安装（project scope）：`npm install <spec> --prefix <installRoot>`
- 临时安装：在 `$TMPDIR/pi-extensions/npm/<hash>/` 下
- **自动更新检测** @ `npmNeedsUpdate()` @ `package-manager.ts:1041-1059`：
  - pinned：检查已安装版本是否匹配
  - unpinned：查询 npm registry 获取最新版本

**2. git 仓库**
- 解析：通过 `parseGitUrl()` 支持 SSH/HTTPS/shorthand 格式
- 安装：`git clone <repo> <targetDir>` + 可选 `git checkout <ref>` + `npm install`
- 更新：`git fetch --prune origin` + `git reset --hard @{upstream}` + `git clean -fdx`
- 路径：`<agentDir>/git/<host>/<path>` 或 `.pi/git/<host>/<path>`
- **pinned ref**：有 ref 时标记为 pinned，update 时跳过

**3. 本地路径**
- 解析：以 `.`、`/`、`~` 或 Windows 路径开头的视为本地
- 不需要安装，直接解析路径

### 发现机制

资源发现分为 **包内发现** 和 **自动发现** 两层。

**包内发现** @ `collectPackageResources()` @ `package-manager.ts:1353-1400`：
1. 如果有用户 filter（`PackageFilter`），按 filter 模式匹配
2. 否则读 `package.json` 的 `pi` 字段（`PiManifest`）
3. 否则按约定目录扫描（`extensions/`, `skills/`, `prompts/`, `themes/`）

**PiManifest 格式**：
```json
{
  "pi": {
    "extensions": ["./src/index.ts"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

**自动发现** @ `addAutoDiscoveredResources()` @ `package-manager.ts:1541-1663`：
- 扫描 `<agentDir>/extensions/`, `<agentDir>/skills/` 等目录（user scope）
- 扫描 `.pi/extensions/`, `.pi/skills/` 等目录（project scope）
- Skills 额外扫描 `~/.agents/skills/` 和从 CWD 到 git root 的所有 `.agents/skills/` 目录
- 应用 override 模式（`!`排除、`+`强制包含、`-`强制排除）

**Extension 发现**逻辑 @ `collectAutoExtensionEntries()` @ `package-manager.ts:438-490`：
1. 目录本身有 `package.json` 的 `pi.extensions` -> 使用声明
2. 目录有 `index.ts` 或 `index.js` -> 使用入口文件
3. 否则扫描子目录和 `.ts/.js` 文件

**Skill 发现**逻辑 @ `collectSkillEntries()` @ `package-manager.ts:231-283`：
- 根目录：收集所有 `.md` 文件
- 子目录：只收集 `SKILL.md` 文件

### 锁文件

包管理器本身不维护锁文件。它依赖 npm 自身的 `package-lock.json` 和 git 的文件系统语义。

**项目级 npm 安装**的 install root 会自动创建 `package.json`：
```typescript
// package-manager.ts:1248-1258
private ensureNpmProject(installRoot: string): void {
    const pkgJson = { name: "pi-extensions", private: true };
    writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
}
```

**git 安装目录**自动创建 `.gitignore`（`*` 忽略所有）以防被项目 git 跟踪。

### Scope 去重

`dedupePackages()` @ `package-manager.ts:1106-1127`：
- 使用 `getPackageIdentity()` 生成唯一标识：`npm:<name>`, `git:<host>/<path>`, `local:<resolved-path>`
- **project scope 优先于 user scope**：相同包在两个 scope 都存在时，project 版本胜出
- SSH 和 HTTPS URL 归一化为同一标识

## 资源加载器

### 统一发现机制

`DefaultResourceLoader` @ `resource-loader.ts:150` 统一管理四种资源类型。

**`reload()` 流程** @ `resource-loader.ts:307-439`：

1. 调用 `packageManager.resolve()` 获取所有已配置包的资源路径
2. 调用 `packageManager.resolveExtensionSources()` 解析 CLI 传入的额外路径（temporary scope）
3. 合并已启用路径，去重
4. 分别加载各资源类型：
   - Extensions: `loadExtensions()` + `loadExtensionFactories()`
   - Skills: `loadSkills()`
   - Prompts: `loadPromptTemplates()` + `dedupePrompts()`
   - Themes: `loadThemes()` + `dedupeThemes()`
5. 加载 AGENTS.md / CLAUDE.md 上下文文件
6. 发现 SYSTEM.md 和 APPEND_SYSTEM.md

### 加载优先级

资源优先级由多个因素决定：

**1. Scope 优先级**（包去重时）：
```
project > user > temporary
```

**2. 来源优先级**（Map 先到先得）：
```
包声明的资源 > 自动发现的资源 > CLI 传入的资源
```
因为 `addResource()` @ `package-manager.ts:1702-1712` 使用 `Map.has()` 检查，第一个添加的路径胜出。

**3. AGENTS.md/CLAUDE.md 发现顺序** @ `loadProjectContextFiles()` @ `resource-loader.ts:75-112`：
```
~/.pi/agent/AGENTS.md (或 CLAUDE.md)  # 全局，先加载
/ancestor/dirs/AGENTS.md              # 从根目录到 cwd，按层级顺序
<cwd>/AGENTS.md                       # 项目级，最后加载
```

**4. SYSTEM.md 发现** @ `discoverSystemPromptFile()` @ `resource-loader.ts:745-757`：
```
.pi/SYSTEM.md (project)  # 优先
~/.pi/agent/SYSTEM.md (global)  # 备选
```

### 合并策略

**Extensions**：
- 冲突检测 @ `detectExtensionConflicts()` @ `resource-loader.ts:820-870`
- 同名 tool / command / flag 视为冲突，后来者被排除并报错
- 支持 `extensionsOverride` 回调让上层完全控制

**Skills**：
- 去重通过路径实现（`mergePaths()` 使用 resolved path 的 Set）
- 支持 `skillsOverride` 回调

**Prompts**：
- 按 `name` 去重（`dedupePrompts()` @ `resource-loader.ts:692-716`）
- 同名冲突时 **先来者胜出**，后来者记录为 collision diagnostic

**Themes**：
- 按 `name` 去重（`dedupeThemes()` @ `resource-loader.ts:718-743`）
- 同名冲突处理同 Prompts

**动态扩展** @ `extendResources()` @ `resource-loader.ts:277-305`：
- 扩展可以在运行时注入额外的 skill/prompt/theme 路径
- 使用 `mergePaths()` 与已有路径合并
- 重新调用对应的 `updateXxxFromPaths()` 方法

### Override 钩子

`DefaultResourceLoaderOptions` 提供六个 override 回调：
```typescript
extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
skillsOverride?: (base) => { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
promptsOverride?: (base) => { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
themesOverride?: (base) => { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
agentsFilesOverride?: (base) => { agentsFiles: Array<{path, content}> };
systemPromptOverride?: (base: string | undefined) => string | undefined;
appendSystemPromptOverride?: (base: string[]) => string[];
```

## 关键类型/接口

### 压缩相关

```typescript
// compaction.ts
interface CompactionSettings {
    enabled: boolean;
    reserveTokens: number;      // 默认 16384
    keepRecentTokens: number;   // 默认 20000
}

interface CompactionResult<T = unknown> {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: T;                // 扩展自定义数据
}

interface CompactionPreparation {
    firstKeptEntryId: string;
    messagesToSummarize: AgentMessage[];
    turnPrefixMessages: AgentMessage[];
    isSplitTurn: boolean;
    tokensBefore: number;
    previousSummary?: string;
    fileOps: FileOperations;
    settings: CompactionSettings;
}

interface CutPointResult {
    firstKeptEntryIndex: number;
    turnStartIndex: number;
    isSplitTurn: boolean;
}
```

### 会话相关

```typescript
// session-manager.ts
interface SessionHeader {
    type: "session";
    version?: number;
    id: string;
    timestamp: string;
    cwd: string;
    parentSession?: string;
}

type SessionEntry = SessionMessageEntry | ThinkingLevelChangeEntry | ModelChangeEntry
    | CompactionEntry | BranchSummaryEntry | CustomEntry | CustomMessageEntry
    | LabelEntry | SessionInfoEntry;

interface SessionContext {
    messages: AgentMessage[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
}
```

### 包管理相关

```typescript
// package-manager.ts
interface PackageManager {
    resolve(onMissing?): Promise<ResolvedPaths>;
    install(source: string, options?): Promise<void>;
    remove(source: string, options?): Promise<void>;
    update(source?: string): Promise<void>;
    resolveExtensionSources(sources: string[], options?): Promise<ResolvedPaths>;
}

interface ResolvedPaths {
    extensions: ResolvedResource[];
    skills: ResolvedResource[];
    prompts: ResolvedResource[];
    themes: ResolvedResource[];
}

interface ResolvedResource {
    path: string;
    enabled: boolean;
    metadata: PathMetadata;
}
```

## 与其他 Domain 的接口

### 与 Agent Loop (Domain B) 的接口
- `_checkCompaction()` 在 `agent_end` 事件后和 prompt 提交前被调用
- 压缩后通过 `agent.replaceMessages()` 替换 agent 的消息列表
- overflow 触发的压缩会自动调用 `agent.continue()` 重试

### 与 Extension System (Domain D) 的接口
- `session_before_compact` 钩子：扩展可以取消压缩或提供自定义压缩结果
- `session_compact` 钩子：压缩完成后的通知
- `session_before_tree` / `session_tree` 钩子：分支摘要的扩展接口
- `CustomEntry`：扩展用于持久化状态（不参与上下文）
- `CustomMessageEntry`：扩展用于注入上下文消息
- `extendResources()`：扩展可在运行时注入额外的 skill/prompt/theme

### 与 Tool System (Domain C) 的接口
- `extractFileOpsFromMessage()` 从 assistant 消息的 tool calls 中提取 `read/write/edit` 操作
- 工具名称硬编码匹配：`"read"`, `"write"`, `"edit"`
- 提取的文件操作附加到压缩摘要中

### 与 Settings (Domain A/E) 的接口
- `SettingsManager.getCompactionSettings()` 提供压缩参数
- `SettingsManager.getBranchSummarySettings()` 提供分支摘要参数
- 包列表从 global/project settings 读取
- settings 使用 `proper-lockfile` 进行并发保护

### 与 Model/AI (Domain E) 的接口
- 压缩使用 `completeSimple()` 调用 LLM 生成摘要
- 使用当前会话模型（通过 `this.model` 传递）
- `estimateContextTokens()` 利用最后一条 assistant 消息的 `usage` 字段获取精确 token 数

## 开发指南：上下文控制

### 如何实现 Skill Scope 化（用完即丢）

**方案 1：CustomEntry + 手动压缩**
```typescript
// Skill 执行前
const skillStartId = session.appendCustomEntry("skill-start", { skillName: "my-skill" });

// Skill 执行过程中的消息正常追加
session.appendMessage(userMsg);
session.appendMessage(assistantMsg);

// Skill 执行完毕：生成仅包含结论的摘要
const resultSummary = `Skill "${skillName}" completed. Result: ${result}`;
session.appendCompaction(resultSummary, firstKeptEntryId, tokensBefore, { skillName });
```

**方案 2：通过 Extension 钩子实现**
```typescript
hooks.on("session_before_compact", async (event) => {
    // 识别 skill 消息并从 messagesToSummarize 中特殊处理
    const skillMessages = event.preparation.messagesToSummarize
        .filter(msg => isSkillMessage(msg));

    if (skillMessages.length > 0) {
        return {
            compaction: {
                summary: generateSkillAwareSummary(event.preparation),
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
            }
        };
    }
});
```

**方案 3：使用 Sub-session**
- 为 Skill 创建新的 `SessionManager.inMemory()`
- Skill 在独立会话中运行
- 完成后将结论作为 `CustomMessageEntry` 注入主会话
- Skill 的过程消息不会出现在主会话的上下文中

### 如何做选择性遗忘

当前系统没有内置选择性遗忘，但可以通过以下方式实现：

1. **分支 + 摘要**：导航到需要遗忘的消息之前的 entry，创建新分支。分支摘要会自动生成。
2. **自定义压缩钩子**：在 `session_before_compact` 中过滤掉不需要的消息内容。
3. **CustomEntry 标记**：在消息前后插入 `CustomEntry` 标记，压缩时识别并跳过标记区间。

### 如何定制压缩策略

**替换默认压缩**：通过 `session_before_compact` 钩子返回自定义 `CompactionResult`。

**调整参数**：修改 `settings.jsonl`：
```json
{
    "compaction": {
        "enabled": true,
        "reserveTokens": 32768,
        "keepRecentTokens": 40000
    }
}
```

**实现多级压缩**：
```typescript
hooks.on("session_before_compact", async (event) => {
    const { preparation } = event;

    // L1: 近期消息 -> 详细摘要
    const recentSummary = await generateDetailed(preparation.messagesToSummarize.slice(-10));

    // L2: 远期消息 -> 精简摘要
    const oldSummary = await generateConcise(preparation.messagesToSummarize.slice(0, -10));

    return {
        compaction: {
            summary: `## Recent\n${recentSummary}\n\n## History\n${oldSummary}`,
            firstKeptEntryId: preparation.firstKeptEntryId,
            tokensBefore: preparation.tokensBefore,
            details: { levels: 2 }
        }
    };
});
```

### 断点恢复的关键知识

1. **会话文件是完整的**：所有消息（包括被压缩的）都保存在 JSONL 文件中
2. **恢复流程**：`SessionManager.open(path)` -> `loadEntriesFromFile()` -> `_buildIndex()` -> `buildSessionContext()`
3. **状态重建**：`buildSessionContext()` 从 leaf 到 root 遍历，自动处理 compaction 和 branch summary
4. **扩展状态**：扩展需要扫描 `CustomEntry`（`type: "custom"`）来重建自己的状态
5. **Fork 恢复**：`SessionHeader.parentSession` 指向源会话文件，可追溯完整历史
