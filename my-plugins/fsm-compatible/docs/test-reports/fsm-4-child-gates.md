# fsm-4-child-gates 当前运行依据

状态：设计READY（run9efce024 BLOCKED三条D4修订→run a369b41c限定确认READY）；实现完成，实施后独立contract对照尚未运行，未结算PASS。

## 实现（均在my-plugins/fsm-compatible）

- B8：gates/tool-normalizer（path→filePath、grep glob→include、find→glob、powershell→bash、edit单次check多edits完整input、未知/mcp原样）；gates/permission-gate（fail-close：allow/deny原文、不可达block、FSM投影绕过、每调用恰一次check）；gates/stop-gate（agent_before_settle completed且无已有continuation才评估，block→CustomMessageEntryDraft+continue:true，transport soft-gate放行+诊断）。helper allowlist新增/check-permission、/stop-check。
- B6：children/root-launches——FIFO握手串行（SerialQueue）、bootstrap文件0600（task前缀仅一次性ref UUID）、ack或terminal失败出队、duplicate_node原样、容量副作用前拒绝、readBootstrap坏ref/坏文件拒绝。
- B7：children/child-runs——三元组关联、真实caller恰通知一次（第二terminal protocol-invalid）、cancel等实际terminal、超时unknown、lifecycle穷举映射（含unavailable_context/invalid_request→failed）。
- child侧：children/child-bootstrap——input事件剥离[fsm-bootstrap:ref]前缀恰一次（模型不可见）、initialize优先restore（root身份取saved绑定自身，resume语义；无前缀依赖）否则bindNewChild；children/delegation-bus（SA事件族typed包装）。
- 桥内部路由：oc-server/oc-handlers /fsm-compatible/launch-ack（Basic认证、404未知ref、400坏shape）；OcServer.close补closeAllConnections防连接挂起。

## 命令与结果（插件目录）

npm run test:admission 22/22、test:runtime 37/37、test:protocol 14/14、test:judge 16/16、test:gates 5/5、test:children 7/7；npm run check tsc 0。合计101项，无provider key/网络/真实模型/真实SA进程。

## 实施决策（记录于design-decisions）

bootstrap传输：SA pi runner无env通道→task前缀一次性ref+scope 0600文件+input transform剥离+桥launch-ack回传真实child SID；root以ack完成B6握手。initialize restore优先且不依赖前缀（恢复分支语义）。root侧ack时才bindNewChild（PendingLaunch/树归root）。

## 过程缺陷与修正

参数属性错误再犯两次（child-runs/delegation-bus，已修+教训）；launch-ack测试fetch漏路径（404致超时）；OcServer.close被keep-alive连接挂起（补closeAllConnections）；fresh路径误强制loadPayload；测试cleanup误用prototype hack——均已修，反例保留。

## 未完边界

实施对照未运行（下一步）；SA真实子进程集成烟雾、根完整runtime入口组装、fsm-2最终contract结算、fsm-5/安装/mandatory翻译继续。无staging/commit。
