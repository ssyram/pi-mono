# G - 开发指南：基于 Pi-Mono 构建 Coding Agent

## 路线选择：Extension vs SDK vs 组合

### Extension 路线

**适用场景**：在现有 pi Coding Agent 上增强功能或修改行为，不需要控制 Agent 的创建过程。

**上下文控制能力**（-> 详见 [C-extension-system.md]）：
- `context` 事件：每次 LLM 调用前获得 `structuredClone` 深拷贝的完整消息列表，可任意添加/删除/修改后返回
- `before_agent_start` 事件：每轮可注入 CustomMessage 和修改 systemPrompt（链式，后一个扩展收到前一个的输出）
- `input` 事件：拦截（`handled`）或转换（`transform`）用户输入
- `tool_call` / `tool_result` 事件：阻止工具执行或修改工具返回结果
- `session_before_compact` 事件：完全替换默认压缩逻辑，返回自定义 `CompactionResult`

**优势**：
- 零配置开发：`.ts` 文件放到 `~/.pi/agent/extensions/` 即自动加载
- 无需编译：jiti 运行时直接执行 TypeScript
- 热重载：`/reload` 命令即时生效
- 30+ 事件钩子覆盖 Agent 完整生命周期
- 可复用全部基础设施（TUI、session、model registry、tools）

**限制**：
- 同进程执行，崩溃影响主进程（无沙盒）
- 无法修改 Agent 核心循环逻辑（只能通过事件干预）
- `sessionManager` 在事件 handler 中是只读的（写操作需 `ExtensionCommandContext`）
- 无法控制 Agent 的初始化参数（模型、工具集、session 存储方式）

### SDK 路线

**适用场景**：构建全新的 Coding Agent 应用，或将 pi 嵌入到其他 Node.js/Bun 应用中。

**核心入口**：`createAgentSession()` @ `packages/coding-agent/src/core/sdk.ts:165`（-> 详见 [B-agent-session.md]）

```typescript
import { createAgentSession, codingTools } from "@mariozechner/pi-coding-agent/sdk";
import { getModel } from "@mariozechner/pi-ai";

const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  thinkingLevel: "medium",
  tools: codingTools,               // [read, bash, edit, write]
  customTools: [myCustomTool],      // 自定义工具
  sessionManager: SessionManager.inMemory(),  // 可选：纯内存模式
});
```

**可配置项** @ `CreateAgentSessionOptions`：

| 参数 | 说明 |
|------|------|
| `model` | 指定 LLM 模型 |
| `thinkingLevel` | 思考等级（off/minimal/low/medium/high/xhigh） |
| `tools` | 启用的内置工具子集 |
| `customTools` | 自定义工具（`ToolDefinition[]`） |
| `sessionManager` | 可替换为 `SessionManager.inMemory()` |
| `settingsManager` | 可替换设置管理 |
| `resourceLoader` | 可替换资源加载器 |
| `modelRegistry` | 可替换模型注册表 |

**优势**：
- 完全控制 Agent 创建参数
- 可替换所有管理器（Session/Settings/Resource）
- 可内嵌到其他应用中
- Extension 仍然可用（通过 `extensionsResult` 访问）

**限制**：
- 需要自行管理 TUI 或提供 `ExtensionUIContext` 实现
- API 表面更大，学习曲线更陡
- 需要了解 `runner.bindCore()` 等内部初始化步骤

### 组合路线（推荐）

**核心思想**：用 SDK 控制 Agent 初始化，用 Extension 控制运行时行为。

