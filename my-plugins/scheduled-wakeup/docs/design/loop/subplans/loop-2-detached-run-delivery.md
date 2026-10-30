# Subplan loop-2-detached-run-delivery

父级设计文档：`docs/ver-2.0/detailed-design.md`（Loop 2.0 core / 投递与关停契约）、`docs/script-tasks/detailed-design.md`（脚本执行与正文契约）、`README.md`（命令面与运行模式）。本子计划不回写新的 architecture.md；契约变更直接同步到上述三份文档（ownership 沿用插件既有结构）。

## 0. QPDI 锚点

Q.I（用户确认的规范方向）：

- I1 一条 run 的生命周期延续到**成功投递**那一刻，不是脚本跑完；`done`/`cancelled` 才是终态。
- I2 running 由独立 wrapper 进程执行，输出暂存磁盘（`./.pi` 下），wrapper 完成即写完成 JSON；会话退出不终止 run。
- I3 投递自持：不把消息扔进 pi 的 followUp 队列；忙时挂自己的队列，时点不早于 `agent_before_settle`（并入当次 run 的最后一次续请求）、不晚于 `agent_settled`；空闲时立即投递。
- I4 `/loop list` 与 widget 同源同步，显示包含 running 与待投递条目。
- I5 running 与待投递条目可被 cancel；待投递（尚未发出的消息）可撤回；已发出的不可撤回。
- I6 会话重进（resume）按 run 状态分流：已完成未投递→立即投递；仍在运行→采纳显示继续等；wrapper 失联→登记 lost 并按注册策略投递失败结果。

Q.A（认知前提，均已核实）：

- A1 POSIX-only：进程组信号是既有契约（`run-script.ts` win32 早退 start-failed），本子计划沿用。
- A2 pi 扩展无法操控内部 followUp 队列：`pendingMessages` 仅在 `BoundaryContextPreview` 只读暴露。
- A3 `pi.on("agent_before_settle", h)` 的 handler 返回 `AgentBeforeSettleEventResult = BoundaryResult`，可通过 `entries: [CustomMessageEntryDraft]` + `continue: true` 追加消息并确保最后一次 provider 请求（SDK types.d.ts L792-798, L1086, L1210）。
- A4 `ctx.isIdle()` / `ctx.hasPendingMessages()` 是公开扩展上下文方法。
- A5 非 OS daemon：投递只发生在某个活着的 pi 进程（交互会话或 `PI_SCHEDULED_WAKEUP_RUNNER=1` 的 runner）里。
- A6 wrapper 无法调用 pi 会话 API；磁盘 JSON 是唯一跨进程持久事实。

Q.E（经验支撑）：

- E1 会话内内存态（现 dispatcher 的 running Map 与 deliveryQueue）随进程死亡消失——本次改造的动因。
- E2 裸 pid 存活检测有 PID 复用误判风险；Node 无 flock，UDS bind 由内核保证进程死亡即不可连接，是死亡安全的 liveness 原语（已实测：活=connect 成功，死=ECONNREFUSED）。
- E3 wrapper↔会话的握手/推送通道被否决（本对话）：强制磁盘 JSON 旁边的 best-effort 通道是同一转移的两个事实源；亚秒级延迟收益不抵协议生命周期成本。

## 1. 范围

用户确认的改动：

1. run 目录：`.pi/scheduled-wakeup/v2/runs/<taskId>/<runId>/`，磁盘唯一事实源；状态机 `running → pendingDelivery → done | cancelled`（终态 `done`/`cancelled`），外加扫描期合成的 `lost`。
2. wrapper 独立进程执行脚本：输出落盘 + 有界 tail、SIGTERM 取消、逐脚本超时不变；复用 `executeScriptTask`/`shouldWakeUp`/`buildWakeUpContent`。
3. 自持投递协调器：idle 立即投递、busy 挂队列到 `agent_before_settle`（wake 并入当次 run；no-wake 只 append）、aborted/settled 兜底；prompt 直投同通道（内存态）。
4. resume 三分支采纳与 lost 合成。
5. `/loop list` 与 widget 同源（含 running/pendingDelivery）；`stop`/AI `cancel` 扩展到 running 与待投递。
6. 会话关闭不再杀 run（dispose 语义变更）；终态 run 的 GC。

