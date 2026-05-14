# omp-v2 西西弗斯系统提示重设计提案

**日期**: 2026-04-27
**目的**: 对照 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 的 Sisyphus / UltraWork 设计、Anthropic Codex / Claude Code 公开 prompt 工程实践，给 omp-v2 当前的 Sisyphus 主提示做 gap analysis 并给出可粘贴的改造方案。
**TL;DR**: 你现在缺的不是"派人并行"这个核心洞见——这个你已经做到了。你缺的是 (1) 一套**有社区命名的、可复用的提示原语** (2) **整洁的章节骨架** (3) **几条 omo 在工程实践里磨出来的特定保护机制**。本文是一个改造清单。

---

## 0. 我对你当前状态的判断

读过你 `hooks/sisyphus-prompt.ts:129-469`（核心 Sisyphus 提示）、`agents/atlas.md`、`agents/hephaestus.md`、`agents/sisyphus-junior.md`、`agents/oracle.md`、`agents/prometheus.md`、`hooks/ultrawork-prompt.ts`、`commands/start-work.ts`、`commands/ultrawork.ts`、`docs/design-intent.md` 之后：

**你做对了 / 已经领先的部分**：
- **Decisional vs Non-Decisional** 这个分类是真好，omo 没这个，Codex 也没这个。它是你的 signature。
- **9-step Hoare audit loop** 比 omo 的 Atlas QA 更系统。`UW-3a..UW-3g` 每轮的固定 group 也比 omo 的 notepad 更可观测。
- **Boulder loop** 是你独有的"在 actionable 任务上自动续推"机制，omo 的 `boulder.json` 只是恢复 session，没有持续推力。
- **Documentation_First_Principle** 把架构文档当一等公民，比 omo 的 `learnings.md` 写法更稳。
- **Fork vs Fresh context strategy**（hooks/sisyphus-prompt.ts:390-464）是你独有的、对委托很重要的一条原语。
- 8 个 dimension auditor + confirmation + workflow auditor 的组合是 omo 完全没有的多维度审计架构。
- **Three principles for delegation**（Perspective / Capability / Efficiency）作为反"反射式委托"的护栏，比 omo 的"default to delegate"更克制、更有原则。

**你确实有的问题**（不是危言耸听，是文件级证据）：
1. `hooks/sisyphus-prompt.ts` 里 `<Documentation_First_Principle>` **段出现了两次**（第 261-273 行和第 305-388 行），第二次几乎是第一次的扩写覆盖。这是技术债的明显信号，prompt 没有一次性梳理过结构。
2. Sisyphus 提示是一坨 `<XXX>` 标签的集合，没有 Codex / oh-my-openagent 那种 `# General → ## Identity → ## Autonomy → ## Task execution → ## Validating → ## Working with user → ## Tool Guidelines` 的固定骨架。模型读起来不知道现在该看哪一段。
3. 没有"surface form → 真实意图 → 路由"映射表（Intent Classification Table）。omo 和 Codex 都把这个当作 Phase 0 的核心。你只有 `<On_User_Message>` 的"分解—排序—列任务"，但缺少"判定这条消息要不要进实施模式"的开关逻辑。
4. 没有命名化的反模式集合——例如 omo 的 **"Forbidden stops"** 列表（"Should I proceed with X?" / "Do you want me to run tests?" / "I'll stop here and let you extend..." 这种命名后专门禁止的 stop pattern）。你只有 `<Anti_Patterns>` 段一锅烩。
5. 没有 **Three-attempt failure protocol**（连续 3 次实质性不同尝试失败 → 强制 revert + Oracle 协商 + 用户判断）。
6. 没有 **opener blacklist**（"Done —", "Got it", "Great question", "Sure thing" 这些固定开场白要被显式禁掉，因为 LLM 会无脑吐出来）。你只有 `<Communication> No filler` 这种泛泛说法。
7. 没有 **Effort tagging（Quick / Short / Medium / Large）** 和 **Confidence signaling（high / medium / low）**——后者是 GPT-5.5 prompt 工程里新引入的强信号。你的 Oracle 已经有 effort 但没 confidence。
8. **{{ personality }} slot** 不存在——omo 把它作为可替换占位符以支持 default/friendly/pragmatic 三套人格，而不复制全 prompt。
9. **6-section delegation contract** 你 Atlas 里有，但 Sisyphus 主提示里只在 `<Delegation>` 末尾一行带过。Atlas 的 30 行下限规则也没下沉到 Sisyphus。
10. **Anti-duplication rule**（"派出 explore 之后不要自己重复同样的 grep"）Atlas 有，主 Sisyphus 没有。
11. **Session continuity / task_id reuse** 你架构里有（pi-subagents 提供），但 Sisyphus 提示里没强调"重用 task_id 比 fresh 节省 ~70% token"这条 omo 反复提到的硬证据。
12. **Tool Guidelines 段缺失**——omo 给每个工具（apply_patch / task / explore-librarian / oracle / shell / skill）单独写一段使用边界。你完全没有这一段，所有工具用法散落在 `<Delegation>` 和 `<Fork_Strategy>` 里。
13. **Channel 分离**（commentary vs final）没明确——omo 强调 orchestrator 在做长任务时要持续给 commentary（避免"沉默 15 分钟看起来像卡死"），final 才是结论。omp-v2 只说"Be concise and direct"。
14. `Code Enforcement Rules`（200 LOC、禁 utils.ts、index.ts 只能 re-export 等）作为 hardcoded 注入到所有 Sisyphus 会话——这是 **项目特定规则**，按理应该在 `.pi/oh-my-pi.jsonc` 配置开关，而不是写死在 prompt 里。

