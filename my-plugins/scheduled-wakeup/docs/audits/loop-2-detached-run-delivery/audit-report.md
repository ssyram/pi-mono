# Loop 2 detached-run delivery 独立契约审核报告

## 独立抽取的 expectations（E1..E35）

先只读取四份契约，再固定以下清单，之后才读取实现材料。主契约为 `docs/design/loop/subplans/loop-2-detached-run-delivery.md`，下称 P；README 下称 R；`docs/ver-2.0/detailed-design.md` 下称 V；`docs/script-tasks/detailed-design.md` 下称 S。契约互相冲突的地方单列 ⚠️，不自行修改或裁决。

| 编号 | 独立 expectation | 契约来源 |
| --- | --- | --- |
| E1 | run 位于 `.pi/scheduled-wakeup/v2/runs/<taskId>/<runId>/`；task/status/result/delivered/cancelled JSON 原子写，输出为每脚本每流的追加日志。 | P §3、§4.1 |
| E2 | `task.json` 为 `version:1,target:{id,scope},content,ownerSessionId,startedAt`；内容冻结，准备后的脚本绝对路径与 includeTimestamp 保留。 | P §3 |
| E3 | status 含 pid/currentIndex/success/completed/total/updatedAt；I/K/M 分别为成功终态数、已结束尝试数、总脚本数。 | P §3、§4.1；V Script content |
| E4 | result 含 cancelled/results/successCount/shouldWake/completedAt/content；ScriptResult 增 cancelled 状态及可选 stdoutLog/stderrLog，字段满足所声明 schema。 | P §3；S 单脚本执行 |
| E5 | 推导优先级为 cancelled > done > pendingDelivery > running > lost；终态不退回运行态。 | P §3 |
| E6 | 有 status 且 socket 失联合成 runner lost；无 status 超过 30 秒合成 runner never started；按原 wake 策略生成失败投递，不重跑批次。 | P §3、§4.2 |
| E7 | 非 owner 会话不得合成、不得投递别人的 run；ownerSessionId 是投递归属键。 | P §4.2、§4.3、§5 |
| E8 | wrapper 独占 bind run 内 live.sock；bind 失败且已有活 wrapper 时不写文件；存活期间可连接，liveness 不依赖裸 pid。 | P §3、§4.1、§4.2 |
| E9 | result.json 至多写一次；wrapper 与 lost 合成者之间有真正的单写者约束，原子 rename 不等于允许覆盖已有结果。 | P §4.1、§6 |
| E10 | mkdir → task.json → detached wrapper spawn；stdio ignore，使用解析出的 tsx loader；dispatch 同步返回。 | P §4.2、§4.4 |
| E11 | win32 不 spawn，沿用 start-failed 与 POSIX process groups are required；同步 spawn 异常按启动失败合成。 | P A1、§4.2；S D.process |
| E12 | 脚本严格顺序、普通失败不 fail-fast；每项开始更新 status；stdout/stderr 直连追加日志。 | P §4.1；S 批次执行 |
| E13 | wrapper SIGTERM 终止当前脚本组，剩余脚本不执行并标 cancelled，整个 result.cancelled=true。 | P §4.1 |
| E14 | 原 timeout/普通失败语义保持，包括有限正数 timeoutSeconds、timeout 已触发时优先、spawn 失败归类。 | P §4.1；S D.prepare、D.process |
| E15 | 日志保存全量，结果/正文保留 8192-byte tail 和绝对日志路径，日志文本仍转义。 | P §3、§4.1；S D.process、正文与展示 |
| E16 | idle 且无宿主 pending messages 时立即投递：wake triggerTurn=true，noWake=false；不能把后续项停进 Pi followUp 队列。 | P I3、§4.3；R Delivery and modes |
| E17 | busy 自持 pending；before_settle 返回 custom entries；有 wake 且非 aborted 才 continue=true，noWake-only 不续请求。 | P §4.3 |
| E18 | aborted 的 before_settle 不投递，留给 settled 按 idle 规则兜底。 | P §4.3 |
| E19 | 真正发送/交付动作先于 delivered.json；崩溃夹缝只允许重复，不允许永久漏投；恢复重扫未标记结果。 | P §4.3、§5、§6；V Script content |
| E20 | 撤回写 cancelled.json 并移出 pending；cancelled 永不投递；已经投递必须报告不可撤回。 | P §4.3；V Stop/cancel |
| E21 | stop running 必须 TERM → 等取消结果 → KILL → 合成 cancelled 兜底；不会把 stop 结果当普通失败继续投递。 | P §4.6、§6；V Stop/cancel |
| E22 | stop 候选含 active 与仅剩 run 的目标；active 命中要同时处理同 ID run，stop all 两者全处理，文案区分 stopped/killed/retracted。 | P §4.6；R Commands |
| E23 | AI cancel 扩展到 running/pendingDelivery，使用同一完整终止入口。 | P §4.6 |
| E24 | dispose/关会话只停扫描与退订，不杀 wrapper、不抑制磁盘结果、不再继续旧会话的投递工作。 | P I2、§4.3、§4.4；V Stop/cancel |
| E25 | 活跃 run 有 1 秒 unref 扫描；resume 将完成未投、仍活、失联三种分别投递、采纳显示、合成失败。 | P §4.2、§4.3、§8 |
| E26 | 终态 GC：每 task 最近 5 个且在 7 天内，由 owner 扫描处理；删除失败仅诊断不重试。 | P §3、§4.2；R Script tasks（存在保留条件冲突，见 E35） |
| E27 | dispatcher 同步保持原进度推进时点，同 ID overlap 仍拒绝；不能等一次异步 refresh 后才建立互斥。 | P §4.4；R:68；V Script content |
| E28 | prompt 和 prompt-only 空脚本 always-wake 走 coordinator 自持内存直投；不经宿主 followUp 排队。 | P §1、§4.3、§4.4 |
| E29 | list/widget 共用 collectLoopWidgetItems，同 ID 合并，Running/Pending delivery/Waiting 与待投递后缀一致，运行/待投优先。 | P §4.5；R:64 |
| E30 | AI list 的 active 数组 schema 不变，message 补 running/pending 行。 | P §4.5 |
| E31 | tui/rpc 与受控 print/json 模式契约保留；runner 模式需保活到工作完成，普通交互扫描可 unref。 | R Delivery and modes；P A5 |
| E32 | 文档承诺的 failed/locked/unavailable delivery 不应热循环，按 60 秒退避重试。 | R:98；V Runtime wiring（重试作用域措辞不完全相同） |
| E33 | includeTimestamp 在持久化恢复后仍按开关重建正文：true 使用原 completedAt 和实际 sentAt，未开启不擅自加时间戳。 | P §3 冻结内容与 includeTimestamp；现有时间戳开关语义 |
| E34 | 复用 shouldWakeUp/buildWakeUpContent；never 不唤醒且无 prompts，on-error 按 and/or 聚合，动态正文转义，空字段不打印。 | P §4.1；S shouldWakeUp、buildWakeUpContent |
| E35 | 四份文档的公开命令、关闭/取消、输出与 GC 叙述应一致；冲突仅标警告，不以实现替文档作选择。 | P §2、§9 |

