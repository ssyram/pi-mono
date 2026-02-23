# 辩论总结 — 朝廷架构设计大辩论

> 日期: 2026-02-23
> 辩论方法: 三方对抗辩论 + 独立评审
> 参与模型: gpt-5.2 (方A), kimi-k2.5 (方B), claude-sonnet-4-6 (方C) + qwen3.5-plus (评审)

---

## 辩论方法论

每个辩题按以下流程执行:

1. **初始立场** (Round 1): 三个模型分别作为方 A/B/C，基于完整的平台技术文档独立提出完整方案
2. **反驳修正** (Round 2): 各方阅读其他方的立场后进行反驳、指出弱点、并修正自身方案
3. **评审裁决** (Round 3): 由第四个模型 (qwen3.5-plus) 作为独立评审，综合各方观点给出最终推荐

辩论基于三个平台的真实技术机制：Pi Extension 系统（目标实现平台）、CC (Claude Code) Hooks、OC (OpenCode) Plugin。

---

## 各辩题结论速览

| # | 辩题 | 推荐方案 | 核心决策 |
|---|------|----------|----------|
| 1 | 丞相上下文管理 | 语义锚点 + 协议化惰性压缩 (CAL) | 事件驱动局部更新，非每轮重构；高风险建议基于语义事件清除 |
| 2 | 史官生命周期 | 分级闸门·异步优先·终局收敛 | L0无风险跳过/L1低风险异步/L2高风险同步/L3终局深审 |
| 3 | 史官上下文管理 | 机械提取事实包 + 协议化游标 | 父进程代码机械提取客观事实，非LLM摘要；单一游标追踪 |
| 4 | 史官子任务监督 | 增强型客观监督（双层视图） | 第一层客观元数据快速扫描 + 第二层按需深挖异常节点 |
| 5 | 书记官角色 | Manifest-Driven Clerk (MDC) | 非独立Agent，而是声明式清单 + Hook机械执法 |

---

## 各辩题详细链接

- [辩题 1: 丞相上下文管理](./topic-1-context-management.md)
- [辩题 2: 史官生命周期与触发时机](./topic-2-historian-lifecycle.md)
- [辩题 3: 史官上下文管理](./topic-3-historian-context.md)
- [辩题 4: 史官子任务监督能力](./topic-4-historian-supervision.md)
- [辩题 5: 书记官角色 — Skill/MCP 管理](./topic-5-clerk-role.md)

---

## 综合设计决策

以下决策基于 5 场辩论的评审裁决提炼，形成朝廷架构的设计指导原则：

### 1. 上下文控制：Court Anchor Ledger (CAL)

**核心机制**: 在 Session 持久化区维护锚点账本 (CAL)，而非直接操作消息数组。

- **锚点类型**: DECISION（已完成决策）、RISK_HIGH（高风险警告）、TASK_ACTIVE（进行中任务）
- **更新时机**: `agent_end` 事件中根据 delegate 完成和史官建议更新 CAL
- **上下文构建**: `context` 事件中根据 CAL 动态组装消息，只替换受影响片段
- **建议清除**: 高风险建议基于"问题解决"语义事件清除，非轮次计数 (TTL)
- **任务压缩**: 已完成任务使用协议化结构块 (COURT_TASK_RESULT) 替换原始对话

**跨平台适配**:
- Pi: 完整 CAL + `context` 替换
- OC: `messages.transform` 复刻 Pi 逻辑
- CC: 不删除历史，仅 Prompt Prefix 注入 CAL 最新快照

### 2. 史官生命周期：分级闸门模型 (Graded-Gate Model)

**核心机制**: 根据操作风险等级动态选择审查策略。

| 风险级别 | 触发条件 | 审查模式 | 工具策略 |
|----------|----------|----------|----------|
| L0 无风险 | 纯 Read/只读 Delegate | 跳过史官 | 正常 |
| L1 低风险 | 常规 Write/Delegate | 异步史官 (后台 Spawn) | 下一轮工具解锁 |
| L2 高风险 | Bash/MCP/敏感操作 | 同步史官 (阻塞) | 强制工具锁 |
| L3 终局 | Session End/Compact | 同步深审 (阻塞) | N/A |

**实现要点**:
- 风险分级由硬编码矩阵决定（非 LLM 判断）
- 异步审查通过 `setActiveTools` 实现"逻辑同步、体验异步"
- 终局审查利用 `session_before_compact` 钩子
- 所有 Spawn 设置超时保护，超时视为 ALLOW_WITH_WARNING

### 3. 史官上下文：机械提取事实包

**核心原则**: 监督依据必须独立于被监督者。父进程（Hook 代码）= 书记员，如实记录；史官 = 法官，独立判决。

- **信息获取**: 纯代码机械提取（遍历 messages 提取 tool_use、git diff stat），严禁调用 LLM 生成摘要
- **事实包格式**: JSON，含 tool_calls、git_diff_stat、final_statement、context_snapshot
- **游标**: 单一序列号 (seq + git_ref)，关联所有事件源
- **Token 控制**: 事实包目标 ~1.6-2k tokens；史官只能读取 `.court/packets/fact_*.json` 和 `context.md`
- **核验方式**: 史官对比 metrics 与 selfReport 找不一致，而非重新审查完整对话

