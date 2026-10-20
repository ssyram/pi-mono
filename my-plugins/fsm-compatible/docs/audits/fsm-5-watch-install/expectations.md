# Contract Expectations — fsm-5-watch-install

事前源：architecture P7/P8/P9、§4.6/4.8；detailed-design §5.6；subplans/fsm-5-watch-install.md；原审查 B9。本单元尚无生产代码，不倒填实施位置。

## 1. 契约源

daemon /gate/suppress|/release {session_id,agent_id:"main",reason}（ask-start/ask-end/main-tool-start；best-effort 失败放弃、不改裁决、不启 daemon）；hook gate 二分（allowed && "AskUserQuestion"→suppress，其余 release；lost release 自愈）；Watcher prompt_async 严格 204=接收；官方 pi.sendMessage triggerTurn custom message；ui_prompt 事件非问答语义源。

## 2. 字段/Schema

gate body 三字段精确；ask 工具名恰为 "AskUserQuestion"（FSM 唯一 question 名）；AdvisoryDelivery {deliveryId, targetSessionId, text, state, at}；custom message customType=fsm-compatible:watcher、details.deliveryId 关联。恢复不新增 actor 字段。

## 3. 枚举

AdvisoryDelivery：accepted/scheduled/consumed/failed（无 cancelled 自动转）。waitState：active/inactive。安装计划：每步骤 ready/blocked(具体缺失)。

## 4. 流程

P1 ask 执行→check→真实问答→suppress(ask-start)→结果→release(ask-end)。
P2 main 的每次 permission verdict→按二分移 gate（suppression 仅 AskUserQuestion allowed；其余含 denial release；child 不动 main gate）。
P3 promptAsync→树内目标→入队→204；drain idle+active→sendMessage→branch 可见→consumed。
P4 recover：身份确认→重 prepare→重注册→source-auth 刷新；未知 mutation 不回放。

源码流程保留 Step Pn 注释。

## 5. 行为

- 无 UI 时不注册 ask 工具/不伪装回答；ui_prompt 不设等待标记。
- gate POST 失败 best-effort：不影响权限 verdict、不重试、不启 daemon。
- 队列满/目标失效 503；树外目标 404；无 noop 204。
- 旧 owner 遗留项 failed 不转新会话；close 清队。
- 投递不猜"已读"：consumed 仅以真实 branch 记录为准；发送错误 failed 保留。
- 组装：全部资源 prepared 才 ready；失败逆序释放；fsm-4 记录级残留（排队 signal 复查、launch 级用例）在本单元补齐。
- 安装计划静态、显式列写 ~/.pi 建议、不自动改、不含 token 消耗；FSM 二进制按 capability 响应校验（wire2）。

## 6. 时序/状态

ask 的 suppress 先于等待用户、release 后于获得结果；main 工具 release 与 ask-end 幂等方向一致。204 只在入队副作用后。恢复保 actor/SID/mandatory 基线（fsm-1 合同）。bridge 新地址经 source-auth 更新，不删 FSM 栈。

## 7. 不变量/性质

任意工具序列下 gate 状态由二分规则唯一决定（性质测试枚举 allowed/denied×AskUserQuestion/其它）；同 deliveryId 恰一次 sendMessage（无显式幂等键不重发）；队列有界；恢复前后 binding 相等；组装失败零残留 handle。

## 8. 资源/界限

队列/gate POST/wait 等待均有界（gate POST 沿 GATE_POST_TIMEOUT 量级）；timer unref+finally；owner close 逆序回收全部（含 AdvisoryQueue/gates/桥/judges/launches）。无新增性能 SLO；无真实模型/网络测试要求。

## 9. 安全/副作用

/gate/suppress|/release 入 helper 固定 allowlist，仍每请求新 token、读实际响应、best-effort 不以 exit0 推断；仅 my-plugins；安装不自动改 ~/.pi、不运行 npm lifecycle、cc 为显式步骤；秘密不入 binding/日志/队列文本（Watcher 文本按原样投递，不做密级判断）。真实账户/预算另行授权。

## 10. 一致性/退出

设计先按原 workflow 六项标准确认（限定 B9 及直接缺口）；实现按本表+明确 diff 独立对照一次；fsm-1/3/4（及已完成的 fsm-2 通道）结论不重开。本单元 PASS 后进入 mandatory 命令翻译（P10）；真实模型 E2E 与 SA 集成烟雾属安装后运行验证，须账户/预算明确。