## 逐条判定（✅/⚠️/❌ + 证据）

### 引用与方法

- 下列 `src/...`、`test/...` 行号均以提供的 `/tmp/loop2-audit/new-files/` 快照为依据，对应插件下的文件路径。
- `patch:Lx` 指 `/tmp/loop2-audit/diff-tracked.patch` 的物理行；同时给出文件或 hunk，未读取仓库中这些实现文件的全文。
- ✅ 表示限定材料中该项改动对齐，不是对未提供的旧代码或真实 SDK 的全面运行证明。❌ 是有具体输入/时序的确定违反；⚠️ 是部分偏离、契约冲突或必须保留的验证边界。
- Non-Decisional：可按现有契约直接对齐。Decisional：文档/设计有实质分歧，需先选择规范，不在本审核中裁决。
- 所有反例为静态代码路径推演；按要求未执行测试，也未启动 wrapper 或运行验证程序。

### E1 ✅ run 布局、追加日志与 JSON 原子写

证据：`src/v2/run-catalog.ts:47-75` 创建 task/run 子目录，先原子写 task；`src/script-tasks/run-record.ts:6-13,61-73` 定义记录文件并用 temporary+rename 写入；`src/script-tasks/run-script-logged.ts:14-35,50-55` 生成 NN 日志并使用 `openSync(...,"a")` 直连 stdio。`wrapper.pid` 为额外辅助文件，README:68 已列明。socket 实际位置的例外单列 E8，不据此否定 JSON 原子性。

### E2 ❌ task.json 与权威契约的 schema 不兼容

- **分类**：Non-Decisional。
- **规范**：P §3 为 `target:{id,scope}` 和 `content`，version 为 1。
- **实现**：`src/script-tasks/run-record.ts:22-29,84-99` 要求顶层 `taskId/scope/payload`；`src/v2/run-catalog.ts:59-67` 也只写此结构，没有读取权威结构的分支。
- **反例**：在 `runs/session:a/r1/task.json` 放入 `{"version":1,"target":{"id":"session:a","scope":"session"},"content":{"scriptTask":{"wakeUp":{"kind":"always","prompt":"p"},"scripts":[]},"includeTimestamp":true},"ownerSessionId":"s1","startedAt":1}`。这是文档 schema；parseTaskRecord 因没有顶层 taskId/scope 拒绝，wrapper 在 `runner-main.ts:22-24` 退出 2，scanner 在 `run-catalog-state.ts:74-75` 跳过整个 run。
- **影响**：按文档生成/消费磁盘记录的工具无法集成，合法记录连 lost/stale 恢复都进不去；相同 version:1 不能表达两种结构的差异。
- **根因**：持久化字段改名未同步权威 schema，新增 round-trip 测试 `test/script-runner-main.test.ts:184` 只覆盖实现自有格式。

### E3 ✅ status 字段与普通运行的 I/K/M

证据：`src/script-tasks/runner-main.ts:37-55,80-88` 写完整 status，在每项开始、完成后更新；dispatcher `patch:L647-L665`（`task-dispatcher.ts` 大 hunk）映射 status 到 RunningTask。跳过的剩余脚本不是已执行尝试，不要求增加 K。小数 timeout 导致整项丢失另列 E14。

### E4 ⚠️ 新字段存在，但 result codec 的类型承诺不成立

- **分类**：Non-Decisional。
- **符合部分**：task-spec diff `patch:L304-L332` 增加 cancelled/stdoutLog/stderrLog；`run-record.ts:40-47` 的顶层结果字段齐全。
- **偏离证据**：`src/script-tasks/run-record.ts:122-146,211-224` 的 isScriptResult 只检查 script，不验证 status、exitCode、signal、stdout、stderr、error；结果数组还用 filter 静默丢弃无效项。
- **反例**：`parseOutcome({cancelled:false,results:[{script:{cwd:"/w",path:"/bin/true",params:[],timeoutSeconds:1}}],successCount:0,shouldWake:true,completedAt:1,content:"cached"})` 返回 RunOutcome，而该项不是 ScriptResult。若对应 payload.includeTimestamp=true，`delivery-actions.ts:35-40` 将其送入正文重建，缺失 stdout/stderr 会破坏字符串处理；不开时间戳也会向 details 暴露不符合声明类型的结果。
- **影响/根因**：磁盘边界无法可靠拒绝错误 schema；不把外部畸形记录当作正常 wrapper 必然会产生的记录，因此列部分偏离而非扩大为普通执行必失败。

