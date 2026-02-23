# A - 核心运行时

## 概述

pi-mono 的核心运行时分为两层：底层 `@mariozechner/pi-ai` 提供 LLM provider 抽象、流式调用和模型注册；上层 `@mariozechner/pi-agent-core` 在此基础上构建有状态的 Agent 类，包含工具执行循环、事件发布、steering/follow-up 队列机制。整体架构是经典的 **事件驱动状态机 + 异步迭代器流** 模式，Agent 类管理外部状态和用户交互，agent-loop 负责内部的 LLM 调用 -> 工具执行 -> 再调用循环。

## 文件树

```
packages/agent/
  src/
    agent.ts          # Agent 类：状态管理、prompt/continue/subscribe 入口
    agent-loop.ts     # 核心循环：agentLoop / agentLoopContinue / runLoop
    types.ts          # AgentMessage, AgentTool, AgentEvent, AgentState 等类型
    proxy.ts          # streamProxy：代理模式流式调用（通过中间服务器转发）
    index.ts          # 包导出

packages/ai/
  src/
    stream.ts         # stream / streamSimple / complete / completeSimple 入口
    types.ts          # Model, Api, Provider, Message, Tool, Usage 等核心类型
    api-registry.ts   # registerApiProvider / getApiProvider 注册中心
    models.ts         # getModel / calculateCost 模型注册表
    models.generated.ts  # 自动生成的模型定义（所有内置 provider 的模型列表）
    env-api-keys.ts   # getEnvApiKey：环境变量 API key 解析
    providers/
      register-builtins.ts  # 9 个内置 API provider 的注册
      anthropic.ts          # Anthropic provider 实现（含 OAuth/Copilot 支持）
      openai-completions.ts # OpenAI Completions API
      openai-responses.ts   # OpenAI Responses API
      google.ts             # Google Generative AI
      amazon-bedrock.ts     # AWS Bedrock
      simple-options.ts     # 通用选项构建工具
      transform-messages.ts # 跨 provider 消息格式转换
      ...（其他 provider）
    utils/
      event-stream.ts    # EventStream<T,R>：通用异步迭代器事件流
      json-parse.ts      # 流式 JSON 增量解析
      ...
```

## 核心流程

### Agent 状态机

**入口函数：**

1. `prompt()` @ `packages/agent/src/agent.ts:336`
   - 接受 `string | AgentMessage | AgentMessage[]` 输入
   - 守卫：若 `isStreaming === true` 则抛错，防止并发调用
   - 将输入规范化为 `AgentMessage[]`，调用 `_runLoop(msgs)`

2. `continue()` @ `packages/agent/src/agent.ts:372`
   - 从当前上下文继续（用于重试或处理排队消息）
   - 若最后一条消息是 assistant，先尝试出队 steering 消息，再尝试 follow-up 消息
   - 否则调用 `_runLoop(undefined)` 从现有上下文继续

3. `subscribe()` @ `packages/agent/src/agent.ts:202`
   - 注册 `(e: AgentEvent) => void` 监听器
   - 返回取消订阅函数（闭包删除 listener）
   - 事件在 `_runLoop` 的 `for await` 循环中同步分发

4. `steer()` @ `packages/agent/src/agent.ts:252`
   - 将消息压入 `steeringQueue`，在工具执行间隙被消费
   - 效果：中断当前工具序列，将 steering 消息注入对话

5. `followUp()` @ `packages/agent/src/agent.ts:260`
   - 将消息压入 `followUpQueue`，在 agent 即将停止时被消费
   - 效果：在 agent 完成当前任务后继续新一轮对话

**_runLoop() 核心方法** @ `packages/agent/src/agent.ts:405`

调用链：
```
prompt(input) / continue()
  → _runLoop(messages?, options?)
    → 创建 AbortController 和 AgentContext
    → 构建 AgentLoopConfig（含 getSteeringMessages / getFollowUpMessages 回调）
    → 调用 agentLoop() 或 agentLoopContinue()
    → for await (event of stream)
      → 根据 event.type 更新内部状态
      → emit(event) 分发给所有 listeners
    → finally: 清理 isStreaming / pendingToolCalls / abortController
```