不在范围：跨 cwd 的任务迁移、wrapper 推送通道与握手协议（E3 否决）、运行时改注册超时（静态 `timeoutSeconds` 已覆盖）、pi followUp 队列操控（A2 不可能）、Boulder 集成变更（进度驱动，与 run 记录无关）。

## 2. 现契约失效点

- ver-2.0："Session shutdown/reload disposes its runner … optional AbortSignal kills only owned groups … suppresses results" → 废弃：关闭不再杀 run、不抑制结果。
- ver-2.0 / README："Stop/cancel leaves an already-started batch running" → 废弃：stop 终止 live run。
- README "Delivery and modes"：wake 走 `deliverAs: "followUp"` 入队、no-wake 走 dispatcher 内部队列 → 废弃：统一自持投递。
- script-tasks：runScript "输出适合内存"、stdout/stderr 全量进正文 → 修订：输出落盘，正文携带 tail + log 路径。
- dispatcher 内存 `running`/`deliveryQueue`/`wakeInFlight` → 删除，由 run 目录与 coordinator 取代。

## 3. 运行记录数据结构

目录布局（全部原子写：临时文件 + rename）：

```text
runs/<taskId>/<runId>/
  task.json      启动前由会话写（先写后 spawn）
  live.sock      wrapper 启动即 bind 的 Unix domain socket（liveness 原语，内核保证进程死亡即失效；Node 无 flock，UDS bind 为死亡安全替代）。run 目录绝对路径超过 100 字节（macOS sun_path 上限）时，两端一致改用 tmpdir()/pi-sw-live-<sha1前16>.sock（live-socket.ts 的 liveSocketPath 单点推导）
  status.json    wrapper bind 后写、执行期间持续更新
  output/<NN>-stdout.log / <NN>-stderr.log    每脚本每流一个文件，追加写
  result.json    wrapper（或 lost 合成者）一次性写
  delivered.json 投递会话写（终态标记）
  cancelled.json 撤回时写（终态标记）
```

数据结构：task.json

字段：
- version: 1 — 常量
- taskId: string — 执行目标标识（与目录名一致；进度推进已在 dispatch 时完成，此文件仅供投递与显示）
- scope: "session" | "workspace" | "global"
- payload: { prompt } | { scriptTask }（可选 includeTimestamp）— 冻结的任务内容
- ownerSessionId: string — 投递归属
- startedAt: number — dispatch 时间戳

类型不变量：target.id 与目录名 taskId 一致；scriptTask 路径为 prepare 后的绝对路径（沿用既有不变量）。

数据结构：status.json

字段：
- pid: number — wrapper 进程 id
- currentIndex: number — 当前脚本下标（0 起）
- success / completed / total: number — 与现 RunningTask 口径一致（I=成功终态数，K=已结束尝试数，M=脚本数）
- updatedAt: number

数据结构：result.json

字段：
- cancelled: boolean — true 时整个 run 不投递
- results: readonly ScriptResult[] — stdout/stderr 为有界 tail（OUTPUT_TAIL_BYTES = 8192），新增可选 stdoutLog/stderrLog 绝对路径；status 枚举增加 "cancelled"
- successCount / shouldWake / completedAt / content — 与现 TaskRun 相同口径；content 由 wrapper 用 buildWakeUpContent 生成

生命周期（状态推导，纯存在性判定，优先级自上而下）：

```text
cancelled        cancelled.json 存在 ∨ result.json.cancelled === true
done             delivered.json 存在
pendingDelivery  result.json 存在 ∧ ¬cancelled ∧ ¬done
running          ¬result.json ∧ status.json 存在 ∧ connect(live.sock) 成功
stale-start      task.json 存在 ∧ status.json 不存在 ∧ startedAt < now − 30s（spawn 宽限期）
lost（瞬时）      ¬result.json ∧ status.json 存在 ∧ connect(live.sock) 失败（ECONNREFUSED/ENOENT）→ 扫描者合成 result.json{results:[{status:"failed", error:"runner lost"}]} → pendingDelivery；stale-start 同法合成（error "runner never started"）
```