---

## 1. 高价值原语清单（带社区命名的玩意儿）

这些是你可以直接抄到 Sisyphus 提示里、社区有"专门说法"的设计技巧。我把它们的来源和 omp-v2 当前覆盖度也标了。

### 1.1 Anthropic 系（Claude Code 内置 system prompt）

| 原语 | 命名 | 来源 | omp-v2 覆盖 |
|---|---|---|---|
| **Blast radius / 反射性可逆性思考** | "Blast radius" | Anthropic engineering blog + Claude Code system prompt 里 `# Executing actions with care` 段。强调"考虑动作的可逆性和 blast radius，不可逆 / 影响共享系统 / 可见的动作要先确认"。 | ❌ 完全没有。Sisyphus 只有 `<Git_Safety>` 浅层规则。建议加 `## Blast Radius Discipline` 段。 |
| **Scope-bound authorization** | "Authorization stands for the scope specified, not beyond" | Claude Code prompt 原文。一次授权只覆盖授权范围内的动作，不延伸。 | ❌ 没有。`<Execution>` 隐含了"决策点不延伸"，但没用这套词。 |
| **Trust but verify** | 同名 | Claude Code prompt 谈 subagent 结果："an agent's summary describes what it intended to do, not necessarily what it did" | ✅ Atlas 里有("subagents lie")，但 Sisyphus 主提示没下沉。 |
| **First sentence intent declaration** | "Before your first tool call, state in one sentence what you're about to do" | Claude Code prompt `# Text output` 段。 | ❌ 没有。建议加到 `<Communication>`。 |
| **One-sentence updates at key moments** | 同上 | "give short updates at key moments: when you find something, when you change direction, or when you hit a blocker" | ⚠️ 部分覆盖。`<Completion>` 谈了，但没有"key moments"的命名时机。 |
| **No comments by default** | "Default to writing no comments" | Claude Code prompt `# Doing tasks` | ❌ 没有。omo 里的 `gpt-5-5/sisyphus.md:14` 有这条。 |
| **No `WHAT` comments, only `WHY`** | 同上 | "Don't explain WHAT the code does, since well-named identifiers already do that. Don't reference the current task, fix, or callers" | ❌ 没有。 |
| **Don't add error handling for impossible scenarios** | 同上 | "Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code... Only validate at system boundaries" | ❌ 没有。这条对防止 over-engineering 极有用。 |
| **No backwards-compat hacks unless asked** | 同上 | "Don't use feature flags or backwards-compatibility shims when you can just change the code" | ⚠️ 隐含在 `<Anti_Patterns>` 但没显式说。 |
| **Three-similar-lines rule** | "Three similar lines is better than a premature abstraction" | Claude Code prompt `# Doing tasks` | ❌ 没有。 |
| **`file_path:line_number` 引用约定** | 同名 | "include the pattern `file_path:line_number`" | ❌ 没有。oh-my-openagent 有更严的版本（clickable markdown links）。 |
| **`<system-reminder>` midstream nudge** | "system-reminder injection" | Claude Code 用这个机制在 tool result 里 prefix 注入提醒（你看到的"task tools haven't been used recently"就是）。 | ⚠️ 你已经在用类似机制（boulder hook），但没有命名化。 |
| **Memory architecture: user/feedback/project/reference + index** | 同名 | Claude Code 的 auto memory 系统 | ❌ omp-v2 只有 ARCHITECTURE.md 和 task state，没有四类 memory。这是另一个独立的话题，不是 prompt 重设计的一部分。 |

### 1.2 OpenAI Codex 系（gpt-5-4 / gpt-5-5 prompt 公开实践）

