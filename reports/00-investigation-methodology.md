# Pi-Mono 深度分析：调查方法论

> 综合批注：目的是基于本项目开发一个类似 Claude Code 一样的 Coding Agent ，需要增加自身对 Skill 和这个 Agent 完全的上下文把控，目前例如 Claude Code 等工具上下文管理过于灾难，本次开发目的在于：基于 pi-mono 构建一个全新的 Coding Agent，我作为构建者要能灵活调整它的上下文，例如我需要控制它 SKILL 调用的 scope 从而使得 SKILL 调用完就不再知道 SKILL 相关具体信息，不再占用上下文等；但是作为用户当然例如 Claude Code 他们还是不知道上下文具体如何的，他们依然无法控制。所以我这里特别关注如果我要作为 SDK 开发，又如何和 TUI 组建融合，也就是我的工具也最好能用它的 TUI ；而我要做的话更好的方法是自己用 SDK 模式开发还是说用 Extension 模式也能控制上下文？这些都是怎么做的？乃至最好当然作为用户也能控制上下文，这些我都希望有明确结论

## 一、调查目标

基于 pi-mono 项目开发 Coding Agent，需要在代码层面理解：
1. **Extension 系统**：扩展生命周期、事件类型、如何挂钩 TUI 组件
2. **TUI 执行路径**：扩展注册的工具/命令在 TUI 中如何被触发和渲染
   > 重点关注如何使用这个 TUI 组建，当我要自己改动创建自己的 Coding Agent 时如何能直接使用这个 TUI 则不需要我自己再实现
3. **Sub-Agent 机制**：当前有无子代理概念、如何实现嵌套代理
4. **SDK 模式**：`createAgentSession()` 的完整调用链，如何脱离 TUI 独立运行，又如何与 TUI 组件融合
5. **Skill 系统**：Skill 文件格式、发现机制、注入系统提示词的路径
6. **Context 管理**：压缩算法、会话分支、消息转换

## 二、调查分层（6 个调查域）

### Domain A：核心运行时（Core Runtime）
**范围**：packages/agent/ 全部 + packages/ai/src/{stream,types}.ts
**重点**：
- Agent 状态机（agent.ts）：prompt/continue/subscribe 三大入口
- Agent Loop（agent-loop.ts）：消息轮次、工具执行、错误恢复
- LLM 流式接口（stream.ts）：provider 抽象、token 事件
> 这里需要注意如何配置自己的 LLM provider ，我的 Coding Agent 要能自己配置 LLM 供应商，里面包含配置 base URL、API key、有多少种模型，模型名称等

**输出**：`reports/A-core-runtime.md`

### Domain B：编排层（Coding Agent Session）
**范围**：packages/coding-agent/src/core/agent-session.ts + sdk.ts + messages.ts
**重点**：
- agent-session.ts（96KB）的主循环：初始化、工具注册、压缩触发、分支
- createAgentSession() 工厂函数的参数和返回值
- 消息转换 convertToLlm()：自定义消息类型如何变成 LLM 消息

**输出**：`reports/B-agent-session.md`

### Domain C：Extension 系统
**范围**：packages/coding-agent/src/core/extensions/ 全部 5 文件
**重点**：
- types.ts（44KB）：所有事件类型和处理器签名的完整分类
- loader.ts：扩展发现路径（npm 包、本地目录、.pi/ 目录）
- runner.ts：事件派发机制、钩子执行顺序、错误处理
- wrapper.ts：工具包装（扩展如何添加自定义工具）
- 扩展如何注册 UI 组件到 TUI

**输出**：`reports/C-extension-system.md`

### Domain D：工具与 Skill 系统
**范围**：packages/coding-agent/src/core/tools/ + skills.ts + system-prompt.ts + prompt-templates.ts
**重点**：
- 工具注册机制（AgentTool 接口、TypeBox schema）
- 6 个核心工具的入口函数和调用链
- Skill 文件解析（YAML frontmatter + markdown body）
- 系统提示词组装流程
- Jinja2 模板系统

**输出**：`reports/D-tools-and-skills.md`

### Domain E：TUI 与执行模式
**范围**：packages/coding-agent/src/modes/ + packages/tui/src/
**重点**：
- interactive-mode.ts：TUI 模式启动流程、组件挂载
- rpc-mode.ts：RPC 模式如何接受外部消息
- print-mode.ts：非交互输出
- tui.ts（40KB）：差分渲染、缓冲区管理
- 组件系统：38 个组件的职责分类
- 扩展注册的 UI 组件如何被渲染

**输出**：`reports/E-tui-and-modes.md`

### Domain F：Context 管理（压缩、会话、包管理）
**范围**：packages/coding-agent/src/core/{compaction/*, session-manager.ts, package-manager.ts, resource-loader.ts}
**重点**：
- 压缩算法：触发条件、切割点检测、摘要生成
- 会话持久化：JSON 格式、分支树结构
- 包管理器：扩展/技能/主题的 npm/git 安装和发现
- 资源加载器：各类资源的统一发现机制

**输出**：`reports/F-context-management.md`

## 三、输出格式规范

每个 Domain 文档遵循：

```markdown
# [Domain Name]

## 概述
（2-3 句话总结）

## 文件树
（该 domain 涉及的所有文件，树状结构）

## 核心流程
### [流程名]
- 入口函数：`functionName()` @ file:line
- 调用链：A → B → C
- 分支点：条件 X 走 Y，条件 Z 走 W

## 关键类型/接口
（列出最重要的 5-10 个类型）

## 与其他 Domain 的接口
（该模块向外暴露什么、消费什么）

## 开发指南
（基于分析结果，回答用户的实际问题：如何扩展、如何自定义）
```

## 四、文档树最终结构

```
reports/
├── 00-investigation-methodology.md   ← 本文件
├── 01-index.md                       ← 总索引与整体架构概述
├── A-core-runtime.md                 ← 核心运行时
├── B-agent-session.md                ← 编排层
├── C-extension-system.md             ← Extension 系统
├── D-tools-and-skills.md             ← 工具与 Skill
├── E-tui-and-modes.md                ← TUI 与执行模式
├── F-context-management.md           ← Context 管理
└── G-dev-guide.md                    ← 开发指南（综合回答用户问题）
```

## 五、调查执行计划

### 第一批（并行 3 个 Agent）
- Agent-A：Domain A（Core Runtime）— 文件少，快速完成
- Agent-B：Domain B（Agent Session）— 最大文件，需要集中精力
- Agent-C：Domain C（Extension System）— 用户最关心的部分

### 第二批（并行 3 个 Agent）
- Agent-D：Domain D（Tools & Skills）
- Agent-E：Domain E（TUI & Modes）
- Agent-F：Domain F（Context Management）

### 第三批（串行 1 个 Agent）
- Agent-G：综合 A-F 的产出，生成总索引 01-index.md 和开发指南 G-dev-guide.md

## 六、注意事项

1. 每个 Agent 只写自己的 domain 文件，不要修改其他文件
2. Agent 返回消息要简洁（< 500 字），详细内容写入文件
3. 代码引用格式：`functionName()` @ `relative/path:line`
4. 对于大文件（如 agent-session.ts 96KB），不需要逐行分析，
   聚焦于：入口函数、主循环、分支点、对外接口
5. 所有文档用中文撰写
