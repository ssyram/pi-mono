审查材料已全部收集完毕，且消费者合同（consumer contract）已根据实际的 `Rust` 驱动程序完成验证。最终报告如下。

## 审查 — fsm-3-protocol-judge 实施后独立 contract 对照（路径B）

对象：`my-plugins/fsm-compatible/docs/audits/fsm-3-protocol-judge/implementation.patch` 对照 `docs/audits/fsm-3-protocol-judge/expectations.md`（10节）、叶子 `subplans/fsm-3-protocol-judge.md`、detailed-design §5.3/5.4。一手 consumer 合同已核对 `use-fsm/crates/server/src/agent_cli.rs`。全程只读，未改文件、未执行命令。

### 正确项（核对通过，附证据）

- 时间归一化无 `now` 兜底：`src/records/record-time.ts` — `Date.parse` → 有限/非负安全整数 → `toISOString()` roundtrip 全过才收；`messageMillis` 仅在 `timestamp === undefined` 时用归一化 `entry` 兜底；非法即 `protocol-invalid`。`test/oc-records.test.ts` 拒绝非毫秒 ISO/坏日期/负数。
- call/result 关联唯一与整体拒绝：`src/records/oc-messages.ts` 两遍扫描；重复 `callID`、孤儿 `result`、`toolName` 不符、坏时间在产出任何 `envelope` 前抛出；测试覆盖四类反例。未完成 `call` → `running` 无 `end`、无 `info.time.completed`，不虚构完成。
- raw branch 不被压缩视图替代：`record-store.ts` 持 `facts.branch` 快照；`root-7` 断言 `buildContextEntries().length < getBranch().length` 且 `compaction` 后 `custom_message` envelope 仍投影（Stop/Watcher 材料可达）。
- unavailable 不掩盖：`oc-roster.ts` `lifecycleStatus` 对 `unavailable` 抛 `not-ready` → 503；judge 同理；不省略条目。
- 身份与 repair：`msg_`/`prt_` 均取真实 `entry.id`；每次 `run` 新建 `CaptureTurn`（同 sid repair 不复用旧 `capture`，有测试）；并发同 sid → `queue-full` → 409。
- 工具闭集三重防线：`judge-tool-policy.ts` `"*"===false` 强制、`StructuredOutput` 必须 `true`、`deny` 别名（write/apply_patch/MCP 三件）即使 true 也拒、未知 true 拒、基础 read/grep/glob 恒在；`buildJudgeAgentTools` 只注册 `allowed` 集合（执行前 `allowlist` 由"根本不注册"更强满足）；无 `execution extensions/FSM/dispatch`。
- 目录真实分页：`judge-directory-read.ts` 真实 `readdir({withFileTypes})`、目录/`symlink` 目标 `stat` 加 `/`、`localeCompare`、`offset||1`、`limit??2000`，绝不在截断文本上分页。
- Edit 三分支：原生 `path+edits` 数组；空 `oldString` 在 `withFileMutationQueue` 内存在即拒/递归 `mkdir`+`wx` 新建；`replaceAll` 全替换零匹配失败；`oldString===newString` 拒；未开放 write/apply_patch。
- HTTP 骨架：`auth` 先于 `route/body`（固定 `opencode` + `sha256` 摘要 + `timingSafeEqual`）、1MiB→413、`JSON` 坏→400、严格 204 空 `body`、`loopback` 随机端口返回真实绑定地址、404/405 路由表、执行目标 403、`prompt_async` 未接 `fsm-5` 显式 503（非 `noop` 204）——均有测试。
- 错误分类不虚构：`judge-error.ts`/`oc-messages.ts` 只在 `stopReason` 事实存在时给出 `MessageAbortedError`/`MessageOutputLengthError`，其余 `UnknownProviderError`；consumer 侧（`agent_cli.rs:1737`）对 unknown 走有界重试，合同兼容。
- 三条实施偏离核实：raw Agent（偏离1）隔离更强、同 `streamFn` 真实回合、转写 `seed`/吸收，不削弱隔离/真实回合/`envelope` 合同（副作用见 P2-3）；宽松参数+schema 注入（偏离2）由 `execute` 时同一 Ajv `validator` 兜住，`wire` schema 经 `system` 后缀真实送达；`readonly` 数组（偏离3）无削弱。

### 发现 (Findings)