| 原语 | 命名 | omp-v2 覆盖 |
|---|---|---|
| **固定骨架**: `# General → ## Identity and role → ## Autonomy and Persistence → ## Task execution → ## Validating your work → # Working with the user → # Tool Guidelines` | "Codex section contract" | ❌ Sisyphus 提示是无骨架的标签集合。**这是最值得抄的一条。** |
| **Persistence / "keep going until..."** | "agentic persistence" | "Persist until the user's request is fully handled end-to-end within the current turn whenever feasible" | ⚠️ Hephaestus 有，Sisyphus 主体没有。 |
| **Forbidden stops list** | 同名 | omo `gpt-5-5/sisyphus-junior.md:36-46`：把 "Should I proceed?" / "Do you want me to run tests?" / "Simplified version" / "you can extend later" 等命名为 forbidden stop。 | ❌ 没有。 |
| **Three-attempt failure protocol** | 同名 | "After three materially different approaches have failed: stop, revert, document, consult Oracle, then ask user" | ⚠️ Hephaestus 有简版，Sisyphus 主提示没有。 |
| **Anti-duplication rule** | 同名 | "Once you fire exploration sub-agents, do not manually perform the same search yourself" | ✅ Atlas 有，Sisyphus 缺。 |
| **6-section delegation contract** | 同名 | TASK / EXPECTED OUTCOME / REQUIRED TOOLS / MUST DO / MUST NOT DO / CONTEXT，且要求 prompt 长度 >30 行 | ✅ Atlas 有，Sisyphus 主提示一笔带过。 |
| **Session continuity** | 同名 | "task_id reuse saves ~70% tokens" | ❌ 没有命名化。 |
| **Effort tagging** | "Quick / Short / Medium / Large" | omo Oracle 有，omp-v2 Oracle 也有。 | ✅ Oracle 已有。 |
| **Confidence signaling** | "high / medium / low" | omo gpt-5-5 Oracle 新加 | ❌ omp-v2 Oracle 没有。 |
| **Three-tier response structure** | "Essential / Expanded / Edge cases" with hard limits | omo Oracle | ✅ omp-v2 Oracle 已有！ |
| **Pragmatic minimalism** decision framework | 同名 | omo Oracle | ✅ omp-v2 Oracle 已有。 |
| **Opener blacklist** | "no 'Got it'/'Done —'/'Sure thing'/'Great question'" | 多处 | ⚠️ 你只有 `<Communication> No filler`，没列具体短语。 |
| **{{ personality }} slot** | 同名 | gpt-5-5 drafts/README.md | ❌ 没有。 |
| **Channel separation** | "commentary vs final" | 多处 | ❌ 没有。 |
| **Contract framing > threat framing** | "Rules are stated as agreements and expectations, not as 'NEVER DO X OR YOU WILL FAIL'" | gpt-5-5 README | ⚠️ 你有大量 "NEVER" 的 caps lock；现代 frontier model 已经不需要了，且会增加 entropy。 |
| **Why-not-just-what for rules** | "Each major rule is accompanied by the reasoning. Rules without reasons get ignored when models judge them weakly-grounded" | gpt-5-5 README | ⚠️ 部分覆盖（有些规则带了 rationale，多数没有）。 |
| **Wisdom Accumulation / Notepads** | `.sisyphus/notepads/{plan-name}/{learnings, decisions, issues, verification, problems}.md` | omo orchestration.md | ❌ 没有。你的 docs/audit/RoundN/ 是接近的形态，但没把 learnings/decisions/gotchas/conventions 命名化。 |
| **Ambition vs precision** | greenfield 要 ambitious / 已有 codebase 要 surgical | omo Hephaestus | ❌ 没有。 |
| **Categories vs models** | "Category describes INTENT, not implementation" — 用 ultrabrain/visual-engineering/quick 等语义 category 而不是模型名 | omo orchestration.md | ✅ omp-v2 已有 category 系统。 |
| **Skills as load_skills array** | 每次 `task()` 都需要 `load_skills` 参数（空数组也行） | omo | ⚠️ omp-v2 有 skills 目录但 Sisyphus 提示里没强制要求 load。 |

### 1.3 omp-v2 独有 / 你已经领先的（要保留并强调）

| 原语 | 来源 | 状态 |
|---|---|---|
| **Decisional vs Non-Decisional 分类** | `<Execution>` + `<Completion>` + UltraWork loop | ✅ 这是你的 signature，要保留并在重写后放在更显眼位置 |
| **Hoare 9-step audit loop** | `references/hoare-audit.md` + UltraWork prompt | ✅ 保留 |
| **Multi-dimensional audit (6+1+1)** | `agents/*-auditor.md` | ✅ 保留 |
| **Fork vs Fresh context strategy** | sisyphus-prompt.ts:390-464 | ✅ 保留，但应该简化、并入 Tool Guidelines |
| **Boulder loop** | hooks/boulder.ts | ✅ 保留 |
| **3 delegation principles (Perspective/Capability/Efficiency)** | sisyphus-prompt.ts:214-238 | ✅ 比 omo 的"default delegate"更克制、更准确 |
| **Documentation_First_Principle** | sisyphus-prompt.ts:261-388 | ✅ 保留思想，但 prompt 文本要去重并精简 |
| **`<CONFIRM-TO-STOP/>` escape hatch** | boulder loop | ✅ 保留 |

---

## 2. 推荐的新 Sisyphus 主提示骨架

下面是按 Codex / oh-my-openagent 风格重写后的章节大纲。每节的内容标注：**新增** / **保留** / **重写** / **从 X 下沉**。

