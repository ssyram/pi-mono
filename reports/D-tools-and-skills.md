# D - 工具与 Skill 系统

## 概述

Pi-mono 的工具系统采用 **工厂模式** 构建，每个工具都有 `createXxxTool(cwd, options?)` 工厂函数和预构建的 `xxxTool` 单例。工具通过 TypeBox schema 定义参数，实现统一的 `AgentTool` 接口。所有工具支持通过 `Operations` 接口注入自定义 I/O（如 SSH 远程执行），这是一个关键的可扩展性设计。

Skill 系统基于 **Agent Skills 标准**（agentskills.io），采用 YAML frontmatter + Markdown 格式。Skill 的发现是静态的（文件系统扫描），注入到系统提示词的只是 **索引摘要**（name/description/location），实际内容需要 LLM 用 read 工具按需加载，天然实现了 scope 化。

系统提示词组装是线性拼接：基础提示 -> 工具列表 -> 指南 -> Pi 文档引用 -> 追加内容 -> 上下文文件 -> Skill 列表 -> 日期时间/工作目录。

## 文件树

```
packages/
  ai/src/types.ts                          # Tool 基础接口（name/description/parameters）
  agent/src/types.ts                       # AgentTool 接口（扩展 Tool，添加 execute/label）
  coding-agent/src/
    config.ts                              # 路径常量（CONFIG_DIR_NAME, getAgentDir 等）
    core/
      tools/
        index.ts                           # 工具注册入口，导出工厂函数和预构建实例
        bash.ts                            # Bash 工具
        read.ts                            # Read 工具
        write.ts                           # Write 工具
        edit.ts                            # Edit 工具（精确文本替换）
        edit-diff.ts                       # Diff 计算工具（fuzzy match + unified diff）
        find.ts                            # Find 工具（fd）
        grep.ts                            # Grep 工具（ripgrep）
        ls.ts                              # Ls 工具
        truncate.ts                        # 截断工具（head/tail/line 三种模式）
        path-utils.ts                      # 路径解析（~ 展开、macOS 变体、@前缀）
      skills.ts                            # Skill 发现/加载/格式化
      system-prompt.ts                     # 系统提示词组装
      prompt-templates.ts                  # 提示模板系统（$1, $@, ${@:N} 参数替换）
      slash-commands.ts                    # 斜杠命令定义
      resource-loader.ts                   # 资源加载器（统一管理 skills/prompts/themes/extensions）
      agent-session.ts                     # Session 层，调用上述所有模块
    utils/frontmatter.ts                   # YAML frontmatter 解析器
```

## 工具系统

### AgentTool 接口定义

工具接口分两层：

**第一层：`Tool`** @ `packages/ai/src/types.ts:196`
```typescript
export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;  // TypeBox schema，自动转 JSON Schema 供 LLM 使用
}
```

**第二层：`AgentTool`** @ `packages/agent/src/types.ts:157`
```typescript
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;  // UI 显示标签
  execute: (
    toolCallId: string,
    params: Static<TParameters>,  // TypeBox 推导出的参数类型
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,  // 流式进度回调
  ) => Promise<AgentToolResult<TDetails>>;
}
```

**`AgentToolResult<T>`** @ `packages/agent/src/types.ts:146`
```typescript
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];  // 返回给 LLM 的内容（支持文本+图片）
  details: T;  // UI 展示用的详情（如 diff、截断信息）
}
```

关键设计点：
- `content` 直接返回给 LLM，是上下文占用的主体
- `details` 不进入 LLM 上下文，仅供 UI 渲染（如 TUI 中显示 diff 高亮）
- `onUpdate` 回调实现流式输出（目前仅 bash 工具使用）
- `signal` 支持取消操作（所有工具都实现了 abort 检查）

### 工具注册机制

工具注册在 `packages/coding-agent/src/core/tools/index.ts`，采用两种模式：

**1. 预构建分组** @ `index.ts:82-96`
```typescript
export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool];       // 完整模式（默认）
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool];        // 只读模式
export const allTools = { read, bash, edit, write, grep, find, ls };                // 命名映射
```