### E5 ✅ 合法记录的状态优先级正确

证据：`src/v2/run-catalog-state.ts:90-119` 明确先 cancelled 标记或 result.cancelled，再 delivered，再 result，再 liveness，最后 lost。即使 cancelled 与 delivered 同时存在，cancelled 仍优先。注意实现先 parse 标记，而主契约用“纯存在性”措辞；本项对实现正常写出的合法标记成立，不将损坏标记文件额外假定为正常输入。

### E6 ✅ 正常 lost/stale-start 分支及失败策略存在

证据：`src/v2/run-catalog-state.ts:25,102-119,124-153`：30 秒宽限、两种错误文字、owner 合成及 shouldWakeUp/buildWakeUpContent 都有；不重新执行脚本。`test/run-catalog.test.ts:96,112,122` 有对应断言，但未运行。合成时与完成写入的竞态违反 E9；时间戳的特殊分支违反 E33。

### E7 ❌ 非 owner 会话会投递并终结别人的 run

- **分类**：Non-Decisional。
- **规范**：P §4.3 的 pending 必须 owner 过滤，投递只能由 ownerSessionId 会话执行。
- **实现证据**：`src/v2/run-catalog-state.ts:49-65` 返回所有会话的 run；dispatcher `patch:L552-L561` 对每个 view 调用 enqueueRun；`src/v2/delivery-coordinator.ts:84-100` 不比较 ownerSessionId，直接设置 `owner:true`。
- **反例**：同 cwd 的会话 A 留下 `ownerSessionId:"A"` 的未投递 result；空闲会话 B 打开。B scan 得到 pendingDelivery，直接 sendMessage 并写 sessionId 为 B 的 delivered.json。A 下次打开时看到 done，不再向正确会话投递。A、B 同时扫描还可能各发一次，不需要任何进程崩溃。
- **影响**：结果泄露/注入错误会话，正确归属会话丢结果；单写者与重复投递上界均失效。
- **根因**：存在 owner 布尔字段但没有建立其来源不变量。非 owner 的 lost 合成确实有 guard（state.ts:111），不能据此推断投递也受保护。GC 的 owner 缺口见 E26。

### E8 ⚠️ liveness 原语保留，但真实 socket 路径超出文档模型

- **分类**：Decisional（是否正式接受并文档化 tmpdir 依赖）。
- **符合部分**：`runner-main.ts:103-121` 独占 bind，已有可连监听者时退出；catalog 使用 socket 而非 process.kill(pid,0) 推导 running。
- **偏离证据**：`src/script-tasks/live-socket.ts:16-20` 在直接路径长度超过 100 时改用 `tmpdir()/pi-sw-live-<hash>.sock`。P §3/§4.2 只约定 run 内 live.sock。
- **反例**：采用新增路径测试中的 `/Users/ssyram/workspace/ai-tools/pi-mono/.pi/scheduled-wakeup/v2/runs/session:01234567-89ab-cdef-0123-456789abcdef/1793333959533-2438366f`（`patch:L1348-L1365`）。活 wrapper 不在 run 目录建立 live.sock；按契约直接连接该路径的诊断/采纳者得到 ENOENT，而两端实现实际连接 tmpdir 路径。
- **影响**：依文档实施 liveness 的集成误报失联；两进程还增加了必须共享相同 tmpdir 环境的条件。实现自有两端使用同一 helper，所以不能把所有深路径运行判为失败。
- **残余风险**：`live-socket.ts:31-33` 将 timeout 和所有 connect error 都当 false，而契约只把 ECONNREFUSED/ENOENT 当死亡证据；本次没有运行故障注入，未把这一点另计确定 ❌。

### E9 ❌ scanner 能覆盖 wrapper 已成功写出的 result

- **分类**：Non-Decisional。
- **规范**：P §4.1/§6 要求 result 至多写一次，并以 wrapper 必死保证 lost 合成无并发写者。
- **实现证据**：`src/v2/run-catalog-state.ts:76-77` 先读 result/status，随后 `:102-105` 异步探测 socket，`:111-118` 直接写合成 result；没有在探测后重新确认 result。`writeJsonAtomic` (`run-record.ts:61-65`) 的 rename 会覆盖目标。
- **具体交错**：① owner scanner 读 result 不存在；② wrapper 在另一进程完成，按 `runner-main.ts:59-77` 写真实 result 后关闭 socket；③ scanner 执行/完成 connect，得到失联；④ scanner 写 `runner lost`，覆盖真实结果。此时“socket 不可连”只证明 wrapper 现在结束，不证明它在先前读取之后没有写结果。
- **影响**：成功脚本被报告失败、原输出/成功计数丢失，on-error 可能错误唤醒。此反例不依赖双 owner、不依赖文件损坏，也没有要求重试启动。
- **根因**：跨进程读结果与 liveness 不是一致快照；原子替换只保证完整 JSON，不保证 create-once。stop 期间的合成写者也没有与普通扫描协调，见 E21。

### E10 ✅ task 先写、detached spawn 与同步返回

证据：`src/v2/run-catalog.ts:47-76,125-141` 先 task 再 spawn，命令为 process.execPath/--import/tsx loader/runner-main/runDir，detached+stdio ignore+child.unref。dispatcher 的 dispatch 不 await 运行完成（`patch:L583-L642`）。spawn 同步异常只返回 undefined，之后走 stale-start，具体与 win32 口径见 E11。

