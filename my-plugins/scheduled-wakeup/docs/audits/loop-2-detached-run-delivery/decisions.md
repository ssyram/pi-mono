# Decisions — loop-2-detached-run-delivery

## 实现过程中的裁决

| # | 事项 | 裁决 | 理由 |
|---|---|---|---|
| D1 | liveness 原语从 flock 改为 UDS bind（`live.sock`） | 接受 | Node 无 `fs.flock`；UDS 由内核保证进程死亡即不可连接（实测：活=connect 成功，死=ECONNREFUSED），无 PID 复用问题。subplan/expectations 已同步修订。 |
| D2 | 会话在 spawn 后写 `wrapper.pid`，cancelRunning 以 status.pid 优先、pid 文件兜底 | 接受 | 关闭"wrapper 尚未写 status.json 时 stop 拿不到 pid"的竞态窗口。 |
| D3 | cancelRunning 兜底：SIGKILL 后仍无 result.json 时由 owner 合成 cancelled 结果 | 接受 | SIGTERM 早于 wrapper handler 安装时进程死亡且无结果；合成保证状态机收敛到终态且不投递。 |
| D4 | boundary 投递（before_settle entries）的崩溃窗口是"返回值交付"固有的，标记在返回时写 | 接受并文档化 | 无法观察 pi 采纳 entries 的时刻；窗口内可能丢失或重复一次。idle 路径维持 at-least-once（发送先行、标记随后）。README/ver-2.0 已写明。 |
| D5 | dispatcher refresh 由丢弃式守卫改为合并式（do-while 排空），tick 去除 hasActivity 门 | 接受（真 bug 修复） | 丢弃式守卫使 dispatch 后 views 陈旧，stop 按 views 找不到刚启动的 run；hasActivity 门以同一陈旧快照为输入会自饿死。 |
| D6 | 测试 fixture 补齐 `hasPendingMessages: () => false` | 接受 | fixture 违约使 pump 抛 TypeError 被 executor 吞成 failed→不投递；生产行为不变。 |
| D7 | runner-main e2e（真 spawn）在本机外部负载下非确定性停摆（两种模式：测试子进程启动期停摆 / 全部通过后文件进程不退出，均与宿主机常驻生产分析进程 ~80%×2 CPU 相关） | 不弱化断言，保留原用例；长命脚本已加 30s 自终止兜底防泄漏雪球 | 单跑/低负载秒级通过；同一 wrapper 逻辑经 loop-script-integration 与生产会话（session:6331eaa4 runner 存活测试全生命周期交付）双重验证。判定为环境摊派；静机复跑为验证标准。 |
| D8 | 旧 `stop` 契约用例（"stop 不终止已启动批次"）改写为终止语义 | 按 subplan 执行 | loop-2 明确废弃旧契约（I5）；新用例含杀死路径与"不投递"断言。 |

## 路径 B（subagent 独立审）状态

**阻塞**：sisyphus-junior 默认通道两次 Cloudflare 拦截（OpenAI 代理出口 119.8.240.31 被屏）；spec-impl-auditor 通道可达但 `codex-002/gpt-5.6-terra` 模型自报 `gpt-5.6-terra`，触发 model_verification_failed——需用户在 `~/.pi/agent/extensions/subagent/config.json` 的 `modelResponseAliases` 声明映射后方可放行（用户级配置，未擅改）。审计材料已备好：`/tmp/loop2-audit/`（契约文档在 repo 内、diff-tracked.patch、new-files/ 13 个新文件）。解除阻塞后可立即重派。

## §5.2 五维度自审（v1 兜底）

- 一致性：实现与 subplan/README/ver-2.0/script-tasks 四份契约同步（本轮已回写）；状态机、投递时机、终止语义均有对应用例。
- 风格：tab/120 列，与插件既有风格一致；新文件一概念一文件。
- 正确性：路径 A 全绿（除 D7 环境项）；三个真 bug（D5×2、D6）在测试驱动下修复。
- 性能：tick 为 stat 级扫描（每秒，unref）；tail ≤8KiB；投递正文不再携带全量输出。
- 可维护性：wrapper 复用 execute-task/wake-up-policy/wake-up-content；catalog/coordinator/dispatcher 职责分层。

| D9 | 投递/lost 合成从 owner-only 放宽为任一活会话（标记幂等去重） | 接受（生产证据驱动的契约修订） | 会话 01a18aea（work-fv/c-code-verify）compact 迁移更换 sessionId：owner-only 会把迁移前的 pending/lost run 孤儿化。生产现场 12:27 起连续 4 周期健康投递验证了任一会话路径；subplan/expectations/README/ver-2.0 已同步。审计 diff 为 D9 前版本，如报告仍按 owner-only 判定此点，以 D9 为准。 |

## 审核处置（audit-report.md：35E = 14✅ / 13❌ / 8⚠️）