```
                    ┌─────────────────────────────────────────┐
                    │           你的应用 (SDK 层)              │
                    │                                         │
                    │  createAgentSession({                   │
                    │    model, tools, customTools,           │
                    │    sessionManager, ...                  │
                    │  })                                     │
                    └──────────────┬──────────────────────────┘
                                   │
                    ┌──────────────v──────────────────────────┐
                    │         AgentSession (编排层)            │
                    │                                         │
                    │  ┌─────────────┐  ┌──────────────────┐  │
                    │  │   Agent     │  │ ExtensionRunner   │  │
                    │  │ (核心循环)   │  │ (事件派发)        │  │
                    │  └──────┬──────┘  └──────┬───────────┘  │
                    │         │                │              │
                    └─────────┼────────────────┼──────────────┘
                              │                │
          ┌───────────────────┼────────────────┼──────────────┐
          │                   │                │              │
   ┌──────v──────┐    ┌──────v──────┐   ┌─────v──────┐      │
   │ pi-ai       │    │  你的扩展    │   │ 内置工具    │      │
   │ LLM Provider│    │ (Extension) │   │ + 自定义工具 │      │
   └─────────────┘    │             │   └────────────┘      │
                      │ context 事件 │                       │
                      │ compact 钩子 │                       │
                      │ tool 拦截    │                       │
                      │ UI 定制      │                       │
                      └─────────────┘                       │
          └─────────────────────────────────────────────────┘
```

**组合步骤**：

1. 用 `createAgentSession()` 创建 session，传入自定义模型、工具和 session 管理器
2. 将 Extension `.ts` 文件放到 `~/.pi/agent/extensions/` 或项目 `.pi/extensions/`
3. Extension 在 session 创建时自动加载和注册
4. 用 Extension 的事件钩子实现上下文控制、工具拦截、UI 定制
5. 用 SDK 的 `session.subscribe()` 获取事件流，驱动自定义 UI

**为什么推荐**：
- SDK 解决"控制权"问题（初始化参数、模型选择、存储方式）
- Extension 解决"灵活性"问题（运行时行为修改，无需改核心代码）
- 两者的能力互补，无冲突

---

## 上下文控制实战

### Skill Scope 化（用完即丢）

**问题**：Skill 正文通过 read 工具或 `/skill:name` 加载后，成为普通消息永久占据上下文，直到被 compaction 清理。-> 详见 [D-tools-and-skills.md] Skill 上下文占用分析

**方案 A：`context` 事件过滤（推荐，最简单）**

通过 Extension 的 `context` 事件，在每次 LLM 调用前识别并移除过期的 Skill 消息。

```typescript
// ~/.pi/agent/extensions/skill-scope.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const SKILL_DIR = "/.pi/skills/";  // Skill 文件路径特征
  const MAX_TURNS_KEPT = 2;          // 保留最近 N 轮

  pi.on("context", (event) => {
    let turnCount = 0;

    // 从后向前遍历，计算 user 消息的 turn 数
    const reversedMessages = [...event.messages].reverse();
    const expiredIndices = new Set<number>();

    for (let i = 0; i < reversedMessages.length; i++) {
      const msg = reversedMessages[i];
      if (msg.role === "user") turnCount++;

      // 识别 Skill 工具结果
      if (msg.role === "toolResult" && turnCount > MAX_TURNS_KEPT) {
        const content = msg.content?.[0];
        if (content?.type === "text" && content.text?.includes(SKILL_DIR)) {
          expiredIndices.add(event.messages.length - 1 - i);
        }
      }
    }

    if (expiredIndices.size > 0) {
      return {
        messages: event.messages.filter((_, idx) => !expiredIndices.has(idx)),
      };
    }
  });
}
```

**方案 B：Sub-Session 隔离（最彻底）**

为 Skill 执行创建独立的内存 Session，完成后仅将结论注入主 Session。-> 详见 [F-context-management.md] 方案 3

