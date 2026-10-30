# Dispatcher「Waiting 0s」修复独立审查

## 结论与审查边界

**原始 `starting` 只加不清的正常完成路径已修复，但本缺陷簇尚未闭合：发现 10 项确定问题（R1–R10）和 5 项边界／覆盖警告（W1–W5）。**

- 只读静态审查；没有运行测试、类型检查、构建、tmux 或任务实例；本次唯一写入文件为本报告。下文的时序是源码可达路径，不冒充运行复现。
- 用户提供的“干净 tmux 复现、修复后 45 秒 11 轮、手动 run 成功”作为已知背景接受；它证明所述正常路径恢复，不覆盖以下异步交错和无限超时路径。
- HEAD：`b522d1bb1cf8fa10c44993a115ba26dc904a046c`。第 1–4 项检查当前工作树；第 5 项以昨日末次插件提交 `8c8dc2261` 为基线，检查今天有效净改动，不重复评价回滚／恢复提交的相互抵消部分。
- 今天净改动涉及 29 个源码文件、22 个测试文件、7 个文档文件。检查了全部源码／测试变更 hunks 及当前文件全文；文档用来确定契约和识别漂移，不将旧 `audit-report.md` 的结论当作正确性证据。未跟踪的 `docs/script-tasks/audit/implementation.patch` 是历史补丁材料，不是当前执行代码。
- 审查期间其他会话新增了 `isStarting()` 和 `widgetSource` 接线。报告已纳入这些新增 hunks，**版本界限为 2026-10-30 23:49:15 +08:00 的读取快照**；不覆盖此后的并行修改。
- 计数按 R/W 编号去重，五个审查项的标题和结尾清单不重复计数。R 表示可以给出确定违反行为／类型要求的路径；W 表示适用边界、覆盖不足或文档漂移。

关键文件的 Git blob 标识（`git hash-object`，未写对象）：

| 文件，相对仓库根 | Blob |
| --- | --- |
| `my-plugins/scheduled-wakeup/src/task-dispatcher.ts` | `fd152250c3f1f3e4d33de05264d3342d7329bbb6` |
| `my-plugins/scheduled-wakeup/src/v2/create-loop-runtime.ts` | `7f1af8fca79801b7224f00898786303282d83ae2` |
| `my-plugins/scheduled-wakeup/test/task-dispatcher.test.ts` | `1f12db008d3784c4f6386ab3bcf5aa3686e2b61c` |
| `my-plugins/scheduled-wakeup/test/defer-command.test.ts` | `0ab79dcf87693de6f52ff07220fa3a33ce426954` |
| `my-plugins/scheduled-wakeup/test/rename-command.test.ts` | `0f73c720ad045dfb289e432a28bd90776af0a8aa` |
| `my-plugins/scheduled-wakeup/test/e2e-tui.test.ts` | `cd149f28bf2564ab0c9e842281bda65232fa81a3` |

## 1. ❌ `starting` 生命周期

### ✅ 正常完成、终止、GC 和关闭的基本路径

新增清理循环确实恢复了原缺失步骤：一次成功扫描后，只要同 taskId 没有 `running` view 就删除 `starting` 项。它不仅覆盖 `done`，也覆盖 `pendingDelivery`、`cancelled`、无对应目录等情况。证据：`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:96-106`。

| 路径 | 静态判断与证据 |
| --- | --- |
| 脚本完成，结果尚待投递 | `run-catalog-state.ts:127-129` 分类为 `pendingDelivery`；清理不必等模型投递成功，因此不会因会话 busy 永久占用同 ID。完整路径：`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:119-129`。 |
| stop／取消 | 结果 `cancelled` 或取消 marker 均优先分类为 `cancelled`；后续成功扫描可释放 `starting`。证据：`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:119-125`、`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:228-243`。注意，取消与投递的竞争另见 R5。 |
| wrapper 死亡／启动失败 | owner 扫描将 lost／超过 30 秒的无状态启动合成为 `pendingDelivery`，随后清理。证据：`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:131-158`。 |
| GC | GC 只处理 `done/cancelled`，且本轮已经收集的 view 仍是终态；下一轮目录消失也不产生 running。不会仅因 GC 留下 starting。证据：`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:62-86,202-215`。 |
| `startRun` 同步失败 | 若没有留下实际 run，下一次成功扫描会清掉占位；不是正常文件系统条件下的永久泄漏。若已经留下真实 running run，继续保留阻塞反而正确。入口：`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:145-147`；持久化／启动顺序：`my-plugins/scheduled-wakeup/src/v2/run-catalog.ts:49-78`。 |
| 会话关闭／reload | `dispose()` 关闭派发并停止扫描，旧 Set 随旧 dispatcher 生命周期退出；不清空 Set 本身不是跨会话死锁。重新创建的 dispatcher 有新 Set，磁盘 run 留存是 detached 设计。证据：`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:81-87,119-120,259-263`、`my-plugins/scheduled-wakeup/src/extension.ts:160-175`。恢复时的首次扫描屏障缺失另见 R4。 |

