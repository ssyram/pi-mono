# oh-my-pi

Pi 的多 Agent 编排扩展。11 个专业 Agent, 8 类任务路由, 自动续行, 战略规划, 代码规则注入。

## 快速开始

`package.json` 里需要有 pi manifest:

```json
{
  "name": "oh-my-pi",
  "pi": { "extensions": ["index.ts"] }
}
```

加载方式:

```bash
# CLI 参数
pi -e path/to/oh-my-pi

# 或写入 settings (~/.config/pi/settings.json)
{ "extensions": ["~/path-to/oh-my-pi"] }
```

加载后直接用，Sisyphus 通过 hook 自动注入到主 session:

```
> Build a dashboard with charts          # Sisyphus 自动编排
/omp-start Migrate auth to sessions      # Prometheus 规划 + Momus 审查
/omp-consult Should I use monorepo?      # Oracle 咨询
```

## 架构概览

**核心设计**: 主 session 就是 Sisyphus (通过 `before_agent_start` hook 注入 system prompt), 不是 sub-agent。所有其他 agent 都是临时 sub-agent session (`createAgentSession` + `SessionManager.inMemory`), 执行完结果回流主 session。没有 agent 切换, 只有委派。

```
用户输入
  |
  v
[主 Session = Sisyphus]  <-- sisyphus-prompt hook 注入规则/agent列表
  |                       <-- boulder hook 检测未完成任务自动续行
  |
  |-- delegate_task(category) --> 分类路由 --> 选 model + agent --> 后台 session
  |-- call_agent(name)        --> 直接调用 --> 指定 agent --> 后台 session
  |
  |-- /omp-start   --> Prometheus 规划 --> Momus 审查
  |-- /omp-consult --> Oracle 咨询
  |-- /omp-review  --> Momus 审查
  |-- /omp-stop    --> 停止续行 + 取消后台任务
```

## 11 个 Agent

### 主编排 (mode: `primary`) -- 注入主 session, 不作为 sub-agent 调用

| Agent | 模型 | 工具 | 职责 | 文件 |
|-------|------|------|------|------|
| **sisyphus** | opus-4-6 | all | 主编排器, Phase 0-3 意图识别与任务委派 | `agents/sisyphus.ts` |
| **atlas** | sonnet-4-6 | coding | TODO 协调器, 委派实现并验证结果 | `agents/atlas.ts` |

### 辅助 Agent (mode: `subagent`) -- 通过 delegate_task / call_agent 调用

| Agent | 模型 | 工具 | 职责 | 文件 |
|-------|------|------|------|------|
| **oracle** | opus-4-6 | read-only | 架构顾问, 调试与设计咨询 | `agents/oracle.ts` |
| **metis** | opus-4-6 | read-only | 预规划顾问, 识别歧义与失败点 | `agents/metis.ts` |
| **momus** | opus-4-6 | read-only | 方案审查, 验证可执行性 | `agents/momus.ts` |
| **explore** | haiku-4-5 | read-only | 代码库搜索专家 | `agents/explore.ts` |
| **librarian** | haiku-4-5 | all | 外部文档与开源代码搜索 (curl/gh) | `agents/librarian.ts` |
| **multimodal-looker** | sonnet-4-6 | read-only | PDF/图片/图表分析 | `agents/multimodal-looker.ts` |

### 双模式 (mode: `all`) -- 既可主 session 也可 sub-agent

| Agent | 模型 | 工具 | 职责 | 文件 |
|-------|------|------|------|------|
| **hephaestus** | sonnet-4-6 | all | 深度自主工作者, 适合复杂长时间任务 | `agents/hephaestus.ts` |
| **sisyphus-junior** | sonnet-4-6 | all | 通用执行 agent, 8 类路由的默认执行者 | `agents/sisyphus-junior.ts` |

### 内部 (mode: `internal`) -- 仅通过专用命令访问, call_agent 不可调

| Agent | 模型 | 工具 | 职责 | 文件 |
|-------|------|------|------|------|
| **prometheus** | opus-4-6 | read-only | 战略规划器, 多轮访谈式规划 (仅 /omp-start) | `agents/prometheus.ts` |

## 编排流程

### Sisyphus Phase 0-3

Sisyphus 的 system prompt 定义了 4 阶段协议 (详见 `agents/sisyphus.ts`):

> "You are "Sisyphus" - Powerful AI Agent with orchestration capabilities from OhMyPi. **Why Sisyphus?**: Humans roll their boulder every day. So do you."

- **Phase 0 - Intent Gate**: 每条消息先识别意图 (聊天/规划/执行/调研等), 决定路由
- **Phase 1 - Assessment**: 评估任务规模与复杂度
- **Phase 2 - Strategy**: 选择执行策略 (直接做/委派/并行)
- **Phase 3 - Execution**: 执行并追踪完成状态

### delegate_task: 分类路由

`delegate_task(task, category?, agent?, background?)` -- 通过 8 类路由系统选择 model + agent 组合。默认后台执行。

流程: category --> 查 config 得到 model + agent --> 创建 `createAgentSession` --> 通过 `ConcurrencyManager` 提交执行 --> 结果回传。

支持 `session_id` 复用已有 sub-agent session (仅前台模式)。失败自动重试 (最多 10 次)。

实现: `tools/delegate-task.ts`

### call_agent: 直接调用

