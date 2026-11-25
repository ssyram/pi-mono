# 首错保留、边界定位与真实限制

全部 HC 失败运行索引：`evidence/failures-v2.json`。17 个失败目录全部保留，均未冻结 golden；3 个是故意 mismatch（v1 `c3963219e`、v2 `ce91db72a` 和最终 `c0251d48c`），其余为开发诊断。类型单测的首个真实失败另存 `.runtime/json-types-first-failure.log`。最终 v2 三个 collect 和三个 replay 没有失败。

| 首错/运行 | 失败边界 | 实际处理与复验 |
|---|---|---|
| `.runtime/fsm-build-first-failure.log` | cargo 在包根执行，找不到 manifest；尚未编译产品 | 改用固定导出副本的显式 `--manifest-path`，release 构建成功。错误重定向曾短暂在父目录创建自有 `fsm-build.log`，读后立即迁回包内；未修改参考源码/全局安装。此范围失误不隐去。 |
| `20261023T043351.473517Z-collect`、`20261023T043431.853292Z-collect`、`ca68e36a9` | macOS Unix socket 超过 SUN_LEN；相对路径又被产品 lexical absolute 保留冗余段 | 使用包内短随机 run ID＋短**绝对**数据路径；不写包外 socket、不 patch 产品。早期尝试均保留。 |
| `c993b6f1d` 的 `'type'` 与原始 403 | mock decoded toolResult 文本块没有 type；Python hook 包装使首个非 shell PPID 变成 Python，identity bridge 对不上 MCP client 的 HC owner | 按真实单一 codec 形状解析；改成产品明确跳过的透明 shell IO 包装。后来每轮要求 store identities 中 agent_pid 精确等于自有 HC PID，所有调用真实关联。旧包装源码保留 `.runtime/failed-hook-observer.py`。 |
| `cacf345fe`、`c2786110b` | 剧本误以为 description / instructions 运行时展开模板 | 源码调用闭包确认仅支持指定 invariant/review 入口；把真正模板 case 放入 invariant，不接受两种结果。原始错误预期保留于运行 manifest/request；不是修产品或改 golden。 |
| `cddaeebdb` | 观察器把合法 exit 2 的拒绝 stderr 当运输失败 | 按真实协议要求 stderr 逐字等于 JSON reason＋换行；exit/decision/HC error/daemon deny 必须一致。 |
| `ccbb40397` | 默认 actor 首次只读 get_state 还没有持久 stack，store CLI 合法返回 1 | 只在该 PLOT 步骤预声明缺席，要求完整精确缺席错误，同时 GET live actor；不得构造快照或无条件 fallback。 |
| `ce88a69c1` | runner 并发读到正在原地写入的半个 state JSON，随后清理造成代理断开 | state 原子替换；单写者/并发读单测100轮及之后完整 HC 诊断通过。 |
| `.runtime/framework-tests.log` | 直接 mock 测试把 SSE 当普通 JSON | 根据实际固定 OpenAI SSE 协议解析唯一 tool-call delta；故意错误和改正重试仍都必须409，不减弱断言。 |
| `c8797a584` | completion 观察把静默的 subagent-start stdout 当审批 JSON | 生产 `hook/main.rs::subagent_start` 明确静默；现在严格空 stdout/stderr、exit0；Stop 仍必须结构化 Allow。不能因为 actors done 就当该失败成功。 |
| `c1c41f2bd` | 已真实 accept 的 soft 回执字段误写为内部 `reviewer_feedback` | 对外 DTO 为唯一 `review_feedback`；更正字段名，A/B 内容与顺序断言不变。 |
| `ce6470b6b`、`c913b748a`、`c41b02146` | gate allow 事件实际省略 reason_code，观察器误要求存在 | 明确区分变体：Allow 必须无该键，Deny 必须等于具体声明代码；不接受两种 Allow 输出。 |
| `c3963219e` | v1 故意 mismatch：预期43、实际42 | 原样保留；正确失败，不当成功 collect。 |
| `.runtime/json-types-first-failure.log` | Python普通 `==` 混同 true/1/1.0，连 nested/golden 也可能误接受；5个定向测试4失败 | 仅修框架为递归 type-exact JSON及 status object校验；v1代码/基准保留，三组业务动作和YAML不变，重新collect/replay到新的v2 golden。禁止改写旧baseline。 |
| `ce91db72a`、`c0251d48c` | v2 故意 mismatch：预期43，实际真实算术42 | 正确退出1，首错锁存/409，next1/pending1；后续写入未发生；无 golden；自有3组退出；最终测试同时校验六份v1/v2基准hash未变。 |

