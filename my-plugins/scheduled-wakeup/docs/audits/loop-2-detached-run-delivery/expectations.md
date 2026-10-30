# Contract Audit Expectations — loop-2-detached-run-delivery

Step 0 产出（实现开始前，只读契约文档抽出）。契约源：

- `docs/design/loop/subplans/loop-2-detached-run-delivery.md`（本子计划，权威变更契约）
- `docs/ver-2.0/detailed-design.md`（Loop 2.0 状态/投递/关停契约——被本子计划修订的段落以 subplan 为准）
- `docs/script-tasks/detailed-design.md`（脚本执行/正文契约——被修订段同上）
- `README.md`（命令面、Delivery and modes、Verification）

## 1. 契约源

既有契约关键锚点（本子计划触及处）：

- dispatcher：prompt-only 合成 always 任务立即投递；script 批次串行、结束后发一条 `loop-task-run` custom message；wake=triggerTurn true / followUp；no-wake 不入 AI 队列
- Session close/reload aborts owned processes（修订为不杀）；Stop/cancel lets already-started batch finish（修订为终止）
- buildWakeUpContent 块结构、escapeMarkup、空栏目省略（保留；新增 log 路径行）
- 进度推进在 dispatch 时点（保留）

## 2. Schema 字段（机械化）

| 字段 | 类型 | 来源 | 期望实现位置 |
|---|---|---|---|
| runs 根目录 | `<cwd>/.pi/scheduled-wakeup/v2/runs/` | subplan §3 | run-catalog.ts |
| task.json {version,target,content,ownerSessionId,startedAt} | 固定形状 | subplan §3 | script-tasks/run-record.ts |
| live.sock | UDS bind（liveness 原语，替代 flock） | subplan §3 | script-tasks/runner-main.ts |
| status.json {pid,currentIndex,success,completed,total,updatedAt} | 固定形状 | subplan §3 | 同上 |
| result.json {cancelled,results,successCount,shouldWake,completedAt,content} | TaskRun 同口径 + cancelled | subplan §3 | 同上 |
| delivered.json {sessionId,deliveredAt,how} | 固定形状 | subplan §3 | 同上 |
| cancelled.json {sessionId,at,stage} | 固定形状 | subplan §3 | 同上 |
| ScriptResult.stdoutLog / stderrLog | string?（绝对路径） | subplan §3 | script-tasks/task-spec.ts |
| OUTPUT_TAIL_BYTES | 常量 8192 | subplan §3 | script-tasks（tail 读取处） |
| LoopWidgetItem.pendingDelivery | { shouldWake: boolean }? | subplan §4.5 | loop-widget-items.ts |
| GC 常量 | 每 task 保留 5 个 / 7 天 | subplan §3 | run-catalog.ts |
| START_GRACE_MS | 常量 30_000（stale-start 宽限） | subplan §3 | run-catalog.ts |

## 3. 枚举值（机械化）

- ScriptResult.status 增加 `"cancelled"`（其余 success/failed/timeout/start-failed 不变）
- run 状态字面量：`running` / `pendingDelivery` / `done` / `cancelled`（+扫描期合成动作 lost/stale-start 不落独立状态文件）
- delivered.how ∈ `"idle-send" | "boundary-entries"`；cancelled.stage ∈ `"running" | "pendingDelivery"`

## 4. 流程步骤

- P1 startRun：mkdir → 原子写 task.json → spawn wrapper（detached, stdio ignore）
- P2 wrapper：bind live.sock（失败即退）→ 写 status.json → 逐脚本（status.json 前置更新 → 执行落盘 → tail）→ result.json 原子写
- P3 scan：遍历 → 状态推导（cancelled > done > pendingDelivery > running > lost/stale 合成）→ owner 过滤 → GC
- P4 投递：idle 立即 sendMessage（发送先行 → delivered.json）；busy 挂队列 → before_settle entries（wake∧¬aborted 加 continue）→ aborted/settled 兜底 flush
- P5 cancel：running → SIGTERM（轮询 cancelled result，超时 killScriptGroup）；pendingDelivery → cancelled.json + 移出队列；delivered 已存在 → 拒绝撤回
- P6 resume：runtime 启动 scan → done 未投递投递 / running 采纳显示 / lost 合成后投递

## 5. 行为契约（语义，人审）

- 会话关闭/reload 不杀 owned 脚本进程、不写 run 标记；suspendSchedules 照旧
- stop/AI cancel 命中 active 任务：删调度 + 同 id live run 一并终止；命中仅 live run：只终止 run
- `cancelled` run 永不投递（连 no-wake append 也不发）
- wrapper SIGTERM 后剩余脚本不再执行，全部标 "cancelled"，result.cancelled=true
- prompt 直投同 coordinator 通道（无磁盘记录，进程丢失可接受）
- `/loop list` 与 widget 显示同源：Running (I/K/M)、Pending delivery (wake|no wake)、Waiting + 待投递后缀
- AI tool `active` 数组形状不变；message 文本追加 run 行
- tail 只影响投递正文与 result.json 携带；磁盘日志全量
- win32：startRun 直接合成 failed result（POSIX required），不 spawn

## 6. 时序/状态契约