### ❌ R1 — P1：旧扫描会清掉扫描期间新建 run 的 `starting` 锁【本次修复引入】

**位置：** `my-plugins/scheduled-wakeup/src/task-dispatcher.ts:95-107,145-147`；扫描的目录快照／异步让出点：`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:64-74`。

可达时序：

1. 扫描 S 已枚举任务或 run 目录，其结果不包含尚未创建的 run A。
2. S 在 `await` 中让出；`dispatch(T)` 添加 `starting(T)`、同步创建 A。调用 `refresh()` 只设置 `refreshQueued`。
3. S 返回旧快照，覆盖 `views`；新增清理循环发现没有 T 的 running view，删除刚添加的 `starting(T)`。
4. 合并循环开始下一次扫描并再次 `await`。此时第二次手动／到期派发看见 `views` 无 A、`starting` 无 T，可以再启动 run B。

这不是“同一调用栈连续 dispatch”——该路径确实会被 Set 拦截；问题在两轮异步扫描之间。后果是同 ID 批次重叠执行，违反 README 的 same-ID overlap 约束，可能重复外部副作用。

**建议：** 给启动记录保留 run 身份／扫描代际；旧扫描不得释放扫描开始后新建的占位，也不得覆盖新启动的本地 view。释放依据必须来自足够新的扫描。不要通过恢复“永不清理”解决竞争。

## 2. ❌ `isWedged` 的预算与时间戳

### ❌ R2 — P1：`timeoutSeconds: null` 被降格为 1800 秒，正常无限时长任务会被杀【本次修复引入】

**位置：** `my-plugins/scheduled-wakeup/src/task-dispatcher.ts:268-276`，尤其 `script.timeoutSeconds ?? 1800`；强制取消入口：同文件 `:125-138`。

`null` 的既有语义明确是 unlimited：`my-plugins/scheduled-wakeup/src/script-tasks/script-timeout.ts:7` 对 null 不设置 timer，`my-plugins/scheduled-wakeup/README.md:58` 也明确无 deadline。runner 的 `writeStatus()` 只在批次／脚本开始、spawn 和完成时调用，不是单个脚本运行期间的周期心跳：`my-plugins/scheduled-wakeup/src/script-tasks/runner-main.ts:41-58,85-94`。

因此，一个只有 `timeoutSeconds: null` 脚本、正常运行超过 32 分钟的批次，会有合法但较老的 `updatedAt`。下一次 interval 重试或手动 run 将把它判成 wedged 并发送终止信号；脚本是否持续产生日志不改变这一点。该轨迹不需要状态损坏或 wrapper 异常。

**建议：** 区分 null 与 undefined。最小安全处理是含无限预算时不使用该有限时长强杀规则；更精确时按 `currentIndex` 判断当前脚本预算。不能用旧时间戳单独证明无限时长脚本卡死。

### ✅ 空数组不会得到 `-Infinity`

`Math.max(0, ...[])` 是 `0`，当前实现有显式的 `0` 参数；空 scripts 的阈值为 120 秒，不是负无穷。无 `scriptTask` 的回退数组是 `[1800]`。正常 dispatcher 对空 scripts 走直接 prompt 通道，不启动 wrapper：`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:141-161,269-274`。没有发现这里的空展开立即误杀路径。

### ✅ 缺少 `updatedAt` 时，需要结合 codec 和 30 秒启动宽限理解

磁盘 status 缺少／不合法的 `updatedAt` 时，`parseStatus` 返回整个 `undefined`，不是保留 pid 的半个 status：`my-plugins/scheduled-wakeup/src/script-tasks/run-record.ts:103-132`。随后 catalog 以 `startedAt` 判定 30 秒启动宽限，超出后走启动失败合成：`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:25,131-158`。