### E11 ❌ win32 被错误标为 failed，而不是 start-failed

- **分类**：Non-Decisional。
- **规范**：P A1/§4.2 与 S D.process 沿用 Windows 早退 start-failed，无 spawn。
- **实现证据**：`src/v2/run-catalog.ts:68-71,149-167` 直接调用 failedOutcome；`src/v2/run-catalog-state.ts:136-143` 将 status 写死为 `"failed"`。
- **反例**：win32 上 dispatch 一条含一个脚本的 scriptTask，例如 `{path:"C:\\x.exe",cwd:"C:\\",params:[],timeoutSeconds:1}`。不 spawn 且错误文字正确，但 result.results[0].status 为 failed，契约应为 start-failed。
- **影响/根因**：消费者无法区分平台拒绝启动与脚本实际执行失败；通用 lost 合成函数被复用于平台启动拒绝，丢失原错误分类。无 spawn 部分符合，不据此掩盖 enum 差异。

### E12 ✅ 普通批次仍严格顺序、日志追加、每项更新

证据：execute-task diff `patch:L219-L227` 仍逐项 await runner，并增加 index；`runner-main.ts:42-57` 在执行前后写 status；`run-script-logged.ts:33-55` 用 fd 追加，不依赖管道攒全量。新增真实 wrapper 测试 `test/script-runner-main.test.ts:76-111` 覆盖 success 后 failed、日志及 completed=2；这里只阅读断言，没有运行。

### E13 ✅ 正常 SIGTERM 路径跳过剩余脚本并标记整个 run cancelled

证据：`runner-main.ts:26-31` 设置 cancelled 并 abort；`:44` 为未启动的剩余项返回 cancelledResult；`:54-60,91-100` 将通常的 abort failed 转 cancelled，并写顶层 cancelled。`run-script-logged.ts:72-76` 终止当前脚本组。新增测试 `test/script-runner-main.test.ts:140-162` 明确断言两项 cancelled、顶层 true、后续 marker 不产生。已经先触发 timeout 的优先级按原契约保留；不将其擅自解释为必须覆盖 timeout。

### E14 ❌ 合法的小数 timeout 会使脚本被静默删除

- **分类**：Non-Decisional。
- **规范**：S D.prepare 接受 null 或有限正 number；P 要求逐脚本 timeout 语义不变。
- **实现证据**：`run-record.ts:189-193` 用 filter(isScriptSpec) 解析脚本；`:211-218,240-243` 用非负整数 count 校验 timeoutSeconds。
- **反例**：合法准备后脚本 `{cwd:"/w",path:"/bin/sh",params:["-c","echo must-run"],timeoutSeconds:0.5}`，策略 always。startRun 正常写 task.json；wrapper 读取时 filter 丢掉此脚本，得到 scripts=[]，根本不执行 echo，result.results=[]，而不是运行且在 0.5 秒超时。
- **影响**：已经接受的用户任务不执行，没有明确输入错误，还可能被表现为空批次成功式唤醒。
- **根因**：运行记录 codec 的 timeout 约束强于 prepare，而且用过滤代替拒绝，跨持久化静默改变任务。现有 wrapper timeout 测试使用整数 1，不能发现此反例。

### E15 ✅ 落盘与 tail/log-path 正文接线对齐

证据：`run-script-logged.ts:86-98` close 后 readTail，返回 stdoutLog/stderrLog；`read-tail.ts:3,14-19` 从末尾读取最多 8192 bytes；日志 fd 直接接子进程，保存全量。正文 diff `patch:L356-L368` 新增两个 log 字段且调用 escapeMarkup。新增测试 `script-runner-main.test.ts:164-181` 保存 64KiB 日志、检查 tail；未运行。UTF-8 解码末尾可能有替换字符，本契约未规定字节切边后的 Unicode 修复，不额外扩张义务。

### E16 ⚠️ 单项 idle 发送符合，批量 flush 只检查一次 idle

- **分类**：Non-Decisional；真实宿主的 turn-start 同步时序需要验证。
- **符合证据**：`delivery-coordinator.ts:49-59` 检查 isIdle 与 hasPendingMessages；`delivery-actions.ts:71-80` 按 shouldWake 设置 triggerTurn。`deliverAs:"followUp"` 本身是 P §4.3 明文指定的调用选项，不能仅凭这个字符串判为使用了宿主队列。
- **边界反例**：pending 中有 A、B 两条 wake；settled 触发 pump，首次 idle 检查通过；发送 A 后宿主已进入忙态（ctx.isIdle() 已变 false），循环仍立刻发送 B，不重新检查 `:53`。B 由 followUp 选项按忙态路由，未留在 Loop pending 等 before_settle。
- **影响/根因**：一旦公开 API 的 triggerTurn 在调用后即可改变忙态，批量发送便违背自持排队要求。单条 idle 测试不覆盖该状态变化；本次未读取 SDK 源码或运行集成，不将该宿主时序条件升级为无条件 ❌。

### E17 ✅ busy before_settle 的 entries/continue 形态正确

证据：`delivery-coordinator.ts:62-79` 构造 custom entries，有任意 shouldWake 才 continue=true，否则只有 entries；`delivery-actions.ts:83-99` 返回正确 custom_message draft。busy 入队不调用 sendMessage。`test/delivery-coordinator.test.ts:110-139` 有 wake/noWake-only 断言。此项只确认时点与返回形态；持久标记顺序另由 E19 否定。

### E18 ✅ aborted → settled 的明确分支存在

