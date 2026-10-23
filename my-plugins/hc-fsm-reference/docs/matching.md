# 采集、匹配与只读观察合同

## 严格 JSON 的版本边界

最终 v2 使用 `src/json_equality.py` 递归比较，JSON boolean / integer / float 类型必须相同；`true`、`1`、`1.0` 不相等。对象键顺序无关，数组次序、未知字段和值均保留。predeclared equals、tool input、tools schema、每步 golden、最终汇总均使用此比较；HC quiescence 也要求真实空 object，不能用空 array 代替。

旧 matcher 的真实四个失败保存在 `.runtime/json-types-first-failure.log`；v1 源码/基准原样保留，新 `*-v2.json` 全部重新收集和重放。`tests/test_json_types.py` 同时证明类型 mismatch 锁存，三个 PLOT 的全部 actor 行为和六份 YAML 未因修复改变。

## 模式和冻结

`PLOT-FILE` 同时用于 collect 与 replay；其中没有按模式切换行为的键。`use-plot` 每个模型请求都是一个新进程，以文件锁串行更新每轮 state；写 state 采用原子替换，runner 不会读到半个 JSON。

collect 不接受任意观测：每步先验证 `expect`、完整 HC 工具状态、真实 hook/daemon 决定、只读 actor/持久栈和显式迁移事件；再验证消息/结果/所有 actor 结束/正常 Stop/无在途请求。只有完整成功才写候选文件、fsync、chmod 0444，再用排他 hard link 冻结到声明的 golden 路径。已有路径绝不覆盖。候选文件保留在 `golden/candidates/`。

replay 先校验 PLOT、`src/*`、`bin/use-plot`、全部 YAML 与实际二进制 hash；在每个回执进入下一动作之前逐对象等值比较。最后对全部汇总对象再次等值比较，并检查 golden 前后 SHA256 不变。原始生产插件导出文件另由 `prepare_runtime.py` / `write_provenance.py` 与固定 Git blob 逐字节核对；HC supplied release 以版本/tag/hash 绑定，不声称重建证明。

## 每次工具调用的关联链

1. 模型实际发出 deterministic `plot_<actor>_<step>` toolCallId。
2. 被动 HC 插件记录 `tool.execute.before` 的真实 callID/session/tool/参数，在生产 FSM 插件之前运行，因此合法拒绝也有 before 记录。
3. 透明 shell 包装保存生产 hook argv、stdin、stdout、stderr、exit。包装不计算审批或业务结果。
4. 基础设施按 actor/session、精确规范化工具名、调用开始时间找到唯一 hook。其 payload 必须等于 PLOT 参数经固定生产映射后的对象；不用字符串后缀猜工具。
5. HC GET messages 中唯一对应 durable tool part 必须具有同一 callID、真实 session、精确 input、声明 completed/error 状态。完整 part 除精确列明的动态身份/时间字段外全部保留比较。
6. Unix-socket **GET** `/session/{root}/actors` 查询真实当前 actor；`store stack`、`store history` 只读读取持久库。不调用 `/state` 的 identity 桥、`/actor/acquire` 或任何写状态观察后门。
7. 对非 FSM 工具，关联唯一 daemon gate 行；对迁移，匹配该调用时间窗内预声明的全部 review/finish/commit 行及顺序。
8. mock 解码后的真实 toolResult 必须满足 step 约束并与 golden 完全一致，才准发下一工具。

单个 actor 仅一项工具在途；不同 actor 可并行。hook 本身没有 callID，因此唯一性是上述实际记录的 join，不伪称产品有原生 callID ledger。日志 raw 文件仍保留未归一化身份/时间，供追溯 join。

## 明确动态规则

PLOT 的 `observations.matching` 完整声明支持的严格 policy，框架拒绝其它 policy。`normalize_bindings` 明列哪些字符串允许替换。