**状态转换图：**
```
idle (isStreaming=false)
  → prompt() / continue()
    → streaming (isStreaming=true)
      → message_start: streamMessage = partial
      → message_update: streamMessage = partial（流式更新）
      → message_end: streamMessage = null, messages.push(final)
      → tool_execution_start: pendingToolCalls.add(id)
      → tool_execution_end: pendingToolCalls.delete(id)
      → turn_end: 检查 error
      → agent_end: isStreaming = false
    → idle
```

### Agent Loop

**入口函数：**

1. `agentLoop()` @ `packages/agent/src/agent-loop.ts:28`
   - 新对话轮次：将 prompt 消息加入上下文，推送 agent_start + turn_start 事件
   - 调用 `runLoop()`

2. `agentLoopContinue()` @ `packages/agent/src/agent-loop.ts:65`
   - 继续已有上下文（重试/恢复）
   - 校验：上下文非空且最后一条消息不是 assistant
   - 调用 `runLoop()`

两者都返回 `EventStream<AgentEvent, AgentMessage[]>` —— 异步可迭代事件流。

**runLoop() 主循环** @ `packages/agent/src/agent-loop.ts:104`

```
外层 while(true):  ← follow-up 消息驱动
  内层 while(hasMoreToolCalls || pendingMessages.length > 0):  ← 工具调用循环
    1. 处理 pending messages（steering/follow-up）→ 注入上下文
    2. streamAssistantResponse() → LLM 流式调用
    3. 若 stopReason = error/aborted → 推送 turn_end + agent_end → 返回
    4. 检查 toolCalls：
       - 有 → executeToolCalls() → 结果加入上下文
       - 无 → 退出内层循环
    5. 推送 turn_end
    6. 检查 steering 消息（工具执行后/turn 完成后）

  检查 follow-up 消息：
    - 有 → 设为 pendingMessages，continue 外层循环
    - 无 → break，推送 agent_end，结束
```

**streamAssistantResponse()** @ `packages/agent/src/agent-loop.ts:204`

调用链：
```
messages
  → transformContext(messages, signal)    [可选，AgentMessage[] → AgentMessage[]]
  → convertToLlm(messages)               [AgentMessage[] → Message[]]
  → 构建 LLM Context { systemPrompt, messages, tools }
  → 解析 API key（支持动态 getApiKey）
  → streamFn(model, context, options)     [调用 provider 流式接口]
  → for await (event of response):
      start       → message_start
      *_delta     → message_update（含 assistantMessageEvent）
      done/error  → message_end + 返回 finalMessage
```

**executeToolCalls()** @ `packages/agent/src/agent-loop.ts:294`

```
for each toolCall in assistantMessage.content:
  1. 查找匹配的 AgentTool
  2. 推送 tool_execution_start
  3. validateToolArguments(tool, toolCall) → TypeBox schema 验证
  4. tool.execute(id, args, signal, onUpdate) → 执行工具
     - onUpdate 回调 → 推送 tool_execution_update
  5. 推送 tool_execution_end
  6. 构建 ToolResultMessage → 推送 message_start + message_end
  7. 检查 steering 消息：
     - 有 → 跳过剩余工具（skipToolCall），返回
     - 无 → 继续下一个工具
```

关键分支点：
- **Steering 中断** @ `agent-loop.ts:364`：每执行完一个工具就检查 steering 队列，若有消息则跳过剩余工具调用
- **Follow-up 续行** @ `agent-loop.ts:185`：agent 即将停止时检查 follow-up 队列，有则继续循环
- **错误/中断退出** @ `agent-loop.ts:144`：stopReason 为 error/aborted 时立即结束

### LLM 流式接口

**入口函数：** `streamSimple()` @ `packages/ai/src/stream.ts:44`

调用链：
```
streamSimple(model, context, options)
  → resolveApiProvider(model.api)    [从注册表查找 provider]
  → provider.streamSimple(model, context, options)
  → 返回 AssistantMessageEventStream（EventStream<AssistantMessageEvent, AssistantMessage>）
```

