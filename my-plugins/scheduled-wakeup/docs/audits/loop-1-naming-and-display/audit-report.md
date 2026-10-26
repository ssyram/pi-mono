# loop-1-naming-and-display 独立契约对照审计报告（workflow §6.5 路径 B）

- 审计对象：scheduled-wakeup 子计划 loop-1-naming-and-display 四项改动（投递正文门控与空栏目省略；name 系统 + `/loop rename` + ID/name 解析；列表摘要与 `name [id]` 显示；结果卡整卡点击展开）。
- 材料（仅使用以下材料，未读其它实现源码）：`my-plugins/scheduled-wakeup/README.md`（下称 README）、`docs/ver-2.0/detailed-design.md`（ver2-DD）、`docs/script-tasks/detailed-design.md`（st-DD）、`docs/design/loop/subplans/loop-1-naming-and-display.md`（subplan）、`/tmp/loop-audit-bundle/changes.diff`（下称 diff）。
- 方法：先仅读契约文档独立列出 E1..E28，再读 diff 逐条判定。未运行任何测试（审计角色无执行工具），所有结论均为 diff 静态对照。

## 一、独立契约点清单（E1..E28，含来源）

### A. 投递正文（改动 1）

- E1 `<prompts>` 块存在当且仅当 `shouldWake && wakeUp.kind !== "never"`（never、on-error 未触发等 no-wake 投递不携带 prompts）。来源：st-DD buildWakeUpContent Post；subplan §2.1；README。
- E2 prompts 块内容为该 kind 的 prompt，经 escapeMarkup 转义。来源：st-DD；subplan §2.1。
- E3 每个 script 块固定包含：script 头（path、exit-code，null → "unavailable"）、非 success 时的 FAILED 行、`status:`、`cwd:`、闭合 tag。来源：st-DD；subplan §2.1。
- E4 空栏目省略清单：仅当有值时打印 params（length > 0）、signal（≠ null）、error（≠ null）、stdout（≠ ""）、stderr（≠ ""）。来源：st-DD；subplan §2.1；README。
- E5 省略仅是显示层行为，原始值完整保留在 `results`。来源：st-DD；README。
- E6 安全不变量：动态文本（path、prompt、输出、元数据）全部 escapeMarkup（含属性引号），转义不截断；每 result 恰一个 `<script=`/`</script>` 块，成败分支均有闭合 tag。来源：st-DD。
- E7 shouldWake 由调用方用 `shouldWakeUp(task.wakeUp, results)` 计算后传入，不二次计算、口径不漂移；共同正文在 TaskRun 恰生成一次。来源：st-DD Pre；subplan §2.1、§6 callee 契约。

### B. name 字段（改动 2 上半）

- E8 TaskInput/TaskDefinition 增可选 `name`；合法值为 undefined 或 trim 后非空字符串；创建与 rename 入口统一用 `readTaskName` 规范化。来源：subplan §2.2；ver2-DD 状态不变量 1。
- E9 name 不参与身份标识：TaskDefinition.id、DefinitionReference、锁键、registration 结构（仅 id/reference/progress/registeredAt）、唯一性判定一律不变。来源：subplan §2.2；ver2-DD 不变量 1/2。
- E10 持久层不强制 name 唯一；唯一性只在命令解析时按"当前命令候选集"判定。来源：subplan §2.2。
- E11 生命周期：创建仅 AI tool `add` 可携带 name；slash add/define 不支持内联 name（改用 rename）；`--clear` 只删 name；name 随定义删除。来源：subplan §2.2、§3。
- E12 `/loop rename <target> <new-name...>` 与 `rename <target> --clear`；target 为单 token；`--clear` 仅可作唯一尾 token；缺参/误用返回明确 Usage；目标不存在返回明确消息；catalog busy 走既有错误通道。来源：subplan §3、§6；ver2-DD parse-v2-command 节。
- E13 rename 状态转移：session task 走会话状态锁（reducer action）；shared definition 走 definition-store 写事务；shared rename 同 scope 全会话生效。来源：subplan §2.2；ver2-DD loop-command-handler 节、Shared catalog transaction 节。
- E14 版本稳定：session snapshot 仍为 version 1；shared catalog 仍为 version 2；旧版本无 name 数据必须可读（可选字段容忍，不 bump version）。来源：subplan §2.2 兼容性、§6；ver2-DD 不变量 1/3。

### C. 目标解析（改动 2 下半）