`call_agent(agent, prompt, background?)` -- 绕过分类路由, 直接按名调用 agent, 使用 agent 自身的 model 配置。

只有 mode 为 `subagent` 或 `all` 的 agent 可被调用。

实现: `tools/call-agent.ts`

### 8 类路由表

| 类别 | 模型 | 默认 Agent | 描述 |
|------|------|-----------|------|
| `visual-engineering` | sonnet-4-6 | sisyphus-junior | 前端/UI 开发 |
| `ultrabrain` | opus-4-6 | sisyphus-junior | 深度逻辑推理 |
| `deep` | sonnet-4-6 | hephaestus | 自主长时间任务 |
| `artistry` | sonnet-4-6 | sisyphus-junior | 创意设计 |
| `quick` | haiku-4-5 | sisyphus-junior | 小任务快速修复 |
| `unspecified-low` | sonnet-4-6 | sisyphus-junior | 中等难度通用 |
| `unspecified-high` | opus-4-6 | sisyphus-junior | 高难度通用 |
| `writing` | sonnet-4-6 | sisyphus-junior | 文档写作 |

每个类别附带专用 prompt append (设计系统工作流、自主执行规则等), 见 `config.ts`。

## 6 个 Tools

| Tool | 作用 | 文件 |
|------|------|------|
| `delegate_task` | 分类路由委派任务, 默认后台 | `tools/delegate-task.ts` |
| `call_agent` | 按名直接调用 agent, 默认后台 | `tools/call-agent.ts` |
| `task` | 任务列表管理 (add/done/expire/list/clear), Boulder 据此判断是否续行 | `tools/task.ts` |
| `background_task` | 查看/取消后台任务 (list/status/cancel) | `tools/background-task.ts` |
| `background_output` | 读取后台任务输出 (summary/full/latest, 可 block 等待) | `tools/background-output.ts` |
| `ast_grep` | AST 感知代码搜索 (需安装 `@ast-grep/cli`, 可选) | `index.ts` |

## 8 个 Hooks

| Hook | 事件 | 作用 | 文件 |
|------|------|------|------|
| **Boulder** | `agent_end` | 有未完成任务时自动续行; 含退避/停滞检测/中断感知/compaction 保护 | `hooks/boulder.ts` |
| **Sisyphus Prompt** | `before_agent_start` | 向主 session 注入代码规则 + agent 列表 | `hooks/sisyphus-prompt.ts` |
| **Keyword Detector** | `before_agent_start` | 检测 ultrawork/search/analyze 关键词, 注入路由提示 | `hooks/keyword-detector.ts` |
| **Comment Checker** | `tool_result` | 检测 `// rest of code...` 等偷懒占位注释, 实时警告 | `hooks/comment-checker.ts` |
| **Context Recovery** | `before_agent_start` | 70% 提醒, 78% 自动 compact, compact 后恢复任务列表 | `hooks/context-recovery.ts` |
| **Rules Injector** | `before_agent_start` | 从 5 个目录加载项目规则 (.md/.mdc), frontmatter glob 匹配, SHA 去重 | `hooks/rules-injector.ts` |
| **Edit Error Recovery** | `tool_result` | 检测 Edit 工具失败, 注入修复提示 (Read first / 加上下文等) | `hooks/edit-error-recovery.ts` |
| **Tool Output Truncator** | `tool_result` | 截断超大工具输出 (>50K 字符) 防止撑爆上下文 | `hooks/tool-output-truncator.ts` |

## 4 个 Commands

| 命令 | 作用 |
|------|------|
| `/omp-start <task>` | 启动 Prometheus 多轮规划访谈, 完成后自动 Momus 审查。Prometheus 可能追问, 结果注入主 session |
| `/omp-consult <question>` | 创建临时 Oracle session 咨询架构/调试问题, 返回结构化分析后销毁 session |
| `/omp-review [plan]` | 用 Momus 审查方案可执行性, 不提供 plan 则从 session 历史提取, 返回 OKAY/REJECT |
| `/omp-stop` | 停止 Boulder 自动续行 + 取消所有排队/运行中的后台任务。发新消息自动恢复 |

## 配置

配置文件位置 (JSONC 格式):
- 项目级: `{cwd}/.pi/oh-my-pi.jsonc`
- 用户级: `~/.pi/oh-my-pi.jsonc`

项目级覆盖用户级, 按字段合并。

```jsonc
{
  // 覆盖分类路由
  "categories": {
    "ultrabrain": { "model": "opus-4-6", "agent": "hephaestus" }
  },
  // 禁用 agent
  "disabled_agents": ["multimodal-looker"],
  // 默认 model fallback
  "default_model": "sonnet-4-6",
  // 开关
  "boulder_enabled": true,
  "sisyphus_rules_enabled": true,
  // 最大并发后台任务
  "max_concurrent_tasks": 5
}
```

`CategoryConfig` 完整字段: `model`, `agent`, `description`, `fallbackModels`, `promptAppend`。见 `config.ts`。

## 未实现: /agent 切换

基础设施已存在但尚未实现。`before_agent_start` hook 可以替换 system prompt, `AgentDef` 有完整的 prompt/model/tool 定义, 理论上可以实现运行时 agent 人格切换 (类似 preset 系统)。当前所有 agent 切换都通过委派完成, 不改变主 session 的身份。
