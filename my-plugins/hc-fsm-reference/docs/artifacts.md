# 证据路径与读取顺序

先看 `evidence/results-v2.json`（三组全部匹配汇总），再看任一组的 `PASS.json` / `final-result.json` / `completion-observation.json`。可用 `python3 scripts/verify_run_pairs.py` 重新验证本次交付的全部等值关系与当前输入 hash；不会启动模型或覆写基准。

| 语义 | 主 collect | 主 replay |
|---|---|---|
| 完整运行目录 | `runs/cfdc2552b/` | `runs/r2fdcb283/` |
| 通过/最终实际消息 | `PASS.json`, `final-result.json` | 同名 |
| 输入/版本/端口/源码与二进制 hash | `manifest.json`, `config.json`, `capabilities.json` | 同名 |
| 实际 root session 与最终全量会话 | `root-session.json`, `root-messages.json` | 同名 |
| 全部 actor 会话快照 | `alpha-messages.json`, `beta-messages.json`, `gamma-messages.json` | 同名 |
| 每个真实工具归属/前后事件 | `hc-tools.jsonl`, `hc-tool-parts/plot_*.json` | 同名 |
| 生产 hook 原始 IO | `hooks/<shell-pid>.argv/.input.json/.stdout/.stderr/.exit` | 同名 |
| 每步原始 FSM 观察 | `fsm-states/plot_*.json`, `fsm-states/actors-*.json` | 同名 |
| 结构化 gate/review/finish/commit 事件 | `fsm-history.jsonl` | 同名 |
| 实际 owner registry | `fsm-identities.json`（JSON array） | 同名 |
| 后台日志 | `fsm.log`, `fsm-client.log`, `hc.log`, `mock.log`, `fsm-logs.jsonl` | 同名 |
| 模型原始 HTTP body / SSE response body | `http/<sequence>.request.json`, `<sequence>.response` | 同名 |
| mock 实际解码输入 | `model-inputs/<pid>.json`, `captures/req-*.json` | 同名 |
| 完整实际模型工具定义 | `tool-definitions-{root,alpha,beta,gamma}.json` | 同名 |
| 正常 Stop/启动/通知/最终 actor/owner 的规范化匹配对象 | `completion-observation.json` | 同名 |
| 自有进程身份及退出 | `*.process.json`, `cleanup.json` | 同名 |

`fsm-logs.jsonl` 是早期命名，**内容实际为 logs CLI 的人类可读文本，不是 JSONL**；结构化语义 oracle 是 `fsm-history.jsonl`，不混用。原始 HTTP 只保存 body，明确不保存 Authorization 等请求头；不是声称抓取带秘密的完整网络 wire。

`fsm/opencode-stop-status/*.json` 另保留生产插件的 latest status 快照，作为诊断可读资料，不做完整事件历史或 golden oracle。实际每次 hook IO 都独立保存，计数/归属严格验证。

## 三份最终 v2 冻结基线

| 文件 | SHA256 |
|---|---|
| `golden/reference-v2.json` | `7a4d6774c43e52f6fe42b924dc89c40e4e80b5a07d9136a46ca9161815fcd0a5` |
| `golden/idle-resume-v2.json` | `396401c8a12991a0d0734bbd400c2b70f3be5cb33434bd39a36f00d46bf6ed21` |
| `golden/soft-review-v2.json` | `a0c691a53ee260e1bae371732dde07724ba184c5ac0eeb784a8a7c1e9416cf10` |

它们是对同一 PLOT 收集的实际回执与观察，不是手写预期大段输出。每份都有原子冻结候选 hard link `golden/candidates/<collect-id>.json`，没有后续重录。replay 检查初始/最终 hash 和只读权限。

## 补充两组

- idle/resume：`runs/c5f603b8b/` → `runs/r1f1658da/`；包括 worker 的两个原生 run、一次 pause、一次 stop、同 session 的 send-resume、两份完成报告。
- soft review：`runs/c504eb525/` → `runs/rd0479d9f/`；`tool-definitions-reviewA.json` / `reviewB.json` 各4工具；`hc-tool-parts/plot_review{A,B}_001.json` 是真实 StructuredOutput completed part；`model-concurrency.json` 两轮均 peak2/final0。
- Shared Evidence 原始收集 index 与 `logs/main.jsonl` 在 soft run 的 `tmp/fsm-watch-501/daemon-*/session-*/`；保留原本随机 round id 和原始时间，没有用宽泛通配让其纳入 golden。

## 故意失败与开发失败

最终故意 HC mismatch：`runs/c0251d48c/FAILURE.json`、`http/*.response`、`state.json`、`cleanup.json`；测试入口 `tests/test_hc_fail_fast.py`。此运行返回1是预期的负向测试结果，不是一次成功 collect。

mock 直接故意 mismatch 的 HTTP error body、首次 SSE、首错与原样重试记录在 `.runtime/test-evidence/mock-mismatch-*/`；与 framework log 中对应单测共同证明实际 HTTP409/不推进。

所有17个失败 HC run（含3次故意 mismatch）见 `evidence/failures-v2.json`；类型单测首错另存 `.runtime/json-types-first-failure.log`。早期 bootstrap probe 原样剧本/基准移到 `evidence/bootstrap/`，不是本包当前可运行或可 replay 的基准；其中旧格式/错误归一化保持原样作为历史证据，不拿来证明成功。

## v1 历史保留

无 `-v2` 后缀的三个旧 golden、旧 `evidence/results.json` / `raw-index.json`、六个 v1 正常运行，以及 `evidence/v1-runtime/` 源码快照全部保留。旧 matcher 的 Python普通等值会混同 bool/int/float；最终严格验收不使用这些旧证明。只修比较器/类型边界并新建 v2基准，所有 actor 动作和 YAML 保持不变。可在 `tests/test_json_types.py` 查看防回退与动作未变断言。

## 证据完整性与秘密边界

`evidence/raw-index-v2.json` 索引六个正式成功 run＋最终故意失败 run，共 **2817** 个原始证据文件的相对路径、大小和 SHA256。六个正式 run 的原始 HC `session.error` 事件计数均为0。该索引不公开 payload、不索引 auth.token，也不是整个运行目录每个 SQLite/cache 文件的发布清单。

`docs/versions.json` 单独对732个固定源码导出文件逐字节核对 Git blob/SHA256，并列出实际二进制和工具链。生成命令 `python3 scripts/write_provenance.py` 不运行 provider。

运行目录包含本地 FSM `auth.token`，文件本身受原生权限保护；不要整体公开复制运行目录、秘密文件或 npm/Cargo cache。这里未输入真实 provider 凭据，mock key 是公开占位值，HTTP 观察从不记录 Authorization。终端命令示例只打印 PASS、结果和校验汇总。

未 commit/push，`.runtime/`、`runs/`、`.t/` 明确忽略但物理文件保留，故交付依赖当前完整工作目录而不是一个仅含 Git diff 的压缩包。若迁移环境，须一起保留允许公开的证据和固定源码/产物，秘密文件另行处理；不能凭只复制 README 宣称可复跑。
