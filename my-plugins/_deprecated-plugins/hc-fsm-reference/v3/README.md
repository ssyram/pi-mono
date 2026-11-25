# #129 续篇实验：semantic Stop 与 native busy cancel/resume

这里只报告本轮新增覆盖，不表示全 FSM 或全部 SubAgent 行为覆盖。原 v2 `../src`、`../bin`、`../workflows`、三份 v2 golden 和所有历史/失败未改；旧入口仍为包根 `python3 src/run_experiment.py plots/reference.json`。本轮扩展在独立 `v3/`，固定产物经 `.runtime -> ../.runtime` 只读复用，没有换产品版本或依赖 Pi/Nico/fsm-compatible。

## 新增真实 collect → fresh replay

| PLOT | collect | replay | 匹配 | 最终实际计算消息 |
|---|---|---|---|---|
| `semantic-stop.json` | `c461ff312` | `rf78a9392` | 25动作/21工具；24 hooks；4 semantic Blocks；5 native完成报告 | `Semantic Stop result: 42` |
| `native-agents.json` | `c73ea9536` | `rbef4ccca` | 50动作/49工具；56 hooks；2个预声明取消错误 | `Subagent result: 42 + 6 = 48` |
| `semantic-wait.json` | `cfa70cb92` | `r41ac8566` | 28动作/27工具；31 hooks；1个真实 semantic Allow | `Semantic wait result: 42 + 7 = 49` |

运行目录均为 `v3/runs/<id>/`，golden 在 `v3/golden/`。每组的 PLOT、v3行为源码、YAML、二进制 hash 相同，第二轮全新 HOME/XDG/HC DB/FSM store/session/端口，不复制前轮数据库。全部运行实际 `FSM_STOP_ANALYSIS=1`，manifest明确记录；模型仅 loopback `plot/plot-model`。

```bash
cd /Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/hc-fsm-reference
python3 v3/src/run_experiment.py v3/plots/semantic-stop.json --collect --timeout 300
python3 v3/src/run_experiment.py v3/plots/semantic-stop.json --timeout 300
python3 v3/src/run_experiment.py v3/plots/native-agents.json --collect --timeout 240
python3 v3/src/run_experiment.py v3/plots/native-agents.json --timeout 240
python3 v3/src/run_experiment.py v3/plots/semantic-wait.json --collect --timeout 240
python3 v3/src/run_experiment.py v3/plots/semantic-wait.json --timeout 240
```

上面 collect 已执行且基准已冻结只读，不可覆盖；现在重复实验使用默认 replay。新版本/新剧本用新的 golden 路径。mock 实际挂载 v3 `bin/use-plot PLOT --collect` / 无flag，同一PLOT不按模式改动作。

## S09：真实 Stop judge、Block/continuation 与退出

subject 由真正 native `agent` 启动，进入 SemanticStop.Work、实际 Bash算6*7并写 pending amount=42，随后按纯PLOT产生声明的停止尝试。

- Phase1：非合法pause、Work、非exit，模型 `continue_work` → hook exit2/JSON Block/count1 → 同 subject SID 消费原样 reason。
- Phase2：同一 Work，模型 `arrange_observation` → Block/count2 → 同SID立即真实 `fsm_get_state`。
- Phase3：没有迁移的第三次停止，真实 judge evidence 包含按顺序三份原始 plan，facts.recent_stop_plans_present=true；`continue_work` 仍 Block/count3。
- 实际 hard check、迁移 Done 重置计数后，Phase4 的 facts.is_exit_state=true、legal_pause=false，`exit_fsm` 是促使执行真实退出的 **Block**，count1；同SID消费指令，读完整terminal视图、自检并真实 `_fsm_exit`。
- 只有释放到default后，最终正常 Stop 才合法 Allow。root 从实际 subject 通信取得42，不拿任意marker当结果。

四份真实 Stop request 的模型均为 `plot-model`，原始prompt有 native `Authoritative Stop facts` 和 `BEGIN UNTRUSTED STOP EVIDENCE`；StructuredOutput schema是 **action/reason**，不是迁移soft-review的 checks/summary。完整facts/evidence/model与completed part、hook、same-SID continuation均匹配。

原生 parent完成通知与FSM verdict分轨取证：本次两轮四个pause的native通知都在hook input及exit之前创建，见各run的 `native-stop-timing.json`。这是本次观察，不是先通知/后审查的全局保证，更没有假定先审后报。五份native report和两个最终正常Stop分别匹配。

### 实测到的 HC profile 边界

第一次诊断 `c47e0d807` 在四次Stop链后因错误地期待sender仍为general而失败，未冻结。源码确认：FSM插件 `pushContinuation` 只传parts；HC `prompt.ts::createUserMessage` 未给agent时用defaultInfo，model则用currentModel。因此当前HC在同SID/same model上 **general→build**。最终PLOT精确断言初始general、第一次continuation后build，不接受两种profile；不改参考产品，也不声称agent权限/profile被保持。该行为仍是需要明确报告的集成边界。

## S09补充：真实有busy后代的 semantic Allow