```typescript
// 伪代码：Skill 在独立 session 中执行
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent/sdk";

async function executeSkillIsolated(
  mainSession: AgentSession,
  skillContent: string,
  userTask: string,
): Promise<string> {
  // 1. 创建独立的内存 session
  const { session: subSession } = await createAgentSession({
    model: mainSession.model,
    sessionManager: SessionManager.inMemory(),
  });

  // 2. 在子 session 中执行 skill
  let result = "";
  subSession.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      result = extractTextContent(event.message);
    }
  });
  await subSession.prompt(`${skillContent}\n\nTask: ${userTask}`);

  // 3. 仅将结论注入主 session
  mainSession.sendCustomMessage({
    customType: "skill-result",
    content: [{ type: "text", text: `[Skill Result]: ${result}` }],
  }, { deliverAs: "nextTurn" });

  // 4. 子 session 自动回收（内存模式无持久化）
  subSession.dispose();
  return result;
}
```

**方案 C：标记 + 自定义压缩（最精细）**

在 Skill 消息前后插入 `CustomEntry` 标记，在压缩时识别并特殊处理。

```typescript
// Extension: skill-aware-compaction.ts
export default function (pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event) => {
    const { messagesToSummarize } = event.preparation;

    // 将 Skill 过程消息替换为一句话摘要
    const cleaned = messagesToSummarize.map((msg) => {
      if (isSkillProcessMessage(msg)) {
        return {
          ...msg,
          content: [{ type: "text", text: "[Skill process - omitted from summary]" }],
        };
      }
      return msg;
    });

    // 使用清理后的消息生成摘要（默认流程但输入已精简）
    return undefined; // 返回 undefined 让默认压缩处理精简后的消息
  });
}
```

### 选择性遗忘

**问题**：当前 pi-mono 没有按 scope 的选择性遗忘机制。-> 详见 [F-context-management.md] 选择性遗忘能力

**方案 A：`context` 事件动态过滤**

这是最灵活的方式——在每次 LLM 调用前检查消息列表，根据自定义规则移除不需要的消息。

```typescript
export default function (pi: ExtensionAPI) {
  const forgottenMessageIds = new Set<string>();

  // 注册 /forget 命令
  pi.registerCommand("forget", {
    description: "Forget messages by ID or pattern",
    handler: async (args, ctx) => {
      forgottenMessageIds.add(args.trim());
      ctx.ui.notify(`Marked for forgetting: ${args}`);
    },
  });

  // 每次 LLM 调用前过滤
  pi.on("context", (event) => {
    if (forgottenMessageIds.size === 0) return;
    return {
      messages: event.messages.filter((msg) => {
        // 根据你的标识逻辑过滤
        return !forgottenMessageIds.has(getMessageId(msg));
      }),
    };
  });
}
```

**方案 B：`session_before_compact` 自定义摘要**

在压缩时提供自定义摘要，从摘要中排除特定内容。-> 详见 [F-context-management.md] 定制压缩策略

**方案 C：分支导航 + 摘要**

使用 `navigateTree()` 导航到需要遗忘的消息之前的节点，系统自动为被离开的分支生成摘要。这是一种"离开即压缩"的模式。-> 详见 [B-agent-session.md] 分支管理

### 用户侧上下文控制

**问题**：最终用户（非开发者）能否也控制上下文？

**可行，通过以下方式暴露给用户**：

1. **`/compact` 命令**：用户可随时手动触发压缩（内置命令，无需额外开发）

2. **`/forget` 自定义命令**：通过 Extension 注册（见上方选择性遗忘方案 A），允许用户标记消息为"遗忘"

3. **`/skill:name` 控制**：将 Skill 设为 `disable-model-invocation: true`，用户按需手动加载

4. **`!!` 前缀排除**：用户用 `!! command` 执行的 bash 命令会被标记为 `excludeFromContext`，不发送给 LLM

5. **树导航（`/tree`）**：用户可在消息树中导航到任意节点，有效地"回到过去"

6. **Extension UI 暴露**：开发者可通过 Extension 的 `ui.select()`、`ui.confirm()` 等方法构建用户友好的上下文管理界面（如"选择要保留的消息"对话框）

