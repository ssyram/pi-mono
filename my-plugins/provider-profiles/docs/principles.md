# provider-profiles — Principles

# Task Overview

**问题对象**：Pi 插件 `provider-profiles` 的意图、认知前提与经验材料（Q 层）。
**背景与现状**：用户需要在同一 Pi 内管理与手动切换多个供应商账号。方案"内置 provider 的具名账号实例"已实现并全局启用（2026-09-22），支持面已泛化为全部可克隆内置 provider；含 `/add-login` 命令。
**本次范围**：只写 Q（Q.I / Q.A / Q.E）。D 见 `architecture.md`（根 D-frame）与 `detailed.md`（叶子细化）。
**主要材料**：用户多轮确认的方案裁决；对本仓源码（main@6cf69f3e4）与官方安装文档的直接核读；本机生产插件实证。
**预期产物**：供 `architecture.md`、`detailed.md`、`test-plan.md`、`correctness.md` 引用的 Q 条目。

条目编号规则：`Q.I.n` / `Q.A.n` / `Q.E.n`；状态分内容采纳（candidate/confirmed/superseded）与事实证据（verified/pending/contested）两轴，仅在有消费者时保留字段。

## Q.I — Intention

### Q.I.1 — 多账号具名实例

**采纳状态**：confirmed
**定义**：在同一 Pi 实例内，存在多个以用户配置名命名的认证身份（账号实例），可在 `/model` 中手动选择实例的模型；切换是显式手动的。
**判断力**：任何"自动轮换/自动换号/失败转移"的候选即越界；没有具名实例的"多账号"方案不算满足。
**适用边界**：只承诺 Pi 内的身份入口，不承诺远端账号互异（同一远端账号登入两个实例不产生两份额度）。
**来源原文**：> "我本质上就只是想一个 pi 方便管理多个 codex，直接当场切换……一个号用光了直接切换另一个"；> "按照这个预计我可以 /login zai-001-g-l 吗"
**被谁回答**：D.root（architecture.md）。

### Q.I.2 — 配置驱动

**采纳状态**：confirmed
**定义**：新增一个账号实例 = 在用户配置文件中添加条目并重载；正确的候选中，新增账号不需要修改插件代码。
**判断力**：需要改代码才能加号的实现即违反。
**适用边界**：不承诺配置文件热重载（重载方式属 D/I）。
**来源原文**：> "这个新账号啥的，能不能单纯我自己来 config？"
**被谁回答**：D.root P6。

### Q.I.3 — 凭据独立与不静默借号

**采纳状态**：confirmed
**定义**：每个实例的登录、凭据存储、刷新、登出只作用于本实例名下的凭据槽；实例认证失败就是失败，不得回退使用环境变量、其他实例或内置 provider 的凭据。
**判断力**："看起来切了号、实际用了别的 key"的任何路径即违反；这是本插件的核心承诺，优先级最高。
**适用边界**：不约束内置 provider 自身的 env 回退行为（官方语义不动）。
**来源原文**：> "未配置凭据的入口不能静默借用另一个账号的 key，否则'看起来切号、实际没切'会破坏这个插件最核心的承诺"（用户认可的方案表述）
**被谁回答**：D.root P2、P7。

### Q.I.4 — 官方语义继承

**采纳状态**：confirmed
**定义**：实例复用官方 provider 的登录交互、OAuth 刷新、流式请求与模型元数据（含 contextWindow、maxTokens、reasoning 等），不人工转录模型参数，不自建第二套 token 刷新。
**判断力**：手抄模型清单、自维护 token 生命周期的实现即违反。
**适用边界**：实例对官方语义的偏离仅允许为满足 Q.I.3（去除 env 回退），且必须逐条论证。
**来源原文**：> "尽可能模型/配置这些都直接从官方拿"；E1 教训获用户认可。
**被谁回答**：D.root P3、P4。

### Q.I.5 — 不修改官方源码、不干扰

