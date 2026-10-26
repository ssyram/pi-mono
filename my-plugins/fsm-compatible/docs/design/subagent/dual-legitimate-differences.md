# HC/Pi 同脚本对偶：合法差异合同 v1

状态：主线程依 owner 2026-10-23 基准定稿（"FSM 可接触层必须一模一样；其余差异须明确定义，防对偶时改错"）。运行对偶前本合同生效；对偶中发现的任何 mismatch 先归类、后动手，未归类项触发代码修改，合同本身的修改归 owner。

基准重申：Pi 不实现一个 HC 出来。核心层（FSM 工具调用、Hook 行为语义含精确 Message、SubAgent 行为、核心工具套装在 FSM 可见处的行为）零差异；其余为外围，只允许本合同列出的差异类。

## 1. 固定两侧身份

| 对象 | HC 侧 | Pi 侧 | 要求 |
|---|---|---|---|
| 模型 | loopback `plot/plot-model`，唯一二进制 | 同一二进制 | 相同 |
| mock | `9a5a32be920d…` 源码构建，SHA256 `b05a1acd5268b48…`（hc-fsm-reference/.runtime/mock-src/target/release） | 同一二进制 | 相同 |
| HC / FSM | HC `1.18.31-fmv2.1`（`e81af70d…`）；FSM dev `216f7aab…`（wire7/schema2，包内构建） | FSM 同一包内构建 | FSM 侧相同；HC 侧仅 golden 生成时存在 |
| Pi 宿主 | — | 官方 Pi + my-plugins/fsm-compatible（本仓库源码） | 唯一自由侧 |

## 2. 核心层（必须逐字/逐对象一致）

1. FSM 业务工具调用：名称（`agent→Agent` 归一后）、参数、结果对象、顺序。
2. Hook 语义：每次 hook 的 argv/stdin 决策 JSON/stderr/exit；合法 block 退出 2 且 stderr 逐字等于 reason JSON。
3. SubAgent 行为：四工具 schema/描述/回执文本/域错误/邻域/级联停止/同 SID 恢复/每轮通知信封（`<agent state=…>` + summary + agent_notification metadata）。
4. 核心工具在 FSM 可见处的行为，包括**HC 的 Bash 取消契约**：tool 状态 completed（非 error）、`metadata.exit=null`、output 含 `shell_metadata` 内 `User aborted the command`、assistant 层 `MessageAbortedError`。Pi 侧不符即实现缺口，不是合法差异。
5. Stop 语义链：同 SID 同模型 typed Block→continuation、计数 1/2/3、阈值原文暴露、迁移后重置、真退出后 Allow。**含 HC 的 profile 翻转事实**：parts-only 续行使同 SID 同模型但 agent 落 defaultInfo（观察例 general→build）；Pi 复刻此行为，不得更强。
6. 每次模型请求的 tools 数组：声明 count、名称集合、顺序、schema、动态描述逐对象一致（HC 已采 26 工具快照；Pi 侧以同法从 raw HTTP 捕获，不用内部投影自证）。

## 3. 合法差异（唯一允许类）

| # | 类目 | 规则 |
|---|---|---|
| D1 | 动态身份 | session/part/message ID、PID、端口、URL、路径前缀：一对一 typed 绑定替换，沿用 hc-fsm-reference `docs/matching.md` 全部细则（完整 token 替换、`ses_x` 不匹配 `ses_xEvil`、PID=自有进程等）。业务数字（42/48 等）绝不归一化。 |
| D2 | 时间戳 | 仅 matching.md 已列字段（tool time start/end、daemon 事件时间、duration_ms、stack history）按其规则处理；其余时间不比。 |
| D3 | 同类错误不同渲染 | 错误 class/state/信封一致即通过；内层详情文本不逐字比（owner 的 429 判例）。适用：provider/网络错误详情、agent_error 内层格式化文本。不适用：第 2 节列明的核心精确文本。 |
| D4 | @file 附件 | FSM 驱动 prompt 禁用 `@` 文件语法（写进 YAML/剧本约束）；两侧均纯文本。违例即剧本错误，不是差异。 |
| D5 | 跨树 agent_send | owner 裁决"做了比较好"，已实现：FSM_DATA_DIR 下共享 sid→owner 注册表，runtime 登记 root/孩子 SID 与 bridge 凭据；agent_send 本树未命中时经注册表转发到 owner runtime 的 /fsm-compatible/agent-message（Basic auth），owner 按 busy/idle 投递。注册表 miss 仍按 HC 语义拒绝 AgentNotFound。跨树路由不经 FSM 门禁（与 HC 一致：目标按自身权限执行）。 |
| D6 | 宿主内部不可见物 | owner 裁决 header 是问题，已修：孩子以协议 SID 发布真实 header（id=sid、timestamp=真实创建时间、cwd=真实目录）；roster/statuses 的 root 对外 id 改用协议 SID，FSM 按协议 SID 反查 getExecution 命中 root。剩余宿主内部格式（落盘形状、SDK 内部 ID）仍按"仅 FSM 实际读取字段参与比较"。 |

| D8 | 宿主 profile/title 概念 | HC 的 session 有 defaultInfo profile（root 落 build、Stop parts-only 续行发生 general→build 翻转）与 session title；Pi 宿主无对应概念。Pi 侧如实报 agent:null/空。对偶经 scripts/dual/profile-boundary.py 包装原版引擎做**三个精确投影点**：①step.hc_agent 断言跳过；②完整 receipt 比较中 hc_result.agent 投影为 null；③agent_list 文本 self 行的 agent_type/title 两列置空（receipt.text 与 hc_result.state.output 同步）。每次投影写 run/profile-boundaries.jsonl（callID、golden 值、pi:null）。wrapper 无其他投影点；其余字段（provider/model/status/timestamps/全部业务值）照原版严格比较。root 的 agent_type=build 已按 HC defaultInfo 推导在生产复刻（非投影），title 保持投影。 |
| D9 | 剧本并发时序对宿主调度敏感（**候选，待 owner 裁决**） | reference alpha/009：use-plot 对依赖未满足的请求持 state.lock 忙等自旋（plot_engine.execute 无 sleep 重试），把并发的 gamma agent_send 结构性钉在 alpha 起跑请求之后——实测 send 间隔恒 = debounce 窗口 + ~0.3s（1s→1.38s、5s→5.24s、6.5s→6.82s、8s→8.22s 四组），时间窗口不可解。单 worker 剧本（idle-resume）无此耦合。处置选项：(a) declared-boundary 跳过该 inbox 断言；(b) 修参考包忙等（需 owner 授权改参考产品）；(c) runner 侧确定性等待。在裁决前 reference 对偶止于 41/68 回执。 |

## 4. 判定流程

1. mismatch 锁存后先对照第 3 节归类；命中 → 记录为 declared difference，继续。
2. 未命中 → 缺口：改 Pi 实现（默认）或修剧本，禁止改 golden/期望迁就 Pi。
3. 想新增差异类 → 停下报 owner；不允许在对偶中途自己扩合同。
4. 比较基础设施用严格 JSON（类型精确，`true≠1`），沿用参考包 `json_equality` 口径；D8 投影后的比较仍走同一严格比较器。

## 5. 首批对偶顺序

reference → idle-resume → soft-review → semantic-stop → semantic-wait →（D5 批准后）native-agents。

首批通过的声明：最终计算 message 逐字一致 + FSM 请求/回执/hook/trace 在第 2 节口径下逐对象一致 + 无未归类差异。该声明不外推未跑剧本。