**限制**：
- 用户无法直接编辑消息内容（只能删除整条消息）
- 用户无法控制 `transformContext` 的逻辑（这是开发者层面的控制）
- 压缩的摘要内容不可用户定制（除非开发者通过 Extension 暴露控制界面）

---

## TUI 复用

### 方案 A：直接用 Interactive 模式 + Extension

**适用场景**：在 pi 原生 TUI 上添加自定义 UI 元素和行为。

**步骤**：
1. 创建 Extension 文件 `~/.pi/agent/extensions/my-ui.ts`
2. 通过 `ExtensionUIContext` 注册 UI 组件

```typescript
// my-ui.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (event, ctx) => {
    if (!ctx.hasUI) return;

    // 在编辑器上方添加 widget
    ctx.ui.setWidget("my-status", ["Current task: analyzing code..."], {
      placement: "aboveEditor",
    });

    // 添加页脚状态
    ctx.ui.setStatus("my-ext", "My Extension Active");
  });

  // 注册快捷键打开全屏面板
  pi.registerShortcut(Key.ctrlAlt("d"), {
    description: "Show dashboard",
    handler: async (ctx) => {
      await ctx.ui.custom(
        (tui, theme) => new MyDashboardComponent(tui, theme),
        { overlay: true },
      );
    },
  });
}
```

**优势**：最低成本，完全复用 pi 的 TUI 和所有基础设施
**限制**：UI 布局受 pi 的固定结构约束（header/chat/editor/footer），只能在预留槽位中定制

### 方案 B：SDK(RpcClient) + 自定义 TUI

**适用场景**：需要完全自定义 UI 布局，但仍想复用 pi 的 Agent 逻辑。

**步骤**：
1. 用 `RpcClient` 启动 pi 的 RPC 子进程
2. 用 `@mariozechner/pi-tui` 独立构建自定义 UI
3. 通过 RPC 事件流驱动 UI 更新

```typescript
import { RpcClient } from "@mariozechner/pi-coding-agent";
import { TUI, ProcessTerminal, Container, Text, Editor, Markdown } from "@mariozechner/pi-tui";

// 1. 启动 Agent（RPC 子进程）
const client = new RpcClient({
  cwd: process.cwd(),
  model: "claude-sonnet-4-20250514",
});
await client.start();

// 2. 构建自定义 TUI
const terminal = new ProcessTerminal();
const tui = new TUI(terminal);
const chatArea = new Container();
const editor = new Editor(tui, myEditorTheme);

tui.addChild(new Text("My Agent v1.0", 1, 1));
tui.addChild(chatArea);
tui.addChild(editor);
tui.setFocus(editor);

// 3. 事件流 -> UI 更新
client.onEvent((event) => {
  if (event.type === "message_end" && event.message.role === "assistant") {
    const md = new Markdown(extractText(event.message), 1, 0, myMarkdownTheme);
    chatArea.addChild(md);
    tui.requestRender();
  }
});

// 4. 用户输入 -> Agent
editor.onSubmit = async (text) => {
  chatArea.addChild(new Text(`> ${text}`, 1, 0));
  tui.requestRender();
  await client.prompt(text);
};

tui.start();
```

**RPC 支持的控制命令**（-> 详见 [E-tui-and-modes.md]）：
- `prompt` / `steer` / `follow_up` / `abort` — 消息控制
- `set_model` / `cycle_model` / `get_available_models` — 模型控制
- `compact` / `set_auto_compaction` — 压缩控制
- `new_session` / `get_state` — 会话控制
- 共 26 种命令

**优势**：完全控制 UI 布局、Agent 在独立进程运行（隔离性好）
**限制**：Extension 的 `setFooter`/`setHeader`/`setEditorComponent`/`custom` 在 RPC 模式不可用；启动有约 100ms 延迟

### 方案 C：独立使用 pi-tui 库

**适用场景**：只需要 TUI 渲染能力，不需要 pi 的 Agent 逻辑。

