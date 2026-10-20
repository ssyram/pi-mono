# Script tasks — Task Overview / Q

本专项先完成独立脚本任务基础设施；用户随后批准接线及进度widget，现已接入现有Loop。/save-msg路径修复也已另行批准完成。

## 范围与导航

- [研究与架构 D.root](architecture.md)：已有机制、数据结构、组件分工、组合论证。
- [叶子设计与函数合同](detailed-design.md)：分支、退出、循环、外部假设与推理义务。
- [实施前 expectations](audit/expectations.md)：workflow 的十项合同对照。
- [save-msg 修正方案](save-msg-path-fix.md)：八部分修正计划；本阶段只建立路径基础设施。
- 本轮顺序：先落盘设计，再实施未接入基础设施，再独立 Hoare 推理及直接测试。用户本轮已授权这一顺序，无需把每个实现函数重新作为方向审批门。
- 后续授权已取得：输入/保存/执行/消息接线及运行widget。用户确认发起计次、stop只取消后续、关闭清理；NoWake结果允许进入以后上下文。当前接线责任见v2设计及integration-code-plan.md，原先不接线约束仅属于已完成的初始阶段。

## Q.I — confirmed，来源为本次用户对话

| ID | 正确性 / wanted / boundary | 来源原意 |
|---|---|---|
| Q1 | 一项任务可有多个脚本和独立的唤醒策略；不唤醒也可运行并展示结果 | 用户 Task 示意及“不唤醒就直接返回…执行框” |
| Q2 | 所有脚本均尝试执行，失败不阻断后续项；依赖交给用户/AI 封装的 sh | “默认全都运行…有依赖…封装在 sh” |
| Q3 | always 无条件唤醒；on-error 由失败谓词的 And/Or 聚合决定，默认 Or；never 不唤醒 | 最后裁决“改 \/ 默认…任意失败都聚合” |
| Q4 | 每项脚本有独立 timeout，默认 1800 秒，null/None 为无上限 | 用户“默认 30min…None…无上限” |
| Q5 | cwd 与路径支持相对、绝对和 ~/；不处理 $VAR 等 shell 展开 | 初始路径要求及“让 script 自己负责” |
| Q6 | 唤醒明确不是用户信息，采用 Boulder 来源形态，prompts/script 结果分块且重点标记失败 | 用户 `<prompts>` 与最终 `<script="...", exit-code="...">` |
| Q7 | 用户折叠展示有唤醒 ID、成功/总数；展开显示发送给 AI 的同一正文 | 用户视觉裁决 |
| Q8 | 先基础设施与测试，再按后续批准接线；逻辑简单、好推理优先 | 初始阶段不接线，后续用户明确批准实现 |
| Q9 | save-msg 的 ~/ 路径错误须修复，且新功能不得再出现相同错误 | 已另行批准并完成输出接线/38项回归 |
| Q10 | 现有Loop在未真实落盘的会话拒绝创建持久任务，display error；不强迫对话、不改官方Pi | 用户选定“空会话明确拒绝…直接display error，拒绝就行”；同transcript多个执行者另为UB |
| Q11 | 编辑框上方N项预约摘要，包含等待/执行且同ID只计一条；零项隐藏。仅全屏原地展开≤10总行，每项一行等待倒计时或I成功/K已结束/M总数与当前脚本 | 用户后续常驻widget要求及零项隐藏纠正，替代初版只统计运行及弹层；K含失败/超时，不含当前 |
| Q12 | /loop show off\|on只控制本会话分支显示，默认on、reload恢复；legacy始终一行，空间不足/布局未知拒绝展开 | 用户show开关仿tasking（默认session），不增全局参数或服务依赖；边界详见v2设计 |

每条由 D.root 回答；它们不是从现有实现反推的要求。

## Q.A — 当前被设计使用的事实

- A1（当前源码）：TaskInput/Definition/Target已承载prompt或scriptTask；自动/手动执行共用dispatcher和custom message。原先仅prompt/sendUserMessage是接线前快照。
- A2（verified / 源码）：Pi custom message 可专属渲染，但 `packages/coding-agent/src/core/messages.ts::convertToLlm` 将其映射为 API user role。Boulder 的 `buildBoulderResumeContent` 明确自动系统来源。来源 `my-plugins/oh-my-pi-v2/hooks/boulder-resume-message.ts`。设计承诺来源可辨认，不承诺真正的 API system role。
- A3（当前源码与回归）：save-msg outputResult已复用resolveUserPath展开home；原先直接resolve是已修根因。
- A4（verified / 源码）：原生 exec 使用直接子进程 SIGTERM 与 proc.killed 升级判定，不负责脚本树的强截止；不能据其存在推出本任务 timeout 已满足。

## Q.E — 有限经验，不生成新授权

- E1（confirmed / 对话）：先前“默认 And”的方案被用户纠正；最终默认 Or。执行全部脚本与错误聚合是不同语义，不因聚合改变执行范围。
- E2（confirmed / 对话）：用户排除 agent 内的依赖处理。基础设施不能因猜测脚本关系而跳过后续脚本。

## 当前保证与未完成边界

纯基础设施仍只准备/执行/汇总/格式化；外层接线负责现有持久化、调度与custom消息，未新建provider调用或存储系统。真实进程测试只使用临时目录和本地可执行文件，不使用真实 provider。None 任务若不终止，批次也不完成；输出按实际收到的 UTF-8 流保存，未增加截断策略。进程组无法包含自行 setsid/脱离的后代；不声称操作系统级沙箱或任意后代隔离。