- 归属 = ownerSessionId 严格相等（compact/-c resume 保持 id；fork 换 id 即断联）；fork 对他人 run 零显示/投递/合成/停止/GC/磁盘接触；发现活跃外会话 run → 本地取消对应任务+一次性 info（D13）
- delivered.json 在发送动作之后写（at-least-once；崩溃窗口重发一次为上界）
- 状态推导只依赖文件存在性 + live.sock 可连性，不读 wrapper 内存
- result.json 至多写一次（wrapper 写，或 lost/stale 合成者仅在确认死亡/未启动后写）；status.json 只在 bind 之后、result 之前
- wrapper 存活期间 live.sock 恒可连接

## 7. 不变量契约（property-based）

- 对任意 run 目录：状态推导结果恰属五类之一（互斥完备；stale-start 宽限 30s 内视为 starting 不合成）
- 对任意 pendingDelivery run：cancelled.json 写入后任意时点 scan/投递均不发送消息
- 对任意 results：`split("<script=").length-1 === results.length`（新 builder 保持，log 路径行不破坏分块）
- 磁盘往返：task.json/result.json 写后读回等价；坏 JSON 判为损坏并走 lost/不可用路径，不 crash
- 尾读：`tail.length ≤ OUTPUT_TAIL_BYTES`（按 UTF-8 字节界）

框架注：沿用既有 seeded-PRNG/断言式测试惯例（同 loop-1 标注），无 fast-check。

## 8. 性能契约

- scan 为 stat 级（每秒一次，仅活跃 run 存在时）；无逐字节读日志（tail 只读末段）
- 投递正文含 tail ≤ 8KiB/流；旧契约的全量 stdout 不再进正文
- 无新增时长断言（标 N/A，同 loop-1）

## 9. 安全/副作用契约

- 修改仅限 `my-plugins/scheduled-wakeup/**`；pi 官方源码零修改
- wrapper 只写自己的 run 目录；不触碰 session entries、catalog、其他 run
- coordinator 不写 session entries（投递走 sendMessage/before_settle entries，属消息面）
- flock 句柄不跨请求泄漏；扫描间隔 unref

## 10. 跨实现一致性

- `/loop list` 文本与 widget 行来自同一 collectLoopWidgetItems 数据
- slash stop 与 AI cancel 共用同一 run 终止入口（相同消息口径）
- wrapper 与会话侧共用 run-record codec（单一 schema 定义点，双方 import）

## Step 5 验证记录（实现后回填）

- 路径 A：`PI_LOOP_TEST_SDK_ROOT=... node --import ./test/script-task-register.mjs --test --test-concurrency=1 test/*.test.ts`：除 `test/script-runner-main.test.ts`（wrapper e2e，详见下）外全部通过，含重写的 loop-script-integration（真 spawn 全链路 3/3）、task-dispatcher（7/7）、delivery-coordinator（11/11）、run-catalog（7/7）、extension-resume/widget-items/boulder/extension/poller（20/20）；`node test/check-types.mjs` 通过。无独立 contract_audit 脚本（N/A：插件层无 scripts/contract_audit 基建，同 loop-1；机械检查由全量测试与类型检查承担）。
- 已知环境性摊派（已解决，2026-10-30 回填）：`script-runner-main.test.ts` 的停摆非环境性——真因是 `finish()` 在 `until(result.json)` 之后才挂 `close` 监听，wrapper 在轮询间隙退出时 close 事件已发无人听 → 永等（失败集合逐轮轮换即竞争窗口所致）。修复：finish 先查 `exitCode/signalCode` 已退出则立即返回。修复后连跑 3 轮 8/8，全量 sweep（--test-force-exit 逐文件）49/49 PASS、SUMMARY fails=0（含 script-lifecycle 5/5、script-runner-main 8/8）。断言未弱化；历史记录见 decisions.md。
- 过程中发现并修复的真 bug：①dispatcher 丢弃式 refresh 守卫导致 views 陈旧（stop 找不到刚启动的 run）→改合并式；② tick 的 hasActivity 门自饿死→去除；③ fixture 缺 `hasPendingMessages` 使 pump TypeError 被 executor 吞成 failed 不投递→补齐 fixture。
- 路径 B：spec-impl-auditor（codex-001/gpt-6.1-sol:high）独立审完成：35E = 14✅/13❌/8⚠️，报告在 audit-report.md。全部 ❌/⚠️ 已处置（12 项代码修复、其余文档修订/边界记录），逐条见 decisions.md「审核处置」表；修复后确定性子集 200/200、check-types 通过；随后全量 sweep（--test-force-exit 逐文件）：41/43 文件 PASS，2 个 FAIL 均为已记录的环境摊派（script-runner-main SIGTERM 用例 120s 停摆；script-lifecycle 单跑 3/3 通过，sweep 中一次性 stdout 丢失）。另新增真 TUI 端到端（test/e2e-tui.test.ts，tmux 驱动真实 pi：add→widget→run→wrapper→结果卡投递→list→stop 杀批→终态），PI_LOOP_E2E=1 门控，主流程 2/2 + 键盘展开（ctrl+o）2/2 稳定通过；README Verification 已收录运行方式。鼠标点击无法经 tmux 合成（send-keys -H 字节被 tmux 按键层消费，插桩证实零到达），卡片点击行为由既有 MouseRegion 单测与真终端人工验证覆盖。