```
You are Sisyphus, [identity slot].

{{ personality }}                       <-- 新增：人格 slot

# General                                <-- 重写：合并 <Role> + 顶层规则
- 你是个 orchestrator，不是直接 implementer（保留）
- ripgrep / parallelize / no destructive git / 等基本规则（新增，从 Codex 抄）

## Identity and role                     <-- 重写
- 三种 operating mode: Orchestrate / Advise / Execute（从 omo 抄）
- Instruction priority（新增）

## Autonomy and Persistence              <-- 新增：从 omo Hephaestus 改写
- Persist until done
- Forbidden stops 列表（命名化）
- Three-attempt failure protocol

## Intent classification                 <-- 新增：核心补丁
- Surface form → True intent → Routing 表
- Verbalize intent before routing
- Turn-local intent reset
- Context-completion gate (3 conditions)
- 当用户的设计有问题时如何 challenge

## Decisional vs Non-Decisional          <-- 保留并提升：你的 signature 段
- 当前 <Execution> 段的逻辑挪到这里、命名化
- Decisional gate / Non-Decisional auto-fix / 决策延迟到 phase completion 批量提问

## Codebase Assessment (open-ended only) <-- 新增：从 omo Phase 1 抄
- Disciplined / Transitional / Legacy / Greenfield 分类

## Exploration discipline                <-- 重写：从 <Delegation> 抽出
- Anti-duplication rule（命名化，从 Atlas 下沉）
- 4-field exploration prompt: context/goal/downstream/request
- Search stop conditions
- Wait for completion notification, never poll

## Delegation philosophy                 <-- 重写
- 3 principles (Perspective/Capability/Efficiency) - 你的领先点
- 6-section delegation contract（命名化，从 Atlas 下沉）
- Vague prompts = rejected, <30 lines = too short
- Session continuity (task_id reuse, ~70% token saving)
- Fork vs Fresh context (从底部移到这里、精简)
- Visual / frontend zero-tolerance（从 omo 抄，弱版本）

## Oracle consultation                   <-- 新增独立段
- 何时用 / 何时不用（命名化条件）
- "Consulting Oracle for X" 单行声明
- Background Oracle 期间不能 ship 依赖其结果的 implementation

## Validating your work                  <-- 重写：合并 <Verification> + Atlas QA Protocol 简版
- Evidence requirements (lsp / build / test / manual QA / delegation verify)
- Trust but verify subagent results
- Manual code review for delegated work（命名化反模式：rubber-stamping）
- Functional vs static verification 区分（从 design-intent.md §5 提取）

## Scope discipline                      <-- 新增：从 design-intent.md §6 提升
- No silent downscoping
- 用户 request 是 contract，不能默默缩水
- 边界外的发现 = observations, 不是 diff 内容
- 用户方案有问题：声明 + 提议 + 等回复，不要默默改

## Blast radius discipline               <-- 新增：从 Claude Code 抄
- Reversibility / Hard-to-reverse / 影响他人 / 上传到第三方
- Authorization stands for scope specified
- 遇到障碍不用 destructive 操作绕路

# Working with the user                  <-- 新增整段
- Channel separation: commentary vs final
- Commentary cadence (key moments, not every tool call)
- Opener blacklist (具体短语)
- Format rules (file_path:line_number, 不嵌套 bullets, 不用 em dash...)
- Final answer caps (50-70 lines)

# Tool Guidelines                        <-- 新增整段
- Task system (todo discipline 从 <Task_Management> 下沉)
- subagent() (delegation, fork/fresh, session continuity)
- explore / librarian (parallel-only, background, anti-duplication)
- oracle (synchronous when blocking)
- skill loading (load even when loosely related)
- Shell / git / read / write 基本规则

# Constraints                            <-- 重写
- Hard blocks（保留 <Anti_Patterns> 内容，命名化）
- Soft guidelines

[Available agents list - 由 hook 动态注入]
[Category mapping table - 由 hook 动态注入]
[Code enforcement rules - 移到配置驱动，按需注入]
```

**预估行数**: 当前 SISYPHUS_PROMPT 是约 340 行（去掉重复 Documentation_First 段），重写后建议 280-320 行。omo gpt-5-5 sisyphus 是 270 行 + 动态注入。

---

## 3. 优先级 P0：必做的 5 个改造

按 ROI 排序。每条都给具体可粘贴的 prompt 片段。

### P0-1: 修复 `<Documentation_First_Principle>` 重复段

`hooks/sisyphus-prompt.ts` 第 261-273 行和第 305-388 行各有一份 `<Documentation_First_Principle>` 标签。**两段在同一个 system prompt 里同时出现**——模型读到第二个开始时不知道哪个权威。

**最小修复**: 删第一段（短的），保留第二段（详细的）。或者把第二段精简到第一段那么简洁、删第二段。建议后者，因为第二段过度展开了 5-step workflow + audit consistency 子流程，对 Sisyphus 来说太重。

### P0-2: 加 Intent Classification Table

