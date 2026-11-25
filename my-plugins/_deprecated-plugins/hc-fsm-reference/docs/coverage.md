# 固定 dev 全 feature / 测试覆盖账

基线为 FSM 对象 `216f7aabac78956dbafce45ef4b1edbb65dd0507`，不是外部 master。完整注册表、schema 字段、精确 YAML/API 语法、生产函数与既有测试路径见 `pinned-fsm-source-survey.md` 的 48 行矩阵。以下逐行映射同一闭集，**不把 feature IDs 三项当产品全集，也不把有测试文件当测试通过**。

标记：**H**＝本包真实 HC collect/replay 均通过的明确子集；**U**＝本次固定源码中相关 Rust/Bun 测试实际通过，但不等同 HC 黑盒；**E**＝仅调查到既有测试/实验，未执行；**X**＝本次未验证。多种标记并列时以右列的边界为准，不给虚假的全 feature 百分比。

最终 H 证据均指 v2：`cfdc2552b→r2fdcb283`、`c5f603b8b→r1f1658da`、`c504eb525→rd0479d9f`。v1 的 Python JSON equality 漏洞由真实失败测试发现，保留旧源码/基准后仅修框架，未弱化业务 case，并全部重新实跑；具体见 failures.md。

## 闭集 48 行映射

