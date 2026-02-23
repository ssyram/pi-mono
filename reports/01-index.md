# Pi-Mono 深度分析：总索引

## 项目概况

Pi-mono 是一个开源的 AI Coding Agent 框架，采用 TypeScript 编写，架构为多包 monorepo。其核心设计是**事件驱动状态机 + 异步迭代器流**：底层 `pi-ai` 提供 9 种 LLM Provider 的统一流式抽象，中层 `pi-agent-core` 构建有状态 Agent 循环（steering/follow-up 队列、工具执行、abort 控制），上层 `pi-coding-agent` 通过 AgentSession 编排完整的 Session 生命周期（压缩、重试、分支、扩展系统），并提供 4 种执行模式（Interactive TUI / Print / RPC / SDK）。扩展系统提供 30+ 种事件钩子，允许在不修改核心代码的前提下控制上下文、工具、UI 和压缩策略。

## 架构总览

### 包依赖关系

```
@mariozechner/pi-tui          (独立，无 agent 依赖)
    |
    v
@mariozechner/pi-ai           (LLM Provider 抽象、流式调用、模型注册)
    |
    v
@mariozechner/pi-agent-core   (Agent 状态机、agent-loop、工具执行、事件流)
    |
    v
@mariozechner/pi-coding-agent (AgentSession 编排、Extension、Tools、Modes)
```

### 数据流

```
用户输入
  |
  v
Mode (Interactive / Print / RPC / SDK)
  |  解析输入、UI 绑定
  v
AgentSession.prompt(text)
  |  扩展命令检查 -> input 事件拦截 -> Skill/模板展开
  |  预检压缩 -> before_agent_start 注入
  v
Agent._runLoop(messages)
  |
  v
agentLoop() / agentLoopContinue()
  |
  |  while(true):
  |    transformContext() ← Extension context 事件（可修改消息列表）
  |    convertToLlm()    ← AgentMessage -> LLM Message 转换
  |    streamFn()        ← 调用 LLM Provider 流式接口
  |    |
  |    v
  |  streamSimple() → resolveApiProvider() → provider.streamSimple()
  |    |
  |    v
  |  for await (event of response):
  |    message_start / message_update / message_end → emit 给 listeners
  |    |
  |    v
  |  检查 toolCalls:
  |    有 → executeToolCalls() → tool_call 事件(可阻止) → tool.execute() → tool_result 事件(可修改)
  |    无 → 检查 steering 队列 → 检查 follow-up 队列 → agent_end
  |
  v
AgentSession._handleAgentEvent()
  |  agent_end → 自动压缩检查 → 持久化 → 重试逻辑
  v
Mode 渲染输出 (TUI 组件更新 / JSON 输出 / RPC 事件流)
```

## 文档树

```
reports/
├── 00-investigation-methodology.md  ← 调查方法论
├── 01-index.md                      ← 本文件：总索引与跨域洞察
├── A-core-runtime.md                ← Agent 状态机、agent-loop、LLM 流式接口、Provider 注册（9 种内置）
├── B-agent-session.md               ← AgentSession 编排中枢、SDK 工厂、上下文控制点全景、压缩/重试/分支
├── C-extension-system.md            ← Extension 事件驱动架构、30+ 事件类型、工具/命令/UI/Provider 注册
├── D-tools-and-skills.md            ← 7 个内置工具、Operations 可插拔接口、Skill 格式与发现、系统提示词组装
├── E-tui-and-modes.md               ← 独立 TUI 库、4 种执行模式、Extension UI 渲染、RPC 协议
├── F-context-management.md          ← 增量滚动压缩、JSONL 树状会话持久化、包管理器、资源加载器
└── G-dev-guide.md                   ← 开发指南：路线选择、上下文控制实战、TUI 复用、自定义 Provider、Sub-Agent
```

## 各域核心发现速查

### A - 核心运行时
- Agent 是**事件驱动状态机**，8 种 AgentEvent 覆盖完整生命周期（agent/turn/message/tool_execution）
- agent-loop 是双层 while 循环：内层驱动工具调用，外层驱动 follow-up 消息
- **Steering 中断**机制：每执行完一个工具就检查 steering 队列，可中断剩余工具序列
- EventStream<T,R> 是通用的 push/pull 异步迭代器，无显式背压
- 9 个内置 API Provider 自动注册，支持 3 种自定义 Provider 方式（OpenAI 兼容 / 全新注册 / 代理模式）

### B - 编排层
- AgentSession 是核心编排中枢（2865 行），封装 Agent + SessionManager + ExtensionRunner
- `createAgentSession()` SDK 工厂提供一站式创建，支持 `SessionManager.inMemory()` 无文件模式
- 上下文控制点分布在 5 个层面：消息进入前（6 个点）、消息转换时（3 个点）、消息存在后（6 个点）、System Prompt（4 个点）、工具集（4 个点）
- 压缩有两条路径：Overflow（自动重试）和 Threshold（等待用户）
- 分支系统支持 Fork（新文件）和 Tree Navigation（同文件切换 leaf 指针）

### C - Extension 系统
- 30 种事件类型，分 7 组：资源发现、会话生命周期（10 种，含 5 个 before_ 可取消）、Agent 循环（6 种）、消息流（3 种）、工具（5 种）、输入（1 种）、模型（1 种）
- **`context` 事件是上下文控制的核心**：每次 LLM 调用前触发，接收 structuredClone 深拷贝的消息列表，可完全替换
- `session_before_compact` 可完全替换默认压缩逻辑
- 同进程、无沙盒执行，handler 异常不影响其他扩展（错误隔离）
- 可替换 TUI 的编辑器、页头、页脚、覆盖层，甚至注册全屏自定义组件