**采纳状态**：confirmed
**定义**：实现限于 `my-plugins/provider-profiles/**` 与用户全局配置文件；不覆盖内置 provider 注册，不读写无关凭据槽，不修改其他插件与官方源码文件。
**判断力**：任何对上述范围外文件的写操作即越界（含间接写）。
**适用边界**：不含 Pi 官方包升级等环境变化。
**来源原文**：> "不要动官方源码，纯全局配置"；> "记得不要修改任何设计范围外的文件"
**被谁回答**：D.root P5。

### Q.I.6 — 可推理实现

**采纳状态**：confirmed
**定义**：代码须便于正确性推理：状态归属显式、副作用边界清楚、无隐晦技巧；正确性判据独立于实现文本（对抗测试由独立模型设计）。
**判断力**：依赖隐式全局状态、模糊对象复制、"碰巧能运行"的实现即违反。
**适用边界**：是写作与审查纪律，不是要求纯函数化。
**来源原文**：> "代码写作也要非常注意必须方便正确性推理，不要写太隐晦的代码"
**被谁回答**：D.root 各 P 的可判定表述；detailed.md 的函数契约。

### Q.I.7 — 身份层单一职责

**采纳状态**：confirmed
**定义**：本插件只承担账号身份层（谁登录、哪把凭据）；目录/端点定义（哪些模型、什么 baseUrl）归属 models.json，插件不创建、不修改、不内联承担其内容。
**判断力**：任何把 baseUrl/models 定义引入 provider-profiles 条目的候选即越界；对 models.json 的写操作即越界。
**适用边界**：读 models.json 作 denylist 与冲突防护不受限（只读）。
**来源原文**：> "我们不承担 models.json 的修改，所以算了，不要这个了"（custom 来源裁决，2026-09-22）；> "provider-profiles 只管'谁'，models.json 管'是什么'"（获用户"确实"确认）
**被谁回答**：D.root P.local.1/P.local.5、C1/C2。

## Q.A — Assumption

### Q.A.1 — 凭据按 provider id 存取

**采纳状态**：confirmed **事实状态**：verified
**命题**：凭据以 provider id 为主键：`login(providerId)`、`logout(providerId)`、`getAuth(providerId|model)`，模型形式经 `model.provider` 解析到槽位；持久化于 `~/.pi/agent/auth.json`。
**依据**：`packages/ai/src/models.ts`（Models 接口、InMemoryCredentialStore）；官方文档 custom-provider.md。
**若不成立**：P2/P7 的槽位论证失效，需重审实例身份与凭据的绑定机制。
**被谁使用**：R2、P2、P3。

### Q.A.2 — createProvider 不改写模型归属

**采纳状态**：confirmed **事实状态**：verified
**命题**：`createProvider` 的 `getModels()` 原样返回构造目录时已戳记 `provider` 字段的模型；工厂不改写归属。
**依据**：`packages/ai/src/models.ts:784-816`；`providers/zai.models.ts`（`flattenModelCatalog("zai", …)` 在目录生成时戳记）。
**若不成立**：P3 的重戳义务前提变化。
**被谁使用**：R1、P3。

### Q.A.3 — 扩展可注册完整 Provider 对象

**采纳状态**：confirmed **事实状态**：verified
**命题**：`registerNativeProvider(provider)` 按 `provider.id` 存入扩展注册表并重组模型快照；扩展工厂可为 async 且 Pi 等待其完成。
**依据**：`packages/coding-agent/src/core/model-runtime.ts:750-759`；custom-provider.md Quick Reference。
**若不成立**：M 的注册路径需换机制。
**被谁使用**：R5、C4。

### Q.A.4 — 模型可用性按 model.provider 判定

**采纳状态**：confirmed **事实状态**：verified
**命题**：快照中模型可用性 = `model.provider ∈ configuredProviders`；未认证 provider 的模型加载但不出现在 `/model`。
**依据**：model-runtime.ts 快照逻辑；官方文档 models.md。
**若不成立**：P7 需另立不可用机制。
**被谁使用**：R4、P7。

### Q.A.5 — envApiKeyAuth 存在 env 回退；codex 无