这是 omo 和 Codex 把每条 user message 进入路由前的第一道闸。当前 omp-v2 的 `<On_User_Message>` 是 "decompose → order → list todos"，跳过了"判断这条消息要不要进 implementation 模式"的判断。

**建议片段**：

```markdown
## Phase 0 - Intent Gate (every user message)

Reclassify intent from the CURRENT user message only. Do not auto-carry
implementation authorization from prior turns.

### Surface form → True intent → Routing

| User says | Probably wants | Your routing |
|---|---|---|
| "explain X", "how does Y work" | Understanding, no changes | explore/librarian → answer in prose |
| "implement X", "add Y", "create Z" | Code changes | plan → tasks → delegate or execute |
| "look into X", "check Y", "investigate" | Investigation | explore → report findings → wait |
| "what do you think about X?" | Evaluation before commit | evaluate → propose → wait |
| "X is broken" / "seeing error Y" | Minimal fix at root cause | diagnose → fix minimally → verify |
| "refactor", "improve", "clean up" | Open-ended, needs scoping | assess codebase → propose → wait |
| "fix this whole thing" | Multiple issues, thorough pass | scope assess → todo list → systematic |

### Verbalize intent

Before classifying, state one line: "I read this as [research/implementation/
investigation/evaluation/fix/open-ended] — [plan]." Then proceed.

### Context-completion gate

You may implement only when ALL three hold:
1. Current message contains an explicit implementation verb (implement/add/
   create/fix/change/write/build).
2. Scope and objective are concrete enough to execute without guessing.
3. No blocking specialist result (especially Oracle) is pending whose answer
   your implementation depends on.

If any fails, do research/clarification only and end your response.
```

**为什么 P0**：当前 Sisyphus 在用户说"我想加 X 功能..."这种**讨论性意图**时容易直接开干。Intent Gate 是阻断这个失败模式最有效的单一改动。

### P0-3: 加 Forbidden Stops 列表 + Three-Attempt 协议

Sisyphus 当前没有命名化的"什么时候不该停"清单。结果是模型在简单决策点前过度提问、在 partial fix 后过早 stop。

**建议片段**（加到 `## Autonomy and Persistence`）：

```markdown
## Autonomy and Persistence

Persist until the user's request is fully handled end-to-end within the
current turn. Do not stop at analysis when implementation was requested. Do
not stop at partial fixes when a complete fix is reachable.

### Forbidden stops

These are incomplete work disguised as checkpoints. Do not use them:

- "Should I proceed with X?" when the path is obvious — proceed, note assumption.
- "Do you want me to run tests?" when tests exist — run them.
- "I noticed Y, should I fix it?" — if Y blocks the task, fix it. If unrelated,
  note in final message.
- "I'll stop here and let you extend later" when full delivery was asked.
- "Simplified version" / "proof of concept" / "skeleton" when the task was
  the full thing.

Stop only for genuine reasons:
- A secret you cannot supply.
- A design decision only the user can make.
- A destructive action you should not take unilaterally.
- Three materially different attempts have all failed.

### Three-attempt failure protocol

If your first approach fails, try a materially different approach (different
algorithm/library/architecture, not a tweak of the same one).

After three materially different approaches all fail:
1. Stop editing immediately.
2. Revert to the last known-good state.
3. Document each attempt: what was tried, why it failed.
4. Consult Oracle synchronously with the full failure context.
5. If Oracle cannot resolve, surface the blocker in final message.

Never leave code in a broken state between attempts. Never delete a failing
test to get green; that hides the bug.
```

**为什么 P0**：你 Hephaestus 已经有这两段，但**主 Sisyphus 是 orchestrator**——它做决策的时候比 worker 更需要这些护栏。下沉到 Sisyphus 主提示是直接收益。

### P0-4: 把 Atlas 的 6-section delegation contract + anti-duplication rule 下沉到 Sisyphus

Atlas 是 plan-execution 模式才进来的 orchestrator，但 Sisyphus 在普通对话模式下也在做委托。**所有委托规则都应该在 Sisyphus 主提示里**，Atlas 只需要补充 plan-mode-specific 规则。

**建议片段**（替换当前 `<Delegation>` 段末尾的"Delegation prompt structure: TASK / EXPECTED OUTCOME / ..."一行）：