还有 `stream()` / `complete()` / `completeSimple()` 变体，分别提供底层 stream 控制和非流式调用。

**EventStream<T, R>** @ `packages/ai/src/utils/event-stream.ts:4`

通用异步迭代器实现，特性：
- **push/pull 双模式**：producer push 事件，consumer 通过 `for await` pull
- **完成检测**：通过 `isComplete` 回调判断流结束（如 `event.type === "done" || event.type === "error"`）
- **结果提取**：`result()` 返回 Promise，在流完成时 resolve（如最终的 AssistantMessage）
- **背压处理**：无显式背压控制，事件堆积在内部队列中

### Provider 注册

**注册中心：** `api-registry.ts`

核心 API：
- `registerApiProvider(provider, sourceId?)` @ `api-registry.ts:66` —— 注册 provider
- `getApiProvider(api)` @ `api-registry.ts:80` —— 按 API 名称查找
- `unregisterApiProviders(sourceId)` @ `api-registry.ts:88` —— 按来源 ID 批量卸载
- `clearApiProviders()` @ `api-registry.ts:96` —— 清空全部

注册表结构：`Map<Api, { provider: ApiProviderInternal, sourceId?: string }>`

**内置 Provider 注册** @ `packages/ai/src/providers/register-builtins.ts`

9 个内置 API provider 在模块加载时自动注册（第 73 行 `registerBuiltInApiProviders()`）：

| API 名称 | Provider |
|----------|----------|
| `anthropic-messages` | Anthropic Claude |
| `openai-completions` | OpenAI Chat Completions |
| `openai-responses` | OpenAI Responses |
| `azure-openai-responses` | Azure OpenAI |
| `openai-codex-responses` | OpenAI Codex |
| `google-generative-ai` | Google Gemini |
| `google-gemini-cli` | Gemini CLI |
| `google-vertex` | Vertex AI |
| `bedrock-converse-stream` | Amazon Bedrock |

**Anthropic Provider 实现** @ `packages/ai/src/providers/anthropic.ts`

三种认证模式（`createClient()` @ `anthropic.ts:486`）：
1. **API Key** (`ANTHROPIC_API_KEY`)：标准认证
2. **OAuth Token** (`sk-ant-oat` 前缀)：注入 Claude Code 身份头
3. **GitHub Copilot** (`github-copilot` provider)：Bearer auth + 动态 headers

特色功能：
- **Claude Code 隐身模式** @ `anthropic.ts:64-101`：OAuth 模式下将工具名映射为 Claude Code 标准命名（如 `read` → `Read`），伪装为 Claude Code 客户端
- **自适应思考** @ `anthropic.ts:416-419`：Opus 4.6+ 使用 `thinking: { type: "adaptive" }` + effort 级别
- **预算思考** @ `anthropic.ts:467-479`：旧模型使用 `thinking: { type: "enabled", budget_tokens: N }`
- **缓存控制** @ `anthropic.ts:39-62`：支持 ephemeral 缓存，Anthropic API 可设 1h TTL

## 关键类型/接口

### 1. `AgentState` @ `packages/agent/src/types.ts:134`
Agent 完整状态快照。
```typescript
interface AgentState {
  systemPrompt: string;        // 系统提示
  model: Model<any>;           // 当前模型
  thinkingLevel: ThinkingLevel; // off | minimal | low | medium | high | xhigh
  tools: AgentTool<any>[];     // 已注册工具
  messages: AgentMessage[];    // 完整对话历史
  isStreaming: boolean;        // 是否正在流式调用
  streamMessage: AgentMessage | null; // 当前流式消息（partial）
  pendingToolCalls: Set<string>;      // 正在执行的工具 ID
  error?: string;              // 最近的错误消息
}
```

### 2. `AgentMessage` @ `packages/agent/src/types.ts:129`
可扩展的消息类型联合。
```typescript
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
// Message = UserMessage | AssistantMessage | ToolResultMessage
// CustomAgentMessages 通过 declaration merging 扩展
```

