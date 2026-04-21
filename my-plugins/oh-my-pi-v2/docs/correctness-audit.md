# oh-my-pi-v2 正确性审计报告

## 这份报告说了什么

我们对 oh-my-pi-v2 插件（25 个 TypeScript 源文件）进行了多轮自动化正确性审计。每轮派出 4 个独立审计员从不同角度检查代码，发现问题就修，修完再检，直到没有新问题。一共跑了 6 轮才收敛，共修复 20 个问题。

以下是我们**实际检查了什么**、**证明了什么**、以及**不能保证什么**。

---

## 一、任务系统（task-helpers.ts, task-actions.ts, task.ts）

### 已证明的性质

**1. 任务 ID 永远不会重复。**
每个新任务的 ID 都来自一个只增不减的计数器（`nextId++`）。没有任何其他地方能创建任务。所以两个任务不可能拿到同一个 ID。

**2. 依赖关系始终是双向一致的。**
如果任务 A 说"我阻塞了 B"，那 B 一定也说"我被 A 阻塞了"。反之亦然。这通过一个四步协议保证：先删旧边、再设新值、再加新边。中间有一瞬间不一致，但 JavaScript 是单线程的，没人能在那一瞬间读到中间状态。

**3. 不可能创建自我阻塞。**
代码在修改依赖前显式检查"一个任务不能阻塞自己"。

**4. 环形依赖会被检测并拒绝。**
当你设置依赖时，代码会在一个"假设图"上做广度优先搜索：如果按照你想设的依赖关系，从这个任务出发沿着 blockedBy 链能走回自己，就说明有环，拒绝操作。这对"一次调用设两个方向"和"分多次调用逐步构造环"都有效。

**5. isUnblocked 正确处理了所有边界情况。**
被删除的依赖被视为已满足（不会永久阻塞）。全部完成、全部过期、混合状态、空依赖列表 — 都测试通过。

**6. statusTag 覆盖了所有可能的状态值。**
pending / in_progress / done / expired 四种状态各有对应分支，不存在遗漏。

### 对 pi 框架的依赖

任务状态通过 `pi.appendEntry()` 持久化为 CustomEntry。我们验证了（session-manager.ts:892）CustomEntry 在 compaction 后仍然存在，且不会被发送给 LLM（session-manager.ts:373）。

---

## 二、Boulder 自动重启系统（boulder.ts, boulder-helpers.ts, boulder-countdown.ts）

### 已证明的性质

**7. 停滞检测不会误判。**
比较待处理任务的 ID 集合而非数量：{1,2} 变成 {2,3} 虽然数量相同但 ID 不同，不算停滞。

**8. 指数退避公式正确。**
失败次数 0→1→2→3→4→5 对应延迟 10s→20s→40s→80s→160s→160s（封顶）。

**9. 确认停止标签只检查最后一条消息。**
反向扫描找到最后一条 assistant 消息，旧的停止标签不会影响后续重启。

**10. 问题检测正确处理了尾随空格。**
`.trim().endsWith("?")` 能识别 `"问题？  \n"` 。

**11. 倒计时不会泄漏资源。**
3 条退出路径都调用同一个 cleanup 函数。`cancelled` 标志防止重复清理。

### 对 pi 框架的依赖

`sendUserMessage()` 在扩展 API 层面永远不会抛异常（框架用 `.catch()` 吞掉了，agent-session.ts 验证）。`agent_end` handler 的异常被框架 try/catch 捕获（runner.ts:587-605 验证）。

---

## 三、配置系统（config.ts）

### 已证明的性质

**12. JSONC 注释剥离不会破坏字符串内容。**
逐字符扫描，遇到引号就进入"字符串模式"，`\"` 和 `\\` 作为两个字符处理。`"http://example.com"` 中的 `//` 不会被当成注释。

**13. 尾逗号移除不会改动字符串内部。**
使用相同的逐字符状态机，只在字符串外部移除尾逗号。

**14. 配置合并语义：项目覆盖用户。**
简单字段：项目覆盖用户。categories：按 key 浅合并。disabled_agents：并集。

---

## 四、注释检查器（comment-checker.ts）

### 已证明的性质

**15. 字符串内容不会被误判为懒注释。**
`stripStringLiterals` 使用递归结构处理任意深度的模板字符串嵌套：`skipString` 处理普通引号，`skipTemplateLiteral` 处理反引号并递归调用 `processInterpolation`，后者遇到嵌套反引号时再递归调用 `skipTemplateLiteral`。8 种边界用例（普通字符串、单引号、模板、插值、嵌套模板、深层嵌套、混合引号、转义）全部通过验证。

**16. 正则回退路径覆盖了 `//`、`/* */` 和 `#` 三种注释风格。**
每种 `//` 懒注释模式都有对应的 `#` 版本。`/* */` 块注释模式保留原样（`#` 语言没有块注释语法）。

**17. edit 操作的输入格式正确。**
pi 的 edit 工具将参数规范化为 `{path, edits: [{oldText, newText}]}`（prepareEditArguments, edit.ts:83）。comment-checker 从 `edits` 数组读取所有 `newText` 并拼接，正确处理单 edit 和多 edit 情况。

---

## 五、崩溃安全

### 已证明的性质

