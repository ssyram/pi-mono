# HC–FSM reference experiment

独立、已实跑的本地 mock 实验包。运行时只使用 HC、固定 FSM dev、mock-with-pi、Python 标准库及系统工具；不依赖/import Pi、fsm-compatible、Nico 或 Pi fixtures。

## 已交付结果（严格匹配 v2）

最终验收使用 `*-v2.json` golden。v1 六轮真实运行曾在旧断言下通过，但最终定向测试发现 Python `==` 混同 `true/1/1.0`；已保留首个失败、`evidence/v1-runtime/` 源码及三份 v1 golden，未覆盖它们。仅修框架为递归 type-exact JSON，并重新执行下列全部 collect/replay。业务动作与六份 YAML 未改变，另有回归断言。

| PLOT | collect | fresh replay | 匹配结果 | 实际最终消息 |
|---|---|---|---|---|
| `plots/reference.json` | `runs/cfdc2552b` | `runs/r2fdcb283` | 68/68 工具回执、75 个 hook、4 个正常 Stop、3 份子代理完成通知 | `Computed result: 21 + 21 = 42` |
| `plots/idle-resume.json` | `runs/c5f603b8b` | `runs/r1f1658da` | 23/23 动作（22 个工具＋1 次合法暂停）、26 个 hook、同一子会话恢复 | `Idle-resume result: 42` |
| `plots/soft-review.json` | `runs/c504eb525` | `runs/rd0479d9f` | 12/12 工具结果；两个 reviewer 的峰值并发均为 2 | `Soft-review result: 42` |

三组均使用全新 HOME/XDG/HC DB/FSM store/端口/session，没有复制上一轮 FSM 数据库。replay 的 PLOT、行为源码、YAML、二进制 hash 与 collect 相同。冻结 golden 在 `golden/`，只读、绝不由 replay 覆写。

机器校验证据：`evidence/results-v2.json`。直接复核：

```bash
cd /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/hc-fsm-reference
python3 scripts/verify_run_pairs.py
```

## 运行命令

以下命令使用已经冻结的 PLOT 和 golden，创建新的独立运行目录：

```bash
python3 src/run_experiment.py plots/reference.json --timeout 240
python3 src/run_experiment.py plots/idle-resume.json --timeout 180
python3 src/run_experiment.py plots/soft-review.json --timeout 240
```

已实际执行的第一次正式收集命令分别为：

```bash
python3 src/run_experiment.py plots/reference.json --collect --timeout 240
python3 src/run_experiment.py plots/idle-resume.json --collect --timeout 180
python3 src/run_experiment.py plots/soft-review.json --collect --timeout 240
```

**不要重复收集覆盖这些基准。** 已有 golden 时 `--collect` 会拒绝。新剧本应声明新的 `golden` 路径；可先使用 `--collect --diagnostic` 验证且不冻结，再移除 `--diagnostic` 正式收集。修改任一冻结输入后，旧 replay 会明确失败，而不是更新基准。

mock 实际挂载的命令由 runner 保存到每轮 `mount.json`：

```text
/absolute/package/bin/use-plot /absolute/package/plots/reference.json --collect
/absolute/package/bin/use-plot /absolute/package/plots/reference.json
```

当前 mock 支持带参数的 command，无需启动包装脚本。`PLOT_RUN`、`PLOT_HC_PORT`、`PLOT_REAL_HOOK`、`PLOT_BINDINGS` 由隔离 runner 设置；不要手工对用户正在运行的 HC/FSM 服务挂载或调用。

## 准备与检查

本机已构建的固定源码副本和产物在 `.runtime/`。不修改三个参考仓库、全局安装或用户配置。

```bash
python3 scripts/prepare_runtime.py
python3 scripts/write_provenance.py
python3 scripts/check_package.py
python3 -m unittest discover -s tests -v
python3 scripts/run_plugin_tests.py
python3 scripts/run_pinned_tests.py
```

`prepare_runtime.py` 从固定本地 Git 对象导出并逐文件验证源码，只在产物缺失时使用包内 Cargo cache 和 `--frozen` 构建。没有 npm/pip 安装或 npm 依赖生命周期脚本；Cargo 执行必要的原生编译。需要本机已存在的 Rust 工具链、缓存及 `/Users/ssyram/bin/opencode`；不会拉取新分支或升级全局版本。若包内 rg 缺失，用 `--rg PATH` 提供与 `docs/versions.json` hash 完全一致的已审计 15.1.0 二进制；脚本不下载它。