| 字段 | 比较规则与边界 |
|---|---|
| session IDs | 从真实 enter/get_state/native agent 文本/StructuredOutput event 绑定；同名不可改变，不同 actor 必须不同。按完整 identifier token 替换，`ses_x` 不能匹配 `ses_xEvil`。贯穿 hook、tool part、state、消息 header、完成通知和父子关系。 |
| part/message IDs | 每个 actor/step 绑定真实 `prt_*` / `msg_*`，各自命名空间一对一，完整 token 替换；不是任意 ID 通配。 |
| 模型选择 | 仅 loopback `plot/plot-model`。PLOT 与 config 不用 recent-model 状态；普通 actor 的实际持久 assistant model 字段必须为此值。internal reviewers 同样经本地 raw HTTP/mock。 |
| toolCallId / 工具名 / 参数 | plot ID 原样逐字比较，实际 HC durable input 与声明展开后精确相等。生产映射例如 `agent→Agent`、`read.filePath→Read.file_path`。 |
| 模型工具定义 | 每个请求检查声明 count、无重名和 required names；完整 tools 数组/顺序/schema/描述逐字对象比较。普通 actor 当前为 26，reviewer 为 4；不借用其它安装的 25-tool 旧快照。 |
| run/work/package 路径 | 只替换声明的精确前缀；完整原始路径保留在 raw evidence。Bash/agent/read 的实际参数还要匹配展开后的真实路径。所有 child 显式 cwd，不依赖默认 worktree。 |
| PID | `store identities` 的唯一 agent_pid 必须等于 runner 精确创建的 HC PID，才允许变成占位符；不是“任意正整数都算匹配”。 |
| process start ID | 真实 registry `start_time` 必须正整数，作为这次存活 HC 的动态 process identity 单独绑定；不声称重建了操作系统的微秒级启动时间。 |
| 端口/URL | registry URL 必须恰好是 runner 自有的 loopback HC URL，再按指定字段归一化。交付的 collect/replay 端口集合独立；无连接用户服务。 |
| HC tool `/state/time/start,end` | 必须整数且 start≤end；只对这两个绝对毫秒字段归一化。其它 metadata 不丢弃。不声称对任意时钟跳变有恢复能力。 |
| FSM stack `history[].timestamp` | 解析 ISO8601，要求当前存储栈中的历史非递减；只改这些字段。state 列表与历史内容/顺序均精确比较。 |
| daemon event timestamp | 必须位于对应 HC 工具调用开始到 durable part 结束之间，允许同机毫秒舍入 ±1ms；只改 timestamp 字段。未匹配事件导致失败。 |
| finish `/content/duration_ms` | 只在 step 明列的 ledger 行上处理；必须整数 0..30000，对应 finish 30 秒声明。所有结果/计数/from/to/变量等仍精确匹配；不删除所有数值。 |
| 随机密文 | 正式 HC cases 为明文 store，没有把加密随机性通配掉。加密由独立上游单测验证，未加入 HC golden。 |
| 并发次序 | 保留每个 actor 的 step 次序与每次调用内部 ledger 次序；不同 actor 按身份/step join，不虚构全局顺序。被选中的消费消息按声明的发送者身份匹配。两个 soft gates 用真实双请求屏障，反馈仍严格按 YAML A/B 顺序。 |
| 数学值 | 21、7、42 等业务数字不归一化，不能污染 `plot_root_007` 之类 ID。最终 sum 只读取真实收到的数值绑定，并验证预声明最终消息。 |

JSON 工具结果采用 PLOT 明列的完整 `json` payload 表示，而不是比较其空格/缩进；所有 JSON 字段保留。native 文本/TSV 保留完整 text。完整 raw content、HTTP/SSE 和 durable part 仍可逐字追溯。没有删掉整个 state、metadata、错误块或允许多个互斥格式。

## 不同协议不能混为一谈

- 当前 mock 的 OpenAI toolResult 解码把 toolName 变成空串、isError 变成 false。PLOT 对此唯一格式作精确约束，但另外读取 HC durable tool part 的真实 `state.status`，因此 const/gate/admission 错误不会被洗成成功。
- HC 的 management tools 某些语义拒绝返回 completed 文本；例如 stop sibling，不能要求它等同于抛异常。
- `identity-acquire` / `check-permission` 返回审批 JSON；合法 block 退出 2，stderr 必须逐字等于 JSON reason 加换行。不是忽略 stderr。
- `subagent-start` 退出 0 且 stdout/stderr **必须为空**，不能强塞 allow JSON。
- 正常 `stop` / `subagent-stop` 必须唯一、退出 0、JSON Allow；中间 pause 单独声明。全部生产 hook 数量都必须可归属，没有“多出来但忽略”的调用。
- default actor 首次只读 get_state 后，持久 stack 可尚不存在。仅 PLOT 指定 `persisted_state:absent` 时接受 CLI exit 1 且**完整精确缺席错误**；同时 live actor API 必须找到唯一 actor。如果此时出现持久快照也失败，没有自动 fallback。
- StructuredOutput 在 internal session 被删除前可能没有下一模型请求，因此只从真实 completed event part 结算，检查完整 input/output/metadata/身份/时间，而非手工注入回执。

## 首错锁存及失败证据

首个 mismatch 创建排他的 `FAILURE.json`，保留 expected/actual mismatch 文件及 traceback；此后所有请求都拒绝推进。脚本返回模型可见 HTTP 409 / `plot_mismatch`，proxy 也拒绝自动 retry。runner 监控首错并终止它通过 `start_new_session=True` 创建的精确三个进程组，等待其子进程退出；不使用 wide pkill、不动其他会话。

- `tests/test_mock_fail_fast.py`：真实 mock 第一次错误值后返回 409；改成正确值的第二次请求仍 409，next=0、golden 不存在。
- `tests/test_hc_fail_fast.py`：真实 HC `runs/c0251d48c` 的 next=1/pending=1，43≠42 后第三步写入未执行；三个自有组均不存在，所有成功 golden hash 不变。
- 正常六轮也检查 cleanup 的全部自有服务已回收。服务崩溃、重新父化或跨进程重启情形不在本次清理正确性证明内。

原始后台 `fsm.log`、`fsm-logs.jsonl`、client log、HC log 全保留；其中非语义的全量 debug 文本不做整文件 golden。被声明为关键证据的 gate/review/finish/commit 行则是完整对象比较，不把“有日志文件”当测试通过。