v1 的六轮原始数据本身类型一致、当时断言下通过，但旧 matcher 有类型漏洞，故不再作为最终严格验收。`evidence/v1-runtime/` 保存修改前源码/剧本/YAML，旧 `evidence/results.json` 和三份旧 golden 均保留。v2 六轮重新获得同样真实结果，最终框架27/27；没有把旧结果补标成新证明。

所有修改只修框架/剧本或包内运行环境；没有改 FSM/HC/mock 参考产品来让测试通过，没有手工调用 FSM 写状态、补文件救成功运行或重写冻结基线。

早期两个 JSON 解码失败当时仅保存了首错 JSON 与原始请求/进程日志，尚无本包 traceback 文件；索引如实列空数组。后续全部失败另存 traceback，不能补造不存在的第一份 traceback。原始工具执行日志仍在本次执行记录。正式成功六轮的 HTTP/SSE、工具、hook、状态和最终回执完整保留。

## 上游测试失败不是本包通过宣称

第一次隔离全量 Rust 在较长 TMPDIR 上使三个真实 socket 测试失败；改到包内 `.t` 后这四个 socket tests 全部通过。最后 `--no-fail-fast` 仍有两个 target、11 个 case 失败：

- `stderr_silence_142` 的两个固定 `fsm-stderr-142-.../server.sock` 名称仍超过 SUN_LEN。
- `spawn_restart_integration` 的九个 HOME＋`/.mcp_server_fsm/server.sock` 超长；`.t/mfs-bs75065-3/.mcp_server_fsm/logs/server.log` 保留三次真实 `path must be shorter than SUN_LEN`。

本包根绝对路径已有68字符，不能在“唯一可写本包”的约束下给这些固定长模板提供正常的短 `/tmp` HOME。没有改上游测试、放宽 capability 要求、删除失败、调用全局服务或把它们记为通过。普通 HC runs 通过短 data-dir 正常工作；不把这当 daemon 重启测试通过。

## 安全与操作残余

- 无 npm/pip 安装、无 npm dependency 生命周期；Cargo 从固定锁定源码做必要原生构建。第一次 FSM build 用了现有 Cargo 缓存，后续复制公共 registry 到包内，所有后续构建/测试使用包内 CARGO_HOME。
- HC 空缓存曾自动获取其固定 ripgrep 15.1.0。该包内真实产物后来预置到每轮 PATH，并固定 hash；没有使用 Pi 的 rg/fixture。它和 supplied HC release 都没有本包可复现源码构建证明。
- runtime 未调用真实模型；配置/目录隔离不是 OS/network sandbox。所有动作都是预声明工具，不能外推为任意不可信模型的安全沙箱。
- `FSM_STOP_ANALYSIS=0` 是明确的实验配置，不宣称 semantic Stop/anti-spiral 通过。watchdog未真实等待600秒，HC crash/restart、加密HC链、UI/跨平台清理均未完成；详见矩阵 S01–S16。
- self-check ready 是产品 token 回执，不是自然语言 liveness 的自动证明；本包强 oracle 是显式工具/状态/已消费消息/完成约束。不能由通用 evidence 文案外推所有业务正确性。
- 输入指纹保守包含全部 `workflows/*.yaml`。扩展其中任一文件或新增 YAML 都使旧输入指纹不同；应保留 v1 golden、用独立包版本/新基准路径开展扩展，不能自动重录旧基准。
- 根 pi repository 最终观察到两个**非本包**暂存项（`.gitmodules` 和 `my-plugins/fsm-compatible/vendor/pi-subagents`）；本包没有 stage/commit/push，也未读或改它们。参考 HC/FSM tracked status 仍干净。不要清理其他人的暂存区。