- E15 解析顺序：候选集内精确 ID 匹配优先；否则 name 匹配，唯一则命中；多个返回 ambiguous 消息并列出候选（`name [id]` 形式）；零个返回 missing。来源：subplan §2.3、§2.2；ver2-DD 不变量 1。
- E16 候选集（按命令）：stop/run/defer → 本会话 active 集（session tasks + registrations）；unregister → 本会话 active registrations；register → 指定 scope 全部 shared definitions；delete（无前缀形式）→ 两 scope 全部 shared definitions；rename → session tasks（含非 active）+ 两 scope shared definitions（作为一个候选集参与唯一性判定）。来源：subplan §2.3。
- E17 defer 的 target 自 parse 起就是单 token；含空格的 name 不能用于 defer，需用 ID。来源：subplan §2.3；README；ver2-DD。
- E18 `/loop delete` 允许无前缀 name 形式：parse 不再强制前缀，dispatch 跨两 scope 解析；带前缀形式行为不变（scope 强制、精确 ID）；`--force` 可在 token 列表任意位置。来源：subplan §3；ver2-DD parse-v2-command 节。
- E19 AI tool cancel/delete 使用与 slash 相同解析规则（cancel → active 集；delete → 本会话 registrations，name 取引用定义 name）。来源：subplan §2.3；ver2-DD register-v2-tool 节、Delete contract 节。
- E20 AI tool schema：`add` 增可选 `name`；`id` 描述更新为接受唯一 name；schema 无 `scope`/`force` 字段，运行时仍拒绝。来源：subplan §3；ver2-DD；README。

### D. 摘要（改动 3 上半）

- E21 prompt 分支：取第一个 trim 后非空的行；长度 > 80 时截为 80 字符加 `...`，否则原样；不合并多行。来源：subplan §2.4。
- E22 scriptTask 分支：wakeUp 带 prompt（always/on-error）时同样摘要该 prompt；never 时 `运行 <basename(path)>`，多脚本 `运行 <basename(first)> 等 N 个脚本`。来源：subplan §2.4。

### E. 显示（改动 3 下半）

- E23 列表首列：有 name 显示 `name [id]`，否则 id；registration 的 name 取其引用定义的 name，定义不可用时仅 id；available 列表同规则。来源：subplan §2.5；README。
- E24 widget 行的 id 段：有 name 时显示 `name · id`。来源：subplan §2.5。

### F. 结果卡交互（改动 4）

- E25 移除标题内层 MouseRegion，整个 Box 包进单个 MouseRegion；左键 click 切换展开/收起；其余事件（右键、拖选、滚轮等）返回 undefined，保留既有语义。来源：subplan §2.6。
- E26 既有行为不变：global Expand、按消息记忆展开状态、多行标题可点击；仅改展示层，不重发消息、不触发 AI 回合；legacy TUI 仍走键盘 Expand。来源：subplan §2.6、§1；README。

### G. 命令面 / 补全 / help

- E27 autocomplete：top-level 增加 `rename`；source 接口改为 `taskLabels()` / `definitionLabels(scopes?)` 返回 `{id, name?}`；补全 value 仍为 id，description 显示 name；unregister 仅提供 `registration:*` id。来源：ver2-DD Command autocomplete 节；subplan §3。
- E28 help 文本同步：rename 帮助行、各命令 `<id|name>` 形式、defer 单 token 说明。来源：subplan §3。

## 二、对照表