证据：`delivery-coordinator.ts:65,82`，aborted 直接返回，不清 pending；settled 再 pump。测试 `test/delivery-coordinator.test.ts:141-155` 在 idle settled 后检查 triggerTurn=true。若 settled 后仍有宿主 pending messages，pump 按 idle 规则保留，符合契约前提。

### E19 ❌ boundary 路径先写 delivered，再把 entries 交给 Pi

- **分类**：Non-Decisional。
- **规范**：P I1/§4.3/§5 与 V 指定“发送先行、标记随后”，崩溃窗口允许重复但不允许漏投。
- **实现证据**：`delivery-coordinator.ts:70-79` 先构造 entries，在循环中删除 pending、写 delivered.json，最后才 return entries。此时 Pi 尚未取得 handler 的返回值，更不可能已应用该 entries。
- **反例时序**：busy session 有磁盘 pending；before_settle handler 成功写 delivered.json 后、return 前进程被 SIGKILL。没有任何 entries 交给宿主；重开按 delivered.json 推为 done，永久不重发。无需假设 SDK 应用失败，仅 handler 返回前的崩溃就足够。
- **影响**：at-least-once 被破坏为可能零次。多项时，第二项标记抛错也可能令第一项已经标记但整个返回值未产生。
- **根因**：把“draft 已构造”当成“发送动作已执行”。idle 路径 `:43-47` 确实 sendNow 后才 mark，不能证明 boundary 路径也正确。

### E20 ❌ cancelPending 不检查已经投递，仍写 cancelled 并声称撤回

- **分类**：Non-Decisional。
- **规范**：P §4.3 已存在 delivered.json 时报告已投递不可撤回。
- **实现证据**：`delivery-coordinator.ts:132-141` 不调用 retractable、不读 delivered，直接删 pending、写 cancelled、递增 retracted；`run-catalog.ts:89-95` 也无拒绝分支。
- **反例**：busy coordinator 已持有一条 pending；在调用 cancelPending 之前，另一个进程已经完成发送并写入该 run 的合法 delivered.json（E7 使不同会话实际可走此路径）。此时调用 cancelPending(taskId)，返回 1 并新增 cancelled.json，而不是报告不可撤回。delivered 在撤回调用前已存在，不是契约接受的“检查后才同时发送”的微窗口。
- **影响**：UI/命令说已撤回，消息实际上已经进历史；状态优先级还把本来 done 的 run 显示为 cancelled。
- **根因**：pump 有标记再检查，cancel 路径遗漏同一条件；正常 cancelled run 不被投递的过滤本身存在。

### E21 ❌ stop 的完成竞态与强杀兜底不能保证 cancelled 且停止脚本

- **分类**：Non-Decisional。
- **规范**：P §4.6/§6、V Stop/cancel 要求终止 live run、必要时强杀并收敛为不投递的 cancelled。
- **证据**：`run-catalog.ts:97-120,189-195` 的 waitFor 只判断“任意 JSON result 存在”，不检查 cancelled；SIGKILL 针对 wrapper pid 的进程组。脚本由 `run-script-logged.ts:50-55` 另以 detached:true 启动，与 wrapper 不是同一组。
- **反例 A（普通竞态）**：dispatcher 缓存 view=running；随后 wrapper 完成写 `cancelled:false` 的结果，尚未被下一次扫描采纳。此时 stop 命中旧 running view，cancelRunning 看到已有 JSON 立即返回 cancelled，不写 cancelled 标记。后续 refresh 把该结果入队并发送。stop 没有撤回 stop 时仍未发出的消息。
- **反例 B（SIGKILL 兜底）**：脚本运行 `/bin/sh -c 'sleep 10; echo survived > /tmp/loop-stop-marker'`，对 wrapper PID 发 SIGSTOP 令 handler 无法执行，再调用 stop。3 秒后 killScriptGroup(wrapperPid) 杀 wrapper 组，但 detached 脚本组仍活着，之后写出 survived；即使会话合成 cancelled，也没有停止实际脚本。若正常 1 秒扫描先看到 wrapper 死亡，还会合成非 cancelled 的 runner lost，waitFor 将其当作取消完成并可能投递。
- **影响**：用户收到“killed/stopped”后脚本仍有副作用，或取消产生不应发送的结果。
- **根因**：把任意结果存在当作取消确认；停止流程与普通 lost 合成没有协调；强杀兜底没有当前独立脚本组的身份。

### E22 ❌ stop 的并集有接线，但遗漏内存 pending 与 run-only 名称

- **分类**：Non-Decisional。
- **符合部分**：命令 diff `patch:L42-L102`，stopOne 构造 active+run ID 候选；stopAll 遍历 active 和 live run；文案区分 killed/retracted。
- **偏离证据**：dispatcher `patch:L675-L755` 的 requestRunTermination/terminateTaskRuns 只在 views 中存在 pendingDelivery 时才调用 coordinator.cancelPending；liveRuns 也仅来自磁盘 views。命令的 run-only 候选仅 `.map(id => ({id}))`，没有 name（`patch:L63-L73`）。
- **反例 A**：busy 时 dispatch 一个普通 prompt，coordinator 已持有内存 pending。对其仍 active 的任务执行 stop，active 被删除，但没有磁盘 pendingDelivery view，因此不调用 cancelPending；before_settle 仍注入刚刚“停止”的 prompt。若是已完成的 prompt one-shot，其 ID 连 stop 候选也没有；stop all 同样遗漏这条内存项。
- **反例 B**：名为 nightly 的 script one-shot 完成调度，只剩未投递磁盘 run；`/loop stop nightly` 失败，因为 run-only 候选没有 name；相同 run 的精确 ID 可命中。
- **影响/根因**：用户不能可靠撤回所有尚未发出的消息；候选源和终止遍历只覆盖 active+磁盘 views，没有完整 coordinator pending，也没有保留 run-only 的名称信息。

