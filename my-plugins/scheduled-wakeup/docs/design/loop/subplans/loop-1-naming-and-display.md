# Subplan loop-1-naming-and-display

父级设计文档：`docs/ver-2.0/detailed-design.md`（Loop 2.0 core）、`docs/script-tasks/detailed-design.md`（script tasks）、`README.md`（命令面）。本子计划不回写新的 architecture.md；契约变更直接同步到上述三份文档（ownership 沿用插件既有结构）。

## 1. 范围

四个已获用户确认的改动：

1. 投递正文精简：prompts 块按本次实际 `shouldWake` 决定是否携带；script 结果块中空栏目（空 `stdout`/`stderr`/`params`、null `signal`/`error`）不打印。
2. name 系统：任务定义新增可选 `name`；创建（AI tool）可携带；`/loop rename` 设置/清除；命令目标解析规则为"精确 ID 优先，其次作用范围内唯一 name"。
3. 列表摘要：`describeTaskContent` 对 prompt 只取第一行、超过 80 字符才截断加 `...`；无 prompt 的脚本任务显示 `运行 <脚本名>` / `运行 <脚本名> 等 N 个脚本`。
4. 结果卡点击区域扩展到正文：fullscreen 下点击标题或正文任意行均可切换展开/收起。

不在范围：legacy TUI 交互（仍走键盘 Expand）、widget 摘要格式（只加 name 显示）、消息重发或 AI 回合触发。

## 2. 契约变更明细

### 2.1 buildWakeUpContent（修改 `src/script-tasks/wake-up-content.ts`）

函数/模块名称：buildWakeUpContent(task: ScriptTask, results: readonly ScriptResult[], shouldWake: boolean): string

前置条件（Requires）：
- task、results 满足既有校验（`docs/script-tasks/detailed-design.md`）
- shouldWake = shouldWakeUp(task.wakeUp, results)（调用方计算的同一值）

后置条件（Ensures）：
- `<prompts>` 块存在当且仅当 shouldWake && task.wakeUp.kind !== "never"；块内为该 kind 的 prompt（escapeMarkup 转义）
- 每个 script 块固定包含：script 头（path、exit-code）、status、cwd、（非 success 时）FAILED 行、闭合 tag
- 仅当有值时打印：params（length > 0）、signal（≠ null）、error（≠ null）、stdout（≠ ""）、stderr（≠ ""）
- 既有安全不变量保持：动态文本全部 escapeMarkup；每 result 恰一个 `<script=`/`</script>` 块

副作用：无。

### 2.2 name 字段（修改 `src/v2/model.ts`、codec、stores、core）

数据结构：TaskInput / TaskDefinition 增加可选字段

字段：
- name: string | undefined — 展示名，trim 后非空才算存在

类型不变量：
- name 为 undefined 或 trim 后非空字符串；创建与 rename 入口统一用 readTaskName 规范化
- name 不参与身份标识：TaskDefinition.id、DefinitionReference、锁键、registration 结构一律不变

唯一性 / 标识：
- 持久层不强制唯一；唯一性只在命令解析时按"当前命令候选集"判定，不唯一则拒绝并列举候选

生命周期：
- 创建：TaskInput.name（AI tool add）→ 定义；slash add/define 不支持内联 name（改用 rename）
- 修改：`/loop rename <target> <new-name...>`、`/loop rename <target> --clear`；session task 改会话状态，shared definition 改 catalog（同 scope 全会话生效）
- 删除：随定义删除；rename --clear 只删 name

兼容性：session snapshot 仍为 version 1，shared catalog 仍为 version 2——name 为可选字段，新旧解析器均容忍。

### 2.3 目标解析（新增 `src/v2/resolve-target.ts`）

接口：命令层 → core

输入数据：target 字符串 + 候选集（由命令种类决定）
输出数据：{ ok: true; id } | { ok: false; message }

协议约定：
- 解析顺序：候选集内精确 ID 匹配优先；否则 name 匹配，唯一则命中，多个则返回 ambiguous 消息（列出 `name [id]`），零个返回 missing
- 候选集：stop/run/defer → 本会话 active 集（session tasks + registrations）；unregister → 本会话 active registrations；register → 指定 scope 的全部 shared definitions；delete（无前缀形式）→ 两 scope 全部 shared definitions；rename → session tasks（含非 active）+ 两 scope shared definitions
- defer 的 target 解析自 parse 起就是单 token（沿用现状）：含空格的 name 不能用于 defer，需用 ID
- AI tool 的 cancel/delete 使用与 slash 相同解析规则

