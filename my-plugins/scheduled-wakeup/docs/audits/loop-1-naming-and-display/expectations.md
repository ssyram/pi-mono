# Contract Audit Expectations — loop-1-naming-and-display

Step 0 产出。契约源（只读文档，未读实现 diff 前先抽）：

- `README.md`（命令面、交互契约、消息投递行为）
- `docs/ver-2.0/detailed-design.md`（Loop 2.0 状态/注册/catalog 契约）
- `docs/script-tasks/detailed-design.md`（buildWakeUpContent、TaskRun、渲染契约）
- `docs/design/loop/subplans/loop-1-naming-and-display.md`（本子计划新增契约）

## 1. 契约源

见上。既有契约的关键锚点：

- 注册只存 `{scope, definitionId}` 引用 + 会话私有 progress；不含 prompt/schedule（ver-2.0 #1-#5）
- session snapshot version 1；shared catalog version 2；definition id 形如 `workspace:<uuid>` / `global:<uuid>` / `session:<uuid>`；registration id 形如 `registration:<scope>:<definitionId>`
- buildWakeUpContent 正文块结构、escapeMarkup 全量转义、每 result 恰一块（script-tasks）
- 结果卡：fullscreen 下仅标题 MouseRegion 可切换；正文点击不处理（script-tasks 渲染契约，本子计划修订）
- dispatcher：prompt-only 路径合成 always 任务立即投递；script 路径全跑完再发一条 custom message

## 2. Schema 字段（机械化）

| 字段 | 类型 | 来源 | 期望实现位置 |
|---|---|---|---|
| TaskInput.name | string?（trim 非空） | subplan 2.2 | model.ts TaskInput |
| TaskDefinition.name | string? | subplan 2.2 | model.ts TaskDefinition |
| TaskLabel {id, name?} | 新 source 契约 | subplan 3 | loop-command-autocomplete.ts |
| scheduled_wakeup.params.name | string? (add) | subplan 3 | scheduled-wakeup-schema.ts |
| SessionLoopState.version | 常量 1（不变） | ver-2.0 | session-state-codec.ts / model.ts |
| SHARED_CATALOG_VERSION | 常量 2（不变） | ver-2.0 | shared-catalog-codec.ts |

## 3. 枚举值（机械化）

- SessionStateAction 新增 `rename-task`（唯一新 action kind；registration 无 rename action——name 不在 registration 上）
- ParsedLoopV2Command 新增 `rename`；`delete` 分支 scope 变为 `SharedScope | undefined`（无前缀 name 形式）
- 无新共享常量枚举；wakeUp kinds（never/always/on-error）不变

## 4. 流程步骤

- P1 目标解析：exact id → name 唯一 → ambiguous/missing（resolve-target.ts 单点实现；slash 与 AI tool 复用）
- P2 rename：session task → reducer rename-task → snapshot 持久化；shared → definition-store 事务改 catalog
- P3 投递正文：execute-task 计算 shouldWakeUp → buildWakeUpContent(task, results, shouldWake)
- P4 渲染：registerMessageRenderer 返回 MouseRegion(Box(标题 Text + 条件正文 Text))

## 5. 行为契约（语义，人审）

- no-wake 投递（never；on-error 未触发；含 prompt-only 之外的一切 shouldWake=false）不携带 `<prompts>` 块；shouldWake=true 且 kind ≠ never 时携带
- 空栏目省略只影响展示正文；`results` 原始字段完整保留，`*** FAILED ***`、status、exit-code 属性不受影响
- describeTaskContent：不合并多行；仅第一行；>80 字符截断加 `...`
- defer/stop/run 的 name 解析候选为本会话 active 集；register 为指定 scope 全量定义；rename 含非 active session tasks
- 结果卡：左键 click 切换；非 click 或非左键不处理、不吞事件

## 6. 时序/状态契约

- rename shared definition 在 catalog 锁事务内完成（与 create/delete 同一锁协议）
- session task rename 走 state 锁（withStateLock）
- name 变更不影响 nextRunAt、runCount、registration index、Boulder inhibition

## 7. 不变量契约（property-based）

- 对任意 results：`split("<script=").length-1 === results.length === split("</script>").length-1`（新 builder 保持）
- 对任意动态文本（含恶意分隔）：正文恰好 1 个 `<SYSTEM:loop-wakeup>`、1 个 `</prompts>`（或 0，当 no-wake）；escapeMarkup 依旧全量转义
- 持久化往返：带 name 的 session snapshot / shared catalog 解析回读后 name 保留；无 name 旧数据回读 name === undefined
- 解析：exact id 命中时永不返回 ambiguous

框架注：项目未引入 fast-check 等框架，按既有 seeded-PRNG 生成测试惯例覆盖（script-content.test.ts 同款），路径 A 标注见 Step 5 记录。

## 8. 性能契约

- listActive/listDefinitions 补全与显示为 O(n) 快照，无新增 IO 循环；解析每次至多两遍过滤。无新增时长断言（沿用现状，标 N/A）。

## 9. 安全/副作用契约

- 修改仅限 `my-plugins/scheduled-wakeup/**`；pi 官方源码零修改
- AI 面仍拒绝 scope/force；name 不引入跨会话写入（shared rename 本就是定义级操作，与 delete 同级）
- 渲染层改动不触发 sendMessage、不启动 AI 回合

## 10. 跨实现一致性

- slash 命令与 scheduled_wakeup 工具的目标解析共用 resolve-target.ts，规则一致
- widget、/loop list、available 对同一 ActiveTask 显示同一 name 来源（定义上的 name；registration 无独立 name）

## Step 5 验证记录（已回填）

- 路径 A：`PI_LOOP_TEST_SDK_ROOT=... node --import ./test/script-task-register.mjs --test test/*.test.ts` 191/191 通过（含新增 resolve-target / describe-task-content / rename-command 用例）；`node test/check-types.mjs` 通过。无独立 contract_audit 脚本（N/A：my-plugins 插件层无 scripts/contract_audit 基建；机械检查由全量测试与类型检查承担）。流程步骤标记：execute-task.ts 既有 `// Step P2/P4` 注释保留；新增 P1（解析）为单函数无序列循环，未加标记，见 decisions.md。
- 路径 B：subagent（reviewer，fresh context，仅契约文档 + diff）独立抽出 E1–E28 并对照，产出 audit-report.md：1 ❌（F1 rename 合并候选集）+ 4 ⚠️（W1–W4）。
- 处置：F1/W1/W3 已修复（含 F1 回归测试）；W2 以磁盘往返测试证据闭环；W4 修订契约措辞。详见 decisions.md。
- 退出准则：expectations 10 节完整；路径 A 全过（脚本部分 N/A 已注明）；audit-report 0 个未解决 ❌（修复后复测全绿）；§5.2 五维度通过（decisions.md 附记）。