因此正常、及时的扫描下，新 run 不会因 `startedAt` 回退而立即被 `isWedged` 杀掉；无 status 的失败启动通常由 catalog 的 30 秒规则先收敛。损坏 status 导致真实存活 wrapper 被视为未启动，是既有 codec／分类边界，不能将 `?? startedAt` 当作对该情况的完整修复。

### ⚠️ W1：这是派发时的机会性逃生，不是完整 watchdog

- 只有再次尝试 `dispatch`，且缓存存在 matching running view，才会调用 `isWedged`。单独残留的 `starting`、不再被派发的一次性任务，均不由此函数处理。证据：`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:121-138`。
- 批次取所有脚本超时的最大值，不是当前脚本的预算；例如当前脚本预算 1 秒、后续脚本预算 3600 秒，当前脚本卡住也要等待 3720 秒的无更新才满足规则。它是保守迟判，不是按当前脚本及时恢复。证据：同文件 `:269-276`。
- scan 或取消持续失败时，`.catch(() => undefined)` 不提供恢复保证；通知中的“下一轮 ≤60s”不能视为无条件承诺。证据：同文件 `:112-117,134-137`。持续扫描失败时，清理循环也无法执行。

建议明确这些边界，区分“释放内存占位”“处理死亡 wrapper”“按预算强制取消活 wrapper”，不要用同一个成功案例证明三者都闭合。

## 3. ❌ 合并刷新循环、1 秒 tick 与关闭

### ❌ R3 — P2：每轮跨过 tick 的慢扫描可以使刷新永不排空【今天已有缺口】

**位置：** `my-plugins/scheduled-wakeup/src/task-dispatcher.ts:86-117`。

假设每轮异步扫描耗时 1.5 秒，且期间事件循环能执行定时器：

1. 本轮开始将 `refreshQueued=false`。
2. 1 秒 tick 调用 `refresh()`，因 `refreshing=true` 将 `refreshQueued=true` 后返回。
3. 扫描完成、更新 views、调用 onChange；do-while 因 queued 再扫。
4. 下一轮也跨过至少一个 tick，重复上述过程。

`refreshing=false` 只在退出整个循环的 `finally` 中执行。只要该条件持续，最外层 refresh Promise 就不完成，扫描连续追赶 tick。扫描内部顺序遍历所有目录并逐个 await classify／socket probe，不能保证恒小于一秒：`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:64-86`、`my-plugins/scheduled-wakeup/src/script-tasks/live-socket.ts:24-34`。

**准确后果：** 不是多份 scan 并发，也不是所有 UI 更新停止——每轮仍会发布结果；是排空条件永远达不到、发起该轮 refresh 的 await 无界等待，以及没有间隔的持续扫描。单纯同步阻塞超过一秒、期间没有 tick 执行，不足以单独推出这条路径。

同时，已经 refreshing 时调用 `await refresh()` 会立即完成，而不是等待已排队的新快照（`:88-90`）。因此 `terminateTaskRuns` 中的 await 也不是可靠的“终止后已重新扫描”屏障（`:241-242`）。这与 R5 相互放大，但不等于所有 stop 都会永远等待。

**建议：** 周期 tick 在已有 scan 时复用／跳过，不应无条件制造下一轮 dirty 请求；真正改变 run 集合的操作才请求后续扫描。对外 refresh 的 Promise 应对应调用者需要的扫描代际，而不是“排到队即完成”或“等待一个可能永远排不空的总队列”。

### ✅ `refreshing` 与 dispatcher 的基本关闭出口正确

正常完成及抛错均经 finally 复位 `refreshing`。`closed` 在入口、scan 返回后及 do-while 条件检查；dispose 设置 closed、清除 interval、退订 coordinator。因此 scan 有限返回时不会在关闭后继续 enqueue 或调用 onChange。证据：`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:87-109,259-263`。

### ⚠️ W4：关闭不等于取消所有在途副作用

`coordinator.dispose()` 只设置 closed 并退订事件；2 秒 boundary marker timer 未保存句柄、未取消，`markBoundaryDelivered` 也不检查 closed。关闭后仍可能调用 `catalog.markDelivered`：`my-plugins/scheduled-wakeup/src/v2/delivery-coordinator.ts:60-70,173-177`。