`@mariozechner/pi-tui` 是完全独立的 npm 包（-> 详见 [E-tui-and-modes.md]），依赖仅为 `chalk`、`marked`、`get-east-asian-width`、`mime-types`。

```typescript
import { TUI, ProcessTerminal, Container, Text, Editor, SelectList, Box, Loader } from "@mariozechner/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

// 可用组件：Text, Editor, Markdown, SelectList, SettingsList, Box,
//          Loader, CancellableLoader, Input, Image, Spacer, TruncatedText

const header = new Text("My Custom App", 1, 1);
const content = new Container();
const editor = new Editor(tui, myTheme);

tui.addChild(header);
tui.addChild(content);
tui.addChild(editor);
tui.setFocus(editor);
tui.start();
```

**注意事项**：
- `Editor` 和 `Loader` 构造函数需要 `TUI` 实例（用于 requestRender 触发重绘）
- `Markdown` 需要外部传入 `MarkdownTheme`（颜色函数），TUI 库不含默认主题
- 组件 `render()` 返回的行**不能**超过 `width`，否则 TUI 会 crash
- 使用 `visibleWidth()` / `truncateToWidth()` 处理 ANSI 字符串宽度
- 只有线性垂直拼接布局（无 flex / grid）

**优势**：完全独立、零 agent 依赖、差分渲染引擎性能好
**限制**：需要自己提供所有主题定义和布局逻辑

### 三种方案对比

| 维度 | A: Interactive + Extension | B: RpcClient + 自定义 TUI | C: 独立 pi-tui |
|------|-------------------------|--------------------------|---------------|
| UI 控制权 | 低（预留槽位） | 高（完全自定义） | 完全 |
| Agent 复用 | 完整 | 完整（RPC 协议） | 无 |
| Extension 支持 | 完整 | 部分（UI 方法受限） | 无 |
| 启动成本 | 最低 | 中等（子进程） | 最低 |
| 学习曲线 | 低 | 中 | 中 |

---

## 自定义 LLM Provider

Pi-mono 提供 3 种注册自定义 Provider 的方式（-> 详见 [A-core-runtime.md]）。

### 方式一：OpenAI 兼容 API（推荐，最简路径）

大多数自定义 Provider 兼容 OpenAI Completions 或 Responses API 协议。只需构造 `Model` 对象：

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

const myModel: Model<"openai-completions"> = {
  id: "my-custom-model",
  name: "My Custom Model",
  api: "openai-completions",            // 使用 OpenAI Completions 协议
  provider: "my-provider",
  baseUrl: "https://my-api.example.com/v1",  // 自定义端点
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
  headers: { "X-Custom-Header": "value" },    // 可选：自定义请求头
  compat: {                                     // 可选：兼容性覆盖
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
  },
};

// 在 SDK 中使用
const { session } = await createAgentSession({
  model: myModel,
  getApiKey: async (provider) => {
    if (provider === "my-provider") return "my-api-key";
  },
});
```

**API Key 配置优先级**：
1. `AgentOptions.getApiKey` 回调（动态，支持 token 刷新）
2. `StreamOptions.apiKey`（每次调用指定）
3. `getEnvApiKey(provider)`（环境变量，仅内置 provider）

### 方式二：注册全新 API Provider

若 API 不兼容任何已有协议（非 OpenAI / 非 Anthropic 格式），需实现并注册：

```typescript
import { registerApiProvider, AssistantMessageEventStream } from "@mariozechner/pi-ai";

