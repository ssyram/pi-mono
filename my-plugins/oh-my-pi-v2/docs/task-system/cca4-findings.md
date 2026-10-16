# CCA4 结果裁定与最小修复

## 当前状态

CCA 单次运行已经结束；本轮有界修复和直接测试已落地。用户后续明确取消独立的应急 off 方案，改为所有 task 设置直接依赖 my-settings，见 [settings.md](settings.md)。两项设置默认 session，按标记额外保存 local/global；坏 local 不妨碍 session off 的真实服务测试已通过。当前 OMP相关191项和my-settings63项通过，旧报告仍不认证新接线或全部函数无抛出。流程终态、修复完成、真实 Pi 验收和发布分别结算。

## 原目的与依据

沿 [cca-full-pass.md](cca-full-pass.md) 的业务和异常合同：task/loop/Boulder 保持既有状态、依赖、发布与会话语义，真实公共回调自行包含普通异常、异步拒绝及诊断失败。内部 helper 可以在明确的外围责任下抛出。用户已经授权确认 bug 的最小修复，不授权第二轮审查、官方源码修改、自动 reload 或提交。

用户在结果消费阶段进一步要求后续不得有 throw/rethrow 行为，并强调 task 制定/启动不能与 no-task-no-tool 形成自锁。后续修复采用显式失败值，不能以外围 catch 或虚假成功替代该要求。既有内部 throw、context-only callee、SDK 版本和覆盖缺口未因此自动获得零抛出证明；本轮不宣称所有既有函数绝无抛出。

运行绑定：`boulder-ts-cca4`，root `ses_ecb040554ffeYDMKB7uqxk3xuO`，`~/cca-runs/boulder-ts-cca4`。模型 `tmp-haokun/glm-5.3-flash`。原报告在 `_cca_analysis/{goal,self-check,open-questions}.md`，源 hash/控制记录在 `~/.local/share/boulder-ts-cca4/{run-manifest.json,events.jsonl}`。

2026-10-14 16:54:35 本地时间的原生 `try_transition` 返回 accept / `A_DONE`，16:54:41 原生 `exit_fsm` 返回 inactive。绑定 interval 已取消，任务专属 tmux 已停，共享 daemon 未动。历史网络故障、一次获准接续、白名单拒绝和权限处置保留，不因终态抹去。

## 覆盖证据与不能采信的声明

- 冻结输入：74 文件，565 定义 / 152 外部，146 个 reference-only 本地 callee。
- 实际文件：509 份 fn、159 份 external，累计60个 child session；不是活动并发数或正确性证明。
- 最终 `reachable.json`：61 个 entries，506 reachable / 59 non-reachable，图565节点 / 1734边；最终 CLI 显示 edge/coverage/manifest 检查通过。
- `self-check.md` 的57入口、1594边及155条半边失败叙述不是最终元数据，不能把模型的最终口头表格与旧正文混为一份准确覆盖表。
- **未闭合覆盖义务**：non-reachable 集合包含实际挂载/调用的 `checkBoulderInhibition`、`registerBoulderInhibitionService`、`registerBoulderInhibitionAdapter`、`createHumanTaskCompletionProvider`、`createTaskToolDefinition` 等。前两者只有以 caller 命名的调用点报告，不能冒充 manifest 中函数本体的规范报告。模块初始化、构造器与注册 callback 也不能仅凭近似静态图认定不可达。保留这个反例，不宣称本轮已完整证明全部 task 函数；不为修补这个账自动重开 CCA。
- 名字匹配伪边及 context-only 的执行/存储/SDK callee 仍是原报告的限制；机械门和自然语言报告不是机械证明。
- 修复前按 source hash 核对：scheduler、task、renderer、compaction、timestamp、completion、poller 等问题文件与冻结输入相同；当前 extension/task-gate 已有另一项 task 开关工作，保留它们。F5 已在当前 task-gate 用安全 formatter/logger 关闭，旧报告不认证新增设置功能。

## 逐项裁定和最短责任位置