### 4. 子任务监督：双层客观监督视图

**核心决策**: 否定纯丞相决策审查（信息不对称），采用增强型客观监督。

- **第一层 (默认)**: 平台自动提取的客观元数据树 (ObjectiveNode)
  - 工具调用统计、耗时、退出码、是否有写操作
  - 由平台代码（非 LLM）生成，不可篡改
  - 成本极低，用于快速扫描异常
- **第二层 (按需)**: 仅当第一层发现异常时，史官通过 `read` 工具获取详细日志
  - 声称完成但无 Write 操作 → 深挖
  - 耗时异常短 → 深挖
  - 置信度低 → 深挖
- **深度截断**: 默认 Depth ≤ 2 展示完整元数据，更深层仅保留 metrics

### 5. 书记官：Manifest-Driven Clerk (MDC)

**核心决策**: 不引入第五个独立 Agent。书记官 = 声明式清单 + Hook 机械执法。

- **清单生成**: 丞相在任务初始化时生成 `court-manifest.json`（一次性规划行为）
- **清单内容**: 任务阶段定义、各阶段允许工具白名单、Skill 摘要（非完整 prompt）、全局规则
- **执法方式**: `before_agent_start` 设置工具白名单，`context` 事件全量替换 System Messages
- **关键创新**: 不识别 Skill prompt，直接全量替换 System Messages 为清单中的摘要
- **阶段切换**: 丞相更新 `appendEntry` 中的 phase 字段，Hook 自动读取新配置

---

## 跨平台能力矩阵

| 能力 | Pi Extension | CC Hooks | OC Plugin |
|------|:---:|:---:|:---:|
| 上下文完整替换 | ✅ `context` 事件 | ❌ 仅 Prefix 注入 | ✅ `messages.transform` |
| 源头工具限制 | ✅ `setActiveTools` | ⚠️ `PreToolUse` deny | ⚠️ 有限 |
| 同步史官 (阻塞) | ✅ `agent_end` | ✅ `Stop` hook | ⚠️ 需模拟 |
| 异步史官 (后台) | ✅ spawn 子进程 | ✅ Sub-Agent | ✅ background task |
| 持久化隔离 | ✅ `appendEntry` | ✅ 文件系统 | ✅ 文件系统 |
| 自定义压缩 | ✅ `session_before_compact` | ❌ 无 | ❌ 无 |
| 子进程隔离 | ✅ `--no-session` | ✅ Task 隔离 | ✅ task 隔离 |

**降级策略共识**:
- Pi 为首选参考实现，实现完整功能
- OC 通过 `messages.transform` 接近 Pi 能力
- CC 接受不完美但透明的降级：Prefix 注入 + PreToolUse deny + 文件中转

---

## 开放问题汇总

1. **并行 Delegate 的状态竞态**: 多个九卿同时完成时 CAL 更新的原子性
2. **风险矩阵的动态调整**: 是否允许用户自定义风险矩阵？配置错误风险如何处理？
3. **机械提取的粒度边界**: 简单截断可能切断代码逻辑，需要更智能的提取规则
4. **长周期记忆衰减**: context.md 膨胀时的"记忆归档"机制
5. **清单生成准确性**: 丞相遗漏关键工具时的"特许申请"机制
6. **CC Token 膨胀极限**: 长周期项目中需要"软重置"机制
7. **异步审查的用户体验**: 快速连续指令时的队列/锁定策略

---

## 对原设计的主要修订

### vs. Pi court-project-spec (原始抽象规格)

| 维度 | 原设计 | 辩论后修订 | 修订原因 |
|------|--------|-----------|----------|
| 史官触发 | 每次 `agent_end` 必触发 | 分级闸门 (L0-L3) | 低风险操作不需要审查，减少冗余 |
| 史官建议清除 | 2 轮后移除 | 基于语义事件清除 | TTL 可能误删高风险警告 |
| 上下文过滤 | `context` 事件简单替换摘要 | CAL 锚点账本 + 事件驱动更新 | 简单替换缺乏生命周期管理 |
| 史官上下文 | 从 `agent_end` messages 提取 | 机械提取事实包 (Fact Packet) | 避免 LLM 摘要的信任危机 |
| 子任务监督 | 仅审查丞相输出 | 双层客观监督 (元数据 + 按需深挖) | 防止"回音室"效应 |
| 工具管理 | 无专门机制 | MDC 清单 + Hook 执法 | Skill/MCP 上下文生命周期管理 |

### vs. CC V11 自释放史官模型

| 维度 | CC V11 | 辩论后修订 | 修订原因 |
|------|--------|-----------|----------|
| 自循环机制 | SubagentStop exit 2 | 保留作为 CC 特有实现 | Pi 有更好的 agent_end 阻塞机制 |
| 进言注入 | pending-advice.md + PostToolUse | CAL 锚点 + context 事件 | Pi 的 context 事件比文件中转更直接 |
| 上下文预构建 | PreToolUse updatedInput | 机械提取事实包 | 更客观、更可信 |
| 启动方式 | SessionStart hook 提醒 | 分级闸门自动触发 | 无需管家"记得启动史官" |
