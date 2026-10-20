所有验证内容已审查完毕。以下是最终的范围确认报告。

## 审查 — fsm-3 实施对照修复限定确认（仅 P0-1、P1-2～P1-5 与既定 P2 处置）

范围：仅核对我 `audit-report-initial.md` 中五项 BLOCK 差异的修复与直接回归，及 P2-1/2/4/5 处置；P2-3 按指示由 fsm-5/安装单元承接，不在本轮要求内。已核对正确的部分未重开。全程只读。

### 逐项确认

- **P0-1 已闭合（abort 虚假确认）**。`src/judge/judge-session.ts`：`JudgeEntry.agent` 保存运行中 Agent；`abort()` 对活动回合执行 `agent.abort()` → `waitForIdleBounded`（10 秒预算）→ 未确认抛 `not-ready`（→503），确认后才 `updateJudge(idle)` 并返回 `true`；无 Agent（本就 idle）直接 `true`。`close()` 对残留 Agent 先 abort。测试 `test/judge-session.test.ts` "abort during a live turn waits for real termination before reporting idle" 重现了 busy→abort→释放 aborted 消息→`true`→idle 的真实时序。符合 expectations §4 P4（"等待实际abort/idle…无法确认非true"）与 subplan §5.4 abortJudge post（"true是真的停止generation"）；consumer 合同（`agent_cli.rs:2146` 仅认 JSON true）现可成立。
- **P1-2 已闭合（空 body abort 400）**。`src/protocol/oc-server.ts` `readBody`：零长度 body 返回 `undefined`，不再 `JSON.parse("")`；测试 "…strict 204" 块新增空 body abort → 200 + `true`。与原 consumer `body None`（`agent_cli.rs:2143`）兼容。
- **P1-3 已闭合（shape 400）**。`src/protocol/oc-handlers.ts` `postMessage` 将 `parseJudgeInput` 的 `protocol-invalid` 转为 `OcHttpError(400)`；记录投影坏关联仍走 503（`oc-messages` 路径未动，符合"坏关联/时间503"）。测试新增 `badShape` → 400。符合 subplan §3 路由表与 detailed-design §5.3。
- **P1-4 已闭合（web 静默缺席）**。`judge-session.ts` `run()` 解析 policy 后，请求 `webfetch`/`websearch` 任一即抛 `not-ready`（→503），含注释说明 factory 由安装单元接线；测试 "web tool requests stay explicit not-ready until factories are installed"。符合 subplan §5 与任务目的"显式 not-ready"。
- **P1-5 已闭合（捏造 callID）**。`capture-turn.ts` `FailedCapture` 增加真实 `toolCallId`；`judge-envelope.ts` 失败 part 使用 `failure.toolCallId`；测试断言失败部分 `callID === "bad"`。符合 subplan §7 "callID取本次真实call"。
- **P2-1 处置到位**。`ls src/judge` 确认 `finish-turn.ts`/`judge-error.ts` 已删除（仅剩 9 个文件）；`audit-decisions.md` 明确 typed provider 分类（ProviderAuth/ContextOverflow/ContentFilter/APIError+isRetryable）由 fsm-5/安装单元在真实 provider 事件接线时落地，不以死代码冒充。unknown 路径由 `oc-messages` 承担且 consumer 兼容（`agent_cli.rs:1737` unknown → 有界重试）。
- **P2-2 处置到位**。`maxJudges`（默认 64）+ 构造校验（model/getApiKey/streamFn 缺失即 not-ready）；`create()` 超限 `queue-full`，`createSession` 边界转 503（与路由表"容量→503"一致；409 映射仍仅限 postMessage 并发）；测试 "judge capacity is bounded"。
- **P2-4 处置到位**。`children` 对 judge 返回 `[]`（HTTP 测试断言）；`bashExecution` 改为真实 bash tool part（`tool:"bash"`、`callID: bash_<entry.id>`、`state.input={command}`、exitCode 非零或 cancelled → error、完整 `metadata.pi.bashExecution{command,output,exitCode,cancelled,truncated}`），符合 §4"生成有标识的 assistant envelope 与 bash tool part"；`edit` 特殊分支在 queue 进入、stat 后、readFile 后、最终 writeFile 前共 4 处复查 signal，原生路径透传 signal。
- **P2-5 处置到位**。承诺的六个新用例全部落在对应测试文件：运行中 abort 真确认、空 body abort、judge shape 400、失败 capture 真实 callID、web 请求 503、create 容量。`test/judge-session.test.ts` 现 8 个用例块，其余既有用例（envelope/conflict/repair/length）未削弱。

### 记录项（不阻塞，不重开范围）

- **P2-r1**：`judge-file-tools.ts` 空 oldString 新建路径中，`mkdir` await 与 `wx` `writeFile` 之间仍无 signal 复查——修复记录称"每次await后复查"，此一处缺口与字面合同（§5"取消检查在进入queue及每次await后"）有微小偏差。窗口极小且 `wx` 防覆盖，不构成削弱；建议后续在 `mkdir` 后补一次检查。
- **P2-r2**：`oc-messages.ts` assistant 投影中 text/reasoning 用 `parts.length` 计数、tool part 用独立 `toolIndex` 计数，text 先于 toolCall 的消息会在同一 envelope 内产生重复 `prt_<entry>_0` id。此为初始实现即存在的行为，不在本轮既定核对清单内，仅记录：consumer 按 `callID` 关联 tool part，实际影响有限，但 §2"实际content index"暗示 part id 应唯一；建议后续统一改用单一 `parts.length` 计数并补唯一性断言。
- bash tool part 的 `bash_<entry.id>` 为合成确定性 callID——bashExecution 本无模型 callID，属"有标识"要求的合理承接，予以接受。

### 测试与记录核对

修复记录 `docs/fixes/fsm3-audit-fix-blockers.md` 与 `docs/audits/fsm-3-protocol-judge/audit-decisions.md` 与实际源/测试逐项一致。最新结果（judge 16/16、protocol 14/14、admission 22/22、runtime 37/37、tsc 0）按任务约束未独立复跑，仅核对了覆盖面与本轮新增用例的存在性及断言内容。

### 合并判定

**通过**。五项 BLOCK 差异全部闭合且回归到位；P2-1/2/4/5 处置符合意见；P2-3 承接记录在案。残留仅两条记录级 P2（P2-r1 mkdir-writeFile 间 signal 缺口、P2-r2 part id 双计数重复），均不削弱固定子准入、mandatory、原 driver 裁决/repair 归属或隔离合同。建议实施者在下个触碰点顺手处理 P2-r1/r2，无需专门回合。