| 原项 | 裁定 | 修复/不修改依据 |
| --- | --- | --- |
| F1、F7 | 确认，同一根因 | session_start/tree 的 task widget 回调必须包含 state/history/UI 失败；shutdown 与诊断也由同一 widget 生命周期边界处理。 |
| F2 | 确认 | `reportBoulderError` 的 hasUI 读取移进已有 try。`=== true` 不能捕获 getter 异常，不采纳该替代建议。 |
| F3 | 接受 single-live-wait 义务 | 相同 episode 未取消时重复 settled 可创建两个 timer 并重复发送同一 attempt；回调输入本身合法，不能把未证的宿主顺序当互斥保证。已有 activeWait 时不再调度，不更改尝试上限或取消运行工作。真实宿主是否产生该序列仍单列。 |
| F4 | 确认 | 持久化输入验证应排除 ECMA Date 上界以上的时间戳，否则 info 的 ISO 格式化失败；正常 Date.now 路径不受影响。 |
| F5 | 当前已关闭 | 当前 task-gate 的 catch 已用 describeThrown / reportBoulderDiagnostic，不重复修改他人工作。 |
| F6、F8、F9、F10、F11 | 确认 | task 恢复/通知、extension 的配置降级/任务通知、widget shutdown、compaction 的 catch 中不受保护的 logger/格式化可二次抛出。复用现有安全诊断函数；不新增恢复框架或虚假成功。配置入口的其他 setup 失败并未因此获证。 |
| F12 | 确认 | renderResult details 可以被其他插件替换，浅验证后格式化会抛；真实 theme 调用也是 fallible。call/result renderer 自己包含失败，返回明确 rendering unavailable，不伪称空状态，不依赖 Pi 吞错。 |
| F13 | 不成立 | 当前安装的 `@earendil-works/pi-tui/dist/autocomplete.d.ts:21` 明确 applyCompletion 同步返回 editor 状态；不加 await、不改原生接口。允许 Promise 的 getSuggestions 保持 await/catch。 |
| F14 | 确认 | loop delegate 收到 editor 原数组，mutation-then-throw 会破坏输入；所有 delegate 调用传入独立数组，application failure 使用调用前快照。 |
| F15 | 确认，已改为失败值 | `reschedule` 返回 DuePollerRefreshResult，不再 throw/rethrow；失败停止 polling，保留 cause，cleanup 失败也在本层包含。已停止状态后续调用返回失败，不自动重启。命令显示错误，tool 保留已实际完成的动作结果并追加 refresh 失败，不宣称回滚或正常调度。 |
| F16 | 接受转义义务 | 原例不充分；实际 retained dependency head/tail 可含 lexer 解码后的引号/反斜杠，直接插入会重新分词甚至吞掉后续 flag。按人类命令的现有引号/escape 合同重新编码，保留邻接 component 的值及外部文本。 |
| F17 | 合法状态域内不成立 | 恢复验证排除 missing dependency / 非 reciprocal / cycle，现有变换保持该图不变量；dangling 图不是正常 owner snapshot。保留不同 helper 在非法输入上的行为差异，不改变 admission 或任务语义，也不要求用户裁定一个不可达坏状态。 |

## 恢复、admission 与通畅

在闭合 F6 的恢复/诊断链时，直接复现了原表未报告的业务反例：branch 或 history 读取失败使 owner.ready=false，却保留旧的 in_progress snapshot；旧 gate 用该 snapshot 放行非 task 工具。两条修前测试均失败（返回 undefined，未拒绝）。

修复：`TaskToolHandle.getTaskAdmissionState` 在自身 try 内读取 owner，只对 ready owner 返回状态；否则返回明确 error，不抛、不伪造空状态、不自行恢复。`getTaskState` 保留原只读快照用途。extension 将 gate 接到新 reader；gate 在状态读入前豁免 exact task，其他工具在 error/读取故障时明确拒绝。成功 task 操作可以恢复 owner，不能要求先已有 active task 才允许创建第一项。两条修后反例与两条首次创建/非法输入重试测试全部通过。

**已被后续裁决替代的配置路径**：旧 `createTaskGateSettings.set` 的“配置先保存成功才改会话”曾使坏配置下 off 失败。用户已明确不采用独立的内存先关闭补丁，转为直接依赖 my-settings。旧 config/settings/widget-state 模块退出，配置采用 `omp-task:no-task-no-tool` / `omp-task:show`；默认只追加 session 设置，标记文件步骤失败仍尝试 session，一次操作各层结果明确报告。

当前直接测试已连接真实 my-settings service + task gate/command：任务历史读取抛错且 local JSON 损坏时，显式 off --persistent 返回文件警告、session off 生效，普通工具不再读坏 task 历史；缺服务时仍允许 task 自身。session append 若失败仍不能伪称已关闭，不保证不可用 SDK/I/O 总能成功。完整新配置合同及命令见 [settings.md](settings.md)。

## 当前函数合同

- widget lifecycle 的 refresh/shutdown：合法 SDK context；state/history/UI/诊断可失败；每个注册回调返回 void，不依赖 Pi catch，不虚称刷新成功。
- task restore/notify：保留原 owner/session/ID/publication 语义；失败诊断的描述和 logger 不再外抛；已提交变化不被通知失败撤销。
- getTaskAdmissionState/gate：不恢复、不持久化，不返回假空状态；无 ready owner 返回 error；exact task 不读取该状态；错误拒绝而非放行。
- scheduler：已有 activeWait 时不重复安排；取消后仍可正常安排；attempt 上限/episode 规则不变；hasUI/reporting 的失败在 owning catch 内结束。
- renderCall/renderResult：真实边界包含格式化/theme/外来 details 失败；fallback 明确 rendering unavailable，不宣称没有任务。
- timestamp/insertion：task timestamp 位于 Date 可表达域；补全保留 decoded comma 邻接值并重新转义；不改 graph/executor 验证。
- completion：delegate 收到独立 editor 数组；异步 suggestions 被 await/catch；失败不重试，保留原输入/光标。
- reschedule：返回成功/失败值；失败状态确为 stopped，cause 保留；失败清理和诊断不变成第二次抛出；已持久化动作不伪称回滚。
- describeThrown/loopErrorMessage：Error.message 也在 try 内经 String 转换，结果必须是 primitive string；敌意非字符串 message 的转换失败返回固定 fallback。