**18. 没有任何函数存在未捕获的崩溃路径。**
所有事件 handler 自带 try/catch。框架也在 runner.ts 中对所有 omp-v2 使用的事件类型（before_agent_start, agent_end, session_*, tool_result）提供 try/catch 保护。

**19. renderTaskResult 防御了其他插件的干扰。**
运行时类型检查 details 字段形状，不通过就退回显示原始文本。框架额外包 try/catch。

**20. loadConfig 失败不会崩溃插件。**
入口函数用 try/catch 包裹，配置文件格式错误时回退到 `{}`。

---

## 六、资源管理

### 已证明的性质

**21. 所有临时 session 都在 finally 中释放。**
4 处 createAgentSession 调用（Prometheus、两处 Momus、Oracle）都有 `session.dispose()` 在 `finally` 块中。systemPrompt 赋值在 try 内部。

**22. 所有模块级状态在 session 边界正确重置。**
Boulder 计数器、二进制缓存、hash 去重集、context-recovery 的 session 集 — 全部在 session_start 或 session_shutdown 时重置/清理。

**23. latestCtx 不会导致 use-after-dispose。**
shutdown 时设为 undefined，回调第一行检查 null，整个回调包在 try/catch 里。

---

## 七、对 pi 框架的假设（20 条，全部已验证）

| 假设 | 状态 | 依据 |
|------|------|------|
| 事件 handler 按顺序 await 执行 | 已确认 | runner.ts:790 |
| systemPrompt 在 handler 间链式传递 | 已确认 | runner.ts:796-812 |
| tool_result content 在 handler 间链式传递 | 已确认 | runner.ts:612-660 |
| handler 抛异常不会崩溃框架 | 已确认 | runner.ts:587-605 |
| agent_end 在 agent 循环完成后触发 | 已确认 | agent-loop.ts:231 |
| CustomEntry 在 compaction 后存活 | 已确认 | session-manager.ts:892 |
| CustomEntry 不会发送给 LLM | 已确认 | session-manager.ts:373 |
| sendUserMessage + followUp 在 streaming 时排队 | 已确认 | agent-session.ts:967-979 |
| compact() 是 fire-and-forget | 已确认 | agent-session.ts:2186 |
| getSystemPrompt 在 before_agent_start 时返回基础 prompt | 已确认 | agent-session.ts:1037-1061 |
| tool_result handler 可以替换 details | 已确认 | runner.ts:630-633 |
| renderCall/renderResult 被 try/catch 包裹 | 已确认 | tool-execution.ts:225-264 |
| `[AGENT:` 前缀由 v1 的 call-agent/delegate-task 设置 | 已确认 | call-agent.ts:187, delegate-task.ts:227 |
| setWidget(key, undefined) 清除 widget | 已确认 | interactive-mode.ts:1407-1425 |
| notify() 不会抛异常 | 已确认 | runner.ts:177 (no-op fallback) |
| onTerminalInput 返回 unsubscribe 函数 | 已确认 | interactive-mode.ts:1594-1603 |
| matchesKey 检测 Esc 键 | 已确认 | keys.ts:808-816 |
| SessionManager.inMemory 创建临时 session | 已确认 | session-manager.ts:1299-1301 |
| session.dispose() 可安全多次调用 | 已确认 | agent-session.ts:717-720 |
| readOnlyTools = [read, grep, find, ls] | 已确认 | tools/index.ts:111 |

---

## 八、不能保证的东西

1. **LLM 行为正确性** — 注入的 prompt 能否让 LLM 按预期行动，无法通过代码审计验证。
2. **性能** — 没有检查极端负载（10000+ 任务、超长 session）下的表现。
3. **pi-subagents 场景下的子 agent 检测** — pi-subagents 以独立进程运行子 agent，omp-v2 的 hooks 不在子 agent 进程中执行。`[AGENT:` 检测仅在 v1 的 in-process session 中生效（v1 工具 call-agent.ts / delegate-task.ts 仍然存在并使用 createAgentSession）。

---

## 九、审计过程

共 6 轮迭代：

| 轮次 | 发现 | 修复 |
|------|------|------|
| 第 1 轮 | 11 个问题 | 环检测重写（BFS 在假设图上运行）、退避公式修正、per-file try/catch（agent 发现）、per-pattern try/catch（glob 匹配）、systemPrompt 移入 try（3 文件）、loadConfig 容错、尾逗号移除重写（字符串感知状态机）、hash 注释模式、stripStringLiterals 初版、context-recovery shutdown 清理 |
| 第 2 轮 | 4 个问题 | ast_grep exit code 1 处理、widget callback try/catch、二进制缓存 session 刷新、虚假子 agent 检测添加 |
| 第 3 轮 | 2 个问题 | hash 注释模式补全、虚假子 agent 检测移除（"You are an agent specialized in" 模式在 pi 源码中不存在） |
| 第 4 轮 | 1 个问题 | **comment-checker edit 输入格式不匹配**：pi 将 edit 参数规范化为 `{path, edits: [...]}`，但代码在读不存在的顶层 `oldText`/`newText`，导致所有 edit 的注释检查静默失效 |
| 第 5 轮 | 2 个问题 | hash 注释模式二次补全（9 个遗漏）、stripStringLiterals 递归重写（支持任意深度嵌套） |
| 第 6 轮 | 0 个问题 | 收敛 |