| E | 判定 | 处置 |
|---|---|---|
| E7 非 owner 投递 | ❌（对审时快照成立） | **D9 已解**：契约修订为任一活会话投递（compact 换 sessionId 的生产证据）；审核跑在 D9 前快照上 |
| E9 合成覆盖真实结果 | ❌ | **已修**：liveness 探测失败后复读 result.json，存在则按真实结果归类，不再合成；补回归测试 |
| E11 win32 状态错标 failed | ❌ | **已修**：failedOutcome 增 kind 参数，win32/never-started → start-failed；补测试 |
| E14 小数 timeout 被静默丢弃 | ❌ | **已修**：codec 接受有限正数（与 prepare 契约一致），results 改整体拒绝而非 filter 丢项；补测试 |
| E19 boundary 先写标记后交付 | ❌ | **已修**：boundary 投递的 delivered 标记延到 agent_settled 再写（宿主已应用 entries）；中途崩溃 → 无标记 → 重投（at-least-once）；补测试 |
| E20 撤回不查已投递 | ❌ | **已修**：cancelPending 跳过不可撤回项（delivered 存在），不写 cancelled、不计撤回数；补测试 |
| E21 stop 完成竞态/强杀不杀脚本组 | ❌ | **已修**：waitFor 只认 cancelled===true；强杀兜底同时杀 wrapper 组与 status.scriptPid 组（wrapper 经 onSpawn 上报脚本 pid）；兜底合成前复读真实结果；terminateTaskRuns 杀后二次 refresh+撤回；补测试 |
| E22 stop 漏内存 pending/run-only 无名 | ❌ | **部分修**：terminateTaskRuns/requestRunTermination 恒调用 cancelPending（覆盖 prompt 内存项）；run-only 候选仅按 ID（任务已完成后定义名不在 run 记录中）——已文档化为边界 |
| E23 AI cancel 走弱端口 | ❌ | **已修**：execute/cancel 异步化，AI cancel 复用 terminateTaskRuns 完整终止入口（SIGTERM→等待→SIGKILL→合成）；测试同步更新 |
| E27 同栈双 dispatch 重叠 | ❌ | **已修**：dispatch 同步维护 starting 集合（扫描确认非 running 后移除）；补同栈双发测试 |
| E31 runner 模式扫描 unref | ❌ | **已修**：isRunnerEnabled() 时保持 interval referenced（进程活到投递） |
| E33 合成正文无视 includeTimestamp | ❌ | **已修**：failedOutcome 仅在 payload.includeTimestamp=true 时带时间戳；补测试 |
| E2 task.json schema 与文档不符 | ❌ | **文档修**：subplan §3 对齐实现扁平结构（taskId/scope/payload） |
| E4 result codec 校验弱 | ⚠️ | **已修**（随 E14）：status/exitCode/signal/stdout/stderr/error 全量校验，整体拒绝 |
| E8 深路径 socket 迁 tmpdir | ⚠️ | **文档修**：subplan 记录 liveSocketPath 单点推导与 100 字节阈值（另一会话实现的正确修复，本轮收编入契约） |
| E16 批量 flush 不复查 idle | ⚠️ | **已修**：投递循环逐项复查 isIdle/hasPendingMessages；补测试 |
| E24 dispose 后在途 refresh 仍投递 | ⚠️ | **已修**：refresh await 后复查 closed；coordinator closed 标志阻断 pump/enqueue |
| E26 GC AND/OR 冲突 | ⚠️ | **文档修**：统一为并集保留（README 口径）；失败重试已如实描述 |
| E28 空脚本不走直投 | ⚠️ | **已修**：scripts.length===0 → coordinator 直投 wakeUp.prompt；补测试 |
| E32 60s 退避作用域 | ⚠️ | **已修+文档**：prompt 发送失败保留 pending 待下次 pump；README 明确两种重试路径 |
| E35 四文档互相矛盾 | ⚠️ | **文档修**：S 清残留 abort 语义/正文全量措辞；V stop-all 补 live runs；R prompts 括号笔误、AI cancel id 描述 |
| E1/E3/E5/E6/E10/E12/E13/E15/E17/E18/E25/E29/E30/E34 | ✅ | 无需处置 |

验证：确定性子集 200/200 通过、check-types 通过（见 expectations Step 5 记录）。spawn 密集文件在宿主高负载下仍有子进程启动/退出停摆（D7 环境摊派，非断言失败）。

| D11 | 撤销 D9 的"任一活会话代投"；投递/显示/停止/lost 合成/GC 全部仅限 owner 血缘（任务仍在该会话状态中），旁观会话零可见零副作用、绝无领养 | 接受（用户裁决 + 生产事故） | 演练 A 段实测：同 cwd 旁观会话 01a13848 在完成 152ms 后抢走投递、唤醒了错误的窗口。用户明确"绝对禁止给其他会话发消息、100% 禁止任何越位"。owner 不回来结果留在磁盘；compact 后代因任务条目随会话状态迁移仍属 owner 血缘。曾提议的"超时领养"被否决且从未实现。新增回归：bystander 不投递不显示、不合成不 GC。 |

| D12 | D11 的"状态成员资格"判定改为 ownerSessionId 严格相等；fork 对他人 run 零显示/投递/合成/停止/GC（连 GC 也不碰），一次性 info 提示，视同 cancelled | 接受（用户裁决） | 核实 pi 事实：compact 与 -c resume 保持同一 session id，换 id 的只有 fork——D9 的"compact 换 id"前提不成立。用户两次明确："绝对禁止给其他会话发消息""100% 禁止任何越位行为""直接 cancelled + info 提示，别乱来"。fork 断联测试 ×2（零可见/零合成/零 GC）全绿。 |

| D13 | fork 发现活跃外会话 run 时的动作：**在本地会话状态登记任务 cancelled（停止追踪/调度）** + 一次性 info；对对方 run 目录零写入 | 接受（用户两次纠偏） | 初版误写为向对方 run 目录写 cancelled.json（越界，用户否决："登记我 session 内部"）；再限定只有任务在本会话状态中的真 fork 才本地取消。owner 视角对方 run 原样不动；测试 41/41。 |

| D14 | E19 的 boundary 投递标记不再依赖 agent_settled：投递后 2 秒定时器兜底写 delivered.json（settled 路径保留，幂等） | 接受（F1b 生产事故） | 真机上 settled 未触发 → 标记缺席 → 唯一 run 被重复投递两次+。止血：手动补标；回归测试"无 settled 也落标记"通过。崩溃于 2 秒窗口内仍满足 at-least-once。 |
