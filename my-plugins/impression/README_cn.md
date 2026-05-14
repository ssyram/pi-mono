# Impression System

没有人干活要先把工作手册背下来；略读一遍，留下“印象”就开工才是正确做法。Impression System (印象系统) 是一个可即插即用的 [pi](https://github.com/badlogic/pi-mono) 扩展：它会使用当前激活的 LLM，将较长的工具结果压缩成简洁的 impression，并保留原始内容，供后续按需召回。

> 提示：如果同时加载 `docker` 插件，Impression 会把累计的 `[impression:data]` 统计更清晰地展示在 docker 侧边栏里；如果没有 docker，则会自动回退为普通 footer 状态显示。

## 要解决的问题

在长时间编码会话中，工具结果（文件读取、命令输出、搜索结果）会迅速堆积到对话上下文中。大部分内容只会被看一次、理解一次，之后基本不会再引用，但它们依然会持续占用上下文窗口，消耗 token，并分散模型注意力。在一次读取 20 个以上文件的典型会话里，impression system 通常可以将上下文占用降低 40% 到 70%。

## 工作原理

1. **Intercept**：拦截每一个 `tool_result` 事件；当文本长度超过可配置阈值时（默认 2,048 个字符），启动蒸馏。
2. **Distill**：调用当前激活的模型，并使用专门设计的提示词，告诉模型“你正在压缩自己的记忆”。模型会产出一段简短笔记，保留下一步真正需要的信息。
3. **Replace**：用压缩后的 impression 替换原始工具结果。
4. **Recall**：注册一个 `recall_impression` 工具，代理可以按需取回原始内容。首次召回时，模型会结合更新后的上下文重新蒸馏；达到配置的召回次数后，则直接返回完整原文。

`prompts/` 目录中的蒸馏提示词经过专门设计，使模型将这个过程视为“自我压缩”，而不是对第三方内容做摘要。模型会拿到完整的可见历史和 system prompt，因此生成的 impression 具备上下文感知能力。

## 快速开始

### 前置要求

- **Node.js** ≥ 18（包含 npm）
- **Python 3** ≥ 3.9（仅用于安装脚本）
- 至少一个 LLM provider 的 API Key（Anthropic、OpenAI、Google、OpenRouter 等）

### 自动安装

```bash
python3 setup.py
```

安装脚本会完成以下操作：
1. 检查是否已全局安装 pi，如未安装则尝试安装
2. 以交互方式配置 LLM API Key（可跳过）
3. 将当前目录注册为 pi 扩展（可跳过）

支持 **macOS**、**Linux** 和 **Windows**（PowerShell / Git Bash / WSL）。

### 手动安装

#### 1. 安装 pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

#### 2. 设置 API Key

```bash
# 任选一种：
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="AI..."
export OPENROUTER_API_KEY="sk-or-..."
```

#### 3. 安装扩展

```bash
# 在当前目录下执行：
pi install .

# 或在任意目录执行：
pi install /path/to/impression
```

**另一种方式**：不安装，按会话临时加载扩展：

```bash
pi --extension /path/to/impression/index.ts
```

## 项目结构

```text
impression/
├── index.ts                  # 扩展入口（连接事件与工具）
├── src/
│   ├── types.ts              # 接口、类型守卫、常量
│   ├── config.ts             # 配置加载、解析、skip pattern 匹配
│   ├── serialize.ts          # 内容序列化（文本 + 图片）
│   ├── prompt-loader.ts      # 加载并填充 prompt 模板
│   ├── distill.ts            # 蒸馏逻辑（调用 LLM）
│   ├── format-call.ts        # UI：格式化 recall 的工具调用展示
│   └── result-builders.ts    # 构建 impression / passthrough 的工具结果
├── prompts/                                # prompts 全部是 .md
│   ├── distiller-first-person.md           # 蒸馏 system prompt——第一人称变体
│   ├── distiller-third-person.md           # 蒸馏 system prompt——第三人称变体
│   ├── distiller-user-first-person.md      # 蒸馏 user prompt 模板——第一人称
│   ├── distiller-user-third-person.md      # 蒸馏 user prompt 模板——第三人称
│   ├── impression-system-append.md         # 会话启动时追加到 agent system prompt 的内容
│   └── impression-text.md                  # 蒸馏完成后展示给 agent 的模板
├── setup.py                  # 跨平台安装器
└── README.md
```

## 配置

配置是**会话级的**。磁盘文件 `.pi/impression.json` 只在每次会话启动时**读取一次**，作为会话的初始配置。会话中通过 `/impression` 命令做的改动只会写入会话 JSONL 日志，不会回写到 `.pi/impression.json`。这些条目以自定义类型 `customType: "impression-config-v1"` 存储，且**不会发送给 LLM**。

会话最终运行配置 = 磁盘 `loadConfig()` 的结果 → 按顺序叠加会话日志中的全部 `impression-config-v1` patch → 未设置的字段填默认值。

可在项目根目录创建 `.pi/impression.json`（可选，所有字段都有默认值）：

```json
{
  "enabled": true,
  "debug": false,
  "debug:distill-mode": "third-person",
  "skipDistillation": [],
  "minLength": 2048,
  "maxRecallBeforePassthrough": 1,
  "maxPassthroughCount": 2,
  "distillRateFloor": 0.02,
  "showData": false
}
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 总开关。`false` 时所有工具结果不被蒸馏，直接透传。 |
| `debug` | `boolean` | `false` | 开启调试通知与调试用选项。 |
| `debug:distill-mode` | `"first-person" \| "third-person"` | 未设置 | 调试用，强制 distiller 使用某一种 prompt 模式。仅在 `debug: true` 时生效，否则被忽略并给出警告。 |
| `skipDistillation` | `string[]` | `[]` | 永不蒸馏的工具名。每个 pattern 按下列规则匹配：(1) 精确匹配（`"bash"`）；(2) glob——只支持**尾部** `*` 通配（`"background_*"` 匹配以 `background_` 开头的）；(3) 正则——把整个 pattern 用 `/.../` 包起来（如 `"/^read.*_file$/"` 走完整正则语义）。 |
| `minLength` | `number` | `2048` | 触发蒸馏所需的最小文本长度（字符数）。 |
| `maxRecallBeforePassthrough` | `number` | `1` | 切换为完整透传前，召回时返回"重新蒸馏笔记"的最大次数。**`0` 表示每次召回都直接给完整原文** —— 当你希望 agent 在初次蒸馏后总是拿到精确文本时用这个。 |
| `maxPassthroughCount` | `number` | `2` | `skip_impression count=N` 的硬上限。 |
| `distillRateFloor` | `number` | `0.02` | 蒸馏 output 预算的 per-char 系数。蒸馏调用的有效 `max_tokens` = `clamp(originalLength * distillRateFloor, 1024, model.maxTokens \|\| 8192)`。原文越长预算按比例越宽（让笔记可以多写一点），但永远受模型的单次 output 上限封顶（拿不到时用 `8192` fallback）。实际笔记长度由 prompt 里的长度约束控制，**不**由这个数字控制——这只是 safety ceiling。下限：`0`。 |
| `showData` | `boolean` | `false` | 显示每次蒸馏的字符数据，格式为 `[impression:data] XXX / YYY = ZZ%`；其中展示值使用 `k`/`M` 等紧凑格式并保留两位小数，但比例始终基于底层精确字符数计算；底部状态会持续累积显示 `impression / original`。 |

> **数值越界会被告警并截到最小值。** 数值字段的下限：`minLength ≥ 1`、`maxRecallBeforePassthrough ≥ 0`、`maxPassthroughCount ≥ 0`、`distillRateFloor ≥ 0`。低于下限的值（无论来自文件、会话日志重放还是 `/impression set`）会被截到下限，并通过 `ctx.ui.notify` 发出 warning。`.pi/impression.json` 的 JSON 解析错误也会在 session 启动时作为 warning 浮出，并把该文件忽略。

> **成本说明。** 每次蒸馏都会调用 agent 当前正在用的同一个 provider/model，input 是 agent 的 system prompt + 可见消息历史 + 工具结果。Recall 重蒸馏也是同样的开销。在工具结果普遍较长的长会话里，这相当于 token 成本翻倍（每个长 tool result 都多一次往返）。
>
> 蒸馏请求的 `max_tokens` 预算 = `clamp(originalLength * distillRateFloor, 1024, model.maxTokens || 8192)`。模型单次 output 上限封顶（拿不到时 8192 fallback），per-char 系数让预算随输入扩大，1024 floor 保证小输入下模型也有空间。实际笔记长度由 prompt 约束控制，公式只是 safety ceiling。
>
> **单位说明。** `originalLength * distillRateFloor` 左边是 chars，结果当 tokens 用。英文 1 token ≈ 4 chars，所以默认 `distillRateFloor=0.02` 实际对应约 8% 的 output/input token 比。这个混用单位只在 ~50K-400K chars 的输入区间影响显著，区间外要么 floor 主导要么 cap 主导。
>
> **三条防线**确保蒸馏不会出问题：
> 1. **截断保护**（`src/distill.ts`）：LLM API 返回 `stopReason === "length"` 时——也就是 `max_tokens` 把模型截了——插件自动 fallback 到 passthrough，不会把残缺笔记塞给 agent。防 max_tokens 设小了。
> 2. **长度膨胀保护**（`src/distill.ts`）：`strippedText.length >= contentText.length` 时插件自动 passthrough。防"笔记反而比原文长"这种丧失意义的情况。
> 3. **预算公式**：上面的 `clamp` 把 `max_tokens` 锁在 1024 和模型单次 output 上限之间。

> 在会话运行期间编辑 `.pi/impression.json` **不会立即生效** —— 只有未来的会话才会重新读取它。要把当前磁盘内容拉进运行中的会话，使用 `/impression load`。

### `/impression` 命令

所有子命令和 `--persistent` 都不区分大小写。

| 命令 | 行为 |
|---|---|
| `/impression` *(或)* `/impression config` / `print` / `read` | 打印当前会话的最终生效配置（JSON）。 |
| `/impression help` / `-h` / `--help` / `?` | 显示命令帮助。 |
| `/impression on` | 等价于 `set Enabled true`。 |
| `/impression off` | 等价于 `set Enabled false`。 |
| `/impression load` | 重新读取 `.pi/impression.json`，并把内容作为 patch 叠加到当前会话。 |
| `/impression set [--persistent] NAME VALUE` | 在当前会话中设置某一字段。`VALUE` 按 JSON 解析并按字段类型校验。带 `--persistent` 时还会把改动写回 `.pi/impression.json`（**后台异步**写入，失败会通过 warning 通知）。 |
| `/impression tool1,tool2,...` | 简写：把列出的工具名追加到本会话的 `SkipDistillation`。**必须带逗号**（或用引号），单个裸词被视为未知子命令。 |

**字段名匹配**：`NAME` 大小写、分隔符不敏感。匹配方法是：lowercase 并去掉所有非字母数字字符，然后既比对 JSON 文件键也比对 PascalCase 显示名。`MaxRecall` / `maxRecall` / `max-recall` / `max_recall` / `"max recall"` / `max:recall` / `maxrecall` / `maxRecallBeforePassthrough` 都解析到同一字段。显示名（用于通知和帮助文本）一律 PascalCase：`Enabled`、`Debug`、`ShowData`、`MinLength`、`MaxRecall`、`MaxPassthroughCount`、`SkipDistillation`、`DebugDistillMode`。

**值类型校验**：`enabled` / `debug` / `showData` → 布尔；长度 / 比例字段 → 有限数字；`skipDistillation` → 字符串数组的 JSON 字面量（例：`["read","write"]`）；`debug:distill-mode` → `"first-person"` 或 `"third-person"`。类型不匹配直接拒绝并给出原因。

> 未知子命令会打印 warning 并附上完整命令帮助，不会静默吞下拼错的命令。

> `/impression load` 在被调用的瞬间把磁盘文件内容作为 patch 快照写入会话。之后再编辑 `.pi/impression.json` **不会**影响当前运行中的会话——需要重新运行 `/impression load` 才能刷新。

### Agent 可见工具

插件向 LLM 注册了三个工具：

| 工具 | 用途 |
|---|---|
| `recall_impression` | 通过 id 重新获取已存的 impression。返回"重新蒸馏的笔记"（当 `recallCount < maxRecall`）或"完整原文"（passthrough）。完整原文一旦被投递过一次，该 impression 会被打上 `delivered` 标记并清空其内部存储；之后再用同一个 id 调用会报错（原文已经在 LLM 的消息历史里了）。 |
| `skip_impression` | 告诉插件把接下来 N 个 tool result 原样透传（上限 `maxPassthroughCount`）。需要 `count` / `justification` / `estimatedChars`；实际内容超限时透传会被拒（但该次内容仍会以新 id 存为 impression，方便用 `save_impression` 取回）。`count=0` 取消透传。 |
| `save_impression` | 把某个 impression 的原文写到 `.pi/impression-cache/<id>.txt`，供 `read`/`bash`/`python` 检视。路径固定，agent 不能选目的地——这就把文件写入限制在项目内部，杜绝任意路径写盘。 |

## 使用效果

### 启用后会看到什么

- **状态栏** 会在压缩过程中显示 `[impression] Distilling N chars with provider/model...`
- 对被跳过的结果会显示 **通知**（例如内容太短、命中跳过列表、发生错误）
- **工具结果** 会被替换为 `🧠 [MY INTERNAL MEMORY | ID: ...]` 这类格式
- 代理工具列表中会出现 **`recall_impression` 工具**
- 如果加载了 **`docker` 插件**，累计的 **`[impression:data]`** 会展示在 docker 中；否则继续显示在 footer 里

### 正常工作时的表现

- 代理在读取大文件后仍能流畅继续工作
- 长会话中每轮消耗的 token 更少
- 当代理确实需要精确原文时（例如编辑前），会调用 `recall_impression`，并取回正确内容
- 蒸馏后的笔记明显短于原文，但仍保留关键细节

### 调优建议

- 如果代理总是立刻召回：提高 `minLength`
- 如果关键细节丢失：将 `maxRecallBeforePassthrough` 调低到 `0`，或把对应工具加入 `skipDistillation`
- 如果蒸馏太慢：提高 `minLength`，减少蒸馏频率

## 自定义提示词

所有 prompt 都以 Markdown 文件形式存放在 `prompts/` 目录中，可以直接编辑以调整蒸馏行为。蒸馏 prompt 有 `first-person` / `third-person` 两个变体，运行时根据活动模型自动选择（或在 `debug: true` 时通过 `debug:distill-mode` 强制指定）。

**模板变量**（运行时替换）：

| 文件 | 加载方 | 变量 |
|---|---|---|
| `distiller-first-person.md` | `getDistillerSystemPrompt("first-person")` | `{{contentLength}}`、`{{lengthNote}}`、`{{sentinel}}` |
| `distiller-third-person.md` | `getDistillerSystemPrompt("third-person")` | `{{contentLength}}`、`{{lengthNote}}`、`{{sentinel}}` |
| `distiller-user-first-person.md` | `getDistillerUserTemplate("first-person")` | `{{originalSystemPrompt}}`、`{{visibleHistory}}`、`{{toolName}}`、`{{toolResult}}` |
| `distiller-user-third-person.md` | `getDistillerUserTemplate("third-person")` | `{{originalSystemPrompt}}`、`{{visibleHistory}}`、`{{toolName}}`、`{{toolResult}}` |
| `impression-text.md` | `getImpressionTextTemplate()` | `{{id}}`、`{{note}}` |
| `impression-system-append.md` | `getImpressionSystemAppendTemplate()` | _（无——在会话启动时原样追加到 agent system prompt 末尾）_ |

## 依赖

除 pi 已内置的内容外，无需额外依赖：

- `@mariozechner/pi-ai`
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`

## 许可证

MIT