**采纳状态**：confirmed **事实状态**：verified
**命题**：`envApiKeyAuth.resolve` 顺序为存储凭据 → 逐个环境变量；`zai`→`ZAI_API_KEY`、`zai-coding-cn`→`ZAI_CODING_CN_API_KEY` 均用之；`openai-codex` 用 lazyOAuth，无 env 回退。
**依据**：`packages/ai/src/auth/helpers.ts:9-31`；`providers/zai.ts`、`zai-coding-cn.ts`、`openai-codex.ts`。
**若不成立**：P2 的 auth 包装义务变化。
**被谁使用**：R2、P2。

### Q.A.6 — 工厂分类事实（2026-09-22 泛化轮核验）

**采纳状态**：confirmed **事实状态**：verified
**命题**：全部 46 个内置工厂中，仅 `radius` 携带 `refreshModels`（闭包按原工厂 id 过滤恢复目录，克隆即错绑）；仅 `github-copilot` 携带 `filterModels`，且其按凭据内 `availableModelIds` 过滤**模型 id**、不读 provider id（共享引用即官方语义的正确继承）；所有工厂统一经 `createProvider` 构造，`stream`/`streamSimple` 按 `model.api` 分发与 id 无关；oauth/apiKey 认证形状可从工厂产物的 `auth` 字段读取。
**依据**：`grep -l fetchModels/refreshModels/filterModels packages/ai/src/providers/*.ts`（46/1/1）；`github-copilot.ts` filterModels 源码直读。
**若不成立**：支持集分类规则需重审。
**被谁使用**：R1、P4、C2 分类机制。

### Q.A.7 — refreshModels 闭包绑定工厂 id

**采纳状态**：confirmed **事实状态**：verified
**命题**：`createProvider` 的 `refreshModels` 恢复存储动态模型时按工厂 `input.id` 过滤（`m.provider === input.id`），该绑定不随对象复制改变。
**依据**：`packages/ai/src/models.ts:818-841`。
**若不成立**：P4 的剔除义务可放宽（仍保留保守剔除）。
**被谁使用**：R1、P4。

### Q.A.8 — 扩展导入通道与 denylist 来源

**采纳状态**：confirmed **事实状态**：verified（子路径值导入为间接证据，直接解析验证见 Q.A.10/T1）
**命题**：扩展经 jiti 加载；`@earendil-works/pi-ai/compat` 子路径值导入已在生产插件使用；`packages/ai` exports 含 `"./providers/*"`；`compat.getProviders()` 返回内置 provider 名称列表。
**依据**：`extensions/loader.ts:2`；`packages/ai/package.json`；`compat.ts:71`；`my-plugins/recap/summarize.ts:5`（生产实证）。
**若不成立**：C2 的工厂获取路径与 P1 denylist 需重审。
**被谁使用**：R3、C2、P1。

### Q.A.9 — /login 接受 providerRef

**采纳状态**：confirmed **事实状态**：verified
**命题**：交互模式 `/login <providerRef>` 直接以参数为 provider 目标。
**依据**：`modes/interactive/interactive-mode.ts:3052`。
**若不成立**：使用说明变化，不影响 P。
**被谁使用**：README/I 层。

### Q.A.10 — 扩展可用的官方工厂导入通道

**采纳状态**：confirmed **事实状态**：verified（2026-09-22 真实 Pi 冒烟闭合）
**命题**：built 扩展运行时仅允许 VIRTUAL_MODULES 清单内导入；`@earendil-works/pi-ai/providers/all`（导出 `builtinProviders()`）在清单内且可用；`./providers/<name>` 子路径不在清单内，被拒。
**依据**：virtual-modules.ts 清单源码；隔离冒烟：子路径加载失败报错、providers/all 成功注册三实例。
**若不成立**：C2 通道需重审（目前无迹象）。
**被谁使用**：C2、detailed.md P.local.C2.1、test-results.md。

### Q.A.11 —（pending）扩展卸载是否自动注销实例

**采纳状态**：candidate **事实状态**：pending
**命题**：扩展禁用/重载时 Pi 自动 unregister 该扩展注册的 provider。
**依据**：文档未明；实现期验证。
**若不成立**：实例存活至 Pi 退出，属可接受边界，README 记录。
**被谁使用**：C4、README。

### Q.A.12 — /login 候选序列的构成与扩展层等价物