同样，已经启动的 catalog scan 不因 dispatcher closed 而中断；其内部合成／GC／foreign callback 可以在返回到 dispatcher 的 closed 检查前完成：`my-plugins/scheduled-wakeup/src/v2/run-catalog.ts:80-87`、`my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:76-86,145-158`。

这不是 `starting` 跨会话泄漏。应明确“已提交 boundary entries 的迟到落标”是否允许跨 dispose 完成；若要求关闭后零写，则需要在对应资源持有者中取消／约束它，而不能只依赖 refresh 的 closed 检查。

## 4. ❌ 缓存 views 在到期瞬间的实际后果

### ❌ R4 — P1：缓存为空／尚未收录 run 时，首次派发和 stop 都会漏掉真实 run【今天已有缺口】

**位置：** `my-plugins/scheduled-wakeup/src/task-dispatcher.ts:81,112-123,145-147,184-189,228-243`；runtime 启动 poller：`my-plugins/scheduled-wakeup/src/v2/create-loop-runtime.ts:111-135`。

**恢复时重复启动：** detached run A 仍活着，同 session 的 interval 因崩溃恢复保留一个已过期 deadline。新 dispatcher 初值 `views=[]`、`starting` 为空，只 fire-and-forget 初次 scan；runtime 无需等待它就 `poller.start()`。若到期 timer 先于初次扫描完成执行，dispatch 看不到 A，创建 B。两个 wrapper 使用不同 runDir／socket，不互相排斥。catalog 的 `startRun` 也没有同 taskId 的存活排他检查：`my-plugins/scheduled-wakeup/src/v2/run-catalog.ts:49-78`。这是单 owner 恢复，不需要违反“同 transcript 多 executor”为 UB 的前提。

**启动后立即 stop：** `startRun` 的返回 view 被丢弃，只有 starting 同步记住新 run。`liveRuns()` 和 `terminateTaskRuns()` 却仅看 views；此时 stop 可以只删调度、未终止刚启动的 wrapper。之后 `refresh` 即使发现它仍 running，也不会重新遍历刚才空的 `runs` 数组。入口同样依赖缓存：`my-plugins/scheduled-wakeup/src/loop-command-handler.ts:271-302`、`my-plugins/scheduled-wakeup/src/v2/ai-session-actions.ts:99-120`。

**建议：** 初次采纳扫描完成前不要开放可启动同 ID 的派发；同步登记 `startRun` 返回的 run，并让 dispatch、liveRuns、stop 共用这一事实。扫描合并需同时遵守 R1 的代际约束，不能用旧快照抹掉它。

### ⚠️ W2：只有“旧 running、实际已完成”时，通常是 60 秒迟发，不是永久死锁

到期 timer 先于下一轮扫描看到完成结果，会因旧 running view 拒绝派发；executor 不推进进度，poller 进入 60 秒退避。即使随后 scan 清掉 starting，refresh 只调用 `onChange`，没有因终态释放主动重排 poller，因此 Waiting 0s 可以继续显示到下一次重试。

证据：`my-plugins/scheduled-wakeup/src/task-dispatcher.ts:98-107,121-139,163`、`my-plugins/scheduled-wakeup/src/v2/session-task-executor.ts:39-44,56-63`、`my-plugins/scheduled-wakeup/src/v2/due-poller.ts:5,134-135,142-158`；widget 对逾期剩余时间取零：`my-plugins/scheduled-wakeup/src/loop-widget-items.ts:98-102`。

在持续成功扫描、无新阻塞的前提下，这条路径下一次重试会恢复，不能据此单独判断原死锁仍在。反之，“旧快照没有真实 running”会导致 R1/R4 的重叠执行，不能统称为无害的一秒显示延迟。

## 5. ❌ 今天其他改动的逐 hunk 连贯性

发现的是下列缺失的状态衔接；仅凭当前 diff **不能证明这些缺口由批量编辑工具造成**。其中 R5/R6/R8/R10 在本次修复前的 HEAD 已存在；R7/R9 纳入了审查期间追加的改动。

### ❌ R5 — P1：stop 的“先 refresh，再撤回”可以先把结果发出去

**位置：** `my-plugins/scheduled-wakeup/src/task-dispatcher.ts:235-242`；刷新投递：同文件 `:98`；idle 发送：`my-plugins/scheduled-wakeup/src/v2/delivery-coordinator.ts:48-58,72-81,108-125`。