registerApiProvider({
  api: "my-custom-api",
  stream: (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    (async () => {
      // 调用你的 API，解析响应，推送事件
      stream.push({ type: "start", partial: { role: "assistant", content: [] } });
      stream.push({ type: "text_delta", text: "Hello!" });
      stream.push({ type: "done", reason: "stop", message: finalMessage });
      stream.end();
    })();
    return stream;
  },
  streamSimple: (model, context, options) => { /* 同上，处理 reasoning 映射 */ },
}, "my-extension");  // sourceId 用于批量卸载
```

### 方式三：通过 Extension 注册 Provider

```typescript
// ~/.pi/agent/extensions/my-provider.ts
export default function (pi: ExtensionAPI) {
  pi.registerProvider("my-provider", {
    models: [
      { id: "model-v1", name: "Model V1", contextWindow: 128000, maxTokens: 8192 },
    ],
    baseUrl: "https://my-api.example.com/v1",
    // 可选：自定义 streamSimple handler
  });
}
```

Extension 方式的 Provider 注册会在 `bindCore()` 时统一处理，支持覆盖已有 Provider 的 baseUrl。

### 环境变量快查

| Provider | 环境变量 |
|----------|---------|
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN` > `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `github-copilot` | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` |
| `azure-openai` | `AZURE_OPENAI_API_KEY` |
| `amazon-bedrock` | AWS 标准凭证链 |

---

## Sub-Agent 实现

### 当前内置支持

Pi-mono **没有内置的嵌套代理支持**。Agent 类是单实例设计——一个 `AgentSession` 对应一个 `Agent`，agent-loop 是单线程的 while 循环。

### 方案 A：子进程隔离（示例 subagent/）

pi-mono 的示例扩展 `subagent/` 通过 `spawn("pi", ...)` 启动独立 pi 进程实现 Sub-Agent。这是目前的**官方推荐方式**。

```typescript
// 简化版 subagent 实现
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Sub Agent",
    description: "Run a subtask in an isolated agent",
    parameters: Type.Object({
      task: Type.String(),
      mode: Type.Union([
        Type.Literal("single"),
        Type.Literal("parallel"),
        Type.Literal("chain"),
      ]),
    }),
    async execute(id, params, signal) {
      const child = spawn("pi", ["-p", params.task], {
        cwd: process.cwd(),
        signal,
      });
      const output = await collectOutput(child);
      return {
        content: [{ type: "text", text: output }],
        details: { task: params.task },
      };
    },
  });
}
```

**优势**：完全隔离（独立进程、独立上下文、独立 session）
**限制**：启动开销大（每次 spawn 新进程）、无法共享状态

### 方案 B：同进程 SDK 实例（轻量级）

用 `createAgentSession()` 在同进程创建独立的 Agent 实例：

```typescript
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent/sdk";

async function runSubAgent(task: string, parentModel: Model<any>): Promise<string> {
  // 1. 创建隔离的子 session（纯内存，不写文件）
  const { session: sub } = await createAgentSession({
    model: parentModel,
    sessionManager: SessionManager.inMemory(),
    tools: codingTools,
  });

  // 2. 收集结果
  let result = "";
  sub.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      result = extractText(event.message);
    }
  });

  // 3. 执行任务
  await sub.prompt(task);

  // 4. 清理
  sub.dispose();
  return result;
}

// 在 Extension 工具中使用
pi.registerTool({
  name: "delegate",
  label: "Delegate",
  description: "Delegate a subtask to a focused sub-agent",
  parameters: Type.Object({ task: Type.String() }),
  async execute(id, params, signal, onUpdate, ctx) {
    const result = await runSubAgent(params.task, ctx.model);
    return { content: [{ type: "text", text: result }], details: {} };
  },
});
```

**优势**：启动快（无进程开销）、可共享模型配置
**限制**：共享事件循环（长任务可能阻塞主 Agent）、共享内存（需注意资源竞争）

### 方案 C：RPC 客户端（推荐的平衡方案）

用 `RpcClient` 启动子进程并通过 RPC 协议控制：

```typescript
import { RpcClient } from "@mariozechner/pi-coding-agent";

async function runSubAgentRpc(task: string): Promise<string> {
  const client = new RpcClient({ cwd: process.cwd() });
  await client.start();

  return new Promise((resolve) => {
    let result = "";
    client.onEvent((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        result = extractText(event.message);
      }
      if (event.type === "agent_end") {
        resolve(result);
      }
    });
    client.prompt(task);
  });
}
```