### 3. `AgentTool<TParameters, TDetails>` @ `packages/agent/src/types.ts:157`
工具定义（扩展了 pi-ai 的 Tool）。
```typescript
interface AgentTool<TParameters extends TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;    // UI 显示名
  execute: (
    toolCallId: string,
    params: Static<TParameters>,   // TypeBox 静态推导的参数类型
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,  // 增量结果回调
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### 4. `AgentEvent` @ `packages/agent/src/types.ts:179`
Agent 事件类型联合，共 8 种事件：
- `agent_start` / `agent_end` —— agent 生命周期
- `turn_start` / `turn_end` —— 每轮（一次 assistant 响应 + 工具执行）
- `message_start` / `message_update` / `message_end` —— 消息流式生命周期
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` —— 工具执行生命周期

### 5. `AgentLoopConfig` @ `packages/agent/src/types.ts:22`
Agent 循环配置（扩展 SimpleStreamOptions）。
```typescript
interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
}
```

### 6. `Model<TApi>` @ `packages/ai/src/types.ts:285`
模型定义。
```typescript
interface Model<TApi extends Api> {
  id: string;           // 如 "claude-sonnet-4-20250514"
  name: string;         // 如 "Claude Sonnet 4"
  api: TApi;            // API 类型，如 "anthropic-messages"
  provider: Provider;   // 如 "anthropic"
  baseUrl: string;      // API 端点
  reasoning: boolean;   // 是否支持推理/思考
  input: ("text" | "image")[];  // 支持的输入类型
  cost: { input, output, cacheRead, cacheWrite: number }; // $/百万 tokens
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;  // 自定义 HTTP 头
  compat?: OpenAICompletionsCompat | OpenAIResponsesCompat; // 兼容性覆盖
}
```

### 7. `ApiProvider<TApi, TOptions>` @ `packages/ai/src/api-registry.ts:23`
Provider 接口。
```typescript
interface ApiProvider<TApi extends Api, TOptions extends StreamOptions> {
  api: TApi;                                          // API 类型标识
  stream: StreamFunction<TApi, TOptions>;             // 底层流式调用
  streamSimple: StreamFunction<TApi, SimpleStreamOptions>; // 简化流式调用
}
```

### 8. `EventStream<T, R>` @ `packages/ai/src/utils/event-stream.ts:4`
通用异步事件流。
```typescript
class EventStream<T, R> implements AsyncIterable<T> {
  push(event: T): void;        // 生产者推送事件
  end(result?: R): void;       // 结束流
  result(): Promise<R>;        // 获取最终结果
  [Symbol.asyncIterator](): AsyncIterator<T>; // 消费者异步迭代
}
```

### 9. `StreamFn` @ `packages/agent/src/types.ts:15`
Agent 自定义流式函数签名。
```typescript
type StreamFn = (
  ...args: Parameters<typeof streamSimple>
) => ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>>;
```

### 10. `AssistantMessageEvent` @ `packages/ai/src/types.ts:208`
LLM 流式响应事件联合（12 种）：
`start` | `text_start/delta/end` | `thinking_start/delta/end` | `toolcall_start/delta/end` | `done` | `error`

## 与其他 Domain 的接口

### 向外暴露

1. **Agent 类** — 主要面向 UI/应用层消费
   - `prompt()` / `continue()` / `abort()` / `reset()` —— 控制接口
   - `subscribe()` —— 事件订阅（UI 渲染驱动）
   - `steer()` / `followUp()` —— 运行时消息注入
   - `state` getter —— 只读状态快照

2. **streamSimple() / stream()** — 直接 LLM 调用（不需要 Agent 状态管理时）

3. **registerApiProvider()** — 插件/扩展注册自定义 provider

4. **getModel() / getModels() / getProviders()** — 模型发现

5. **AgentTool 接口** — 工具注册（需实现 `execute` 方法）

6. **CustomAgentMessages** — 通过 TypeScript declaration merging 扩展消息类型

### 被消费