| # / 生产 feature | 本次证据 | 未覆盖 / 不能外推的边界 |
|---|---|---|
| 1 YAML 注册/图验证 | H：每轮真实 register-skill，六份 YAML 的 registration 回执；U：session/schema tests | 重名、无效图、stdin、force 不由正常注册证明。 |
| 2 capabilities/schema/wire 协商 | H：每轮 capabilities 为 0.11.0 / schema 2 / wire 7、三项 feature；U：capabilities/tools tests | 两个 stderr/mixed-peer socket 集成因路径失败，不能称全部协商测试通过。 |
| 3 live force refresh | U：session refresh、removed-state/epoch/race tests | X：HC 活跃 frame 中 force 更新及并发刷新。 |
| 4 初始化/嵌套/恢复父帧 | H：alpha/002–005，深度 2→3→2、ticket 保留；gamma 首次 enter | U：一般 mutable/const 跨帧性质；不是 daemon 重启恢复。 |
| 5 full/compact state 和三态 | H：所有实际 FSM JSON/state 快照、active/terminal/inactive 与 exit offer | U：全部投影/property cases；不假定 accept 总含 full vars/liveness。 |
| 6 target-bound self-check | H：所有正常迁移＋root/002 缺 token；U：automaton token tests | X：HC false item、完整列表、target mismatch 等变体。产品不自动校验 property 列表等于 YAML。 |
| 7 prepare/guard/commit 分类 | H：root/001 unavailable、/002 self-check-required、所有 accept；完整迁移账本 | U：reject、token 消耗、malformed wire；X：HC 全部拒绝分支。 |
| 8 authored forward/back/self-loop | H：forward edges；U：cycle/self-loop engine tests | X：HC authored backward/self-loop；不支持旧 fsm_back/VCS rollback。 |
| 9 implicit exit / legacy alias | H：所有 `_fsm_exit` 都显式自检、frame 真实释放 | U：终止态其它边/alias；X：HC 实际调用两个兼容别名。 |
| 10 MCP history / operator history | H：只读完整持久 history、每次 transition ledger | U：MCP history contracts；X：本包没有直接调 `fsm_get_history`，不把 store history 冒充它。 |
| 11 hard shell checks | H：Reference pending=7、worker result=21、soft amount=42 的真实 CLI check | U：失败/首错停止；X：HC hard reject/无界 hard command；hard 不继承 finish timeout。 |
| 12 context/变量 CLI | H：hard 的 var get pending/committed、finish ensure-const | U：context JSON、缺值/字节/无环境注入；X：HC context 文件变体及 CLI set。 |
| 13 const/intrinsics | H：enter/dispatch vars、真实 session/agent/agent_cli、const 重写拒绝、finish const、idle retained=6 | U：所有 reserved/conflict/late publication；URL 不当 intrinsic。 |
| 14 pending/committed | H：root/007–009 与 /019，成功迁移后 committed=7；workers | U：reject 保留 pending、所有名字冲突；X：HC reject 后恢复变体。 |
| 15 runtime templates/invariants | H：Reference global+state invariant 联合，`vars.committed.base` 展开为 35 | U：missing/unknown/single-pass/UTF-8；instructions/description 不作运行时展开。 |
| 16 regex permission DSL | H：真实 blacklist 拒绝及 requires-dispatch whitelist；完整规范化 input/审批/工具结果 join | U：anchors、AND/OR/first-match、shape/parser/property；X：HC 所有工具/regex 变体。 |
| 17 六种 typed-exact | H：WorkerAlpha 的 typed-string 规则被真实注册，capability 需求接受 | U：null/bool/number/string/array/object 的匹配/边界测试；X：该 blacklist 在 HC 未触发，不能称六类型黑盒通过。 |
| 18 enter/dispatch admission flags | H：root/021–022 两个独立真实拒绝 | U：ordering/race/恢复；拒绝 dispatch 不等于禁止 native agent。 |
| 19 requires_dispatch | H：队列空时真实 deny；排入两项后两次 Agent allow，ledger 真实计数 2/1 | U：blacklist 非法声明等；queue 数本身不作为 child 归属证明。 |
| 20 FIFO/TTL/claim | H：root/010–013、alpha/beta 第一次 get_state 已分别为 first/second frame | U：publication/并发/TTL；X：1800 秒实际过期、并发 claimant 任意排列、重启 queue（本就不持久）。 |
| 21 single/vote review | H：soft-review 两个独立 single reviewer 真正 read + StructuredOutput | U：8 个 reviewer integration 与 review tests 含 vote/pass/reject/infra；X：实际 HC vote。 |
| 22 escalate/human confirm | 源码明确 escalate 走 single | **未实现人工确认**，不列作已实现/通过 feature。 |
| 23 soft scheduling | H：guard parallel 覆盖 FSM sequential、双请求 readiness 屏障、峰值 2、A/B feedback 顺序 | U：sequential/bounded window/首错不再 dispatch/local config precedence；X：HC 全部 operator 和失败窗口变体。 |
| 24 review artifacts/criteria files | U：resolver/skill_dir/work_dir/vars/glob/授权根 tests | H 的 reviewer 是直接 read 工作文件，不冒充 `review_artifacts` 解析 feature；HC 该字段变体 X。 |
| 25 reviewer tools/backend policy | H：internal reviewer 实际 4 tools，默认 Read/Glob/Grep＋StructuredOutput，本地默认模型 | U：合法 opt-in/default deny；X：HC Bash/Edit/Web 等 opt-in、Claude model override。 |
| 26 typed/semantic judge、repair/retry | H：真正 HC structured completed part、coherent pass schema、两份 feedback | U：malformed same-session repair、API/backoff/global budgets；X：HC 错误/repair 全链。没有调用真实 provider。 |
| 27 finish | H：硬/软之后 finish、const 落地、完整 finish→commit ledger | U：非零/timeout/process-tree kill/输出截断；X：HC 重试 at-least-once、失败 commit 后副作用。 |
| 28 guard custody | U：guard_tree/store/materialization/client checks | X：HC register --guard-root / tamper / startup sweep；capability advertised 不算执行。 |
| 29 identity bridge/序列化 | H：68 次工具实际 callID→HC→hook→daemon→state 关联，root identity 等于自有 HC PID | U：TTL/connection/races；4 个真实 socket tests 通过。非任意并发正确性证明。 |
| 30 early actor/context | H：3 个 child-start 静默回执，预入帧/首次进入区别；agent_cli=opencode | U：unified acquisition/late context；HC 插件初始化不调 session-start，不能说测了该入口。 |
| 31 pause/deterministic Stop | H：idle-resume 的有帧合法暂停＋恢复；所有最终唯一正常 Allow 且释放到 default | U：非法 Stop reducer；X：HC 非法 pause 触发的正常 Stop 阻止。 |
| 32 semantic Stop/anti-spiral | 显式 `FSM_STOP_ANALYSIS=0`；U：hook/automaton/插件相关 tests | X：HC semantic Stop judge、counter/plans/人工升级链；soft-review 不冒充 semantic Stop。 |
| 33 Stop 失败方向 | U：hook reducer/插件 transport tests；Bun 101/101 | X：HC daemon/collection/auth/judge 失败的 fail-open/close 全链。模型 mismatch 的 409 不是这些产品失败。 |
| 34 host tools/question/delivery gate | H：真实 Bash/Agent gate、FSM identity bridge、native communication | U：normalizeTool/question/gate tests；X：实际 question/Ask 抑制/回答释放。当前 headless wire 仍有 question 定义。 |
| 35 watchdog author scope | H：invariant 联合/展开；watch false/601 配置被注册 | U：600 秒 bucket、继承/union/default/active；X：真实定时 watcher 启用。 |
| 36 scheduling/reconcile/context reuse | U：client roots/watch/watcher 和 shared driver tests | X：实际 HC 周期、重启 reconcile、panic/预算/context rotation。普通流程完成不证明这些。 |
| 37 watch archive/advisory/receipt | U：typed verdict、archive/delivery bookkeeping tests | X：HC watchdog advisory 的持久/消费、交互 Channel；native agent_send 成功不替代 Watcher delivery。 |
| 38 Shared Evidence | H 部分：生产 soft 路径实际 collect root；原始 v2 index/JSONL 已保存并额外人工核对 | U：index-last/tails/stale/failure/cancel；X：HC root+children 完整性及全 index golden 匹配。 |
| 39 live work/process lineage | H：真实根 PID/启动身份/源 URL；U：macOS process/socket/lineage tests | X：HC live-work confirmed/none/unknown 各类真实子进程；Linux/其它平台未跑。 |
| 40 durability/restart/migration | H：同 daemon、同 session 的多 run 保留 FSM/上下文；U：store/session/migrate tests | X：HC daemon 重启后立即 permission/Stop 恢复；9 个 CLI lifecycle tests 因长路径失败。 |
| 41 encrypted store | U：SQLCipher/keys/store 加密单测真实执行通过 | X：HC 加密 store、per-install secret；当前均明文测试库，development placeholder。不存在 per-var encrypted YAML。 |
| 42 conversion/recovery/rewrap | U：取消/backup/corrupt/wrong-key/恢复 tests | X：HC 真实升级/rewrap/restart链；不声称日志/Evidence因此被加密。 |
| 43 transport/auth/platform | H：真实 macOS Unix-socket、UID/token正常路径；U：auth/identity/4 socket integration | X：多 UID 对抗、二进制替换/所有平台安全性。token 从不进入 HTTP 采集日志。 |
| 44 foreground/lifecycle/services | H：自有 foreground daemon 与精确组清理；真实 mismatch 清理也通过 | U：service/lock/pid 纯测试；X：真实 systemd/launchd/安装；9 个 CLI lifecycle失败，不 patch。 |
| 45 operator views/logging | H：每步 actor/stack/history/identities、完整 gate/transition 比较、原始 logs.db 导出 | U：store/logging、两个 client silence/file tests；另外两个 socket cases失败。 |
| 46 installer/config ownership | E：全部 15 个 Python test 文件＋conftest、dry-run/rollback/ownership 事实已调查 | X：installer pytest、真实 install/reinstall/uninstall。实验手配 config 不能证明安装器有独立 HC target。 |
| 47 production plugin settlement | H：固定插件真实 before/idle/Stop、internal judge exclusion、子启动；Bun U 101/101 | X：HC compaction/autocontinue/UI/status 全变体。原调查中“HC待建立”的条件性结论现只对这些已实测路径被替代。 |
| 48 status/graph/TUI/static viz | H：live actor GET 只读查询；U：visualizer 两个 unit targets＋17 render integration | X：HC graph drilldown、TUI/clipboard/浏览器交互；四个 TUI test 文件未执行。 |