**2. 工厂函数** @ `index.ts:110-139`
```typescript
export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[]
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[]
export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool>
```

**Extension 工具注册** @ `agent-session.ts`
Extension 可以通过 `ToolDefinition` 注册自定义工具，与内置工具合并到 `_baseToolRegistry` Map 中。工具名冲突检测在 `DefaultResourceLoader.detectExtensionConflicts()` 中处理。

**SDK 自定义工具** @ `sdk.ts:62`
```typescript
customTools?: ToolDefinition[];  // 通过 CreateAgentSessionOptions 传入
```

### 各工具概览

#### 1. Bash 工具
- **入口**：`createBashTool(cwd, options?)` @ `bash.ts:166`
- **参数 Schema**：`{ command: string, timeout?: number }` @ `bash.ts:19-22`
- **核心逻辑**：通过 `spawn(shell, [...args, command])` 执行命令，流式收集输出到滚动缓冲区，超大输出写入临时文件，最终对输出做 tail 截断（保留最后 2000 行/50KB）
- **关键辅助**：
  - `BashOperations.exec()` — 可插拔的命令执行接口（默认本地 shell）
  - `BashSpawnHook` — 执行前修改 command/cwd/env 的钩子
  - `getShellConfig()` / `getShellEnv()` @ `utils/shell.ts` — 获取 shell 配置
  - `killProcessTree()` — 杀死整个进程树
  - `truncateTail()` @ `truncate.ts` — tail 截断
- **流式支持**：通过 `onUpdate` 回调实时推送部分输出

#### 2. Read 工具
- **入口**：`createReadTool(cwd, options?)` @ `read.ts:49`
- **参数 Schema**：`{ path: string, offset?: number, limit?: number }` @ `read.ts:11-15`
- **核心逻辑**：读取文件内容，支持文本和图片两种模式。文本做 head 截断（前 2000 行/50KB），图片自动缩放到 2000x2000 后返回 base64 ImageContent
- **关键辅助**：
  - `ReadOperations` — 可插拔的文件读取接口
  - `resolveReadPath()` @ `path-utils.ts:62` — 路径解析（支持 macOS 截图路径变体）
  - `truncateHead()` @ `truncate.ts` — head 截断
  - `resizeImage()` @ `utils/image-resize.ts` — 图片缩放
  - `detectSupportedImageMimeTypeFromFile()` — 图片类型检测

#### 3. Write 工具
- **入口**：`createWriteTool(cwd, options?)` @ `write.ts:35`
- **参数 Schema**：`{ path: string, content: string }` @ `write.ts:7-10`
- **核心逻辑**：递归创建父目录后写入文件，返回字节数
- **关键辅助**：
  - `WriteOperations` — 可插拔的文件写入接口
  - `resolveToCwd()` @ `path-utils.ts:54` — 路径解析

#### 4. Edit 工具
- **入口**：`createEditTool(cwd, options?)` @ `edit.ts:55`
- **参数 Schema**：`{ path: string, oldText: string, newText: string }` @ `edit.ts:16-20`
- **核心逻辑**：精确文本替换。先尝试精确匹配，失败后尝试 fuzzy 匹配（忽略尾部空白、Unicode 引号/破折号差异）。要求匹配唯一（多次匹配报错），生成 unified diff 作为 details 返回
- **关键辅助**：
  - `EditOperations` — 可插拔接口
  - `fuzzyFindText()` @ `edit-diff.ts:78` — 精确 + fuzzy 两阶段匹配
  - `normalizeForFuzzyMatch()` @ `edit-diff.ts:34` — Unicode 正规化
  - `generateDiffString()` @ `edit-diff.ts:127` — unified diff 生成
  - `stripBom()` — 处理 UTF-8 BOM
  - `detectLineEnding()` / `restoreLineEndings()` — 保持原始行尾