可达路径：用户请求 stop 时尚未投递；wrapper 在取消竞争中正常完成，`cancelRunning` 最终返回 `already-finished`（`my-plugins/scheduled-wakeup/src/v2/run-catalog.ts:113-123`）。dispatcher 接着 refresh；scan 得到 pendingDelivery，`enqueueRun` 立即 pump，空闲会话立刻发送并落 delivered marker。等执行到最后的 `cancelPending`，已经不可撤回。等待取消期间的周期扫描也能提前完成这次发送。

现有 E21a 将 ctx 固定为 busy，避开了 idle pump：`my-plugins/scheduled-wakeup/test/task-dispatcher.test.ts:329-350`。它不能证明空闲 stop 的承诺。

**建议：** 在第一个 await 前，对被停止的 run 建立取消意图／投递屏障；扫描和 coordinator 都必须尊重它。终止后结算取消与结果，而不是依靠一次已经可能发送的 refresh 再补撤回。

### ❌ R6 — P2：boundary 投递到落标之间缺少 in-flight 去重

**位置：** `my-plugins/scheduled-wakeup/src/v2/delivery-coordinator.ts:38-41,60-70,84-112`。

boundary handler 把 item 从 pending 删除、放入 boundarySent，delivered marker 等待 settled 或 2 秒 timer；`enqueueRun` 去重只检查 `pending.has(key)`，不检查 boundarySent。

可达路径：t=0 返回某 run 的 boundary entry 并请求 continuation；t≈1 秒扫描仍读到 pendingDelivery，于是同 run 再次入队；若新的 before_settle 在 t<2 秒到达，则同一 entry 再次被返回。过程中没有崩溃，不属于约定的 send-then-mark 崩溃窗口。

2 秒兜底只能缩短窗口，不能消灭它。现有测试只检查一次 boundary 后最终落标，没有在落标前重新 enqueue 同一个 run：`my-plugins/scheduled-wakeup/test/delivery-coordinator.test.ts:247-273,309-347`。

**建议：** 去重集合必须覆盖 pending 与已经返回、尚未落标的 boundary items；直到相应交付确认完成才移除 run key。保留崩溃后的重投语义，不要把落标提前到尚未提交 entries 的时刻。

### ❌ R7 — P1：新 Boulder 同步依赖 widget 可见性，且新任务可能被旧抑制缓存漏掉

**位置：** `my-plugins/scheduled-wakeup/src/v2/create-loop-runtime.ts:32-43,51-64,83-94,116-118`；widget 隐藏早退：`my-plugins/scheduled-wakeup/src/loop-running-widget.ts:138-145`。

追加的 `isStarting()` 能补一部分“dispatch 后尚无 view”的抑制窗口；追加的 `widgetSource` 也让可见 widget 的扫描触发同步。但把业务同步放进 UI source 仍不完整：

- 已知抑制 ID 的 one-shot 运行中保持 loop=true；用户隐藏 widget 后，脚本完成并以 never 策略在 idle 会话落盘投递。周期 scan 只触发 `widget.refresh()`，它在调用 source 前因不可见返回。调度已经 completed、无后续 due timer，也不需要新 agent turn；loop=true 可以一直保留到别的命令／事件碰巧同步。
- 初始化产生空的 `inhibitingCache` 后，5 秒内新增并到期的 one-shot 不会使该缓存失效。active 调度阶段仍能抑制，但派发后调度 completed，live run 判断使用旧空 ID 集，便释放抑制，尽管 `isStarting`／live view 已存在。可见 widget 也要等缓存重新计算后才能补回。

`createBoulderSync` 本身没有自动轮询，它只在调用 `sync()` 时计算并写信号：`my-plugins/scheduled-wakeup/src/v2/boulder-sync.ts:51-96`。单元测试用手动 `held` 和手动 sync，不能验证 runtime 事件接线：`my-plugins/scheduled-wakeup/test/boulder-sync.test.ts:139-155`。

**建议：** run 状态变化驱动业务同步，独立于 widget 是否显示；定义／注册变更必须使抑制 ID 缓存失效或更新。不能仅在 UI source 中补一个调用就声称整个 run 生命周期已覆盖。

### ❌ R8 — P2：双会话 E2E 新建 SECOND 后，仍向已关闭的 SESSION 发命令