```markdown
### Delegation contract (mandatory 6 sections)

Every delegation prompt MUST include all 6 sections. Vague prompts produce
vague results; that doubles cost.

1. **TASK**: atomic, specific goal. One action per delegation.
2. **EXPECTED OUTCOME**: concrete deliverables with success criteria the
   delegate can verify against.
3. **REQUIRED TOOLS**: explicit tool whitelist to prevent tool sprawl.
4. **MUST DO**: exhaustive requirements. Leave nothing implicit about "done".
5. **MUST NOT DO**: forbidden actions. Anticipate rogue behavior, block in advance.
6. **CONTEXT**: file paths, existing patterns, constraints, related code.

If your delegation prompt is under 30 lines, it is too short. Add context.

### Verification after delegation (non-optional)

After a delegation completes:
- Read every file the sub-agent touched.
- Run lsp_diagnostics on those files.
- Run related tests.
- Cross-check the agent's claims against the actual code.
- Confirm MUST DO / MUST NOT DO compliance.

Subagents lie — not maliciously, but their self-report describes what they
intended to do, not always what they did. Never trust without verification.

### Anti-duplication rule

Once you fire explore/librarian sub-agents, do NOT manually perform the same
search yourself. Their purpose is to parallelize discovery; duplicating
wastes your context and risks contradicting their findings.

While waiting:
- Do non-overlapping preparation (set up files, read known-path sources,
  draft user questions).
- Otherwise end your response and wait for the completion notification.
- Never poll background_output on a running task.

### Session continuity

Every task() returns a task_id. Reuse it for follow-ups:
- Failed/incomplete: task(task_id="{id}", prompt="Fix: {error}")
- Follow-up question: task(task_id="{id}", prompt="Also: {question}")
- Multi-turn refinement: always task_id, never fresh.

Starting fresh on a follow-up throws away the sub-agent's full context (every
file read, every decision, every dead end already ruled out). Continuation
typically saves ~70% of the tokens a fresh session would burn.
```

**为什么 P0**：这一段是 omo 工程实践里反复磨出来的、有量化收益的（"~70% token saving"）改动。下沉到 Sisyphus 之后 Atlas 可以缩到只剩 plan-mode QA Protocol。

### P0-5: 把 Code Enforcement Rules 移到配置

`hooks/sisyphus-prompt.ts:70-92` 的 4 条规则（index.ts 只能 re-export / 禁 utils.ts / 单一职责 / 200 LOC）是**项目级偏好**，硬塞到 Sisyphus 主提示里所有项目都吃，不合适。

**建议**：
- 移到 `.pi/oh-my-pi.jsonc` 的 `code_rules` 配置项
- `buildCodeEnforcementRules()` 改为读配置生成
- 用户 / 团队可以按项目开关或定制
- 默认开启你现有的 4 条以保持行为一致

**为什么 P0**：这是单纯的 hardcoded → configurable 解耦，技术债清理，没有功能损失。

---

## 4. 优先级 P1：建议做的 4 个改造

### P1-1: 加 Tool Guidelines 大段

把散落在 `<Delegation>` / `<Fork_Strategy>` / `<Verification>` 里的工具用法集中到一个 `# Tool Guidelines` 段。每个工具一小节：

- `task` (delegation): 6-section / fork vs fresh / session continuity
- `explore` / `librarian`: parallel-only, background, anti-duplication, 4-field prompt
- `oracle`: synchronous-when-blocking, "Consulting Oracle for X" 一行声明
- `subagent()`: 何时 fork / 何时 fresh
- `lsp_diagnostics`: 何时跑（changed files / before todo done / before report）
- `bash`: 优先 rg、并行独立 read、不要 `echo "==="; ls` 链式
- `read` / `write` / `edit`: 优先 dedicated 工具，不用 sed/awk 改文件

### P1-2: 加 Channel Separation + Opener Blacklist

```markdown
# Working with the user

You communicate through two channels:

- **Commentary**: short intermediate updates while you work. Used to keep the
  user informed during non-trivial tasks.
- **Final**: the summary the user reads after work completes.

## Commentary cadence

- Before exploration: one sentence acknowledging the request and stating your
  first step. Include your interpretation so the user can correct early.
- During exploration: one-line updates as you search. Vary phrasing.
- Before non-trivial plan: one longer commentary with the plan (the only
  commentary that may exceed two sentences).
- Before file edits: note what you're about to change and why.
- After edits: note what changed and what validation comes next.
- On blockers: explain what went wrong and your alternative.

Cadence matches work. 15-min exploration warrants 3-5 updates; 30-sec edit
warrants one before, one after. Don't go silent on long tasks; don't narrate
every tool call.

## Opener blacklist

Never begin responses with:
- "Done —", "Got it", "Understood —", "Sure thing"
- "Great question!", "That's a really good idea!"
- "I'm on it", "Let me start by...", "I'll get to work on..."
- "You're right to call that out"

Just respond directly to substance.

## Format rules

- Use GFM where structure adds value. Simple answers should be 1-2 short
  paragraphs, not nested outlines.
- Never nest bullets. Flat lists only. Numbered lists use `1. 2. 3.`.
- Wrap commands, file paths, env vars, code identifiers in backticks.
- File references: `path/file.ts:42` for terminal contexts. No em dashes.
- No emojis unless explicitly requested.

## Final answer cap

50-70 lines except when the task genuinely requires depth. If turning into a
changelog, compress: cut file-by-file detail before cutting outcome,
verification, or risks.
```

### P1-3: 加 Confidence Signaling 到 Oracle

omp-v2 Oracle 已经有 effort tagging（Quick/Short/Medium/Large）但缺 confidence。加一行就行：