**采纳状态**：confirmed **事实状态**：verified
**命题**：交互层 `/login` 的候选 = `modelRuntime.getProviders()` 按 `auth.oauth`/`auth.apiKey` 存在性过滤（interactive-mode `getLoginProviderOptions`）；modelRuntime 不对扩展暴露，但等价数据可从官方工厂产物直接推导（auth 形状 + refreshModels 检测），与 `/login` 序列同源。
**依据**：interactive-mode.ts `getLoginProviderOptions` 源码；provider-source.ts 分类实现。
**被谁使用**：C2、`/add-login` 补全与校验。
**重审条件**：宿主把 modelRuntime 查询面暴露给扩展时。

### Q.A.13 —（pending→已闭合记录）扩展命令补全契约

**采纳状态**：confirmed **事实状态**：verified
**命题**：`getArgumentCompletions` 返回项的 `value` **整段替换**参数区（`applyCompletion` 以完整参数文本为 prefix）；返回 null/空时引擎回退文件补全；命令名补全刚应用后的紧邻 Tab 属引擎生命周期抑制（内置命令同样复现），插件层不可干预。
**依据**：`packages/tui/src/autocomplete.ts` `applyCompletion`/`getSuggestions`；tmux 对 `/login` 的对照复现（2026-09-22）。
**被谁使用**：C5 补全的位置状态模型；E4。

## Q.E — Experience

### Q.E.1 — 手抄模型清单引入参数偏差

**采纳状态**：confirmed **事实状态**：verified
**观察**：models.json 手写 zai 模型条目省略 `maxTokens`，`--list-models` 显示输出上限 16.4K（默认 16384），内置条目为 131.1K。
**样本与范围**：一次配置、7 个模型条目全部命中；原因是 schema 默认值而非偶发。
**经验结论**：模型元数据必须复用官方目录对象，人工转录必然引入静默偏差。
**证据**：本轮会话 `pi --list-models` 输出对比；models.md 默认值条款。
**被谁使用**：Q.I.4、P3。
**重审条件**：官方目录结构变化使逐字段复制不再可行。

### Q.E.2 — 相似命名 API 误读

**采纳状态**：confirmed **事实状态**：verified
**观察**：曾把 `getBuiltinProviders()`（返回名称列表）当作 Provider 对象列表，据此产出错误代码。
**样本与范围**：一次自我纠错；根源是按函数名推断返回类型。
**经验结论**：宿主 API 必须核返回类型后再使用；由此撤销过"约 20 行"实现承诺。
**证据**：本轮会话纠错记录；`providers/all.ts:70`。
**被谁使用**：Q.A 全体的核读纪律；Q.I.6。
**重审条件**：无（已闭合为教训）。

### Q.E.4 — 相似语义 API 的契约误读（补全）

**采纳状态**：confirmed **事实状态**：verified
**观察**：把扩展命令补全按 token 级语义实现，实际引擎契约是 `value` 整段替换参数区；产生三个用户可感缺陷（文件误弹、候选覆盖 name、help 不出）。
**样本与范围**：一次实现两轮修正；根源是按直觉而非引擎源码写契约。
**经验结论**：宿主回调契约必须读到 apply/替换路径才算核验；候选语义（token 级/区域级）是补全实现的第一分叉。
**证据**：用户实测报告；autocomplete.ts applyCompletion 源码；tmux 复现与修复验证（2026-09-22）。
**被谁使用**：Q.A.13、C5。
**重审条件**：无（已闭合为教训）。

### Q.E.3 — 无 task 工具的子代理被门禁全拒

**采纳状态**：confirmed **事实状态**：verified
**观察**：两个只读 explore 子运行因 OMP 任务门禁要求先建任务、而其 agent 定义未暴露 `task` 工具，全部工具调用被拒。
**样本与范围**：同一原因、两个运行同时失败。
**经验结论**：委派须选含 `task` 工具的 agent 定义（如 sisyphus-junior）。
**证据**：子运行 0a1d22b9/a1437ff8 的输出记录。
**被谁使用**：执行编排（不属本插件 D）。
**重审条件**：OMP 门禁行为变化。