### 2.4 describeTaskContent 摘要（修改 `src/v2/task-content.ts`）

前置：value 为合法 TaskContent。
后置：
- prompt 分支：取第一个 trim 后非空的行，返回该 trim 后的行；长度 > 80 时截为 80 字符加 `...`，否则不截断；不合并多行
- scriptTask 分支：wakeUp 带 prompt（always/on-error）时同样摘要该 prompt；never 时 `运行 <basename(path)>`，多脚本 `运行 <basename(first)> 等 N 个脚本`

### 2.5 列表与 widget 显示（修改 `src/v2/format-list.ts`、`src/loop-widget-items.ts`）

- formatLine 首列：有 name 显示 `name [id]`，否则 id；registration 的 name 取其引用定义的 name，定义不可用时仅 id
- available 列表同规则
- widget 行的 id 段：有 name 时显示 `name · id`

### 2.6 结果卡交互（修改 `src/task-run-renderer.ts`）

- 组件结构：移除标题内层 MouseRegion，将整个 Box 包进单个 MouseRegion；左键 click 切换展开，其余事件返回 undefined（保留拖选/滚动/右键语义）
- global Expand、按消息记忆展开状态、多行标题可点击等既有行为不变
- 仅改展示层，不触发投递或 AI 回合

## 3. 命令面与工具面变更

- `/loop rename <id> <new-name...>`、`/loop rename <id> --clear`（新增 parse 分支与帮助行；target 为单 token）
- `/loop delete <name>` 允许无前缀形式：parse 不再强制前缀，dispatch 时按 2.3 解析（跨两 scope）；带前缀形式行为不变（scope 强制、精确 ID）
- scheduled_wakeup 工具：schema 增加可选 `name`（add）；`id` 描述更新为接受唯一 name（cancel/delete）
- autocomplete：top-level 增加 rename；source 改为 taskLabels/definitionLabels（{id, name?}），补全 value 仍为 id，description 显示 name
- help 文本同步

## 4. 测试计划

- script-content：never/on-error-成功 → 无 prompts 块；空栏目省略、非空保留；恶意分隔与生成文本性质测试迁移到新签名
- task-run-renderer：正文点击收起、padding 行点击切换、右键/滚轮不切换、重建保持
- parse-v2-command：rename 解析（含 --clear、缺参错误）、delete 无前缀形式
- resolve-target：精确 ID 优先、唯一 name 命中、重名拒绝、missing
- v2-core / v2-session-state / v2-shared-delete：name 持久化（session snapshot 与 shared catalog）、rename 往返、跨会话 registration 显示定义 name
- register-v2-tool：add 带 name；cancel/delete 用唯一 name
- describe-task-content：第一行截断规则（80 字符、多行不合并）、运行 X 摘要
- autocomplete：rename 候选、name 作为 description
- widget：name 显示

## 5. 文档同步清单

| 文档 | 改什么 |
|---|---|
| README.md | 结果卡交互、消息内容格式、rename/名称解析、name 字段、列表输出 |
| docs/script-tasks/detailed-design.md | buildWakeUpContent 契约（shouldWake 参数、条件 prompts、空栏目省略）、dispatcher 调用点 |
| docs/ver-2.0/detailed-design.md | name 字段、rename 命令、解析规则、摘要与列表显示、catalog 兼容性声明 |

## 6. 完整性自检

- 推导连续 / 分支覆盖：解析器（ID 命中、name 唯一、重名、缺失）、renderer（click/非 click、展开/收起）分支均显式
- 退出覆盖：rename 目标不存在 → 明确消息；catalog busy → 抛错走既有错误通道
- callee 契约：shouldWake 由 execute-task 的 shouldWakeUp 计算后传入，避免二次计算与口径漂移
- 循环：候选集有限，过滤无递归
- 显式假设：旧版本插件写入的无 name catalog 必须可读（靠可选字段容忍，不 bump version）