#### 5. Find 工具
- **入口**：`createFindTool(cwd, options?)` @ `find.ts:52`
- **参数 Schema**：`{ pattern: string, path?: string, limit?: number }` @ `find.ts:11-17`
- **核心逻辑**：用 `fd` 命令做 glob 搜索（`--glob --hidden`），收集 `.gitignore` 规则，返回相对路径列表。默认限制 1000 条结果
- **关键辅助**：
  - `FindOperations` — 可插拔接口（支持自定义 glob）
  - `ensureTool("fd")` @ `utils/tools-manager.ts` — 自动下载 fd 二进制
  - `truncateHead()` — 结果截断

#### 6. Grep 工具
- **入口**：`createGrepTool(cwd, options?)` @ `grep.ts:63`
- **参数 Schema**：`{ pattern: string, path?: string, glob?: string, ignoreCase?: boolean, literal?: boolean, context?: number, limit?: number }` @ `grep.ts:18-30`
- **核心逻辑**：用 `ripgrep (rg)` 的 JSON 模式流式搜索，解析 match 事件后用自己的文件缓存读取上下文行，格式化输出。默认限制 100 个匹配
- **关键辅助**：
  - `GrepOperations` — 可插拔接口
  - `ensureTool("rg")` — 自动下载 ripgrep
  - `truncateLine()` @ `truncate.ts` — 单行截断（500 字符）
  - `truncateHead()` — 整体截断

#### 7. Ls 工具
- **入口**：`createLsTool(cwd, options?)` @ `ls.ts:46`
- **参数 Schema**：`{ path?: string, limit?: number }` @ `ls.ts:8-11`
- **核心逻辑**：读取目录内容，按字母排序，目录加 `/` 后缀。默认限制 500 条
- **关键辅助**：
  - `LsOperations` — 可插拔接口
  - `truncateHead()` — 结果截断

### 截断系统

所有工具共享截断模块 @ `truncate.ts`：

| 常量 | 值 | 用途 |
|------|-----|------|
| `DEFAULT_MAX_LINES` | 2000 | 文本行数上限 |
| `DEFAULT_MAX_BYTES` | 50KB | 字节上限 |
| `GREP_MAX_LINE_LENGTH` | 500 | grep 单行字符上限 |

三种截断模式：
- **`truncateHead()`**：保留前 N 行/字节（read/find/grep/ls 使用）
- **`truncateTail()`**：保留后 N 行/字节（bash 使用，优先显示最新输出）
- **`truncateLine()`**：单行截断（grep 使用）

### Operations 可插拔接口模式

每个工具都定义了对应的 `XxxOperations` 接口，将底层 I/O 操作抽象出来：

```
BashOperations  → exec(command, cwd, options)
ReadOperations  → readFile(path), access(path), detectImageMimeType(path)
WriteOperations → writeFile(path, content), mkdir(dir)
EditOperations  → readFile(path), writeFile(path, content), access(path)
FindOperations  → exists(path), glob(pattern, cwd, options)
GrepOperations  → isDirectory(path), readFile(path)
LsOperations    → exists(path), stat(path), readdir(path)
```

这允许在不修改工具逻辑的情况下，将执行委托到远程系统（如 SSH/Docker），是支持远程开发的关键抽象。

## Skill 系统

### Skill 文件格式

Skill 文件是带 YAML frontmatter 的 Markdown 文件。Frontmatter 字段定义 @ `skills.ts:66-71`：

```typescript
export interface SkillFrontmatter {
  name?: string;                       // Skill 名称（可选，默认用父目录名）
  description?: string;                // 描述（必需，最大 1024 字符）
  "disable-model-invocation"?: boolean; // 是否禁止 LLM 自动调用（仅允许 /skill:name 手动触发）
  [key: string]: unknown;              // 允许其他自定义字段
}
```

**示例 Skill 文件** (`my-skill/SKILL.md`):
```markdown
---
name: my-skill
description: Handles X tasks with specialized instructions
disable-model-invocation: false
---

# Instructions

Detailed instructions here...
```