**优势**：进程隔离 + 类型安全 API + 26 种控制命令
**限制**：需要 Node.js 运行时、约 100ms 启动延迟

### 架构建议

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 简单子任务（< 30s） | B: 同进程 SDK | 启动快、无进程开销 |
| 长运行子任务 | C: RPC 客户端 | 进程隔离、不阻塞主 Agent |
| 高隔离需求（不信任子任务） | A: 子进程 spawn | 完全隔离 |
| 并行子任务 | A 或 C | 进程级并行、互不干扰 |

**注意**：无论哪种方案，Sub-Agent 的上下文与主 Agent **完全独立**。如需共享信息，必须通过消息传递（主 Agent 的工具调用返回值或 `sendCustomMessage`）。

---

## 快速开始清单

按优先级排列的 10 步操作指南：

### 1. 确认开发环境
```bash
# 需要 Node.js 18+ 或 Bun
node --version   # >= 18.0.0
# 安装 pi-mono 包
npm install @mariozechner/pi-coding-agent @mariozechner/pi-ai @mariozechner/pi-tui
```

### 2. 创建最小 SDK 应用
```typescript
import { createAgentSession, codingTools } from "@mariozechner/pi-coding-agent/sdk";

const { session } = await createAgentSession({
  thinkingLevel: "medium",
  tools: codingTools,
});

session.subscribe(console.log);
await session.prompt("List files in the current directory");
```

### 3. 配置自定义 LLM Provider（如需要）
- OpenAI 兼容：构造 `Model<"openai-completions">` 对象，设置 `baseUrl`
- 设置 `getApiKey` 回调或环境变量
- -> 详见本文 "自定义 LLM Provider" 章节

### 4. 创建第一个 Extension
```bash
mkdir -p ~/.pi/agent/extensions
```
```typescript
// ~/.pi/agent/extensions/my-first.ts
export default function (pi) {
  pi.on("agent_start", (event, ctx) => {
    console.log("Agent started!");
  });
}
```

### 5. 实现上下文控制（`context` 事件）
- 在 Extension 中注册 `context` 事件 handler
- 识别并过滤不需要的消息
- -> 详见本文 "Skill Scope 化" 章节

### 6. 注册自定义工具
```typescript
const { session } = await createAgentSession({
  customTools: [{
    name: "myTool",
    label: "My Tool",
    description: "Does something useful",
    parameters: Type.Object({ input: Type.String() }),
    execute: async (id, params) => ({
      content: [{ type: "text", text: `Result: ${params.input}` }],
      details: {},
    }),
  }],
});
```

### 7. 创建自定义 Skill
```bash
mkdir -p ~/.pi/agent/skills/my-skill
```
```markdown
<!-- ~/.pi/agent/skills/my-skill/SKILL.md -->
---
name: my-skill
description: Specialized instructions for X task
---
# Instructions
...
```

### 8. 实现 TUI（选择方案）
- 方案 A：Extension UI（最低成本）-> 步骤 4 的基础上添加 `ctx.ui.*` 调用
- 方案 B：RpcClient + pi-tui（完全自定义）-> 详见本文 TUI 复用章节
- 方案 C：独立 pi-tui（零 agent 依赖）

### 9. 实现 Sub-Agent（如需要）
- 简单任务：同进程 `createAgentSession()` + `SessionManager.inMemory()`
- 长任务：`RpcClient` 子进程
- -> 详见本文 "Sub-Agent 实现" 章节

### 10. 配置压缩策略
- 默认参数：`reserveTokens: 16384`, `keepRecentTokens: 20000`
- 自定义：在 `settings.jsonl` 中修改或通过 `session_before_compact` 钩子替换
- -> 详见 [F-context-management.md] 定制压缩策略