## 运行结果与既有测试全集

权威机器账：`evidence/test-results-v2.json`。

- 本包：27/27（含严格 JSON 类型、业务动作/YAML未变、真实 mock 重试拒绝与真实 HC 故意 mismatch），日志 `.runtime/framework-tests-v2-final.log`。首次类型回归旧 matcher 的4个失败单独保留，不覆盖为绿色日志。
- 固定 FSM Rust：`cargo test --frozen --workspace --no-fail-fast`，1748 次通过、11 次失败、0 ignored。计数跨 lib/bin/integration，可能含同模块重复执行，不冒充独立测试数。
- 已通过 targets：server lib 531、server bin 888、process_identity_socket 4、client lib 222、reviewer integration 8、client stderr 中 2、hook unit 57、acquire_hooks 3、spawn/restart 中 4、visualizer 6＋6＋render 17；另有零测试目标/doctests。
- 失败 targets：`crates/client/tests/stderr_silence_142.rs` 两项 bind 失败；`crates/hook/tests/spawn_restart_integration.rs` 九项 daemon start/lifecycle 失败。根因证据 `.t/mfs-bs75065-3/.mcp_server_fsm/logs/server.log` 逐字为 `path must be shorter than SUN_LEN`；测试源码自身指出必须短 HOME。没有把成功 probe.sock 等同于更长的 `.mcp_server_fsm/server.sock` 可用。
- 固定生产插件：`.runtime/plugin-tests/3b7cd716/output.log`，Bun 1.4.2，101 pass / 0 fail / 227 expect。