**验证规则**：
- `name`：必须全小写字母 + 数字 + 连字符，不能以连字符开头/结尾，不能有连续连字符，最大 64 字符，必须匹配父目录名
- `description`：必需且非空，最大 1024 字符
- 缺少 description 的 Skill 不会被加载

### Skill 发现与加载

**发现规则** @ `loadSkillsFromDirInternal()` @ `skills.ts:151`：
1. **根目录**直接子文件：任何 `.md` 文件（`includeRootFiles=true`）
2. **子目录**递归：仅 `SKILL.md` 文件（`includeRootFiles=false`）
3. 跳过：以 `.` 开头的目录/文件、`node_modules`
4. 遵守 `.gitignore` / `.ignore` / `.fdignore` 规则

**加载位置（优先级从高到低）** @ `loadSkills()` @ `skills.ts:355`：
1. `~/.pi/agent/skills/` — 用户全局 skills（source: "user"）
2. `<cwd>/.pi/skills/` — 项目本地 skills（source: "project"）
3. 通过 `skillPaths` 参数传入的显式路径（source: "path"）

**去重**：
- 同名 Skill 先注册者优先（first-wins）
- 符号链接通过 `realpathSync` 去重
- 冲突生成 `ResourceDiagnostic`（type: "collision"）

**ResourceLoader 集成** @ `resource-loader.ts`：
实际运行时通过 `DefaultResourceLoader.reload()` 加载，包含来自 package manager、CLI 参数、Extension 注册的所有路径，最终合并到统一的 skills 列表。

### Skill 注入系统提示词的路径

**注入路径**：`DefaultResourceLoader.reload()` -> `AgentSession._rebuildSystemPrompt()` -> `buildSystemPrompt({ skills })` -> `formatSkillsForPrompt(skills)`

**格式化输出** @ `formatSkillsForPrompt()` @ `skills.ts:290`：

```xml
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory...

<available_skills>
  <skill>
    <name>my-skill</name>
    <description>Handles X tasks</description>
    <location>/path/to/my-skill/SKILL.md</location>
  </skill>
</available_skills>
```

关键行为：
- `disableModelInvocation=true` 的 Skill 被过滤掉，不出现在系统提示词中
- 系统提示词只包含索引，不包含 Skill 正文
- 仅当 `read` 工具可用时才注入 Skill 列表

### Skill 的上下文占用分析

**索引阶段（系统提示词中）**：
- 每个 Skill 占用约 **100-200 字节**（name + description + location 的 XML 标签）
- 10 个 Skill 约占 1-2KB 系统提示词空间 — **极轻量**

**调用阶段（LLM 用 read 工具加载时）**：
- Skill 正文作为 `ToolResultMessage.content` 进入上下文
- 受 read 工具截断限制（2000 行 / 50KB）
- **进入后不会自动移除**，永久占据上下文直到被 compaction 清理

**`/skill:name` 手动调用路径** @ `agent-session.ts:883`：
```typescript
private _expandSkillCommand(text: string): string {
  // 读取 Skill 文件，strip frontmatter
  const body = stripFrontmatter(content).trim();
  // 包装为 XML block 注入为用户消息
  return `<skill name="${skill.name}" location="${skill.filePath}">
References are relative to ${skill.baseDir}.
${body}
</skill>`;
}
```
- 展开后作为**用户消息**注入（非系统提示词）
- 支持参数追加（`/skill:name args` -> skill 内容 + args）
- 同样永久占据上下文

**Scope 化（用完即丢）的可行性**：

当前架构**不支持**自动 scope 化。Skill 内容一旦通过 read 工具或 `/skill:` 命令进入消息历史，就变成普通的 ToolResult 或 User 消息，无法标记为"临时"。

实现 scope 化的可能方案：
1. **`transformContext` 钩子**：在 `AgentLoopConfig.transformContext` 中识别 Skill 消息并在后续轮次中移除
2. **标记消息**：给 Skill 相关的 `AgentMessage` 添加 metadata 标记（如 `ephemeral: true`），在 `convertToLlm` 时根据条件过滤
3. **Compaction 策略**：将 Skill 内容标记为低优先级，在 context 压缩时优先丢弃