## 当前设置迁移的直接运行依据

从仓库根执行：

```sh
node --experimental-strip-types --import ./my-plugins/oh-my-pi-v2/test/ts-resolve-hook.mjs --test my-plugins/oh-my-pi-v2/test/task-system-*.test.ts my-plugins/oh-my-pi-v2/test/task-*.test.ts my-plugins/oh-my-pi-v2/test/boulder-*.test.ts
# 191/191，含真实 my-settings 接线、两命令范围/组合标记、会话/分支隔离、缺服务和异步故障包含。
node --experimental-strip-types --import ./my-plugins/oh-my-pi-v2/test/cca4-sdk-loader.mjs --test my-plugins/my-settings/test/*.test.ts
# 63/63。loader只缩小SDK导入到真实getAgentDir和withFileMutationQueue，不替换服务或文件操作。
node node_modules/typescript/bin/tsc --project my-plugins/oh-my-pi-v2/tsconfig.task-system.json
# exit 0；19文件scoped Biome无错误、警告、info。
```

根 check 重新执行仍停在无关历史快照的非精确依赖，SDK入口检查仍只有旧 built SDK缺agent_settled的错误；未更改官方源码、未reload/提交，未追加审查或provider调用。

## 设置迁移前的修复证据（历史）

以下是当时源码的运行，不认证新设置接线；未调用真实 provider、未运行第二轮审查：

```sh
node --experimental-strip-types --import ./my-plugins/oh-my-pi-v2/test/ts-resolve-hook.mjs --import ./my-plugins/oh-my-pi-v2/test/cca4-sdk-loader.mjs --test my-plugins/oh-my-pi-v2/test/task-system-*.test.ts my-plugins/oh-my-pi-v2/test/task-*.test.ts my-plugins/oh-my-pi-v2/test/boulder-*.test.ts
# 188/188；含首次 task、错误重试、恢复失败拒绝旧状态、真实开关 command/config。
node --experimental-strip-types --test my-plugins/oh-my-pi-v2/test/boulder-inhibition/*.test.ts
# 127/127。
node --experimental-strip-types --import ./my-plugins/oh-my-pi-v2/test/ts-resolve-hook.mjs --import ./my-plugins/oh-my-pi-v2/test/prepare-compaction-request-loader.mjs --import ./my-plugins/oh-my-pi-v2/test/custom-compaction-runtime-loader.mjs --test my-plugins/oh-my-pi-v2/test/custom-compaction*.test.ts my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.test.ts
# 28/28，真实 registered handler + 离线 completion seam。
node --experimental-strip-types --import ./my-plugins/oh-my-pi-v2/test/ts-resolve-hook.mjs --test my-plugins/scheduled-wakeup/test/cca4-*.test.ts my-plugins/scheduled-wakeup/test/defer-command.test.ts my-plugins/scheduled-wakeup/test/due-poller.test.ts my-plugins/scheduled-wakeup/test/register-v2-tool.test.ts
# 18/18；含 mutation 成功后 refresh 失败的真实 core/tool 组合。
```

上一次完整 loop 尝试为136通过、1文件因官方 `packages/ai/src/providers/data/azure.json` 缺失而导入失败（新 session-persistence 测试未执行）；之后受改动影响的18项通过，不以此宣称当前整个 loop 全绿。SDK loader 只将 task config 的 getAgentDir 指向真实 SDK config 导出，未伪造其行为。

专项 tsc：task-system、boulder-inhibition、compaction-references、scheduled-wakeup 各 exit 0。检查目标使用实际 runtime 的 ES2024 和 source TUI API；completion 选项从实际 completeSimple 签名取得，未删功能或使用 any/ts-ignore。新增 runtime 检查仍被当前 built SDK 缺少 agent_settled 阻塞，未伪造声明或删除该功能。

35个本轮改动 TS 文件的 scoped Biome 无错误、警告、info。Node 26 的旧 loader 输出 DEP0205 弃用提示，属于已记录测试环境边界。

根 `npm run check` 已运行（完整输出）：先因缺 wasm-nodejs 失败；`npm install --ignore-scripts --package-lock=false --no-audit --no-fund` 补装后，停在 check:pinned-deps，原因是其他工作的 `.local/stability-against-oc/sources/...` 与 `my-plugins/impression-demo/runs/sdk-snapshots/...` 历史快照含非精确依赖。未改这些快照或门禁，不把未执行的根 tsc/browser smoke说成通过。install 未运行 lifecycle scripts，也未修改 package.json/lockfile；官方 packages/scripts 的 tracked diff 为空。

## 未完成边界

原始 CCA 的完整本体覆盖账并未闭合；context-only callee、实际宿主事件序及安装/源码版本差异不自动获得通过结论。direct tests 只证明所测路径。真实 reload/TUI/端到端验收、提交和发布未执行，仍由用户决定。