```markdown
**Signal confidence.** When the answer has meaningful uncertainty (codebase
shows conflicting patterns, trade-off depends on unseen context, solution
depends on untested assumptions), tag the recommendation as high / medium /
low confidence. High-confidence = you would defend it under pushback. Low
confidence = starting point pending more information.
```

加到 `decision_framework` 段尾、`response_structure` 的 Essential 区里。

### P1-4: 改 caps lock NEVER 为 contract framing

Sisyphus 提示里 "NEVER" 出现 12+ 次。Anthropic / OpenAI 的 prompt engineering 趋势是：现代 frontier model（Claude 4.x / GPT-5.4+ / Gemini 3）对 contract framing 比 threat framing 反应更好。把：

> NEVER start implementing code unless the user explicitly requests implementation.

改成：

> Implement only when the current message contains an explicit implementation
> verb. For research / question / evaluation requests, end your response after
> answering — do not silently transition into edit mode.

> 注：少数确实需要硬护栏的（git destructive / secret leakage / overwrite-without-read）保留 NEVER 即可，但要降到 < 5 次。

---

## 5. 优先级 P2：可选的改造

### P2-1: {{ personality }} slot

把当前隐式的"SF Bay Area engineer，技术冷峻"人格抽出，做 default / friendly / pragmatic 三套，靠 config 切换。omo 的做法。
**收益**：低。除非有人抱怨人格不合，否则不急。

### P2-2: Wisdom Accumulation / Notepads

`.pi/notepads/{plan-name}/{learnings, decisions, issues, gotchas, conventions}.md`，Atlas 在每个 task 完成后 append、并把汇总传给下一个 subagent。
**收益**：中。对 plan-execution 模式（/start-work + Atlas）非常有用，对普通对话 Sisyphus 用处一般。
**注意**：你的 docs/audit/RoundN/ 已经接近这个形态，但只在 UltraWork 模式下用。可以泛化。

### P2-3: Ambition vs precision 段

```markdown
## Ambition vs precision

For brand-new greenfield work, be ambitious. Strong defaults, polished
interfaces, avoid AI-slop aesthetics (purple-on-white, generic fonts).

In existing codebase, be surgical. Match style/idioms/conventions. Don't
rename, move, or restructure unnecessarily. Treat surrounding code with
respect.
```

**收益**：中等。omp-v2 的"Codebase Assessment"段其实接近这个，但没用 ambition/precision 这套词。

### P2-4: Categories 显式化（如果还没有）

确认 `category` 在 omp-v2 的 `subagent()` 调用里是不是一等参数。看 `hooks/sisyphus-prompt.ts:115-124` 是有 Category Guidance 的，但要确保每次 `subagent()` 都按 category 路由而不是按 agent 名。

---

## 6. 不建议抄 omo 的部分

避免照抄一切，下面这些 omo 的设计**不要复制**：

1. **omo 的 default-to-delegate 偏置太激进**。omo 主提示明文写"the default bias is to delegate"。你的"3 principles + delegation 不是反射式"的克制态度更对。
2. **omo 的 visual-engineering "zero tolerance" 段**对 omp-v2 不适用——你不是 web dev focus 的工具，是软件工程 / methodology focus。最多写"frontend work 优先 visual-engineering category"，不需要 zero tolerance 框。
3. **omo 的 `apply_patch` 段**是 OpenAI Codex CLI 的工具，omp-v2 用 Edit/Write/MultiEdit，不需要这段。
4. **omo `task_id` 形式**是 OpenAI codex tool 接口；omp-v2 的 `subagent()` 接口形态不同，移植时要改成 omp-v2 的语义（fork context vs fresh context 已经覆盖了"continuity"的核心）。
5. **omo 的 `learnings.md / decisions.md / issues.md` 5-file notepad**有点过度——你 docs/audit/RoundN/ 下一个文件夹 + 几个文件已经够。

---

## 7. 实施路径建议

如果要做，建议两步：

### 第一步（小修，~2 小时）
- P0-1: 修复 Documentation_First 重复段
- P0-5: Code Enforcement Rules 移到配置
- P1-3: 给 Oracle 加 confidence signaling
- P1-4: caps lock 减量、改 contract framing

不破坏架构，只是清理。可以马上做，commit 一波。

### 第二步（大修，~1-2 天，需要 review）
- P0-2: Intent Classification Table
- P0-3: Forbidden Stops + Three-Attempt
- P0-4: 6-section + anti-dup + session continuity 下沉
- P1-1: Tool Guidelines 整段
- P1-2: Channel Separation + Opener Blacklist

把 `hooks/sisyphus-prompt.ts:129-469` 整段重写成 Codex 风格骨架。建议：

1. 先把新骨架草稿写在一个新文件，例如 `hooks/sisyphus-prompt-v3.ts`
2. 用 feature flag（config 项 `sisyphus_prompt_version: "v2" | "v3"`）切换
3. 自己跑几轮 dogfooding（让 Sisyphus 处理一些真实任务，对比新旧 prompt 的行为）
4. 没回归就替换、删旧文件

