# fsm-5-watch-install：Watcher 投递、人类等待、恢复、组装与安装

状态：闭合原审查 B9 的编码前叶子合同；本单元尚无生产代码。父合同：architecture P7/P8/P9、§4.6/4.8，detailed-design §5.6。fsm-1/3/4 已 PASS，fsm-2 通道完成（最终对照并行进行），全部直接复用。

## 1. 目的与 callee 绑定

Watcher 文本经桥 prompt_async 进入本 root 有界队列并真实投递回对应会话；main 的人类任务问答等待按原 gate 合同抑制/释放；root 故障恢复保留身份；交付安装入口。裁决/调度权全部留原 FSM（Watcher 判定、投递决定、gate 状态归 daemon）；本单元只拥有接收/投递/标记事实。

callee（一手已核对）：

- daemon POST /gate/suppress、/gate/release：body {session_id, agent_id:"main", reason}；reason 约定值 ask-start/ask-end/main-tool-start；best-effort（失败放弃不重试、不改权限裁决、不隐式启 daemon）；gate 只描述 main。加入 helper 固定 allowlist。
- hook gate 二分（main.rs:435-449）：allowed && tool_name==="AskUserQuestion" → suppress；其余（含一切 denial）→ release。lost suppress 欠抑制（安全）、lost release 由下一次 main 工具自愈。
- Watcher 投递：原 Client POST /session/{sid}/prompt_async，严格 204=接收（fsm-3 已留 503 桩，本单元接真实队列）。
- 官方 Pi：pi.sendMessage 触发回合的 custom message（triggerTurn）；ui_prompt_start/end（kind/title）仅作输入通道事件，不作问答语义来源。

## 2. B9：会话归属的任务问答标记

- 插件注册可选工具 `AskUserQuestion`（参数 {question, options[]?, header?}；FSM 唯一认可的 question 工具名）。执行：经 permission-gate 正常 check（tool_name 原样 "AskUserQuestion"）→ 通过后在 ctx.ui 上发起真实问答（select/confirm/input，按参数映射；无 UI（print/rpc 无 dialog）时以 input 通道或返回"不可用"错误，不伪装回答）→ 得到用户回答/取消即返回真实工具结果。无对应问答能力时不注册该工具，prompt 能力声明不包含它。
- 状态标记 session-owned：`waitState: {active, since, question}` 存 root runtime。设置者仅 ask 工具执行（真实 suppress POST ask-start 后 active=true）；清除者：ask 返回（回答/取消/错误，POST ask-end release）、以及任何其它 main 工具完成（main-tool-start release——由 permission-gate 对 main 的每次 verdict 后按二分规则移动 gate，与 CC hook 行为一致）。child 调用不移动 main gate（agent_id 恒 main）。
- 恢复：普通用户输入结束等待仅当 waitState.active（输入是回答通道时 ask 自然返回）；ui_prompt 事件不设置标记。fail 路径：gate POST 失败按原 best-effort 放弃，不影响权限/问答本身。

## 3. Watcher 接收与投递

- AdvisoryQueue（每 root，容量=queueCapacity 默认64，满/owner失效 503）：promptAsync 校验 parts 非空文本 → push {deliveryId(randomUUID), targetSessionId, text, state:"accepted", at} → 严格 204。目标必须属本 root 执行树（binding 存在），否则 404。
- drain：目标会话 idle 且 owner active 时逐项 pi.sendMessage(customType=fsm-compatible:watcher、content=text、details={deliveryId}、display=true、triggerTurn)→ state scheduled；该 custom_message entry 出现在真实 branch（记录投影可见）→ consumed；发送异常→ failed（错误保留，不静默重发）。旧 owner 的遗留项置 failed 不转新会话；owner close 清队列。
- 不做 Watcher 判定/节流/重试；204 只表示接收（AdvisoryDelivery 合同不变）。

## 4. 恢复与重连

- recoverRuntime(root session id 可确认时)：重建 broker-channel prepare（capability→source读回→Client/catalog）→ 重注册投影工具 → 刷新桥（新密码/地址）并对 FSM 发 source-auth 更新路由 → records 从原 binding/branch 重建。mutation 未知不回放；actor 身份不变。Owner 不可确认则拒绝，不从旧进程日志推活跃。
- 根 session_shutdown/崩溃路径：不删除 FSM 栈/Evidence/launch 文件；重启后由安装入口按原 rootSessionId 恢复（fsm-1 restore 分支）。

## 5. 组装与安装

- openOwnedRuntime（根 extension 入口 index.ts）：session_start → managed bootstrap（fsm-2）→ broker-channel prepare → RecordStore/OcServer(桥)/JudgeSessions/RootLaunches/ChildRuns → permission+stop gates 安装 → ask 工具/AdvisoryQueue → 全部 prepared 才 ready（not-ready-gate 拦截输入/工具）。任一失败逆序释放并 not-ready。fsm-4 记录级残留在此顺手处理：排队项段起 signal 复查；launch 级容量/deadline/abort 用例。
- planInstallation(config)：静态解析官方 Pi/SA/FSM 来源与版本能力（不做网络/不运行）；生成安装计划：插件目录安装、`npm install --ignore-scripts`+overrides、cc 构建 host-identity helper（scripts/build-host-identity.mjs）、managed bootstrap 入口生成（顶层静态 import 绑定 web factories 与 companion factories 的 manifest）、FSM 二进制路径与 wire2 能力校验指引、~/.pi 配置写入建议（显式列出，不自动改）。缺失项给具体阻塞。真实模型账户/预算/数据范围须用户明确，安装计划不含任何 token 消耗。

## 6. 测试计划

fake ui/事件总线 + fake helper（gate 路由脚本）+ 真队列：ask 工具问答/取消/无UI拒绝、gate 二分（AskUserQuestion allowed→suppress、denied/其它→release、child 不动 main、POST 失败 best-effort）；AdvisoryQueue 满拒绝/204 语义/目标404、drain scheduled/consumed/failed/旧owner不转投、close 清队；recover 不重放未知、身份不变；组装 smoke（faux 全链 ready/失败逆序）；安装计划静态输出。无真实模型/网络/daemon。

## 7. 退出

B9 及直接缺口经原 workflow 六项标准确认 READY 后编码；实现后全量直接测试+一次独立合同对照；此后进入 mandatory 命令翻译（P10）。本单元通过不等于全系统完成（真实模型 E2E 须账户/预算明确后另行授权）。

## 设计确认钉死（run a5d0587a READY 附带澄清）

- ask-start suppress 由 permission-gate 在 verdict 时点按二分发出（AskUserQuestion allowed→suppress；其余 release）；ask 工具只置 waitState 并在返回时 POST ask-end（release），不重复 suppress。
- drain 的"目标会话 idle"生产者为 ctx.isIdle()/waitForIdle()。
- FSM 投影工具（mcp__fsm__ 前缀）在 permission-gate 早退，因此既不做 check 也不移动 gate（与 hook 跳过 FSM 工具一致）。
