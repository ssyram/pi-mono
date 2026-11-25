# HC/FSM v5 结果简报

交付在 `v5/`，采用独立冻结 harness；未修改 v2/v3/v4/fuzz、共享 `.runtime` 或 `fsm-compatible`。本轮权威简报为本文件。

## 五套真实双轮结果

| 剧本 | 意图 | 每轮回执 / builtin | collect | fresh replay | verify exit |
|---|---|---:|---|---|---:|
| builtin-surface | builtin 全参数面两轮，问答/todo/skill/webfetch 真执行 | 124 / 104 | c568ffa | r68dd60 | 0 |
| builtin-fsm | enter→文件工作→Done→读回→退出；变量、alias、dispatch child | 141 / 106 | ce6c7f6 | r657f3a | 0 |
| builtin-agents | root 和 worker 各两轮完整 write→read→edit→grep→bash；真实回报 | 214 / 208 | cc731ec | r9b4c4a | 0 |
| builtin-stop | builtin 工作与四次 typed Stop 交错，计数/重置/同 SID 续行 | 127 / 105 | c4466e6 | redbb18 | 0 |
| builtin-abort | 两次实际 busy shell abort、信封/PID 死亡/同 SID 恢复 | 124 / 106 | c218f0f | ra0abce | 0 |

每轮 **730 回执、726 真实 toolCall、629 builtin 调用**；Stop 的四个文本 pause 单独计数。双轮共 1460 回执，独立 verify 全部 0。正式 golden 是 `v5/golden/*-ordered-v2.json`，由真实 collect 排他冻结、只读；没有手写或覆盖。

26 个权威工具均有真实 toolCall→durable part→receipt；六种 builtin 每个顶层参数均重复执行，55 个已分类参数/结果分支至少两次，包含成功与失败。`no builtin executor` 已有预声明成功约束、实际文件回读和篡改拒绝测试，不能再被工具数组检查掩盖。

## 先看这些证据

- `v5/evidence/verification.json`：五套独立 verify、frozen hash、双轮 run ID 和回执数。
- `v5/docs/coverage-v5.md`：26 工具×参数路径矩阵、nested 参数、分支与 actor/index 引用、D1–D9+3b 核对、上游缺陷与残留。
- `v5/evidence/coverage-v5.json`：所有真实参数调用引用、分支次数、80ms timeout 原始时长。
- `v5/evidence/unit-tests.log`：26 unittest 全通过，含五套双轮重验、unknown field/false≠0/无 executor/错误答案/缺 ack/提前 FIFO/cleanup 身份篡改拒绝。
- `v5/evidence/artifact-validation.json`、`file-inventory.json`：Python/JSON/200 code-LOC/shell 检查与源码、plot、golden SHA256 清单。

验证入口：`python3 my-plugins/hc-fsm-reference/v5/scripts/verify_all.py`。另运行 `compileall`、指定目录 `unittest`、`check_artifacts.py`；按要求未跑 npm check。未 git add/commit，无暂存文件。

## 真实发现与获批的调度机制

- HC 快 shell 输出存在 reader fork 未 join 的排空竞态：`c0d1a86` 实际 exit=0，却丢为 `(no output)`。失败证据保留，产品未修；声明式 FIFO `shell_barrier` 仅在公共 running part 完整输出已可见后释放，不改最终 output/exit 断言。
- HC 多文件 rg 并行枚举不稳定，初代五套 replay 均严格失败。初代 golden/失败 raw 全保留；最终仅用原生 rg `--sort path` launcher，不做输出后处理，未来 Pi 必须使用同样冻结环境。
- question 两次通过真实 `GET /question` / `POST /question/:requestID/reply` 自动回答，严格关联 SID/callID/messageID，保存真实 ack；不是注入 canned toolResult。
- 并发读取半发布 hook 的旧观察器竞态已在 v5 修复为等待完成标记，保留失败并加入回归测试。

## 未覆盖残留

- **未运行 Pi 对偶**；Pi 自动问答 #151，以及 FIFO/rg fixture 驱动须在 Pi runner 接入。HC 双轮绿不代表 Pi builtin executor 已修。
- edit 没有多 edits 数组 wire 参数；依批准边界以连续多次编辑及 replaceAll 一次多处替换覆盖。
- FSM 可选 transition.evidence、vars=null、非空 history tool timestamp 未覆盖；没有私自扩展时间归一化或合法差异合同。
- 不穷尽 OS 错误、附件/大文件截断、外网失败、agent 域错误族；Stop 不建立 shell chunk 与判定的额外全局时序合同。
- 保存全部诊断约 1.8GB；原始运行目录含本地服务认证材料和 HC DB，不应直接公开。三个截断 incomplete run 不伪造成功，已精确回收自有服务。

建议下一步：独立 reviewer 先复跑 verify 与 unittest，再把同一 frozen plot/launcher/问答/FIFO 驱动接入 Pi 对偶；不要迁就 Pi 改 golden。