### D - 工具与 Skill
- 7 个内置工具（read/bash/edit/write/grep/find/ls），全部通过 Operations 接口实现 I/O 可插拔
- Skill 系统基于 Agent Skills 标准（YAML frontmatter + Markdown），系统提示词中**只注入索引**（name/description/location），正文需 LLM 用 read 工具按需加载
- Skill 正文一旦加载进入消息历史，**不会自动移除**，永久占据上下文直到被 compaction 清理
- `disable-model-invocation` 字段可防止 LLM 自动调用，仅允许 `/skill:name` 手动触发
- 截断系统统一管理（head/tail/line 三种模式，默认 2000 行 / 50KB）

### E - TUI 与执行模式
- `@mariozechner/pi-tui` 是**完全独立**的 npm 包，不依赖 agent 任何模块，可独立使用
- 差分渲染引擎：被动触发、nextTick 去重、Synchronized Output 防闪烁
- 4 种执行模式共享同一 AgentSession 实例，仅 I/O 绑定方式不同
- RPC 模式提供 26 种命令的 JSON Lines 协议，`RpcClient` 提供完整的类型安全 API
- Interactive 模式 35 个专用 UI 组件，Extension 可通过 ExtensionUIContext 替换任意 UI 区域

### F - Context 管理
- 压缩是**增量滚动摘要**（rolling summary）：每次只处理新消息，将前次摘要作为上下文让 LLM 合并
- 切割点检测：从后向前累积 token（chars/4 启发式），在有效切割点（user/assistant/bash/custom）处分割，永不在 toolResult 处切割
- 会话以 JSONL append-only 树结构持久化，id/parentId 链表实现分支，leaf 指针移动实现导航
- 包管理器支持 npm/git/local 三种源，project scope 优先于 user scope
- 资源加载器统一管理 4 种资源类型（extensions/skills/prompts/themes），支持 6 个 override 钩子

## 跨域关键洞察

### 1. 上下文控制的完整路径

pi-mono 提供了**从输入到输出的全链路上下文控制**，但分散在多个 Domain 中：

```
用户输入 → input 事件拦截(C) → Skill/模板展开(D)
    → before_agent_start 注入(C) → transformContext/context 事件(A+C)
    → convertToLlm 过滤(B) → LLM 调用
    → tool_call 拦截(C) → tool_result 修改(C)
    → session_before_compact 替换(C+F) → replaceMessages(A+B)
```

`context` 事件（Domain C）是最强大的单点控制——每次 LLM 调用前可完全替换消息列表。但要实现"Skill 用完即丢"这类高级场景，需要 `context` 事件 + `CustomEntry` 标记（Domain F）+ 消息识别逻辑的组合。

### 2. Extension + SDK 组合是最佳路线

SDK 路线（`createAgentSession()`）提供完全的初始化控制权，而 Extension 路线提供运行时的 30+ 事件钩子。两者**不互斥**——SDK 创建的 session 仍然会加载和运行 Extension。推荐策略：用 SDK 控制 Agent 的创建参数（模型、工具、session 存储），用 Extension 控制运行时行为（上下文修改、工具拦截、UI 定制）。

### 3. TUI 复用有三种粒度

- **最轻**：直接用 `@mariozechner/pi-tui` 独立包构建自定义界面，完全脱离 coding-agent
- **中等**：用 `RpcClient` 驱动 agent 子进程 + 自定义 TUI 渲染（获得 26 种命令控制 + 事件流）
- **最重**：复用 `InteractiveMode` + Extension UI 组件（35 个），通过 Extension 定制

三种方式的控制权依次递减，复用程度依次递增。-> 详见 [G-dev-guide.md]

### 4. Skill 的"天然 Scope 化"与"持久化陷阱"

Skill 系统的索引设计是天然 scope 化的——系统提示词中只放 100-200 字节的索引。但一旦 LLM 通过 read 工具或 `/skill:` 命令加载正文，内容就变成普通消息，永久占据上下文。这是 pi-mono 上下文管理的一个设计缺口，需要开发者通过 `context` 事件或自定义压缩来弥补。-> 详见 [G-dev-guide.md] Skill Scope 化章节

### 5. Sub-Agent 无内置支持，但有完整示例

pi-mono 没有内置的嵌套代理支持。示例 `subagent/` 通过 `spawn("pi", ...)` 启动隔离子进程实现，这是目前的最佳实践。更轻量的方式是用 `createAgentSession()` 在同进程创建独立的 Agent 实例，通过 `SessionManager.inMemory()` 隔离上下文。但同进程方式共享事件循环，长任务可能阻塞主 Agent。-> 详见 [G-dev-guide.md] Sub-Agent 章节

### 6. Operations 接口是远程开发的关键抽象

所有 7 个内置工具都通过 `XxxOperations` 接口抽象了底层 I/O。这不是偶然设计——它是支持 SSH/Docker 远程执行的预留接口。构建自定义 Agent 时，可以通过替换 Operations 实现，将工具执行委托到远程环境，而不需要修改任何工具逻辑。

### 7. 压缩系统的滚动摘要策略

pi-mono 的压缩不是多级（L1/L2/L3）结构，而是单级滚动摘要。每次压缩会将前次摘要作为上下文让 LLM 合并。这意味着信息密度随压缩次数递减——早期信息经过多次"蒸馏"后可能失真。对需要精确长期记忆的场景（如跨文件重构），建议通过 Extension 的 `session_before_compact` 钩子实现分层压缩策略。-> 详见 [F-context-management.md] 多级压缩章节
