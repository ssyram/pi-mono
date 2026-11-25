# HC/FSM v4 设计与实跑简报

## 结果

四套交付于 `v4/`，每套均在真实 HC 上 collect 落盘 golden，再全新隔离 replay，最后独立 verify：**全部 exit 0**。每轮共 **69 个工具回执**，其中 **31 条域拒绝路径**均断言 receipt 与真实 durable part。没有手写/覆写 golden，没有修改 v2/v3/fuzz、共享 `.runtime` 或 `fsm-compatible`，没有 stage/commit。

| 剧本 | 意图 | 回执/轮 | collect 证据目录 | replay 证据目录 | collect / replay / verify exit |
|---|---|---:|---|---|---|
| `domain-errors` | 未知 SID、self-delivery、name 不可寻址（含空串/空格/大小写）、未知 agent type 完整 available 列表、stop 的对应拒绝 | 15 | `v4/evidence/cb91473` | `v4/evidence/rb874ec` | 0 / 0 / 0 |
| `creation-rejections` | 保留前缀与串行重名、失败创建不占 name/不留 session、失败后 recovery 真创建 | 22 | `v4/evidence/cc0c99a` | `v4/evidence/rd80169` | 0 / 0 / 0 |
| `header-escaping` | name 的 `]`、backslash、真实 LF/CR/TAB、`[` 转义链；与字面 backslash+n 不碰撞；正文原样保留 | 15 | `v4/evidence/c75ba43` | `v4/evidence/rc5e4e3` | 0 / 0 / 0 |
| `unnamed-cancellation` | 无名 worker/leaf 的完整 header、idle 子树 stop、caller 收到 `Agent cancelled` 与 descendants=1 的完整通知 | 17 | `v4/evidence/ce2192b` | `v4/evidence/rc5fc2e` | 0 / 0 / 0 |

正式冻结前的四轮诊断也均 exit 0：`c8bf941`、`cc9bcff`、`c3a5ece`、`c7539b4`，未生成 golden。正式两轮使用相同 plot/源码/二进制 hash，HOME/XDG/DB/store/SID/端口相互独立。每轮保存 mock 的实际 mount command，collect 为 `v4/bin/use-plot PLOT --collect`，replay 为同命令无 flag。

## 真源约束与批准残留

实施前已向主线程报告并获准按真实 wire 收窄以下目标；不是静默漏项：

- 域错误真源 `tool/agent.ts:104` 的 `failed()` 返回普通工具结果，真实 part 是 **completed**，mock receipt 为 **isError=false**。本版严格匹配这个单一合同，不臆造 `isError=true` 或 error part。
- `TargetAmbiguous` 未覆盖：串行创建被全树 name-conflict 检查挡住；不采用并发撞窗口或 DB/metadata 注入。请求中的 TargetNotAddressable/TargetAmbiguous 在真源属于同一 `TargetNotResolved` 的零/多 matches 分支。
- `DepthLimitReached` 未覆盖：达到上限后先撤下 `agent` 工具，不通过私入口绕过，也不声称已验证上限撤工具。
- stop 的 stopped/failed 混合未覆盖：聚合分支存在，但 cancel 无公开、确定性的 typed-error 触发入口；没有破坏运行时或注入故障。
- Pi 未运行，Pi 文件未改。现有 `scripts/dual/run-plot.mjs` 只识别 `/v3/`，v4 需后续显式接入其冻结引擎、`wait_complete` / `wait_messages` 和新增只读观察/`f/` store 路径；不能宣称当前入口可直接执行本版。

取消案例明确选 idle 子树：验证 stop 文本/count/通知/保留 session，不重测 v3 busy abort 或恢复。header 验证的是 quiescence 后的 durable inbox 文本，不要求它在某一特定模型轮消费，避开 D9。

完整覆盖矩阵、真源定位、D1–D9 逐项边界及未覆盖声明见 [`v4/docs/coverage-v4.md`](v4/docs/coverage-v4.md)。上游合同没有 D7，本版未补造定义。没有为 Pi 增添任何合法差异或放宽核心文本比较。

## 验证