| E# | 契约点（简） | 状态 | 证据位置（均在 changes.diff 内） |
|---|---|---|---|
| E1 | prompts 块 iff `shouldWake && kind≠never` | ✅ | `src/script-tasks/wake-up-content.ts`：`const prompts = shouldWake && task.wakeUp.kind !== "never" ? [...] : []`；测试 `script-content.test.ts`（no-wake 用例断言 `doesNotMatch /<prompts>/`） |
| E2 | prompts 内容为该 kind prompt，escapeMarkup | ✅ | 同上：`escapeMarkup(task.wakeUp.prompt)` |
| E3 | 固定栏目（头/status/cwd/FAILED/闭合） | ✅ | 同上：block 数组结构保留 |
| E4 | 空栏目省略（params>0、signal≠null、error≠null、stdout≠""、stderr≠""） | ✅ | 同上：五个条件展开；测试 `doesNotMatch /params:\|signal:\|error:\|stdout:\|stderr:/` |
| E5 | 原始值完整保留于 results | ✅ | 函数仅构造字符串，不改 results；`execute-task.ts` 返回的 `results` 未变 |
| E6 | escapeMarkup 全覆盖、每 result 恰一块、转义不截断 | ✅ | 同上：path/cwd/params/signal/error/stdout/stderr/prompt 均经 escapeMarkup；`script-content.test.ts` 结构块计数断言保留 |
| E7 | shouldWake 由调用方计算后传入 | ⚠️ | `src/script-tasks/execute-task.ts` ✅（`shouldWakeUp(...)` 计算后传入）；但 `src/task-dispatcher.ts` 空结果分支硬编码 `buildWakeUpContent(task, [], true)`，见 W1 |
| E8 | 可选 name + readTaskName 规范化 | ✅ | `src/v2/model.ts`（`readTaskName`、`assertTaskInput` name 校验）；`src/v2/loop-core.ts` 两个 create 入口规范化；`src/v2/ai-session-actions.ts` `parseTaskInput` |
| E9 | name 不进入 id/引用/锁/registration | ✅ | `model.ts` Registration 类型未改；id 生成式未改；`definition-store.rename` 复用既有 `transaction(scope)` 锁路径；reducer `rename-task` 不触碰 registrations |
| E10 | 持久层不强制唯一 | ✅ | `definition-store.rename` 无唯一性检查；唯一性仅在 `resolve-target.ts` 按候选集判定 |
| E11 | 创建仅 AI add 带 name；--clear 只删 name | ✅ | `scheduled-wakeup-schema.ts`（name 仅 schema 可选字段）；diff 中 add/define 解析无内联 name 改动；reducer/store 中 `delete definition.name` |
| E12 | rename 解析（单 token target、--clear 唯一尾 token、Usage/missing） | ✅ | `src/v2/parse-v2-command.ts` `parseRename` + `RENAME_USAGE`；`parse-v2-command.test.ts` rename 用例 |
| E13 | session 锁 / shared 事务 / 跨会话生效 | ✅ | `loop-core.renameSessionTask`（`withStateLock` + `rename-task` action）；`definition-store.rename`（`this.transaction`）；`v2-core.test.ts` 跨 core 断言 `other.listDefinitions(["global"])[0]?.name` |
| E14 | version 1 / version 2 不变、旧数据可读 | ⚠️ | session 侧 ✅：`session-state-reducer.ts` `renameTask` 返回 `{ version: 1, ... }`；`session-state-codec.ts` `readTaskName` 可选解析。shared 侧存疑，见 W2 |
| E15 | 解析顺序（精确 ID → 唯一 name → ambiguous 列 `name [id]` → missing） | ✅ | `src/v2/resolve-target.ts` `resolveTarget` + `label()`；`resolve-target.test.ts` |
| E16 | 各命令候选集（rename 为合并候选集） | ❌ | stop/run/defer/unregister/register/delete 候选集 ✅（`loop-command-handler.ts` 各 case 用 `activeTaskCandidates`/`registrationCandidates`/`definitionCandidates`）；rename ❌：`renameTarget()` 先 session 集合命中即返回，未按合并候选集判定跨 kind 重名，见 F1 |
| E17 | defer 单 token 目标 | ✅ | diff 中 `parseDefer` 未改动（单 token 保留）；help 新增说明行；`defer` case 仅把 target 换成 `resolution.id` |
| E18 | delete 无前缀跨两 scope；带前缀不变；--force 任意位置 | ✅ | `parse-v2-command.ts` `parseDelete`（scope 可为 undefined）；`loop-command-handler.ts` delete case（`definitionCandidates(rt.core)` 默认两 scope；带前缀直接 `{ ok: true, id }`）；`--force` 过滤逻辑未变 |
| E19 | AI cancel/delete 同解析规则 | ✅ | `ai-session-actions.ts`：cancel → `activeTaskCandidates`，delete → `registrationCandidates`，均经 `resolveTarget` |
| E20 | schema 增 name、id 描述更新、仍无 scope/force | ✅ | `scheduled-wakeup-schema.ts`（仅增 name 与 id 描述；未引入 scope/force）；`register-v2-tool.ts` 不在 diff（运行时拒绝逻辑未改动）；`register-v2-tool.test.ts` 新用例覆盖 add name / cancel / delete by name / ambiguous |
| E21 | 摘要第一行 + 80 字符阈值 | ⚠️ | `src/v2/task-content.ts` `summarizePrompt`（`split("\n").find(非空行)`、`> 80` 时 `slice(0, 80) + "..."`）与 `describe-task-content.test.ts`（80/81 边界、不合并多行）基本一致；"否则原样"的细微出入见 W4 |
| E22 | scriptTask 摘要（wake prompt / `运行 <basename>` / `等 N 个脚本`） | ✅ | `task-content.ts` scriptTask 分支；`describe-task-content.test.ts` 三用例 |
| E23 | 列表 `name [id]`、registration 取引用定义 name、available 同规则 | ⚠️ | `src/v2/format-list.ts` `label()` 及 available/active 两处调用 ✅（`v2-core.test.ts` 断言 `shared name [global:` / `shared name [registration:`）；但同文件顺带删除了注册行 `(definition available)` 后缀，见 W3 |
| E24 | widget `name · id` | ✅ | `src/loop-widget-items.ts`：`item.name === undefined ? item.id : \`${item.name} · ${item.id}\``，Running/Waiting 两行均用；registration 取 `entry.definition?.name` |
| E25 | 整卡单 MouseRegion、仅左键 click 处理 | ✅ | `src/task-run-renderer.ts`：标题内层 MouseRegion 移除，`return new MouseRegion(box, handler)`；`event.type !== "click" \|\| event.button !== "left"` → undefined；`task-run-renderer.test.ts`（padding 行 0 与正文行 2 均切换，右键/wheel 不处理） |
| E26 | 既有展开记忆/global Expand 不变；仅展示层；legacy 不变 | ✅ | 同上：`views`/`globalExpanded` 逻辑未改；handler 只 toggle + refresh，无投递调用；diff 无 legacy 相关改动 |
| E27 | autocomplete rename、taskLabels/definitionLabels、value=id、unregister 仅 registration:* | ✅ | `loop-completion-candidates.ts`（topLevel 增 rename、`TaskLabel`、`ids`/`registrationIds` 取标签、`renameCandidates` 合并两源）；`loop-command-autocomplete.ts`；`extension.ts` source 实现；`v2-command-autocomplete.test.ts` |
| E28 | help 同步 | ✅ | `parse-v2-command.ts` `loopV2HelpText`：rename 行、`<id|name>` 各行、defer 单 token 与重名说明 |