GC：`done`/`cancelled` 的 run 目录按并集保留——最近 5 个之内、或 7 天之内的都保留，仅「排名 5 名之外且超过 7 天」者递归删除（README "whichever keeps them" 口径）；删除失败仅诊断，下次扫描自然重试。

## 4. 契约变更明细

### 4.1 wrapper（新增 `src/script-tasks/runner-main.ts`，改造 `run-script.ts`/`execute-task.ts`）

函数/模块名称：runner-main(runDir)（detached node 进程入口）

前置：runDir 内 task.json 合法；`--import tsx` 加载器路径由 spawn 方解析（见 4.2）。

后置（Ensures）：
- 持 live.sock bind 失败（已有 wrapper 活着）→ 立即退出，不写任何文件
- bind 成功后写 status.json，然后顺序执行全部脚本；逐脚本输出落 `output/NN-*.log`，stdout/stderr 内存仅保留 tail
- 每脚本开始前更新 status.json（pid/currentIndex/completed）- 全部结束后写 result.json：results + shouldWakeUp(wakeUp, results) + buildWakeUpContent（log 路径 + tail 形式）
- SIGTERM：killScriptGroup 杀当前脚本组 → 当前脚本 status:"cancelled"、剩余脚本不再执行并标记 "cancelled" → result.json{cancelled:true}（lost 不适用：正常退出路径）
- 脚本超时（armScriptTimeout 复用）语义不变：status:"timeout"

不变式：wrapper 存活期间 live.sock 恒可连接；result.json 至多写一次（原子 rename）；status.json 只在 bind 之后、result.json 之前写。

runScript 改造：spawn stdio 直连日志文件 fd（追加），close 后从文件读 tail；其余（进程组、超时、abort、错误口径）不变。executeScriptTask 透传 logDir，runner 闭包生成每脚本的日志路径。

### 4.2 run catalog（新增 `src/v2/run-catalog.ts`，必要时拆 scan/start 两文件）

接口：会话侧 → runs 目录

输入数据：workspaceRoot、sessionId；输出数据：run 状态列表、启动句柄。

