# oh-my-pi-v2 完整安装指南（含 nicobailon 生态）

## omp-v2 的外部依赖

omp-v2 不是一个自包含的插件。它假设了以下外部组件的存在：

| 组件 | 必要性 | 用途 |
|------|--------|------|
| **[pi-subagents](https://github.com/nicobailon/pi-subagents)** | **必需** | 提供 `subagent()` tool，omp-v2 的整个委派逻辑都依赖它 |
| **Agent 定义文件安装到正确位置** | **必需** | omp-v2 的 `agents/*.md` 需要被 pi-subagents 发现 |
| **[pi-web-access](https://github.com/nicobailon/pi-web-access)** | **推荐** | 提供 web_search/fetch_content 工具 + 内置 librarian 研究流程，被 pi-subagents 用于研究类 agent |
| **[pi-intercom](https://github.com/nicobailon/pi-intercom)** | 推荐 | session 间直接通信，被 pi-subagents 用于桥接 session |
| **comment-checker 二进制** | 可选 | AST 级注释检测，缺少时退化为正则 |
| **ast-grep (sg)** | 可选 | 结构化代码搜索，缺少时静默跳过 |
| **Node.js >= 21.9** | 必需 | `path.matchesGlob` 用于规则注入器 |

---

## 运行语义

- Boulder 只会在存在 **actionable tasks** 时自动续跑：`in_progress` 任务 + ready/unblocked 的 `pending` 任务。
- 只有 blocked `pending` 任务时不会触发 Boulder 续跑、active prompt 注入或 compaction task context。
- Esc 只取消当前一次 Boulder countdown；不会创建持久 stop latch。
- 当前命令集：`/omp-start`、`/omp-consult`、`/omp-review`。没有 `/omp-stop`。

---

## 完整安装步骤

### Step 0: 前置条件

```bash
# 确认 Node.js 版本 >= 21.9
node -v  # 应该显示 v21.9+ 或更高

# 克隆仓库（外人从零开始）
git clone <pi-mono-repo-url>
cd pi-mono
npm install
```

### Step 1: 安装 pi-subagents（必需）

这是 omp-v2 最核心的依赖。没有它，Sisyphus 的 `subagent()` 委派全部失效。

```bash
pi install npm:pi-subagents
```

> **注意**：monorepo 内有一个 `packages/coding-agent/examples/extensions/subagent/`，这是 pi 框架自带的示例版本。nicobailon 的 `pi-subagents` 是独立的增强版，功能更完整（支持异步、并行、链式、session 共享）。**两者注册同名 tool (`subagent`)，不能同时启用。** 用 `pi install` 安装 nicobailon 版本即可，不要再 symlink 示例版。

### Step 2: 安装 omp-v2 本体

```bash
ln -s ../../my-plugins/oh-my-pi-v2 .pi/extensions/oh-my-pi-v2
```

### Step 3: 安装 agent 定义

pi-subagents 从以下位置发现 agent：
- **项目级**：`.pi/agents/`（优先）
- **用户级**：`~/.pi/agent/agents/`
- **内置**：pi-subagents 自带的 `agents/`（scout, worker, planner, reviewer）

omp-v2 提供的 agent（explore, oracle, librarian, prometheus, momus 等）需要放到 pi-subagents 能扫描的地方：

```bash
# 项目级（推荐 — 仅当前项目）
ln -s ../my-plugins/oh-my-pi-v2/agents .pi/agents
```

同名 agent 时**项目级优先于内置**，所以 omp-v2 的 agent 定义会覆盖 pi-subagents 自带的同名 agent。

### Step 4: 删除 v1（如果存在）

```bash
rm -f .pi/extensions/oh-my-pi
```

### Step 5:（推荐）安装 nicobailon 的配套扩展

pi-subagents 文档说它依赖 `pi-web-access`（研究工具）和 `pi-intercom`（session 间通信）。装上能让子 agent 的研究能力更强：

```bash
# web 搜索和内容抓取（librarian agent 需要）
pi install npm:pi-web-access

# session 间通信（多 agent 协作需要）
pi install npm:pi-intercom
```

### Step 6:（可选）其他有用的 nicobailon 扩展

同一作者的其他扩展，全部兼容，按需安装：

```bash
# 交互式 shell 控制（让 agent 操作 psql、docker 等交互式 CLI）
pi install npm:pi-interactive-shell

# MCP 协议适配器（让 pi 使用 MCP servers）
pi install npm:pi-mcp-adapter

# token 高效的自主任务执行（长任务自动压缩上下文）
pi install npm:pi-boomerang

# Powerline 风格状态栏
pi install npm:pi-powerline-footer
```

### Step 7:（可选）安装 comment-checker 和 ast-grep

```bash
# AST 级注释检测（推荐）
npm install -g @code-yeongyu/comment-checker

# 结构化代码搜索（可选）
brew install ast-grep  # macOS
# 或 npm install -g @ast-grep/cli
```

---

## 外人从零开始的一键脚本

```bash
git clone <pi-mono-repo-url>
cd pi-mono
npm install

# 必需
pi install npm:pi-subagents
ln -s ../../my-plugins/oh-my-pi-v2 .pi/extensions/oh-my-pi-v2
ln -s ../my-plugins/oh-my-pi-v2/agents .pi/agents
rm -f .pi/extensions/oh-my-pi

# 推荐
pi install npm:pi-web-access
pi install npm:pi-intercom

# 验证
pi  # 启动后测试 task/subagent 调用，以及 Esc 可单次取消 Boulder countdown
```

---

## nicobailon 生态全景

| 扩展 | 安装命令 | 与 omp-v2 的关系 |
|------|----------|-----------------|
| **[pi-subagents](https://github.com/nicobailon/pi-subagents)** | `pi install npm:pi-subagents` | **必需** — 提供 subagent() tool |
| **[pi-web-access](https://github.com/nicobailon/pi-web-access)** | `pi install npm:pi-web-access` | **推荐** — librarian agent 的研究能力依赖此 |
| **[pi-intercom](https://github.com/nicobailon/pi-intercom)** | `pi install npm:pi-intercom` | **推荐** — pi-subagents 的 session 桥接依赖此 |
| [pi-interactive-shell](https://github.com/nicobailon/pi-interactive-shell) | `pi install npm:pi-interactive-shell` | 可选 — 交互式 CLI（psql, docker 等） |
| [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) | `pi install npm:pi-mcp-adapter` | 可选 — MCP 协议支持 |
| [pi-boomerang](https://github.com/nicobailon/pi-boomerang) | `pi install npm:pi-boomerang` | 可选 — token 高效的长任务执行 |
| [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) | `pi install npm:pi-powerline-footer` | 可选 — 状态栏美化 |
| [pi-messenger](https://github.com/nicobailon/pi-messenger) | `pi install npm:pi-messenger` | 可选 — 文件系统级多 agent 协调 |
| [pi-interview-tool](https://github.com/nicobailon/pi-interview-tool) | `pi install npm:pi-interview-tool` | 可选 — web 表单输入替代对话 |

所有扩展互相独立安装，通过 pi 的扩展系统自动发现。同一作者，API 风格一致，全部兼容。