## 三、❌ 与 ⚠️ 汇总

**F1（❌，P1）rename 目标解析未按合并候选集判定重名，跨 kind 同名静默命中 session 任务**
- 位置：`src/loop-command-handler.ts` `renameTarget()`。
- 证据：subplan §2.3 规定 rename 候选集为"session tasks（含非 active）+ 两 scope shared definitions"（一个候选集），§2.2 规定"不唯一则拒绝并列举候选"。实现先 `resolveTarget(command.target, sessionTaskCandidates(rt.core))`，session 集合内唯一即直接 rename session 任务，从不与 shared definitions 合并判定。例：name "alpha" 同时是一个 session 任务与一个 shared definition 的 name（各自集合内唯一）时，契约要求 ambiguous 拒绝并列举两个 `name [id]`；实现静默 rename session 任务。佐证：同 diff 的补全侧 `renameCandidates` 是 taskLabels + definitionLabels 合并列表，与分发侧两段解析自相矛盾。
- 最小修复：`renameTarget` 中改为一次 `resolveTarget(target, [...sessionTaskCandidates(rt.core), ...definitionCandidates(rt.core)])`，命中后按 `scopeOfDefinitionId(id)`（`session:` → 会话 rename，`workspace:`/`global:` → catalog rename）分发；ambiguous/missing 消息由 `resolveTarget` 统一产出。

**W1（⚠️，P2）`task-dispatcher.ts` 空结果分支硬编码 `shouldWake=true` 传入 buildWakeUpContent**
- 位置：`src/task-dispatcher.ts`（`buildWakeUpContent(task, [], true)`）。
- 说明：subplan §6 callee 契约要求 shouldWake 由调用方用 `shouldWakeUp` 计算后传入（避免口径漂移）。若该分支仅零脚本任务可达且 prepare 保证零脚本仅限 `always`（st-DD），则 `true` 与计算值等价；但 diff 无法判定该分支的可达条件，若可达 `on-error`（`shouldWakeUp(on-error, []) === false`），prompts 块会错误出现（kind≠never 且 shouldWake=true）。
- 最小修复：改传 `shouldWakeUp(task.wakeUp, [])`，或在 diff/实现中确认该分支仅 always 可达并在代码注释处注明依据。