**位置：** `my-plugins/scheduled-wakeup/test/e2e-tui.test.ts:53-67,486-506`。

该场景先 kill SESSION，再新建 SECOND，但随后的 send、enter、capture、waitFor、runCommand 都间接使用硬编码的 SESSION。第一条发往第二会话的启动命令已经指向不存在的 tmux target，因此不能执行所声称的“第二会话不接管”场景。这里是测试代码的确定接线错误；本次未运行它。

**建议：** 让该组 tmux helpers 显式接收 target，第二会话阶段全部使用 SECOND，owner 恢复后再使用 SESSION。

### ❌ R9 — P2：新增必填 `isStarting` 后，两个类型化 dispatcher stub 未迁移

**位置：** `my-plugins/scheduled-wakeup/src/task-dispatcher.ts:29-40`；`my-plugins/scheduled-wakeup/test/defer-command.test.ts:152-168`；`my-plugins/scheduled-wakeup/test/rename-command.test.ts:103-119`。

`TaskDispatcher.isStarting(taskId: string): boolean` 是必填成员。上述两个 `const runtime: LoopV2Runtime` 的 dispatcher 对象列出了其他方法，但没有 isStarting，不再满足显式类型要求。这是静态可判定的接口／调用方不一致，**不是本次已执行类型检查的结果**。

**建议：** 同步补全受影响 stub，保持必填接口；不要为了让旧 stub 通过而把生产所需方法改成 optional。适配完成后由实现方运行对应类型检查。

### ❌ R10 — P2：slash stop 改为异步后丢失 await／错误归属

**位置：** `my-plugins/scheduled-wakeup/src/loop-command-handler.ts:165-173`；宿主 handler 的同步调用边界：`my-plugins/scheduled-wakeup/src/extension.ts:122-156`。

stop 分支使用 `void (async () => { ... await stopOne/stopAll ... })()`，既不返回 Promise，也不捕获 rejection；外层 `handleLoopCommand` 仍返回 void。因而外层 try/catch 不能捕获终止过程中发生的异步异常。比如取消结果／marker 写入遇到普通文件系统错误，`writeJsonAtomic` 的异常可从 `catalog.cancelRunning` 或 `cancelPending` 传播出来（`my-plugins/scheduled-wakeup/src/v2/run-catalog.ts:89-100,124-132`），成为未处理 rejection，而不是命令错误通知。

**建议：** 将 stop 的异步完成与错误交还注册的命令 handler 并 await；至少必须在该 fire-and-forget Promise 上显式捕获并报告失败。成功后的相关同步也应位于真实完成之后，而不是仅在启动 IIFE 后执行。

### ⚠️ W3：新增测试覆盖正常例子，但不能排除本次关键交错

- fixture 的 `scan()` 返回同一个可变 views 数组，`startRun` 直接 push 到它；真实 scan 每次构造新数组。测试看不到“旧快照不包含新 run”的隔离，因而会遮蔽 R1/R4。证据：`my-plugins/scheduled-wakeup/test/task-dispatcher.test.ts:56-76` 对照 `my-plugins/scheduled-wakeup/src/v2/run-catalog-state.ts:62-86`。
- wedged 测试的 cancel mock 立即修改 target.state；末尾只断言该字段，没有取消后再次 dispatch 并证明新 run 启动。`cancelled.length === 1` 的等待条件在正常取消后始终成立，循环只是等待约一秒，不是“刷新完成”条件。证据：`my-plugins/scheduled-wakeup/test/task-dispatcher.test.ts:382-406`。
- starting 回归测试确实覆盖完成后第二轮派发；但没有 scan barrier、快照副本、扫描异常、慢 scan、stop／GC／dispose 的交错。证据：同文件 `:410-430`。不否定该测试的正常路径价值。
- E2E interval 断言 `/runs [12]/` 接受只跑一轮，恰好无法排除本次原始症状：`my-plugins/scheduled-wakeup/test/e2e-tui.test.ts:562-568`。
- E2E 主流程用 `once 1h` 后手动 run，却期待“completed schedule”及交付后 loop=false；手动 run 明确不推进调度。匹配整屏历史中的 loop=true/false 也不能证明本次状态迁移。证据：同文件 `:194-225` 对照 `:546-555`、`my-plugins/scheduled-wakeup/README.md:68`。