`semantic-wait.json` 在root活跃Work frame下启动真正busy的async后代：API status=busy、durable tool=running、自有HC后代shell PID存活均被观察。真实Stop facts必须是confirmed，仅一个opencode_session，ID等于该实际后代。

同模型的 `wait_for_async_work` 结构化回执导致实际hook exit0、semantic Allow，stderr为原样reason。不是default/合法pause捷径：facts.legal_pause=false，frame仍为Work。另一公开API root仅在观察到真实judge完成及hook Allow后才发native agent_send唤醒root同SID；下一真实get_state证明pending amount=42和no_progress_count=0。随后释放async工具、取得实际7、全部明确退出，计算42+7=49。

该case只覆盖此合法wait分支和计数重置，不证明所有live-work分类/未知/失败路径。

## S05：独立root SID、拒绝边界、真实busy子树取消恢复

- 两棵root通过真实公共 `POST /session` 创建，均无parentID，ID不同；root原生 `agent_list` 在启动worker前只列self，不列alien。没有写DB或伪造metadata。
- unknown name精确拒绝；向自己的真实SID self-send精确拒绝。它们是native completed文本，不假装为FSM门禁异常。
- root向不在其邻域的真实alien SID发送，alien实际消费带宿主sender的消息并Bash算6，向root送回6。
- root→worker→leaf真实层级；worker/leaf分别保存immutable seed6/7、进入BusyRetain，开始真实长跑Bash。Root stop之前同时检查两者HC busy、对应durable part running、PID为自有HC的存活后代。
- native agent_stop(worker)级联两节点。随后实际观察两个SID idle、原PID消失、session/parent/profile均保留，再分别agent_send恢复原SID。不是idle pause替代busy cancel。
- leaf和worker恢复时实际读到旧seed及原FSM frame；leaf算7发给worker，worker消费后真正算6*7=42、正常退出并发给root。root消费42和独立root返回的6，实际sum=48。
- 本case只有一个leaf，不要求不存在的同层稳定cancel完成顺序。整体错误事件按actor/callID键控，不发明跨actor总序。

### Bash中止与assistant中止不是同一层

首个S05诊断 `ccfadb090` 误期望processor通用 `Tool execution aborted`。实际HC shell.ts自己处理用户中止：工具 **completed**、exit=null，完整output为 `(no output)\n\n<shell_metadata>\nUser aborted the command\n</shell_metadata>`；同时assistant和session.error精确为 `MessageAbortedError {message:Aborted}`。

最终只接受该单一Bash契约，并与取消前同一part/message/SID/PID绑定；不是兼容两种输出或忽略错误。两个预声明MessageAbortedError之外，任何assistant/session错误都会失败；并且禁止把正常超时/普通completed伪称cancel。

## 证据和测试

- `evidence/results.json`：三对全部严格匹配、fresh身份/端口、只读golden未变。
- `evidence/raw-index.json`：2846个安全原始文件索引；不索引/打印auth.token或Authorization。
- `evidence/v2-preserved.json`：31项旧v2 source/input/golden前后hash完全一致；不绕其原hash检查，也没有重跑旧独立复核。
- 每run：`requests`在state/golden；`stop_phases`关联judge与subject；`api_observations`保存busy/idle/原SID/父链/PID前后；原始 `http/`、`model-inputs/`、`hc-tools.jsonl`、`hc-tool-parts/`、`hooks/`、FSM只读state/history/identities完整保留。
- `native-stop-timing.json`是原始跨lane时序诊断，不把无保证的时序强加给golden。
- 本轮针对性unit **11/11**，日志 `evidence/targeted-tests-first.log`；35个Python源码语法/200行检查及JS/Bash语法通过。

```bash
python3 -m unittest discover -s v3/tests -v
python3 v3/scripts/preserve_v2.py
python3 v3/scripts/summarize_evidence.py
```

未重跑源码普查、独立审查或整套Rust/Bun；原11个SUN_LEN失败仍保留，不称全套绿。三次新诊断失败 `c47e0d807` / `ccfadb090` / `ce291c503` 全保留，均无golden；第三项是多root registry实际两条而旧观察器误要求一条，现按预声明两个公开SID逐条精确绑定同一自有HC PID，不接受“一或二”。

## 仍未覆盖

没有声称全FSM或全部SubAgent行为覆盖。ambiguous name在真实公共串行创建中被name-conflict挡住，靠并发竞态无法稳定构造；没有写DB/改metadata来伪造。未覆盖多同层busy取消排序、跨HC服务/不同cwd恢复、所有错误/时序竞争、semantic Stop judge失败/repair/timeout、human_intervention真正不可修复场景、人工确认（产品未实现）、watchdog实际周期、加密/崩溃/重启/UI/其它平台。

固定HC `1.18.31-fmv2.1`、FSM commit `216f7aabac78956dbafce45ef4b1edbb65dd0507`、mock commit `9a5a32be920ddeb2700e6b5b9d21d8dc7ebd5590` 未换；完整原有hash来源仍在包根 `docs/versions.json`，新run manifest重新绑定实际产物。所有写入仅本包（及指定续篇），不打印秘密、不改外部repo/全局设置，不commit/push，不派下级。目录/配置隔离不是OS/network sandbox，原始run仍含本地auth.token，不整体公开。