### E23 ❌ AI cancel 未共用完整终止入口

- **分类**：Non-Decisional。
- **规范**：P §4.6 指定 AI cancel 走同一终止入口，而不是只请求信号。
- **实现证据**：AI port 与 execute diff `patch:L822-L880` 仅注入同步 requestRunTermination；runtime `patch:L894-L910` 接至 dispatcher.requestRunTermination，而命令用异步 terminateTaskRuns。dispatcher request 路径 `patch:L675-L706` 只向 status.pid 发一次 SIGTERM，没有 wait/KILL/cancelled 合成，也没有读取 wrapper.pid 的启动窗口 fallback。
- **反例**：一个仍 active 的 script 任务已有 live run，对 wrapper 发 SIGSTOP 后调用 `scheduled_wakeup {action:"cancel",id:<该active任务ID>}`。工具报告已 signalled；wrapper 无法处理 TERM，之后没有任何 KILL 超时，live script 继续运行。命令 stop 的 3 秒兜底根本没有被调用。
- **影响**：AI 与用户命令的 cancel 语义不同，AI 无法保证停掉 live run。status 尚未产生时，request 路径也直接跳过该 run。
- **额外验证边界**：patch 没展示 cancel 目标 resolver 的完整构造；port 也没有 run 候选查询。本次不把“所有 run-only ID 必然无法解析”作为已完全证明的第二个 ❌，但没有材料证明该范围扩展已完成。
- **根因**：为保留同步 execute 另建了弱化终止端口，而非复用完整终止协议。

### E24 ⚠️ dispose 不杀进程符合，但在途 refresh 可以在 dispose 后继续发送

- **分类**：Non-Decisional。
- **符合证据**：dispatcher dispose `patch:L777-L792` 只置 closed、clearInterval、coordinator.dispose；未 abort 或发送信号。coordinator `:143-145` 只退订。
- **偏离反例**：refresh 通过入口 closed 检查后 await catalog.scan；在该 await 期间 session_shutdown/dispose；scan 随后返回 pendingDelivery。refresh 的 await 后没有 closed guard（`patch:L552-L561`），仍调用 enqueueRun；coordinator.dispose 也无 closed 标志，所以 enqueueRun/pump 仍可能 sendMessage 并写 delivered.json。
- **影响/根因**：关会话或替换 runtime 后，旧实例仍可能消费磁盘 pending，不能保证“仅停止、留待恢复”；退订只影响后续事件，不能停止已在途的异步扫描。未把“不杀进程”本身误判为失败。

### E25 ✅ 扫描间隔与 resume 三分支具备

证据：dispatcher `patch:L579-L582` 1 秒 setInterval+unref 并立即 refresh；scan 推导为 running/pendingDelivery/lost 合成，list 映射 running，enqueueRun 处理 pending。普通无 run 的旧 session 只是得到空扫描，不要求迁移。这里的 ✅ 不覆盖 E7 owner 漏筛、E9 写者竞态和 E31 runner 保活例外。

### E26 ⚠️ GC 选择了与主契约不同的保留逻辑，且 owner/诊断约束不足

- **分类**：Decisional（保留策略有文档冲突）；owner 与失败处理偏离本身为 Non-Decisional。
- **证据**：`run-catalog-state.ts:63,156-167`：只有“排名五个之外且超过七天”才删除；没有按 owner 过滤；删除异常静默吞掉，下次 scan 仍会再次尝试。
- **反例 1**：同一 task 六个一天内终态，全部保留；一个八天前终态也保留。P §3“最近 5 个且 7 天内，超出者删除”不满足；但 R:68 的“whichever keeps them”支持这种并集保留。`test/run-catalog.test.ts:186-205` 明确选择保留超过七天的最新五个，体现测试与 P 不同。
- **反例 2**：A 的 task 有七个八天前终态，B 在同 cwd scan，B 也删除其中两个；P §4.2 说 owner 会话执行 GC。终态目录只读导致 rmSync 抛 EACCES 时，没有诊断，而且每秒会重试，不是“仅诊断不重试”。
- **影响**：操作者无法从文档确定磁盘上限/保留时间；其他会话会触发删除，删除失败不透明且反复尝试。不替项目选择 AND 还是 OR。

### E27 ❌ 同 ID 同步连续 dispatch 可重叠启动

- **分类**：Non-Decisional。
- **规范**：R:68、V Script content、P §4.4 保留 same-ID overlap refusal。
- **实现证据**：dispatcher `patch:L583-L609` 只查缓存 views，调用 catalog.startRun 后忽略其返回 view，然后异步 refresh。refresh 内 `await catalog.scan()` 尚未完成时 views 不变（`patch:L536-L566`）。
- **反例**：初始 views=[]；同一同步调用栈依次执行 `dispatcher.dispatch(T); dispatcher.dispatch(T)`，T 为同 ID 的合法 scriptTask。第一次 spawn 后触发 refresh，但更新 views 需要 await；第二次仍看到空 views，再建新 run 目录并 spawn。应当第二次立即抛 already running。
- **影响**：相同脚本产生重复副作用，manual run 与 timer 紧邻也可能重叠。
- **根因**：删除内存 running Map 后没有同步占位/纳入 startRun 返回值。新增同 ID 测试 `patch:L1533-L1590` 在第二次 dispatch 前先 await refresh，无法暴露这个反例。