- 上层 UI（coding-agent / web-ui）消费 Agent 类
- 插件系统通过 `AgentTool` 注册工具
- 配置系统通过 `AgentOptions.initialState` 设置模型/提示
- 代理模式通过 `streamFn` 替换为 `streamProxy`

## 开发指南：自定义 LLM Provider

### 方式一：使用已有 API（推荐 OpenAI 兼容）

大部分自定义 provider 兼容 OpenAI Completions 或 Responses API，只需构建 Model 对象：

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

// 定义自定义模型
const myModel: Model<"openai-completions"> = {
  id: "my-custom-model",
  name: "My Custom Model",
  api: "openai-completions",          // 使用 OpenAI Completions API 协议
  provider: "my-provider",            // 自定义 provider 标识
  baseUrl: "https://my-api.example.com/v1",  // 自定义 API 端点
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
  headers: {                          // 可选：自定义请求头
    "X-Custom-Header": "value",
  },
  compat: {                           // 可选：兼容性覆盖
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
  },
};

// 使用
const agent = new Agent({
  initialState: {
    model: myModel,
    systemPrompt: "...",
  },
  getApiKey: async (provider) => {
    if (provider === "my-provider") return "my-api-key";
    return undefined;
  },
});
```

**API Key 配置方式（优先级从高到低）：**

1. `AgentOptions.getApiKey` 回调 —— 动态解析，支持 token 刷新
2. `StreamOptions.apiKey` —— 每次调用指定
3. `getEnvApiKey(provider)` —— 环境变量自动匹配（内置 provider 才有）

### 方式二：注册全新 API Provider

若 API 不兼容任何已有协议，需实现并注册自定义 provider：

```typescript
import {
  registerApiProvider,
  AssistantMessageEventStream,
  type Model,
  type Context,
  type StreamOptions,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";

// 1. 定义自定义 API 名称
type MyApi = "my-custom-api";

// 2. 实现 stream 函数
function myStream(
  model: Model<MyApi>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();

  (async () => {
    // 构建请求、调用 API、解析响应
    // 推送事件到 stream：
    // stream.push({ type: "start", partial: ... });
    // stream.push({ type: "text_delta", ... });
    // stream.push({ type: "done", reason: "stop", message: ... });
    // stream.end();
  })();

  return stream;
}

// 3. 实现 streamSimple（处理 reasoning 映射）
function myStreamSimple(
  model: Model<MyApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  // 将 options.reasoning 映射为 provider 特有参数
  return myStream(model, context, { ...options });
}

// 4. 注册
registerApiProvider({
  api: "my-custom-api" as MyApi,
  stream: myStream,
  streamSimple: myStreamSimple,
}, "my-extension");  // sourceId 用于批量卸载

// 5. 使用
const model: Model<MyApi> = {
  id: "custom-model-v1",
  name: "Custom Model",
  api: "my-custom-api" as MyApi,
  provider: "custom",
  baseUrl: "https://api.example.com",
  // ...其他字段
};
```

### 方式三：代理模式（通过中间服务器）

使用 `streamProxy` 将 LLM 调用路由到代理服务器：

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { streamProxy } from "@mariozechner/pi-agent-core";

const agent = new Agent({
  streamFn: (model, context, options) =>
    streamProxy(model, context, {
      ...options,
      authToken: "my-auth-token",
      proxyUrl: "https://genai.example.com",
    }),
});
```

代理服务器需实现 `POST /api/stream` 端点，接收 `{ model, context, options }` 并返回 SSE 流，事件格式为 `ProxyAssistantMessageEvent`（@ `proxy.ts:36`）。

### 环境变量 API Key 映射

内置 provider 的环境变量映射（@ `env-api-keys.ts`）：

| Provider | 环境变量 |
|----------|---------|
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN` > `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `github-copilot` | `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `huggingface` | `HF_TOKEN` |
| `amazon-bedrock` | AWS 标准凭证链（profile/IAM keys/ECS/IRSA） |
| `google-vertex` | GCloud ADC（`gcloud auth application-default login`） |