## 系统提示词

### 组装流程

入口：`buildSystemPrompt(options)` @ `system-prompt.ts:35`

两条路径：

**路径 A：自定义提示词（`customPrompt` 存在时）**
1. 以 `customPrompt` 为基础
2. 追加 `appendSystemPrompt`
3. 追加上下文文件（AGENTS.md / CLAUDE.md）
4. 追加 Skill 列表（如果 read 工具可用）
5. 追加日期时间和工作目录

**路径 B：默认提示词**
1. 基础角色描述（"You are an expert coding assistant..."）
2. 工具列表（根据 `selectedTools` 过滤）
3. 动态指南（根据可用工具生成）
4. Pi 文档路径引用
5. 追加 `appendSystemPrompt`
6. 追加上下文文件
7. 追加 Skill 列表
8. 追加日期时间和工作目录

### 各组成部分及顺序

| 顺序 | 组成部分 | 来源 | 条件 |
|------|----------|------|------|
| 1 | 角色描述 | 硬编码 | 默认路径 |
| 2 | 工具列表 | `toolDescriptions` 字典 | 默认路径 |
| 3 | 动态指南 | 根据工具组合生成 | 默认路径 |
| 4 | Pi 文档引用 | `getReadmePath()`/`getDocsPath()`/`getExamplesPath()` | 默认路径 |
| 5 | 追加内容 | `.pi/APPEND_SYSTEM.md` 或 `--append-system-prompt` | 可选 |
| 6 | 上下文文件 | `AGENTS.md`/`CLAUDE.md`（全局 + 祖先目录链） | 存在时 |
| 7 | Skill 索引 | `formatSkillsForPrompt()` | read 工具可用 + skills 非空 |
| 8 | 日期时间 | `new Date()` | 始终 |
| 9 | 工作目录 | `cwd` | 始终 |

**自定义系统提示词发现** @ `resource-loader.ts:746`：
- 项目级：`<cwd>/.pi/SYSTEM.md`（优先）
- 用户级：`~/.pi/agent/SYSTEM.md`

### 模板系统

Prompt Templates @ `prompt-templates.ts` 是独立于 Skill 的另一套机制：

**加载位置**（同 skills 的三级结构）：
1. `~/.pi/agent/prompts/*.md`（全局）
2. `<cwd>/.pi/prompts/*.md`（项目）
3. 显式路径

**参数替换** @ `substituteArgs()` @ `prompt-templates.ts:66`：
- `$1`, `$2` ... — 位置参数
- `$@` / `$ARGUMENTS` — 所有参数
- `${@:N}` — 从第 N 个开始的所有参数（bash 风格切片）
- `${@:N:L}` — 从第 N 个开始取 L 个

**展开时机**：用户输入 `/template-name args` 时，`expandPromptTemplate()` 匹配模板名并替换参数，结果作为用户消息内容。

## 斜杠命令

斜杠命令（Slash Commands）定义在 `slash-commands.ts`，分三个来源：

**1. 内置命令** @ `slash-commands.ts:18`：
`/settings`, `/model`, `/export`, `/share`, `/copy`, `/name`, `/session`, `/changelog`, `/hotkeys`, `/fork`, `/tree`, `/login`, `/logout`, `/new`, `/compact`, `/resume`, `/reload`, `/quit`（共 18 个）

**2. Extension 命令**：由 Extension 注册，通过 `extensionRunner` 执行

**3. Prompt/Skill 命令**：
- `/template-name` — 展开 prompt template
- `/skill:name` — 展开 skill 内容

命令列表汇总在 `AgentSession._getSlashCommands()` @ `agent-session.ts:1877`，用于 TUI 补全。

## 关键类型/接口