### E28 ⚠️ prompt 自持直投符合，零脚本 scriptTask 未按契约直投

- **分类**：Non-Decisional。
- **符合证据**：`delivery-coordinator.ts:102-118` 和 `delivery-actions.ts:47-68` 构造 always-wake prompt，busy 留内存；不是 sendUserMessage。
- **偏离反例**：dispatch `{id:"session:empty",scope:"session",scriptTask:{wakeUp:{kind:"always",prompt:"p"},scripts:[]}}`。dispatcher 的 `scriptTask !== undefined` 分支无长度判断（`patch:L602-L609`），仍 startRun/spawn wrapper，而 P §4.4 说 prompt-only 空脚本保留 coordinator 直投行为。
- **影响**：本来无需进程的空批次引入 loader/OS/socket 依赖及异步扫描延迟；在 win32 还进入 platformBlockedOutcome，而不单纯走 prompt-only 路径。一般情况下最终内容仍可生成，故列部分偏离。prompt 停止漏洞见 E22；批量 flush 的 followUp 风险见 E16，不把 deliverAs 字面值单独当错误。

### E29 ✅ list/widget 数据源与三类展示合并已对齐

证据：`format-list.ts` diff `patch:L931-L970` 直接调用 collectLoopWidgetItems；widget diff `patch:L132-L213` 同 ID Map 合并、running/pending 排序、Pending delivery 行、Waiting 后缀均有；命令 list `patch:L5-L22` 传 dispatcher.list/deliveryStatus。active recurring 有 pending 时显示 Waiting+后缀，run-only pending 显示 Pending delivery，符合 P §4.5 的区别。run-only 名称缺失已在 E22 作为具体命令影响报告，不重复计数。

### E30 ✅ AI list 的结构和补充文本符合

证据：`ai-session-actions.ts` diff `patch:L843-L854` 仍返回原 active 数组，message 使用可注入 formatOverview；`create-loop-runtime.ts` diff `patch:L894-L910` 与命令一样传 running/deliveryStatus 到 formatActiveTasks。没有把 run 塞进 active schema。

### E31 ❌ runner 模式的 run 扫描定时器仍无条件 unref

- **分类**：Non-Decisional；P 的普通扫描 unref 必须与 R 的 runner 保活例外一起满足。
- **规范**：R:100 明示 `PI_SCHEDULED_WAKEUP_RUNNER=1` 时 timers 保持 referenced，使 pi -p 活到工作完成。
- **实现证据**：dispatcher `patch:L579-L582` 无条件 timer.unref，没有 runner mode 分支；`run-catalog.ts:135-137` wrapper stdio ignore 且 child.unref。
- **反例**：runner 模式中最后一个 one-shot scriptTask 被 dispatch 后调度已完成，wrapper 还在跑；若其余宿主工作/调度计时器已结束，新模块持有的扫描 interval 与 child 都不保活。所提供改动没有任何 run 期间的 ref 来源，进程可在结果生成/投递前退出。
- **影响**：声明的 runner “直到工作完成”保证失去支撑；必须等另一个活 Pi/会话重新打开才有投递机会。确定违反的是计时器无条件 unref 与明确模式契约；本次没有运行 pi -p，不声称已观察到某个宿主版本的实际退出。
- **根因**：把交互模式扫描的 unref 直接用于 headless runner，缺少模式例外。

### E32 ⚠️ 60 秒退避的承诺未覆盖新的结果发送失败路径

- **分类**：Decisional（需澄清“delivery”是否只指 poller dispatch 失败）。
- **规范分歧**：R:98 称 failed/locked/unavailable deliveries 60 秒重试；V Runtime wiring 更精确地将 60 秒应用于 core.runDue 的 non-executed outcomes。新结果投递已从 poller dispatch 中分离。
- **反例与证据**：idle sendMessage 抛普通错误。`delivery-coordinator.ts:43-47` 在 send 前先删内存 pending；磁盘 run 未 mark，dispatcher 每 1 秒重扫再 enqueue/send（`patch:L579-L582`），没有 60 秒 backoff。若该项是普通 prompt，删除后没有磁盘可重扫，在活进程内也不再重试。
- **影响**：若按 README 自然含义覆盖结果投递，则磁盘项每秒失败、prompt 则丢失，均非 60 秒重试；若原意仅是调度派发失败，文档应明确两种路径的不同保证。此处不把歧义擅自裁成 ❌。

### E33 ❌ lost/win32 合成正文无视 includeTimestamp=false

- **分类**：Non-Decisional。
- **符合部分**：正常磁盘结果在 `delivery-actions.ts:35-42` 检查冻结的 includeTimestamp=true，用 outcome.completedAt 与当前 now 重建；`run-catalog.ts:51-58` 保存 true；prompt 路径也条件传时间戳。新增测试 `test/delivery-coordinator.test.ts:228` 检查 true 的标签。
- **违反证据**：`run-catalog-state.ts:149-153` 的 failedOutcome 无条件向 buildWakeUpContent 传 `{completedAt:now,sentAt:now}`；false/未设置时 runDelivery 直接返回这个 outcome.content。
- **反例**：脚本任务没有 includeTimestamp（或设 false），wrapper 失联后 owner 合成失败；交付的正文仍含 completed-at/sent-at，而且 sent-at 是合成时间，不是实际发送时间。win32 也复用此分支。相反，正常运行的同一开关不加时间戳。
- **影响**：同一任务仅因执行结果来源不同而改变用户选择的格式，恢复/忙等投递的 sent-at 还失真。提供的内容测试 `patch:L1322-L1343` 也明确断言未开启保持不带时间戳，说明这不是新默认格式。
- **根因**：合成失败的 builder 把发送时间写入持久 content，绕过交付层条件重建。

