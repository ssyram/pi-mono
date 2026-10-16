# D.integration — 接入、生命周期与补全合同

本 frame 承接 [D.root](design.md) P.1–7，把 branch 信号用于真实插件回调。目标不是由 Pi 吞错，而是本功能的公共运行边界自己捕获异常；前提是正常资源和 SDK 声明的入参，进程被杀/OOM 不作为 JavaScript 返回保证。内部 callee 可以抛，外围不得返回虚假成功或假称回滚。

## P / M / R

P：抑制聚合按当前 branch；旧会话不被当成当前可写会话；schedule mutation/完成/恢复/切 branch 后同步；公共命令、事件、定时器、服务、补全不得向 Pi 返回 rejected Promise 或抛出异常；诊断自身失败也不再次抛出。

M：OMP 当前 context→服务 binding→内部 writer；loop 当前 runtime→core 状态/注册有效性→client Result；scheduler 安排/发送前只读门；命令 handler 捕获输出错误；两个补全 provider 捕获自身与原 provider 的失败。

R：Q.I.1–3 要求实时消费与可说明的阻止；Q.I.5 要求 owning boundary 而不是宿主 catch。服务、core、补全 callee 的合同按下列函数组合；每个错误分支在自身外围终止，不借“Pi 会捕获”证明 P。本轮 CCA4 已返回并完成有界修复/直接测试；覆盖账、SDK 版本及当前失败恢复策略仍有未闭合项，见 [CCA4 裁定](../task-system/cca4-findings.md)，不在文档中自认证全系统。用户后续要求修复不得新增 throw/rethrow；reschedule 和 admission 不可用采用显式失败值。既有内部异常路径并未自动全部获得零抛出证明。

## 1. 内部诊断

### `reportBoulderDiagnostic(message: string): void`

位置：`boulder-inhibition/report-error.ts`；caller：命令 catch、service reply catch、adapter、scheduler、loop bridge。Requires：message 是已有字符串。流程：try console.error(message)，catch 后返回。Ensures：尝试一次报告，无重试，不抛出；没有保证日志一定显示。副作用仅日志请求。callee 的抛出在本层消解。

### `describeThrown(error: unknown): string`

位置：`describe-error.ts`。Error.message 也在自身 try 内经 String 转换；包括敌意 toString/属性 getter及非字符串 message。转换失败返回固定 fallback，结果必须是 primitive string，不能把未知值交给 catch 臂插值。原 cause 仍由 Result 保存。

## 2. OMP 信息条目

### `appendBoulderInfoEntry(pi,data): void`

位置：`hooks/boulder-info-entry.ts`；内部 callee。调用 pi.appendEntry，正常写当前 session 的信息条目。写前或写后抛错沿内部调用链传播；它不是公共无外抛边界。service writer→handler catch、scheduler→事件/倒计时外围 catch 承接。不能声称此透传函数不抛。

### `registerBoulderInfoEntryRenderer(pi): void` 与 renderer

注册属于初始化；注册 API 失败不能假装成功。运行 renderer 在自身 try 内读 data、选择 warning 文案并构造 Text；无 data 返回 undefined，运行错误报告后返回 undefined。仅显示条目，不启动模型、不改信号。

## 3. OMP 服务 adapter

### `registerBoulderInhibitionAdapter(pi,cancelWait): () => void`

位置：`hooks/boulder-inhibition-adapter.ts`。初始化注册 get/set 服务及生命周期监听；无 module-global session 状态。运行 binding 只解析当前 context 的 sessionManager 身份；session_start/session_tree 更新 context，shutdown 清空；过去 context 不保留为可写 binding。因为 pi.appendEntry 指向当前 session，禁止只靠旧 WeakMap 成员存在判可写。

binding.port.getBranch 读取当前 branch；appendEntry 写当前 session；effects.cancelWait 仅取消该 session 的倒计时；reportInfo 调内部信息写入。上述 I/O 异常被 service handler 收敛为 failure，可能已经写入信号，不回滚。

绑定完成发送 `omp:boulder:inhibition-ready:v1` 通知。loop 用它处理两个插件 session_start 注册次序：loop 先启动时等待该通知重同步；OMP 先启动时 loop 初始同步直接可用。通知不保存第二套抑制状态。

disposer 解绑服务、清空 context；pi.on 没有解绑返回值，生命周期监听由 SDK 管理，不声称手动移除这些监听。不写 false、不影响别的扩展。运行绑定/通知/清理失败被 adapter 捕获并诊断。初始化注册失败仍是可见 setup 失败，不冒充服务可用。

## 4. Boulder 消费与倒计时

### `boulderInhibited(context): boolean`

位置：scheduler 内。读当前 branch→check→一次 info→返回 inhibited；读取/显示失败由调度事件或倒计时外围捕获，本次不发送 resume。clear 文案只表示信号门通过，不代表其他条件允许启动。

### 调度/发送前条件与 `BoulderHandle.cancelWait`

保留 task/pending/abort/compaction/background-work 原条件；安排前和真实发送前新增信号门。set(true) 的服务效果即时取消已安排等待；set(false) 不自行启动新回合。已有 activeWait 时不重复安排，保持一个 live wait；取消后仍按原规则安排。取消、事件和 countdown 错误由 owning 边界安全报告；refresh timer 和 silent timer 也不能因状态显示/onError 失败抛出。

## 5. `/task` 运行回调

### `registerTaskCommand` 的 handler(args,ctx): Promise<void>

首 token 为 boulder 时构造当前 session-bound client→execute→kind set/invalid/failed 转显示；其他 task 路由保持原行为。整个 command handler 在自己的 try/catch 内，包括 getTasks、human task 操作、widget、appendOutput。catch 调安全描述/诊断后正常 resolve，不发送模型消息。输出失败不撤销已写信号，不返回假成功，不依赖 Pi command catch。