建议实现方后续使用可控的 scan Promise／timer、独立快照和真实 marker 状态，分别覆盖 R1–R7；无限时长用例可推进受控时钟，无需等待真实 32 分钟。本轮依指令不新增或运行这些测试。

### ⚠️ W5：今天的接线变化没有完整同步设计说明

- `inhibitBoulder` 创建默认值已为 true，但 `my-plugins/scheduled-wakeup/docs/ver-2.0/detailed-design.md:85` 仍写 default false；帮助文本也未呈现新的 `--boulder` 退出默认抑制入口。实现证据：`my-plugins/scheduled-wakeup/src/v2/loop-core.ts:65,74`、`my-plugins/scheduled-wakeup/src/v2/script-task-options.ts:29-43`、`my-plugins/scheduled-wakeup/src/v2/parse-v2-command.ts:59-87`。
- `my-plugins/scheduled-wakeup/docs/script-tasks/detailed-design.md:45` 仍写“由任意活会话按注册策略投递”，与当前 ownerSessionId 严格隔离相反。
- `my-plugins/scheduled-wakeup/docs/design/loop/subplans/loop-2-detached-run-delivery.md:181` 仍写“慢 wrapper → 恒 running，无超时强杀”。用户本次明确要求的 isWedged 改变了该边界，应在保留 null=unlimited 的前提下同步说明，而不是拿旧句子否决已获授权的修复。

### 逐 hunk 覆盖与未发现额外缺口的部分

以下清单记录代码／测试上下文覆盖，不将“读过”当成正确性证明；无额外发现仅指本轮五项标准下未找到新的确定问题。

| 文件组，相对 `my-plugins/scheduled-wakeup/` | 检查结果 |
| --- | --- |
| `src/task-dispatcher.ts`；`test/task-dispatcher.test.ts` | 本次未提交 hunks 与今天整段替换均已检查；R1–R5、R9，W1–W3。 |
| `src/v2/run-catalog.ts`、`src/v2/run-catalog-state.ts` | 新文件全文；对照启动、所有分类分支、取消等待、owner 过滤、终态 GC。作为 R1/R4/R5 及 W4 的跨文件证据。 |
| `src/v2/delivery-coordinator.ts`、`src/v2/delivery-actions.ts`、`src/v2/task-run-message.ts` | 新文件全文；idle／boundary／settled／cancel 的迁移关系见 R5/R6/W4；消息常量及正文映射未发现额外遗漏。 |
| `src/v2/create-loop-runtime.ts`、`src/v2/boulder-sync.ts` | 原今日改动与追加 hunks；初次 scan／poller 启动顺序见 R4，同步接线及缓存见 R7。 |
| `src/extension.ts`、`src/loop-command-handler.ts`、`src/v2/ai-session-actions.ts`、`src/v2/register-v2-tool.ts` | 命令、tool、live run 候选、取消及异步传播全部 hunks；R4/R5/R10。tool 的 execute→runAction→actions await 链已适配，问题在 slash stop 的 IIFE。 |
| `src/loop-running-widget.ts`、`src/loop-widget-items.ts`、`src/v2/format-list.ts`、`src/task-run-renderer.ts` | list/widget 共源、pending 行、running 计数、renderer 常量迁移上下文连贯；Waiting 零截断见 W2，可见性参与业务同步见 R7。 |
| `src/v2/loop-core.ts`、`src/v2/parse-task-command.ts`、`src/v2/parse-v2-command.ts`、`src/v2/script-task-options.ts` | 默认抑制、显式 false、命令解析与帮助变更；实现传递 false 的链路保留，文档差异见 W5。 |
| `src/script-tasks/execute-task.ts`、`src/script-tasks/run-script.ts`、`src/script-tasks/task-spec.ts` | RunnerOptions/index 传递与串行 await 的修改连贯；普通脚本失败后继续下一脚本的循环仍在。 |
| `src/script-tasks/runner-main.ts`、`src/script-tasks/run-script-logged.ts`、`src/script-tasks/run-record.ts`、`src/script-tasks/live-socket.ts`、`src/script-tasks/read-tail.ts`、`src/script-tasks/wake-up-content.ts` | 新文件及修改 hunks 全文对照；确认 status 不是心跳、null codec 保留、socket/日志/tail/正文衔接。R2/W1 的直接依据；未把外部 OS 故障或风格问题追加成另一轮全面审计。 |
| `test/delivery-coordinator.test.ts`、`test/run-catalog.test.ts`、`test/script-runner-main.test.ts`、`test/e2e-tui.test.ts` | 新文件全文；R8 与 W3。catalog GC／终态、wrapper 串行／取消确有对应断言，但不能替代 dispatcher 并发覆盖。 |
| `test/boulder-sync.test.ts`、`test/loop-boulder-lifecycle.test.ts`、`test/loop-boulder-integration-fixture.ts` | 新断言及 fixture 变更；bridge 手动同步与 runtime 自动同步不是同一覆盖，见 R7。 |
| `test/defer-command.test.ts`、`test/rename-command.test.ts`、`test/register-v2-tool.test.ts` | 扩展接口、异步 AI action、run-only 取消；新增 isStarting 的 stub 遗漏见 R9。 |
| `test/extension-resume.test.ts`、`test/outer-boundary-fixture.ts`、`test/loop-script-integration.test.ts` | hasPendingMessages、退订与异步 fixture、真实脚本 stop 断言迁移；恢复测试为 prompt，不覆盖存活 wrapper；脚本 stop 等状态文件出现，不覆盖立即 stop。 |
| `test/loop-running-widget.test.ts`、`test/widget-items.test.ts` | 展示断言随新排序、running/pending 形态更新；未发现本轮范围内的断言／实现脱节。 |
| `test/script-abort.test.ts`、`test/script-content.test.ts`、`test/script-path.test.ts` | options 参数迁移、时间戳、socket 路径及 null 准备语义；未覆盖 dispatcher 的 null 强杀。 |
| `test/v2-core.test.ts`、`test/v2-execution.test.ts`、`test/v2-shared-delete.test.ts` | AI action await 与默认抑制断言迁移；锁竞争测试仍在锁持有期间发起取消，未发现该迁移静默改变其核心断言。 |