测试结果：框架 **27/27**；固定生产插件 Bun **101/101**；固定 FSM Rust **1748 次执行通过、11 次失败**。后者不是全绿：长包路径与上游固定临时名超过 macOS Unix socket `SUN_LEN`，详见 `evidence/test-results-v2.json`、`docs/coverage.md`。不会修改上游测试或借用包外短目录来隐藏这些失败。

故意 mismatch：`tests/test_hc_fail_fast.py` 的真实 HC 运行 `runs/c0251d48c` 在“预期 43，实际 42”处退出 1，后续写文件未发生、无 golden、三个自有服务均退出。`tests/test_mock_fail_fast.py` 另证明真实 mock 连续返回 HTTP 409，改正后的重试仍不推进。

## 文件导览

- `plots/*.json`：纯声明角色、工具参数、正/负例约束、采集项、身份绑定、匹配规则、完成条件；无 collect/replay 行为分支。
- `workflows/`：综合及互补 FSM YAML，不声称单一 YAML 覆盖所有 feature。
- `bin/use-plot`、`src/plot_engine.py`：通用收集/匹配/首错锁存；事件结算支持 HC StructuredOutput 不再发下一模型轮的真实行为。
- `src/fsm_observation.py` 等：只读观察及唯一工具调用关联；不写 FSM 状态来制造成功。
- `src/hook_observer.sh`：仅透明保存生产 hook stdin/stdout/stderr/argv/退出码，不做业务判断。
- `docs/scenarios.md`：剧本语义、数值来源与协议前后关系。
- `docs/matching.md`：精确字段规则、时间/身份/并发边界。
- `docs/coverage.md`：48 项生产 feature 闭集映射、上游实测和未覆盖项。
- `docs/versions.json`：固定 commit/tree/archive hash、每个导出文件的 Git blob/SHA256、运行二进制 hash、工具链版本。
- `docs/pinned-*-source-survey.md`：两个只读事实调查的原始报告；其中“未实跑”的陈述属于调查时点，实际状态以本 README 和 `evidence/` 为准。
- `docs/failures.md`：所有失败及 v1→v2 类型匹配修复，不删除失败运行。
- `docs/artifacts.md`、`evidence/raw-index-v2.json`：2817 个安全原始证据文件索引与读取顺序。
- `evidence/v1-runtime/`、无 `-v2` 后缀的旧 golden：保留的旧版审计证据，不是当前 replay 输入。
- `evidence/bootstrap/`：早期九步协议探测的原样历史剧本/基准，不是当前可运行 PLOT 或验收证据。

## 版本与安全边界

FSM：`216f7aabac78956dbafce45ef4b1edbb65dd0507`，版本 `0.11.0`、wire `7`、schema `2`。HC：`1.18.31-fmv2.1` / `e81af70d789a33d67a25e158604e9bd6c9325bfd`。Mock：`9a5a32be920ddeb2700e6b5b9d21d8dc7ebd5590`，包内 release 构建。

实测平台 macOS 26.4 arm64、Python 3.11.15。HC 是用户提供的预构建 release，本包核对版本/tag/hash但不声称重现了其构建。rg 是 HC 诊断启动下载的固定 15.1.0 产物，之后预置避免再次联网；没有 rg 源码构建证明。FSM 使用公开 development wrapping secret，实验 store 为隔离明文库，不用于真实秘密。

模型 provider 只有 loopback `plot/plot-model`，凭据环境白名单清空，HTTP 观察不保存 Authorization。运行目录仍含本地 FSM `auth.token` 和原始受控会话数据，**不要整体公开打包这些目录或打印 token**。这是配置/目录隔离，不是 OS 文件或网络沙箱。

本次不覆盖真实模型语义质量、HC 服务崩溃/重启恢复、watchdog 的真实 600 秒调度/通知、活跃子树强制取消、加密 HC 重启链、交互 question/TUI/clipboard/compaction、其它平台或其它 HC/FSM 版本。完整补充 case 清单见覆盖矩阵；没有人工救场、参考产品修改、commit 或 push。