### 第三步（可选）
- P2 全部
- 还可以考虑给 Sisyphus 做 model-specific variants（像 omo `src/agents/sisyphus.ts:539-568` 那样针对 Gemini lost-in-the-middle 调整 section 顺序）。

---

## 8. 给你讨论用的几个开放问题

读完上面之后，下面这些是值得我们对话拍板的：

1. **{{ personality }} 你想做几套？** default / 严肃 / 友善 / 实用，还是只 default？
2. **Code Enforcement Rules 的默认值要不要变？** 现在是 4 条强约束（200 LOC / 禁 utils / 单一职责 / index.ts only re-export）。配置化之后默认仍开还是默认关？
3. **Atlas 和 Sisyphus 的关系**：6-section 下沉之后，Atlas 还需要独立的 prompt 吗？还是 Atlas = Sisyphus + plan-mode 增量？
4. **UltraWork 现在是 sticky mode**（开了就一直在），要不要改成"per-task" 模式？omo 的 ulw 是 keyword-activated 单次。
5. **新 Sisyphus 提示要不要把 Hoare 9-step audit loop 也吸收进主提示**？还是保持现状（Sisyphus 主提示通用 / UltraWork 单独的 audit hook）？我倾向后者——Hoare loop 太重、不该是默认。
6. **要不要 Wisdom Accumulation？** 我倾向 P2 不做，因为 docs/audit/RoundN/ 已经是同类机制；除非你觉得 plan-execution 模式下需要更结构化的 learnings 文件。

---

## 附录 A: 当前 Sisyphus 提示的逐段评估

为了你回查方便，下面是 `hooks/sisyphus-prompt.ts:129-469` 的 SISYPHUS_PROMPT 每个段的判断：

| 段标签 | 行号 | 判断 | 动作 |
|---|---|---|---|
| `<Role>` | 129-132 | 太薄，缺 mode 区分 | 重写为 `# General` + `## Identity and role`，加 Orchestrate/Advise/Execute 三 mode |
| `<On_User_Message>` | 134-149 | 缺 Intent Classification Table | 替换为新的 Phase 0 - Intent Gate 段 |
| `<Execution>` | 151-189 | Decisional/Non-Decisional 部分是 signature，要保留 | 抽到独立 `## Decisional vs Non-Decisional` 段并提升位置 |
| `<Completion>` | 191-209 | 实际上是 Final Answer 规约 | 合并到新的 `# Working with the user` 段下 |
| `<Delegation>` | 211-252 | 3-principle 是亮点；6-section 一笔带过 | 重写：3-principle 保留 + 6-section 详写 + anti-dup + session continuity |
| `<Task_Management>` | 254-259 | 太薄 | 移到 `# Tool Guidelines` 下的 task 子节 |
| `<Documentation_First_Principle>` (短) | 261-273 | 与第二段重复 | **删除** |
| `<Verification>` | 275-282 | 简单合理 | 重写为 `## Validating your work`，加 evidence requirements 表 |
| `<Git_Safety>` | 284-287 | 太薄 | 合到 `## Blast radius discipline` 下 |
| `<Anti_Patterns>` | 289-297 | 一锅烩 | 拆到 `## Forbidden stops` + `# Constraints` |
| `<Communication>` | 299-303 | 缺具体 opener blacklist | 替换为 `# Working with the user` 整段 |
| `<Documentation_First_Principle>` (长) | 305-388 | 流程完整但过重 | 精简 50%、保留为独立段 |
| `<Fork_Strategy>` | 390-464 | 是亮点 | 精简、移到 `# Tool Guidelines` 下的 subagent 子节 |
| `<Available_Agents>` | 466-468 | 由 hook 注入扩展 | 保留 |

---

## 附录 B: 参考来源

- oh-my-openagent drafts/gpt-5-5/ ([sisyphus.md](file:///tmp/oh-my-openagent/drafts/gpt-5-5/sisyphus.md), [sisyphus-junior.md](file:///tmp/oh-my-openagent/drafts/gpt-5-5/sisyphus-junior.md), [oracle.md](file:///tmp/oh-my-openagent/drafts/gpt-5-5/oracle.md), [hephaestus.md](file:///tmp/oh-my-openagent/drafts/gpt-5-5/hephaestus.md), [README.md](file:///tmp/oh-my-openagent/drafts/gpt-5-5/README.md))
- oh-my-openagent production: [src/agents/sisyphus.ts](file:///tmp/oh-my-openagent/src/agents/sisyphus.ts)
- oh-my-openagent docs: [orchestration.md](file:///tmp/oh-my-openagent/docs/guide/orchestration.md)
- Claude Code system prompt（本会话注入的内容，结构如本对话第 4 轮所述）
- Anthropic engineering best practices for agentic systems（公开的 blog post 系列）
- omp-v2 当前: hooks/sisyphus-prompt.ts:129-469, agents/*.md, commands/start-work.ts, commands/ultrawork.ts, hooks/ultrawork-prompt.ts, docs/design-intent.md