## ❌ 清单与修复建议

| 编号 | 严重性／归属 | 确定问题 | 最小修复方向 |
| --- | --- | --- | --- |
| R1 | P1／本次新增 | 旧 scan 清掉新 run 的 starting，允许重叠派发 | 为本地启动与扫描建立代际／run 身份约束；旧快照不释放新占位。 |
| R2 | P1／本次新增 | null 无限超时被当成 1800 秒并强杀 | 显式保留 null；有限预算判断不得覆盖无限时长语义。 |
| R3 | P2／今天已有 | 无条件 tick 持续置 queued，刷新可永不排空；await 语义不成立 | tick 不制造无限 dirty 链；刷新等待绑定具体扫描代际。 |
| R4 | P1／今天已有 | 初次扫描前／新 run 尚未入缓存时重复启动或 stop 漏杀 | 首扫屏障；同步登记 startRun 返回值，所有生命周期入口共享事实。 |
| R5 | P1／今天已有 | stop 的 refresh 先 pump，取消中的正常完成结果被送出 | 第一个 await 前建立 run 级取消／投递屏障。 |
| R6 | P2／今天已有 | boundarySent 未参与去重，2 秒窗口内无崩溃重投 | in-flight run key 保留至交付确认，覆盖 pending 与 boundarySent。 |
| R7 | P1／追加修改仍未闭合 | Boulder 同步依赖 widget 可见性；旧 ID 缓存遗漏新 run | 业务同步脱离 UI；变更时维护／失效抑制缓存。 |
| R8 | P2／今天新增测试 | 第二会话 E2E 仍操作已 kill 的第一会话 | tmux helper 显式传 target，并贯穿全部第二会话操作。 |
| R9 | P2／追加修改引入 | 必填 isStarting 未补到两个类型化 stub | 补全 stub 后由实现方进行类型检查，不弱化生产接口。 |
| R10 | P2／今天已有 | slash stop 的异步 IIFE 无 await／catch | 将 Promise 交回宿主 handler 并捕获错误，或就地显式报告 rejection。 |

优先处理 R2 的误杀与 R1/R4 的重复执行，再修 R3/R5/R6 的收敛和投递状态衔接；R7–R10 同步补齐接线。W1–W5 分别限定 watchdog 能力、60 秒缓存迟发、测试证明范围、关闭后的在途副作用与文档一致性。本报告没有修改实现，也不以未运行的测试或已有通过声明代替这些修复的实际验证。