### E34 ✅ 新接线复用 wake/body 构造，不引入新策略解释

证据：`runner-main.ts:42-66` 经 executeScriptTask 生成 run；execute-task 改动仅透传 index；failedOutcome `run-catalog-state.ts:147-152` 复用 shouldWakeUp 与 buildWakeUpContent。never 测试 `script-runner-main.test.ts:113-125` 明确不带 prompts；正文新增日志路径继续 escapeMarkup（`patch:L356-L368`）。原 wake policy 与 escaping 实现全文不在允许材料内，本项是对改动接线的结论，非对其旧代码的重新证明。小数脚本丢失、时间戳合成另有 ❌，不重复计算。

### E35 ⚠️ 四份契约存在会影响正确使用的内部矛盾

- **分类**：Decisional；不以实现作规范来源，不修改任何文档。
- **GC**：P §3 为最新五个“且”七天内，R:68 为“newest 5 ... or 7 days, whichever keeps them”；六个新结果或一个八天前结果时给出相反删除预期。新增 GC 测试选择后者，不能据测试裁定 P 自动失效。见 E26。
- **关闭与 abort**：P §2 明文废弃 shutdown kills/suppresses results，V:23/R:68 已说关会话不杀 run；S D.process 最后一段仍说“session 关闭”abort 及“调用者会话结束后不得再发布结果”，S 正文还残留 future-adapter 描述。用户关会话期望继续运行，维护者按 S 可能重新接回 abort，直接破坏本计划。
- **输出**：S D.process:41 新段已说落盘模式的 results 为 8192-byte tail，S buildWakeUpContent:77/79 仍说原始 stdout/stderr 完整保存在 results、转义不截断。64KiB 输出时消费者不能同时依赖两者；全量现位于日志。
- **stop all / AI cancel 范围**：V Runtime wiring:98 仍只写对 active set 顺序 cancelActive；P §4.6 是 active+live runs。R AI tool:90 的 id 示例仍只称 active task。完成 one-shot 后仅剩 run 时，两种文档会给出不同可操作范围。
- **prompts 表述**：R Script tasks:58 “only when ... actually wakes” 后的括号却列 never/on-error 无触发失败，和 P/S 的“不唤醒不带 prompts”相反，容易令使用者误读。此处仅指出不一致，不把其他明确段落推翻。

## 汇总

### 计数与结论

- **E 总数：35。**
- **critical ❌：13 项**：E2、E7、E9、E11、E14、E19、E20、E21、E22、E23、E27、E31、E33。
- **⚠️：8 项**：E4、E8、E16、E24、E26、E28、E32、E35。
- **✅：14 项**：E1、E3、E5、E6、E10、E12、E13、E15、E17、E18、E25、E29、E30、E34。
- 计数按独立 expectation 的最终判定，不按同一段内反例个数重复计算。这里的 critical 表示会造成契约错误使用、错误结果或集成不可靠，并非 CVSS 等级。

最先应关注 E7（错误会话消费结果）、E9（成功结果被合成覆盖）、E19（标记先行导致永久漏投）、E21/E23（取消不能可靠终止并收敛），随后是 E14/E27（脚本不执行或重复执行）。正常流程的目录、日志、边界 entries 形态和 UI 同源接线已经具备，但不足以证明本计划关键不变量成立。

### ⚠️ 清单

| E | 警告 | 决策性质 |
| --- | --- | --- |
| E4 | result codec 类型校验不足 | Non-Decisional |
| E8 | 深路径 socket 迁到 tmpdir，文档与部署前提缺失 | Decisional |
| E16 | 批量 flush 不重新检查 idle，存在进入宿主 followUp 队列的时序条件 | Non-Decisional，需宿主验证 |
| E24 | dispose 后在途 refresh 仍能入队发送 | Non-Decisional |
| E26 | GC AND/OR 冲突，owner/诊断/不重试约束未齐 | 保留策略 Decisional，其余 Non-Decisional |
| E28 | 空脚本 always-wake 未走约定的内存直投 | Non-Decisional |
| E32 | 60 秒退避对新投递路径的作用域不清 | Decisional |
| E35 | GC、关停、完整输出与 stop/AI 命令面文档互相冲突 | Decisional |

### 验证记录与残余风险

- 只读取了四份指定契约、提供的 tracked patch，以及 new-files 下恰好 13 个文件；没有读取仓库实现全文，没有读取其他架构文件，没有扩大审核范围。
- 提取 E 清单后才打开 patch/new-files；通过状态分支、跨进程交错、owner 流向、提交标记顺序、取消分支与计时器 ref 条件逐项比较。
- 仅运行 find/wc/rg/grep/nl/文件读取与输出文件存在性检查等只读命令；未运行测试、构建、wrapper、SDK 集成或故障注入。测试文件是核对覆盖面的材料，不是本次“测试通过”证据。
- 现有新增测试未覆盖：owner pending 投递过滤、读结果后 wrapper 完成的竞态、boundary 标记后返回前崩溃、同栈双 dispatch、小数 timeout、SIGSTOP 后强杀、dispose 的在途扫描；部分测试明确按实现自有 schema/GC 策略断言，不能替代权威契约。
- E16 的真实宿主路由时序与 E31 的完整 pi -p 退出行为未作运行验证；报告分别保留条件与静态可证明范围。UI 最终渲染、平台运行和其余未变代码只按允许材料核对接线，不宣称全面证明。
- 仅生成本报告文件；未修改实现、测试或项目文档。本次权威输出路径覆盖任务正文内的旧报告目的地，因此没有额外在仓库 audit-report.md 生成副本。