**W2（⚠️，P2）shared catalog 对 name 的编解码无直接 diff 证据**
- 位置：diff 未包含 `shared-catalog-codec.ts`（或等价 shared catalog 编解码文件）的改动。
- 说明：session 侧 codec 已按 subplan §2.2 更新（`session-state-codec.ts` 增 name 解析），但 shared 侧仅能靠 diff 内新增测试间接佐证（`v2-core.test.ts` 中 `defineSharedTask` 后用独立 journal 的 `createCore("other", ..., roots)` 读到 `definition.name === "shared name"`，即磁盘 round-trip）。审计无法运行测试，无法从材料直接确认"新 name 持久化 + 旧无 name catalog 可读（E14）"在 shared 侧成立。
- 最小修复：由实现方运行该测试确认；若 shared codec 是字段白名单解析，则需补充与 session 侧对称的 `readTaskName` 容错改动（当前 diff 缺失即契约缺口）。

**W3（⚠️，P2）`format-list.ts` 注册行内容列删除 `(definition available)` 后缀，属契约外输出变更**
- 位置：`src/v2/format-list.ts` registration 分支（`${describeTaskContent(definition)} (definition available)` → `describeTaskContent(definition)`）。
- 说明：subplan §2.5 仅授权首列 label 变更，§1 四项范围亦不含该后缀移除；README 列表输出契约也未提及此变更。可能是顺手清理，但属可见行为变化且无契约依据。
- 最小修复：确认意图——若非有意，恢复后缀；若有意，在 subplan/README 的列表输出契约中补记。

**W4（⚠️，P2）`describeTaskContent` 返回 trim 后的行，与"否则原样"字面有细微出入**
- 位置：`src/v2/task-content.ts` `summarizePrompt`（`const trimmed = line.trim(); ... : trimmed`）。
- 说明：subplan §2.4 的判据是"取第一个 trim 后非空的行"，截断规则作用于该行；"否则原样"若指保留该行原始缩进/尾部空白，则实现（返回 trim 后行）有偏差；若"原样"指"不截断"，则一致。测试用例未覆盖带缩进的首行，无法从 diff 判定契约意图。
- 最小修复：二选一——契约措辞明确为"返回 trim 后的行"，或实现改为返回原始行（仅用 trim 判空与计长需同步定义）。

## 四、备注

1. 结论边界：本次为 §6.5 路径 B 独立契约对照，仅依据契约文档与 changes.diff 静态判定；未运行测试（审计角色无执行工具），W2 尤其需要实际运行 `v2-core.test.ts` 确认。
2. 材料约束遵守情况：除四份契约文档与 changes.diff 外未读任何实现源码；未修改任何仓库文件。
3. 未在契约中找到对应依据但无碍判定的实现细节（仅记录）：AI add 成功消息附带 ` (name)` 后缀（`ai-session-actions.ts`）；core 层 `createSessionTask` 对 trim 后为空的 name 抛错而 AI 边界静默丢弃（`readTaskName` 在 `parseTaskInput` 先行规范化，两者与 §2.2 "统一用 readTaskName 规范化"自洽）；`rename` 的 target 为字面 `--clear` 时按普通目标解析失败（无契约约束）。
4. 输出路径：任务正文要求写入 `my-plugins/scheduled-wakeup/docs/audits/loop-1-naming-and-display/audit-report.md`，但本次运行的权威输出路径为 `/tmp/loop-audit-bundle/subagent-output.md` 且审计角色无文件写入工具，故完整报告在此返回、由运行时持久化；两个路径的要求冲突已按权威输出执行，未额外写文件。

## Review

- Correct：四项改动的主体契约均落实——prompts 门控与五项空栏目省略精确实现（E1–E6）；name 全链路（schema/parse/core/codec/reducer/store）与"不进身份/引用/锁"不变量保持（E8–E13）；resolve-target 的精确 ID → 唯一 name → ambiguous(`name [id]`) → missing 顺序正确（E15）；defer 单 token 与 delete 无前缀形式符合契约（E17、E18）；摘要 80 字符阈值与边界测试、`运行 X 等 N 个脚本`（E21、E22）；列表 `name [id]` 与 widget `name · id`（E23、E24）；整卡单 MouseRegion 且非左键 click 返回 undefined（E25、E26）；autocomplete 与 help 同步（E27、E28）。
- Finding：F1（P1）rename 未按合并候选集判定跨 kind 重名，静默命中 session 任务，违反 subplan §2.2/§2.3（`loop-command-handler.ts` `renameTarget`）。W1–W4（P2）dispatcher 硬编码 `shouldWake=true`；shared catalog codec name round-trip 缺直接证据；`(definition available)` 后缀属契约外删除；摘要"原样"与 trim 后返回的措辞出入。
- Merge verdict: OK with notes —— F1 应在发布前修复（改动局部、修复路径明确）；W1/W2 需实现方补充可达性说明或测试证据后关闭。