session_start 安装补全的回调同样捕获 UI 注册失败，正常 resolve。初始化命令注册另属 setup 合同。

Task widget 的 start/tree/shutdown 注册由 `registerTaskWidgetLifecycle` 负责，刷新中的状态/历史/UI/诊断失败在自身边界包含。task 恢复失败仍保留 controller snapshot，但 `getTaskAdmissionState` 对非 ready owner 返回 error；gate 在 lookup 前豁免 exact task，不让保留旧 snapshot 放行。该 reader 不恢复、不写入、不抛；首次 task 不需要预先存在 active task。

## 6. loop core、工具及同步

### `createBoulderSync(pi,ctx,core): BoulderSyncBridge` 与 `sync(): void`

位置：`scheduled-wakeup/src/v2/boulder-sync.ts`。创建当前身份 client；sync 在 try 内读 snapshot、构造真实 tasks/registrations、逐 active 注册调用 registrationInhibition、调用独立 sync Result。Result failure 或内部异常安全报告，无外逸；不修改 schedule。失效/不可读是失败，不写假 false。

### `registrationInhibition(id)`

位置：loop-core。无注册/确认无索引→missing；catalog 不可读→unavailable；indexed 且定义可读→resolved(定义标记)。status 判 indexed 后定义读取丢失/失败仍返回 unavailable，不以 undefined 标記假 false。内部 I/O 失败由 bridge 捕获。

### `scheduled_wakeup` add 输入

schema/ToolParams 显式可选 boolean inhibitBoulder；AI 输入解析校验并透传。operation 与 onMutation 各自捕获，保留操作实际结果及刷新失败说明；不得因 signal 同步失败伪称 schedule 已回滚。

### extension 的 runtime 与事件

runtime 按 cwd + sessionManager 身份 + session ID 复用，不能只看 cwd。创建后恢复/reconcile、初始同步；mutation/afterRun/session_tree 同步；service-ready 通知只同步所属当前 runtime。换 session 先 dispose 旧 timer，再建新 core/client。事件/命令/服务通知回调捕获自身所有失败，包括报告；shutdown 不将 suspend 当删除，不无条件写 false。

### `DuePoller.fire`

runDue 后调用 afterRun，无论该轮是否出现部分失败；同步失败不取消既有有效 schedule，不向定时器外抛。re-arm、stop cleanup 或 onError 失败仍被 fire 外围捕获；start 的既有内部错误由 extension owning boundary 捕获。reschedule 自己返回 `{ok:true}` 或 `{ok:false,message,cause?}`，包含清理失败，不 rethrow；已停止时继续报告失败、不自动重启。命令/事件消费失败值，工具保留已完成动作并追加 refresh 错误，不伪称回滚。afterRun 是真实同步义务，不是“仅诊断”。

## 7. 补全

### `taskCompletionInput / taskCompletionSlot / boulderSlot`

input 校验光标、保留未完引号/转义 token。literal 表示引号/转义，不是“已经完整”。根提示 boulder；裸 boulder→set；set→loop/user（提示非允许值列表，其他 type 可手输）；下一位→true/false/t/f。关键词大小写与命令 parser 对齐。纯函数输入由 tokenizer 建立，不能用“纯查表”推所有 callee 永不抛。

### `createHumanTaskCompletionProvider` 的三个运行方法

getSuggestions 的 parse/slot/choices/任务读入/原 provider 委托均在 try 内；委托必须 await，Promise reject→null。apply 的失败返回未改文本/光标，shouldTrigger 的失败返回 false。没有信号/任务写入副作用。引用/转义根不能误进入 boulder 补全分支。

### `createLoopCommandAutocompleteProvider`、`addFlags / defineFlags`

候选只对 add 和合法 define scope 显示 --no-boulder，available 不显示；已使用不重复。provider 的 getSuggestions 委托 await→reject 捕获，apply/shouldTrigger 也在 catch 边界，所有 delegate 调用接收独立 lines 数组；application fallback 来自调用前快照。非法光标/不属于本命令交原 provider 或安全 fallback。不能因补全恢复过程造成 rejected Promise 进入 Pi。

## Task 设置的后续迁移

当前 gate/show 都通过直接相对 import 的 my-settings 服务查询，不再读取task.json或独立widget-state日志；OMP await factory后注册消费者，exact task在异步设置查询前豁免。字段 `omp-task:no-task-no-tool` / `omp-task:show` 默认true；默认session，--persistent额外local、--global额外global，可组合。widget生命周期现在await异步刷新并包含rejection，task变更异步刷新自己包含失败。完整调用/保存/失败合同及191项+63项运行依据见 [settings.md](../task-system/settings.md)。这不是对旧CCA快照覆盖范围的扩张，也不意味着所有底层I/O故障均能恢复。

## 8. 直接测试与增量推理范围

- 公共 task handler 输出/human operation/getTasks/widget 抛错，甚至错误描述/日志 sink 失败，都正常 resolve；已生效信号不回滚。
- 服务无提供者、getter 异常、callback/reply/port 失败、日志 sink 失败；旧 session 不写当前 session，插件加载次序两种情况。
- CLI/工具标記往返、shared missing/unavailable、once 完成/多任务归零、同 cwd 换 session/session_tree、afterRun 同步。
- 两个补全 provider：正常根/参数/flag、引号/大小写、原 provider 同步抛与异步 reject、读取失败、apply/shouldTrigger 失败均不外逸；无信号写入。
- 增量 CCA 纳入这些实际 adapter/callback/补全 callee 和现有独立 Result 模块，不能复用只覆盖旧 standalone 的报告宣称全链验证。产物数不是正确性证明。