```typescript
// 工具相关
Tool<TParameters>              // 基础工具定义（name/description/parameters）
AgentTool<TParameters, TDetails> // 完整工具（+execute/label）
AgentToolResult<T>             // 工具返回值（content 给 LLM，details 给 UI）
AgentToolUpdateCallback<T>     // 流式更新回调
TruncationResult               // 截断元数据

// Skill 相关
SkillFrontmatter               // frontmatter 字段定义
Skill                          // 已加载的 Skill 实体
LoadSkillsResult               // 加载结果（skills + diagnostics）
LoadSkillsOptions              // 加载选项（cwd/agentDir/skillPaths/includeDefaults）

// 系统提示词
BuildSystemPromptOptions       // 系统提示词构建选项

// 模板
PromptTemplate                 // 提示模板实体
LoadPromptTemplatesOptions     // 模板加载选项

// 斜杠命令
SlashCommandInfo               // 命令信息（含 source: extension/prompt/skill）
BuiltinSlashCommand            // 内置命令

// 资源加载
ResourceLoader                 // 资源加载器接口
DefaultResourceLoader          // 默认实现（合并所有来源的资源）
ResourceDiagnostic             // 资源诊断（warning/error/collision）
```

## 与其他 Domain 的接口

| 对接 Domain | 接口点 | 说明 |
|-------------|--------|------|
| A (Agent Loop) | `AgentTool<T>` 注册到 `Agent.tools` | 工具通过 `AgentState.tools` 进入 agent loop |
| A (Agent Loop) | `AgentToolResult` 作为 `ToolResultMessage` | 工具返回值进入消息历史 |
| B (Context/Compaction) | `transformContext` 钩子 | Skill 消息可在此处被裁剪 |
| B (Context/Compaction) | 截断常量 (50KB/2000行) | 工具输出大小直接影响 context 消耗 |
| C (Extension) | `Extension.tools: Map<string, ToolDefinition>` | Extension 注册自定义工具 |
| C (Extension) | `ExtensionRunner` 执行命令 | `/skill:` 展开失败通过 runner 报错 |
| E (Session) | `AgentSession._rebuildSystemPrompt()` | 工具变更/Skill 变更时重建系统提示词 |
| E (Session) | `SessionManager` | 工具状态不持久化，Skill 列表按需重新加载 |

## 开发指南：自定义 Skill 与上下文控制

### 创建自定义 Skill

1. 在 `~/.pi/agent/skills/my-skill/` 下创建 `SKILL.md`
2. 添加 frontmatter：
   ```yaml
   ---
   name: my-skill
   description: Short description for LLM to decide when to load
   ---
   ```
3. 编写 Markdown 正文（指令内容）
4. 运行 `/reload` 让 Pi 重新扫描

### 上下文控制策略

**当前架构的限制**：
- Skill 内容一旦被 read 或 `/skill:` 加载，就成为普通消息，无法自动释放
- 没有消息级别的 TTL 或 ephemeral 标记机制

**可实现的优化方向**：

**方案 1：利用 `transformContext` 钩子**
```typescript
// 在 AgentLoopConfig.transformContext 中
transformContext: async (messages) => {
  return messages.filter(m => {
    // 识别 Skill 工具结果并在 N 轮后丢弃
    if (m.role === "toolResult" && m.toolName === "read" && isSkillPath(m)) {
      return isRecent(m, 3); // 保留最近 3 轮
    }
    return true;
  });
}
```

**方案 2：利用 `convertToLlm` 过滤**
```typescript
// 将 Skill 消息转换为摘要版本
convertToLlm: (messages) => messages.map(m => {
  if (isOldSkillMessage(m)) {
    return summarize(m); // 压缩为一句话摘要
  }
  return m;
});
```

**方案 3：`disable-model-invocation` + 主动管理**
- 将 Skill 设为 `disable-model-invocation: true`
- 仅通过 `/skill:name` 在需要时手动触发
- 配合 `/compact` 在完成后清理上下文

**方案 4（需改架构）：Ephemeral 消息标记**
- 扩展 `AgentMessage` 类型，添加 `ephemeral: true` 标记
- 在 `convertToLlm` 中检查标记，根据策略（如最近 N 轮后丢弃）过滤
- 这需要修改 `@mariozechner/pi-agent-core` 包
