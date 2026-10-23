# Contract Expectations — fsm-7-subagent-tmux (v2)

事前源：subplans/fsm-7-subagent-tmux.md + docs/research/fsm-7-subagent-tmux-research.md（含 §5 软停门规格）。v1 expectations 中未作废条目（7 行不变式、右列指标、/subagent 命令、extraArgs 消毒）继续有效。

## 1. 契约源

上游实证：badlogic/pi-subagent（metadata/inbox/sendUserMessage/挂起语义）；lihaokun/mcp-server-fsm hook `plan_stop_route`/`reduce_stop`/`agent_cli`（软门规格与"OC 后端忽略 model 字段"）；daemon `/actors`（fsm_name/state/no_progress_count）。

## 2. Schema/字段

metadata.json：`{version, sessionId, parentSessionId, tmuxSession, cwd, model, thinking, launchArgs, extraArgs, state: starting|busy|idle|exited|stopped|suspended|error, hasStarted, outcome, summary, createdAt, updatedAt, error?}`，原子写 0600。inbox：`<childDir>/inbox/<seq>.json {message, delivery: steer|followUp}`。stop verdict：`{action: WaitForAsyncWork|HumanIntervention|ArrangeObservation, reason: string}`。config 新增 `stopAnalysis?: boolean`（缺省 true）、`stopJudgeModel?: string`。

## 3. 枚举

metadata.state 七值；delivery 两值；verdict action 三值；行状态 = busy|idle|exited✗|stopped|suspended|error 映射穷举。

## 4. 流程

P1 spawn：准入→目录/metadata(starting)→inbox 初始消息→bundle→tmux new-session（env 显式注入，PI_* 清洗保留 PI_CODING_AGENT_DIR）→等 ready(HTTP)。
P2 child：session_start 读 bootstrap→acquire→报 ready→起 inbox 轮询(250ms)→投第 1 条→busy；agent_start/settled/shutdown 更新 metadata；HTTP 事件上报 parent。
P3 stop-gate：route(is_terminal→放行/缺 state→malformed/analysis off→确定性回退/否则 Analyze)；Analyze=evidence collect+live-work∪busy children+recent_plans+last_assistant→judge→reduce(fail-closed)→allow 时 /stop-reset。
P4 steer：parent 写 inbox；child 轮询投递；结果=活动分支末条 assistant。
P5 挂起/收养：干净退出→kill+标 suspended；恢复 has-session 活→收养（不杀不重启）；suspended→下次投递时 --session 重启。

## 5. 行为

- settled 永不杀会话；任何目录永不删除；显式 stop 级联后代。
- judge 一切失败/空理由/非法 action/缺佐证 HumanIntervention → Block（fail-closed，无例外）。
- stopAnalysis 非法值 fail-safe 为开并警告；OC 模型语义=宿主默认，stopJudgeModel 仅宿主覆盖。
- inbox 坏 JSON：跳过+metadata error，不断轮询器；初始 prompt= inbox 001 无特例。
- child 不注册 AskUserQuestion/selector//subagent/judge；人工 /exit 致 FSM 非终态=aborted 如实上报。
- mock stop-reviewer 协议：judge 请求按 system 标记（我们注入的 FSM-STOP-ANALYSIS 标识 + verdict schema）与普通对话区分；剧本可编程 verdict（CONTROL:stopverdict=wait|human|observe|invalid）。

## 6. 时序/状态

ready 先于工具注册；inbox 投递在 ready 后；suspended 恢复重启保留全历史；挂起对账先于 root 退出完成；Analyze 全程在 before_settle 内（未 settled）。

## 7. 不变量/性质

- I1 metadata.state 迁移仅沿合法边（starting→busy/idle/error；busy⇄idle；→exited/stopped/suspended 终态）。
- I2 inbox 消息恰投一次（成功即删；失败保留重试上限后标 error）。
- I3 liveness：metadata 非 exited/stopped/suspended ∧ ¬has-session ⇒ parent 对账收敛为 exited。
- I4 reduce 全分支 fail-closed：除 WaitForAsyncWork 与带佐证 HumanIntervention 外一律 Block。
- I5 目录不删除：任意路径（含 stop/suspend/崩溃）后 metadata+session.jsonl 仍在。
- I6 软门放行必带 /stop-reset（best-effort，失败不改裁决）。

## 8. 性能/界限

inbox 轮询 250ms；Analyze 单次 judge 预算=stopJudgeTimeoutMs（默认 60s）；evidence 采集有界。

## 9. 安全/副作用

tmux 命令注入防护：session 名白名单字符、参数数组式 execFile 不走 shell；inbox/metadata 0600；仅操作自己创建的 tmux session 名（fsm- 前缀+校验）；judge 失败不升级权限。

## 10. 一致性/退出

行为判据对齐上游 hook 语义（非逐字 prompt）；判别性 parity 场景：stuck-loop 软门两侧同判；native 套件改写后全绿；tmux 全生命周期手操通过；path B 独立审待 owner 授权。