- **P0-1（BLOCK）judge abort 虚假确认，运行中回合完全不可取消**。`src/judge/judge-session.ts` `abort()`：仅查 `transcripts.has` 即 `updateJudge(idle)` 并 `return true`；`Agent` 是 `run()` 局部变量未保留，`agent.prompt(input.user)` 未传 `signal`，无 `cancel controller`。违反 `expectations` §4 P4（"等待实际abort/idle…无法确认非true"）、§2 JudgeTurn "cancel controller"、`subplan` §5.4 `abortJudge` post（"true是真的停止generation"）。`consumer` 合同（`agent_cli.rs:2146-2152`）把 `JSON true` 当确认停止，且其测试断言 `abort` 后 `active_generation=false`（:5949）。实际效果：`turn` 进行中 `abort` 返回 `true` 但 `generation` 继续、`status` 假报 `idle`。最小修复：每 `run` 保存 `Agent`+`AbortController`；`abort` 时 `controller.abort()` → 有界 `await agent.waitForIdle()` → 确认后才置 `idle`/`true`，未确认抛 `not-ready`（→503）。
- **P1-2（BLOCK）空 `body` 的 `abort` 请求被 400 拒绝**。`src/protocol/oc-server.ts` `readBody` 对所有 `POST` 无条件 `JSON.parse(Buffer.concat(chunks).toString())`；空 `body` → `JSON.parse("")` → `OcHttpError(400)`。原 `consumer` `abort` 发送 `body None`（`agent_cli.rs:2143`），`subplan` §3 `abort` 行明确"无body"。即真实 `consumer` 的 `abort` 首请求即 400 并进入其有界重试直至预算耗尽。最小修复：零长度 `body` 返回 `undefined`，需要 `body` 的 `route` 自行校验。
- **P1-3（BLOCK）judge message shape 错误返回 503 而非合同要求的 400**。`judge-input.ts` 全部 `shape`/未知字段/坏 `schema` 失败抛 `RuntimeError("protocol-invalid")`，而 `oc-route.ts` `statusForError` 把 `protocol-invalid` 映射为 503。违反 `subplan` §3 路由表 "shape400" 与 `detailed-design` §5.3（"shape错400"）。503 会被 `consumer` 当可重试不可用处理。注意 503 对 `oc-messages` 坏关联是正确的（"坏关联/时间503"），修复应在 `parse` 阶段转 `OcHttpError(400)`，不动整体映射。测试未覆盖此状态码（`oc-handlers.test` 只测了 `create` 标题 400）。
- **P1-4（BLOCK）webfetch/websearch 被请求后静默缺席，无显式 not-ready**。`judge-tool-policy.ts` 把二者放入 `allowed`，但 `judge-agent-tools.ts` 未注册任何 `wrapper`，也无 not-ready 拒绝——`turn` 正常进行、模型看不到该工具。违反任务目的行（"缺 `factory` 显式 `not-ready`"）、`subplan` §5（"明确503/not-ready，不伪装搜索支持"）、`expectations` §5。最小修复：请求二者时抛 `not-ready`（→503），待安装单元接 `factory` 后替换。
- **P1-5（BLOCK）失败 `capture` 的 `envelope` `part` 使用捏造 `callID`**。`capture-turn.ts` `FailedCapture` 不存 `toolCallId`；`judge-envelope.ts` 失败 `part` 用 `callID: \`so_${index}\``。违反 `subplan` §7 "callID取本次真实call" 与 `expectations` §2 `part` 身份要求；`consumer` 按 `callID` 关联，捏造值无法对上本轮真实 `StructuredOutput` `call`。最小修复：`capture()` 失败路径记录真实 `toolCallId`，`envelope` 使用之。
- **P2-1** `finish-turn.ts` `wrapFinishTurn` 与 `judge-error.ts` `classifyJudgeFailure`/`JudgeProvenance` 均为死代码（`grep` 仅定义处命中）；`typed` 分类（ProviderAuthError/ContextOverflowError/ContentFilterError/APIError+isRetryable）未接线，全部走 `UnknownProviderError`——`consumer-safe` 但合同声明的 `typed` 分支未交付；且 `batchComplete` 守卫只存在于未使用的 `wrapper`，`judge-session` 内联 `finishTurn` 依赖 SDK `finishTurn` 调用时点。建议接线或删除。
- **P2-2** `POST /session`（create）无容量/模型配置守卫（`oc-handlers.createSession` 恒成功），路由表保留"容量/模型未配置→503"；judge 注册表无界（§8 容量有界）。
- **P2-3** 偏离1副作用：judge sid 为 `randomUUID`、`sessionFile:null`、转写仅内存——无持久 `session`/`header`，`close` 后不可恢复。`expectations` 未强制 `judge` 会话持久化，予以接受，但 `consumer` 侧 `retained judge` 的跨重启续跑能力因此不存在，建议在 `fsm-5`/安装单元显式承接。
- **P2-4** GET `/session/:sid/children` 对 judge 返回 403（`oc-handlers.ts` `requireExecution`），路由表为"judge 无孩子返回 []"；`bashExecution` 投影为 `text` part+`metadata.pi.bashExecution` 而非 §4 的 "bash tool part"（command/output/exitCode/cancelled/truncated 数据完整保留）；`Edit replaceAll` 分支仅进 `queue` 时查 `signal`、未按 §5 "每次await后" 复查。
- **P2-5** 测试缺口：无运行中 `abort` 用例（否则 P0-1 当场暴露）、无空 `body` `abort`、无 judge message shape 400 断言、无 unknown-provider `typed envelope` 用例。§7 其余性质覆盖良好（`compaction` 对比、四类坏关联、`running` 不造完成、`repair reset`、`conflict` 双保留、409、401/404/405/413/503/strict204）。

### 合并结论 (Merge verdict)

**BLOCK**。差异清单（文件/行为/期望条款）：
1. `judge-session.ts:abort` — 虚假 `true`、不可取消 — `expectations` §4 P4 / `subplan` §5.4 `abortJudge` / `agent_cli.rs:2146`。
2. `oc-server.ts:readBody` — 空 `body` `abort` → 400 — `subplan` §3 "无body" / `agent_cli.rs:2143`。
3. `judge-input.ts`+`oc-route.ts:statusForError` — `shape` 错 → 503 — `subplan` §3 "shape400" / `detailed-design` §5.3。
4. `judge-agent-tools.ts` — webfetch/websearch 请求后静默缺席 — `subplan` §5 / 任务目的"显式 not-ready"。
5. `capture-turn.ts`+`judge-envelope.ts` — 失败 `capture` 捏造 `callID` — `subplan` §7 "callID取本次真实call"。

P0-1/P1-2/P1-3/P1-4/P1-5 修复后需重跑 `npm run test:judge`、`test:protocol` 并补 P2-5 所列用例；其余部分（records 投影、时间归一化、工具闭集、目录/Edit 语义、auth/204/413、三条偏离本身）与 READY 合同一致。