测试目录与内联 suites 全集来源：`git ls-tree -r`＋`#[cfg(test)]`/`#[test]`/registry/schema/source 闭包调查，详见原调查“Dedicated test directories”“Inline Rust suites”。范围包括 `crates/{server,client,hook,visualizer}/tests`、各 src 内联测试、server proptest seeds、`tests/install`、`opencode-plugin/fsm-plugin.test.js`、TUI 的四个 test 文件。installer 计数为 **15 个 test_*.py＋conftest**，不把 fixture 当另一个 suite。

experiments 全家族均已调查但不自动运行：demo（真实 FSM＋stub peer，不是 native HC）、full_e2e（真实 provider 腿禁止作为本次 subject）、peer_contract、diagnostic、sqlcipher_spike、eval/tasks、swebench。不能把这些历史 results.md 或测试文件存在当本次通过。没有导入其中任何 Pi fixture。

## 互补/未执行 case 清单

以下不是已通过宣称，也不是生成 skeleton；是闭合未覆盖责任的测试合同。普通 YAML 或本次正常路径不能替代这些边界。

| case | 前提/动作 | 必须观察的 oracle / 当前状态 |
|---|---|---|
| S01 refresh | 独立 store 上 force 注册保留/移除活跃 state，并在 prepare gap 交错 | live frame 拒绝/刷新及锁代际；U 有，HC X。 |
| S02 token | 完整 ready 后不可用 target、错误 target、重复使用、false item | 精确 blocked/reject 分类与 token 消耗；U 有，HC 部分。 |
| S03 guards | hard 非零后 pending 不提交、finish 非零/超时后重试 | 无 commit、正确错误码、幂等副作用与子树清理；U 有，HC X。hard 本身无作者 timeout。 |
| S04 typed inputs | 合法 HC 参数类型逐一经过真实 hook；无法由工具 schema 合法表达的 null/object 走直接产品单元边界 | 六类型无 coercion、完整 equality、深度64；U 有，不能用 schema 拒绝冒充 FSM 拒绝。 |
| S05 addressing | 另一个树的 session ID、unknown/ambiguous name、self-send、忙子树 stop | 接受/拒绝/消费/保留分别取证；本次只测邻域、sibling stop 拒绝与 idle cascade/resume。 |
| S06 dispatch | TTL 1800 秒、并发启动竞态、daemon 重启的 transient queue、existing/restored actor 不认领 | 正确 claimant 与 lazy eviction；U 有，HC X。不可偷偷缩短产品 TTL。 |
| S07 vote/repair | local mock reviewer 的 2/3 vote、infra abstention、malformed same-session repair、API交替错误 | 所有预算都有界、失败不洗成成功；U 有，实际 HC X。 |
| S08 custody/artifacts | guard-root/skill_dir/work_dir/glob/criteria-file + tampering | source hash/授权根/materialization/失败原子性；U 有，HC X。 |
| S09 Stop semantic | 开启真实 local-mock Stop judge，在非法 pause 上选择 continue/wait/arrange/exit/human | 宿主初次 native report 与 FSM Block/重提示分开；U 有，HC X；本次明确 opt-out。 |
| S10 watchdog | 独立长跑至少600秒，真实 advisory、archive后send失败、重启reconcile、context rotate | 接受/持久/消费逐层核实，不能靠手工写 archive；U 有，HC X。 |
| S11 encryption | 独立加密库 init/force/passphrase/rewrap/wrong-secret/backup recovery | at-rest/cancellation/实际恢复；U 有，HC X。库加密不保护所有日志。 |
| S12 crash/restart | 本包自有 daemon/HC 在精确边界被终止后恢复，不借全局服务 | Stop/permission 必须恢复，不靠下一MCP制造状态；X；当前原生生命周期 target受SUN_LEN阻塞。 |
| S13 services/install | 受授权独立 OS user/container 中 install/uninstall/launchd/systemd | ownership闭合/rollback/无他人服务污染；未授权修改全局，E/X。 |
| S14 platform | Linux、其它macOS/HC版本、长路径、时钟跃迁 | 每个平台真实kernel peer identity / timeout / cleanup；仅macOS26.4 arm64验证。 |
| S15 UI | question/answer抑制、TUI/graph/clipboard、compaction | 真实交互与分会话状态；E/X，不由headless工具定义证明。 |
| S16 human escalation | 等待产品实现真正 human-confirm | 当前schema字段存在但未实现；不可写“通过”。 |

现有三组 positive PLOT 与故意 mismatch 已完整交付并实跑，不因上述未覆盖而虚称全域正确。需要真实 provider 的实验不在本次允许 subject 内，不能为补覆盖而调用它们。