- [`v4/evidence/verification.json`](v4/evidence/verification.json)：四套独立 verify 的实际结果；重算 frozen plot/behavior/binary/golden hash，核对完整回执、逐个 raw durable part、完成观察、fresh SID/端口、collect candidate 和 reaped 自有进程身份。replay 的完整汇总也与 golden 严格相等。
- [`v4/evidence/unit-tests.log`](v4/evidence/unit-tests.log)：**23/23 passed**。涵盖声明式等待、完整转义消息、重复/错误投递/额外 session 拒绝、排他 freeze、raw part 未知字段、completed→error、false→0、cleanup 身份篡改检测。
- [`v4/evidence/artifact-validation.json`](v4/evidence/artifact-validation.json)：43 个 Python 入口/源码 AST、12 个 plot/golden/candidate JSON、200 code-LOC 上限与 shell syntax 均通过；compileall exit 0。
- 经主线程批准未跑 `npm run check`：首步 `biome-check.mjs --write` 可能写任务范围外源码，本次无新增 TS。未跑 build、npm test 或全量 Vitest。
- [`v4/evidence/git-staged-files.txt`](v4/evidence/git-staged-files.txt) 为空：无暂存文件。独立 reviewer review gate 由主线程执行，本简报不代替外部审查。

复核命令（仓库根）：

```sh
python3 my-plugins/hc-fsm-reference/v4/scripts/verify_all.py
python3 -m unittest discover -s my-plugins/hc-fsm-reference/v4/tests -v
python3 my-plugins/hc-fsm-reference/v4/scripts/check_artifacts.py
python3 -m compileall -q my-plugins/hc-fsm-reference/v4/src my-plugins/hc-fsm-reference/v4/scripts my-plugins/hc-fsm-reference/v4/tests
bash -n my-plugins/hc-fsm-reference/v4/src/hook_observer.sh
```

单套 replay 使用 `python3 my-plugins/hc-fsm-reference/v4/src/run_experiment.py my-plugins/hc-fsm-reference/v4/plots/<name>.json --timeout 180`。已有 golden 的 collect 会拒绝覆盖。

## 全部新增文件清单

唯一外置简报为本文件。`v4/evidence/file-inventory.txt` 是**逐文件、逐 symlink 的完整新增路径清单**，包含所有原始运行产物、候选 golden 和 Python 缓存；不跟随外部目录 symlink。运行证据体积约 101 MB，含本轮本地认证文件及隔离 HC DB，**不要直接公开或 git add 整个 evidence**。

下面列出人工维护的全部源码/剧本/基准/说明入口（均相对 `v4/`）；原始证据的逐文件枚举见完整清单：

```text
.runtime -> ../.runtime
bin/use-plot
docs/coverage-v4.md
plots/domain-errors.json
plots/creation-rejections.json
plots/header-escaping.json
plots/unnamed-cancellation.json
golden/domain-errors.json
golden/creation-rejections.json
golden/header-escaping.json
golden/unnamed-cancellation.json
golden/candidates/cb91473.json
golden/candidates/cc0c99a.json
golden/candidates/c75ba43.json
golden/candidates/ce2192b.json
scripts/author_domain_errors.py
scripts/author_creation_rejections.py
scripts/author_header_escaping.py
scripts/author_unnamed_cancellation.py
scripts/plot_authoring.py
scripts/verify.py
scripts/verify_all.py
scripts/check_artifacts.py
scripts/write_file_inventory.py
src/actor_identity.py
src/api_observation.py
src/bootstrap_roots.py
src/cancelled_run_observation.py
src/completion_observation.py
src/declared_dependencies.py
src/delivered_message_observation.py
src/event_tool_settlement.py
src/fsm_observation.py
src/fsm_readonly.py
src/golden_baseline.py
src/hc_observer.js
src/hc_tool_observation.py
src/hook_observer.sh
src/hook_phase_observation.py
src/json_equality.py
src/model_proxy.py
src/native_stop_timing.py
src/observation_policy.py
src/plot_contract.py
src/plot_engine.py
src/plot_validation.py
src/process_identity_observation.py
src/request_observation.py
src/run_environment.py
src/run_experiment.py
src/run_processes.py
src/stop_phase_observation.py
src/stop_prompt.py
src/tool_definition_capture.py
src/transition_ledger_observation.py
tests/test_declared_dependencies.py
tests/test_delivered_message_observation.py
tests/test_v4_plots.py
tests/test_verify.py
evidence/verification.json
evidence/unit-tests.log
evidence/artifact-validation.json
evidence/git-staged-files.txt
evidence/file-inventory.txt
```

建议下一步：先独立审查 `coverage-v4.md` 与 `verify_all.py` 的实跑结果，再按单独任务处理 Pi 的 v4 引擎接线；三个不可达语义分支仍需明确授权新的测试入口才可扩展。