协议约定：
- startRun(target)：mkdir run 目录 → 原子写 task.json → spawn wrapper（`process.execPath --import <tsxLoader> <pluginRoot>/src/script-tasks/runner-main.ts <runDir>`，detached、stdio ignore）→ 返回。win32 沿用 start-failed 口径：直接写 result.json{failed "POSIX process groups are required"}。spawn 同步异常 → 同 stale-start 合成。
- scan()：遍历 runs/**，按 §3 推导状态；对 owner 会话执行 lost/stale 合成与 GC；返回非终态 run 与待投递 run。
- liveness：`connect(run 目录/live.sock)`——成功即活，ECONNREFUSED/ENOENT 即死（内核保证，无 PID 复用问题）。connect 探测与 lost 合成之间 wrapper 不可能复活（bind 是独占的）。
- taskId 含 `:`（`session:<uuid>`、`registration:workspace:workspace:<uuid>`）——POSIX 路径段合法。

### 4.3 delivery coordinator（新增 `src/v2/delivery-coordinator.ts` + `delivery-actions.ts`）

函数/模块名称：DeliveryCoordinator（每会话一个）

前置：pi 事件总线可用；run catalog 已构造。

后置（Ensures）：
- pending 集 = owner 过滤后的 pendingDelivery run ∪ 内存 prompt 直投项
- 空闲（isIdle() ∧ ¬hasPendingMessages()）：wake → `sendMessage(…, {triggerTurn:true, deliverAs:"followUp"})`；noWake → 同调用 triggerTurn:false。发送后同 tick 原子写 delivered.json（发送先行、标记随后 → 崩溃夹缝 = at-least-once，重开重发一次，接受）
- 忙：挂队列。`agent_before_settle`：pending 逐条转 `CustomMessageEntryDraft` entries 返回；`shouldWake ∧ outcome ≠ "aborted"` 时 `continue:true`（并入当次 run 最后一次续请求）；noWake 只 entries 不 continue；aborted → 本事件不投，落 `agent_settled`
- `agent_settled`：按空闲规则 flush 全部 pending
- 撤回（cancel）：写 cancelled.json + 从 pending 集移除；若 delivered.json 已存在 → 报"已投递不可撤回"
- 会话关闭：仅停扫描间隔与退订事件；run 与 pending（磁盘部分）不受影响；prompt 直投项随进程丢失（无持久化义务）
- 活跃 run 存在期间持有 1s unref 扫描间隔（stat 级成本）；发现 result.json → 入 pending → pump

不变式：归属判定是 ownerSessionId 严格相等。compact 与 `-c` resume 保持同一 session id（compact 是文件内条目）；只有 fork 换 id。fork/旁观会话对他人 run 完全断联——零显示、零投递、零合成、零停止、零 GC、零磁盘接触；发现活跃外会话 run 时，把对应任务在本地登记 cancelled（本会话调度/追踪立即停止），并输出一次性 info 提示；对方 run 目录不受任何影响。owner 不回来结果就在磁盘等待，绝不转移（绝无领养）。cancelled 状态的 run 永不投递。

### 4.4 dispatcher 改造（`task-dispatcher.ts` 薄化）

- dispatch(target)：scriptTask → catalog.startRun；prompt → coordinator 直投入队。同步返回，进度推进时点不变（dispatch 时）。
- list()：catalog 扫描映射为 RunningTask（widget 口径不变）；deliveryStatus()：pending 集 wake/noWake 计数（语义从"队列中消息"改为"待投递消息"，UI 后缀文案同步）。
- 删除：内存 running Map、deliveryQueue、wakeInFlight、dispose abort 循环。dispose 仅退订。
- prompt-only 空脚本合成 always-wake 的既有行为保留（coordinator 直投）。

### 4.5 list/widget 同步（`format-list.ts`、`loop-widget-items.ts`）

- `/loop list` 输出与 widget 同源（collectLoopWidgetItems 同一数据）：Running 行 `Running (I/K/M) <cmd> · label`、Pending 行 `Pending delivery (wake|no wake) · label`、Waiting 行沿用现格式 + 待投递后缀。
- LoopWidgetItem 增加 `pendingDelivery?: { shouldWake: boolean }`；loopWidgetLines 相应分支。
- AI tool `action=list`：`active` 数组 schema 不变，message 文本追加 running/pending 行。

### 4.6 stop/cancel 扩展（`loop-command-handler.ts`、`ai-session-actions.ts`、`extension.ts` 接线）

- stop 候选 = active 任务 ∪ live run（running/pendingDelivery）；命中 active → cancelActive（删调度，现语义）+ 同 id 的 live run 一并终止；仅命中 run（任务已结束）→ 只终止 run。
- 终止 running：向 wrapper pid 发 SIGTERM（等 result.json{cancelled} 短暂轮询，超时 killScriptGroup 兜底）；终止 pendingDelivery → 撤回（4.3）。
- `stop all` = 全部 active + 全部 live run。文案区分"stopped/killed running batch/retracted pending delivery"。
- AI `action=cancel`：同一终止入口（AiSessionActions 注入 run 控制端口）。

## 5. 分布式契约（附录 A，文件系统信令）

1. 连接模型：无通道；通信 = run 目录文件（E3 否决推送通道）。N/A 重连。
2. 超时：脚本级 timeoutSeconds（静态）；扫描间隔 1s；SIGTERM 后 kill 兜底无额外等待承诺。
3. 重试与幂等：投递 at-least-once（发送先行、标记随后的崩溃窗口）；run 启动不重试（lost → 按失败投递）；标记文件原子写幂等。
4. 交付与顺序：无跨 run 顺序保证；单 run 内脚本严格顺序（既有）。
5. 失败模式：wrapper fail-stop（SIGKILL → live.sock 不可连接 → lost 合成）；会话崩溃 → run 留存；慢 wrapper → 恒 running，无超时强杀。
6. 状态与会话：全部状态在磁盘 run 目录；ownerSessionId 是投递归属键。
7. 背压：N/A（文件系统，无队列容量）。

## 6. 正确性论证

goal → 模块映射：I1/I3 → coordinator；I2 → runner-main + run-script；I4 → widget-items + format-list；I5 → stop 扩展 + coordinator.cancel；I6 → catalog.scan + coordinator.bootstrap。

- 状态推导完备性：§3 五状态由 (result.json, cancelled 标记, delivered.json, status.json, live.sock 可连性) 的存在性布尔组合穷尽——无 result.json 时仅有 running/lost/stale 三种，均有定义；有 result.json 时 cancelled/done/pendingDelivery 三分穷尽。
- lost 合成单写者：合成前提是 connect(live.sock) 失败，即 wrapper 必死（UDS 监听者由内核持有，进程死亡即不可连接）；已死者不可能再写 result.json，合成者写时无并发写者。
- 投递不丢：pendingDelivery 持久于磁盘；唯一删除路径是投递（delivered.json）或撤回（cancelled.json）；会话崩溃不删目录 → 重开后 scan 再入 pending。
- 撤回竞态：同 owner 进程内 cancel 与 pump 串行（事件循环），无窗口；跨会话 cancel 与 owner 投递存在微窗口，cancel 侧以 delivered.json 存在性判定"已投递不可撤回"，接受残余竞态。
- stop 杀 running 的终止性：SIGTERM → wrapper SIGTERM handler 同步路径（kill 组 + 写 result）有限步完成；异常时 killScriptGroup(SIGKILL) + lost 合成兜底 → 状态机仍收敛到终态。
- 关键假设：H1 POSIX UDS 语义（A1）；H2 before_settle entries+continue 按 SDK 文档生效（A3，测试以 fixture 断言返回值形态，真实模型流依赖 pi 契约）；H3 无 OS daemon（A5，README 明示）。

## 7. 命令面/帮助文本变更

- `/loop list` 帮助行：`Show this session's active set, live runs and pending deliveries`。
- `/loop stop <id|name|all>` 帮助行：`Stop tasks, registrations, live runs and pending deliveries`。
- `/loop running` 帮助行补"含 pending delivery 行"。

## 8. 测试计划

- run-record codec：task/status/result 往返、坏 JSON 拒绝、原子写。
- runner-main e2e（真实 spawn）：成功/失败/多脚本顺序/超时/SIGTERM 取消（剩余脚本不执行、cancelled:true）/输出文件与 tail 截断/log 路径/shouldWake/never 无 prompts 块。
- run-catalog：状态推导全分支；lost/stale 合成（锁持有→running；锁空闲→合成 failed）；GC 数量/年龄边界；startRun 先 task.json 后 spawn。
- delivery-coordinator：idle 立即（wake triggerTurn:true / noWake:false）；busy 挂起 → before_settle entries+continue；aborted → settled 兜底；撤回 pending；已投递不可撤回；owner 过滤；崩溃 at-least-once（重开重发）。
- dispatcher/widget：list 含 running/pendingDelivery；dispose 不杀进程。
- 命令层：stop 杀 running（改写现 loop-script-integration test3 契约）、stop 撤回 pending、stop all、AI cancel running、list 文本与 widget 同源。
- resume：runtime 启动三分支（done→投递、running→采纳显示、lost→合成后投递）；旧 session state（无 run 记录）兼容。

## 9. 文档同步清单

| 文档 | 改什么 |
|---|---|
| README.md | Delivery and modes（自持投递、before_settle/settled 时点、at-least-once）；Session close 不杀 run；stop 终止 live run；list/stop 帮助行；run 目录布局与 GC |
| docs/ver-2.0/detailed-design.md | dispatcher 投递段重写（coordinator）；stop/关停契约段重写；runtime wiring 补 run-catalog/coordinator |
| docs/script-tasks/detailed-design.md | runScript 落盘模式与 tail；ScriptResult 新字段与 cancelled 状态；buildWakeUpContent log 路径行；executeScriptTask logDir |

## 10. 完整性自检

- 推导连续/分支覆盖：状态推导、投递时机（idle/busy/aborted）、resume 三分支、stop 三类目标均显式
- 退出覆盖：wrapper 持锁失败退出、win32 start-failed、spawn 异常 stale-start、GC 失败诊断
- callee 契约：shouldWakeUp/buildWakeUpContent 由 wrapper 单点调用；状态推导不依赖 wrapper 内存
- 循环：scan 遍历有限目录；GC 数量有限
- 显式假设链：H1-H3 见 §6；A2 决定"不可能操控队列"而非"选择不操控"
